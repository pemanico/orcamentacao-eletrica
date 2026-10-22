import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canApprove, emptyFloorState, floorStateSchema, validateFloor, type FloorState } from "@orc/core";
import type { Db, FloorRow, ProjectRow } from "./db.ts";
import { HttpError, Router, readBody, readJson, sendJson } from "./http.ts";
import { migrateRules, registerRuleRoutes, seedRules } from "./rules.ts";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

const newId = () => randomUUID().replace(/-/g, "").slice(0, 16);

const projectInput = z.object({
  name: z.string().trim().min(1, "Nome obrigatório").max(120),
  client: z.string().trim().max(120).default(""),
  address: z.string().trim().max(200).default(""),
});

const floorMetaInput = z.object({
  name: z.string().trim().min(1, "Nome do piso obrigatório").max(60),
  ceilingHeightM: z.coerce.number().min(2, "Pé-direito mínimo 2 m").max(6, "Pé-direito máximo 6 m"),
  pdfPage: z.coerce.number().int().min(1).default(1),
  filename: z.string().trim().max(200).default("planta.pdf"),
});

const floorUpdateInput = z.object({
  rev: z.number().int().positive(),
  name: z.string().trim().min(1).max(60).optional(),
  ceilingHeightM: z.number().min(2).max(6).optional(),
  state: floorStateSchema.optional(),
});

const floorDto = (r: FloorRow) => {
  const state = JSON.parse(r.state_json) as FloorState;
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    ceilingHeightM: r.ceiling_height_m,
    pdfOriginalName: r.pdf_original_name,
    pdfPage: r.pdf_page,
    state,
    rev: r.rev,
    approvedAt: r.approved_at,
    updatedAt: r.updated_at,
    issues: validateFloor(state),
  };
};

