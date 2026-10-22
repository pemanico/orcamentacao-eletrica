import { pointInPolygon, polygonCentroid, dist } from "./geometry";
import type { Point, RoomType } from "./types";

/** Texto do arquiteto já posto em coordenadas de página. */
export interface PlanLabel {
  text: string;
  at: Point;
}

const RULES: [RegExp, RoomType][] = [
  [/^(quarto|suite|suíte)\b/i, "quarto"],
  [/^(escrit[oó]rio|gabinete)\b/i, "escritorio"],
  [/^(sala|estar|jantar)\b/i, "sala"],
  [/^(cozinha|kitchenette)\b/i, "cozinha"],
  [/^(i\.?\s?s\.?|wc|w\.c\.|casa de banho|instala[cç][aã]o sanit[aá]ria|lavabo)\b|^is\s?\.?\s?\d/i, "casa_de_banho"],
  [/^(circula[cç][aã]o|corredor)\b/i, "corredor"],
  [/^(hall|entrada|vest[ií]bulo|átrio|atrio)\b/i, "hall"],
  [/^(lavandaria|lavagem|tratamento de roupa)\b/i, "lavandaria"],
  [/^(garagem|estacionamento)\b/i, "garagem"],
  [/^(arrumos|arrecada[cç][aã]o|despensa|dispensa|closet|vestiário|vestiario|[aá]rea t[eé]cnica)\b/i, "arrumos"],
  [/^(alpendre|varanda|terra[cç]o|p[aá]tio|logradouro|piscina)\b/i, "exterior"],
];

/** "Sala de estar/jantar" → sala, "IS.2" → casa de banho, "Hall 3" → hall. Null se não reconhecer. */
export function guessRoomType(text: string): RoomType | null {
  const t = text.trim();
  for (const [re, type] of RULES) if (re.test(t)) return type;
  return null;
}

/** Abreviaturas de equipamentos que o arquiteto marca na planta (úteis na F2). */
const NOT_ROOM = /^(qe|mo|pf|mll|mlr|ms|cs|cota|perfil|al[cç]ado|corte|legenda|demolir|construir|manter|quebra|esc\.?|escala|n\.?\s?º)\b|^[\d.,\s+-]+$|m²|m2$/i;

/** Texto que parece nome de divisão (exclui cotas, legendas e siglas de equipamentos). */
export const looksLikeRoomName = (text: string) => text.length >= 2 && text.length <= 40 && !NOT_ROOM.test(text.trim());

/**
 * Nome para uma divisão acabada de desenhar: o rótulo do arquiteto que está dentro do
 * polígono; se houver vários, o mais próximo do centro.
 */
export function labelForPolygon(polygon: Point[], labels: PlanLabel[]): PlanLabel | null {
  const inside = labels.filter((l) => looksLikeRoomName(l.text) && pointInPolygon(l.at, polygon));
  if (inside.length === 0) return null;
  const c = polygonCentroid(polygon);
  const typed = inside.filter((l) => guessRoomType(l.text));
  const pool = typed.length ? typed : inside;
  return pool.reduce((best, l) => (dist(l.at, c) < dist(best.at, c) ? l : best));
}
