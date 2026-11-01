/**
 * F2 — pontos da instalação no estado do piso: leitura de pisos antigos, o que conta como
 * mudança de geometria (retira as duas aprovações) e validação dos pontos (aprovação própria).
 */
import { pointInPolygon } from "./geometry";
import type { Issue } from "./validate";
import type { FloorState } from "./types";

/** Estado lido da base de dados: pisos gravados antes da F2 não têm `points`. */
export function normalizeFloorState(raw: unknown): FloorState {
  const s = raw as Partial<FloorState>;
  return {
    scale: s.scale ?? null,
    walls: s.walls ?? [],
    openings: s.openings ?? [],
    rooms: s.rooms ?? [],
    points: s.points ?? [],
  };
}

/**
 * A planta mudou (escala, paredes, aberturas, divisões)? Retira a aprovação do piso e a dos
 * pontos. Mudar só os pontos não mexe na aprovação do piso.
 */
export function geometryChanged(prev: FloorState, next: FloorState): boolean {
  const geo = (s: FloorState) => JSON.stringify([s.scale, s.walls, s.openings, s.rooms]);
  return geo(prev) !== geo(next);
}

/** Validação dos pontos antes de os aprovar. Erros bloqueiam; avisos não. */
export function validatePoints(state: FloorState): Issue[] {
  const issues: Issue[] = [];
  const rooms = new Map(state.rooms.map((r) => [r.id, r]));
  if (state.points.length === 0) issues.push({ level: "erro", message: "Nenhum ponto colocado." });
  for (const p of state.points) {
    const room = rooms.get(p.roomId);
    if (!room) {
      issues.push({ level: "erro", message: `${p.elemento}: a divisão já não existe.`, ref: p.id });
      continue;
    }
    if (room.polygon.length >= 3 && !pointInPolygon(p, room.polygon)) {
      issues.push({ level: "aviso", message: `${p.elemento} fora de "${room.name}".`, ref: p.id });
    }
  }
  return issues;
}
