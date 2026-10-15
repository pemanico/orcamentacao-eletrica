import { z } from "zod";
import { ROOM_TYPES } from "./types";

/** Validação do estado do piso nas fronteiras (API, ficheiros importados). */
const point = z.object({ x: z.number().finite(), y: z.number().finite() });

export const floorStateSchema = z.object({
  scale: z
    .object({
      metersPerUnit: z.number().positive(),
      refA: point,
      refB: point,
      refMeters: z.number().positive(),
      stampDenominator: z.number().int().positive().nullable().optional(),
    })
    .nullable(),
  walls: z.array(
    z.object({ id: z.string().min(1), a: point, b: point, thicknessM: z.number().positive().max(1) }),
  ),
  openings: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(["porta", "janela"]),
      wallId: z.string().min(1),
      t: z.number().min(0).max(1),
      widthM: z.number().positive().max(6),
      hinge: z.enum(["inicio", "fim"]),
      swing: z.enum(["esquerda", "direita"]),
    }),
  ),
  rooms: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().max(80),
      types: z.array(z.enum(ROOM_TYPES)),
      polygon: z.array(point),
    }),
  ),
});
