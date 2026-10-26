/**
 * Quantidade de um default por divisão para uma divisão concreta (usado pela F2).
 *
 * - por divisão: a quantidade, fixa;
 * - por m²: quantidade × ⌈área / cada⌉;
 * - por m: quantidade × ⌈comprimento / cada⌉.
 * - por janela: quantidade × janelas da divisão (mínimo por omissão 0: sem janelas, nada).
 * Por m² e por m nunca dão menos do que o mínimo (por omissão, a quantidade).
 *
 * Comprimento = lado maior do retângulo com a mesma área e o mesmo perímetro da divisão.
 * Num corredor retangular é o comprimento real; num corredor em L dá o comprimento
 * "desdobrado" aproximado. Se a forma for quase quadrada, é o lado do quadrado.
 */
import { projectOnSegment } from "./geometry";
import { metersToUnits } from "./scale";
import type { FloorState, Room, ScaleCalibration } from "./types";
import type { RuleValues } from "./rules";

export interface RoomMetrics {
  areaM2: number;
  perimeterM: number;
  /** janelas no contorno da divisão (ver windowsInRoom) */
  windows?: number;
}

/**
 * Janelas de uma divisão: as que ficam no contorno do polígono, a uma distância não maior
 * do que a espessura da parede + 10 cm (a divisão é desenhada pela face interior e a parede
 * pode ter sido traçada pela outra face). Portas de sacada só contam se desenhadas como janela.
 */
export function windowsInRoom(room: Pick<Room, "polygon">, state: Pick<FloorState, "walls" | "openings">, scale: Pick<ScaleCalibration, "metersPerUnit">): number {
  const edges = room.polygon.map((a, i) => ({ a, b: room.polygon[(i + 1) % room.polygon.length]! }));
  let n = 0;
  for (const o of state.openings) {
    if (o.kind !== "janela") continue;
    const w = state.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const p = { x: w.a.x + (w.b.x - w.a.x) * o.t, y: w.a.y + (w.b.y - w.a.y) * o.t };
    const tol = metersToUnits(w.thicknessM + 0.1, scale);
    if (edges.some((e) => projectOnSegment(p, e).distance <= tol)) n++;
  }
  return n;
}

export function roomLengthM({ areaM2, perimeterM }: RoomMetrics): number {
  const half = perimeterM / 2; // L + W
  const disc = half * half - 4 * areaM2; // (L - W)²
  return disc > 0 ? (half + Math.sqrt(disc)) / 2 : half / 2;
}

export function defaultQuantity(values: RuleValues, room: RoomMetrics): number {
  const qty = typeof values.quantidade === "number" ? values.quantidade : 0;
  const base = values.por ?? "divisao";
  const each = typeof values.cada === "number" && values.cada > 0 ? values.cada : null;
  if (base === "janela") return Math.max(typeof values.minimo === "number" ? values.minimo : 0, qty * (room.windows ?? 0));
  if (base === "divisao" || !each) return qty;
  const measure = base === "m2" ? room.areaM2 : roomLengthM(room);
  const min = typeof values.minimo === "number" ? values.minimo : qty;
  return Math.max(min, qty * Math.ceil(measure / each - 1e-9));
}
