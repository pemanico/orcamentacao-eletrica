/**
 * Secção "Pontos" do painel do editor (F2): paleta de elementos para a ferramenta Ponto,
 * "Propor pontos" a partir das regras aprovadas, ponto selecionado, validação e aprovação.
 */
import { useCallback, useEffect, useState } from "react";
import {
  canApprove,
  countDiffers,
  pointCounts,
  proposeFloor,
  proposePoints,
  validatePoints,
  type ElectricPoint,
  type FloorState,
  type PointOrigin,
  type RoomTypeInfo,
  type RuleRow,
} from "@orc/core";
import { api } from "../api";
import { RULES_CHANGED } from "../Shell";
import type { Selection } from "./tools";
import { uid } from "./util";
import { FLOOR_EQUIPMENT, elementName } from "./symbols";

const ORIGIN_LABEL: Record<PointOrigin, string> = { auto: "automáticos", ajustado: "ajustados", manual: "à mão" };

/** Defaults por divisão (todas as linhas: as por aprovar contam para os avisos). */
function useDefaults() {
  const [rows, setRows] = useState<RuleRow[] | null>(null);
  const reload = useCallback(() => api.listRules("defaults_divisao").then(setRows, () => setRows([])), []);
  useEffect(() => {
    void reload();
    window.addEventListener(RULES_CHANGED, reload);
    return () => window.removeEventListener(RULES_CHANGED, reload);
  }, [reload]);
  return rows;
}

