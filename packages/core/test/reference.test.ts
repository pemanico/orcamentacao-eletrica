import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inferLoad, loadInconsistencies, mergeSources, parseReference, planReferenceFill, type RuleRow } from "../src/index";

const reference = parseReference(readFileSync(fileURLToPath(new URL("../../../regras/referencia_rtiebt.csv", import.meta.url)), "utf8"));

const row = (id: string, values: RuleRow["values"], over: Partial<RuleRow> = {}): RuleRow => ({
  id,
  table: "tipos_circuito",
  position: 10,
  values,
  state: "a_definir",
  source: "",
  notes: "",
  updatedAt: "",
  approvedAt: null,
  ...over,
});

describe("Referência RTIEBT", () => {
  it("lê o ficheiro de referência (BOM, vírgula decimal) com fonte em todas as linhas", () => {
    assert.ok(reference.length > 50);
    for (const r of reference) assert.ok(r.fonte, `${r.grupo}/${r.chave} sem fonte`);
    const fogao = reference.find((r) => r.grupo === "seccao_minima_habitacao" && r.chave === "fogao");
    assert.equal(fogao?.valor, "4");
    assert.match(fogao!.fonte, /801\.5\.8/);
  });

  it("deduz a carga só quando é óbvia", () => {
    assert.equal(inferLoad("tipos_circuito", { tipo: "tomadas", agrupamento: "sala" }), "tomadas");
    assert.equal(inferLoad("tipos_circuito", { tipo: "iluminacao", agrupamento: "quartos" }), "iluminacao");
    assert.equal(inferLoad("tipos_circuito", { tipo: "dedicado", agrupamento: "forno" }), "fogao");
    assert.equal(inferLoad("tipos_circuito", { tipo: "dedicado", agrupamento: "máquina de lavar loiça" }), "maquinas_lavar");
    assert.equal(inferLoad("tipos_circuito", { tipo: "dedicado", agrupamento: "carregador VE (se existir)" }), "ve");
    assert.equal(inferLoad("tipos_circuito", { tipo: "dedicado", agrupamento: "bomba de calor" }), "climatizacao");
    assert.equal(inferLoad("equipamentos", { equipamento: "placa" }), "fogao");
    assert.equal(inferLoad("tipos_circuito", { tipo: "dedicado", agrupamento: "portão" }), null);
  });

  it("preenche só células vazias, fica em proposta e acrescenta a fonte", () => {
    const rows = [
      row("a", { codigo: "C1", tipo: "tomadas", carga: "tomadas", agrupamento: "sala", seccao_mm2: null, disjuntor_A: null, n_condutores: null, max_pontos: null, diferencial: null }, { source: "Ordep" }),
      row("b", { codigo: "C6", tipo: "dedicado", carga: "fogao", agrupamento: "forno", seccao_mm2: 6, disjuntor_A: null, n_condutores: null, max_pontos: null, diferencial: null }),
      row("c", { codigo: "C9", tipo: "iluminacao", carga: "iluminacao", agrupamento: "quartos", seccao_mm2: null }, { state: "aprovada" }),
      row("d", { codigo: "X", tipo: "dedicado", carga: null, agrupamento: "portão" }),
      row("e", { codigo: "VE", tipo: "dedicado", carga: "ve", agrupamento: "carregador", diferencial: null }),
    ];
    const plan = planReferenceFill("tipos_circuito", rows, reference);
    const a = plan.updates.find((u) => u.id === "a")!;
    assert.equal(a.values.seccao_mm2, 2.5);
    assert.equal(a.values.n_condutores, 3);
    assert.equal(a.values.max_pontos, 8);
    assert.equal(a.values.disjuntor_A, null, "o RTIEBT não fixa o disjuntor: não se inventa");
    assert.equal(a.state, "proposta");
    assert.match(a.source, /^Ordep; RTIEBT 801\.5\.8/);
    const b = plan.updates.find((u) => u.id === "b")!;
    assert.equal(b.values.seccao_mm2, 6, "valor já preenchido não é sobrescrito");
    assert.ok(!plan.updates.some((u) => u.id === "c"), "linha aprovada não é tocada");
    assert.deepEqual(plan.skipped.map((s) => s.label), ["X — portão"]);
    const e = plan.updates.find((u) => u.id === "e")!;
    assert.match(String(e.values.diferencial), /30 mA tipo A/);
    assert.equal(e.values.max_pontos, 1);
  });

  it("parâmetros: acrescenta só os que faltam", () => {
    const existing = [row("p", { parametro: "Queda de tensão máx. — iluminação", valor: 3, unidade: "%" }, { table: "parametros" })];
    const plan = planReferenceFill("parametros", existing, reference);
    assert.equal(plan.inserts.length, 5);
    const pot = plan.inserts.find((i) => i.label.includes("mais de 6"))!;
    assert.equal(pot.values.valor, 10.35);
    assert.match(pot.source, /801\.5\.2\.2/);
  });

  it("junta fontes sem repetir", () => {
    assert.equal(mergeSources("Ordep; RTIEBT 801.5.8, DR p.163", ["RTIEBT 801.5.8, DR p.163", "RTIEBT 722.311"]), "Ordep; RTIEBT 801.5.8, DR p.163; RTIEBT 722.311");
  });

  it("avisa quando linhas da mesma carga têm valores diferentes", () => {
    const msgs = loadInconsistencies([
      row("a", { codigo: "C1", carga: "tomadas", seccao_mm2: 2.5, disjuntor_A: 16 }),
      row("b", { codigo: "C5", carga: "tomadas", seccao_mm2: 4, disjuntor_A: 16 }),
    ]);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0]!, /tomadas — secção diferente \(C1: 2,5 · C5: 4\)/);
  });
});
