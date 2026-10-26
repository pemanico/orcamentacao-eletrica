/**
 * Tabelas de regras (fase F0). Definição única partilhada pelo servidor (validação,
 * carga inicial) e pelo frontend (editor).
 *
 * Princípio do plano: só linhas com estado "aprovada" entram em cálculos, e nas tabelas
 * técnicas uma linha só pode ser aprovada com a fonte preenchida (artigo RTIEBT, formador…).
 */
import { ROOM_TYPES } from "./types";

export type ColumnKind = "text" | "number" | "integer" | "enum";

export interface ColumnDef {
  key: string;
  label: string;
  kind: ColumnKind;
  options?: readonly string[];
  /** obrigatória para aprovar a linha */
  required?: boolean;
  unit?: string;
  min?: number;
  max?: number;
  width?: number;
  /** enum cujas opções incluem dados do utilizador (ex.: tipos de divisão criados em Regras) */
  dynamicOptions?: "room_types";
}

export interface RuleTableDef {
  id: RuleTableId;
  label: string;
  description: string;
  columns: ColumnDef[];
  /** fonte obrigatória para aprovar (valores normativos ou de terceiros) */
  requiresSource: boolean;
  /** valores comerciais: nunca exportados para o repositório */
  commercial?: boolean;
}

export const RULE_STATES = ["proposta", "a_definir", "aprovada"] as const;
export type RuleState = (typeof RULE_STATES)[number];
export const RULE_STATE_LABEL: Record<RuleState, string> = {
  proposta: "Proposta",
  a_definir: "A definir",
  aprovada: "Aprovada",
};

export const RULE_TABLE_IDS = ["tipos_divisao", "defaults_divisao", "tipos_circuito", "equipamentos", "mao_de_obra", "parametros"] as const;
export type RuleTableId = (typeof RULE_TABLE_IDS)[number];

export const CIRCUIT_KINDS = ["tomadas", "iluminacao", "dedicado", "estores"] as const;

/** Base da quantidade nos defaults por divisão. Vazio conta como "divisao". */
export const QUANTITY_BASES = ["divisao", "m2", "m", "janela"] as const;
export type QuantityBase = (typeof QUANTITY_BASES)[number];
export const QUANTITY_BASE_LABEL: Record<QuantityBase, string> = {
  divisao: "por divisão",
  m2: "por m² de área",
  m: "por m de comprimento",
  janela: "por janela",
};

/**
 * Natureza da carga, nas categorias do RTIEBT 801.5.8 (+ VE, secção 722). É a chave que
 * liga uma linha de regras aos valores do ficheiro de referência (regras/referencia_rtiebt.csv).
 */
export const LOAD_KINDS = ["iluminacao", "tomadas", "maquinas_lavar", "termoacumulador", "fogao", "climatizacao", "estores", "ve", "outro"] as const;
export type LoadKind = (typeof LOAD_KINDS)[number];
export const LOAD_LABEL: Record<LoadKind, string> = {
  iluminacao: "iluminação",
  tomadas: "tomadas",
  maquinas_lavar: "máq. lavar/secar",
  termoacumulador: "termoacumulador",
  fogao: "fogão (placa/forno)",
  climatizacao: "climatização (AC/BC)",
  estores: "estores elétricos",
  ve: "carregador VE",
  outro: "outro",
};

