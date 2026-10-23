import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";

const dataDir = mkdtempSync(join(tmpdir(), "orc-floors-"));
const db = openDb(join(dataDir, "t.db"));
const server = buildApp({ db, dataDir });
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
const req = async (method: string, path: string, body?: unknown, type = "application/json"): Promise<{ status: number; body: any }> => {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": type },
    body: body === undefined ? undefined : type === "application/json" ? JSON.stringify(body) : (body as Uint8Array),
  });
  return { status: res.status, body: await res.json() };
};
const dxf = readFileSync(new URL("../../../packages/core/test/fixtures/moradia_sintetica.dxf", import.meta.url));

describe("vários pisos do mesmo ficheiro", () => {
  let projectId = "";
  let p0 = "";
  let p1 = "";

  it("cria um segundo piso a partir do ficheiro do primeiro, sem duplicar o ficheiro", async () => {
    projectId = (await req("POST", "/api/projects", { name: "Moradia 2 pisos" })).body.id;
    p0 = (await req("POST", `/api/projects/${projectId}/floors?kind=dxf&name=Piso%200&ceilingHeightM=2.7&filename=casa.dxf`, dxf, "application/octet-stream")).body.id;
    const copy = await req("POST", `/api/floors/${p0}/copy`, { name: "Piso 1", ceilingHeightM: "2,6".replace(",", ".") });
    assert.equal(copy.status, 201);
    p1 = copy.body.id;
    assert.equal(copy.body.sourceKind, "dxf");
    assert.equal(copy.body.sourceMeta, null, "o novo piso escolhe a sua própria planta");
    const p0dto = (await req("GET", `/api/floors/${p0}`)).body;
    assert.equal(copy.body.sourceFile, p0dto.sourceFile);

    const proj = (await req("GET", `/api/projects/${projectId}`)).body;
    assert.equal(proj.floors.length, 2);
    assert.equal(proj.sources.length, 1);
    assert.deepEqual(proj.sources[0].floors, ["Piso 0", "Piso 1"]);
  });

  it("valida o novo piso", async () => {
    assert.equal((await req("POST", `/api/floors/${p0}/copy`, { name: "", ceilingHeightM: 2.6 })).status, 400);
    assert.equal((await req("POST", `/api/floors/${p0}/copy`, { name: "X", ceilingHeightM: 26 })).status, 400);
  });

  it("apagar um piso exige confirmação e mantém o ficheiro enquanto outro piso o usa", async () => {
    const file = join(dataDir, "pdfs", (await req("GET", `/api/floors/${p0}`)).body.sourceFile);
    assert.equal((await req("DELETE", `/api/floors/${p0}`, {})).status, 400);
    const d1 = await req("DELETE", `/api/floors/${p0}`, { confirm: true });
    assert.equal(d1.status, 200);
    assert.equal(d1.body.fileRemoved, false);
    assert.ok(existsSync(file));
    assert.equal((await fetch(`${base}/api/floors/${p1}/pdf`)).status, 200, "o piso que resta continua a abrir o ficheiro");

    const d2 = await req("DELETE", `/api/floors/${p1}`, { confirm: true });
    assert.equal(d2.body.fileRemoved, true);
    assert.equal(existsSync(file), false);
    const proj = (await req("GET", `/api/projects/${projectId}`)).body;
    assert.equal(proj.floors.length, 0);
    assert.ok(proj.events.some((e: { kind: string; note: string }) => e.kind === "piso_apagado" && e.note === "Piso 0"));
  });

  it("não apaga pisos de uma obra adjudicada", async () => {
    const f = (await req("POST", `/api/projects/${projectId}/floors?kind=dxf&name=R%2FC&ceilingHeightM=2.7`, dxf, "application/octet-stream")).body.id;
    for (const to of ["orcamento", "enviado", "adjudicado"]) await req("POST", `/api/projects/${projectId}/status`, { to });
    const r = await req("DELETE", `/api/floors/${f}`, { confirm: true });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /Adjudicado/);
  });
});
