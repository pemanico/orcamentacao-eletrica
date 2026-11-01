/**
 * F2, passo 4 — colocação automática dos pontos na planta, a partir das quantidades da
 * proposta (proposal.ts). Regras aprovadas pelo Ordep (2026-11-01):
 * - luzes (teto): ao centro; várias, em grelha;
 * - tomadas e o resto (parede): espalhadas pelo contorno da divisão, fora das portas e janelas;
 * - interruptores (porta): junto a cada porta, do lado do fecho (oposto à dobradiça);
 *   os que sobram vão para as paredes;
 * - motor de estore: na janela; comando de estore: ao lado da janela.
 *
 * Voltar a propor substitui só os pontos "auto"; os ajustados e manuais ficam e contam para a
 * quantidade (se já há 2 tomadas postas à mão e a regra pede 3, propõe-se 1).
 *
 * Geometria em unidades de página; distâncias em metros convertidas com a escala.
 */
import { dist, pointAt, pointInPolygon, polygonArea, projectOnSegment } from "./geometry";
import { metersToUnits } from "./scale";
import type { RoomProposal } from "./proposal";
import type { ElectricPoint, FloorState, Opening, Point, Room, ScaleCalibration, Segment, Wall } from "./types";

export type PlacementKind = "teto" | "parede" | "porta" | "janela" | "junto_janela";

/** Onde se coloca um elemento, pelo código. Desconhecido → parede. */
export function placementKind(elemento: string): PlacementKind {
  const e = elemento.toLowerCase();
  if (/estore_motor|motor_estore/.test(e)) return "janela";
  if (/interruptor_estore|comando_estore/.test(e)) return "junto_janela";
  if (/^interruptor|comutad|inversor|telerruptor|botoneira/.test(e)) return "porta";
  if (/luz|foco|candeeiro|aplique|plafon|projetor|spot/.test(e)) return "teto";
  return "parede";
}

const M = {
  /** afastamento da face da parede para dentro da divisão */
  inset: 0.15,
  /** folga a cada lado de um vão onde não se põem tomadas */
  openingClearance: 0.3,
  /** folga aos cantos */
  corner: 0.3,
  /** interruptor: distância ao batente do lado do fecho */
  switchFromJamb: 0.15,
  /** comando de estore: distância ao lado da janela */
  besideWindow: 0.2,
};

interface BoundaryOpening {
  opening: Opening;
  edge: Segment;
  /** centro e batentes projetados no contorno da divisão */
  center: Point;
  /** batente do lado do fecho (portas) ou o segundo batente (janelas) */
  lockJamb: Point;
  /** direção unitária ao longo do contorno, do centro para lockJamb */
  towardLock: Point;
}

const unit = (a: Point, b: Point): Point => {
  const d = dist(a, b) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
};

/** Vãos no contorno da divisão (mesma tolerância que windowsInRoom: espessura + 10 cm). */
function boundaryOpenings(room: Room, walls: readonly Wall[], openings: readonly Opening[], scale: ScaleCalibration): BoundaryOpening[] {
  const edges = room.polygon.map((a, i) => ({ a, b: room.polygon[(i + 1) % room.polygon.length]! }));
  const out: BoundaryOpening[] = [];
  for (const o of openings) {
    const w = walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const c = pointAt(w, o.t);
    const tol = metersToUnits(w.thicknessM + 0.1, scale);
    let best: { edge: Segment; d: number } | null = null;
    for (const e of edges) {
      const d = projectOnSegment(c, e).distance;
      if (d <= tol && (!best || d < best.d)) best = { edge: e, d };
    }
    if (!best) continue;
    const half = metersToUnits(o.widthM / 2, scale);
    const u = unit(w.a, w.b);
    // na parede: j1 do lado de a, j2 do lado de b; dobradiça "inicio" = j1, fecho = j2
    const lockOnWall = o.kind === "porta" && o.hinge === "fim" ? { x: c.x - u.x * half, y: c.y - u.y * half } : { x: c.x + u.x * half, y: c.y + u.y * half };
    const center = projectOnSegment(c, best.edge).point;
    const lockJamb = projectOnSegment(lockOnWall, best.edge).point;
    out.push({ opening: o, edge: best.edge, center, lockJamb, towardLock: unit(center, lockJamb) });
  }
  return out;
}

