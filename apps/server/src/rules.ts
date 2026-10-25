import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  RULE_STATES,
  RULE_TABLES,
  RULE_TABLE_IDS,
  ROOM_TYPE_CODE,
  ROOM_TYPES,
  approvalBlockers,
  inferLoad,
  parseReference,
  planReferenceFill,
  REFERENCE_TABLES,
  isBuiltinRoomType,
  slugifyRoomType,
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

/** Códigos dos tipos de divisão criados pelo utilizador (exceto a linha `exceptId`). */
function customRoomTypeCodes(db: Db, exceptId?: string): string[] {
  const rows = db.prepare("SELECT id, values_json FROM rules WHERE table_id = 'tipos_divisao'").all() as { id: string; values_json: string }[];
  return rows
    .filter((r) => r.id !== exceptId)
    .map((r) => (JSON.parse(r.values_json) as RuleValues).codigo)
    .filter((c): c is string => typeof c === "string" && c.length > 0);
}

/** Onde um tipo de divisão está a ser usado (defaults e divisões já desenhadas). */
export function roomTypeUsage(db: Db, code: string): string[] {
  const out: string[] = [];
  const defaults = (db.prepare("SELECT values_json FROM rules WHERE table_id = 'defaults_divisao'").all() as { values_json: string }[]).filter(
    (r) => (JSON.parse(r.values_json) as RuleValues).divisao === code,
  ).length;
  if (defaults) out.push(`${defaults} linha(s) em Defaults por divisão`);
  const floors = db
    .prepare("SELECT f.name AS floor, p.name AS project, f.state_json FROM floors f JOIN projects p ON p.id = f.project_id")
    .all() as { floor: string; project: string; state_json: string }[];
  for (const f of floors) {
    const rooms = (JSON.parse(f.state_json) as { rooms?: { name: string; types?: string[] }[] }).rooms ?? [];
    const used = rooms.filter((r) => r.types?.includes(code)).map((r) => r.name);
    if (used.length) out.push(`${f.project} · piso ${f.floor}: ${used.join(", ")}`);
  }
  return out;
}

/** Valida e normaliza os valores de uma linha segundo a definição da tabela. */
function cleanValues(db: Db, tableId: RuleTableId, raw: Record<string, unknown>, rowId?: string, previous?: RuleValues): RuleValues {
  const def = RULE_TABLES[tableId];
  const out: RuleValues = {};
  const errors: string[] = [];
  for (const col of def.columns) {
    const options = col.dynamicOptions === "room_types" ? [...ROOM_TYPES, ...customRoomTypeCodes(db)] : col.options;
    const r = parseCell(col, raw[col.key], options);
    if (r.ok) out[col.key] = r.value;
    else errors.push(r.error);
  }
  if (errors.length) throw new HttpError(400, errors.join("; "));
  if (tableId === "tipos_divisao") checkRoomType(db, out, rowId, previous);
  return out;
}

/**
 * Tipos de divisão: o código gera-se a partir do nome, tem de ser único e não pode
 * coincidir com um tipo base. Um código em uso não muda (as divisões guardam o código).
 */
function checkRoomType(db: Db, v: RuleValues, rowId?: string, previous?: RuleValues) {
  const others = new Set(customRoomTypeCodes(db, rowId));
  if (!v.codigo && typeof v.nome === "string" && v.nome) {
    const base = slugifyRoomType(v.nome);
    let code = base;
    for (let i = 2; isBuiltinRoomType(code) || others.has(code); i++) code = `${base}_${i}`;
    v.codigo = code;
  }
  const code = v.codigo;
  if (typeof code === "string") {
    if (!ROOM_TYPE_CODE.test(code)) throw new HttpError(400, "Código: só minúsculas sem acentos, algarismos e _ (ex.: sala_maquinas).");
    if (isBuiltinRoomType(code)) throw new HttpError(400, `Código: "${code}" já é um tipo base.`);
    if (others.has(code)) throw new HttpError(409, `Código: já existe um tipo "${code}".`);
  }
  const prev = previous?.codigo;
  if (typeof prev === "string" && prev && prev !== code) {
    const used = roomTypeUsage(db, prev);
    if (used.length) throw new HttpError(409, `O código "${prev}" está em uso e não pode mudar: ${used.join("; ")}.`, { used });
  }
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
      if (def.columns.some((c) => c.key === "carga") && values.carga === null) values.carga = inferLoad(id, values);
      // a carga inicial nunca aprova: a aprovação é sempre um ato teu, na app
      const state: RuleState = rec.estado === "a_definir" ? "a_definir" : "proposta";
      const notes = [rec.notas ?? "", ...problems].filter(Boolean).join(" · ");
      insert.run(newId(), id, (i + 1) * 10, JSON.stringify(values), state, rec.fonte ?? "", notes);
    });
    log(`Regras: carregada a tabela ${id} a partir de ${file}`);
  }
}

