import {
  dxfToPage,
  looksLikeRoomName,
  segmentTouchesRegion,
  inRegion,
  type DxfDrawing,
  type DxfSourceMeta,
  type PlanLabel,
  type Region,
  type Segment,
} from "@orc/core";
import type { LoadedPlan } from "./pdf";

export interface DxfLayerRow {
  name: string;
  segments: number;
  texts: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Camadas que têm alguma coisa dentro da região. */
export function layersInRegion(d: DxfDrawing, region: Region): DxfLayerRow[] {
  const m = new Map<string, DxfLayerRow>();
  const row = (n: string) => m.get(n) ?? m.set(n, { name: n, segments: 0, texts: 0 }).get(n)!;
  for (const s of d.segments) if (segmentTouchesRegion(s, region)) row(s.layer).segments++;
  for (const t of d.texts) if (inRegion(t.at, region)) row(t.layer).texts++;
  return [...m.values()].sort((a, b) => b.segments + b.texts - (a.segments + a.texts));
}

/**
 * Constrói o "plano" que o editor usa a partir do DXF: fundo vetorial (SVG) com as layers
 * visíveis, segmentos de snap só das layers escolhidas e os nomes das divisões.
 */
export function buildDxfPlan(d: DxfDrawing, meta: DxfSourceMeta): LoadedPlan & { labels: PlanLabel[] } {
  const t = dxfToPage(meta.region, meta.unit);
  const hidden = new Set(meta.hidden);
  const snap = new Set(meta.snap);
  const paths = new Map<string, string[]>();
  const snapSegments: Segment[] = [];

  for (const s of d.segments) {
    if (!segmentTouchesRegion(s, meta.region)) continue;
    const a = t.toPage(s.a);
    const b = t.toPage(s.b);
    if (snap.has(s.layer)) snapSegments.push({ a: { x: r2(a.x), y: r2(a.y) }, b: { x: r2(b.x), y: r2(b.y) } });
    if (hidden.has(s.layer)) continue;
    const list = paths.get(s.layer) ?? paths.set(s.layer, []).get(s.layer)!;
    list.push(`M${r2(a.x)} ${r2(a.y)}L${r2(b.x)} ${r2(b.y)}`);
  }

  const labels: PlanLabel[] = [];
  const textEls: string[] = [];
  for (const x of d.texts) {
    if (!inRegion(x.at, meta.region)) continue;
    const p = t.toPage(x.at);
    // o ponto de inserção é o canto do texto: o centro aproximado fica mais dentro da divisão
    const h = x.height * t.k;
    const c = { x: p.x + (x.text.length * h * 0.5) / 2, y: p.y - h / 2 };
    if (looksLikeRoomName(x.text)) labels.push({ text: x.text, at: c });
    if (!hidden.has(x.layer)) {
      // tamanho mínimo legível: os textos das plantas costumam ter 15–25 cm, pequenos para o ecrã
      textEls.push(`<text x="${r2(p.x)}" y="${r2(p.y)}" font-size="${r2(Math.max(h * 1.4, 7))}">${esc(x.text)}</text>`);
    }
  }

  const layerEls = [...paths].map(([layer, segs]) => {
    const strong = snap.has(layer);
    return `<path data-layer="${esc(layer)}" d="${segs.join("")}" stroke="${strong ? "#26324a" : "#9aa3b0"}" stroke-width="${strong ? 0.9 : 0.4}"/>`;
  });
  const W = r2(t.width);
  const H = r2(t.height);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="100%" height="100%" fill="#fff"/>` +
    `<g fill="none" stroke-linecap="round">${layerEls.join("")}</g>` +
    `<g fill="#3d4757" font-family="Arial, sans-serif">${textEls.join("")}</g>` +
    `</svg>`;

  return {
    width: t.width,
    height: t.height,
    imageUrl: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
    renderScale: 1,
    segments: snapSegments,
    verdict: { ok: true, segmentCount: snapSegments.length },
    stampDenominators: [],
    pageCount: 1,
    labels,
  };
}

/** Vista geral do desenho inteiro (para escolher a região): SVG em coordenadas do DXF, y invertido. */
export function overviewSvg(
  d: DxfDrawing,
  hidden: Set<string>,
): { url: string; width: number; height: number; minX: number; maxY: number; scale: number } {
  const e = d.extents!;
  const W = e.maxX - e.minX || 1;
  const H = e.maxY - e.minY || 1;
  // normaliza para ~4000 unidades de largura (precisão suficiente em SVG)
  const s = 4000 / Math.max(W, H);
  const byLayer = new Map<string, string[]>();
  for (const seg of d.segments) {
    if (hidden.has(seg.layer)) continue;
    const list = byLayer.get(seg.layer) ?? byLayer.set(seg.layer, []).get(seg.layer)!;
    list.push(
      `M${r2((seg.a.x - e.minX) * s)} ${r2((e.maxY - seg.a.y) * s)}L${r2((seg.b.x - e.minX) * s)} ${r2((e.maxY - seg.b.y) * s)}`,
    );
  }
  const vw = r2(W * s);
  const vh = r2(H * s);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}">` +
    `<rect width="100%" height="100%" fill="#fff"/><g fill="none" stroke="#5b6472" stroke-width="0.6">` +
    [...byLayer.values()].map((l) => `<path d="${l.join("")}"/>`).join("") +
    `</g></svg>`;
  return { url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })), width: vw, height: vh, minX: e.minX, maxY: e.maxY, scale: s };
}
