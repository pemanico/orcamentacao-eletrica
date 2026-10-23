import { useCallback, useEffect, useState } from "react";
import { buildRoomTypeCatalog, type RoomTypeInfo, type RuleRow } from "@orc/core";
import { api } from "./api";
import { RULES_CHANGED } from "./Shell";
import { ROOM_COLORS } from "./editor/draw";

const PALETTE = ["#f687b3", "#63b3ed", "#d69e2e", "#38b2ac", "#ed8936", "#9f7aea", "#48bb78", "#e53e3e"];

/** Cor de um tipo: a do tipo base, ou uma cor fixa calculada a partir do código. */
export function roomColor(code: string | undefined, catalog: readonly RoomTypeInfo[]): string {
  const c = code ?? "outro";
  if (ROOM_COLORS[c]) return ROOM_COLORS[c]!;
  const info = catalog.find((t) => t.code === c);
  if (info?.base && ROOM_COLORS[info.base]) return ROOM_COLORS[info.base]!;
  let h = 0;
  for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Catálogo de tipos de divisão (base + os do utilizador), sempre atualizado. */
export function useRoomTypes() {
  const [rows, setRows] = useState<RuleRow[]>([]);
  const reload = useCallback(() => api.listRules("tipos_divisao").then(setRows, () => {}), []);
  useEffect(() => {
    void reload();
    window.addEventListener(RULES_CHANGED, reload);
    return () => window.removeEventListener(RULES_CHANGED, reload);
  }, [reload]);
  const catalog = buildRoomTypeCatalog(rows);

  /** Cria um tipo novo (fica como proposta em Regras → Tipos de divisão) e devolve o código. */
  const create = useCallback(async (name: string, base: string | null) => {
    const row = await api.createRule("tipos_divisao", { nome: name, ...(base ? { defaults_como: base } : {}) }, "proposta");
    setRows((rs) => [...rs, row]);
    window.dispatchEvent(new Event(RULES_CHANGED));
    return String(row.values.codigo);
  }, []);

  return { catalog, custom: catalog.filter((t) => !t.builtin).map((t) => ({ code: t.code, label: t.label })), create };
}