/** Desloca um ponto do contorno para dentro da divisão. */
function inward(p: Point, edge: Segment, room: Room, d: number): Point {
  const u = unit(edge.a, edge.b);
  for (const s of [1, -1]) {
    const q = { x: p.x + -u.y * d * s, y: p.y + u.x * d * s };
    if (pointInPolygon(q, room.polygon)) return q;
  }
  return p;
}

/** Ponto interior: o centro se estiver dentro (forma em L pode não estar), senão o mais perto dele. */
function interiorPoint(room: Room): Point {
  const xs = room.polygon.map((p) => p.x);
  const ys = room.polygon.map((p) => p.y);
  const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  if (pointInPolygon(c, room.polygon)) return c;
  let best: Point | null = null;
  for (let i = 1; i < 20; i++)
    for (let j = 1; j < 20; j++) {
      const q = { x: Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * i) / 20, y: Math.min(...ys) + ((Math.max(...ys) - Math.min(...ys)) * j) / 20 };
      if (pointInPolygon(q, room.polygon) && (!best || dist(q, c) < dist(best, c))) best = q;
    }
  return best ?? room.polygon[0]!;
}

/** n pontos de teto: 1 ao centro; vários numa grelha proporcional à divisão. */
function ceilingPoints(room: Room, n: number): Point[] {
  if (n <= 0) return [];
  if (n === 1) return [interiorPoint(room)];
  const xs = room.polygon.map((p) => p.x);
  const ys = room.polygon.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = x1 - x0 || 1;
  const h = y1 - y0 || 1;
  for (let extra = 0; extra < 6; extra++) {
    const cols = Math.max(1, Math.round(Math.sqrt((n * w) / h)) + extra);
    const rows = Math.max(1, Math.ceil(n / cols) + extra);
    const cells: Point[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const q = { x: x0 + (w * (c + 0.5)) / cols, y: y0 + (h * (r + 0.5)) / rows };
        if (pointInPolygon(q, room.polygon)) cells.push(q);
      }
    if (cells.length >= n) return pickSpread(cells, n);
  }
  return Array.from({ length: n }, () => interiorPoint(room));
}

/** Escolhe n células espalhadas (passo constante) de uma lista ordenada. */
function pickSpread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items.slice(0, n);
  return Array.from({ length: n }, (_, i) => items[Math.floor(((i + 0.5) * items.length) / n)]!);
}

/** n pontos espalhados pelo contorno, fora dos vãos e dos cantos, já recuados para dentro. */
function wallPoints(room: Room, n: number, vaos: BoundaryOpening[], scale: ScaleCalibration): Point[] {
  if (n <= 0) return [];
  const edges = room.polygon.map((a, i) => ({ a, b: room.polygon[(i + 1) % room.polygon.length]! }));
  const corner = metersToUnits(M.corner, scale);
  const pieces: { edge: Segment; from: number; to: number }[] = []; // em distância ao longo da aresta
  for (const e of edges) {
    const len = dist(e.a, e.b);
    let free: [number, number][] = [[corner, len - corner]];
    for (const v of vaos) {
      if (v.edge.a !== e.a || v.edge.b !== e.b) continue;
      const at = dist(e.a, v.center);
      const half = metersToUnits(v.opening.widthM / 2 + M.openingClearance, scale);
      free = free.flatMap(([f, t]): [number, number][] => {
        const [cf, ct] = [at - half, at + half];
        if (ct <= f || cf >= t) return [[f, t]];
        const parts: [number, number][] = [
          [f, cf],
          [ct, t],
        ];
        return parts.filter(([a, b]) => b - a > 0);
      });
    }
    for (const [f, t] of free) if (t > f) pieces.push({ edge: e, from: f, to: t });
  }
  const total = pieces.reduce((s, p) => s + p.to - p.from, 0);
  if (total <= 0) return Array.from({ length: n }, () => interiorPoint(room));
  const inset = metersToUnits(M.inset, scale);
  return Array.from({ length: n }, (_, i) => {
    let at = ((i + 0.5) * total) / n;
    for (const p of pieces) {
      const len = p.to - p.from;
      if (at <= len) {
        const u = unit(p.edge.a, p.edge.b);
        const d = p.from + at;
        return inward({ x: p.edge.a.x + u.x * d, y: p.edge.a.y + u.y * d }, p.edge, room, inset);
      }
      at -= len;
    }
    return interiorPoint(room);
  });
}

