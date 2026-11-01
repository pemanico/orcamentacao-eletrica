/**
 * Planta de pontos para o cliente (F2): A3 horizontal, à escala normalizada em que o piso cabe,
 * com a planta do arquiteto esbatida, divisões, pontos, legenda (elementos usados e quantidades
 * contadas na planta) e carimbo. Imprime-se com o browser ("Guardar como PDF").
 *
 * Só com os pontos aprovados: é o documento que vai para o cliente.
 */
import { useEffect, useState, type ReactNode } from "react";
import { polygonCentroid, type ElectricPoint, type FloorState, type Point } from "@orc/core";
import { api, type Floor, type Project } from "../api";
import { loadFloorPlan } from "../floorPlan";
import type { LoadedPlan } from "../pdf";
import { PointSymbol, elementName } from "../editor/symbols";

/** Folha A3 horizontal (mm) e zona do desenho (à esquerda da coluna da legenda). */
const SHEET = { w: 420, h: 297, margin: 10, side: 95 };
const DRAW = { w: SHEET.w - 2 * SHEET.margin - SHEET.side - 6, h: SHEET.h - 2 * SHEET.margin };
const SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000];
/** símbolos com ~2 mm de raio no papel (no editor, 7 px) */
const SYMBOL_MM_PER_PX = 2 / 7;

interface Extent {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

function extentOf(state: FloorState, marginUnits: number): Extent | null {
  const pts: Point[] = [...state.rooms.flatMap((r) => r.polygon), ...state.walls.flatMap((w) => [w.a, w.b]), ...state.points];
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs) - marginUnits;
  const minY = Math.min(...ys) - marginUnits;
  return { minX, minY, w: Math.max(...xs) + marginUnits - minX, h: Math.max(...ys) + marginUnits - minY };
}

export function PointsMapPage({ floorId }: { floorId: string }) {
  const [floor, setFloor] = useState<Floor | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [plan, setPlan] = useState<LoadedPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const f = await api.getFloor(floorId);
        if (cancelled) return;
        setFloor(f);
        api.getProject(f.projectId).then((p) => !cancelled && setProject(p), () => {});
        const p = await loadFloorPlan(f);
        url = p.imageUrl;
        if (cancelled) return URL.revokeObjectURL(p.imageUrl);
        setPlan(p);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [floorId]);

  const back = (
    <a className="small-btn" href={`#/piso/${floorId}`}>
      ← Voltar ao editor
    </a>
  );
  if (error) return <Message back={back} text={error} />;
  if (!floor) return <Message back={back} text="A carregar…" />;
  const { state } = floor;
  if (!state.scale) return <Message back={back} text="O piso não tem escala." />;
  if (!floor.pointsApprovedAt) return <Message back={back} text="Aprova os pontos no editor (secção Pontos) para gerar a planta de pontos." />;
  if (!plan) return <Message back={back} text="A carregar a planta…" />;

  const mpu = state.scale.metersPerUnit;
  const ext = extentOf(state, 0.6 / mpu)!;
  const [wM, hM] = [ext.w * mpu, ext.h * mpu];
  const den = SCALES.find((d) => (wM * 1000) / d <= DRAW.w && (hM * 1000) / d <= DRAW.h) ?? SCALES[SCALES.length - 1]!;
  const mm = { w: (wM * 1000) / den, h: (hM * 1000) / den };
  const unitsPerMm = den / 1000 / mpu;
  const sw = (px: number) => px * SYMBOL_MM_PER_PX * unitsPerMm;
  const fs = 2.6 * unitsPerMm; // nomes das divisões, 2,6 mm

  const counts = new Map<string, number>();
  for (const p of state.points) counts.set(p.elemento, (counts.get(p.elemento) ?? 0) + 1);
  const legend = [...counts].sort(([a], [b]) => elementName(a).localeCompare(elementName(b), "pt"));
  const today = new Date().toLocaleDateString("pt-PT");

  return (
    <div className="map-page">
      <div className="map-toolbar no-print">
        {back}
        <button className="primary" onClick={() => window.print()}>
          Imprimir / guardar PDF
        </button>
        <span className="muted">A3 horizontal · na janela de impressão, escolhe "Guardar como PDF", tamanho A3 e margens "Nenhuma".</span>
      </div>

      <div className="sheet" data-testid="points-sheet">
        <div className="sheet-drawing">
          <svg
            width={`${mm.w}mm`}
            height={`${mm.h}mm`}
            viewBox={`${ext.minX} ${ext.minY} ${ext.w} ${ext.h}`}
            className="map-svg"
          >
            <image href={plan.imageUrl} width={plan.width} height={plan.height} opacity={0.35} />
            {state.walls.map((w) => (
              <line key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} className="map-wall" strokeWidth={0.5 * unitsPerMm} />
            ))}
            {state.rooms.map((r) => {
              const c = polygonCentroid(r.polygon);
              return (
                <g key={r.id}>
                  <polygon points={r.polygon.map((p) => `${p.x},${p.y}`).join(" ")} className="map-room" strokeWidth={0.25 * unitsPerMm} />
                  <text x={c.x} y={c.y} fontSize={fs} textAnchor="middle" className="map-room-name">
                    {r.name}
                  </text>
                </g>
              );
            })}
            {state.points.map((p: ElectricPoint) => (
              <PointSymbol key={p.id} elemento={p.elemento} x={p.x} y={p.y} sw={sw} />
            ))}
          </svg>
        </div>

        <aside className="sheet-side">
          <section className="map-legend" data-testid="points-legend">
            <h2>Legenda</h2>
            <table>
              <tbody>
                {legend.map(([el, n]) => (
                  <tr key={el}>
                    <td className="legend-symbol">
                      <svg width="12mm" height="8mm" viewBox="-6 -4 12 8">
                        <PointSymbol elemento={el} x={0} y={0} sw={(px) => px * SYMBOL_MM_PER_PX} />
                      </svg>
                    </td>
                    <td>{elementName(el)}</td>
                    <td className="num">{n}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td>Total de pontos</td>
                  <td className="num">{state.points.length}</td>
                </tr>
              </tfoot>
            </table>
            <p className="map-note">Simbologia americana. Quantidades contadas nesta planta.</p>
          </section>

          <section className="map-stamp">
            <h2>Planta de pontos</h2>
            <dl>
              <dt>Projeto</dt>
              <dd>{project?.name ?? "…"}</dd>
              <dt>Cliente</dt>
              <dd>{project?.client || "—"}</dd>
              <dt>Morada</dt>
              <dd>{project?.address || "—"}</dd>
              <dt>Piso</dt>
              <dd>{floor.name}</dd>
              <dt>Escala</dt>
              <dd data-testid="map-scale">1:{den} (A3)</dd>
              <dt>Data</dt>
              <dd>{today}</dd>
              <dt>Pontos aprovados</dt>
              <dd>{new Date(floor.pointsApprovedAt).toLocaleDateString("pt-PT")}</dd>
            </dl>
            <p className="map-note">Documento de orçamentação. Não é projeto elétrico.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Message({ text, back }: { text: string; back: ReactNode }) {
  return (
    <div className="page">
      <p>{back}</p>
      <p className="muted">{text}</p>
    </div>
  );
}
