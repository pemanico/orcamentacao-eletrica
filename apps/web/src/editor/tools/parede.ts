import { dist } from "@orc/core";
import { uid } from "../util";
import type { ToolHandler } from "./types";

const DEFAULT_WALL_T = 0.15;

/** Parede: clique a clique; cada clique fecha um segmento a partir do anterior. */
export const parede: ToolHandler<"parede"> = {
  id: "parede",
  label: "Parede",
  key: "W",
  help: "Clica ponto a ponto ao longo das paredes. Esc ou duplo clique termina. Orto ligado: segmentos horizontais/verticais (Shift inverte).",
  orthoFromDraft: true,

  pointerDown(ctx, { raw }) {
    const last = ctx.draft[ctx.draft.length - 1] ?? null;
    const p = ctx.snap(raw, last).point;
    if (last && dist(last, p) * ctx.k < 3) return; // clique repetido no mesmo sítio
    if (last) ctx.commit((s) => ({ ...s, walls: [...s.walls, { id: uid(), a: last, b: p, thicknessM: DEFAULT_WALL_T }] }));
    ctx.setDraft([p]);
  },

  doubleClick(ctx) {
    ctx.cancelDraft();
  },
};
