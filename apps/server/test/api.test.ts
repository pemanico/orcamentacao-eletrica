import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { calibrate, expectedMetersPerUnit, type FloorState } from "@orc/core";
import { buildApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";

const dataDir = mkdtempSync(join(tmpdir(), "orc-test-"));
const db = openDb(join(dataDir, "test.db"));
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
    body: body === undefined ? undefined : type === "application/json" ? JSON.stringify(body) : (body as string | Uint8Array),
  });
  return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.arrayBuffer() };
};

const fixture = (name: string) => readFileSync(new URL(`../../../packages/core/test/fixtures/${name}`, import.meta.url));

describe("API", () => {
  let projectId = "";
  let floorId = "";

  it("cria e lista projetos", async () => {
    const r = await req("POST", "/api/projects", { name: "Moradia Sintra", client: "Sr. Silva" });
    assert.equal(r.status, 201);
    projectId = r.body.id;
    const list = await req("GET", "/api/projects");
    assert.equal(list.body.projects.length, 1);
    assert.equal(list.body.projects[0].status, "levantamento");
  });

  it("valida o nome do projeto", async () => {
    const r = await req("POST", "/api/projects", { name: "  " });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /name/);
  });

  it("rejeita um ficheiro que não é PDF", async () => {
    const r = await req("POST", `/api/projects/${projectId}/floors?name=R/C&ceilingHeightM=2.6`, "olá", "application/pdf");
    assert.equal(r.status, 400);
  });

  it("rejeita pé-direito absurdo", async () => {
    const r = await req("POST", `/api/projects/${projectId}/floors?name=R/C&ceilingHeightM=26`, fixture("planta_t2_1-100.pdf"), "application/pdf");
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Pé-direito/);
  });

  it("cria um piso com o PDF e devolve-o", async () => {
    const pdf = fixture("planta_t2_1-100.pdf");
    const r = await req(
      "POST",
      `/api/projects/${projectId}/floors?name=R%2FC&ceilingHeightM=2.6&filename=planta.pdf`,
      pdf,
      "application/pdf",
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    floorId = r.body.id;
    assert.equal(r.body.rev, 1);
    assert.ok(r.body.issues.some((i: { message: string }) => i.message === "Escala por calibrar."));

    const back = await req("GET", `/api/floors/${floorId}/pdf`);
    assert.equal(back.status, 200);
    assert.equal(Buffer.from(back.body as ArrayBuffer).equals(pdf), true);
  });

  it("não aprova um piso vazio", async () => {
    const r = await req("POST", `/api/floors/${floorId}/approve`);
    assert.equal(r.status, 422);
  });

  it("grava o estado, controla a revisão e aprova", async () => {
    const u = 1 / expectedMetersPerUnit(100);
    const state: FloorState = {
      scale: calibrate({ x: 0, y: 0 }, { x: 4.2 * u, y: 0 }, 4.2, 100),
      walls: [],
      openings: [],
      rooms: [
        { id: "r1", name: "Sala", types: ["sala", "cozinha"], polygon: [{ x: 0, y: 0 }, { x: 5 * u, y: 0 }, { x: 5 * u, y: 4 * u }] },
      ],
    };
    const ok = await req("PUT", `/api/floors/${floorId}`, { rev: 1, state });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.rev, 2);

    const stale = await req("PUT", `/api/floors/${floorId}`, { rev: 1, state });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.rev, 2);

    const approved = await req("POST", `/api/floors/${floorId}/approve`);
    assert.equal(approved.status, 200);
    assert.ok(approved.body.approvedAt);

    // qualquer alteração retira a aprovação
    const edited = await req("PUT", `/api/floors/${floorId}`, { rev: 2, name: "Rés-do-chão" });
    assert.equal(edited.body.approvedAt, null);
  });

  it("rejeita estado malformado", async () => {
    const r = await req("PUT", `/api/floors/${floorId}`, { rev: 3, state: { scale: null, walls: "x", openings: [], rooms: [] } });
    assert.equal(r.status, 400);
  });

  it("resumo do projeto inclui o piso", async () => {
    const r = await req("GET", `/api/projects/${projectId}`);
    assert.equal(r.body.floors.length, 1);
    assert.equal(r.body.floors[0].roomCount, 1);
    assert.equal(r.body.floors[0].calibrated, true);
  });

  it("mostra onde estão os dados e faz cópias de segurança", async () => {
    const info = await req("GET", "/api/info");
    assert.equal(info.body.projects, 1);
    assert.equal(info.body.floors, 1);
    assert.ok(info.body.lastSavedAt);
    assert.equal(info.body.backupCount, 0);

    const b = await req("POST", "/api/backup");
    assert.equal(b.status, 201);
    assert.ok(b.body.dbBytes > 0);
    const files = readdirSync(b.body.folder);
    assert.deepEqual(files.sort(), ["orcamentacao.db", "pdfs"]);
    assert.equal(readdirSync(join(b.body.folder, "pdfs")).length, 1);

    // a cópia é uma base de dados válida com os mesmos dados
    const copy = new DatabaseSync(join(b.body.folder, "orcamentacao.db"));
    assert.equal((copy.prepare("SELECT COUNT(*) AS n FROM floors").get() as { n: number }).n, 1);
    copy.close();

    const again = await req("POST", "/api/backup");
    assert.notEqual(again.body.folder, b.body.folder);
    assert.equal((await req("GET", "/api/info")).body.backupCount, 2);
  });

  it("404 e 405", async () => {
    assert.equal((await req("GET", "/api/floors/naoexiste")).status, 404);
    assert.equal((await req("DELETE", "/api/projects")).status, 405);
  });
});
