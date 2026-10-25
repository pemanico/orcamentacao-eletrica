import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { guessRoomType, labelForPolygon } from "@orc/core";
import {
  SnapIndex,
  areaUnitsToM2,
  calibrate,
  checkAgainstStamp,
  dist,
  metersToUnits,
  polygonArea,
  polygonCentroid,
  projectOnSegment,
  unitsToMeters,
  validateFloor,
  type FloorState,
  type Opening,
  type OpeningKind,
  type Point,
  type Room,
  type SnapResult,
  type Wall,
} from "@orc/core";
import type { Floor } from "../api";
import type { LoadedPlan } from "../pdf";
import { formatM, openingGeometry } from "./draw";
import { roomColor, useRoomTypes } from "../roomTypes";
import { useHistory } from "./useHistory";
import { CalibrationDialog, RoomDialog } from "./dialogs";
import { EditorPanel } from "./EditorPanel";
import { TOOLS, type Selection, type Tool } from "./tools";
import { useAutosave } from "./useAutosave";
import { usePref } from "./usePref";
import { useViewport } from "./useViewport";
import { angleDeg, distToLine, isTyping, uid } from "./util";

type Drag =
  | { kind: "pan"; startX: number; startY: number; tx: number; ty: number; click?: Selection | "none" }
  | { kind: "wall-a" | "wall-b"; id: string }
  | { kind: "room-v"; id: string; index: number };

const SNAP_PX = 10;
const DEFAULT_WALL_T = 0.15;
const DEFAULT_WIDTH: Record<OpeningKind, number> = { porta: 0.8, janela: 1.2 };

