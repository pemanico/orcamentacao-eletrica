import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  canApprove,
  canDeleteProject,
  canTransition,
  emptyFloorState,
  PAGE_UNITS_PER_METER,
  dxfToPage,
  floorStateSchema,
  validateFloor,
  type FloorState,
  type ProjectStatus,
} from "@orc/core";
import type { Db, FloorRow, ProjectEventRow, ProjectRow } from "./db.ts";
import { HttpError, Router, readBody, readJson, sendJson } from "./http.ts";
import { backfillLoads, migrateRules, registerRuleRoutes, seedRules } from "./rules.ts";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

const newId = () => randomUUID().replace(/-/g, "").slice(0, 16);

const projectInput = z.object({
  name: z.string().trim().min(1, "Nome obrigatório").max(120),
  client: z.string().trim().max(120).default(""),
  address: z.string().trim().max(200).default(""),
});

const statusInput = z.object({
  to: z.enum(PROJECT_STATUSES),
  note: z.string().trim().max(500).default(""),
});

const regionSchema = z
  .object({ minX: z.number().finite(), minY: z.number().finite(), maxX: z.number().finite(), maxY: z.number().finite() })
  .refine((r) => r.maxX > r.minX && r.maxY > r.minY, "Região vazia");

const sourceMetaInput = z.object({
  region: regionSchema.optional(),
  unit: z.enum(["m", "cm", "mm"]).optional(),
  hidden: z.array(z.string().max(255)).max(2000).optional(),
  snap: z.array(z.string().max(255)).max(2000).optional(),
  layerVersion: z.number().int().min(1).max(100).optional(),
});

