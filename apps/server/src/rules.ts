import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  RULE_STATES,
  RULE_TABLES,
  RULE_TABLE_IDS,
  approvalBlockers,
  parseCell,
  parseCsv,
  pendingCount,
  toCsv,
  type RuleRow,
  type RuleState,
  type RuleTableId,
  type RuleValues,
} from "@orc/core";
import type { Db } from "./db.ts";
import { HttpError, Router, readJson } from "./http.ts";

export function migrateRules(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rules (
      id           TEXT PRIMARY KEY,
      table_id     TEXT NOT NULL,
      position     INTEGER NOT NULL,
      values_json  TEXT NOT NULL,
      state        TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT '',
      notes        TEXT NOT NULL DEFAULT '',
      updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      approved_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS rules_table ON rules(table_id, position);
  `);
}

interface RuleDbRow {
  id: string;
  table_id: string;
  position: number;
  values_json: string;
  state: string;
  source: string;
  notes: string;
  updated_at: string;
  approved_at: string | null;
}

const toRow = (r: RuleDbRow): RuleRow => ({
  id: r.id,
  table: r.table_id as RuleTableId,
  position: r.position,
  values: JSON.parse(r.values_json) as RuleValues,
  state: r.state as RuleState,
  source: r.source,
  notes: r.notes,
  updatedAt: r.updated_at,
  approvedAt: r.approved_at,
});

const newId = () => randomUUID().replace(/-/g, "").slice(0, 16);

/** Valida e normaliza os valores de uma linha segundo a definição da tabela. */
function cleanValues(tableId: RuleTableId, raw: Record<string, unknown>): RuleValues {
  const def = RULE_TABLES[tableId];
  const out: RuleValues = {};
  const errors: string[] = [];
  for (const col of def.columns) {
    const r = parseCell(col, raw[col.key]);
    if (r.ok) out[col.key] = r.value;
    else errors.push(r.error);
  }
  if (errors.length) throw new HttpError(400, errors.join("; "));
  return out;
}

/**
 * Carga inicial: para cada tabela vazia, lê `<seedDir>/<tabela>.csv`.
 * Nunca sobrescreve o que já está na base de dados.
 */
export function seedRules(db: Db, seedDir: string, log: (m: string) => void = () => {}) {
  for (const id of RULE_TABLE_IDS) {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM rules WHERE table_id = ?").get(id) as { n: number };
    const file = join(seedDir, `${id}.csv`);
    if (n > 0 || !existsSync(file)) continue;
    const def = RULE_TABLES[id];
    const insert = db.prepare(
      "INSERT INTO rules (id, table_id, position, values_json, state, source, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    parseCsv(readFileSync(file, "utf8")).forEach((rec, i) => {
      const values: RuleValues = {};
      const problems: string[] = [];
      for (const col of def.columns) {
        const r = parseCell(col, rec[col.key]);
        values[col.key] = r.ok ? r.value : null;
        if (!r.ok) problems.push(r.error);
      }
      // a carga inicial nunca aprova: a aprovação é sempre um ato teu, na app
      const state: RuleState = rec.estado === "a_definir" ? "a_definir" : "proposta";
      const notes = [rec.notas ?? "", ...problems].filter(Boolean).join(" · ");
      insert.run(newId(), id, (i + 1) * 10, JSON.stringify(values), state, rec.fonte ?? "", notes);
    });
    log(`Regras: carregada a tabela ${id} a partir de ${file}`);
  }
}

const updateInput = z.object({
  values: z.record(z.unknown()).optional(),
  state: z.enum(RULE_STATES).optional(),
  source: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
});

const tableParam = (t: string | undefined): RuleTableId => {
  if (!t || !(RULE_TABLE_IDS as readonly string[]).includes(t)) throw new HttpError(404, "Tabela de regras desconhecida.");
  return t as RuleTableId;
};

export function registerRuleRoutes(router: Router, db: Db) {
  const get = (id: string) => db.prepare("SELECT * FROM rules WHERE id = ?").get(id) as RuleDbRow | undefined;
  const list = (t: RuleTableId) =>
    (db.prepare("SELECT * FROM rules WHERE table_id = ? ORDER BY position, rowid").all(t) as unknown as RuleDbRow[]).map(toRow);

  router
    .on("GET", "/api/rules", () =>
      RULE_TABLE_IDS.map((id) => {
        const rows = list(id);
        return { id, total: rows.length, pending: pendingCount(rows) };
      }),
    )
    .on("GET", "/api/rules/:table", ({ params }) => list(tableParam(params.table)))
    .on("POST", "/api/rules/:table", async ({ req, res, params }) => {
      const t = tableParam(params.table);
      const body = (await readJson(req)) as { values?: Record<string, unknown> };
      const values = cleanValues(t, body.values ?? {});
      const { p } = db.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM rules WHERE table_id = ?").get(t) as { p: number };
      const id = newId();
      db.prepare("INSERT INTO rules (id, table_id, position, values_json, state) VALUES (?, ?, ?, ?, 'a_definir')").run(
        id,
        t,
        p + 10,
        JSON.stringify(values),
      );
      res.statusCode = 201;
      return toRow(get(id)!);
    })
    /**
     * Alterar valores ou fonte de uma linha aprovada retira-lhe a aprovação (volta a
     * "proposta"): uma regra aprovada nunca muda sem nova aprovação.
     */
    .on("PUT", "/api/rules/:table/:id", async ({ req, params }) => {
      const t = tableParam(params.table);
      const row = get(params.id!);
      if (!row || row.table_id !== t) throw new HttpError(404, "Regra não encontrada.");
      const input = updateInput.parse(await readJson(req));
      const current = toRow(row);
      const values = input.values ? cleanValues(t, { ...current.values, ...input.values }) : current.values;
      const source = input.source !== undefined ? input.source.trim() : current.source;
      const notes = input.notes !== undefined ? input.notes.trim() : current.notes;
      const contentChanged = JSON.stringify(values) !== JSON.stringify(current.values) || source !== current.source;

      let state: RuleState = input.state ?? current.state;
      if (contentChanged && current.state === "aprovada" && input.state !== "aprovada") state = "proposta";
      if (state === "aprovada") {
        const blockers = approvalBlockers(RULE_TABLES[t], { values, source });
        if (blockers.length) throw new HttpError(422, `Não é possível aprovar: ${blockers.join(", ")}.`, { blockers });
      }
      const approvedAt = state === "aprovada" ? (current.state === "aprovada" && !contentChanged ? current.approvedAt : "now") : null;
      db.prepare(
        `UPDATE rules SET values_json = ?, state = ?, source = ?, notes = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           approved_at = CASE WHEN ? = 'now' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE ? END
         WHERE id = ?`,
      ).run(JSON.stringify(values), state, source, notes, approvedAt, approvedAt, row.id);
      return toRow(get(row.id)!);
    })
    .on("DELETE", "/api/rules/:table/:id", ({ params }) => {
      const t = tableParam(params.table);
      const r = db.prepare("DELETE FROM rules WHERE id = ? AND table_id = ?").run(params.id!, t);
      if (Number(r.changes) !== 1) throw new HttpError(404, "Regra não encontrada.");
      return { ok: true };
    })
    .on("GET", "/api/rules/:table/export", ({ params, res }) => {
      const t = tableParam(params.table);
      const csv = "﻿" + toCsv(RULE_TABLES[t], list(t)); // BOM: o Excel lê os acentos bem
      const date = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="regras-export-${t}-${date}.csv"`,
        "Cache-Control": "no-store",
      });
      res.end(csv);
      return undefined;
    });
}
