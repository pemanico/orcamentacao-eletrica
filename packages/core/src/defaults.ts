/**
 * Quantidade de um default por divisão para uma divisão concreta (usado pela F2).
 *
 * - por divisão: a quantidade, fixa;
 * - por m²: quantidade × ⌈área / cada⌉;
 * - por m: quantidade × ⌈comprimento / cada⌉.
 * Nos dois últimos o resultado nunca é menor do que o mínimo (por omissão, a quantidade).
 *
 * Comprimento = lado maior do retângulo com a mesma área e o mesmo perímetro da divisão.
 * Num corredor retangular é o comprimento real; num corredor em L dá o comprimento
 * "desdobrado" aproximado. Se a forma for quase quadrada, é o lado do quadrado.
 */
import type { RuleValues } from "./rules";

export interface RoomMetrics {
  areaM2: number;
  perimeterM: number;
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
  if (base === "divisao" || !each) return qty;
  const measure = base === "m2" ? room.areaM2 : roomLengthM(room);
  const min = typeof values.minimo === "number" ? values.minimo : qty;
  return Math.max(min, qty * Math.ceil(measure / each - 1e-9));
}
