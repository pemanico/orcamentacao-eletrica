import { dist } from "./geometry";
import type { Point, ScaleCalibration } from "./types";

/** 1 ponto PDF = 1/72 polegada = 0,3528 mm */
export const METERS_PER_PDF_POINT = 0.0254 / 72;

export class CalibrationError extends Error {}

/**
 * Calibração por cota conhecida: dois pontos clicados + o valor real.
 * Rejeita entradas absurdas em vez de produzir uma escala silenciosamente errada.
 */
export function calibrate(
  refA: Point,
  refB: Point,
  refMeters: number,
  stampDenominator: number | null = null,
): ScaleCalibration {
  const d = dist(refA, refB);
  if (!Number.isFinite(refMeters) || refMeters <= 0) {
    throw new CalibrationError("O comprimento real tem de ser um número positivo (em metros).");
  }
  if (refMeters > 200) {
    throw new CalibrationError("Comprimento acima de 200 m: confirma se não introduziste centímetros.");
  }
  if (d < 5) {
    throw new CalibrationError("Os dois pontos estão demasiado próximos. Usa uma cota mais longa.");
  }
  return { metersPerUnit: refMeters / d, refA, refB, refMeters, stampDenominator };
}

/** Metros por unidade que uma escala 1:N implica, se o PDF não foi redimensionado na impressão. */
export const expectedMetersPerUnit = (denominator: number): number => METERS_PER_PDF_POINT * denominator;

/** Escala "efetiva" 1:N que a calibração implica. */
export const effectiveDenominator = (cal: Pick<ScaleCalibration, "metersPerUnit">): number =>
  cal.metersPerUnit / METERS_PER_PDF_POINT;

export interface ScaleCheck {
  stampDenominator: number;
  effectiveDenominator: number;
  /** diferença relativa (0,05 = 5%) */
  relativeDiff: number;
  ok: boolean;
}

/**
 * Validação cruzada: a escala do carimbo é só uma sugestão. Se a calibração
 * divergir mais do que a tolerância, o PDF foi provavelmente impresso com
 * "ajustar à página" — confia-se na calibração, mas o utilizador é avisado.
 */
export function checkAgainstStamp(
  cal: Pick<ScaleCalibration, "metersPerUnit">,
  stampDenominator: number,
  tolerance = 0.03,
): ScaleCheck {
  const eff = effectiveDenominator(cal);
  const relativeDiff = Math.abs(eff - stampDenominator) / stampDenominator;
  return { stampDenominator, effectiveDenominator: eff, relativeDiff, ok: relativeDiff <= tolerance };
}

const COMMON_DENOMINATORS = new Set([20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000]);

/** Procura indicações de escala ("Esc. 1:100", "ESCALA 1/50") no texto do PDF. */
export function findScaleStamps(text: string): number[] {
  const found = new Set<number>();
  const re = /\b1\s*[:/]\s*(\d{2,4})\b/g;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]);
    if (COMMON_DENOMINATORS.has(n)) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

export const unitsToMeters = (units: number, cal: Pick<ScaleCalibration, "metersPerUnit">): number =>
  units * cal.metersPerUnit;

export const metersToUnits = (meters: number, cal: Pick<ScaleCalibration, "metersPerUnit">): number =>
  meters / cal.metersPerUnit;

export const areaUnitsToM2 = (area: number, cal: Pick<ScaleCalibration, "metersPerUnit">): number =>
  area * cal.metersPerUnit * cal.metersPerUnit;
