import { dist, projectOnSegment } from "./geometry";
import type { Point, Segment } from "./types";

export type SnapKind = "extremo" | "meio" | "segmento" | "livre";

export interface SnapResult {
  point: Point;
  kind: SnapKind;
  /** segmento a que o ponto foi atraído, se aplicável */
  segment?: Segment;
}

/**
 * Índice espacial em grelha para atrair o cursor às linhas do PDF.
 * Um PDF de AutoCAD pode ter dezenas de milhares de segmentos; testar todos
 * a cada movimento do rato é lento, por isso só se testam as células vizinhas.
 */
export class SnapIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly endpointCells = new Map<string, Point[]>();
  /** segmentos demasiado longos para a grelha: testados sempre */
  private readonly longSegments: number[] = [];

  constructor(
    readonly segments: Segment[],
    private readonly cellSize = 20,
  ) {
    segments.forEach((s, i) => {
      const minX = Math.floor(Math.min(s.a.x, s.b.x) / cellSize);
      const maxX = Math.floor(Math.max(s.a.x, s.b.x) / cellSize);
      const minY = Math.floor(Math.min(s.a.y, s.b.y) / cellSize);
      const maxY = Math.floor(Math.max(s.a.y, s.b.y) / cellSize);
      // segmentos enormes (molduras) cobririam milhares de células: limitar
      if ((maxX - minX + 1) * (maxY - minY + 1) > 4000) return this.addLong(i, s);
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cy = minY; cy <= maxY; cy++) this.push(this.cells, `${cx},${cy}`, i);
      }
      this.addEndpoint(s.a);
      this.addEndpoint(s.b);
    });
  }

  private addLong(i: number, s: Segment) {
    this.longSegments.push(i);
    this.addEndpoint(s.a);
    this.addEndpoint(s.b);
  }

  private push<T>(map: Map<string, T[]>, key: string, v: T) {
    const arr = map.get(key);
    if (arr) arr.push(v);
    else map.set(key, [v]);
  }

  private addEndpoint(p: Point) {
    const key = `${Math.floor(p.x / this.cellSize)},${Math.floor(p.y / this.cellSize)}`;
    this.push(this.endpointCells, key, p);
  }

  private neighbourKeys(p: Point, radius: number): string[] {
    const r = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(p.x / this.cellSize);
    const cy = Math.floor(p.y / this.cellSize);
    const keys: string[] = [];
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) keys.push(`${cx + dx},${cy + dy}`);
    return keys;
  }

  /**
   * Prioridade: extremos > pontos médios > qualquer ponto de um segmento.
   * `tolerance` está em unidades de página (converter de píxeis de ecrã pelo zoom).
   */
  snap(p: Point, tolerance: number, extraPoints: Point[] = []): SnapResult {
    const keys = this.neighbourKeys(p, tolerance);

    let best: Point | null = null;
    let bestD = tolerance;
    const consider = (q: Point) => {
      const d = dist(p, q);
      if (d <= bestD) {
        bestD = d;
        best = q;
      }
    };
    for (const k of keys) for (const q of this.endpointCells.get(k) ?? []) consider(q);
    for (const q of extraPoints) consider(q);
    if (best) return { point: best, kind: "extremo" };

    const candidates = new Set<number>(this.longSegments);
    for (const k of keys) for (const i of this.cells.get(k) ?? []) candidates.add(i);

    let mid: Point | null = null;
    let midD = tolerance * 0.75;
    let onSeg: SnapResult | null = null;
    let segD = tolerance;
    for (const i of candidates) {
      const s = this.segments[i]!;
      const m = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
      const dm = dist(p, m);
      if (dm <= midD) {
        midD = dm;
        mid = m;
      }
      const proj = projectOnSegment(p, s);
      if (proj.distance <= segD) {
        segD = proj.distance;
        onSeg = { point: proj.point, kind: "segmento", segment: s };
      }
    }
    if (mid) return { point: mid, kind: "meio" };
    if (onSeg) return onSeg;
    return { point: p, kind: "livre" };
  }
}