const projectDto = (r: ProjectRow) => ({
  id: r.id,
  name: r.name,
  client: r.client,
  address: r.address,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function buildApp(opts: {
  db: Db;
  dataDir: string;
  /** pasta das cópias de segurança; por defeito <dataDir>/copias. Aponta para o OneDrive, por exemplo. */
  backupDir?: string;
  /** pasta com os CSV de valores iniciais das regras (carregados só se a tabela estiver vazia) */
  rulesSeedDir?: string;
  webDist?: string;
  log?: (msg: string) => void;
}) {
  const { db, dataDir } = opts;
  const log = opts.log ?? (() => {});
  const pdfDir = join(dataDir, "pdfs");
  mkdirSync(pdfDir, { recursive: true });

  const getFloor = (id: string) => db.prepare("SELECT * FROM floors WHERE id = ?").get(id) as FloorRow | undefined;
  const getProject = (id: string) =>
    db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  const touchProject = (id: string) =>
    db.prepare("UPDATE projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(id);

  const backupDir = resolve(opts.backupDir ?? join(dataDir, "copias"));
  migrateRules(db);
  if (opts.rulesSeedDir) seedRules(db, opts.rulesSeedDir, log);

  const listBackups = () =>
    existsSync(backupDir)
      ? readdirSync(backupDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && d.name.startsWith("copia-"))
          .map((d) => d.name)
          .sort()
          .reverse()
      : [];

  const router = new Router()
    // ---------- dados e cópias de segurança ----------
    .on("GET", "/api/info", () => {
      // caminho real do ficheiro aberto (não assume o nome)
      const dbFile = (db.prepare("PRAGMA database_list").all() as { name: string; file: string }[]).find((d) => d.name === "main")?.file ?? join(dataDir, "orcamentacao.db");
      const counts = db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM projects) AS projects, (SELECT COUNT(*) FROM floors) AS floors, (SELECT MAX(updated_at) FROM floors) AS lastFloor, (SELECT MAX(updated_at) FROM projects) AS lastProject",
        )
        .get() as { projects: number; floors: number; lastFloor: string | null; lastProject: string | null };
      const backups = listBackups();
      return {
        dataDir: resolve(dataDir),
        dbFile: resolve(dbFile),
        // inclui o ficheiro -wal, onde o SQLite guarda as gravações recentes
        dbBytes: [dbFile, `${dbFile}-wal`].reduce((n, f) => n + (existsSync(f) ? statSync(f).size : 0), 0),
        projects: counts.projects,
        floors: counts.floors,
        lastSavedAt: [counts.lastFloor, counts.lastProject].filter(Boolean).sort().at(-1) ?? null,
        backupDir,
        lastBackup: backups[0] ?? null,
        backupCount: backups.length,
      };
    })
    /**
     * Cópia de segurança consistente: VACUUM INTO gera uma cópia da base de dados
     * mesmo com a app a correr; os PDFs são copiados ao lado.
     */
    .on("POST", "/api/backup", ({ res }) => {
      // hora local do PC, para o nome da pasta bater com o relógio
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      let name = `copia-${stamp}`;
      for (let i = 2; existsSync(join(backupDir, name)); i++) name = `copia-${stamp}-${i}`;
      const target = join(backupDir, name);
      mkdirSync(target, { recursive: true });
      const dbCopy = join(target, "orcamentacao.db");
      db.prepare("VACUUM INTO ?").run(dbCopy);
      if (existsSync(pdfDir)) cpSync(pdfDir, join(target, "pdfs"), { recursive: true });
      res.statusCode = 201;
      return { folder: target, dbBytes: statSync(dbCopy).size, backupCount: listBackups().length };
    })
    // ---------- projetos ----------
    .on("GET", "/api/projects", () =>
      (db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as unknown as ProjectRow[]).map(projectDto),
    )
    .on("POST", "/api/projects", async ({ req, res }) => {
      const input = projectInput.parse(await readJson(req));
      const id = newId();
      db.prepare("INSERT INTO projects (id, name, client, address) VALUES (?, ?, ?, ?)").run(
        id,
        input.name,
        input.client,
        input.address,
      );
      res.statusCode = 201;
      return projectDto(getProject(id)!);
    })
    .on("GET", "/api/projects/:id", ({ params }) => {
      const row = getProject(params.id!);
      if (!row) throw new HttpError(404, "Projeto não encontrado.");
      const floors = db
        .prepare("SELECT * FROM floors WHERE project_id = ? ORDER BY created_at")
        .all(row.id) as unknown as FloorRow[];
      return {
        ...projectDto(row),
        floors: floors.map((f) => {
          const { state, issues, ...rest } = floorDto(f);
          return {
            ...rest,
            roomCount: state.rooms.length,
            wallCount: state.walls.length,
            calibrated: !!state.scale,
            errorCount: issues.filter((i) => i.level === "erro").length,
          };
        }),
      };
    })

    // ---------- pisos ----------
    /**
     * Upload do PDF como corpo binário (application/pdf); metadados na query string.
     * Evita depender de uma biblioteca de multipart.
     */
    .on("POST", "/api/projects/:id/floors", async ({ req, res, params, query }) => {
      if (!getProject(params.id!)) throw new HttpError(404, "Projeto não encontrado.");
      const meta = floorMetaInput.parse(Object.fromEntries(query));
      const buffer = await readBody(req, MAX_PDF_BYTES);
      if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new HttpError(400, "O ficheiro não é um PDF.");
      const id = newId();
      const file = `${id}.pdf`;
      writeFileSync(join(pdfDir, file), buffer);
      db.prepare(
        `INSERT INTO floors (id, project_id, name, ceiling_height_m, pdf_file, pdf_original_name, pdf_page, state_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, params.id!, meta.name, meta.ceilingHeightM, file, meta.filename, meta.pdfPage, JSON.stringify(emptyFloorState()));
      touchProject(params.id!);
      res.statusCode = 201;
      return floorDto(getFloor(id)!);
    })
    .on("GET", "/api/floors/:id", ({ params }) => {
      const row = getFloor(params.id!);
      if (!row) throw new HttpError(404, "Piso não encontrado.");
      return floorDto(row);
    })
    .on("GET", "/api/floors/:id/pdf", ({ params, res }) => {
      const row = getFloor(params.id!);
      const path = row && join(pdfDir, row.pdf_file);
      if (!row || !path || !existsSync(path)) throw new HttpError(404, "PDF não encontrado.");
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": statSync(path).size,
        "Cache-Control": "private, max-age=3600",
      });
      createReadStream(path).pipe(res);
      return undefined;
    })
    /**
     * Gravação com controlo de concorrência otimista: se o piso mudou desde que foi
     * lido (outro separador), responde 409 em vez de sobrescrever.
     * Qualquer alteração retira a aprovação (princípio 4 do plano).
     */
    .on("PUT", "/api/floors/:id", async ({ req, params }) => {
      const input = floorUpdateInput.parse(await readJson(req));
      const row = getFloor(params.id!);
      if (!row) throw new HttpError(404, "Piso não encontrado.");
      if (row.rev !== input.rev) {
        throw new HttpError(409, "O piso foi alterado noutro separador. Recarrega a página.", { rev: row.rev });
      }
      const result = db
        .prepare(
          `UPDATE floors SET name = ?, ceiling_height_m = ?, state_json = ?, rev = rev + 1, approved_at = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND rev = ?`,
        )
        .run(
          input.name ?? row.name,
          input.ceilingHeightM ?? row.ceiling_height_m,
          input.state ? JSON.stringify(input.state) : row.state_json,
          row.id,
          row.rev,
        );
      if (Number(result.changes) !== 1) throw new HttpError(409, "Conflito de gravação. Recarrega a página.");
      touchProject(row.project_id);
      return floorDto(getFloor(row.id)!);
    })
    .on("POST", "/api/floors/:id/approve", ({ params }) => {
      const row = getFloor(params.id!);
      if (!row) throw new HttpError(404, "Piso não encontrado.");
      const issues = validateFloor(JSON.parse(row.state_json));
      if (!canApprove(issues)) throw new HttpError(422, "O piso tem erros por resolver.", { issues });
      db.prepare("UPDATE floors SET approved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(row.id);
      return floorDto(getFloor(row.id)!);
    });

  registerRuleRoutes(router, db);

  const webRoot = opts.webDist && existsSync(opts.webDist) ? resolve(opts.webDist) : null;

  function serveStatic(pathname: string, res: ServerResponse): boolean {
    if (!webRoot) return false;
    let rel = decodeURIComponent(pathname);
    if (rel === "/" || !extname(rel)) rel = "/index.html"; // rotas do frontend
    const file = normalize(join(webRoot, rel));
    if (!file.startsWith(webRoot + sep) || !existsSync(file)) return false;
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": rel === "/index.html" ? "no-store" : "no-cache",
    });
    createReadStream(file).pipe(res);
    return true;
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    try {
      if (url.pathname.startsWith("/api/")) {
        const m = router.match(method, url.pathname);
        if (m === null) throw new HttpError(404, "Não encontrado.");
        if (m === "method") throw new HttpError(405, "Método não permitido.");
        const out = await m.handler({ req, res, params: m.params, query: url.searchParams });
        if (out !== undefined && !res.headersSent) sendJson(res, res.statusCode || 200, out);
        return;
      }
      if (method === "GET" && serveStatic(url.pathname, res)) return;
      throw new HttpError(404, "Não encontrado.");
    } catch (err) {
      if (res.headersSent) return void res.destroy();
      if (err instanceof z.ZodError) {
        return sendJson(res, 400, {
          error: err.issues.map((i) => `${i.path.join(".") || "pedido"}: ${i.message}`).join("; "),
          issues: err.issues,
        });
      }
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, ...err.extra });
      log(`ERRO ${method} ${url.pathname}: ${(err as Error).stack ?? err}`);
      return sendJson(res, 500, { error: "Erro interno. Vê a consola do servidor." });
    } finally {
      log(`${method} ${url.pathname} → ${res.statusCode}`);
    }
  }

  return createServer((req, res) => void handle(req, res));
}
