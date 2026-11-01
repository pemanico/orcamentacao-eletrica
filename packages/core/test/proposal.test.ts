import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProposalError, buildRoomTypeCatalog, proposeFloor, proposeRoom, totalsByElement, type FloorState, type Room } from "../src/index";

// 1 unidade = 1 cm, para as contas se lerem em metros
const scale = { metersPerUnit: 0.01, refA: { x: 0, y: 0 }, refB: { x: 100, y: 0 }, refMeters: 1 };
const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const room = (id: string, types: string[], poly = rect(0, 0, 400, 300)): Room => ({ id, name: id, types, polygon: poly });

// quarto 4×3 m com uma janela na parede de cima
const state: FloorState = {
  scale,
  walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thicknessM: 0.2 }],
  openings: [{ id: "o1", kind: "janela", wallId: "w1", t: 0.5, widthM: 1.2, hinge: "inicio", swing: "esquerda" }],
  rooms: [],
};

let n = 0;
const row = (divisao: string, elemento: string, quantidade: number, extra: Record<string, string | number | null> = {}, st: "aprovada" | "proposta" = "aprovada") => ({
  id: `r${++n}`,
  state: st,
  values: { divisao, elemento, quantidade, ...extra },
});

const defaults = [
  row("quarto", "ponto_luz", 1),
  row("quarto", "tomada", 3),
  row("quarto", "estore_motor", 1, { por: "janela" }),
  row("quarto", "tomada_tv", 1, {}, "proposta"),
  row("sala", "tomada", 4),
  row("sala", "ponto_luz", 1, { por: "m2", cada: 10 }),
  row("cozinha", "tomada", 3),
  row("cozinha", "ponto_luz", 1, { por: "m2", cada: 6 }),
  row("cozinha", "tomada_forno", 1),
];
const catalog = buildRoomTypeCatalog([{ values: { codigo: "adega", nome: "Adega" } }, { values: { codigo: "suite", nome: "Suite", defaults_como: "quarto" } }]);

describe("F2 — proposta de quantidades por divisão", () => {
  it("quarto: só linhas aprovadas; estores pelas janelas; pendentes listadas à parte", () => {
    const p = proposeRoom(room("q1", ["quarto"]), state, defaults, catalog);
    assert.ok(Math.abs(p.metrics.areaM2 - 12) < 1e-9);
    assert.equal(p.metrics.windows, 1);
    assert.deepEqual(
      p.elements.map((e) => [e.elemento, e.quantidade]),
      [["estore_motor", 1], ["ponto_luz", 1], ["tomada", 3]],
    );
    assert.deepEqual(p.pending.map((x) => x.elemento), ["tomada_tv"]);
    assert.deepEqual(p.typesWithoutRules, []);
  });

  it("escritório e tipos do utilizador com base usam os defaults do quarto", () => {
    for (const t of ["escritorio", "suite"]) {
      const p = proposeRoom(room("x", [t]), state, defaults, catalog);
      assert.equal(p.elements.find((e) => e.elemento === "tomada")?.quantidade, 3, t);
    }
  });

  it("tipo sem defaults nem base: sem pontos e avisado", () => {
    const p = proposeRoom(room("a", ["adega"]), state, defaults, catalog);
    assert.deepEqual(p.elements, []);
    assert.deepEqual(p.typesWithoutRules, ["adega"]);
  });

  it("open space sala + cozinha (6×5 = 30 m²): maior valor por elemento, não a soma", () => {
    const p = proposeRoom(room("oc", ["sala", "cozinha"], rect(1000, 1000, 600, 500)), state, defaults, catalog);
    const q = Object.fromEntries(p.elements.map((e) => [e.elemento, e.quantidade]));
    assert.equal(q.tomada, 4); // max(4, 3)
    assert.equal(q.ponto_luz, 5); // max(30/10 = 3, 30/6 = 5)
    assert.equal(q.tomada_forno, 1);
    assert.equal(p.elements.find((e) => e.elemento === "ponto_luz")?.contributions.length, 2);
    assert.equal(p.metrics.windows, 0);
  });

  it("piso inteiro e totais por elemento", () => {
    const props = proposeFloor({ ...state, rooms: [room("q1", ["quarto"]), room("q2", ["quarto"], rect(500, 500, 300, 300))] }, defaults, catalog);
    const t = totalsByElement(props);
    assert.equal(t.get("tomada"), 6);
    assert.equal(t.get("estore_motor"), 1, "o segundo quarto não tem janela");
  });

  it("piso sem escala dá erro", () => {
    assert.throws(() => proposeRoom(room("q", ["quarto"]), { ...state, scale: null }, defaults, catalog), ProposalError);
  });
});
