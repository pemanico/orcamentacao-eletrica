import type { HandleDrag, Selection, ToolHandler } from "./types";

/** Selecionar: clique seleciona, arrastar o fundo move a vista, pegas corrigem o elemento. */
export const selecionar: ToolHandler<"selecionar"> = {
  id: "selecionar",
  label: "Selecionar",
  key: "V",
  help: "Clica para selecionar. Arrasta o fundo para mover a vista. Arrasta as pegas de um elemento selecionado para o corrigir, ou um ponto para o mover. Delete apaga.",
  cursor: "default",

  pointerDown(ctx, { target }) {
    const handle = target.closest("[data-handle]");
    if (handle && ctx.selection) {
      const kind = handle.getAttribute("data-handle") as HandleDrag["kind"];
      const id = ctx.selection.id;
      ctx.startHandleDrag(kind === "room-v" ? { kind, id, index: Number(handle.getAttribute("data-index")) } : { kind, id });
      return;
    }
    // um ponto arrasta-se logo (e fica selecionado), sem pegas
    const pt = target.closest('[data-kind="point"]');
    if (pt) {
      const id = pt.getAttribute("data-id")!;
      ctx.setSelection({ kind: "point", id });
      ctx.startHandleDrag({ kind: "point", id });
      return;
    }
    // arrastar move a vista; um clique sem arrasto seleciona o que estiver por baixo
    const el = target.closest("[data-kind]");
    ctx.startPan(el ? ({ kind: el.getAttribute("data-kind"), id: el.getAttribute("data-id")! } as Selection) : "none");
  },

  pointerMove(ctx, raw) {
    ctx.setCursor({ point: raw, kind: "livre" });
  },

  /** pegas de edição do elemento selecionado */
  overlay({ state, selection, sw }) {
    if (selection?.kind === "wall") {
      const w = state.walls.find((x) => x.id === selection.id);
      return w ? (["a", "b"] as const).map((end) => <circle key={end} data-handle={`wall-${end}`} cx={w[end].x} cy={w[end].y} r={sw(6)} className="handle" />) : null;
    }
    if (selection?.kind === "room") {
      const r = state.rooms.find((x) => x.id === selection.id);
      return r ? r.polygon.map((p, i) => <circle key={i} data-handle="room-v" data-index={i} cx={p.x} cy={p.y} r={sw(6)} className="handle" />) : null;
    }
    return null;
  },
};
