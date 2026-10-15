import type { Point, Segment } from "./types";

export const dist = (p: Point, q: Point): number => Math.hypot(p.x - q.x, p.y - q.y);

export const segmentLength = (s: Segment): number => dist(s.a, s.b);

export interface Projection {
  point: Point;
  /** parâmetro ao longo do segmento, limitado a [0, 1] */
  t: number;
  distance: number;
}

/** Ponto do segmento mais próximo de p. */
export function projectOnSegment(p: Point, s: Segment): Projection {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point = { x: s.a.x + t * dx, y: s.a.y + t * dy };
  return { point, t, distance: dist(p, point) };
}

export const pointAt = (s: Segment, t: number): Point => ({
  x: s.a.x + (s.b.x - s.a.x) * t,
  y: s.a.y + (s.b.y - s.a.y) * t,
});

/** Área (sempre positiva) de um polígono simples, fórmula de Gauss. */
export function polygonArea(poly: Point[]): number {
  if (poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeter(poly: Point[]): number {
  if (poly.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    sum += dist(poly[i]!, poly[(i + 1) % poly.length]!);
  }
  return sum;
}

export function polygonCentroid(poly: Point[]): Point {
  const n = poly.length || 1;
  const sx = poly.reduce((s, p) => s + p.x, 0);
  const sy = poly.reduce((s, p) => s + p.y, 0);
  return { x: sx / n, y: sy / n };
}

/** Ray casting. */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Interseção própria de dois segmentos (não conta toques nos extremos partilhados). */
function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Verdadeiro se o polígono se auto-interseta (divisão mal desenhada). */
export function polygonSelfIntersects(poly: Point[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

/** Força p a ficar na horizontal ou vertical em relação a origin (o eixo dominante). */
export function orthoLock(origin: Point, p: Point): Point {
  return Math.abs(p.x - origin.x) >= Math.abs(p.y - origin.y)
    ? { x: p.x, y: origin.y }
    : { x: origin.x, y: p.y };
}
