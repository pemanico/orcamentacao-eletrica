import { createReadStream, existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  PROJECT_STATUS_LABEL,
  canApprove,
  canDeleteProject,
  emptyFloorState,
  PAGE_UNITS_PER_METER,
  dxfToPage,
  floorStateSchema,
  validateFloor,
  type FloorState,
  type ProjectStatus,
} from "@orc/core";
import { newId, type AppContext } from "../context.ts";
import type { FloorRow } from "../db.ts";
import { HttpError, readBody, readJson, type Router } from "../http.ts";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

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

export const floorDto = (r: FloorRow) => {
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

/** Pisos: importar planta (PDF/DXF), fonte DXF, gravar com concorrência otimista, copiar, apagar, aprovar. */
export function registerFloorRoutes(router: Router, { db, pdfDir, getFloor, getProject, touchProject, logEvent }: AppContext) {
  router
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
}
