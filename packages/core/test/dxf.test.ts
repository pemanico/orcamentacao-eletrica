import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DxfError,
  PAGE_UNITS_PER_METER,
  cleanMText,
  defaultSnapLayer,
  defaultVisibleLayer,
  dxfToPage,
  guessRoomType,
  guessUnits,
  labelForPolygon,
  looksLikeRoomName,
  parseDxf,
  segmentTouchesRegion,
  type Region,
} from "../src/index.ts";

const text = readFileSync(new URL("./fixtures/moradia_sintetica.dxf", import.meta.url), "utf8");
const d = parseDxf(text);
const planA: Region = { minX: -1, minY: -3, maxX: 18, maxY: 10 };

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

describe("leitor de DXF", () => {
  it("lê cabeçalho, layers e ignora o espaço de papel", () => {
    assert.equal(d.version, "AC1032");
    assert.equal(d.headerUnits, 5);
    const names = d.layers.map((l) => l.name);
    assert.ok(names.includes("arq_corte"));
    assert.ok(!names.includes("FA FOLHA"), "linha do espaço de papel não pode entrar");
    assert.equal(d.skipped.HATCH, 2);
  });

  it("paredes fechadas (LWPOLYLINE) dão 4 segmentos cada", () => {
    // 8 paredes por planta × 2 plantas × 4 lados
    assert.equal(d.layers.find((l) => l.name === "arq_corte")!.segments, 64);
  });

  it("expande blocos com rotação e escala, e a layer 0 herda a do INSERT", () => {
    const mesa = d.segments.filter((s) => s.layer === "arq_mobiliario" && s.a.x < 20);
    assert.equal(mesa.length, 4);
    // mesa 0,8 × 0,4 escalada 2× e rodada 90° em (3,3): ocupa x ∈ [2,2; 3], y ∈ [3; 4,6]
    const xs = mesa.flatMap((s) => [s.a.x, s.b.x]);
    const ys = mesa.flatMap((s) => [s.a.y, s.b.y]);
    close(Math.min(...xs), 2.2);
    close(Math.max(...xs), 3);
    close(Math.min(...ys), 3);
    close(Math.max(...ys), 4.6);
  });

  it("aproxima o arco da porta (bulge) por vários segmentos sobre o círculo", () => {
    const arc = d.segments.filter((s) => s.layer === "arq_vista 1" && s.a.x < 20);
    assert.ok(arc.length >= 2, `esperava vários segmentos, há ${arc.length}`);
    // quarto de círculo de raio 1 centrado em (5,0)
    for (const s of arc) close(Math.hypot(s.b.x - 5, s.b.y - 0), 1, 1e-6);
  });

  it("limpa a formatação dos textos", () => {
    assert.ok(d.texts.some((t) => t.text === "Sala de estar/jantar"));
    assert.equal(cleanMText("{\\fArial|b1;Quarto}\\P1"), "Quarto 1");
    assert.equal(cleanMText("\\U+00D81,50"), "Ø1,50");
  });

  it("rejeita o que não é DXF em texto", () => {
    assert.throws(() => parseDxf("AC1032 binário"), DxfError);
  });
});

describe("unidades", () => {
  it("as cotas mostram metros mesmo com o cabeçalho a dizer centímetros", () => {
    const g = guessUnits(d, planA);
    assert.equal(g.unit, "m");
    assert.equal(g.basis, "cotas");
    assert.equal(g.headerDisagrees, true);
  });

  it("sem cotas usa o cabeçalho; sem cabeçalho usa o tamanho", () => {
    assert.equal(guessUnits({ dimensions: [], headerUnits: 4, extents: null }).unit, "mm");
    assert.equal(guessUnits({ dimensions: [], headerUnits: null, extents: { minX: 0, minY: 0, maxX: 1400, maxY: 900 } }).unit, "cm");
  });
});

describe("região → página", () => {
  it("y passa a crescer para baixo e 1 m = unidades de página a 1:100", () => {
    const t = dxfToPage(planA, "m");
    const p = t.toPage({ x: 0, y: 0 });
    close(p.x, 1 * PAGE_UNITS_PER_METER);
    close(p.y, 10 * PAGE_UNITS_PER_METER);
    close(t.width, 19 * PAGE_UNITS_PER_METER);
  });

  it("só a planta A fica na região (a cópia B e a topografia ficam de fora)", () => {
    const inside = d.segments.filter((s) => segmentTouchesRegion(s, planA));
    assert.ok(inside.every((s) => s.a.x < 25 && s.b.x < 25));
    assert.equal(inside.filter((s) => s.layer === "arq_corte").length, 32);
  });

  it("layers por defeito: snap nas paredes, tramas e topografia escondidas", () => {
    assert.equal(defaultSnapLayer("arq_corte"), true);
    assert.equal(defaultSnapLayer("arq_vista 1"), false);
    assert.equal(defaultVisibleLayer("arq_tramas"), false);
    assert.equal(defaultVisibleLayer("TOP_CV_MESTRA"), false);
    assert.equal(defaultVisibleLayer("arq_texto"), true);
  });
});

describe("nomes das divisões", () => {
  it("reconhece os nomes do arquiteto", () => {
    const cases: [string, string | null][] = [
      ["Sala de estar/jantar", "sala"],
      ["IS.2", "casa_de_banho"],
      ["IS. 4", "casa_de_banho"],
      ["Hall 3", "hall"],
      ["Circulação", "corredor"],
      ["Escritório", "escritorio"],
      ["Dispensa", "arrumos"],
      ["Alpendre 1", "exterior"],
      ["Garagem", "garagem"],
      ["Coisa", null],
    ];
    for (const [t, exp] of cases) assert.equal(guessRoomType(t), exp, t);
  });

  it("ignora siglas, cotas e títulos de desenhos", () => {
    for (const t of ["QE.", "MLL.", "CS 569.50", "Alçado frontal", "Perfil P1", "4,20", "12.5 m²"]) assert.equal(looksLikeRoomName(t), false, t);
  });

  it("encontra o rótulo dentro da divisão desenhada", () => {
    const poly = [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 9 }, { x: 0, y: 9 }];
    const labels = d.texts.filter((t) => t.at.x < 20).map((t) => ({ text: t.text, at: t.at }));
    assert.equal(labelForPolygon(poly, labels)?.text, "Sala de estar/jantar", "o QE. também está dentro mas não é nome");
    assert.equal(labelForPolygon([{ x: 20, y: 20 }, { x: 21, y: 20 }, { x: 21, y: 21 }], labels), null);
  });
});
