import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { breakerParam, parseReference, sizeCircuit, sizingOptions, sizingParameters, type RuleRow, type SizingInput } from "../src/index";

const ref = parseReference(readFileSync(fileURLToPath(new URL("../../../regras/referencia_rtiebt.csv", import.meta.url)), "utf8"));

const param = (parametro: string, valor: number, state: RuleRow["state"] = "aprovada"): RuleRow => ({
  id: parametro,
  table: "parametros",
  position: 0,
  values: { parametro, valor, unidade: null },
  state,
  source: "",
  notes: "",
  updatedAt: "",
  approvedAt: null,
});
const approvedParams = sizingParameters([...[10, 16, 20, 25, 32, 40].map((c) => param(breakerParam(c), c)), param("resistividade do cobre", 0.0225)]);

const base: SizingInput = {
  carga: "termoacumulador",
  potencia_W: 4600,
  cos_phi: 1,
  comprimento_m: 25,
  metodo: "B",
  temperatura_C: 35,
  circuitos_agrupados: 3,
  agrupamento: "mesmo_elemento",
};

describe("Dimensionamento (433.2 + 52-C1)", () => {
  it("exercício do CINEL refeito com o quadro 52-C1: 4 mm², não 6", () => {
    const r = sizeCircuit(base, ref, approvedParams);
    assert.ok(r.ok, r.errors.join("; "));
    assert.equal(r.IB, 20);
    assert.equal(r.In, 20);
    assert.ok(Math.abs(r.k! - 0.658) < 1e-9);
    assert.equal(r.seccao, 4);
    assert.ok(Math.abs(r.Iz! - 32 * 0.658) < 1e-9);
    assert.ok(Math.abs(r.quedaPct! - 2.4456) < 1e-3);
    assert.deepEqual(r.provisional, []);
    assert.ok(r.steps.every((s) => s.source), "todos os passos têm fonte");
  });

  it("respeita a secção mínima do 801.5.8 (fogão ≥ 4 mm² mesmo com pouca corrente)", () => {
    const r = sizeCircuit({ ...base, carga: "fogao", potencia_W: 3000, circuitos_agrupados: 1, temperatura_C: 30 }, ref, approvedParams);
    assert.equal(r.In, 16);
    assert.equal(r.seccao, 4);
  });

  it("iluminação: 1,5 mm² e só calibres aprovados (sem 6 A aprovado → 10 A)", () => {
    const params = sizingParameters([param(breakerParam(6), 6, "proposta"), param(breakerParam(10), 10), param("resistividade do cobre", 0.0225)]);
    const r = sizeCircuit({ ...base, carga: "iluminacao", potencia_W: 300, circuitos_agrupados: 1, temperatura_C: 30, comprimento_m: 20 }, ref, params);
    assert.equal(r.In, 10);
    assert.equal(r.seccao, 1.5);
  });

  it("queda de tensão faz subir a secção e avisa", () => {
    const r = sizeCircuit({ ...base, carga: "tomadas", potencia_W: 3680, circuitos_agrupados: 1, temperatura_C: 30, comprimento_m: 60 }, ref, approvedParams);
    assert.equal(r.In, 16);
    assert.equal(r.seccao, 4); // 2,5 mm² daria 6,9 %
    assert.match(r.warnings[0]!, /sobe de 2,5 para 4 mm²/);
  });

  it("método A (parede isolante) é mais exigente", () => {
    const r = sizeCircuit({ ...base, metodo: "A" }, ref, approvedParams);
    assert.equal(r.seccao, 6); // 4 mm²: 26 · 0,658 = 17,1 A < 20 A
  });

  it("valores por aprovar entram mas ficam sinalizados", () => {
    const params = sizingParameters([param(breakerParam(20), 20, "proposta"), param("resistividade do cobre", 0.0225, "a_definir")]);
    const r = sizeCircuit(base, ref, params);
    assert.ok(r.ok);
    assert.deepEqual(r.provisional, ["calibre 20 A", "resistividade do cobre"]);
  });

  it("sem calibres nem resistividade explica o que falta", () => {
    const r = sizeCircuit(base, ref, sizingParameters([]));
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 2);
  });

  it("opções da calculadora vêm dos quadros", () => {
    const o = sizingOptions(ref);
    assert.deepEqual(o.temperaturas, [10, 15, 20, 25, 30, 35, 40, 45, 50]);
    assert.deepEqual(o.agrupados.mesmo_elemento, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
