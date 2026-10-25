/**
 * Preenchimento de regras a partir do ficheiro de referência (regras/referencia_rtiebt.csv).
 *
 * Regras do mecanismo:
 * - só preenche células vazias, nunca sobrescreve o que editaste;
 * - nunca mexe em linhas aprovadas;
 * - as linhas tocadas ficam em "proposta": a aprovação é sempre um ato teu;
 * - a fonte de cada valor (artigo RTIEBT) é acrescentada à fonte da linha.
 *
 * O ficheiro de referência só tem o que o regulamento diz. O que ele não fixa (disjuntor
 * por circuito, potência dos aparelhos, simultaneidade dentro da habitação) não é inventado.
 */
import { LOAD_KINDS, RULE_TABLES, parseCell, parseCsv, type LoadKind, type RuleRow, type RuleState, type RuleTableId, type RuleValues } from "./rules";

export interface ReferenceRow {
  grupo: string;
  chave: string;
  valor: string;
  unidade: string;
  fonte: string;
  notas: string;
}

export function parseReference(text: string): ReferenceRow[] {
  return parseCsv(text)
    .map((r) => ({
      grupo: r.grupo ?? "",
      chave: r.chave ?? "",
      valor: r.valor ?? "",
      unidade: r.unidade ?? "",
      fonte: r.fonte ?? "",
      notas: r.notas ?? "",
    }))
    .filter((r) => r.grupo && r.chave);
}

type RefKey = readonly [grupo: string, chave: string];

/** Secções mínimas do RTIEBT 801.5.8 por natureza da carga. */
const MIN_SECTION_KEY: Partial<Record<LoadKind, string>> = {
  iluminacao: "iluminacao",
  tomadas: "tomadas",
  maquinas_lavar: "maquinas_lavar_secar",
  termoacumulador: "termoacumulador",
  fogao: "fogao",
  climatizacao: "climatizacao",
};

/** Que valor de referência alimenta cada coluna, em função da carga da linha. */
const CELL_RULES: Partial<Record<RuleTableId, { column: string; ref: (load: LoadKind) => RefKey | null }[]>> = {
  tipos_circuito: [
    { column: "seccao_mm2", ref: (l) => (MIN_SECTION_KEY[l] ? ["seccao_minima_habitacao", MIN_SECTION_KEY[l]!] : null) },
    { column: "n_condutores", ref: (l) => (l === "outro" ? null : ["circuitos", "condutores_monofasico"]) },
    {
      column: "max_pontos",
      ref: (l) =>
        l === "iluminacao" || l === "tomadas"
          ? ["circuitos", "max_pontos_por_circuito"]
          : l === "climatizacao"
            ? ["circuitos", "max_aparelhos_climatizacao_por_circuito"]
            : l === "ve"
              ? ["circuitos", "ve_pontos_por_circuito"]
              : null,
    },
    { column: "diferencial", ref: (l) => (l === "ve" ? ["diferencial", "ve"] : null) },
  ],
  equipamentos: [{ column: "coef_simultaneidade", ref: (l) => (l === "ve" ? ["simultaneidade", "ve"] : null) }],
};

/** Parâmetros acrescentados à tabela Parâmetros quando ainda não existem (pelo nome). */
const NEW_PARAMETERS: { ref: RefKey; parametro: string }[] = [
  { ref: ["circuitos", "max_pontos_por_circuito"], parametro: "máx. pontos por circuito" },
  { ref: ["potencia_minima_mono", "1_compartimento"], parametro: "potência mínima — 1 compartimento" },
  { ref: ["potencia_minima_mono", "2_a_6_compartimentos"], parametro: "potência mínima — 2 a 6 compartimentos" },
  { ref: ["potencia_minima_mono", "mais_de_6_compartimentos"], parametro: "potência mínima — mais de 6 compartimentos" },
  { ref: ["queda_tensao", "iluminacao_rede_publica"], parametro: "queda de tensão máx. — iluminação" },
  { ref: ["queda_tensao", "outros_usos_rede_publica"], parametro: "queda de tensão máx. — outros usos" },
];

/** Tabelas onde o botão "Preencher com referência" faz alguma coisa. */
export const REFERENCE_TABLES: readonly RuleTableId[] = ["tipos_circuito", "equipamentos", "parametros"];

export interface CellChange {
  column: string;
  label: string;
  value: string | number;
  source: string;
}

