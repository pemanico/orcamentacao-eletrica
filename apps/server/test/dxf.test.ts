import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { PAGE_UNITS_PER_METER } from "@orc/core";
import { buildApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";

const dataDir = mkdtempSync(join(tmpdir(), "orc-dxf-"));
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
const req = async (method: string, path: string, body?: unknown, type = "application/json"): Promise<{ status: number; body: any; raw: string }> => {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": type },
    body: body === undefined ? undefined : type === "application/json" ? JSON.stringify(body) : (body as Uint8Array | string),
  });
  const raw = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* ficheiro */
  }
  return { status: res.status, body: parsed, raw };
};

const dxf = readFileSync(new URL("../../../packages/core/test/fixtures/moradia_sintetica.dxf", import.meta.url));

describe("pisos a partir de DXF", () => {
  let projectId = "";
  let floorId = "";

  it("rejeita DWG e ficheiros que não são DXF", async () => {
    projectId = (await req("POST", "/api/projects", { name: "Casa DXF" })).body.id;
    const dwg = await req("POST", `/api/projects/${projectId}/floors?kind=dxf&name=P0&ceilingHeightM=2.7`, "AC1032\u0000\u0000binario", "application/octet-stream");
    assert.equal(dwg.status, 400);
    assert.match(dwg.body.error, /DWG/);
    const junk = await req("POST", `/api/projects/${projectId}/floors?kind=dxf&name=P0&ceilingHeightM=2.7`, "olá", "application/octet-stream");
    assert.equal(junk.status, 400);
  });

  it("importa o DXF, guarda o original e devolve-o", async () => {
    const r = await req("POST", `/api/projects/${projectId}/floors?kind=dxf&name=Piso%200&ceilingHeightM=2.7&filename=casa.dxf`, dxf, "application/octet-stream");
    assert.equal(r.status, 201, r.raw);
    floorId = r.body.id;
    assert.equal(r.body.sourceKind, "dxf");
    assert.equal(r.body.sourceMeta, null);
    const back = await req("GET", `/api/floors/${floorId}/pdf`);
    assert.equal(back.raw.length > 1000, true);
    assert.match(back.raw, /SECTION/);
  });

  it("definir região e unidades fixa a escala automaticamente (sem calibrar)", async () => {
    const region = { minX: -1, minY: -3, maxX: 18, maxY: 10 };
    const r = await req("PUT", `/api/floors/${floorId}/source`, { region, unit: "m", hidden: ["arq_tramas"], snap: ["arq_corte"] });
    assert.equal(r.status, 200, r.raw);
    assert.equal(r.body.rev, 2);
    assert.ok(Math.abs(r.body.state.scale.metersPerUnit - 1 / PAGE_UNITS_PER_METER) < 1e-12);
    assert.equal(r.body.state.scale.refMeters, 19);
    assert.equal(r.body.state.scale.stampDenominator, 100);
    assert.deepEqual(r.body.sourceMeta.snap, ["arq_corte"]);
  });

  it("mudar layers não mexe na revisão nem na aprovação", async () => {
    const r = await req("PUT", `/api/floors/${floorId}/source`, { hidden: ["arq_tramas", "arq_cotas"] });
    assert.equal(r.body.rev, 2);
    assert.deepEqual(r.body.sourceMeta.hidden, ["arq_tramas", "arq_cotas"]);
    assert.deepEqual(r.body.sourceMeta.snap, ["arq_corte"], "o resto da configuração mantém-se");
  });

  it("com paredes traçadas, a região e as unidades ficam bloqueadas", async () => {
    const floor = (await req("GET", `/api/floors/${floorId}`)).body;
    const state = { ...floor.state, walls: [{ id: "w1", a: { x: 10, y: 10 }, b: { x: 100, y: 10 }, thicknessM: 0.2 }] };
    assert.equal((await req("PUT", `/api/floors/${floorId}`, { rev: floor.rev, state })).status, 200);
    const r = await req("PUT", `/api/floors/${floorId}/source`, { unit: "cm" });
    assert.equal(r.status, 409);
  });

  it("um piso PDF não aceita configuração de DXF", async () => {
    const pdf = readFileSync(new URL("../../../packages/core/test/fixtures/planta_t2_1-100.pdf", import.meta.url));
    const f = (await req("POST", `/api/projects/${projectId}/floors?name=R%2FC&ceilingHeightM=2.6`, pdf, "application/pdf")).body;
    assert.equal(f.sourceKind, "pdf");
    assert.equal((await req("PUT", `/api/floors/${f.id}/source`, { unit: "m" })).status, 400);
  });
});
