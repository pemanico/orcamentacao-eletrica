import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, canDeleteProject, canTransition, type ProjectStatus } from "@orc/core";
import { newId, type AppContext } from "../context.ts";
import type { FloorRow, ProjectEventRow, ProjectRow } from "../db.ts";
import { HttpError, readJson, type Router } from "../http.ts";
import { floorDto } from "./floors.ts";

const projectInput = z.object({
  name: z.string().trim().min(1, "Nome obrigatório").max(120),
  client: z.string().trim().max(120).default(""),
  address: z.string().trim().max(200).default(""),
});

const statusInput = z.object({
  to: z.enum(PROJECT_STATUSES),
  note: z.string().trim().max(500).default(""),
});

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

/** Projetos: lista, criar, workflow de estados, arquivar, apagar, detalhe com pisos e histórico. */
export function registerProjectRoutes(router: Router, { db, pdfDir, getProject, logEvent }: AppContext) {
  router
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
    });
}
