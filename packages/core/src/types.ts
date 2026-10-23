/**
 * Coordenadas: todas as posições são guardadas em "unidades de página" —
 * pontos PDF (1/72 polegada) com o eixo y para baixo, tal como o pdf.js
 * devolve com o viewport à escala 1. Os metros reais derivam-se da escala
 * calibrada (metersPerUnit). Assim, recalibrar nunca desloca a geometria
 * em relação ao PDF.
 */
export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  a: Point;
  b: Point;
}

export interface ScaleCalibration {
  /** metros reais por unidade de página */
  metersPerUnit: number;
  /** os dois pontos clicados na cota de referência */
  refA: Point;
  refB: Point;
  /** valor real introduzido pelo utilizador, em metros */
  refMeters: number;
  /** denominador do carimbo (ex.: 100 para 1:100), se detetado/indicado */
  stampDenominator?: number | null;
}

export interface Wall {
  id: string;
  a: Point;
  b: Point;
  thicknessM: number;
}

export type OpeningKind = "porta" | "janela";

export interface Opening {
  id: string;
  kind: OpeningKind;
  wallId: string;
  /** posição do centro ao longo da parede, 0 = início (a), 1 = fim (b) */
  t: number;
  widthM: number;
  /** portas: lado da dobradiça, relativo ao sentido a→b da parede */
  hinge: "inicio" | "fim";
  /** portas: para que lado da parede abre (esquerda/direita do sentido a→b) */
  swing: "esquerda" | "direita";
}

export const ROOM_TYPES = [
  "quarto",
  "escritorio",
  "sala",
  "cozinha",
  "casa_de_banho",
  "corredor",
  "hall",
  "lavandaria",
  "garagem",
  "sala_maquinas",
  "arrumos",
  "closet",
  "exterior",
  "outro",
] as const;

export type RoomType = (typeof ROOM_TYPES)[number];

export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  quarto: "Quarto",
  escritorio: "Escritório (tratado como quarto)",
  sala: "Sala",
  cozinha: "Cozinha",
  casa_de_banho: "Casa de banho",
  corredor: "Corredor",
  hall: "Hall / entrada",
  lavandaria: "Lavandaria",
  garagem: "Garagem",
  sala_maquinas: "Sala das máquinas / área técnica",
  arrumos: "Arrumos",
  closet: "Closet / vestiário",
  exterior: "Exterior",
  outro: "Outro",
};

export interface Room {
  id: string;
  name: string;
  /**
   * Códigos de tipo: os base (ROOM_TYPES) ou os criados em Regras → Tipos de divisão.
   * Mais do que um tipo = open space (ex.: sala + cozinha).
   */
  types: string[];
  polygon: Point[];
}

export interface FloorState {
  scale: ScaleCalibration | null;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
}

export const emptyFloorState = (): FloorState => ({
  scale: null,
  walls: [],
  openings: [],
  rooms: [],
});