/** Posições para os elementos de uma divisão. `need`: quantos de cada elemento colocar. */
export function placeRoom(room: Room, need: ReadonlyMap<string, number>, state: Pick<FloorState, "walls" | "openings">, scale: ScaleCalibration): { elemento: string; point: Point }[] {
  if (room.polygon.length < 3 || polygonArea(room.polygon) === 0) return [];
  const vaos = boundaryOpenings(room, state.walls, state.openings, scale);
  const doors = vaos.filter((v) => v.opening.kind === "porta");
  const windows = vaos.filter((v) => v.opening.kind === "janela");
  const inset = metersToUnits(M.inset, scale);
  const along = (v: BoundaryOpening, m: number) => {
    const d = metersToUnits(m, scale);
    return inward({ x: v.lockJamb.x + v.towardLock.x * d, y: v.lockJamb.y + v.towardLock.y * d }, v.edge, room, inset);
  };

  const out: { elemento: string; point: Point }[] = [];
  const toWall: string[] = [];
  const toCeiling: string[] = [];
  const usedDoors = new Map<BoundaryOpening, number>();
  const usedWindows = new Map<string, number>();

  for (const [elemento, n] of need) {
    for (let i = 0; i < n; i++) {
      const kind = placementKind(elemento);
      if (kind === "teto") toCeiling.push(elemento);
      else if (kind === "porta" && i < doors.length) {
        const v = doors[i]!;
        const k = usedDoors.get(v) ?? 0; // vários interruptores na mesma porta: lado a lado
        usedDoors.set(v, k + 1);
        out.push({ elemento, point: along(v, M.switchFromJamb + k * 0.1) });
      } else if ((kind === "janela" || kind === "junto_janela") && i < windows.length) {
        const v = windows[i]!;
        if (kind === "janela") out.push({ elemento, point: inward(v.center, v.edge, room, metersToUnits(0.1, scale)) });
        else {
          const k = usedWindows.get(elemento) ?? 0;
          usedWindows.set(elemento, k + 1);
          out.push({ elemento, point: along(v, M.besideWindow) });
        }
      } else toWall.push(elemento);
    }
  }
  ceilingPoints(room, toCeiling.length).forEach((point, i) => out.push({ elemento: toCeiling[i]!, point }));
  // intercala os elementos de parede (tomada, tomada_tv, tomada…) para não ficarem todos juntos
  const order = interleave(toWall);
  wallPoints(room, order.length, vaos, scale).forEach((point, i) => out.push({ elemento: order[i]!, point }));
  return out;
}

function interleave(items: string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const it of items) groups.set(it, [...(groups.get(it) ?? []), it]);
  const lists = [...groups.values()];
  const out: string[] = [];
  for (let i = 0; out.length < items.length; i++) for (const l of lists) if (l[i]) out.push(l[i]!);
  return out;
}

export interface PointsDiff {
  points: ElectricPoint[];
  added: number;
  removed: number;
  kept: number;
}

/**
 * Propor pontos para o piso: remove os "auto", mantém ajustados e manuais, e coloca o que falta
 * para chegar às quantidades da proposta. Pontos de divisões que já não existem saem.
 */
export function proposePoints(state: FloorState, proposals: readonly RoomProposal[], newId: () => string): PointsDiff {
  if (!state.scale) throw new Error("piso sem escala");
  const roomIds = new Set(state.rooms.map((r) => r.id));
  const kept = state.points.filter((p) => p.origem !== "auto" && roomIds.has(p.roomId));
  const out: ElectricPoint[] = [...kept];
  let added = 0;
  for (const prop of proposals) {
    const room = state.rooms.find((r) => r.id === prop.roomId);
    if (!room) continue;
    const need = new Map<string, number>();
    for (const e of prop.elements) {
      const have = kept.filter((p) => p.roomId === room.id && p.elemento === e.elemento).length;
      if (e.quantidade > have) need.set(e.elemento, e.quantidade - have);
    }
    for (const { elemento, point } of placeRoom(room, need, state, state.scale)) {
      out.push({ id: newId(), roomId: room.id, elemento, x: point.x, y: point.y, origem: "auto" });
      added++;
    }
  }
  return { points: out, added, removed: state.points.length - kept.length, kept: kept.length };
}

/** Divisão em que cai um ponto (a mais pequena, se houver divisões sobrepostas). */
export function roomAt(rooms: readonly Room[], p: Point): Room | null {
  const hits = rooms.filter((r) => r.polygon.length >= 3 && pointInPolygon(p, r.polygon));
  return hits.sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon))[0] ?? null;
}