export function PointsPanel({
  floorId,
  state,
  commit,
  catalog,
  pointElement,
  choosePointElement,
  selPoint,
  select,
  deleteSelection,
  setMessage,
  approvedAt,
  pointsApprovedAt,
  approvePoints,
}: {
  floorId: string;
  state: FloorState;
  commit: (f: (s: FloorState) => FloorState) => void;
  catalog: readonly RoomTypeInfo[];
  pointElement: string | null;
  choosePointElement: (e: string | null) => void;
  selPoint?: ElectricPoint;
  select: (s: NonNullable<Selection>) => void;
  deleteSelection: () => void;
  setMessage: (m: string | null) => void;
  approvedAt: string | null;
  pointsApprovedAt: string | null;
  approvePoints: () => void;
}) {
  const defaults = useDefaults();
  const [summary, setSummary] = useState<string | null>(null);
  const approvedRows = (defaults ?? []).filter((r) => r.state === "aprovada");
  // elementos dos defaults aprovados + equipamentos do piso (quadro, ATI), sempre disponíveis
  const elements = [...new Set([...approvedRows.map((r) => String(r.values.elemento ?? "").trim()).filter(Boolean), ...FLOOR_EQUIPMENT])].sort((a, b) => elementName(a).localeCompare(elementName(b), "pt"));
  const issues = validatePoints(state);
  const roomName = (id: string) => state.rooms.find((r) => r.id === id)?.name ?? "—";
  /** as mensagens do core começam pelo código do elemento: mostra o nome por extenso */
  const readable = (i: { message: string; ref?: string }) => {
    const p = i.ref ? state.points.find((q) => q.id === i.ref) : undefined;
    return p && i.message.startsWith(p.elemento) ? elementName(p.elemento) + i.message.slice(p.elemento.length) : i.message;
  };
  const byOrigin = (o: PointOrigin) => state.points.filter((p) => p.origem === o).length;
  const [onlyDiffs, setOnlyDiffs] = useState(true);
  // contagens: regras aprovadas (proposta) vs pontos na planta, por divisão e elemento
  let counts: ReturnType<typeof pointCounts> = [];
  if (defaults && state.scale) {
    try {
      counts = pointCounts(state, proposeFloor(state, defaults, catalog));
    } catch {
      counts = [];
    }
  }
  const diffs = counts.filter(countDiffers);
  const shownCounts = onlyDiffs ? diffs : counts;

  const propose = () => {
    if (!defaults) return;
    try {
      const proposals = proposeFloor(state, defaults, catalog);
      const diff = proposePoints(state, proposals, uid);
      commit((s) => ({ ...s, points: diff.points }));
      const noRules = proposals.filter((p) => p.typesWithoutRules.length > 0).map((p) => p.roomName);
      const pending = proposals.reduce((n, p) => n + p.pending.length, 0);
      setSummary(
        [
          `${diff.added} propostos · ${diff.removed} substituídos · ${diff.kept} mantidos`,
          noRules.length ? `sem regras aprovadas: ${noRules.join(", ")}` : "",
          pending ? `${pending} regra(s) por aprovar não contaram` : "",
        ]
          .filter(Boolean)
          .join(". ") + ".",
      );
      setMessage(null);
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  return (
    <section className="points-panel">
      <h3>Pontos ({state.points.length})</h3>
      {defaults && approvedRows.length === 0 && <p className="warn">Sem defaults por divisão aprovados: aprova-os em Regras.</p>}
      <label>
        Elemento a colocar
        <select aria-label="Elemento a colocar" value={pointElement ?? ""} onChange={(e) => choosePointElement(e.target.value || null)}>
          <option value="">—</option>
          {elements.map((el) => (
            <option key={el} value={el}>
              {elementName(el)}
            </option>
          ))}
        </select>
      </label>
      <button onClick={propose} disabled={!defaults || !state.scale || state.rooms.length === 0} title="Substitui os pontos propostos que não mexeste; mantém os ajustados e os postos à mão">
        Propor pontos
      </button>
      {summary && (
        <p className="muted" data-testid="points-summary">
          {summary}
        </p>
      )}
      {state.points.length > 0 && (
        <p className="muted">{(["auto", "ajustado", "manual"] as const).map((o) => `${byOrigin(o)} ${ORIGIN_LABEL[o]}`).join(" · ")}</p>
      )}

      {state.points.length > 0 && (
        <div className="counts" data-testid="counts">
          <h4>Contagens por divisão</h4>
          <p className={diffs.length ? "warn" : "ok"}>
            {diffs.length ? `${diffs.length} diferença(s) entre as regras e a planta.` : "Tudo de acordo com as regras."}
          </p>
          <label className="check">
            <input type="checkbox" checked={onlyDiffs} onChange={(e) => setOnlyDiffs(e.target.checked)} /> Só diferenças
          </label>
          {shownCounts.length > 0 && (
            <table className="table compact">
              <thead>
                <tr>
                  <th>Elemento</th>
                  <th className="num" title="Quantidade pedida pelas regras aprovadas">Regras</th>
                  <th className="num" title="Pontos na planta">Planta</th>
                  <th className="num">Δ</th>
                </tr>
              </thead>
              <tbody>
                {shownCounts.flatMap((r, i) => {
                  const d = r.colocado - r.previsto;
                  const row = (
                    <tr key={r.roomId + r.elemento} className={countDiffers(r) ? "diff" : ""}>
                      <td>{elementName(r.elemento)}</td>
                      <td className="num">{r.equipamento ? "—" : r.previsto}</td>
                      <td className="num">{r.colocado}</td>
                      <td className="num">{r.equipamento || d === 0 ? "" : d > 0 ? `+${d}` : String(d)}</td>
                    </tr>
                  );
                  // nome da divisão uma vez, antes das suas linhas
                  return i === 0 || shownCounts[i - 1]!.roomId !== r.roomId
                    ? [
                        <tr key={`h-${r.roomId}`} className="group">
                          <td colSpan={4}>{r.roomName}</td>
                        </tr>,
                        row,
                      ]
                    : [row];
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selPoint && (
        <div className="selection">
          <h3>Ponto</h3>
          <p>
            {elementName(selPoint.elemento)} · {roomName(selPoint.roomId)} <span className="muted">· {ORIGIN_LABEL[selPoint.origem]}</span>
          </p>
          <button className="danger" onClick={deleteSelection}>
            Apagar ponto
          </button>
        </div>
      )}

      {state.points.length > 0 && issues.length > 0 && (
        <ul className="issues">
          {issues.map((i, n) => (
            <li key={n} className={i.level} onClick={() => i.ref && select({ kind: "point", id: i.ref })}>
              {readable(i)}
            </li>
          ))}
        </ul>
      )}
      {pointsApprovedAt ? (
        <>
          <p className="ok">Pontos aprovados em {new Date(pointsApprovedAt).toLocaleString("pt-PT")}. Mexer nos pontos ou na planta retira a aprovação.</p>
          <a className="button" href={`#/piso/${floorId}/planta-pontos`}>
            Planta de pontos (imprimir)
          </a>
        </>
      ) : (
        <>
          {!approvedAt && state.points.length > 0 && <p className="muted">Aprova primeiro a planta do piso.</p>}
          <button className="primary" disabled={!approvedAt || !canApprove(issues)} onClick={approvePoints}>
            Aprovar pontos
          </button>
        </>
      )}
    </section>
  );
}
