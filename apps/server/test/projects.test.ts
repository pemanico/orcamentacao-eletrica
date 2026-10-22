import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";

const dataDir = mkdtempSync(join(tmpdir(), "orc-proj-"));
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

const pdf = readFileSync(new URL("../../../packages/core/test/fixtures/planta_t2_1-100.pdf", import.meta.url));
const status = (id: string, to: string) => req("POST", `/api/projects/${id}/status`, { to });

describe("Workflow de projetos", () => {
  let id = "";

  it("um projeto novo começa em Levantamento, com o evento registado", async () => {
    id = (await req("POST", "/api/projects", { name: "Moradia A" })).body.id;
    const p = (await req("GET", `/api/projects/${id}`)).body;
    assert.equal(p.status, "levantamento");
    assert.equal(p.events[0].kind, "criado");
  });

  it("só aceita transições do workflow", async () => {
    const skip = await status(id, "adjudicado");
    assert.equal(skip.status, 422);
    assert.match(skip.body.error, /Levantamento.*Adjudicado/);
    for (const to of ["orcamento", "enviado", "adjudicado", "em_obra", "concluido"]) {
      const r = await status(id, to);
      assert.equal(r.status, 200, `${to}: ${JSON.stringify(r.body)}`);
    }
    const p = (await req("GET", `/api/projects/${id}`)).body;
    assert.equal(p.status, "concluido");
    assert.equal(p.events.filter((e: { kind: string }) => e.kind === "estado").length, 5);
    assert.equal(p.events[0].to, "concluido"); // mais recente primeiro
  });

  it("obra concluída não se apaga: arquiva-se", async () => {
    const del = await req("DELETE", `/api/projects/${id}`, { confirmName: "Moradia A" });
    assert.equal(del.status, 409);
    assert.match(del.body.error, /Arquiva-o/);

    const arch = await req("POST", `/api/projects/${id}/archive`, { archived: true });
    assert.ok(arch.body.archivedAt);
    assert.equal(arch.body.status, "concluido", "arquivar não muda o estado");

    const active = (await req("GET", "/api/projects")).body;
    const archived = (await req("GET", "/api/projects?arquivados=1")).body;
    assert.equal(active.projects.length, 0);
    assert.equal(archived.projects.length, 1);
    assert.deepEqual(active.counts, { active: 0, archived: 1 });

    assert.equal((await status(id, "em_obra")).status, 409, "arquivado não muda de estado");
    const back = await req("POST", `/api/projects/${id}/archive`, { archived: false });
    assert.equal(back.body.archivedAt, null);
  });

  it("apagar um orçamento perdido exige o nome e remove pisos e PDFs", async () => {
    const lost = (await req("POST", "/api/projects", { name: "Apartamento B" })).body.id;
    const floor = (await req("POST", `/api/projects/${lost}/floors?name=R%2FC&ceilingHeightM=2.6`, pdf, "application/pdf")).body;
    const pdfFile = join(dataDir, "pdfs", `${floor.id}.pdf`);
    assert.ok(existsSync(pdfFile));
    for (const to of ["orcamento", "enviado", "perdido"]) await status(lost, to);

    const wrong = await req("DELETE", `/api/projects/${lost}`, { confirmName: "apartamento" });
    assert.equal(wrong.status, 422);

    const ok = await req("DELETE", `/api/projects/${lost}`, { confirmName: "Apartamento B" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.deletedFloors, 1);
    assert.equal(existsSync(pdfFile), false);
    assert.equal((await req("GET", `/api/floors/${floor.id}`)).status, 404);
    assert.equal((await req("GET", `/api/projects/${lost}`)).status, 404);
    const left = db.prepare("SELECT COUNT(*) AS n FROM project_events WHERE project_id = ?").get(lost) as { n: number };
    assert.equal(left.n, 0);
  });

  it("migra uma base de dados antiga sem as colunas novas", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const f = join(dataDir, "antiga.db");
    const old = new DatabaseSync(f);
    old.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, client TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''); INSERT INTO projects (id, name) VALUES ('x', 'Antigo');");
    old.close();
    const migrated = openDb(f);
    const row = migrated.prepare("SELECT status, archived_at FROM projects WHERE id = 'x'").get() as { status: string; archived_at: null };
    assert.equal(row.status, "levantamento");
    assert.equal(row.archived_at, null);
    migrated.close();
  });
});
