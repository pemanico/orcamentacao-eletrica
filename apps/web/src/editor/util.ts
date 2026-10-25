import { dist, type Point } from "@orc/core";

export const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
export const parseNum = (s: string) => Number(s.replace(",", ".").trim());
/** Distância de p à reta (infinita) que contém o segmento. */
export const distToLine = (p: Point, s: { a: Point; b: Point }) => {
  const len = dist(s.a, s.b);
  if (len === 0) return dist(p, s.a);
  return Math.abs((s.b.x - s.a.x) * (s.a.y - p.y) - (s.a.x - p.x) * (s.b.y - s.a.y)) / len;
};
/** Ângulo do traço em graus (0–180, sentido anti-horário como numa planta). */
export const angleDeg = (a: Point, b: Point) => {
  const d = (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
  return Math.round(((d % 180) + 180) % 180);
};
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
