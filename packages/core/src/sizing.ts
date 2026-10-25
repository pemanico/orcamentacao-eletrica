/**
 * Dimensionamento de um circuito final monofásico (calculadora da página Regras).
 *
 * Roteiro (RTIEBT 433.2 + quadros do anexo III):
 *   1. IB = P / (U · cos φ)
 *   2. In = menor calibre da série ≥ IB
 *   3. k = k1 (temperatura, 52-D1) · k2 (agrupamento, 52-E1 ou 52-E3)
 *   4. S = menor secção ≥ mínimo do 801.5.8 com Iz = Iz_tabela(S) · k ≥ In   (52-C1, 2 condutores carregados)
 *   5. ΔU = 2 · ρ · L · IB / S ≤ limite do quadro 52O (3 % iluminação, 5 % outros); se não cumprir, sobe a secção
 *
 * Com disjuntores EN 60898, I2 = 1,45 · In, pelo que a 2.ª condição do 433.2 (I2 ≤ 1,45 · Iz)
 * fica cumprida sempre que In ≤ Iz.
 *
 * Função pura e determinística: nenhum valor é estimado. Os quadros normativos vêm do ficheiro
 * de referência; os calibres e a resistividade vêm da tabela Parâmetros (o que não estiver
 * aprovado é usado, mas sinalizado como provisório).
 */
import type { ReferenceRow } from "./reference";
import { BREAKER_PARAM_PREFIX, RESISTIVITY_PARAM } from "./reference";
import type { LoadKind, RuleRow } from "./rules";

export type InstallMethod = "A" | "B";
export type GroupingKind = "mesmo_elemento" | "tubos_separados";

export interface SizingInput {
  carga: LoadKind;
  potencia_W: number;
  cos_phi: number;
  comprimento_m: number;
  metodo: InstallMethod;
  temperatura_C: number;
  /** n.º de circuitos agrupados, incluindo este */
  circuitos_agrupados: number;
  agrupamento: GroupingKind;
}

export interface SizingStep {
  label: string;
  formula: string;
  result: string;
  source: string;
}

export interface SizingResult {
  ok: boolean;
  IB?: number;
  In?: number;
  k?: number;
  seccao?: number;
  Iz?: number;
  quedaPct?: number;
  steps: SizingStep[];
  errors: string[];
  warnings: string[];
  /** parâmetros usados que ainda não estão aprovados */
  provisional: string[];
}

export const VOLTAGE = 230;
export const METHOD_LABEL: Record<InstallMethod, string> = {
  B: "B — tubo embebido em alvenaria (52H ref. 5)",
  A: "A — tubo embebido em parede termicamente isolante (52H ref. 1)",
};
export const GROUPING_LABEL: Record<GroupingKind, string> = {
  mesmo_elemento: "no mesmo tubo/elemento (52-E1)",
  tubos_separados: "tubos separados, lado a lado (52-E3)",
};

const MIN_SECTION_KEY: Partial<Record<LoadKind, string>> = {
  iluminacao: "iluminacao",
  tomadas: "tomadas",
  maquinas_lavar: "maquinas_lavar_secar",
  termoacumulador: "termoacumulador",
  fogao: "fogao",
  climatizacao: "climatizacao",
};

