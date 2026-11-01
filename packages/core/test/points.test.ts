import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { floorStateSchema, geometryChanged, normalizeFloorState, validatePoints, type FloorState } from "../src/index";

const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const base: FloorState = {
  scale: null,
  walls: [],
  openings: [],
  rooms: [{ id: "r1", name: "Quarto", types: ["quarto"], polygon: sq }],
  points: [{ id: "p1", roomId: "r1", elemento: "tomada", x: 50, y: 50, origem: "auto" }],
};

describe("F2 — pontos no estado do piso", () => {
  it("pisos anteriores à F2 lêem-se com lista vazia (normalize e schema)", () => {
    const old = { scale: null, walls: [], openings: [], rooms: [] };
    assert.deepEqual(normalizeFloorState(old).points, []);
    assert.deepEqual(floorStateSchema.parse(old).points, []);
  });

  it("mexer só nos pontos não é mudança de geometria; mexer numa divisão é", () => {
    assert.equal(geometryChanged(base, { ...base, points: [] }), false);
    assert.equal(geometryChanged(base, { ...base, rooms: [{ ...base.rooms[0]!, name: "Suite" }] }), true);
  });

  it("valida pontos: sem pontos e divisão inexistente são erro; fora da divisão é aviso", () => {
    assert.deepEqual(validatePoints({ ...base, points: [] }).map((i) => i.level), ["erro"]);
    assert.deepEqual(validatePoints(base), []);
    const issues = validatePoints({
      ...base,
      points: [
        { ...base.points[0]!, id: "p2", roomId: "x" },
        { ...base.points[0]!, id: "p3", x: 500 },
      ],
    });
    assert.deepEqual(issues.map((i) => [i.level, i.ref]), [["erro", "p2"], ["aviso", "p3"]]);
  });

  it("schema rejeita origem desconhecida e elemento vazio", () => {
    assert.throws(() => floorStateSchema.parse({ ...base, points: [{ ...base.points[0]!, origem: "x" }] }));
    assert.throws(() => floorStateSchema.parse({ ...base, points: [{ ...base.points[0]!, elemento: " " }] }));
  });
});
