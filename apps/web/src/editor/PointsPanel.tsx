/**
 * Secção "Pontos" do painel do editor (F2): paleta de elementos para a ferramenta Ponto,
 * "Propor pontos" a partir das regras aprovadas, ponto selecionado, validação e aprovação.
 */
import { useCallback, useEffect, useState } from "react";
import {
  canApprove,
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
  const byOrigin = (o: PointOrigin) => state.points.filter((p) => p.origem === o).length;

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
              {i.message}
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
