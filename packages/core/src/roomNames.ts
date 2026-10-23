import { pointInPolygon, polygonCentroid, dist } from "./geometry";
import type { Point, RoomType } from "./types";

/** Texto do arquiteto já posto em coordenadas de página. */
export interface PlanLabel {
  text: string;
  at: Point;
}

// a ordem conta: "Sala das máquinas" tem de ganhar a "Sala"
const RULES: [RegExp, RoomType][] = [
  [/^(quarto|suite|suíte)\b/i, "quarto"],
  [/^(escrit[oó]rio|gabinete)\b/i, "escritorio"],
  [/^((sala|casa|zona) (das|de) m[aá]quinas|m[aá]quinas|[aá]rea t[eé]cnica|zona t[eé]cnica|central t[eé]rmica|lavandaria\/m[aá]quinas)\b/i, "sala_maquinas"],
  [/^(sala|estar|jantar)\b/i, "sala"],
  [/^(cozinha|kitchenette)\b/i, "cozinha"],
  [/^(i\.?\s?s\.?|wc|w\.c\.|casa de banho|instala[cç][aã]o sanit[aá]ria|lavabo)\b|^is\s?\.?\s?\d/i, "casa_de_banho"],
  [/^(circula[cç][aã]o|corredor)\b/i, "corredor"],
  [/^(hall|entrada|vest[ií]bulo|átrio|atrio)\b/i, "hall"],
  [/^(lavandaria|lavagem|tratamento de roupa)\b/i, "lavandaria"],
  [/^(garagem|estacionamento)\b/i, "garagem"],
  [/^(closet|vesti[aá]rio|roupeiro)\b/i, "closet"],
  [/^(arrumos|arrecada[cç][aã]o|despensa|dispensa)\b/i, "arrumos"],
  [/^(alpendre|varanda|terra[cç]o|p[aá]tio|logradouro|piscina)\b/i, "exterior"],
];

/**
 * "Sala de estar/jantar" → sala, "IS.2" → casa de banho, "Hall 3" → hall. Null se não reconhecer.
 * `custom`: tipos criados pelo utilizador; ganham aos base quando o nome começa pelo deles
 * (ex.: tipo "Adega" e texto "Adega 1").
 */
export function guessRoomType(text: string, custom: readonly { code: string; label: string }[] = []): string | null {
  const t = text.trim();
  const nt = normalizeName(t);
  for (const c of custom) {
    const nl = normalizeName(c.label);
    if (nl && (nt === nl || nt.startsWith(nl + " "))) return c.code;
  }
  for (const [re, type] of RULES) if (re.test(t)) return type;
  return null;
}

/** minúsculas, sem acentos, espaços simples */
export const normalizeName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Abreviaturas de equipamentos que o arquiteto marca na planta (úteis na F2). */
const NOT_ROOM = /^(qe|mo|pf|mll|mlr|ms|cs|cota|perfil|al[cç]ado|corte|legenda|demolir|construir|manter|quebra|esc\.?|escala|n\.?\s?º)\b|^[\d.,\s+-]+$|m²|m2$/i;

/** Texto que parece nome de divisão (exclui cotas, legendas e siglas de equipamentos). */
export const looksLikeRoomName = (text: string) => text.length >= 2 && text.length <= 40 && !NOT_ROOM.test(text.trim());

/**
 * Nome para uma divisão acabada de desenhar: o rótulo do arquiteto que está dentro do
 * polígono; se houver vários, o mais próximo do centro.
 */
export function labelForPolygon(polygon: Point[], labels: PlanLabel[], custom: readonly { code: string; label: string }[] = []): PlanLabel | null {
  const inside = labels.filter((l) => looksLikeRoomName(l.text) && pointInPolygon(l.at, polygon));
  if (inside.length === 0) return null;
  const c = polygonCentroid(polygon);
  const typed = inside.filter((l) => guessRoomType(l.text, custom));
  const pool = typed.length ? typed : inside;
  return pool.reduce((best, l) => (dist(l.at, c) < dist(best.at, c) ? l : best));
}
