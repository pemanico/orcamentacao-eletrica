import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countDiffers, placeRoom, placementKind, pointCounts, pointInPolygon, proposePoints, roomAt, type FloorState, type Room, type RoomProposal } from "../src/index";

// 1 unidade = 1 cm. Divisão 4×3 m; janela de 1,2 m ao centro da parede de cima (y = 0);
// porta de 0,8 m na parede de baixo (y = 300), centro em x = 100, dobradiça no início (x = 60).
const scale = { metersPerUnit: 0.01, refA: { x: 0, y: 0 }, refB: { x: 100, y: 0 }, refMeters: 1 };
const room: Room = { id: "q", name: "Quarto", types: ["quarto"], polygon: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] };
const state: FloorState = {
  scale,
  walls: [
    { id: "cima", a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thicknessM: 0.2 },
    { id: "baixo", a: { x: 0, y: 300 }, b: { x: 400, y: 300 }, thicknessM: 0.2 },
  ],
  openings: [
    { id: "jan", kind: "janela", wallId: "cima", t: 0.5, widthM: 1.2, hinge: "inicio", swing: "esquerda" },
    { id: "por", kind: "porta", wallId: "baixo", t: 0.25, widthM: 0.8, hinge: "inicio", swing: "esquerda" },
  ],
  rooms: [room],
  points: [],
};
const place = (need: Record<string, number>) => placeRoom(room, new Map(Object.entries(need)), state, scale);
const near = (p: { x: number; y: number }, x: number, y: number) => Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5;

describe("F2 — colocação automática", () => {
  it("tipo de colocação pelo código do elemento", () => {
    assert.equal(placementKind("ponto_luz"), "teto");
    assert.equal(placementKind("foco"), "teto");
    assert.equal(placementKind("interruptor_comutado"), "porta");
    assert.equal(placementKind("interruptor_estore"), "junto_janela");
    assert.equal(placementKind("estore_motor"), "janela");
    assert.equal(placementKind("tomada_tv"), "parede");
    assert.equal(placementKind("qualquer_coisa"), "parede");
  });

  it("uma luz ao centro; quatro em grelha, todas dentro e distintas", () => {
    assert.ok(near(place({ ponto_luz: 1 })[0]!.point, 200, 150));
    const four = place({ ponto_luz: 4 }).map((p) => p.point);
    assert.equal(four.length, 4);
    assert.equal(new Set(four.map((p) => `${p.x},${p.y}`)).size, 4);
    for (const p of four) assert.ok(pointInPolygon(p, room.polygon));
  });

  it("interruptor junto à porta, do lado do fecho, 15 cm para dentro", () => {
    const [s] = place({ interruptor: 1 });
    // fecho em x = 140; +15 cm ao longo da parede, 15 cm para dentro
    assert.ok(near(s!.point, 155, 285), JSON.stringify(s));
    // com a dobradiça no fim, o fecho passa para x = 60
    const flipped = placeRoom(room, new Map([["interruptor", 1]]), { ...state, openings: state.openings.map((o) => (o.id === "por" ? { ...o, hinge: "fim" as const } : o)) }, scale);
    assert.ok(near(flipped[0]!.point, 45, 285), JSON.stringify(flipped[0]));
  });

  it("interruptores a mais do que portas vão para as paredes", () => {
    const pts = place({ interruptor_comutado: 3 });
    assert.equal(pts.length, 3);
    assert.ok(near(pts[0]!.point, 155, 285));
    for (const p of pts) assert.ok(pointInPolygon(p.point, room.polygon));
  });

  it("estore: motor na janela, comando ao lado", () => {
    const pts = place({ estore_motor: 1, interruptor_estore: 1 });
    assert.ok(near(pts.find((p) => p.elemento === "estore_motor")!.point, 200, 10));
    assert.ok(near(pts.find((p) => p.elemento === "interruptor_estore")!.point, 280, 15));
  });

  it("tomadas pelo contorno, dentro da divisão, fora dos vãos (vão ± 30 cm) e dos cantos", () => {
    const pts = place({ tomada: 6, tomada_tv: 1 }).map((p) => p.point);
    assert.equal(pts.length, 7);
    for (const p of pts) {
      assert.ok(pointInPolygon(p, room.polygon));
      if (p.y < 20) assert.ok(Math.abs(p.x - 200) >= 90, `tomada em cima da janela: ${JSON.stringify(p)}`);
      if (p.y > 280) assert.ok(Math.abs(p.x - 100) >= 70, `tomada em cima da porta: ${JSON.stringify(p)}`);
    }
  });

  it("voltar a propor: substitui os auto, mantém ajustados/manuais e só completa o que falta", () => {
    const proposals: RoomProposal[] = [
      { roomId: "q", roomName: "Quarto", metrics: { areaM2: 12, perimeterM: 14 }, elements: [{ elemento: "tomada", quantidade: 3, contributions: [] }], typesWithoutRules: [], pending: [] },
    ];
    let n = 0;
    const id = () => `n${++n}`;
    const before: FloorState = {
      ...state,
      points: [
        { id: "a1", roomId: "q", elemento: "tomada", x: 10, y: 10, origem: "auto" },
        { id: "m1", roomId: "q", elemento: "tomada", x: 50, y: 50, origem: "manual" },
        { id: "j1", roomId: "q", elemento: "tomada", x: 60, y: 60, origem: "ajustado" },
        { id: "x1", roomId: "apagada", elemento: "tomada", x: 1, y: 1, origem: "manual" },
      ],
    };
    const r = proposePoints(before, proposals, id);
    assert.deepEqual(r.points.map((p) => p.id).sort(), ["j1", "m1", "n1"]);
    assert.deepEqual([r.added, r.removed, r.kept], [1, 2, 2]);
  });

  it("divisão de um ponto: a mais pequena quando há sobreposição", () => {
    const small: Room = { id: "s", name: "Closet", types: ["closet"], polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    assert.equal(roomAt([room, small], { x: 50, y: 50 })?.id, "s");
    assert.equal(roomAt([room, small], { x: 300, y: 200 })?.id, "q");
    assert.equal(roomAt([room], { x: 900, y: 900 }), null);
  });
});

describe("F2 — contagens por divisão (regras vs planta)", () => {
  const props: RoomProposal[] = [
    {
      roomId: "q",
      roomName: "Quarto",
      metrics: { areaM2: 12, perimeterM: 14 },
      elements: [
        { elemento: "tomada", quantidade: 3, contributions: [] },
        { elemento: "ponto_luz", quantidade: 1, contributions: [] },
      ],
      typesWithoutRules: [],
      pending: [],
    },
  ];
  const pt = (id: string, elemento: string, roomId = "q") => ({ id, roomId, elemento, x: 0, y: 0, origem: "manual" as const });

  it("previsto vs colocado, elementos só de um lado, equipamentos do piso à parte", () => {
    const rows = pointCounts({ rooms: [room], points: [pt("1", "tomada"), pt("2", "tomada"), pt("3", "ponto_luz"), pt("4", "tomada_rede"), pt("5", "quadro_eletrico"), pt("6", "tomada", "apagada")] }, props);
    assert.deepEqual(
      rows.map((r) => [r.elemento, r.previsto, r.colocado, countDiffers(r)]),
      [
        ["ponto_luz", 1, 1, false],
        ["quadro_eletrico", 0, 1, false],
        ["tomada", 3, 2, true],
        ["tomada_rede", 0, 1, true],
      ],
    );
  });
});
