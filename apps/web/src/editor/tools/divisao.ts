import { dist } from "@orc/core";
import type { ToolHandler } from "./types";

/** Divisão: cantos clique a clique; fecha no primeiro ponto, com Enter ou duplo clique. */
export const divisao: ToolHandler<"divisao"> = {
  id: "divisao",
  label: "Divisão",
  key: "D",
  help: "Clica nos cantos da divisão. Fecha clicando no primeiro ponto ou com Enter. Em open space, desenha uma área e escolhe vários tipos.",
  orthoFromDraft: true,
  draftPolygon: true,

  pointerDown(ctx, { raw }) {
    const { draft } = ctx;
    const last = draft[draft.length - 1] ?? null;
    const p = ctx.snap(raw, last).point;
    const first = draft[0];
    // fechar no primeiro ponto: a menos de SNAP_PX píxeis (snapTol em unidades de página)
    if (first && draft.length >= 3 && dist(first, p) <= ctx.snapTol) return ctx.finishRoom(draft);
    if (last && dist(last, p) * ctx.k < 3) return;
    ctx.setDraft([...draft, p]);
  },

  doubleClick(ctx) {
    if (ctx.draft.length >= 3) ctx.finishRoom(ctx.draft);
  },

  keyDown(ctx, e) {
    if (e.key !== "Enter") return false;
    ctx.finishRoom(ctx.draft);
    return true;
  },
};