export interface ReferenceFillPlan {
  updates: { id: string; label: string; changes: CellChange[]; values: RuleValues; source: string; state: RuleState }[];
  inserts: { label: string; values: RuleValues; source: string; notes: string }[];
  skipped: { label: string; reason: string }[];
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Natureza da carga deduzida do tipo e do texto (agrupamento / nome do equipamento). Null quando não é óbvia. */
export function inferLoad(tableId: RuleTableId, values: RuleValues): LoadKind | null {
  const text = norm(String((tableId === "equipamentos" ? values.equipamento : values.agrupamento) ?? ""));
  if (tableId === "tipos_circuito") {
    if (values.tipo === "iluminacao") return "iluminacao";
    if (values.tipo === "tomadas") return "tomadas";
  }
  if (/\bve\b|veiculo|wallbox|carregador/.test(text)) return "ve";
  if (/placa|forno|fogao|inducao/.test(text)) return "fogao";
  if (/maquina|lavar|secar|loica|roupa/.test(text)) return "maquinas_lavar";
  if (/termoacumulador|cilindro|esquentador eletrico/.test(text)) return "termoacumulador";
  if (/bomba de calor|ar condicionado|climatiza|\bac\b/.test(text)) return "climatizacao";
  return null;
}

const rowLabel = (tableId: RuleTableId, v: RuleValues) =>
  tableId === "tipos_circuito"
    ? [v.codigo, v.agrupamento].filter(Boolean).join(" — ") || "(linha sem código)"
    : tableId === "equipamentos"
      ? String(v.equipamento ?? "(sem nome)")
      : String(v.parametro ?? "(sem nome)");

const isEmpty = (v: unknown) => v === null || v === undefined || v === "";

/** Junta citações à fonte existente sem repetir nem apagar o que lá está. */
export function mergeSources(current: string, add: string[]): string {
  const parts = current
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const a of add) if (a && !parts.some((p) => p === a)) parts.push(a);
  return parts.join("; ");
}

/** O que o preenchimento faria nesta tabela. Função pura: o servidor aplica o plano. */
export function planReferenceFill(tableId: RuleTableId, rows: RuleRow[], reference: ReferenceRow[]): ReferenceFillPlan {
  const def = RULE_TABLES[tableId];
  const byKey = new Map(reference.map((r) => [`${r.grupo}/${r.chave}`, r]));
  const lookup = (k: RefKey | null) => (k ? byKey.get(`${k[0]}/${k[1]}`) : undefined);
  const plan: ReferenceFillPlan = { updates: [], inserts: [], skipped: [] };

  const rules = CELL_RULES[tableId];
  if (rules) {
    for (const row of rows) {
      const label = rowLabel(tableId, row.values);
      if (row.state === "aprovada") continue;
      const load = row.values.carga;
      if (typeof load !== "string" || !(LOAD_KINDS as readonly string[]).includes(load)) {
        plan.skipped.push({ label, reason: "sem carga indicada" });
        continue;
      }
      const values: RuleValues = { ...row.values };
      const changes: CellChange[] = [];
      for (const rule of rules) {
        if (!isEmpty(values[rule.column])) continue;
        const ref = lookup(rule.ref(load as LoadKind));
        const col = def.columns.find((c) => c.key === rule.column);
        if (!ref || !col) continue;
        const parsed = parseCell(col, ref.valor);
        if (!parsed.ok || parsed.value === null) continue;
        values[rule.column] = parsed.value;
        changes.push({ column: col.key, label: col.label, value: parsed.value, source: ref.fonte });
      }
      if (!changes.length) continue;
      plan.updates.push({
        id: row.id,
        label,
        changes,
        values,
        source: mergeSources(row.source, changes.map((c) => c.source)),
        state: "proposta",
      });
    }
  }

  if (tableId === "parametros") {
    const existing = new Set(rows.map((r) => norm(String(r.values.parametro ?? "")).trim()));
    for (const p of NEW_PARAMETERS) {
      if (existing.has(norm(p.parametro))) continue;
      const ref = lookup(p.ref);
      if (!ref) continue;
      const parsed = parseCell(def.columns.find((c) => c.key === "valor")!, ref.valor);
      if (!parsed.ok || parsed.value === null) continue;
      plan.inserts.push({
        label: p.parametro,
        values: { parametro: p.parametro, valor: parsed.value, unidade: ref.unidade || null },
        source: ref.fonte,
        notes: ref.notas,
      });
    }
  }
  return plan;
}

/**
 * Tipos de circuito: linhas da mesma carga com secção, disjuntor ou diferencial diferentes.
 * A tabela não separa especificação e agrupamento, por isso C1, C2–C4, C5… repetem valores
 * e podem desalinhar-se. Não bloqueia: só avisa.
 */
export function loadInconsistencies(rows: RuleRow[]): string[] {
  const out: string[] = [];
  const cols = RULE_TABLES.tipos_circuito.columns.filter((c) => ["seccao_mm2", "disjuntor_A", "diferencial"].includes(c.key));
  for (const load of LOAD_KINDS) {
    const group = rows.filter((r) => r.values.carga === load);
    for (const col of cols) {
      const distinct = new Map<string, string[]>();
      for (const r of group) {
        const v = r.values[col.key];
        if (isEmpty(v)) continue;
        const k = String(v);
        distinct.set(k, [...(distinct.get(k) ?? []), String(r.values.codigo || "?")]);
      }
      if (distinct.size > 1) {
        const parts = [...distinct].map(([v, codes]) => `${codes.join(", ")}: ${v.replace(".", ",")}`);
        out.push(`${load} — ${col.label.toLowerCase()} diferente (${parts.join(" · ")})`);
      }
    }
  }
  return out;
}