const num = (s: string) => Number(s.replace(",", "."));
const fmt = (n: number, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toString().replace(".", ",");

/** Tabela {chave numérica → valor} de um grupo do ficheiro de referência. */
function refTable(ref: ReferenceRow[], grupo: string) {
  const rows = ref.filter((r) => r.grupo === grupo && r.valor !== "");
  return { map: new Map(rows.map((r) => [num(r.chave), num(r.valor)])), source: rows[0]?.fonte ?? "" };
}

function refValue(ref: ReferenceRow[], grupo: string, chave: string) {
  return ref.find((r) => r.grupo === grupo && r.chave === chave);
}

/** Opções válidas para os campos da calculadora (o que existe nos quadros). */
export function sizingOptions(ref: ReferenceRow[]) {
  return {
    temperaturas: [...refTable(ref, "k1_temperatura_pvc").map.keys()].sort((a, b) => a - b),
    agrupados: {
      mesmo_elemento: [...refTable(ref, "k2_agrupamento_embebidos").map.keys()].sort((a, b) => a - b),
      tubos_separados: [...refTable(ref, "k2_tubos_embebidos_horizontal").map.keys()].sort((a, b) => a - b),
    } as Record<GroupingKind, number[]>,
  };
}

/** Lê da tabela Parâmetros os calibres e a resistividade (aprovados ou não). */
export function sizingParameters(parametros: RuleRow[]) {
  const name = (r: RuleRow) => String(r.values.parametro ?? "").trim().toLowerCase();
  const breakers = parametros
    .filter((r) => name(r).startsWith(BREAKER_PARAM_PREFIX) && typeof r.values.valor === "number")
    .map((r) => ({ amps: r.values.valor as number, approved: r.state === "aprovada" }))
    .sort((a, b) => a.amps - b.amps);
  const rho = parametros.find((r) => name(r) === RESISTIVITY_PARAM && typeof r.values.valor === "number");
  return {
    breakers,
    rho: rho ? { value: rho.values.valor as number, approved: rho.state === "aprovada", source: rho.source } : null,
  };
}

export function sizeCircuit(input: SizingInput, ref: ReferenceRow[], params: ReturnType<typeof sizingParameters>): SizingResult {
  const out: SizingResult = { ok: false, steps: [], errors: [], warnings: [], provisional: [] };
  const { potencia_W: P, cos_phi, comprimento_m: L } = input;
  if (!(P > 0)) out.errors.push("Potência tem de ser maior que zero.");
  if (!(cos_phi > 0 && cos_phi <= 1)) out.errors.push("cos φ tem de estar entre 0 e 1.");
  if (!(L >= 0)) out.errors.push("Comprimento inválido.");
  if (!params.breakers.length) out.errors.push('Sem calibres na tabela Parâmetros ("calibre de disjuntor …"). Usa "Preencher com referência" em Parâmetros.');
  if (!params.rho) out.errors.push('Falta o parâmetro "resistividade do cobre" na tabela Parâmetros.');
  if (out.errors.length) return out;

  // 1. Corrente de serviço
  const IB = P / (VOLTAGE * cos_phi);
  out.IB = IB;
  out.steps.push({
    label: "Corrente de serviço IB",
    formula: `${P} / (${VOLTAGE} · ${fmt(cos_phi)})`,
    result: `${fmt(IB)} A`,
    source: "IB = P / (U · cos φ)",
  });

  // 2. Calibre — com algum calibre aprovado, só os aprovados contam
  const series = params.breakers.some((b) => b.approved) ? params.breakers.filter((b) => b.approved) : params.breakers;
  const chosen = series.find((b) => b.amps >= IB - 1e-9);
  if (!chosen) {
    out.errors.push(`IB = ${fmt(IB)} A é maior do que o maior calibre da série (${series.at(-1)!.amps} A).`);
    return out;
  }
  if (!chosen.approved) out.provisional.push(`calibre ${chosen.amps} A`);
  const In = chosen.amps;
  out.In = In;
  out.steps.push({
    label: "Calibre do disjuntor In",
    formula: `menor calibre ≥ ${fmt(IB)} A`,
    result: `${In} A`,
    source: "RTIEBT 433.2 (IB ≤ In); série da tabela Parâmetros",
  });

  // 3. Fatores de correção
  const k1t = refTable(ref, "k1_temperatura_pvc");
  const k1 = k1t.map.get(input.temperatura_C);
  const k2group = input.agrupamento === "mesmo_elemento" ? "k2_agrupamento_embebidos" : "k2_tubos_embebidos_horizontal";
  const k2t = refTable(ref, k2group);
  const k2 = k2t.map.get(input.circuitos_agrupados);
  if (k1 === undefined) out.errors.push(`Sem fator k1 para ${input.temperatura_C} °C no quadro 52-D1.`);
  if (k2 === undefined) out.errors.push(`Sem fator k2 para ${input.circuitos_agrupados} circuitos (${GROUPING_LABEL[input.agrupamento]}).`);
  if (k1 === undefined || k2 === undefined) return out;
  const k = k1 * k2;
  out.k = k;
  out.steps.push({
    label: "Fatores de correção k = k1 · k2",
    formula: `${fmt(k1)} (${input.temperatura_C} °C) · ${fmt(k2)} (${input.circuitos_agrupados} circ.)`,
    result: fmt(k, 3),
    source: `${k1t.source}; ${k2t.source}`,
  });

  // 4. Secção
  const iz = refTable(ref, `iz_pvc_cu_2carregados_${input.metodo}`);
  const sections = [...iz.map.keys()].sort((a, b) => a - b);
  const minKey = MIN_SECTION_KEY[input.carga];
  const minRow = minKey ? refValue(ref, "seccao_minima_habitacao", minKey) : refValue(ref, "seccao_minima_geral", "potencia_iluminacao_cobre");
  const minS = minRow ? num(minRow.valor) : sections[0]!;
  const thermal = sections.find((s) => s >= minS && iz.map.get(s)! * k >= In);
  if (thermal === undefined) {
    out.errors.push(`Nenhuma secção até ${sections.at(-1)} mm² cumpre In ≤ Iz (${In} A com k = ${fmt(k, 3)}).`);
    return out;
  }
  const needed = In / k;
  out.steps.push({
    label: "Secção pelo aquecimento",
    formula: `Iz tabela ≥ ${In} / ${fmt(k, 3)} = ${fmt(needed, 1)} A; mínimo ${fmt(minS, 1)} mm²`,
    result: `${fmt(thermal, 1)} mm² (tabela ${fmt(iz.map.get(thermal)!, 1)} A → Iz = ${fmt(iz.map.get(thermal)! * k, 1)} A)`,
    source: `${iz.source}, método ${input.metodo}; mínimo ${minRow?.fonte ?? "—"}`,
  });

  // 5. Queda de tensão
  const rho = params.rho!;
  if (!rho.approved) out.provisional.push("resistividade do cobre");
  const isLighting = input.carga === "iluminacao";
  const limitRow = refValue(ref, "queda_tensao", isLighting ? "iluminacao_rede_publica" : "outros_usos_rede_publica");
  const limit = limitRow ? num(limitRow.valor) : isLighting ? 3 : 5;
  const drop = (S: number) => ((2 * rho.value * L * IB) / S / VOLTAGE) * 100;
  let S = thermal;
  for (const s of sections) {
    if (s < thermal) continue;
    S = s;
    if (drop(s) <= limit) break;
  }
  const pct = drop(S);
  out.steps.push({
    label: "Queda de tensão ΔU",
    formula: `2 · ${fmt(rho.value, 4)} · ${fmt(L, 1)} · ${fmt(IB)} / ${fmt(S, 1)} = ${fmt((pct / 100) * VOLTAGE)} V`,
    result: `${fmt(pct)} % (limite ${fmt(limit, 0)} %)`,
    source: `${limitRow?.fonte ?? "RTIEBT 525"}; ρ: ${rho.source || "tabela Parâmetros"}`,
  });
  if (pct > limit) {
    out.errors.push(`Queda de tensão de ${fmt(pct)} % acima de ${fmt(limit, 0)} % mesmo com ${fmt(S, 1)} mm². Encurta o circuito ou divide-o.`);
    return out;
  }
  if (S > thermal)
    out.warnings.push(`A secção sobe de ${fmt(thermal, 1)} para ${fmt(S, 1)} mm² por causa da queda de tensão (${fmt(drop(thermal))} % com ${fmt(thermal, 1)} mm²).`);

  out.seccao = S;
  out.Iz = iz.map.get(S)! * k;
  out.quedaPct = pct;
  out.ok = true;
  out.warnings.push(
    "ΔU calculada como no roteiro do CINEL (resistiva, ρ a frio, desde o quadro). Não inclui a queda a montante do quadro (52O mede desde a origem da instalação).",
    "Curto-circuito por verificar: poder de corte (Icn ≥ Icc máx) e disparo magnético no fim do circuito (Icc mín ≥ Im) dependem da impedância da rede, que a app não conhece.",
  );
  return out;
}