export const RULE_TABLES: Record<RuleTableId, RuleTableDef> = {
  tipos_divisao: {
    id: "tipos_divisao",
    label: "Tipos de divisão",
    description:
      "Tipos acrescentados por ti (ex.: adega, ginásio). Os tipos base (quarto, sala, closet, sala das máquinas…) já existem. Um tipo pode usar os defaults de um tipo base ou ter defaults próprios na tabela seguinte.",
    requiresSource: false,
    columns: [
      { key: "nome", label: "Nome", kind: "text", required: true, width: 190 },
      { key: "codigo", label: "Código", kind: "text", required: true, width: 150 },
      { key: "defaults_como", label: "Usa os defaults de", kind: "enum", options: ROOM_TYPES, width: 170 },
    ],
  },
  defaults_divisao: {
    id: "defaults_divisao",
    label: "Defaults por divisão",
    description:
      "Pontos propostos por defeito em cada tipo de divisão. \"Por divisão\": a quantidade é fixa. \"Por m²\" ou \"por m de comprimento\": a quantidade repete-se a cada X m² ou m (ex.: 1 ponto de luz cada 4 m de corredor), com um mínimo. \"Por janela\": multiplica pelas janelas da divisão (ex.: estores). O questionário ao cliente pode alterá-los.",
    requiresSource: false,
    columns: [
      { key: "divisao", label: "Divisão", kind: "enum", options: ROOM_TYPES, dynamicOptions: "room_types", required: true, width: 150 },
      { key: "elemento", label: "Elemento", kind: "text", required: true, width: 190 },
      { key: "quantidade", label: "Qtd.", kind: "integer", required: true, min: 0, max: 50, width: 70 },
      { key: "por", label: "Por", kind: "enum", options: QUANTITY_BASES, width: 150 },
      { key: "cada", label: "Cada", kind: "number", unit: "m² ou m", min: 0.5, max: 100, width: 90 },
      { key: "minimo", label: "Mín.", kind: "integer", min: 0, max: 50, width: 70 },
    ],
  },
  tipos_circuito: {
    id: "tipos_circuito",
    label: "Tipos de circuito",
    description: "Secção, disjuntor e diferencial por tipo de circuito. Valores das RTIEBT, com a fonte indicada.",
    requiresSource: true,
    columns: [
      { key: "codigo", label: "Código", kind: "text", required: true, width: 80 },
      { key: "tipo", label: "Tipo", kind: "enum", options: CIRCUIT_KINDS, required: true, width: 110 },
      { key: "carga", label: "Carga", kind: "enum", options: LOAD_KINDS, width: 160 },
      { key: "agrupamento", label: "Agrupamento", kind: "text", required: true, width: 210 },
      { key: "seccao_mm2", label: "Secção", kind: "number", unit: "mm²", required: true, min: 0.5, max: 50, width: 80 },
      { key: "disjuntor_A", label: "Disjuntor", kind: "number", unit: "A", required: true, min: 1, max: 125, width: 85 },
      { key: "n_condutores", label: "Condutores", kind: "integer", required: true, min: 2, max: 5, width: 90 },
      { key: "max_pontos", label: "Máx. pontos", kind: "integer", min: 1, max: 50, width: 90 },
      { key: "diferencial", label: "Diferencial", kind: "text", required: true, width: 120 },
    ],
  },
  equipamentos: {
    id: "equipamentos",
    label: "Equipamentos",
    description: "Potência e coeficiente de simultaneidade dos equipamentos com circuito dedicado.",
    requiresSource: true,
    columns: [
      { key: "equipamento", label: "Equipamento", kind: "text", required: true, width: 190 },
      { key: "carga", label: "Carga", kind: "enum", options: LOAD_KINDS, width: 160 },
      { key: "potencia_W", label: "Potência", kind: "number", unit: "W", required: true, min: 0, max: 30000, width: 100 },
      { key: "coef_simultaneidade", label: "Simultaneidade", kind: "number", required: true, min: 0, max: 1, width: 110 },
    ],
  },
  mao_de_obra: {
    id: "mao_de_obra",
    label: "Mão de obra",
    description: "Horas estimadas por tarefa. Valores comerciais: ficam só na tua base de dados.",
    requiresSource: true,
    commercial: true,
    columns: [
      { key: "tarefa", label: "Tarefa", kind: "text", required: true, width: 210 },
      { key: "horas", label: "Horas", kind: "number", unit: "h", required: true, min: 0, max: 100, width: 80 },
    ],
  },
  parametros: {
    id: "parametros",
    label: "Parâmetros",
    description: "Valor da hora, markup e contingência. Valores comerciais: ficam só na tua base de dados.",
    requiresSource: false,
    commercial: true,
    columns: [
      { key: "parametro", label: "Parâmetro", kind: "text", required: true, width: 210 },
      { key: "valor", label: "Valor", kind: "number", required: true, min: 0, max: 10000, width: 100 },
      { key: "unidade", label: "Unidade", kind: "text", width: 90 },
    ],
  },
};

export type RuleValues = Record<string, string | number | null>;

export interface RuleRow {
  id: string;
  table: RuleTableId;
  position: number;
  values: RuleValues;
  state: RuleState;
  source: string;
  notes: string;
  updatedAt: string;
  approvedAt: string | null;
}

/** Converte um texto introduzido (vírgula decimal) para o tipo da coluna. */
export function parseCell(
  col: ColumnDef,
  raw: unknown,
  /** opções efetivas de um enum dinâmico (por defeito col.options) */
  options: readonly string[] | undefined = col.options,
): { ok: true; value: string | number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return { ok: true, value: null };
  if (col.kind === "text") return { ok: true, value: String(raw).trim().slice(0, 300) };
  if (col.kind === "enum") {
    const v = String(raw).trim();
    return options?.includes(v) ? { ok: true, value: v } : { ok: false, error: `${col.label}: valor inválido "${v}"` };
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").trim());
  if (!Number.isFinite(n)) return { ok: false, error: `${col.label}: tem de ser um número` };
  if (col.kind === "integer" && !Number.isInteger(n)) return { ok: false, error: `${col.label}: tem de ser um número inteiro` };
  if (col.min !== undefined && n < col.min) return { ok: false, error: `${col.label}: mínimo ${col.min}` };
  if (col.max !== undefined && n > col.max) return { ok: false, error: `${col.label}: máximo ${col.max}` };
  return { ok: true, value: n };
}

/** O que falta para a linha poder ser aprovada. Lista vazia = pode ser aprovada. */
export function approvalBlockers(def: RuleTableDef, row: Pick<RuleRow, "values" | "source">): string[] {
  const missing = def.columns.filter((c) => c.required && (row.values[c.key] === null || row.values[c.key] === undefined || row.values[c.key] === ""));
  const out = missing.map((c) => `falta ${c.label.toLowerCase()}`);
  if (def.requiresSource && !row.source.trim()) out.push("falta a fonte");
  if (def.id === "defaults_divisao" && (row.values.por === "m2" || row.values.por === "m") && !row.values.cada) out.push("falta \"cada\" (m² ou m)");
  return out;
}

/** Pendentes de uma tabela: tudo o que não está aprovado. */
export const pendingCount = (rows: Pick<RuleRow, "state">[]) => rows.filter((r) => r.state !== "aprovada").length;

/** CSV com separador ";" (Excel em português), com aspas quando necessário. */
export function toCsv(def: RuleTableDef, rows: RuleRow[]): string {
  const header = [...def.columns.map((c) => c.key), "estado", "fonte", "notas"];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => [...def.columns.map((c) => r.values[c.key]), r.state, r.source, r.notes].map(esc).join(";"));
  return [header.join(";"), ...lines].join("\r\n") + "\r\n";
}

/** Leitor de CSV com ";" e aspas. Devolve linhas como objetos indexados pelo cabeçalho. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ";") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
