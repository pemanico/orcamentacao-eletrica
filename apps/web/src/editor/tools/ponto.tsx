import { roomAt } from "@orc/core";
import { PointSymbol } from "../symbols";
import { uid } from "../util";
import type { ToolHandler } from "./types";

/** Ponto: põe à mão o elemento escolhido no painel, dentro de uma divisão. */
export const ponto: ToolHandler<"ponto"> = {
  id: "ponto",
  label: "Ponto",
  key: "E",
  help: "Escolhe o elemento em Pontos, no painel, e clica dentro de uma divisão. A divisão fica atribuída automaticamente. Em Selecionar, arrasta um ponto para o mover.",
  disabled: ({ scale }) => !scale,

  pointerDown(ctx, { raw }) {
    if (!ctx.pointElement) return ctx.setMessage("Escolhe primeiro o elemento em Pontos, no painel.");
    const room = roomAt(ctx.state.rooms, raw);
    if (!room) return ctx.setMessage("Clica dentro de uma divisão. Zonas exteriores desenham-se como divisão do tipo Exterior.");
    const id = uid();
    ctx.commit((s) => ({ ...s, points: [...s.points, { id, roomId: room.id, elemento: ctx.pointElement!, x: raw.x, y: raw.y, origem: "manual" }] }));
    ctx.setMessage(null);
  },

  pointerMove(ctx, raw) {
    ctx.setCursor({ point: raw, kind: "livre" });
  },

  /** símbolo do elemento escolhido a seguir o cursor */
  overlay({ cursor, pointElement, sw }) {
    if (!cursor || !pointElement) return null;
    return (
      <g className="point-ghost" opacity={0.5}>
        <PointSymbol elemento={pointElement} x={cursor.point.x} y={cursor.point.y} sw={sw} />
      </g>
    );
  },
};
