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
    assert.equal(by.defaults_divisao.total, 28);
    assert.equal(by.tipos_circuito.total, 17);
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
    assert.equal(r.body.find((t: { id: string }) => t.id === "defaults_divisao").total, 28);
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

  it("tabela desconhecida dá 404", async () => {
    assert.equal((await req("GET", "/api/rules/inventada")).status, 404);
  });
});
