import { formatM } from "../draw";
import type { ToolHandler } from "./types";

/** Calibrar: dois cliques nos extremos de uma cota; o diálogo pede o valor real. */
export const calibrar: ToolHandler<"calibrar"> = {
  id: "calibrar",
  label: "Calibrar",
  key: "C",
  help: "Clica nos dois extremos de uma cota conhecida (a mais longa possível) e indica o valor real.",
  // DXF: escala exata, não se calibra
  disabled: ({ isDxf }) => isDxf,

  pointerDown(ctx, { raw }) {
    const p = ctx.snap(raw, null).point;
    if (ctx.draft.length === 0) ctx.setDraft([p]);
    else {
      ctx.openCalibration(ctx.draft[0]!, p);
      ctx.setDraft([]);
    }
  },

  /** cota usada na calibração atual */
  overlay({ scale, sw, fs }) {
    if (!scale) return null;
    return (
      <g className="calib">
        <line x1={scale.refA.x} y1={scale.refA.y} x2={scale.refB.x} y2={scale.refB.y} strokeWidth={sw(1.5)} strokeDasharray={`${sw(6)} ${sw(4)}`} />
        <text x={(scale.refA.x + scale.refB.x) / 2} y={(scale.refA.y + scale.refB.y) / 2 - fs * 0.6} fontSize={fs} textAnchor="middle">
          {formatM(scale.refMeters)} m
        </text>
      </g>
    );
  },
};
