import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { parseCsv } from "@orc/core";
import { buildApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { backfillLoads, backfillQuantityBase } from "../src/rules.ts";

const seedDir = fileURLToPath(new URL("../../../regras", import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), "orc-rules-"));
const db = openDb(join(dataDir, "t.db"));
const server = buildApp({ db, dataDir, rulesSeedDir: seedDir });
let base = "";

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const req = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any; text: string; headers: Headers }> => {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* CSV */
  }
  return { status: res.status, body: parsed, text, headers: res.headers };
};

describe("Regras", () => {
  it("carrega os valores iniciais dos CSV, sem aprovar nada", async () => {
    const r = await req("GET", "/api/rules");
    const by = Object.fromEntries(r.body.map((t: { id: string }) => [t.id, t]));
    assert.equal(by.defaults_divisao.total, 37);
    assert.equal(by.tipos_circuito.total, 18);
    assert.equal(by.parametros.total, 3);
    for (const t of r.body) assert.equal(t.pending, t.total, `${t.id} não devia ter nada aprovado`);

    const rows = (await req("GET", "/api/rules/defaults_divisao")).body;
    const corredor = rows.find((x: { values: { divisao: string; elemento: string } }) => x.values.divisao === "corredor" && x.values.elemento === "interruptor_comutado");
    assert.equal(corredor.values.quantidade, 2);
    assert.match(corredor.notes, /início e fim; com mais de 2 portas/);
  });

  it("a carga inicial não volta a correr nem duplica", async () => {
    const again = buildApp({ db, dataDir, rulesSeedDir: seedDir });
    again.close();
    const r = await req("GET", "/api/rules");
    assert.equal(r.body.find((t: { id: string }) => t.id === "defaults_divisao").total, 37);
  });

  it("valida os valores e aceita vírgula decimal", async () => {
    const rows = (await req("GET", "/api/rules/parametros")).body;
    const hora = rows.find((x: { values: { parametro: string } }) => x.values.parametro === "preço da hora");
    const bad = await req("PUT", `/api/rules/parametros/${hora.id}`, { values: { valor: "abc" } });
    assert.equal(bad.status, 400);
    const ok = await req("PUT", `/api/rules/parametros/${hora.id}`, { values: { valor: "32,5" } });
    assert.equal(ok.body.values.valor, 32.5);
  });

  it("tabela técnica não aprova sem valores nem sem fonte", async () => {
    const rows = (await req("GET", "/api/rules/tipos_circuito")).body;
    const c1 = rows.find((x: { values: { codigo: string } }) => x.values.codigo === "C1");
    const noValues = await req("PUT", `/api/rules/tipos_circuito/${c1.id}`, { state: "aprovada" });
    assert.equal(noValues.status, 422);
    assert.ok(noValues.body.blockers.includes("falta secção"));

    const values = { seccao_mm2: "2,5", disjuntor_A: 16, n_condutores: 3, diferencial: "30 mA" };
    const noSource = await req("PUT", `/api/rules/tipos_circuito/${c1.id}`, { values, source: "", state: "aprovada" });
    assert.equal(noSource.status, 422);
    assert.deepEqual(noSource.body.blockers, ["falta a fonte"]);

    const ok = await req("PUT", `/api/rules/tipos_circuito/${c1.id}`, { values, source: "formador (exemplo de teste)", state: "aprovada" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.state, "aprovada");
    assert.ok(ok.body.approvedAt);

    // mudar um valor de uma regra aprovada retira a aprovação
    const changed = await req("PUT", `/api/rules/tipos_circuito/${c1.id}`, { values: { disjuntor_A: 20 } });
    assert.equal(changed.body.state, "proposta");
    assert.equal(changed.body.approvedAt, null);
  });

  it("cria e apaga linhas", async () => {
    const created = await req("POST", "/api/rules/equipamentos", { values: { equipamento: "sauna" } });
    assert.equal(created.status, 201);
    assert.equal(created.body.state, "a_definir");
    assert.equal((await req("DELETE", `/api/rules/equipamentos/${created.body.id}`)).status, 200);
    assert.equal((await req("DELETE", `/api/rules/equipamentos/${created.body.id}`)).status, 404);
  });

  it("exporta CSV para o Excel (BOM, ';', vírgula decimal) e o CSV volta a ler-se", async () => {
    const r = await req("GET", "/api/rules/parametros/export");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition") ?? "", /regras-export-parametros-/);
    // o fetch remove o BOM ao descodificar: confirmar nos bytes
    const raw = new Uint8Array(await (await fetch(base + "/api/rules/parametros/export")).arrayBuffer());
    assert.deepEqual([...raw.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const rows = parseCsv(r.text);
    assert.equal(rows.find((x) => x.parametro === "preço da hora")?.valor, "32,5");
  });

  it("tipos de divisão do utilizador: código gerado, únicos, protegidos enquanto em uso", async () => {
    const a = await req("POST", "/api/rules/tipos_divisao", { values: { nome: "Sala de Jogos" }, state: "proposta" });
    assert.equal(a.status, 201);
    assert.equal(a.body.values.codigo, "sala_de_jogos");
    assert.equal(a.body.state, "proposta");
    const b = await req("POST", "/api/rules/tipos_divisao", { values: { nome: "Sala de jogos" } });
    assert.equal(b.body.values.codigo, "sala_de_jogos_2", "nunca colide com um código existente");
    assert.equal((await req("POST", "/api/rules/tipos_divisao", { values: { nome: "x", codigo: "quarto" } })).status, 400, "não pode ser um tipo base");
    assert.equal((await req("PUT", `/api/rules/tipos_divisao/${b.body.id}`, { values: { codigo: "sala_de_jogos" } })).status, 409);

    // os defaults aceitam o tipo novo e recusam tipos inexistentes
    const d = await req("POST", "/api/rules/defaults_divisao", { values: { divisao: "sala_de_jogos", elemento: "ponto_luz", quantidade: 2 } });
    assert.equal(d.status, 201);
    assert.equal((await req("POST", "/api/rules/defaults_divisao", { values: { divisao: "inventado" } })).status, 400);
    assert.equal((await req("POST", "/api/rules/defaults_divisao", { values: { divisao: "closet", elemento: "ponto_luz" } })).status, 201, "closet é um tipo base");

    // em uso nos defaults: não se apaga nem muda de código
    const del = await req("DELETE", `/api/rules/tipos_divisao/${a.body.id}`);
    assert.equal(del.status, 409);
    assert.match(del.body.error, /Defaults por divisão/);
    assert.equal((await req("PUT", `/api/rules/tipos_divisao/${a.body.id}`, { values: { codigo: "jogos" } })).status, 409);
    assert.equal((await req("PUT", `/api/rules/tipos_divisao/${a.body.id}`, { values: { nome: "Sala de jogos e cinema" } })).status, 200, "o nome muda à vontade");
    await req("DELETE", `/api/rules/defaults_divisao/${d.body.id}`);

    // em uso numa divisão desenhada
    db.prepare("INSERT INTO projects (id, name, client, address) VALUES ('p1', 'Moradia X', '', '')").run();
    db.prepare(
      "INSERT INTO floors (id, project_id, name, ceiling_height_m, pdf_file, pdf_original_name, state_json) VALUES ('f1', 'p1', '0', 2.6, 'a.pdf', 'a.pdf', ?)",
    ).run(JSON.stringify({ scale: null, walls: [], openings: [], rooms: [{ id: "r1", name: "Jogos", types: ["sala_de_jogos"], polygon: [] }] }));
    const del2 = await req("DELETE", `/api/rules/tipos_divisao/${a.body.id}`);
    assert.equal(del2.status, 409);
    assert.match(del2.body.error, /Moradia X · piso 0: Jogos/);
    db.prepare("DELETE FROM projects WHERE id = 'p1'").run();
    assert.equal((await req("DELETE", `/api/rules/tipos_divisao/${a.body.id}`)).status, 200);
  });

  it("carga deduzida na carga inicial e nas linhas antigas", async () => {
    const tc = (await req("GET", "/api/rules/tipos_circuito")).body as { values: Record<string, unknown> }[];
    const by = (c: string) => tc.find((r) => r.values.codigo === c)!.values.carga;
    assert.equal(by("C1"), "tomadas");
    assert.equal(by("C6"), "fogao");
    assert.equal(by("C9"), "iluminacao");
    assert.equal(by("C12"), "climatizacao");
    const eq = (await req("GET", "/api/rules/equipamentos")).body as { values: Record<string, unknown> }[];
    assert.equal(eq.find((r) => r.values.equipamento === "carregador VE")!.values.carga, "ve");

    // linha criada antes de existir a coluna: sem a chave "carga"
    db.prepare("INSERT INTO rules (id, table_id, position, values_json, state) VALUES ('old1', 'tipos_circuito', 999, ?, 'proposta')").run(
      JSON.stringify({ codigo: "C99", tipo: "dedicado", agrupamento: "placa" }),
    );
    backfillLoads(db);
    const old = db.prepare("SELECT values_json FROM rules WHERE id = 'old1'").get() as { values_json: string };
    assert.equal(JSON.parse(old.values_json).carga, "fogao");
    db.prepare("DELETE FROM rules WHERE id = 'old1'").run();
  });

  it("preencher com referência: pré-visualiza sem gravar, aplica só em células vazias, uma vez", async () => {
    const before = (await req("GET", "/api/rules/tipos_circuito")).body;
    const preview = await req("GET", "/api/rules/tipos_circuito/reference-fill");
    assert.equal(preview.status, 200);
    assert.ok(preview.body.updates.length > 5);
    assert.deepEqual((await req("GET", "/api/rules/tipos_circuito")).body, before, "a pré-visualização não grava");

    const applied = await req("POST", "/api/rules/tipos_circuito/reference-fill");
    assert.equal(applied.body.updates.length, preview.body.updates.length);
    const rows = (await req("GET", "/api/rules/tipos_circuito")).body as { values: Record<string, unknown>; state: string; source: string }[];
    const c6 = rows.find((r) => r.values.codigo === "C6")!;
    assert.equal(c6.values.seccao_mm2, 4);
    assert.equal(c6.values.disjuntor_A, null);
    assert.equal(c6.state, "proposta");
    assert.match(c6.source, /^Ordep; RTIEBT 801\.5\.8/);
    const ve = rows.find((r) => r.values.carga === "ve")!;
    assert.equal(ve.state, "proposta", "a_definir passa a proposta, nunca a aprovada");

    const again = await req("GET", "/api/rules/tipos_circuito/reference-fill");
    assert.equal(again.body.updates.length, 0, "nada mais para preencher");

    const params = await req("POST", "/api/rules/parametros/reference-fill");
    assert.equal(params.body.inserts.length, 16);
    assert.equal((await req("POST", "/api/rules/parametros/reference-fill")).body.inserts.length, 0);

    assert.equal((await req("GET", "/api/rules/mao_de_obra/reference-fill")).status, 400);

    const ref = await req("GET", "/api/reference");
    assert.ok(ref.body.some((r: { grupo: string; chave: string; valor: string }) => r.grupo === "iz_pvc_cu_2carregados_B" && r.chave === "4" && r.valor === "32"));
  });

  it("defaults: \"por\" vem como por divisão na carga inicial e nas linhas antigas", async () => {
    const rows = (await req("GET", "/api/rules/defaults_divisao")).body as { values: Record<string, unknown> }[];
    assert.ok(rows.every((r) => r.values.por === "divisao" || r.values.elemento === "estore_motor" || r.values.elemento === "interruptor_estore"));
    assert.equal(rows.filter((r) => r.values.por === "janela").length, 4);
    db.prepare("INSERT INTO rules (id, table_id, position, values_json, state) VALUES ('old2', 'defaults_divisao', 999, ?, 'proposta')").run(
      JSON.stringify({ divisao: "hall", elemento: "ponto_luz", quantidade: 1 }),
    );
    backfillQuantityBase(db);
    const v = JSON.parse((db.prepare("SELECT values_json FROM rules WHERE id = 'old2'").get() as { values_json: string }).values_json);
    assert.equal(v.por, "divisao");
    db.prepare("DELETE FROM rules WHERE id = 'old2'").run();

    // por m sem "cada" não aprova
    const r = await req("POST", "/api/rules/defaults_divisao", { values: { divisao: "corredor", elemento: "ponto_luz", quantidade: 1, por: "m" } });
    const bad = await req("PUT", `/api/rules/defaults_divisao/${r.body.id}`, { state: "aprovada" });
    assert.equal(bad.status, 422);
    assert.match(bad.body.error, /falta "cada"/);
    const ok = await req("PUT", `/api/rules/defaults_divisao/${r.body.id}`, { values: { cada: "4" }, state: "aprovada" });
    assert.equal(ok.body.state, "aprovada");
    await req("DELETE", `/api/rules/defaults_divisao/${r.body.id}`);
  });

  it("tabela desconhecida dá 404", async () => {
    assert.equal((await req("GET", "/api/rules/inventada")).status, 404);
  });
});
