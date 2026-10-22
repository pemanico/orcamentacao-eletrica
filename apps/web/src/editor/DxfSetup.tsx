import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  METERS_PER_DXF_UNIT,
  defaultVisibleLayer,
  distinctiveLayers,
  findPlanCandidates,
  guessRoomType,
  guessUnits,
  inRegion,
  looksLikeRoomName,
  normalizeRegion,
  type DxfDrawing,
  type DxfUnit,
  type Point,
  type Region,
} from "@orc/core";
import { overviewSvg, thumbnailSvg } from "../dxfPlan";
import { formatM } from "./draw";

const UNIT_LABEL: Record<DxfUnit, string> = { m: "metros", cm: "centímetros", mm: "milímetros" };
const HEADER_LABEL: Record<number, string> = { 1: "polegadas", 2: "pés", 4: "milímetros", 5: "centímetros", 6: "metros" };

/**
 * Passo 1 de um piso DXF: o ficheiro é o projeto inteiro (implantação, várias versões,
 * alçados…). Aqui escolhe-se a planta com um retângulo e confirmam-se as unidades.
 */
export function DxfSetup({
  drawing,
  initial,
  onConfirm,
  onCancel,
}: {
  drawing: DxfDrawing;
  initial?: { region: Region; unit: DxfUnit } | null;
  onConfirm: (region: Region, unit: DxfUnit) => Promise<void>;
  onCancel?: () => void;
}) {
  const hidden = useMemo(() => new Set(drawing.layers.filter((l) => !defaultVisibleLayer(l.name)).map((l) => l.name)), [drawing]);
  const ov = useMemo(() => overviewSvg(drawing, hidden), [drawing, hidden]);
  useEffect(() => () => URL.revokeObjectURL(ov.url), [ov.url]);

  // plantas de piso encontradas pelos nomes das divisões (o resto é implantação, alçados, cortes)
  const isRoom = (t: string) => looksLikeRoomName(t) && guessRoomType(t) !== null;
  const candidates = useMemo(() => {
    const c = findPlanCandidates(drawing, isRoom);
    const diff = distinctiveLayers(drawing, c.map((x) => x.region));
    return c.map((x, i) => ({ ...x, diff: diff[i] ?? [], thumb: thumbnailSvg(drawing, x.region) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const [rect, setRect] = useState<{ a: Point; b: Point } | null>(null); // em unidades da vista geral
  const [drag, setDrag] = useState<{ mode: "draw" | "pan"; start: Point; tx: number; ty: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // conversões vista geral ↔ DXF
  const toDxf = (p: Point): Point => ({ x: ov.minX + p.x / ov.scale, y: ov.maxY - p.y / ov.scale });
  const fromDxf = (p: Point): Point => ({ x: (p.x - ov.minX) * ov.scale, y: (ov.maxY - p.y) * ov.scale });

  const region: Region | null = rect ? normalizeRegion(toDxf(rect.a), toDxf(rect.b)) : null;
  const guess = useMemo(() => guessUnits(drawing, region ?? undefined), [drawing, region?.minX, region?.minY, region?.maxX, region?.maxY]);
  const [unit, setUnit] = useState<DxfUnit | null>(initial?.unit ?? null);
  const effUnit = unit ?? guess.unit;

  const fit = () => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const k = Math.min(width / ov.width, height / ov.height) * 0.95;
    setView({ k, tx: (width - ov.width * k) / 2, ty: (height - ov.height * k) / 2 });
  };
  useEffect(() => {
    fit();
    if (initial?.region) setRect({ a: fromDxf({ x: initial.region.minX, y: initial.region.maxY }), b: fromDxf({ x: initial.region.maxX, y: initial.region.minY }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ov.url]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(500, Math.max(0.02, v.k * Math.pow(1.0015, -e.deltaY)));
        return { k, tx: mx - ((mx - v.tx) / v.k) * k, ty: my - ((my - v.ty) / v.k) * k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.tx) / view.k, y: (e.clientY - r.top - view.ty) / view.k };
  };

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    svgRef.current!.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      setDrag({ mode: "pan", start: { x: e.clientX, y: e.clientY }, tx: view.tx, ty: view.ty });
      return;
    }
    const p = toLocal(e);
    setRect({ a: p, b: p });
    setDrag({ mode: "draw", start: p, tx: 0, ty: 0 });
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (drag.mode === "pan") setView((v) => ({ ...v, tx: drag.tx + e.clientX - drag.start.x, ty: drag.ty + e.clientY - drag.start.y }));
    else setRect({ a: drag.start, b: toLocal(e) });
  };
  const onUp = () => {
    setDrag(null);
    if (rect && Math.abs(rect.a.x - rect.b.x) * view.k < 8 && Math.abs(rect.a.y - rect.b.y) * view.k < 8) setRect(null);
  };

  const roomsInRegion = region ? drawing.texts.filter((t) => isRoom(t.text) && inRegion(t.at, region)).length : 0;

  /** Seleciona uma planta encontrada e centra a vista nela. */
  const pick = (r: Region) => {
    const a = fromDxf({ x: r.minX, y: r.maxY });
    const b = fromDxf({ x: r.maxX, y: r.minY });
    setRect({ a, b });
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const w = b.x - a.x;
    const h = b.y - a.y;
    const k = Math.min(width / w, height / h) * 0.8;
    setView({ k, tx: width / 2 - (a.x + w / 2) * k, ty: height / 2 - (a.y + h / 2) * k });
  };

  const widthM = region ? (region.maxX - region.minX) * METERS_PER_DXF_UNIT[effUnit] : 0;
  const heightM = region ? (region.maxY - region.minY) * METERS_PER_DXF_UNIT[effUnit] : 0;
  const sizeWarning = region && (Math.max(widthM, heightM) > 150 || Math.max(widthM, heightM) < 4);

  return (
    <div className="dxf-setup">
      <main className="canvas-wrap" ref={wrapRef}>
        <div className="tool-hint">
          <span>
            <strong>Escolher a planta:</strong> o DXF tem o projeto inteiro (implantação, alçados, cortes…).{" "}
            {candidates.length > 0
              ? "Escolhe à direita uma das plantas encontradas, ou arrasta um retângulo."
              : "Arrasta um retângulo à volta da planta do piso."}{" "}
            Roda do rato para zoom, Shift + arrastar (ou botão direito) para mover.
          </span>
        </div>
        <svg
          ref={svgRef}
          className="canvas"
          style={{ cursor: drag?.mode === "pan" ? "grabbing" : "crosshair" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
            <image href={ov.url} width={ov.width} height={ov.height} />
            {candidates.map((c, i) => {
              const a = fromDxf({ x: c.region.minX, y: c.region.maxY });
              const b = fromDxf({ x: c.region.maxX, y: c.region.minY });
              return (
                <g key={i} className="candidate-mark">
                  <rect x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} strokeWidth={1.5 / view.k} />
                  <text x={a.x} y={a.y - 4 / view.k} fontSize={14 / view.k}>
                    {i + 1}
                  </text>
                </g>
              );
            })}
            {rect && (
              <rect
                className="region-rect"
                x={Math.min(rect.a.x, rect.b.x)}
                y={Math.min(rect.a.y, rect.b.y)}
                width={Math.abs(rect.a.x - rect.b.x)}
                height={Math.abs(rect.a.y - rect.b.y)}
                strokeWidth={2 / view.k}
              />
            )}
          </g>
        </svg>
      </main>
      <aside className="panel">
        <section>
          <h3>Ficheiro</h3>
          <p>
            {drawing.segments.length.toLocaleString("pt-PT")} linhas · {drawing.layers.length} layers · {drawing.texts.length.toLocaleString("pt-PT")}{" "}
            textos
          </p>
          {hidden.size > 0 && <p className="muted small">Escondidas na vista geral: {hidden.size} layers de tramas, topografia, folha…</p>}
        </section>
        {candidates.length > 0 && (
          <section>
            <h3>Plantas encontradas ({candidates.length})</h3>
            <p className="muted small">Encontradas pelos nomes das divisões. Escolhe a versão que vai ser construída.</p>
            <div className="candidates">
              {candidates.map((c, i) => (
                <button key={i} className="candidate" onClick={() => pick(c.region)} aria-label={`Planta ${i + 1}`}>
                  <img src={c.thumb} alt="" />
                  <span className="cand-title">
                    Planta {i + 1} · {c.rooms.length} divisões
                  </span>
                  <span className="muted small">{c.rooms.slice(0, 4).join(", ")}…</span>
                  {c.diff.length > 0 && (
                    <span className="cand-diff">
                      {c.diff.some((l) => /demolir|construir/i.test(l)) ? "alterações · " : ""}
                      {c.diff.map((l) => l.replace(/^arq_/, "")).join(", ")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}
        <section>
          <h3>Planta escolhida</h3>
          {region ? (
            <p data-testid="region-size">
              {formatM(widthM)} × {formatM(heightM)} m
            </p>
          ) : (
            <p className="muted">Arrasta um retângulo à volta da planta.</p>
          )}
          {sizeWarning && <p className="warn">Medida pouco provável para uma planta de habitação: confirma as unidades.</p>}
          {region && roomsInRegion === 0 && (
            <p className="warn" data-testid="no-rooms">
              Esta zona não tem nomes de divisões: deve ser a implantação, um alçado ou um corte, e não terá paredes interiores.
              {candidates.length > 0 ? " Escolhe uma das plantas encontradas." : ""}
            </p>
          )}
          {region && roomsInRegion > 0 && <p className="muted small">{roomsInRegion} nomes de divisões dentro da zona.</p>}
        </section>
        <section>
          <h3>Unidades do desenho</h3>
          <select aria-label="Unidades do desenho" value={effUnit} onChange={(e) => setUnit(e.target.value as DxfUnit)}>
            {(["m", "cm", "mm"] as const).map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u]}
              </option>
            ))}
          </select>
          {unit === null && guess.basis === "cotas" && (
            <p className="muted small">
              Deduzido das cotas do desenho (mediana {guess.medianDimension?.toLocaleString("pt-PT", { maximumFractionDigits: 2 })}).
            </p>
          )}
          {guess.headerDisagrees && drawing.headerUnits !== null && (
            <p className="warn small">
              O cabeçalho do ficheiro diz {HEADER_LABEL[drawing.headerUnits] ?? `código ${drawing.headerUnits}`}, mas as cotas indicam{" "}
              {UNIT_LABEL[guess.unit]}. Confirma pela medida da planta acima.
            </p>
          )}
        </section>
        <section>
          {error && <p className="error">{error}</p>}
          <div className="row">
            {onCancel && (
              <button type="button" onClick={onCancel}>
                Cancelar
              </button>
            )}
            <button
              className="primary"
              disabled={!region || busy}
              onClick={async () => {
                if (!region) return;
                setBusy(true);
                setError(null);
                try {
                  await onConfirm(region, effUnit);
                } catch (e) {
                  setError((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              Usar esta planta
            </button>
          </div>
          <button className="small-btn" type="button" onClick={fit}>
            Ver tudo
          </button>
        </section>
      </aside>
    </div>
  );
}
