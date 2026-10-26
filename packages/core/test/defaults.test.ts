import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RULE_TABLES, approvalBlockers, defaultQuantity, inferLoad, roomLengthM, windowsInRoom, type FloorState } from "../src/index";

const corredor8x1_2 = { areaM2: 8 * 1.2, perimeterM: 2 * (8 + 1.2) };

describe("Defaults por divisão: quantidade por divisão, m² ou m", () => {
  it("comprimento de um corredor retangular é o lado maior", () => {
    assert.ok(Math.abs(roomLengthM(corredor8x1_2) - 8) < 1e-9);
    assert.ok(Math.abs(roomLengthM({ areaM2: 16, perimeterM: 16 }) - 4) < 1e-9); // quadrado 4×4
  });

  it("por divisão: quantidade fixa (vazio conta como por divisão)", () => {
    assert.equal(defaultQuantity({ quantidade: 3, por: "divisao" }, corredor8x1_2), 3);
    assert.equal(defaultQuantity({ quantidade: 3, por: null }, corredor8x1_2), 3);
  });

  it("por m: 1 luz cada 4 m num corredor de 8 m dá 2; de 9 m dá 3", () => {
    assert.equal(defaultQuantity({ quantidade: 1, por: "m", cada: 4 }, corredor8x1_2), 2);
    assert.equal(defaultQuantity({ quantidade: 1, por: "m", cada: 4 }, { areaM2: 9 * 1.2, perimeterM: 2 * 10.2 }), 3);
  });

  it("por m²: 1 luz cada 6 m² numa cozinha de 14 m² dá 3; mínimo respeitado", () => {
    assert.equal(defaultQuantity({ quantidade: 1, por: "m2", cada: 6 }, { areaM2: 14, perimeterM: 15 }), 3);
    assert.equal(defaultQuantity({ quantidade: 1, por: "m2", cada: 6, minimo: 2 }, { areaM2: 4, perimeterM: 8 }), 2);
    assert.equal(defaultQuantity({ quantidade: 1, por: "m2", cada: 6 }, { areaM2: 2, perimeterM: 6 }), 1, "mínimo por omissão = quantidade");
  });

  it("não aprova \"por m\" sem o \"cada\"", () => {
    const def = RULE_TABLES.defaults_divisao;
    assert.deepEqual(approvalBlockers(def, { values: { divisao: "corredor", elemento: "ponto_luz", quantidade: 1, por: "m", cada: null }, source: "" }), [
      'falta "cada" (m² ou m)',
    ]);
    assert.deepEqual(approvalBlockers(def, { values: { divisao: "corredor", elemento: "ponto_luz", quantidade: 1, por: "m", cada: 4 }, source: "" }), []);
  });

  it("por janela: estores multiplicam pelas janelas; sem janelas, zero", () => {
    assert.equal(defaultQuantity({ quantidade: 1, por: "janela" }, { areaM2: 12, perimeterM: 14, windows: 2 }), 2);
    assert.equal(defaultQuantity({ quantidade: 1, por: "janela" }, { areaM2: 12, perimeterM: 14, windows: 0 }), 0);
    assert.equal(defaultQuantity({ quantidade: 1, por: "janela" }, { areaM2: 12, perimeterM: 14 }), 0);
  });

  it("conta só as janelas no contorno da divisão (parede traçada pela outra face conta)", () => {
    const M = 10; // 10 unidades = 1 m
    const scale = { metersPerUnit: 1 / M };
    // quarto 4×3 m com a parede de cima traçada 0,2 m acima do contorno (face exterior)
    const room = { polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }] };
    const state: Pick<FloorState, "walls" | "openings"> = {
      walls: [
        { id: "w1", a: { x: 0, y: -2 }, b: { x: 40, y: -2 }, thicknessM: 0.2 },
        { id: "w2", a: { x: 0, y: 30 }, b: { x: 40, y: 30 }, thicknessM: 0.15 },
        { id: "w3", a: { x: 100, y: 0 }, b: { x: 140, y: 0 }, thicknessM: 0.15 }, // outra divisão
      ],
      openings: [
        { id: "j1", kind: "janela", wallId: "w1", t: 0.5, widthM: 1.2, hinge: "inicio", swing: "esquerda" },
        { id: "j2", kind: "janela", wallId: "w2", t: 0.3, widthM: 1.2, hinge: "inicio", swing: "esquerda" },
        { id: "p1", kind: "porta", wallId: "w2", t: 0.8, widthM: 0.8, hinge: "inicio", swing: "esquerda" },
        { id: "j3", kind: "janela", wallId: "w3", t: 0.5, widthM: 1.2, hinge: "inicio", swing: "esquerda" },
      ],
    };
    assert.equal(windowsInRoom(room, state, scale), 2);
  });

  it("estores: tipo e texto dão a carga \"estores\"", () => {
    assert.equal(inferLoad("tipos_circuito", { tipo: "estores", agrupamento: "todos" }), "estores");
    assert.equal(inferLoad("tipos_circuito", { tipo: "dedicado", agrupamento: "estores elétricos" }), "estores");
  });
});
