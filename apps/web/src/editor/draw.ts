import { dist, metersToUnits, pointAt, type Opening, type Point, type ScaleCalibration, type Wall } from "@orc/core";

export interface OpeningGeometry {
  /** extremos do vão sobre a parede */
  j1: Point;
  j2: Point;
  /** portas: dobradiça, ponta da folha aberta e arco de abertura (path SVG) */
  hinge?: Point;
  leafEnd?: Point;
  arc?: string;
}

/**
 * Geometria de desenho de uma porta/janela. A "esquerda" é relativa ao sentido
 * a→b da parede, em coordenadas de ecrã (y para baixo).
 */
export function openingGeometry(wall: Wall, o: Opening, scale: Pick<ScaleCalibration, "metersPerUnit">): OpeningGeometry | null {
  const len = dist(wall.a, wall.b);
  if (len === 0) return null;
  const ux = (wall.b.x - wall.a.x) / len;
  const uy = (wall.b.y - wall.a.y) / len;
  const w = metersToUnits(o.widthM, scale);
  const c = pointAt({ a: wall.a, b: wall.b }, o.t);
  const j1 = { x: c.x - (ux * w) / 2, y: c.y - (uy * w) / 2 };
  const j2 = { x: c.x + (ux * w) / 2, y: c.y + (uy * w) / 2 };
  if (o.kind === "janela") return { j1, j2 };

  const [hinge, free] = o.hinge === "inicio" ? [j1, j2] : [j2, j1];
  // normal à esquerda de a→b com y para baixo: (uy, -ux)
  const side = o.swing === "esquerda" ? 1 : -1;
  const nx = uy * side;
  const ny = -ux * side;
  const leafEnd = { x: hinge.x + nx * w, y: hinge.y + ny * w };
  // arco de leafEnd até ao batente livre; o sentido de varrimento depende da geometria
  const cross = (leafEnd.x - hinge.x) * (free.y - hinge.y) - (leafEnd.y - hinge.y) * (free.x - hinge.x);
  const sweep = cross > 0 ? 1 : 0;
  const arc = `M ${leafEnd.x} ${leafEnd.y} A ${w} ${w} 0 0 ${sweep} ${free.x} ${free.y}`;
  return { j1, j2, hinge, leafEnd, arc };
}

export const ROOM_COLORS: Record<string, string> = {
  quarto: "#7aa6ff",
  escritorio: "#9b8cff",
  sala: "#ffb347",
  cozinha: "#ff7a6b",
  casa_de_banho: "#4fd1c5",
  corredor: "#c3c9d4",
  hall: "#c3c9d4",
  lavandaria: "#68d391",
  garagem: "#a0aec0",
  sala_maquinas: "#f6ad55",
  arrumos: "#a0aec0",
  closet: "#b794f4",
  exterior: "#9ae6b4",
  outro: "#e2e8f0",
};

export const formatM = (v: number, digits = 2) =>
  v.toLocaleString("pt-PT", { minimumFractionDigits: digits, maximumFractionDigits: digits });
