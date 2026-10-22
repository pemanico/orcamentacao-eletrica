import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import {
  ROOM_TYPES,
  ROOM_TYPE_LABEL,
  SnapIndex,
  CalibrationError,
  areaUnitsToM2,
  calibrate,
  canApprove,
  checkAgainstStamp,
  dist,
  effectiveDenominator,
  metersToUnits,
  polygonArea,
  polygonCentroid,
  polygonPerimeter,
  projectOnSegment,
  unitsToMeters,
  validateFloor,
  type FloorState,
  type Opening,
  type OpeningKind,
  type Point,
  type Room,
  type RoomType,
  type SnapResult,
  type Wall,
} from "@orc/core";
import { ApiError, api, type Floor } from "../api";
import type { LoadedPlan } from "../pdf";
import { ROOM_COLORS, formatM, openingGeometry } from "./draw";
import { useHistory } from "./useHistory";

type Tool = "selecionar" | "calibrar" | "parede" | "porta" | "janela" | "divisao";

const TOOLS: { id: Tool; label: string; key: string; help: string }[] = [
  { id: "selecionar", label: "Selecionar", key: "V", help: "Clica para selecionar. Arrasta o fundo para mover a vista. Arrasta os pontos de um elemento selecionado para o corrigir. Delete apaga." },
  { id: "calibrar", label: "Calibrar", key: "C", help: "Clica nos dois extremos de uma cota conhecida (a mais longa possível) e indica o valor real." },
  { id: "parede", label: "Parede", key: "W", help: "Clica ponto a ponto ao longo das paredes. Esc ou duplo clique termina. Orto ligado: segmentos horizontais/verticais (Shift inverte)." },
  { id: "porta", label: "Porta", key: "P", help: "Clica sobre uma parede traçada. Depois, com a porta selecionada: F inverte o lado de abertura, H a dobradiça." },
  { id: "janela", label: "Janela", key: "J", help: "Clica sobre uma parede traçada." },
  { id: "divisao", label: "Divisão", key: "D", help: "Clica nos cantos da divisão. Fecha clicando no primeiro ponto ou com Enter. Em open space, desenha uma área e escolhe vários tipos." },
];

type Selection = { kind: "wall" | "opening" | "room"; id: string } | null;
type Drag =
  | { kind: "pan"; startX: number; startY: number; tx: number; ty: number; click?: Selection | "none" }
  | { kind: "wall-a" | "wall-b"; id: string }
  | { kind: "room-v"; id: string; index: number };

type SaveStatus = "guardado" | "por guardar" | "a guardar" | "erro" | "conflito";

const SNAP_PX = 10;
const DEFAULT_WALL_T = 0.15;
const DEFAULT_WIDTH: Record<OpeningKind, number> = { porta: 0.8, janela: 1.2 };

