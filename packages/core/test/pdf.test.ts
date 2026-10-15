import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { SnapIndex, classifyPdf, extractSegments, findScaleStamps, type PdfOps } from "../src/index.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

async function load(name: string) {
  const task = pdfjs.getDocument({ data: fixture(name), verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const opList = await page.getOperatorList();
  const text = await page.getTextContent();
  const textStr = text.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  const result = extractSegments(opList, pdfjs.OPS as unknown as PdfOps, viewport.transform);
  await task.destroy();
  return { result, textStr, viewport };
}

// 1 m a 1:100 = 10 mm = 28,3465 pt; origem da casa a 60 mm do canto inferior esquerdo
const M = (10 / 25.4) * 72;
const ORIGIN = (60 / 25.4) * 72;

describe("extração de vetores do PDF", () => {
  it("aceita a planta vetorial e encontra a parede exterior de 10 m", async () => {
    const { result, textStr, viewport } = await load("planta_t2_1-100.pdf");
    assert.equal(classifyPdf(result).ok, true);
    assert.deepEqual(findScaleStamps(textStr), [100]);

    const y = viewport.height - ORIGIN; // y para baixo
    const wall = result.segments.find(
      (s) =>
        Math.abs(s.a.y - y) < 0.5 &&
        Math.abs(s.b.y - y) < 0.5 &&
        Math.abs(Math.abs(s.b.x - s.a.x) - 10 * M) < 0.5,
    );
    assert.ok(wall, "parede exterior inferior não encontrada");

    const snapped = new SnapIndex(result.segments).snap({ x: ORIGIN + 2, y: y - 2 }, 6);
    assert.equal(snapped.kind, "extremo");
    assert.ok(Math.abs(snapped.point.x - ORIGIN) < 0.1 && Math.abs(snapped.point.y - y) < 0.1);
  });

  it("rejeita uma digitalização", async () => {
    const { result } = await load("digitalizacao.pdf");
    const verdict = classifyPdf(result);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.match(verdict.reason, /imagem/);
  });
});