export function Editor({
  floor,
  plan,
  sourcePanel,
}: {
  floor: Floor;
  plan: LoadedPlan;
  /** painel da fonte (ex.: layers do DXF), mostrado no topo do painel lateral */
  sourcePanel?: ReactNode;
}) {
  const isDxf = floor.sourceKind === "dxf";
  const { state, commit, undo, redo, canUndo, canRedo } = useHistory<FloorState>(floor.state);
  const [preview, setPreview] = useState<FloorState | null>(null); // estado durante um arrasto
  const shown = preview ?? state;

  const [meta, setMeta] = useState({ name: floor.name, ceilingHeightM: floor.ceilingHeightM });
  const [tool, setTool] = useState<Tool>(floor.state.scale ? "selecionar" : "calibrar");
  const [draft, setDraft] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<SnapResult | null>(null);
  const [hoverWall, setHoverWall] = useState<{ wall: Wall; t: number } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [ortho, setOrtho] = useState(true);
  const [mods, setMods] = useState({ shift: false, alt: false, space: false });
  const [calibDialog, setCalibDialog] = useState<{ a: Point; b: Point } | null>(null);
  const [roomDialog, setRoomDialog] = useState<{ polygon: Point[]; suggestion?: { name: string; type: string | null } } | null>(null);
  const roomTypes = useRoomTypes();
  const [message, setMessage] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = usePref("orc.painel", true);
  const [hintOpen, setHintOpen] = usePref("orc.ajuda", true);

  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const scale = shown.scale;
  const snapIndex = useMemo(() => new SnapIndex(plan.segments), [plan.segments]);
  const extraPoints = useMemo(
    () => [
      ...shown.walls.flatMap((w) => [w.a, w.b]),
      ...shown.rooms.flatMap((r) => r.polygon),
      ...draft,
    ],
    [shown.walls, shown.rooms, draft],
  );
  const issues = useMemo(() => validateFloor(state), [state]);
  const { view, setView, fit, toPage } = useViewport(svgRef, wrapRef, plan);

  // ---------------------------------------------------------------- snap
  const tol = SNAP_PX / view.k;
  const orthoOn = ortho !== mods.shift;

  const snapPoint = (raw: Point, from: Point | null): SnapResult => {
    if (mods.alt) return { point: raw, kind: "livre" };
    const free = snapIndex.snap(raw, tol, extraPoints);
    if (!from || !orthoOn) return free;
    // Um canto real ganha ao orto: assim as paredes diagonais ficam com os extremos certos.
    if (free.kind === "extremo") return free;
    // Linha do PDF que passa pelo ponto anterior (parede diagonal): segue-a em vez de forçar H/V.
    if (free.kind === "segmento" && free.segment && distToLine(from, free.segment) <= tol) return free;
    // orto: fixa o eixo dominante a partir do ponto anterior e usa o snap só no eixo livre
    const horizontal = Math.abs(raw.x - from.x) >= Math.abs(raw.y - from.y);
    const locked = horizontal ? { x: raw.x, y: from.y } : { x: from.x, y: raw.y };
    const s = snapIndex.snap(locked, tol, extraPoints);
    const point = horizontal ? { x: s.point.x, y: from.y } : { x: from.x, y: s.point.y };
    return { point, kind: s.kind };
  };

  const nearestWall = (p: Point): { wall: Wall; t: number } | null => {
    let best: { wall: Wall; t: number; d: number } | null = null;
    for (const w of state.walls) {
      const pr = projectOnSegment(p, w);
      if (pr.distance <= tol * 1.5 && (!best || pr.distance < best.d)) best = { wall: w, t: pr.t, d: pr.distance };
    }
    return best && { wall: best.wall, t: best.t };
  };

  /** Mantém o vão dentro da parede. */
  const clampT = (wall: Wall, t: number, widthM: number) => {
    if (!scale) return t;
    const len = dist(wall.a, wall.b);
    const half = metersToUnits(widthM, scale) / 2 / len;
    return half >= 0.5 ? 0.5 : Math.min(1 - half, Math.max(half, t));
  };

  // ---------------------------------------------------------------- ações
  const cancelDraft = () => {
    setDraft([]);
    setHoverWall(null);
  };

  const selectTool = (t: Tool) => {
    cancelDraft();
    setTool(t);
    setMessage(null);
    if (t !== "selecionar") setSelection(null);
  };

  const finishRoom = (poly: Point[]) => {
    if (poly.length < 3) return setMessage("Uma divisão precisa de pelo menos 3 cantos.");
    // nome do arquiteto que está dentro da divisão (DXF ou PDF)
    const label = labelForPolygon(poly, plan.labels ?? [], roomTypes.custom);
    setRoomDialog({ polygon: poly, suggestion: label ? { name: label.text, type: guessRoomType(label.text, roomTypes.custom) } : undefined });
    setDraft([]);
  };

  const deleteSelection = () => {
    if (!selection) return;
    commit((s) => {
      if (selection.kind === "wall") {
        return {
          ...s,
          walls: s.walls.filter((w) => w.id !== selection.id),
          openings: s.openings.filter((o) => o.wallId !== selection.id),
        };
      }
      if (selection.kind === "opening") return { ...s, openings: s.openings.filter((o) => o.id !== selection.id) };
      return { ...s, rooms: s.rooms.filter((r) => r.id !== selection.id) };
    });
    setSelection(null);
  };

  const updateOpening = (id: string, patch: Partial<Opening>) =>
    commit((s) => ({
      ...s,
      openings: s.openings.map((o) => {
        if (o.id !== id) return o;
        const next = { ...o, ...patch };
        const wall = s.walls.find((w) => w.id === o.wallId);
        return wall ? { ...next, t: clampT(wall, next.t, next.widthM) } : next;
      }),
    }));

  const updateWall = (id: string, patch: Partial<Wall>) =>
    commit((s) => ({ ...s, walls: s.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));

  const updateRoom = (id: string, patch: Partial<Room>) =>
    commit((s) => ({ ...s, rooms: s.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

  // ---------------------------------------------------------------- rato
  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current!;
    const target = e.target as Element;

    const startPan = (click?: Selection | "none") => {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      dragRef.current = { kind: "pan", startX: e.clientX, startY: e.clientY, tx: view.tx, ty: view.ty, click };
    };

    // mover a vista: botão do meio ou espaço, em qualquer ferramenta
    if (e.button === 1 || (mods.space && e.button === 0)) return startPan();
    if (e.button !== 0) return;

    if (tool === "selecionar") {
      const handle = target.closest("[data-handle]");
      if (handle && selection) {
        svg.setPointerCapture(e.pointerId);
        const kind = handle.getAttribute("data-handle") as "wall-a" | "wall-b" | "room-v";
        dragRef.current =
          kind === "room-v"
            ? { kind, id: selection.id, index: Number(handle.getAttribute("data-index")) }
            : { kind, id: selection.id };
        setPreview(state);
        return;
      }
      // arrastar move a vista; um clique sem arrasto seleciona o que estiver por baixo
      const el = target.closest("[data-kind]");
      return startPan(el ? { kind: el.getAttribute("data-kind") as "wall", id: el.getAttribute("data-id")! } : "none");
    }

    const raw = toPage(e.clientX, e.clientY);

    const last = draft[draft.length - 1] ?? null;
    const p = snapPoint(raw, tool === "parede" || tool === "divisao" ? last : null).point;

    if (tool === "calibrar") {
      if (draft.length === 0) setDraft([p]);
      else {
        setCalibDialog({ a: draft[0]!, b: p });
        setDraft([]);
      }
      return;
    }

    if (tool === "parede") {
      if (last && dist(last, p) * view.k < 3) return; // clique repetido no mesmo sítio
      if (last) {
        commit((s) => ({ ...s, walls: [...s.walls, { id: uid(), a: last, b: p, thicknessM: DEFAULT_WALL_T }] }));
      }
      setDraft([p]);
      return;
    }

    if (tool === "divisao") {
      const first = draft[0];
      if (first && draft.length >= 3 && dist(first, p) * view.k <= SNAP_PX) return finishRoom(draft);
      if (last && dist(last, p) * view.k < 3) return;
      setDraft([...draft, p]);
      return;
    }

    if (tool === "porta" || tool === "janela") {
      if (!scale) return setMessage("Calibra a escala antes de colocar portas e janelas.");
      const hit = nearestWall(raw);
      if (!hit) return setMessage("Clica sobre uma parede já traçada.");
      const widthM = DEFAULT_WIDTH[tool];
      const o: Opening = {
        id: uid(),
        kind: tool,
        wallId: hit.wall.id,
        t: clampT(hit.wall, hit.t, widthM),
        widthM,
        hinge: "inicio",
        swing: "esquerda",
      };
      commit((s) => ({ ...s, openings: [...s.openings, o] }));
      setSelection({ kind: "opening", id: o.id });
      setMessage(null);
    }
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag?.kind === "pan") {
      setView((v) => ({ ...v, tx: drag.tx + e.clientX - drag.startX, ty: drag.ty + e.clientY - drag.startY }));
      return;
    }
    const raw = toPage(e.clientX, e.clientY);

    if (drag) {
      const s = snapPoint(raw, null);
      setCursor(s);
      setPreview(() => {
        if (drag.kind === "room-v") {
          return {
            ...state,
            rooms: state.rooms.map((r) =>
              r.id === drag.id ? { ...r, polygon: r.polygon.map((q, i) => (i === drag.index ? s.point : q)) } : r,
            ),
          };
        }
        const end = drag.kind === "wall-a" ? "a" : "b";
        return { ...state, walls: state.walls.map((w) => (w.id === drag.id ? { ...w, [end]: s.point } : w)) };
      });
      return;
    }

    if (tool === "porta" || tool === "janela") {
      setHoverWall(nearestWall(raw));
      setCursor({ point: raw, kind: "livre" });
      return;
    }
    if (tool === "selecionar") {
      setCursor({ point: raw, kind: "livre" });
      return;
    }
    const last = draft[draft.length - 1] ?? null;
    setCursor(snapPoint(raw, tool === "parede" || tool === "divisao" ? last : null));
  };

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    if (drag?.kind === "pan" && drag.click && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) {
      setSelection(drag.click === "none" ? null : drag.click);
      return;
    }
    if (drag && drag.kind !== "pan" && preview) {
      commit(preview);
      setPreview(null);
    }
  };

  const onDoubleClick = () => {
    if (tool === "parede") cancelDraft();
    if (tool === "divisao" && draft.length >= 3) finishRoom(draft);
  };

  // ---------------------------------------------------------------- teclado
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      setMods({ shift: e.shiftKey, alt: e.altKey, space: e.code === "Space" ? true : mods.space });
      if (isTyping(e.target) || calibDialog || roomDialog) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if ((e.ctrlKey || e.metaKey) && k === "y") {
        e.preventDefault();
        return redo();
      }
      if (e.ctrlKey || e.metaKey) return;
      if (e.code === "Space") return e.preventDefault();
      if (e.key === "Escape") {
        if (draft.length) cancelDraft();
        else setSelection(null);
        return;
      }
      if (e.key === "Enter" && tool === "divisao") return finishRoom(draft);
      if ((e.key === "Delete" || e.key === "Backspace") && selection) return deleteSelection();
      const sel = selection?.kind === "opening" ? state.openings.find((o) => o.id === selection.id) : null;
      if (sel && k === "f") return updateOpening(sel.id, { swing: sel.swing === "esquerda" ? "direita" : "esquerda" });
      if (sel && k === "h") return updateOpening(sel.id, { hinge: sel.hinge === "inicio" ? "fim" : "inicio" });
      if (k === "o") return setOrtho((o) => !o);
      if (e.key === "\\" || e.key === "Tab") {
        e.preventDefault();
        return setPanelOpen(!panelOpen);
      }
      if (k === "0") return fit();
      const t = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t) selectTool(t.id);
    };
    const up = (e: KeyboardEvent) =>
      setMods({ shift: e.shiftKey, alt: e.altKey, space: e.code === "Space" ? false : mods.space });
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  // ---------------------------------------------------------------- gravação automática e aprovação
  const { saveStatus, approvedAt, approve } = useAutosave(floor, state, meta, setMessage);

  // ---------------------------------------------------------------- render
  const k = view.k;
  const sw = (px: number) => px / k; // espessura constante em píxeis de ecrã
  const fs = 12 / k;
  const selWall = selection?.kind === "wall" ? shown.walls.find((w) => w.id === selection.id) : undefined;
  const selOpening = selection?.kind === "opening" ? shown.openings.find((o) => o.id === selection.id) : undefined;
  const selRoom = selection?.kind === "room" ? shown.rooms.find((r) => r.id === selection.id) : undefined;
  const lastDraft = draft[draft.length - 1];
  const scaleCheck = scale?.stampDenominator ? checkAgainstStamp(scale, scale.stampDenominator) : null;
  const toolInfo = TOOLS.find((t) => t.id === tool)!;
  const cursorStyle = dragRef.current?.kind === "pan" || mods.space ? "grabbing" : tool === "selecionar" ? "default" : "crosshair";

  return (
    <div className={`editor ${panelOpen ? "" : "panel-closed"}`}>
      <aside className="toolbar" aria-label="Ferramentas">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool ${tool === t.id ? "active" : ""}`}
            onClick={() => selectTool(t.id)}
            title={`${t.label} (${t.key})`}
            disabled={((t.id === "porta" || t.id === "janela") && !scale) || (t.id === "calibrar" && isDxf)}
          >
            <span className="tool-key">{t.key}</span>
            {t.label}
          </button>
        ))}
        <div className="toolbar-sep" />
        <button className={`tool ${ortho ? "active" : ""}`} onClick={() => setOrtho(!ortho)} title="Orto (O)">
          <span className="tool-key">O</span>Orto
        </button>
        <button className="tool" onClick={fit} title="Ajustar ao ecrã (0)">
          <span className="tool-key">0</span>Ajustar
        </button>
        <button className={`tool ${hintOpen ? "active-soft" : ""}`} onClick={() => setHintOpen(!hintOpen)} title="Mostrar/esconder ajuda">
          <span className="tool-key">?</span>Ajuda
        </button>
        <button className="tool" onClick={undo} disabled={!canUndo} title="Anular (Ctrl+Z)">
          ↶ Anular
        </button>
        <button className="tool" onClick={redo} disabled={!canRedo} title="Refazer (Ctrl+Y)">
          ↷ Refazer
        </button>
      </aside>

      <main className="canvas-wrap" ref={wrapRef}>
        {hintOpen && (
          <div className="tool-hint">
            <span>
              <strong>{toolInfo.label}:</strong> {toolInfo.help}
            </span>
            <button className="hint-close" onClick={() => setHintOpen(false)} title="Esconder ajuda (volta no botão ? Ajuda)" aria-label="Esconder ajuda">
              ×
            </button>
          </div>
        )}
        <button
          className="panel-toggle"
          onClick={() => setPanelOpen(!panelOpen)}
          title={panelOpen ? "Esconder painel (Tab)" : "Mostrar painel (Tab)"}
          aria-label={panelOpen ? "Esconder painel" : "Mostrar painel"}
        >
          {panelOpen ? "›" : "‹"}
        </button>
        {message && (
          <div className="toast" role="alert" onClick={() => setMessage(null)}>
            {message}
          </div>
        )}
        <svg
          ref={svgRef}
          className="canvas"
          style={{ cursor: cursorStyle }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setCursor(null)}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => {
            e.preventDefault();
            cancelDraft();
          }}
        >
          <g transform={`translate(${view.tx} ${view.ty}) scale(${k})`}>
            <image href={plan.imageUrl} width={plan.width} height={plan.height} data-bg="1" />

            {shown.rooms.map((r) => {
              const c = polygonCentroid(r.polygon);
              const color = roomColor(r.types[0], roomTypes.catalog);
              const area = scale ? areaUnitsToM2(polygonArea(r.polygon), scale) : null;
              return (
                <g key={r.id} data-kind="room" data-id={r.id} className={tool === "selecionar" ? "pickable" : "inert"}>
                  <polygon
                    points={r.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill={color}
                    fillOpacity={selRoom?.id === r.id ? 0.35 : 0.18}
                    stroke={color}
                    strokeWidth={sw(selRoom?.id === r.id ? 2.5 : 1.5)}
                  />
                  <text x={c.x} y={c.y} fontSize={fs * 1.1} textAnchor="middle" className="room-label">
                    {r.name}
                  </text>
                  {area !== null && (
                    <text x={c.x} y={c.y + fs * 1.3} fontSize={fs * 0.95} textAnchor="middle" className="room-area">
                      {formatM(area)} m²
                    </text>
                  )}
                </g>
              );
            })}

            {shown.walls.map((w) => (
              <g key={w.id} data-kind="wall" data-id={w.id} className={tool === "selecionar" ? "pickable" : "inert"}>
                <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="transparent" strokeWidth={sw(12)} />
                <line
                  x1={w.a.x}
                  y1={w.a.y}
                  x2={w.b.x}
                  y2={w.b.y}
                  className={`wall ${selWall?.id === w.id ? "selected" : ""}`}
                  strokeWidth={sw(selWall?.id === w.id ? 5 : 3.5)}
                />
              </g>
            ))}

            {scale &&
              shown.openings.map((o) => {
                const w = shown.walls.find((x) => x.id === o.wallId);
                const g = w && openingGeometry(w, o, scale);
                if (!g) return null;
                const selected = selOpening?.id === o.id;
                return (
                  <g key={o.id} data-kind="opening" data-id={o.id} className={`opening ${o.kind} ${selected ? "selected" : ""} ${tool === "selecionar" ? "pickable" : "inert"}`}>
                    <line x1={g.j1.x} y1={g.j1.y} x2={g.j2.x} y2={g.j2.y} strokeWidth={sw(7)} className="gap" />
                    <line x1={g.j1.x} y1={g.j1.y} x2={g.j2.x} y2={g.j2.y} strokeWidth={sw(o.kind === "janela" ? 3 : 1)} className="sill" />
                    {g.hinge && g.leafEnd && (
                      <>
                        <line x1={g.hinge.x} y1={g.hinge.y} x2={g.leafEnd.x} y2={g.leafEnd.y} strokeWidth={sw(2)} className="leaf" />
                        <path d={g.arc} fill="none" strokeWidth={sw(1)} strokeDasharray={`${sw(4)} ${sw(3)}`} className="leaf" />
                      </>
                    )}
                  </g>
                );
              })}

            {/* pré-visualização de porta/janela */}
            {scale && hoverWall && (tool === "porta" || tool === "janela") && (() => {
              const o: Opening = {
                id: "preview",
                kind: tool,
                wallId: hoverWall.wall.id,
                t: clampT(hoverWall.wall, hoverWall.t, DEFAULT_WIDTH[tool]),
                widthM: DEFAULT_WIDTH[tool],
                hinge: "inicio",
                swing: "esquerda",
              };
              const g = openingGeometry(hoverWall.wall, o, scale);
              return g ? <line x1={g.j1.x} y1={g.j1.y} x2={g.j2.x} y2={g.j2.y} strokeWidth={sw(7)} className="opening-preview" /> : null;
            })()}

            {/* calibração */}
            {scale && tool === "calibrar" && (
              <g className="calib">
                <line x1={scale.refA.x} y1={scale.refA.y} x2={scale.refB.x} y2={scale.refB.y} strokeWidth={sw(1.5)} strokeDasharray={`${sw(6)} ${sw(4)}`} />
                <text x={(scale.refA.x + scale.refB.x) / 2} y={(scale.refA.y + scale.refB.y) / 2 - fs * 0.6} fontSize={fs} textAnchor="middle">
                  {formatM(scale.refMeters)} m
                </text>
              </g>
            )}

            {/* traçado em curso */}
            {draft.length > 0 && (
              <g className="draft">
                {tool === "divisao" && draft.length > 1 && (
                  <polyline points={draft.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" strokeWidth={sw(2)} />
                )}
                {lastDraft && cursor && (
                  <line x1={lastDraft.x} y1={lastDraft.y} x2={cursor.point.x} y2={cursor.point.y} strokeWidth={sw(2)} strokeDasharray={`${sw(5)} ${sw(4)}`} />
                )}
                {draft.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={sw(i === 0 && tool === "divisao" ? 6 : 4)} />
                ))}
                {lastDraft && cursor && scale && (
                  <text x={(lastDraft.x + cursor.point.x) / 2} y={(lastDraft.y + cursor.point.y) / 2 - fs * 0.5} fontSize={fs} textAnchor="middle" className="draft-len">
                    {formatM(unitsToMeters(dist(lastDraft, cursor.point), scale))} m · {angleDeg(lastDraft, cursor.point)}°
                  </text>
                )}
              </g>
            )}

            {/* pegas de edição */}
            {tool === "selecionar" && selWall &&
              (["a", "b"] as const).map((end) => (
                <circle key={end} data-handle={`wall-${end}`} cx={selWall[end].x} cy={selWall[end].y} r={sw(6)} className="handle" />
              ))}
            {tool === "selecionar" && selRoom &&
              selRoom.polygon.map((p, i) => (
                <circle key={i} data-handle="room-v" data-index={i} cx={p.x} cy={p.y} r={sw(6)} className="handle" />
              ))}

            {/* cursor com snap */}
            {cursor && cursor.kind !== "livre" && (
              <g className={`snap snap-${cursor.kind}`}>
                {cursor.kind === "extremo" ? (
                  <rect x={cursor.point.x - sw(6)} y={cursor.point.y - sw(6)} width={sw(12)} height={sw(12)} fill="none" strokeWidth={sw(2)} />
                ) : cursor.kind === "meio" ? (
                  <polygon
                    points={`${cursor.point.x},${cursor.point.y - sw(7)} ${cursor.point.x + sw(7)},${cursor.point.y + sw(5)} ${cursor.point.x - sw(7)},${cursor.point.y + sw(5)}`}
                    fill="none"
                    strokeWidth={sw(2)}
                  />
                ) : (
                  <circle cx={cursor.point.x} cy={cursor.point.y} r={sw(5)} fill="none" strokeWidth={sw(2)} />
                )}
              </g>
            )}
          </g>
        </svg>

        <footer className="statusbar">
          <span>
            {cursor && scale
              ? `x ${formatM(unitsToMeters(cursor.point.x, scale))} m · y ${formatM(unitsToMeters(cursor.point.y, scale))} m`
              : "—"}
          </span>
          <span>snap: {mods.alt ? "desligado (Alt)" : cursor?.kind ?? "—"}</span>
          <span>orto: {orthoOn ? "ligado" : "desligado"}</span>
          <span>zoom {Math.round(k * 100)}%</span>
          <span className={`save save-${saveStatus.replace(" ", "-")}`}>{saveStatus}</span>
        </footer>
      </main>


      <EditorPanel
        sourcePanel={sourcePanel}
        meta={meta}
        setMeta={setMeta}
        isDxf={isDxf}
        sourceUnit={String((floor.sourceMeta as { unit?: string } | null)?.unit ?? "?")}
        scale={scale}
        scaleCheck={scaleCheck}
        stampDenominators={plan.stampDenominators}
        selectTool={selectTool}
        select={(s) => {
          setTool("selecionar");
          setSelection(s);
        }}
        selWall={selWall}
        selOpening={selOpening}
        selRoom={selRoom}
        updateWall={updateWall}
        updateOpening={updateOpening}
        updateRoom={updateRoom}
        deleteSelection={deleteSelection}
        roomTypes={roomTypes}
        state={state}
        issues={issues}
        approvedAt={approvedAt}
        approve={() => void approve()}
      />

      {calibDialog && (
        <CalibrationDialog
          pair={calibDialog}
          stamps={plan.stampDenominators}
          onCancel={() => setCalibDialog(null)}
          onConfirm={(meters, stamp) => {
            const cal = calibrate(calibDialog.a, calibDialog.b, meters, stamp);
            commit((s) => ({ ...s, scale: cal }));
            setCalibDialog(null);
            setTool("parede");
          }}
        />
      )}

      {roomDialog && (
        <RoomDialog
          suggestion={roomDialog.suggestion}
          catalog={roomTypes.catalog}
          onCreateType={roomTypes.create}
          existingNames={state.rooms.map((r) => r.name)}
          onCancel={() => setRoomDialog(null)}
          onConfirm={(name, types) => {
            const room: Room = { id: uid(), name, types, polygon: roomDialog.polygon };
            commit((s) => ({ ...s, rooms: [...s.rooms, room] }));
            setRoomDialog(null);
          }}
        />
      )}
    </div>
  );
}