const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const parseNum = (s: string) => Number(s.replace(",", ".").trim());
/** Distância de p à reta (infinita) que contém o segmento. */
const distToLine = (p: Point, s: { a: Point; b: Point }) => {
  const len = dist(s.a, s.b);
  if (len === 0) return dist(p, s.a);
  return Math.abs((s.b.x - s.a.x) * (s.a.y - p.y) - (s.a.x - p.x) * (s.b.y - s.a.y)) / len;
};
/** Ângulo do traço em graus (0–180, sentido anti-horário como numa planta). */
const angleDeg = (a: Point, b: Point) => {
  const d = (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
  return Math.round(((d % 180) + 180) % 180);
};
const isTyping =(t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

export function Editor({ floor, plan }: { floor: Floor; plan: LoadedPlan }) {
  const { state, commit, undo, redo, canUndo, canRedo } = useHistory<FloorState>(floor.state);
  const [preview, setPreview] = useState<FloorState | null>(null); // estado durante um arrasto
  const shown = preview ?? state;

  const [meta, setMeta] = useState({ name: floor.name, ceilingHeightM: floor.ceilingHeightM });
  const [approvedAt, setApprovedAt] = useState(floor.approvedAt);
  const [tool, setTool] = useState<Tool>(floor.state.scale ? "selecionar" : "calibrar");
  const [draft, setDraft] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<SnapResult | null>(null);
  const [hoverWall, setHoverWall] = useState<{ wall: Wall; t: number } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [ortho, setOrtho] = useState(true);
  const [mods, setMods] = useState({ shift: false, alt: false, space: false });
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const [calibDialog, setCalibDialog] = useState<{ a: Point; b: Point } | null>(null);
  const [roomDialog, setRoomDialog] = useState<{ polygon: Point[]; editId?: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("guardado");
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

  // ---------------------------------------------------------------- vista
  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const k = Math.min(width / plan.width, height / plan.height) * 0.95;
    setView({ k, tx: (width - plan.width * k) / 2, ty: (height - plan.height * k) / 2 });
  }, [plan.width, plan.height]);

  useEffect(() => {
    fit();
  }, [fit]);

  const toPage = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.tx) / view.k, y: (clientY - r.top - view.ty) / view.k };
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(60, Math.max(0.05, v.k * Math.pow(1.0015, -e.deltaY)));
        return { k, tx: mx - ((mx - v.tx) / v.k) * k, ty: my - ((my - v.ty) / v.k) * k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

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
    setRoomDialog({ polygon: poly });
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

  // ---------------------------------------------------------------- gravação automática
  const revRef = useRef(floor.rev);
  const latest = useRef({ state, meta });
  latest.current = { state, meta };
  const savedRef = useRef(JSON.stringify({ state: floor.state, meta: { name: floor.name, ceilingHeightM: floor.ceilingHeightM } }));
  const savingRef = useRef(false);
  const againRef = useRef(false);

  const flush = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) {
      againRef.current = true;
      return false;
    }
    const snapshot = JSON.stringify(latest.current);
    if (snapshot === savedRef.current) return true;
    savingRef.current = true;
    setSaveStatus("a guardar");
    let ok = false;
    try {
      const { state: st, meta: m } = latest.current;
      const r = await api.saveFloor(floor.id, { rev: revRef.current, state: st, name: m.name, ceilingHeightM: m.ceilingHeightM });
      revRef.current = r.rev;
      savedRef.current = snapshot;
      setApprovedAt(r.approvedAt);
      ok = true;
    } catch (err) {
      setSaveStatus(err instanceof ApiError && err.status === 409 ? "conflito" : "erro");
      setMessage(`Não foi possível guardar: ${(err as Error).message}`);
      againRef.current = false;
      return false;
    } finally {
      savingRef.current = false;
    }
    if (againRef.current || JSON.stringify(latest.current) !== savedRef.current) {
      againRef.current = false;
      return flush();
    }
    setSaveStatus("guardado");
    return ok;
  }, [floor.id]);

  useEffect(() => {
    if (saveStatus === "conflito") return;
    if (JSON.stringify({ state, meta }) === savedRef.current) return;
    setSaveStatus("por guardar");
    const t = setTimeout(() => void flush(), 700);
    return () => clearTimeout(t);
  }, [state, meta, flush, saveStatus]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(latest.current) !== savedRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const approve = async () => {
    setMessage(null);
    if (!(await flush())) return;
    try {
      const r = await api.approveFloor(floor.id);
      setApprovedAt(r.approvedAt);
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

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
            disabled={(t.id === "porta" || t.id === "janela") && !scale}
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
              const color = ROOM_COLORS[r.types[0] ?? "outro"];
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

      <aside className="panel">
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
          {scale && (!scaleCheck || scaleCheck.ok) ? (
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
              {plan.stampDenominators.length > 0 && (
                <p className="muted">Carimbo do PDF: {plan.stampDenominators.map((d) => `1:${d}`).join(", ")}</p>
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
            <TypePicker value={selRoom.types} onChange={(types) => updateRoom(selRoom.id, { types })} />
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
                    onClick={() => {
                      setTool("selecionar");
                      setSelection({ kind: "room", id: r.id });
                    }}
                  >
                    <td>
                      <span className="swatch" style={{ background: ROOM_COLORS[r.types[0] ?? "outro"] }} />
                      {r.name}
                    </td>
                    <td className="muted">{r.types.map((t) => ROOM_TYPE_LABEL[t].split(" ")[0]).join(" + ")}</td>
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
                    setTool("selecionar");
                    setSelection({ kind, id: ref });
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

// ---------------------------------------------------------------- componentes auxiliares

/** Preferência de interface guardada no browser (painel aberto, ajuda visível). */
function usePref(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : raw === "1";
    } catch {
      return initial;
    }
  });
  const set = (next: boolean) => {
    setV(next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      /* sem armazenamento: fica só nesta sessão */
    }
  };
  return [v, set];
}

/** Campo numérico que aceita vírgula decimal e só grava ao sair/Enter. */
function NumberField({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value).replace(".", ","));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(String(Math.round(value * 1000) / 1000).replace(".", ",")), [value]);
  const commitText = () => {
    const v = parseNum(text);
    if (!Number.isFinite(v) || v < min || v > max) {
      setError(`Entre ${min} e ${max}.`);
      return;
    }
    setError(null);
    if (v !== value) onCommit(v);
  };
  return (
    <label>
      {label}
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {error && <span className="error small">{error}</span>}
    </label>
  );
}

function TypePicker({ value, onChange }: { value: RoomType[]; onChange: (v: RoomType[]) => void }) {
  return (
    <fieldset className="types">
      <legend>Tipo (vários = open space)</legend>
      {ROOM_TYPES.map((t) => (
        <label key={t} className="check">
          <input
            type="checkbox"
            checked={value.includes(t)}
            onChange={(e) => onChange(e.target.checked ? [...value, t] : value.filter((x) => x !== t))}
          />
          <span className="swatch" style={{ background: ROOM_COLORS[t] }} />
          {ROOM_TYPE_LABEL[t]}
        </label>
      ))}
    </fieldset>
  );
}

function Modal({ title, children, onCancel }: { title: string; children: ReactNode; onCancel: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function CalibrationDialog({
  pair,
  stamps,
  onCancel,
  onConfirm,
}: {
  pair: { a: Point; b: Point };
  stamps: number[];
  onCancel: () => void;
  onConfirm: (meters: number, stamp: number | null) => void;
}) {
  const [meters, setMeters] = useState("");
  const [stamp, setStamp] = useState<string>(stamps.length === 1 ? String(stamps[0]) : "");
  const [error, setError] = useState<string | null>(null);
  const units = dist(pair.a, pair.b);
  const suggested = stamp ? (units * 0.0254 * Number(stamp)) / 72 : null;

  const submit = () => {
    try {
      onConfirm(parseNum(meters), stamp ? Number(stamp) : null);
    } catch (e) {
      setError(e instanceof CalibrationError ? e.message : (e as Error).message);
    }
  };

  return (
    <Modal title="Calibrar escala" onCancel={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label>
          Comprimento real da cota (m)
          <input autoFocus inputMode="decimal" value={meters} onChange={(e) => setMeters(e.target.value)} placeholder="ex.: 4,20" />
        </label>
        <label>
          Escala indicada no carimbo (só para conferir)
          <select value={stamp} onChange={(e) => setStamp(e.target.value)}>
            <option value="">Nenhuma / não sei</option>
            {[...new Set([...stamps, 50, 100])].sort((a, b) => a - b).map((d) => (
              <option key={d} value={d}>
                1:{d}
                {stamps.includes(d) ? " (lida no PDF)" : ""}
              </option>
            ))}
          </select>
        </label>
        {suggested !== null && (
          <p className="muted">
            Se o PDF estiver à escala do carimbo, esta medida tem {formatM(suggested)} m.
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row end">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button className="primary" disabled={!meters.trim()}>
            Calibrar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RoomDialog({
  existingNames,
  onCancel,
  onConfirm,
}: {
  existingNames: string[];
  onCancel: () => void;
  onConfirm: (name: string, types: RoomType[]) => void;
}) {
  const [name, setName] = useState("");
  const [types, setTypes] = useState<RoomType[]>([]);
  const duplicate = existingNames.some((n) => n.trim().toLowerCase() === name.trim().toLowerCase());

  return (
    <Modal title="Nova divisão" onCancel={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && types.length) onConfirm(name.trim(), types);
        }}
      >
        <label>
          Nome
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Quarto 1" />
        </label>
        {duplicate && <p className="warn small">Já existe uma divisão com este nome.</p>}
        <TypePicker
          value={types}
          onChange={(t) => {
            setTypes(t);
            if (!name.trim() && t.length === 1) setName(ROOM_TYPE_LABEL[t[0]!].split(" (")[0]!);
          }}
        />
        <div className="row end">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button className="primary" disabled={!name.trim() || types.length === 0}>
            Criar divisão
          </button>
        </div>
      </form>
    </Modal>
  );
}
