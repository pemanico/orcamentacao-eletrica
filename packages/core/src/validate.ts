import { dist, polygonArea, polygonSelfIntersects } from "./geometry";
import { areaUnitsToM2, unitsToMeters } from "./scale";
import type { FloorState } from "./types";

export type IssueLevel = "erro" | "aviso";

export interface Issue {
  level: IssueLevel;
  message: string;
  /** id do elemento em causa (parede, abertura, divisão) */
  ref?: string;
}

/**
 * Validação do piso antes de o aprovar. Erros bloqueiam a aprovação;
 * avisos são mostrados mas não bloqueiam.
 */
export function validateFloor(state: FloorState): Issue[] {
  const issues: Issue[] = [];
  const { scale } = state;

  if (!scale) issues.push({ level: "erro", message: "Escala por calibrar." });

  const wallIds = new Set(state.walls.map((w) => w.id));
  for (const w of state.walls) {
    if (dist(w.a, w.b) < 1) issues.push({ level: "erro", message: "Parede com comprimento nulo.", ref: w.id });
  }

  for (const o of state.openings) {
    if (!wallIds.has(o.wallId)) {
      issues.push({ level: "erro", message: `${o.kind} sem parede associada.`, ref: o.id });
      continue;
    }
    if (scale) {
      const w = state.walls.find((x) => x.id === o.wallId)!;
      const wallM = unitsToMeters(dist(w.a, w.b), scale);
      const half = o.widthM / 2;
      const center = o.t * wallM;
      if (center - half < -0.01 || center + half > wallM + 0.01) {
        issues.push({ level: "aviso", message: `A ${o.kind} sai fora da parede.`, ref: o.id });
      }
    }
  }

  if (state.rooms.length === 0) issues.push({ level: "erro", message: "Nenhuma divisão definida." });
  const names = new Map<string, number>();
  for (const r of state.rooms) {
    names.set(r.name.trim().toLowerCase(), (names.get(r.name.trim().toLowerCase()) ?? 0) + 1);
    if (r.polygon.length < 3) {
      issues.push({ level: "erro", message: `"${r.name}" tem menos de 3 vértices.`, ref: r.id });
      continue;
    }
    if (polygonSelfIntersects(r.polygon)) {
      issues.push({ level: "erro", message: `"${r.name}" tem lados que se cruzam.`, ref: r.id });
    }
    if (r.types.length === 0) issues.push({ level: "erro", message: `"${r.name}" não tem tipo.`, ref: r.id });
    if (!r.name.trim()) issues.push({ level: "erro", message: "Divisão sem nome.", ref: r.id });
    if (scale) {
      const m2 = areaUnitsToM2(polygonArea(r.polygon), scale);
      if (m2 < 1) issues.push({ level: "aviso", message: `"${r.name}" tem só ${m2.toFixed(2)} m².`, ref: r.id });
      if (m2 > 150) issues.push({ level: "aviso", message: `"${r.name}" tem ${m2.toFixed(0)} m²: confirma a escala.`, ref: r.id });
    }
  }
  for (const [name, count] of names) {
    if (name && count > 1) issues.push({ level: "aviso", message: `Há ${count} divisões chamadas "${name}".` });
  }
  return issues;
}

export const canApprove = (issues: Issue[]): boolean => !issues.some((i) => i.level === "erro");
