import type { Point, Segment } from "./types";

/**
 * Extração de segmentos vetoriais a partir da operator list do pdf.js.
 * Recebe os códigos OPS por parâmetro para não depender do pdf.js aqui:
 * o mesmo código corre no browser e nos testes em Node.
 *
 * Suporta os dois formatos de `constructPath`:
 *  - pdf.js ≥ 5: args = [opDePintura, [Float32Array | null], minMax]
 *    com o caminho codificado em DrawOPS (moveTo 0, lineTo 1, curveTo 2,
 *    quadraticCurveTo 3, closePath 4);
 *  - pdf.js 4.x: args = [ops[], coords[], minMax].
 *
 * Curvas de Bézier são aproximadas pela corda (extremo a extremo): para snap
 * a paredes, as curvas (arcos de portas) não interessam.
 */

type Matrix = [number, number, number, number, number, number];

export interface PdfOps {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  moveTo: number;
  lineTo: number;
  curveTo: number;
  curveTo2: number;
  curveTo3: number;
  closePath: number;
  rectangle: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageMaskXObject: number;
}

export interface OperatorList {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

export interface ExtractionResult {
  segments: Segment[];
  imageCount: number;
}

const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const apply = (m: Matrix, x: number, y: number): Point => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});

/** Arredonda a 1/100 de ponto: une extremos que diferem por ruído numérico. */
const round = (p: Point): Point => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });

const isPathData = (v: unknown): v is ArrayLike<number> | null =>
  v === null || v instanceof Float32Array || v instanceof Float64Array;

/**
 * @param viewportTransform  `page.getViewport({ scale: 1 }).transform` — converte para
 *                           coordenadas de página com y para baixo.
 */
export function extractSegments(
  opList: OperatorList,
  OPS: PdfOps,
  viewportTransform: number[],
  minLength = 0.5,
): ExtractionResult {
  const segments: Segment[] = [];
  let imageCount = 0;
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  const vt = viewportTransform as Matrix;

  const addSeg = (a: Point, b: Point) => {
    const m = multiply(vt, ctm);
    const pa = round(apply(m, a.x, a.y));
    const pb = round(apply(m, b.x, b.y));
    if (Math.hypot(pa.x - pb.x, pa.y - pb.y) >= minLength) segments.push({ a: pa, b: pb });
  };

  /** Formato pdf.js ≥ 5 (DrawOPS num Float32Array). */
  const walkDrawOps = (data: ArrayLike<number>) => {
    let cur: Point | null = null;
    let start: Point | null = null;
    let j = 0;
    while (j < data.length) {
      const op = data[j++];
      if (op === DRAW.moveTo) {
        cur = start = { x: data[j]!, y: data[j + 1]! };
        j += 2;
      } else if (op === DRAW.lineTo) {
        const p = { x: data[j]!, y: data[j + 1]! };
        if (cur) addSeg(cur, p);
        cur = p;
        j += 2;
      } else if (op === DRAW.curveTo) {
        const p = { x: data[j + 4]!, y: data[j + 5]! };
        if (cur) addSeg(cur, p);
        cur = p;
        j += 6;
      } else if (op === DRAW.quadraticCurveTo) {
        const p = { x: data[j + 2]!, y: data[j + 3]! };
        if (cur) addSeg(cur, p);
        cur = p;
        j += 4;
      } else if (op === DRAW.closePath) {
        if (cur && start) addSeg(cur, start);
        cur = start;
      } else {
        return; // código desconhecido: abandona este caminho em vez de ler lixo
      }
    }
  };

  /** Formato pdf.js 4.x (ops[] + coords[]). */
  const walkLegacy = (ops: number[], coords: number[]) => {
    let j = 0;
    let cur: Point | null = null;
    let start: Point | null = null;
    for (const op of ops) {
      if (op === OPS.moveTo) {
        cur = start = { x: coords[j]!, y: coords[j + 1]! };
        j += 2;
      } else if (op === OPS.lineTo) {
        const p = { x: coords[j]!, y: coords[j + 1]! };
        if (cur) addSeg(cur, p);
        cur = p;
        j += 2;
      } else if (op === OPS.curveTo) {
        const p = { x: coords[j + 4]!, y: coords[j + 5]! };
        if (cur) addSeg(cur, p);
        cur = p;
        j += 6;
      } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
        const p = { x: coords[j + 2]!, y: coords[j + 3]! };
        if (cur) addSeg(cur, p);
        cur = p;
        j += 4;
      } else if (op === OPS.rectangle) {
        const [x, y, w, h] = [coords[j]!, coords[j + 1]!, coords[j + 2]!, coords[j + 3]!];
        const p0 = { x, y };
        const p1 = { x: x + w, y };
        const p2 = { x: x + w, y: y + h };
        const p3 = { x, y: y + h };
        addSeg(p0, p1);
        addSeg(p1, p2);
        addSeg(p2, p3);
        addSeg(p3, p0);
        cur = start = p0;
        j += 4;
      } else if (op === OPS.closePath) {
        if (cur && start) addSeg(cur, start);
        cur = start;
      }
    }
  };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[] | null;

    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === OPS.transform && args) {
      ctm = multiply(ctm, Array.from(args as ArrayLike<number>) as Matrix);
    } else if (fn === OPS.paintFormXObjectBegin && args) {
      stack.push(ctm);
      const m = args[0] as ArrayLike<number> | null;
      if (m && m.length === 6) ctm = multiply(ctm, Array.from(m) as Matrix);
    } else if (fn === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintImageMaskXObject
    ) {
      imageCount++;
    } else if (fn === OPS.constructPath && args) {
      const second = args[1];
      if (Array.isArray(second) && second.length === 1 && isPathData(second[0])) {
        if (second[0]) walkDrawOps(second[0]);
      } else if (Array.isArray(args[0]) && Array.isArray(second)) {
        walkLegacy(args[0] as number[], second as number[]);
      }
    }
  }
  return { segments, imageCount };
}

export type PdfVerdict =
  | { ok: true; segmentCount: number }
  | { ok: false; reason: string };

/**
 * O PDF tem de ser vetorial. Um PDF digitalizado tem imagens e (quase) nenhum traço.
 */
export function classifyPdf(result: ExtractionResult, minSegments = 50): PdfVerdict {
  if (result.segments.length < minSegments) {
    return {
      ok: false,
      reason:
        result.imageCount > 0
          ? `O PDF parece ser uma imagem (digitalização): ${result.segments.length} linhas vetoriais e ${result.imageCount} imagem(ns). É preciso um PDF exportado do CAD.`
          : `O PDF tem só ${result.segments.length} linhas vetoriais. Não parece uma planta exportada do CAD.`,
    };
  }
  return { ok: true, segmentCount: result.segments.length };
}
