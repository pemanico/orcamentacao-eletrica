/**
 * Teste ponta-a-ponta: browser real (Playwright/Chromium) contra o servidor local.
 * Percorre o fluxo da F1 com a planta de exemplo: criar projeto, importar PDF,
 * calibrar, traçar paredes, porta, divisão em open space, aprovar, recarregar.
 *
 * Correr: npm run build && npm run test:e2e
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright";
import { buildApp } from "../apps/server/src/app.ts";
import { openDb } from "../apps/server/src/db.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = join(root, "packages/core/test/fixtures");
const shots = process.env.E2E_SCREENSHOTS;

// geometria da planta de exemplo (A3 deitado, 1:100)
const PAGE_H = 841.89;
const M = (10 / 25.4) * 72; // 1 m em pontos
const O = (60 / 25.4) * 72; // origem da casa
const at = (xm: number, ym: number) => ({ x: O + xm * M, y: PAGE_H - (O + ym * M) });

const dataDir = mkdtempSync(join(tmpdir(), "orc-e2e-"));
const db = openDb(join(dataDir, "e2e.db"));
const server = buildApp({ db, dataDir, webDist: join(root, "apps/web/dist") });
let base = "";
let browser: Browser;
let page: Page;

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (e) => console.error("ERRO NA PÁGINA:", e.message));
});

after(async () => {
  await browser?.close();
  server.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** Converte coordenadas de página (pontos PDF) em coordenadas de ecrã. */
async function screen(p: { x: number; y: number }) {
  const t = await page.locator("svg.canvas > g").first().getAttribute("transform");
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(t ?? "");
  assert.ok(m, `transform inesperado: ${t}`);
  const box = (await page.locator("svg.canvas").boundingBox())!;
  const [tx, ty, k] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { x: box.x + tx + p.x * k, y: box.y + ty + p.y * k };
}

async function clickAt(p: { x: number; y: number }) {
  const s = await screen(p);
  await page.mouse.move(s.x, s.y);
  await page.mouse.click(s.x, s.y);
}

describe("F1 — planta", () => {
  it("rejeita uma digitalização antes de enviar", async () => {
    await page.goto(base);
    await page.getByPlaceholder("Moradia Sintra").fill("Teste E2E");
    await page.getByRole("button", { name: "Criar" }).click();
    await page.waitForURL(/#\/projeto\//);
    await page.locator('input[type="file"]').setInputFiles(join(fixtures, "digitalizacao.pdf"));
    await page.getByRole("button", { name: "Importar" }).click();
    await page.getByText(/parece ser uma imagem/).waitFor();
  });

  it("importa a planta vetorial e abre o editor", async () => {
    await page.locator('input[type="file"]').setInputFiles(join(fixtures, "planta_t2_1-100.pdf"));
    await page.getByRole("button", { name: "Importar" }).click();
    await page.waitForURL(/#\/piso\//);
    await page.locator("svg.canvas image").waitFor();
    await page.getByText(/^Por calibrar\./).waitFor();
  });

  it("calibra pela cota de 4,20 m e confere com o carimbo", async () => {
    // a cota está 8 mm abaixo da casa
    const cy = PAGE_H - (O - (8 / 25.4) * 72);
    await clickAt({ x: O + 0.3, y: cy + 0.3 });
    await clickAt({ x: O + 4.2 * M - 0.3, y: cy - 0.3 });
    await page.getByPlaceholder("ex.: 4,20").fill("4,20");
    await page.getByRole("button", { name: "Calibrar", exact: true }).click();
    await page.getByText("Confere com o carimbo 1:100.").waitFor();
  });

  it("traça as paredes exteriores com snap", async () => {
    // ferramenta Parede fica ativa depois de calibrar
    for (const [x, y] of [[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]] as const) {
      // clica ligeiramente ao lado: o snap tem de corrigir
      const p = at(x, y);
      await clickAt({ x: p.x + 1.5, y: p.y - 1.5 });
    }
    await page.keyboard.press("Escape");
    await page.getByText(/^4 paredes/).waitFor();
  });

  it("coloca uma porta na parede de baixo", async () => {
    await page.keyboard.press("p");
    await clickAt(at(2, 0));
    await page.getByText("Largura (m)").waitFor();
    await page.getByText(/1 portas/).waitFor();
  });

  it("cria uma divisão em open space e mostra a área", async () => {
    await page.keyboard.press("d");
    for (const [x, y] of [[0, 0], [4.2, 0], [4.2, 8], [0, 8]] as const) await clickAt(at(x, y));
    await clickAt(at(0, 0)); // fecha no primeiro ponto
    await page.getByPlaceholder("ex.: Quarto 1").fill("Sala e cozinha");
    const modal = page.locator(".modal");
    await modal.getByLabel("Sala").check();
    await modal.getByLabel("Cozinha").check();
    await page.getByRole("button", { name: "Criar divisão" }).click();
    await page.locator(".panel").getByText("33,60 m²").waitFor();
  });

  it("grava, aprova e mantém tudo depois de recarregar", async () => {
    await page.locator(".statusbar").getByText("guardado").waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Aprovar piso" }).click();
    await page.getByText(/^Aprovado em/).waitFor();
    if (shots) await page.screenshot({ path: join(shots, "editor.png") });

    await page.reload();
    await page.locator("svg.canvas image").waitFor();
    await page.locator(".panel").getByText("33,60 m²").waitFor();
    await page.getByText(/^Aprovado em/).waitFor();
    await page.getByText(/^4 paredes · 1 portas/).waitFor();
  });

  it("anular retira a divisão e a aprovação", async () => {
    await page.keyboard.press("v");
    await page.locator(".panel tr.clickable").first().click();
    await page.keyboard.press("Delete");
    await page.getByText("Nenhuma divisão definida.").waitFor();
    await page.locator(".statusbar").getByText("guardado").waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Aprovar piso" }).waitFor();
    await page.keyboard.press("Control+z");
    await page.locator(".panel").getByText("33,60 m²").waitFor();
  });
});
