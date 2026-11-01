import type { Opening, OpeningKind } from "@orc/core";
import { uid } from "../util";
import { openingGeometry } from "../draw";
import type { ToolHandler } from "./types";

const DEFAULT_WIDTH: Record<OpeningKind, number> = { porta: 0.8, janela: 1.2 };

/** Porta e janela: clique sobre uma parede já traçada; pré-visualização ao passar. */
function opening<K extends OpeningKind>(kind: K, label: string, key: string, help: string): ToolHandler<K> {
  const draftOpening = (wall: { id: string }, t: number): Opening => ({
    id: "preview",
    kind,
    wallId: wall.id,
    t,
    widthM: DEFAULT_WIDTH[kind],
    hinge: "inicio",
    swing: "esquerda",
  });
  return {
    id: kind,
    label,
    key,
    help,
    disabled: ({ scale }) => !scale,

    pointerDown(ctx, { raw }) {
      if (!ctx.scale) return ctx.setMessage("Calibra a escala antes de colocar portas e janelas.");
      const hit = ctx.nearestWall(raw);
      if (!hit) return ctx.setMessage("Clica sobre uma parede já traçada.");
      const widthM = DEFAULT_WIDTH[kind];
      const o: Opening = { ...draftOpening(hit.wall, ctx.clampT(hit.wall, hit.t, widthM)), id: uid() };
      ctx.commit((s) => ({ ...s, openings: [...s.openings, o] }));
      ctx.setSelection({ kind: "opening", id: o.id });
      ctx.setMessage(null);
    },

    pointerMove(ctx, raw) {
      ctx.setHoverWall(ctx.nearestWall(raw));
      ctx.setCursor({ point: raw, kind: "livre" });
    },

    overlay(ctx) {
      const { scale, hoverWall, sw } = ctx;
      if (!scale || !hoverWall) return null;
      const o = draftOpening(hoverWall.wall, ctx.clampT(hoverWall.wall, hoverWall.t, DEFAULT_WIDTH[kind]));
      const g = openingGeometry(hoverWall.wall, o, scale);
      return g ? <line x1={g.j1.x} y1={g.j1.y} x2={g.j2.x} y2={g.j2.y} strokeWidth={sw(7)} className="opening-preview" /> : null;
    },
  };
}

export const porta = opening("porta", "Porta", "P", "Clica sobre uma parede traçada. Depois, com a porta selecionada: F inverte o lado de abertura, H a dobradiça.");
export const janela = opening("janela", "Janela", "J", "Clica sobre uma parede traçada.");
