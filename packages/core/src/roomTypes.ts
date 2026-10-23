/**
 * Catálogo de tipos de divisão: os base (no código) + os criados pelo utilizador em
 * Regras → Tipos de divisão. Uma divisão guarda só o código; o nome vem do catálogo.
 */
import { ROOM_TYPES, ROOM_TYPE_LABEL, type RoomType } from "./types";

/** Código de um tipo: minúsculas, algarismos e "_" (ex.: "sala_maquinas", "adega"). */
export const ROOM_TYPE_CODE = /^[a-z][a-z0-9_]{1,39}$/;

export interface RoomTypeInfo {
  code: string;
  /** nome completo, ex. "Escritório (tratado como quarto)" */
  label: string;
  /** nome curto para listas e para pré-preencher o nome da divisão */
  short: string;
  builtin: boolean;
  /** tipos do utilizador: tipo base cujos defaults usa (null = defaults próprios) */
  base: RoomType | null;
}

export const isBuiltinRoomType = (code: string): code is RoomType => (ROOM_TYPES as readonly string[]).includes(code);

/** "Sala das Máquinas" → "sala_das_maquinas" */
export function slugifyRoomType(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(s) ? s : `t_${s}`.slice(0, 40);
}

const shortOf = (label: string) => label.split(/ \(| \/ /)[0]!;

/** Linhas da tabela tipos_divisao (qualquer estado) → catálogo completo, base primeiro. */
export function buildRoomTypeCatalog(rows: readonly { values: Record<string, unknown> }[] = []): RoomTypeInfo[] {
  const out: RoomTypeInfo[] = ROOM_TYPES.filter((t) => t !== "outro").map((t) => ({
    code: t,
    label: ROOM_TYPE_LABEL[t],
    short: shortOf(ROOM_TYPE_LABEL[t]),
    builtin: true,
    // regra do Ordep: o escritório é tratado como um quarto
    base: t === "escritorio" ? "quarto" : null,
  }));
  const seen = new Set<string>(ROOM_TYPES);
  for (const r of rows) {
    const code = typeof r.values.codigo === "string" ? r.values.codigo : "";
    const label = typeof r.values.nome === "string" ? r.values.nome.trim() : "";
    if (!ROOM_TYPE_CODE.test(code) || !label || seen.has(code)) continue;
    seen.add(code);
    const base = typeof r.values.defaults_como === "string" && isBuiltinRoomType(r.values.defaults_como) ? r.values.defaults_como : null;
    out.push({ code, label, short: label, builtin: false, base });
  }
  // "Outro" fica sempre no fim
  out.push({ code: "outro", label: ROOM_TYPE_LABEL.outro, short: "Outro", builtin: true, base: null });
  return out;
}

/** Nome curto de um código; um código que já não existe aparece tal como está. */
export function roomTypeShort(catalog: readonly RoomTypeInfo[], code: string): string {
  return catalog.find((t) => t.code === code)?.short ?? code;
}