/**
 * Linhas criadas antes de existir a coluna "carga": deduz a carga quando é óbvia
 * (tipo iluminação/tomadas, ou "forno", "placa", "VE"… no texto). Corre uma vez por linha
 * (a chave passa a existir, mesmo que fique vazia) e nunca toca em linhas aprovadas.
 */
export function backfillLoads(db: Db) {
  const rows = db
    .prepare("SELECT id, table_id, values_json FROM rules WHERE table_id IN ('tipos_circuito', 'equipamentos') AND state != 'aprovada'")
    .all() as { id: string; table_id: RuleTableId; values_json: string }[];
  const upd = db.prepare("UPDATE rules SET values_json = ? WHERE id = ?");
  for (const r of rows) {
    const v = JSON.parse(r.values_json) as RuleValues;
    if ("carga" in v) continue;
    v.carga = inferLoad(r.table_id, v);
    upd.run(JSON.stringify(v), r.id);
  }
}

export const REFERENCE_FILE = "referencia_rtiebt.csv";

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

export function registerRuleRoutes(router: Router, db: Db, seedDir?: string) {
  const get = (id: string) => db.prepare("SELECT * FROM rules WHERE id = ?").get(id) as RuleDbRow | undefined;
  const list = (t: RuleTableId) =>
    (db.prepare("SELECT * FROM rules WHERE table_id = ? ORDER BY position, rowid").all(t) as unknown as RuleDbRow[]).map(toRow);
  const planFill = (t: RuleTableId) => {
    if (!REFERENCE_TABLES.includes(t)) throw new HttpError(400, "Esta tabela não tem valores de referência.");
    const file = seedDir ? join(seedDir, REFERENCE_FILE) : "";
    if (!file || !existsSync(file)) throw new HttpError(404, `Ficheiro de referência não encontrado (regras/${REFERENCE_FILE}).`);
    return planReferenceFill(t, list(t), parseReference(readFileSync(file, "utf8")));
  };

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
      const body = (await readJson(req)) as { values?: Record<string, unknown>; state?: string };
      const values = cleanValues(db, t, body.values ?? {});
      const { p } = db.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM rules WHERE table_id = ?").get(t) as { p: number };
      const id = newId();
      // uma linha criada já preenchida (ex.: tipo novo no editor) fica como proposta
      const state: RuleState = body.state === "proposta" ? "proposta" : "a_definir";
      db.prepare("INSERT INTO rules (id, table_id, position, values_json, state) VALUES (?, ?, ?, ?, ?)").run(
        id,
        t,
        p + 10,
        JSON.stringify(values),
        state,
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
      const values = input.values ? cleanValues(db, t, { ...current.values, ...input.values }, current.id, current.values) : current.values;
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
      if (t === "tipos_divisao") {
        const row = get(params.id!);
        const code = row ? (JSON.parse(row.values_json) as RuleValues).codigo : null;
        const used = typeof code === "string" && code ? roomTypeUsage(db, code) : [];
        if (used.length) throw new HttpError(409, `Tipo em uso, não pode ser apagado: ${used.join("; ")}.`, { used });
      }
      const r = db.prepare("DELETE FROM rules WHERE id = ? AND table_id = ?").run(params.id!, t);
      if (Number(r.changes) !== 1) throw new HttpError(404, "Regra não encontrada.");
      return { ok: true };
    })
    /** Ficheiro de referência (quadros do RTIEBT) para a calculadora de secções. */
    .on("GET", "/api/reference", () => {
      const file = seedDir ? join(seedDir, REFERENCE_FILE) : "";
      if (!file || !existsSync(file)) throw new HttpError(404, `Ficheiro de referência não encontrado (regras/${REFERENCE_FILE}).`);
      return parseReference(readFileSync(file, "utf8"));
    })
    /** Pré-visualização do preenchimento com o ficheiro de referência (não grava nada). */
    .on("GET", "/api/rules/:table/reference-fill", ({ params }) => planFill(tableParam(params.table)))
    /** Aplica o preenchimento. O plano é recalculado aqui: nunca se confia no que o cliente viu. */
    .on("POST", "/api/rules/:table/reference-fill", ({ params }) => {
      const t = tableParam(params.table);
      const plan = planFill(t);
      const update = db.prepare(
        `UPDATE rules SET values_json = ?, source = ?, state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND state != 'aprovada'`,
      );
      const insert = db.prepare(
        "INSERT INTO rules (id, table_id, position, values_json, state, source, notes) VALUES (?, ?, ?, ?, 'proposta', ?, ?)",
      );
      db.exec("BEGIN");
      try {
        for (const u of plan.updates) update.run(JSON.stringify(u.values), u.source, u.state, u.id);
        let { p } = db.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM rules WHERE table_id = ?").get(t) as { p: number };
        for (const i of plan.inserts) insert.run(newId(), t, (p += 10), JSON.stringify(i.values), i.source, i.notes);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return plan;
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
