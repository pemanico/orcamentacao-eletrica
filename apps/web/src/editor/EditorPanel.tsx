import type { ReactNode } from "react";
import {
  areaUnitsToM2,
  canApprove,
  dist,
  effectiveDenominator,
  polygonArea,
  polygonPerimeter,
  roomTypeShort,
  unitsToMeters,
  type FloorState,
  type Issue,
  type Opening,
  type Room,
  type ScaleCalibration,
  type ScaleCheck,
  type Wall,
} from "@orc/core";
import { roomColor, useRoomTypes } from "../roomTypes";
import { NumberField, TypePicker } from "./dialogs";
import { formatM } from "./draw";
import type { Selection, Tool } from "./tools";

type Meta = { name: string; ceilingHeightM: number };

/** Painel lateral do editor: piso, escala, elemento selecionado, divisões, validação e aprovação. */
export function EditorPanel({
  sourcePanel,
  meta,
  setMeta,
  isDxf,
  sourceUnit,
  scale,
  scaleCheck,
  stampDenominators,
  selectTool,
  select,
  selWall,
  selOpening,
  selRoom,
  updateWall,
  updateOpening,
  updateRoom,
  deleteSelection,
  roomTypes,
  state,
  issues,
  approvedAt,
  approve,
}: {
  sourcePanel?: ReactNode;
  meta: Meta;
  setMeta: (m: Meta) => void;
  isDxf: boolean;
  sourceUnit: string;
  scale: ScaleCalibration | null;
  scaleCheck: ScaleCheck | null;
  stampDenominators: number[];
  selectTool: (t: Tool) => void;
  /** muda para Selecionar e seleciona o elemento */
  select: (s: NonNullable<Selection>) => void;
  selWall?: Wall;
  selOpening?: Opening;
  selRoom?: Room;
  updateWall: (id: string, patch: Partial<Wall>) => void;
  updateOpening: (id: string, patch: Partial<Opening>) => void;
  updateRoom: (id: string, patch: Partial<Room>) => void;
  deleteSelection: () => void;
  roomTypes: ReturnType<typeof useRoomTypes>;
  state: FloorState;
  issues: Issue[];
  approvedAt: string | null;
  approve: () => void;
}) {
  return (
  <aside className="panel">
    {sourcePanel}
    <section>
      <h3>Piso</h3>
      <label>
        Nome
        <input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
      </label>
      <NumberField
        label="Pé-direito (m)"
        value={meta.ceilingHeightM}
        min={2}
        max={6}
        onCommit={(v) => setMeta({ ...meta, ceilingHeightM: v })}
      />
    </section>

    <section>
      <h3>Escala</h3>
      {isDxf && scale ? (
        <p className="compact-row">
          <span>
            Exata, do DXF <span className="muted">· unidades: {sourceUnit}</span>
          </span>
        </p>
      ) : scale && (!scaleCheck || scaleCheck.ok) ? (
        <div className="compact-row">
          <span>
            1:{Math.round(effectiveDenominator(scale))} <span className="muted">· cota {formatM(scale.refMeters)} m</span>
            {scaleCheck && <span className="ok"> · Confere com o carimbo 1:{scaleCheck.stampDenominator}.</span>}
          </span>
          <button className="small-btn" onClick={() => selectTool("calibrar")}>
            Recalibrar
          </button>
        </div>
      ) : scale && scaleCheck ? (
        <>
          <p className="warn">
            O carimbo diz 1:{scaleCheck.stampDenominator}, mas a calibração dá 1:{Math.round(scaleCheck.effectiveDenominator)} (
            {Math.round(scaleCheck.relativeDiff * 100)}% de diferença). O PDF foi provavelmente impresso com "ajustar à página".
            Vale a calibração; confirma com uma segunda cota.
          </p>
          <button onClick={() => selectTool("calibrar")}>Recalibrar</button>
        </>
      ) : (
        <>
          <p className="warn">Por calibrar. Usa a ferramenta Calibrar numa cota longa.</p>
          {stampDenominators.length > 0 && (
            <p className="muted">Carimbo do PDF: {stampDenominators.map((d) => `1:${d}`).join(", ")}</p>
          )}
        </>
      )}
    </section>

    {selWall && scale && (
      <section className="selection">
        <h3>Parede</h3>
        <p>Comprimento: {formatM(unitsToMeters(dist(selWall.a, selWall.b), scale))} m</p>
        <NumberField
          label="Espessura (cm)"
          value={selWall.thicknessM * 100}
          min={5}
          max={80}
          onCommit={(v) => updateWall(selWall.id, { thicknessM: v / 100 })}
        />
        <button className="danger" onClick={deleteSelection}>
          Apagar parede
        </button>
      </section>
    )}

    {selOpening && (
      <section className="selection">
        <h3>{selOpening.kind === "porta" ? "Porta" : "Janela"}</h3>
        <NumberField
          label="Largura (m)"
          value={selOpening.widthM}
          min={0.3}
          max={6}
          onCommit={(v) => updateOpening(selOpening.id, { widthM: v })}
        />
        {selOpening.kind === "porta" && (
          <div className="row">
            <button onClick={() => updateOpening(selOpening.id, { swing: selOpening.swing === "esquerda" ? "direita" : "esquerda" })}>
              Inverter abertura (F)
            </button>
            <button onClick={() => updateOpening(selOpening.id, { hinge: selOpening.hinge === "inicio" ? "fim" : "inicio" })}>
              Inverter dobradiça (H)
            </button>
          </div>
        )}
        <button className="danger" onClick={deleteSelection}>
          Apagar
        </button>
      </section>
    )}

    {selRoom && (
      <section className="selection">
        <h3>Divisão</h3>
        <label>
          Nome
          <input value={selRoom.name} onChange={(e) => updateRoom(selRoom.id, { name: e.target.value })} />
        </label>
        <TypePicker value={selRoom.types} onChange={(types) => updateRoom(selRoom.id, { types })} catalog={roomTypes.catalog} onCreate={roomTypes.create} />
        {scale && (
          <p>
            Área {formatM(areaUnitsToM2(polygonArea(selRoom.polygon), scale))} m² · perímetro{" "}
            {formatM(unitsToMeters(polygonPerimeter(selRoom.polygon), scale))} m
          </p>
        )}
        <button className="danger" onClick={deleteSelection}>
          Apagar divisão
        </button>
      </section>
    )}

    <section>
      <h3>Divisões ({state.rooms.length})</h3>
      {state.rooms.length === 0 ? (
        <p className="muted">Nenhuma. Usa a ferramenta Divisão.</p>
      ) : (
        <table className="table compact">
          <tbody>
            {state.rooms.map((r) => (
              <tr
                key={r.id}
                className={`clickable ${selRoom?.id === r.id ? "active" : ""}`}
                onClick={() => select({ kind: "room", id: r.id })}
              >
                <td>
                  <span className="swatch" style={{ background: roomColor(r.types[0], roomTypes.catalog) }} />
                  {r.name}
                </td>
                <td className="muted">{r.types.map((t) => roomTypeShort(roomTypes.catalog, t)).join(" + ")}</td>
                <td className="num">{scale ? `${formatM(areaUnitsToM2(polygonArea(r.polygon), scale))} m²` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted">
        {state.walls.length} paredes · {state.openings.filter((o) => o.kind === "porta").length} portas ·{" "}
        {state.openings.filter((o) => o.kind === "janela").length} janelas
      </p>
    </section>

    <section>
      <h3>Validação</h3>
      {issues.length === 0 ? (
        <p className="ok">Sem problemas.</p>
      ) : (
        <ul className="issues">
          {issues.map((i, n) => (
            <li
              key={n}
              className={i.level}
              onClick={() => {
                const ref = i.ref;
                if (!ref) return;
                const kind = state.walls.some((w) => w.id === ref) ? "wall" : state.rooms.some((r) => r.id === ref) ? "room" : "opening";
                select({ kind, id: ref });
              }}
            >
              {i.message}
            </li>
          ))}
        </ul>
      )}
      {approvedAt ? (
        <p className="ok">Aprovado em {new Date(approvedAt).toLocaleString("pt-PT")}. Qualquer alteração retira a aprovação.</p>
      ) : (
        <button className="primary" disabled={!canApprove(issues)} onClick={approve}>
          Aprovar piso
        </button>
      )}
    </section>
  </aside>
  );
}
