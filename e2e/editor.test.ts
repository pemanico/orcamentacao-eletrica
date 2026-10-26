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
const server = buildApp({ db, dataDir, webDist: join(root, "apps/web/dist"), rulesSeedDir: join(root, "regras") });
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
    await modal.getByLabel("Sala", { exact: true }).check();
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

  it("parede diagonal com orto ligado: o canto da planta ganha ao orto", async () => {
    await page.keyboard.press("w");
    await page.locator(".statusbar").getByText("orto: ligado").waitFor();
    const a = at(10, 8);
    const b = at(13, 5); // 3 m × 3 m → 4,24 m a 45°
    await clickAt({ x: a.x + 1, y: a.y + 1 });
    await clickAt({ x: b.x - 1.5, y: b.y + 1 });
    await page.keyboard.press("Escape");
    await page.getByText(/^5 paredes/).waitFor();

    await page.keyboard.press("v");
    await clickAt(at(11.5, 6.5)); // meio da parede diagonal
    await page.getByText("Comprimento: 4,24 m").waitFor();
    if (shots) await page.screenshot({ path: join(shots, "diagonal.png") });
  });

  it("cria um tipo de divisão novo a partir do diálogo", async () => {
    await page.keyboard.press("d");
    for (const [x, y] of [[4.2, 0], [10, 0], [10, 8], [4.2, 8]] as const) await clickAt(at(x, y));
    await clickAt(at(4.2, 0));
    const modal = page.locator(".modal");
    // a planta tem "QUARTO 1" nesta zona: a app sugere esse nome e o tipo; trocamos
    assert.equal(await modal.getByPlaceholder("ex.: Quarto 1").inputValue(), "QUARTO 1");
    await modal.getByLabel("Quarto", { exact: true }).uncheck();
    await modal.getByPlaceholder("ex.: Quarto 1").fill("");
    await modal.getByRole("button", { name: "+ Novo tipo" }).click();
    await modal.getByLabel("Nome do novo tipo").fill("Adega");
    await modal.getByLabel("Defaults do novo tipo").selectOption("arrumos");
    if (shots) await modal.screenshot({ path: join(shots, "novo-tipo.png") });
    await modal.getByLabel("Nome do novo tipo").press("Enter"); // Enter cria o tipo, não a divisão
    await modal.getByLabel(/^Adega/).waitFor();
    assert.equal(await modal.getByLabel(/^Adega/).isChecked(), true, "o tipo novo fica escolhido");
    assert.equal(await modal.getByPlaceholder("ex.: Quarto 1").inputValue(), "Adega", "o nome da divisão vem do tipo");
    await modal.getByRole("button", { name: "Criar divisão" }).click();
    await page.locator(".panel tr.clickable", { hasText: "Adega" }).waitFor();

    const types = await page.evaluate(() => fetch("/api/rules/tipos_divisao").then((r) => r.json()));
    assert.deepEqual(
      types.map((t: { values: Record<string, string>; state: string }) => [t.values.codigo, t.values.defaults_como, t.state]),
      [["adega", "arrumos", "proposta"]],
    );
    await page.keyboard.press("Control+z"); // deixa o piso como estava para os passos seguintes
  });

  it("painel e ajuda recolhem para libertar a planta, e a escolha fica guardada", async () => {
    const before = (await page.locator("svg.canvas").boundingBox())!.width;
    await page.keyboard.press("Tab");
    await page.locator(".panel").waitFor({ state: "hidden" });
    await page.locator(".tool-hint .hint-close").click();
    await page.locator(".tool-hint").waitFor({ state: "detached" });
    const after = (await page.locator("svg.canvas").boundingBox())!.width;
    assert.ok(after > before + 250, `a planta devia ganhar largura: ${before} → ${after}`);
    if (shots) await page.screenshot({ path: join(shots, "painel-recolhido.png") });

    await page.reload();
    await page.locator("svg.canvas image").waitFor();
    assert.equal(await page.locator(".panel").isVisible(), false, "painel devia continuar recolhido");
    assert.equal(await page.locator(".tool-hint").count(), 0, "ajuda devia continuar escondida");

    await page.getByRole("button", { name: "Mostrar painel" }).click();
    await page.locator(".panel").waitFor();
    await page.getByRole("button", { name: "? Ajuda" }).click();
    await page.locator(".tool-hint").waitFor();
  });

  it("breadcrumb do editor leva de volta ao projeto", async () => {
    const crumbs = page.locator(".crumbs");
    await crumbs.getByText("Piso R/C").waitFor();
    await crumbs.getByRole("link", { name: "Teste E2E" }).click();
    await page.waitForURL(/#\/projeto\//);
    await page.locator(".crumbs").getByText("Teste E2E").waitFor();
    await page.getByRole("heading", { name: "Pisos" }).waitFor();
  });

  it("Regras: menu com pendentes, aprovar uma linha, técnica sem fonte não aprova", async () => {
    await page.locator(".menu").getByRole("link", { name: /Regras/ }).click();
    await page.waitForURL(/#\/regras/);
    await page.locator(".crumbs").getByText("Defaults por divisão").waitFor();
    const badge = page.locator(".menu-badge");
    const before = Number(await badge.textContent());
    assert.ok(before > 50, `esperava muitas regras por aprovar, há ${before}`);

    const first = page.locator("tr.rule-row").first();
    assert.equal(await first.getByLabel("Elemento").inputValue(), "ponto_luz");
    await first.getByLabel("Estado").selectOption("aprovada");
    await page.locator(".tabs a.active .tab-count").getByText("36").waitFor();
    await page.locator(".menu-badge").getByText(String(before - 1), { exact: true }).waitFor();

    // editar a quantidade de uma linha aprovada retira a aprovação
    const qtd = first.getByLabel("Qtd.");
    await qtd.fill("2");
    await qtd.press("Enter");
    await page.locator(".tabs a.active .tab-count").getByText("37").waitFor();
    assert.equal(await first.getByLabel("Estado").inputValue(), "proposta");

    // tabela técnica: sem valores nem fonte, "Aprovada" está bloqueado e explica porquê
    await page.locator(".tabs").getByRole("link", { name: /Tipos de circuito/ }).click();
    await page.locator(".crumbs").getByText("Tipos de circuito").waitFor();
    const c1 = page.locator("tr.rule-row").first();
    assert.equal(await c1.locator('select[aria-label="Estado"] option[value="aprovada"]').isDisabled(), true);
    await page.getByText(/Para aprovar: falta secção, falta disjuntor/).first().waitFor();
    if (shots) await page.screenshot({ path: join(shots, "regras.png") });
  });

  it("Regras: preencher com referência mostra o que muda e só depois grava", async () => {
    const c1 = page.locator("tr.rule-row").first();
    assert.equal(await c1.getByLabel("Carga").inputValue(), "tomadas");
    assert.equal(await c1.getByLabel("Secção").inputValue(), "");
    await page.getByRole("button", { name: "Preencher com referência" }).click();
    const preview = page.getByTestId("fill-preview");
    await preview.getByText(/secção = 2,5 \(RTIEBT 801\.5\.8/).first().waitFor();
    assert.equal(await c1.getByLabel("Secção").inputValue(), "", "a pré-visualização não grava");
    await preview.getByRole("button", { name: "Aplicar" }).click();
    await page.getByTestId("fill-done").waitFor();
    assert.equal(await c1.getByLabel("Secção").inputValue(), "2,5");
    assert.equal(await c1.getByLabel("Disjuntor").inputValue(), "", "disjuntor não vem do RTIEBT");
    assert.match(await c1.getByLabel("Fonte").inputValue(), /RTIEBT 801\.5\.8/);
    if (shots) await page.screenshot({ path: join(shots, "regras-referencia.png") });
  });

  it("Calculadora de secções: exercício do CINEL dá C20 e 4 mm², provisório até aprovar", async () => {
    await page.locator(".tabs").getByRole("link", { name: /Parâmetros/ }).click();
    await page.locator(".crumbs").getByText("Parâmetros").waitFor();
    await page.getByRole("button", { name: "Preencher com referência" }).click();
    await page.getByTestId("fill-preview").getByRole("button", { name: "Aplicar" }).click();
    await page.getByTestId("fill-done").waitFor();

    await page.locator(".tabs").getByRole("link", { name: "Calculadora de secções" }).click();
    await page.waitForURL(/#\/regras\/calculadora/);
    await page.getByLabel("Carga").selectOption("termoacumulador");
    await page.getByLabel("Potência").fill("4600");
    await page.getByLabel("Comprimento").fill("25");
    await page.getByLabel("Temperatura").selectOption("35");
    await page.getByLabel("Circuitos agrupados").selectOption("3");
    await page.getByTestId("calc-in").getByText("20 A").waitFor();
    assert.equal(await page.getByTestId("calc-s").textContent(), "4 mm²");
    await page.getByTestId("calc-provisorio").waitFor();
    await page.getByText(/quadro 52-C1, DR p\.98, método B/).waitFor();
    if (shots) await page.screenshot({ path: join(shots, "calculadora.png") });
  });

  it("Regras: aprovação em bloco pede confirmação e explica o que ficou de fora", async () => {
    await page.locator(".tabs").getByRole("link", { name: /Defaults por divisão/ }).click();
    await page.locator(".crumbs").getByText("Defaults por divisão").waitFor();
    await page.getByLabel("Só por aprovar").check();
    await page.getByLabel("Selecionar todas as linhas por aprovar visíveis").check();
    const bar = page.getByTestId("bulk-bar");
    await bar.getByRole("button", { name: /^Aprovar \d+ selecionada/ }).click();
    await bar.getByRole("button", { name: /Confirmar: aprovar/ }).click();
    const result = page.getByTestId("bulk-result");
    await result.getByText(/aprovada\(s\)\. Ficaram por aprovar \d+: .*falta qtd/).waitFor();
    // ficam só as linhas sem quantidade
    const left = await page.locator("tr.rule-row").count();
    assert.ok(left > 0 && left < 15, `esperava poucas linhas por aprovar, há ${left}`);
    if (shots) await page.screenshot({ path: join(shots, "aprovacao-bloco.png") });
  });

  it("Regras: pesquisa e filtro por divisão; a seleção em bloco só apanha o que está visível", async () => {
    await page.getByLabel("Só por aprovar").uncheck();
    await page.getByLabel("Pesquisar nas regras").fill("estore");
    await page.getByText("Nenhuma linha corresponde").waitFor({ state: "detached" });
    const estores = page.locator("tr.rule-row");
    assert.equal(await estores.count(), 4);
    for (const el of await estores.getByLabel("Elemento").all()) assert.match(await el.inputValue(), /estore/);

    await page.getByLabel("Pesquisar nas regras").fill("");
    await page.getByLabel("Filtrar por divisão").selectOption({ label: "Cozinha" });
    const divs = await page.locator("tr.rule-row").getByLabel("Divisão").all();
    assert.ok(divs.length >= 8);
    for (const d of divs) assert.equal(await d.inputValue(), "cozinha");

    // só a cozinha por aprovar: a caixa do cabeçalho seleciona apenas essas
    await page.getByLabel("Só por aprovar").check();
    await page.getByLabel("Selecionar todas as linhas por aprovar visíveis").check();
    const n = await page.locator("tr.rule-row").count();
    await page.getByTestId("bulk-bar").getByText(`${n} selecionada(s)`, { exact: true }).waitFor();
    await page.getByTestId("bulk-bar").getByRole("button", { name: "Limpar seleção" }).click();
    await page.getByLabel("Filtrar por divisão").selectOption("");
  });

  it("página Dados mostra onde estão os dados e faz a cópia de segurança", async () => {
    await page.locator(".menu").getByRole("link", { name: "Dados" }).click();
    await page.waitForURL(/#\/dados/);
    const card = page.locator(".data-card");
    await card.getByText(/e2e\.db$/).first().waitFor();
    await card.getByText(/1 projeto\(s\) · 1 piso\(s\)/).waitFor();
    await card.getByText("Nenhuma ainda.").waitFor();
    await card.getByRole("button", { name: "Fazer cópia de segurança agora" }).click();
    await card.getByText(/^Cópia criada em/).waitFor();
    await card.getByText(/^1 · última: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/).waitFor();
    assert.equal(await card.getByText(/ 0 KB/).count(), 0, "tamanho não pode ser 0 KB");
    if (shots) await page.screenshot({ path: join(shots, "inicio.png"), fullPage: true });
  });

  it("workflow: avançar estados, histórico, arquivar e apagar com confirmação do nome", async () => {
    await page.locator(".menu").getByRole("link", { name: "Projetos" }).click();
    await page.getByRole("cell", { name: "Teste E2E" }).click();
    await page.waitForURL(/#\/projeto\//);
    await page.locator(".stepper li.current").getByText("Levantamento").waitFor();

    await page.getByRole("button", { name: "Avançar para Orçamento" }).click();
    await page.getByRole("button", { name: "Avançar para Enviado" }).click();
    await page.locator(".stepper li.current").getByText("Enviado").waitFor();
    await page.getByRole("button", { name: "Marcar como perdido" }).click();
    await page.locator(".stepper li.lost").getByText("Perdido").waitFor();
    await page.locator(".history").getByText("Enviado → Perdido").waitFor();
    if (shots) await page.screenshot({ path: join(shots, "projeto-workflow.png"), fullPage: true });

    await page.getByRole("button", { name: "Arquivar" }).click();
    await page.getByRole("button", { name: "Desarquivar" }).waitFor();
    await page.locator(".menu").getByRole("link", { name: "Projetos" }).click();
    await page.getByText("Ainda não há projetos.").waitFor();
    await page.locator(".tabs").getByRole("link", { name: /Arquivados/ }).click();
    await page.getByRole("cell", { name: "Teste E2E" }).click();

    await page.getByRole("button", { name: "Apagar projeto…" }).click();
    const confirm = page.getByRole("button", { name: "Apagar definitivamente" });
    assert.equal(await confirm.isDisabled(), true);
    await page.getByLabel("Para confirmar, escreve o nome do projeto").fill("Teste E2E");
    await confirm.click();
    await page.waitForURL(new RegExp(`${base.replace(/[.:/]/g, "\\$&")}/#/$`));
    await page.getByText("Ainda não há projetos.").waitFor();
  });
});
