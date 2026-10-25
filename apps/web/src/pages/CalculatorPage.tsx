import { useEffect, useMemo, useState } from "react";
import {
  GROUPING_LABEL,
  LOAD_KINDS,
  LOAD_LABEL,
  METHOD_LABEL,
  RULE_TABLES,
  RULE_TABLE_IDS,
  sizeCircuit,
  sizingOptions,
  sizingParameters,
  type GroupingKind,
  type InstallMethod,
  type LoadKind,
  type ReferenceRow,
  type RuleRow,
  type SizingInput,
} from "@orc/core";
import { api } from "../api";
import { Shell } from "../Shell";

const DEFAULT: SizingInput = {
  carga: "tomadas",
  potencia_W: 3680,
  cos_phi: 1,
  comprimento_m: 20,
  metodo: "B",
  temperatura_C: 30,
  circuitos_agrupados: 1,
  agrupamento: "mesmo_elemento",
};

const parseNum = (s: string) => Number(s.replace(",", ".").trim());
const fmt = (n: number, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toString().replace(".", ",");

/** Calculadora de secções: 433.2 + quadros do anexo III, com a fonte de cada passo. */
export function CalculatorPage() {
  const [ref, setRef] = useState<ReferenceRow[] | null>(null);
  const [params, setParams] = useState<RuleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState<SizingInput>(DEFAULT);
  // texto dos campos numéricos (aceita vírgula)
  const [text, setText] = useState({ potencia: "3680", cos: "1", comprimento: "20" });

  useEffect(() => {
    Promise.all([api.reference(), api.listRules("parametros")]).then(
      ([r, p]) => {
        setRef(r);
        setParams(p);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  const options = useMemo(() => (ref ? sizingOptions(ref) : null), [ref]);
  const result = useMemo(() => (ref && params ? sizeCircuit(input, ref, sizingParameters(params)) : null), [ref, params, input]);
  const set = (patch: Partial<SizingInput>) => setInput((i) => ({ ...i, ...patch }));
  const groupedOptions = options?.agrupados[input.agrupamento] ?? [1];

  return (
    <Shell section="regras" crumbs={[{ label: "Regras", href: "#/regras" }, { label: "Calculadora de secções" }]}>
      <div className="page wide">
        <header className="page-header">
          <h1>Regras</h1>
          <p className="muted">
            Dimensiona um circuito monofásico a partir dos quadros do RTIEBT. Cada passo mostra a fonte. Não grava nada.
          </p>
        </header>

        <nav className="tabs" aria-label="Tabelas de regras">
          {RULE_TABLE_IDS.map((id) => (
            <a key={id} href={`#/regras/${id}`}>
              {RULE_TABLES[id].label}
            </a>
          ))}
          <a href="#/regras/calculadora" className="active">
            Calculadora de secções
          </a>
        </nav>

        {error && <p className="error">{error}</p>}
        {!options || !result ? (
          !error && <p className="muted">A carregar…</p>
        ) : (
          <div className="calc-grid">
            <section className="card">
              <h2>Circuito</h2>
              <div className="calc-form">
                <label>
                  Carga
                  <select aria-label="Carga" value={input.carga} onChange={(e) => set({ carga: e.target.value as LoadKind })}>
                    {LOAD_KINDS.map((l) => (
                      <option key={l} value={l}>
                        {LOAD_LABEL[l]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Potência (W)
                  <input
                    aria-label="Potência"
                    inputMode="decimal"
                    value={text.potencia}
                    onChange={(e) => {
                      setText({ ...text, potencia: e.target.value });
                      set({ potencia_W: parseNum(e.target.value) });
                    }}
                  />
                </label>
                <label>
                  cos φ
                  <input
                    aria-label="cos φ"
                    inputMode="decimal"
                    value={text.cos}
                    onChange={(e) => {
                      setText({ ...text, cos: e.target.value });
                      set({ cos_phi: parseNum(e.target.value) });
                    }}
                  />
                </label>
                <label>
                  Comprimento (m)
                  <input
                    aria-label="Comprimento"
                    inputMode="decimal"
                    value={text.comprimento}
                    onChange={(e) => {
                      setText({ ...text, comprimento: e.target.value });
                      set({ comprimento_m: parseNum(e.target.value) });
                    }}
                  />
                </label>
                <label className="span2">
                  Método de instalação
                  <select aria-label="Método" value={input.metodo} onChange={(e) => set({ metodo: e.target.value as InstallMethod })}>
                    {(["B", "A"] as const).map((m) => (
                      <option key={m} value={m}>
                        {METHOD_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Temperatura ambiente
                  <select aria-label="Temperatura" value={input.temperatura_C} onChange={(e) => set({ temperatura_C: Number(e.target.value) })}>
                    {options.temperaturas.map((t) => (
                      <option key={t} value={t}>
                        {t} °C
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Circuitos agrupados (com este)
                  <select
                    aria-label="Circuitos agrupados"
                    value={input.circuitos_agrupados}
                    onChange={(e) => set({ circuitos_agrupados: Number(e.target.value) })}
                  >
                    {groupedOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="span2">
                  Agrupamento
                  <select
                    aria-label="Agrupamento"
                    value={input.agrupamento}
                    onChange={(e) => {
                      const g = e.target.value as GroupingKind;
                      const allowed = options.agrupados[g];
                      set({ agrupamento: g, circuitos_agrupados: allowed.includes(input.circuitos_agrupados) ? input.circuitos_agrupados : allowed.at(-1)! });
                    }}
                  >
                    {(["mesmo_elemento", "tubos_separados"] as const).map((g) => (
                      <option key={g} value={g}>
                        {GROUPING_LABEL[g]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="muted small">U = 230 V. Cobre, isolamento PVC, 2 condutores carregados (quadro 52-C1).</p>
            </section>

            <section className="card" data-testid="calc-result">
              <h2>Resultado</h2>
              {result.ok && (
                <div className="calc-summary">
                  <div>
                    <span className="muted small">Disjuntor</span>
                    <strong data-testid="calc-in">{result.In} A</strong>
                  </div>
                  <div>
                    <span className="muted small">Secção</span>
                    <strong data-testid="calc-s">{fmt(result.seccao!, 1)} mm²</strong>
                  </div>
                  <div>
                    <span className="muted small">Iz corrigida</span>
                    <strong>{fmt(result.Iz!, 1)} A</strong>
                  </div>
                  <div>
                    <span className="muted small">Queda de tensão</span>
                    <strong>{fmt(result.quedaPct!)} %</strong>
                  </div>
                </div>
              )}
              {result.provisional.length > 0 && (
                <p className="warn small" data-testid="calc-provisorio">
                  Provisório — usa valores por aprovar em Parâmetros: {result.provisional.join(", ")}.
                </p>
              )}
              {result.errors.map((e) => (
                <p key={e} className="error small">
                  {e}
                </p>
              ))}
              {result.steps.length > 0 && (
                <table className="table calc-steps">
                  <thead>
                    <tr>
                      <th>Passo</th>
                      <th>Cálculo</th>
                      <th>Resultado</th>
                      <th>Fonte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.steps.map((s) => (
                      <tr key={s.label}>
                        <td>{s.label}</td>
                        <td className="mono small">{s.formula}</td>
                        <td>{s.result}</td>
                        <td className="muted small">{s.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {result.warnings.map((w) => (
                <p key={w} className="muted small">
                  {w}
                </p>
              ))}
            </section>
          </div>
        )}
      </div>
    </Shell>
  );
}
