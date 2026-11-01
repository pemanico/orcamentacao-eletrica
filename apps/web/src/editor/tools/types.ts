/**
 * Contrato de uma ferramenta do editor. O Editor trata do que é comum (vista, arrastos de
 * pegas, histórico, atalhos globais, seleção) e delega no handler da ferramenta ativa o
 * clique, o movimento, o duplo clique, teclas próprias e o que ela desenha por cima da planta.
 *
 * Uma ferramenta nova (ex.: "ponto" na F2) é um ficheiro nesta pasta + uma linha em index.ts.
 */
import type { ReactNode } from "react";
import type { FloorState, Point, ScaleCalibration, SnapResult, Wall } from "@orc/core";

/** Elemento selecionado no editor. */
export type Selection = { kind: "wall" | "opening" | "room"; id: string } | null;

/** Arrasto de uma pega (o Editor aplica-o; a ferramenta Selecionar inicia-o). */
export type HandleDrag = { kind: "wall-a" | "wall-b"; id: string } | { kind: "room-v"; id: string; index: number };

export interface ToolContext {
  state: FloorState;
  commit: (next: FloorState | ((s: FloorState) => FloorState)) => void;
  scale: ScaleCalibration | null;
  /** zoom: unidades de página → píxeis de ecrã */
  k: number;
  /** espessura constante em píxeis de ecrã, convertida para unidades de página */
  sw: (px: number) => number;
  /** tamanho de letra base, em unidades de página */
  fs: number;
  /** tolerância de snap em unidades de página */
  snapTol: number;

  draft: Point[];
  setDraft: (d: Point[]) => void;
  cancelDraft: () => void;
  cursor: SnapResult | null;
  setCursor: (c: SnapResult | null) => void;
  /** snap a partir de `from` (orto) ou livre */
  snap: (raw: Point, from: Point | null) => SnapResult;

  hoverWall: { wall: Wall; t: number } | null;
  setHoverWall: (h: { wall: Wall; t: number } | null) => void;
  nearestWall: (p: Point) => { wall: Wall; t: number } | null;
  /** mantém um vão de largura `widthM` dentro da parede */
  clampT: (wall: Wall, t: number, widthM: number) => number;

  selection: Selection;
  setSelection: (s: Selection) => void;
  setMessage: (m: string | null) => void;
  openCalibration: (a: Point, b: Point) => void;
  finishRoom: (poly: Point[]) => void;

  /** Selecionar: arrastar o fundo move a vista; um clique sem arrasto seleciona `click` */
  startPan: (click?: Selection | "none") => void;
  startHandleDrag: (d: HandleDrag) => void;
}

export interface ToolPointer {
  /** posição em unidades de página, sem snap */
  raw: Point;
  /** elemento SVG por baixo do cursor */
  target: Element;
}

export interface ToolHandler<Id extends string = string> {
  id: Id;
  label: string;
  /** atalho de teclado (uma letra) */
  key: string;
  /** ajuda mostrada no topo da planta */
  help: string;
  disabled?: (env: { scale: ScaleCalibration | null; isDxf: boolean }) => boolean;
  /** cursor do rato (por omissão, mira) */
  cursor?: "default" | "crosshair";
  /** o traçado em curso fecha num polígono (divisão): desenha a linha e marca o 1.º ponto */
  draftPolygon?: boolean;
  /** o snap usa orto a partir do último ponto do traçado (paredes, divisões) */
  orthoFromDraft?: boolean;

  pointerDown?: (ctx: ToolContext, p: ToolPointer) => void;
  /** por omissão: cursor com snap (orto a partir do último ponto do traçado, se houver) */
  pointerMove?: (ctx: ToolContext, raw: Point) => void;
  doubleClick?: (ctx: ToolContext) => void;
  /** teclas próprias da ferramenta; devolve true se tratou a tecla */
  keyDown?: (ctx: ToolContext, e: KeyboardEvent) => boolean;
  /** desenho por cima da planta (pré-visualizações, pegas…); ctx.state inclui o arrasto em curso */
  overlay?: (ctx: ToolContext) => ReactNode;
}
