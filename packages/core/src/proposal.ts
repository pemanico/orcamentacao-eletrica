/**
 * F2, passo 1 — proposta de quantidades por divisão a partir dos defaults aprovados.
 *
 * Função pura: piso + regras → por divisão, quantos pontos de cada elemento. Não coloca
 * pontos na planta (isso é o passo 4); a colocação usa estas quantidades como alvo.
 *
 * Regras:
 * - só linhas "aprovada" da tabela defaults_divisao entram (as outras só aparecem em
 *   `pending`, para a UI avisar);
 * - um tipo do utilizador sem linhas próprias usa as do seu tipo base ("Usa os defaults de";
 *   o escritório usa as do quarto). Com linhas próprias, usa só as próprias;
 * - open space (vários tipos) — decisão do Ordep (2026-11-01), "soma onde faz sentido":
 *   - "por divisão": soma (sala 4 tomadas + cozinha 3 = 7);
 *   - "por m²" / "por m": a área/comprimento reparte-se pelos n tipos e soma-se
 *     (30 m² sala + cozinha → 15 m² cada);
 *   - "por janela": cada janela conta uma vez — o maior valor entre os tipos, não a soma.
 *   `contributions` guarda o valor de cada tipo para a UI mostrar.
 */
import { polygonArea, polygonPerimeter } from "./geometry";
import { areaUnitsToM2, unitsToMeters } from "./scale";
import { defaultQuantity, windowsInRoom, type RoomMetrics } from "./defaults";
import type { RoomTypeInfo } from "./roomTypes";
import type { RuleRow } from "./rules";
import type { FloorState, Room } from "./types";

export interface ElementProposal {
  elemento: string;
  quantidade: number;
  /** quantidade dada por cada tipo da divisão (open space) */
  contributions: { type: string; quantidade: number; ruleId: string }[];
}

export interface RoomProposal {
  roomId: string;
  roomName: string;
  metrics: RoomMetrics;
  elements: ElementProposal[];
  /** tipos da divisão sem nenhuma linha aprovada (nem própria nem do tipo base) */
  typesWithoutRules: string[];
  /** linhas por aprovar que se aplicariam a esta divisão (não entram na quantidade) */
  pending: { type: string; elemento: string; ruleId: string }[];
}

export class ProposalError extends Error {}

type DefaultRow = Pick<RuleRow, "id" | "values" | "state">;

/** Tipo cujas linhas se usam para `code`: o próprio, ou o base quando não tem linhas. */
function rulesTypeFor(code: string, rows: readonly DefaultRow[], catalog: readonly RoomTypeInfo[]): string {
  if (rows.some((r) => r.values.divisao === code)) return code;
  return catalog.find((t) => t.code === code)?.base ?? code;
}

export function roomMetrics(room: Pick<Room, "polygon">, state: Pick<FloorState, "scale" | "walls" | "openings">): RoomMetrics {
  if (!state.scale) throw new ProposalError("piso sem escala: calibra antes de propor pontos");
  return {
    areaM2: areaUnitsToM2(polygonArea(room.polygon), state.scale),
    perimeterM: unitsToMeters(polygonPerimeter(room.polygon), state.scale),
    windows: windowsInRoom(room, state, state.scale),
  };
}

export function proposeRoom(
  room: Room,
  state: Pick<FloorState, "scale" | "walls" | "openings">,
  defaults: readonly DefaultRow[],
  catalog: readonly RoomTypeInfo[],
): RoomProposal {
  const metrics = roomMetrics(room, state);
  const byElement = new Map<string, ElementProposal>();
  const typesWithoutRules: string[] = [];
  const pending: RoomProposal["pending"] = [];

  const types = [...new Set(room.types)];
  const share = 1 / Math.max(1, types.length);
  /** por elemento: soma das regras que somam e maior valor das "por janela" */
  const acc = new Map<string, { summed: number; perWindow: number }>();

  for (const type of types) {
    const src = rulesTypeFor(type, defaults, catalog);
    const rows = defaults.filter((r) => r.values.divisao === src);
    const approved = rows.filter((r) => r.state === "aprovada");
    if (approved.length === 0) typesWithoutRules.push(type);
    for (const r of rows) {
      const elemento = typeof r.values.elemento === "string" ? r.values.elemento.trim() : "";
      if (!elemento) continue;
      if (r.state !== "aprovada") {
        pending.push({ type, elemento, ruleId: r.id });
        continue;
      }
      const q = defaultQuantity(r.values, metrics, share);
      const e = byElement.get(elemento) ?? { elemento, quantidade: 0, contributions: [] };
      e.contributions.push({ type, quantidade: q, ruleId: r.id });
      byElement.set(elemento, e);
      const a = acc.get(elemento) ?? { summed: 0, perWindow: 0 };
      if (r.values.por === "janela") a.perWindow = Math.max(a.perWindow, q);
      else a.summed += q;
      acc.set(elemento, a);
    }
  }
  for (const [elemento, a] of acc) byElement.get(elemento)!.quantidade = a.summed + a.perWindow;

  const elements = [...byElement.values()].filter((e) => e.quantidade > 0).sort((a, b) => a.elemento.localeCompare(b.elemento));
  return { roomId: room.id, roomName: room.name, metrics, elements, typesWithoutRules, pending };
}

/** Proposta para todas as divisões do piso. */
export function proposeFloor(
  state: Pick<FloorState, "scale" | "walls" | "openings" | "rooms">,
  defaults: readonly DefaultRow[],
  catalog: readonly RoomTypeInfo[],
): RoomProposal[] {
  return state.rooms.map((r) => proposeRoom(r, state, defaults, catalog));
}

/** Totais do piso por elemento (para o resumo e, mais tarde, o orçamento). */
export function totalsByElement(proposals: readonly RoomProposal[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of proposals) for (const e of p.elements) out.set(e.elemento, (out.get(e.elemento) ?? 0) + e.quantidade);
  return out;
}