const floorMetaInput = z.object({
  kind: z.enum(["pdf", "dxf"]).default("pdf"),
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
    /** identificador do ficheiro de origem (vários pisos podem partilhar o mesmo) */
    sourceFile: r.pdf_file,
    sourceKind: r.source_kind as "pdf" | "dxf",
    sourceMeta: r.source_meta ? (JSON.parse(r.source_meta) as Record<string, unknown>) : null,
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
  status: r.status as ProjectStatus,
  archivedAt: r.archived_at,
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
  backfillLoads(db);

  const listBackups = () =>
    existsSync(backupDir)
      ? readdirSync(backupDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && d.name.startsWith("copia-"))
          .map((d) => d.name)
          .sort()
          .reverse()
      : [];

  const logEvent = (projectId: string, kind: string, from: string | null, to: string | null, note = "") =>
    db.prepare("INSERT INTO project_events (project_id, kind, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)").run(
      projectId,
      kind,
      from,
      to,
      note,
    );

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
    /** ?arquivados=1 devolve só os arquivados; por defeito só os ativos. */
    .on("GET", "/api/projects", ({ query }) => {
      const archived = query.get("arquivados") === "1";
      const rows = db
        .prepare(`SELECT * FROM projects WHERE archived_at IS ${archived ? "NOT NULL" : "NULL"} ORDER BY updated_at DESC`)
        .all() as unknown as ProjectRow[];
      const counts = db
        .prepare("SELECT SUM(archived_at IS NULL) AS ativos, SUM(archived_at IS NOT NULL) AS arquivados FROM projects")
        .get() as { ativos: number | null; arquivados: number | null };
      return { projects: rows.map(projectDto), counts: { active: counts.ativos ?? 0, archived: counts.arquivados ?? 0 } };
    })
    .on("POST", "/api/projects", async ({ req, res }) => {
      const input = projectInput.parse(await readJson(req));
      const id = newId();
      db.prepare("INSERT INTO projects (id, name, client, address) VALUES (?, ?, ?, ?)").run(
        id,
        input.name,
        input.client,
        input.address,
      );
      logEvent(id, "criado", null, "levantamento");
      res.statusCode = 201;
      return projectDto(getProject(id)!);
    })
    .on("POST", "/api/projects/:id/status", async ({ req, params }) => {
      const row = getProject(params.id!);
      if (!row) throw new HttpError(404, "Projeto não encontrado.");
      const input = statusInput.parse(await readJson(req));
      const from = row.status as ProjectStatus;
      if (row.archived_at) throw new HttpError(409, "Projeto arquivado. Desarquiva-o antes de mudar o estado.");
      if (!canTransition(from, input.to)) {
        throw new HttpError(422, `Não é possível passar de "${PROJECT_STATUS_LABEL[from]}" para "${PROJECT_STATUS_LABEL[input.to]}".`);
      }
      db.prepare("UPDATE projects SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(input.to, row.id);
      logEvent(row.id, "estado", from, input.to, input.note);
      return projectDto(getProject(row.id)!);
    })
    .on("POST", "/api/projects/:id/archive", async ({ req, params }) => {
      const row = getProject(params.id!);
      if (!row) throw new HttpError(404, "Projeto não encontrado.");
      const { archived } = z.object({ archived: z.boolean() }).parse(await readJson(req));
      if (archived === !!row.archived_at) return projectDto(row);
      db.prepare(
        `UPDATE projects SET archived_at = ${archived ? "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" : "NULL"},
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(row.id);
      logEvent(row.id, archived ? "arquivado" : "desarquivado", row.status, row.status);
      return projectDto(getProject(row.id)!);
    })
    /**
     * Apagar é definitivo (base de dados + PDFs) e exige escrever o nome do projeto.
     * Bloqueado para obras adjudicadas, em obra ou concluídas: essas arquivam-se.
     */
    .on("DELETE", "/api/projects/:id", async ({ req, params }) => {
      const row = getProject(params.id!);
      if (!row) throw new HttpError(404, "Projeto não encontrado.");
      const { confirmName } = z.object({ confirmName: z.string() }).parse(await readJson(req));
      if (!canDeleteProject(row.status as ProjectStatus)) {
        throw new HttpError(
          409,
          `Um projeto "${PROJECT_STATUS_LABEL[row.status as ProjectStatus]}" tem histórico de obra e não pode ser apagado. Arquiva-o.`,
        );
      }
      if (confirmName.trim() !== row.name.trim()) throw new HttpError(422, "O nome escrito não corresponde ao nome do projeto.");
      const files = (db.prepare("SELECT pdf_file FROM floors WHERE project_id = ?").all(row.id) as { pdf_file: string }[]).map(
        (f) => f.pdf_file,
      );
      db.prepare("DELETE FROM projects WHERE id = ?").run(row.id); // pisos e eventos em cascata
      for (const f of files) rmSync(join(pdfDir, f), { force: true });
      return { ok: true, deletedFloors: files.length };
    })
    .on("GET", "/api/projects/:id", ({ params }) => {
      const row = getProject(params.id!);
      if (!row) throw new HttpError(404, "Projeto não encontrado.");
      const floors = db
        .prepare("SELECT * FROM floors WHERE project_id = ? ORDER BY created_at")
        .all(row.id) as unknown as FloorRow[];
      const events = (
        db.prepare("SELECT * FROM project_events WHERE project_id = ? ORDER BY at DESC, id DESC").all(row.id) as unknown as ProjectEventRow[]
      ).map((e) => ({ kind: e.kind, from: e.from_status, to: e.to_status, note: e.note, at: e.at }));
      return {
        ...projectDto(row),
        events,
        /** ficheiros já importados, para criar mais pisos a partir deles */
        sources: [...new Map(floors.map((f) => [f.pdf_file, f])).values()].map((f) => ({
          file: f.pdf_file,
          originalName: f.pdf_original_name,
          kind: f.source_kind,
          floors: floors.filter((x) => x.pdf_file === f.pdf_file).map((x) => x.name),
        })),
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
      if (meta.kind === "pdf" && buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new HttpError(400, "O ficheiro não é um PDF.");
      if (meta.kind === "dxf") {
        const head = buffer.subarray(0, 64).toString("latin1");
        if (head.startsWith("AutoCAD Binary DXF")) throw new HttpError(400, "DXF binário não suportado: exporta como DXF ASCII.");
        if (head.startsWith("AC10")) throw new HttpError(400, "Isto é um DWG. Converte para DXF (ODA File Converter) e importa o DXF.");
        if (!/^\s*0\s*\r?\n\s*SECTION/.test(head)) throw new HttpError(400, "O ficheiro não é um DXF.");
      }
      const id = newId();
      const file = `${id}.${meta.kind}`;
      writeFileSync(join(pdfDir, file), buffer);
      db.prepare(
        `INSERT INTO floors (id, project_id, name, ceiling_height_m, pdf_file, pdf_original_name, pdf_page, state_json, source_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, params.id!, meta.name, meta.ceilingHeightM, file, meta.filename, meta.pdfPage, JSON.stringify(emptyFloorState()), meta.kind);
      touchProject(params.id!);
      res.statusCode = 201;
      return floorDto(getFloor(id)!);
    })
    .on("GET", "/api/floors/:id", ({ params }) => {
      const row = getFloor(params.id!);
      if (!row) throw new HttpError(404, "Piso não encontrado.");
      return floorDto(row);
    })
    /**
     * Fonte de um piso DXF: região, unidades e layers.
     * Região e unidades definem a escala, por isso só se mudam com o piso vazio.
     * Layers (ver/snap) são só visualização: não mexem na revisão nem na aprovação.
     */
    .on("PUT", "/api/floors/:id/source", async ({ req, params }) => {
      const row = getFloor(params.id!);
      if (!row) throw new HttpError(404, "Piso não encontrado.");
      if (row.source_kind !== "dxf") throw new HttpError(400, "Só os pisos importados de DXF têm esta configuração.");
      const input = sourceMetaInput.parse(await readJson(req));
      const current = (row.source_meta ? JSON.parse(row.source_meta) : {}) as Record<string, unknown>;
      const next = { ...current, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
      const geometryChange = input.region !== undefined || input.unit !== undefined;
      const state = JSON.parse(row.state_json) as FloorState;
      if (geometryChange) {
        if (state.walls.length || state.rooms.length || state.openings.length) {
          throw new HttpError(409, "Já há paredes ou divisões traçadas. Para mudar a região ou as unidades, apaga-as primeiro.");
        }
        if (!next.region || !next.unit) throw new HttpError(400, "Indica a região e as unidades.");
        const t = dxfToPage(next.region as z.infer<typeof regionSchema>, next.unit as "m" | "cm" | "mm");
        const widthM = t.width / PAGE_UNITS_PER_METER;
        state.scale = {
          metersPerUnit: 1 / PAGE_UNITS_PER_METER,
          refA: { x: 0, y: 0 },
          refB: { x: t.width, y: 0 },
          refMeters: Math.round(widthM * 1000) / 1000,
          stampDenominator: 100,
        };
        db.prepare(
          `UPDATE floors SET source_meta = ?, state_json = ?, rev = rev + 1, approved_at = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
        ).run(JSON.stringify(next), JSON.stringify(state), row.id);
        touchProject(row.project_id);
      } else {
        db.prepare("UPDATE floors SET source_meta = ? WHERE id = ?").run(JSON.stringify(next), row.id);
      }
      return floorDto(getFloor(row.id)!);
    })
    .on("GET", "/api/floors/:id/pdf", ({ params, res }) => {
      const row = getFloor(params.id!);
      const path = row && join(pdfDir, row.pdf_file);
      if (!row || !path || !existsSync(path)) throw new HttpError(404, "Ficheiro da planta não encontrado.");
      res.writeHead(200, {
        "Content-Type": row.source_kind === "dxf" ? "application/dxf; charset=utf-8" : "application/pdf",
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
    /**
     * Novo piso a partir do ficheiro de outro piso do mesmo projeto (um DXF tem vários pisos;
     * um PDF pode ter várias páginas). O ficheiro não é copiado: os pisos partilham-no.
     */
    .on("POST", "/api/floors/:id/copy", async ({ req, res, params }) => {
      const row = getFloor(params.id!);
      if (!row) throw new HttpError(404, "Piso não encontrado.");
      const input = z
        .object({
          name: z.string().trim().min(1, "Nome do piso obrigatório").max(60),
          ceilingHeightM: z.coerce.number().min(2, "Pé-direito mínimo 2 m").max(6, "Pé-direito máximo 6 m"),
          pdfPage: z.coerce.number().int().min(1).optional(),
        })
        .parse(await readJson(req));
      const id = newId();
      db.prepare(
        `INSERT INTO floors (id, project_id, name, ceiling_height_m, pdf_file, pdf_original_name, pdf_page, state_json, source_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        row.project_id,
        input.name,
        input.ceilingHeightM,
        row.pdf_file,
        row.pdf_original_name,
        input.pdfPage ?? row.pdf_page,
        JSON.stringify(emptyFloorState()),
        row.source_kind,
      );
      touchProject(row.project_id);
      res.statusCode = 201;
      return floorDto(getFloor(id)!);
    })
    /**
     * Apagar um piso. O ficheiro só é apagado se nenhum outro piso o usar.
     * Bloqueado em projetos adjudicados, em obra ou concluídos (histórico de obra).
     */
    .on("DELETE", "/api/floors/:id", async ({ req, params }) => {
      const row = getFloor(params.id!);
      if (!row) throw new HttpError(404, "Piso não encontrado.");
      z.object({ confirm: z.literal(true) }).parse(await readJson(req));
      const project = getProject(row.project_id)!;
      if (!canDeleteProject(project.status as ProjectStatus)) {
        throw new HttpError(
          409,
          `O projeto está "${PROJECT_STATUS_LABEL[project.status as ProjectStatus]}": os pisos fazem parte do histórico da obra e não podem ser apagados.`,
        );
      }
      db.prepare("DELETE FROM floors WHERE id = ?").run(row.id);
      const { n } = db.prepare("SELECT COUNT(*) AS n FROM floors WHERE pdf_file = ?").get(row.pdf_file) as { n: number };
      if (n === 0) rmSync(join(pdfDir, row.pdf_file), { force: true });
      logEvent(row.project_id, "piso_apagado", project.status, project.status, row.name);
      touchProject(row.project_id);
      return { ok: true, fileRemoved: n === 0 };
    })
    .on("POST", "/api/floors/:id/approve", ({ params }) => {
      const row = getFloor(params.id!);
      if (!row) throw new HttpError(404, "Piso não encontrado.");
      const issues = validateFloor(JSON.parse(row.state_json));
      if (!canApprove(issues)) throw new HttpError(422, "O piso tem erros por resolver.", { issues });
      db.prepare("UPDATE floors SET approved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(row.id);
      return floorDto(getFloor(row.id)!);
    });

  registerRuleRoutes(router, db, opts.rulesSeedDir);

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
