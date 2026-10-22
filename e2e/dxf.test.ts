/**
 * DXF ponta-a-ponta com o ficheiro sintético (cabeçalho em cm, desenho em m, duas plantas):
 * importar, escolher a planta com um retângulo, confirmar unidades, snap só às paredes,
 * divisão com o nome do arquiteto, layers guardadas.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright";
import { PAGE_UNITS_PER_METER, parseDxf } from "@orc/core";
import { buildApp } from "../apps/server/src/app.ts";
import { openDb } from "../apps/server/src/db.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = join(root, "packages/core/test/fixtures/moradia_sintetica.dxf");
const shots = process.env.E2E_SCREENSHOTS;
const drawing = parseDxf(readFileSync(fixture, "utf8"));
const ext = drawing.extents!;
const REGION = { minX: -1, minY: -3, maxX: 18, maxY: 10 };
const K = PAGE_UNITS_PER_METER;
/** metros do DXF → coordenadas de página do editor */
const page = (x: number, y: number) => ({ x: (x - REGION.minX) * K, y: (REGION.maxY - y) * K });

const dataDir = mkdtempSync(join(tmpdir(), "orc-e2e-dxf-"));
const db = openDb(join(dataDir, "e2e.db"));
const server = buildApp({ db, dataDir, webDist: join(root, "apps/web/dist"), rulesSeedDir: join(root, "regras") });
let base = "";
let browser: Browser;
let p: Page;

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
  p = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  p.on("pageerror", (e) => console.error("ERRO NA PÁGINA:", e.message));
});
after(async () => {
  await browser?.close();
  server.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function editorScreen(pt: { x: number; y: number }) {
  const t = await p.locator("svg.canvas > g").first().getAttribute("transform");
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(t ?? "")!;
  const box = (await p.locator("svg.canvas").boundingBox())!;
  return { x: box.x + Number(m[1]) + pt.x * Number(m[3]), y: box.y + Number(m[2]) + pt.y * Number(m[3]) };
}
async function clickPage(pt: { x: number; y: number }, dx = 0, dy = 0) {
  const s = await editorScreen(pt);
  await p.mouse.move(s.x + dx, s.y + dy);
  await p.mouse.click(s.x + dx, s.y + dy);
}

describe("DXF", () => {
  it("importa o DXF e abre a escolha da planta com o aviso das unidades", async () => {
    await p.goto(base);
    await p.getByPlaceholder("Moradia Sintra").fill("Casa nova");
    await p.getByRole("button", { name: "Criar" }).click();
    await p.waitForURL(/#\/projeto\//);
    await p.locator('input[type="file"]').setInputFiles(fixture);
    await p.getByLabel("Página").waitFor({ state: "detached" }); // o campo "Página" desaparece para DXF
    await p.getByRole("button", { name: "Importar" }).click();
    await p.waitForURL(/#\/piso\//);
    await p.getByText("Escolher a planta:").waitFor();
    assert.equal(await p.getByLabel("Unidades do desenho").inputValue(), "m");
    await p.getByText(/O cabeçalho do ficheiro diz centímetros, mas as cotas indicam metros/).waitFor();
  });

  it("escolhe a planta A com um retângulo", async () => {
    const img = (await p.locator(".dxf-setup svg.canvas image").boundingBox())!;
    const toScreen = (x: number, y: number) => ({
      x: img.x + ((x - ext.minX) / (ext.maxX - ext.minX)) * img.width,
      y: img.y + ((ext.maxY - y) / (ext.maxY - ext.minY)) * img.height,
    });
    const a = toScreen(REGION.minX, REGION.maxY);
    const b = toScreen(REGION.maxX, REGION.minY);
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await p.mouse.move(b.x, b.y, { steps: 8 });
    await p.mouse.up();
    const size = await p.getByTestId("region-size").textContent();
    const [w, h] = size!.replace(/ m$/, "").split(" × ").map((v) => Number(v.replace(",", ".")));
    assert.ok(Math.abs(w! - 19) < 1.2 && Math.abs(h! - 13) < 1.2, `região inesperada: ${size}`);
    if (shots) await p.screenshot({ path: join(shots, "dxf-setup.png") });
    // para o resto do teste a região tem de ser exata: corrige-a pela API
    await p.getByRole("button", { name: "Usar esta planta" }).click();
    await p.locator(".layer-panel").waitFor();
    const floorId = p.url().split("/").pop()!;
    const r = await fetch(`${base}/api/floors/${floorId}/source`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region: REGION, unit: "m" }),
    });
    assert.equal(r.status, 200);
    await p.reload();
    await p.locator(".layer-panel").waitFor();
  });

  it("escala exata do DXF, calibrar desativado, snap só nas paredes", async () => {
    await p.locator(".panel").getByText("Exata, do DXF").waitFor();
    assert.equal(await p.getByRole("button", { name: /Calibrar/ }).isDisabled(), true);
    assert.equal(await p.getByLabel("Snap arq_corte").isChecked(), true);
    assert.equal(await p.getByLabel("Snap arq_vista 1").isChecked(), false);
    assert.equal(await p.getByLabel("Ver arq_tramas").count(), 0, "a trama não tem linhas: nem aparece");
  });

  it("traça a fachada com snap aos cantos das paredes do DXF: 14,00 m", async () => {
    await p.keyboard.press("w");
    await clickPage(page(0, 0), 4, -3);
    await clickPage(page(14, 0), -4, 3);
    await p.keyboard.press("Escape");
    await p.keyboard.press("v");
    await clickPage(page(7, 0));
    await p.getByText("Comprimento: 14,00 m").waitFor();
  });

  it("a divisão desenhada à volta de um nome do arquiteto vem já com nome e tipo", async () => {
    await p.keyboard.press("d");
    for (const [x, y] of [[0.2, 0.2], [7, 0.2], [7, 8.8], [0.2, 8.8]] as const) await clickPage(page(x, y));
    await clickPage(page(0.2, 0.2));
    const modal = p.locator(".modal");
    assert.equal(await modal.getByLabel("Nome").inputValue(), "Sala de estar/jantar");
    assert.equal(await modal.getByLabel("Sala", { exact: true }).isChecked(), true);
    await modal.getByText("Nome lido da planta do arquiteto").waitFor();
    await p.getByRole("button", { name: "Criar divisão" }).click();
    await p.locator(".panel").getByText("Sala de estar/jantar").waitFor();
    if (shots) await p.screenshot({ path: join(shots, "dxf-editor.png") });
  });

  it("as layers escolhidas ficam guardadas e não retiram a aprovação", async () => {
    await p.locator(".statusbar").getByText("guardado").waitFor({ timeout: 5000 });
    await p.getByLabel("Ver arq_vista 1").uncheck();
    await p.waitForTimeout(400);
    await p.reload();
    await p.locator(".layer-panel").waitFor();
    assert.equal(await p.getByLabel("Ver arq_vista 1").isChecked(), false);
    await p.locator(".panel").getByText("Sala de estar/jantar").waitFor();
  });
});
