// build "legacy": inclui polyfills (ex.: Map.getOrInsertComputed) que browsers menos recentes não têm
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { classifyPdf, extractSegments, findScaleStamps, type PdfOps, type PdfVerdict, type Segment } from "@orc/core";

// o worker é copiado para dist/ pelo script de build
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export interface LoadedPlan {
  /** dimensões da página em unidades de página (pontos PDF) */
  width: number;
  height: number;
  /** imagem de fundo (blob URL), renderizada a `renderScale` píxeis por unidade */
  imageUrl: string;
  renderScale: number;
  segments: Segment[];
  verdict: PdfVerdict;
  stampDenominators: number[];
  pageCount: number;
}

/** Lado máximo do canvas de fundo (limite prático dos browsers ~16k). */
const MAX_CANVAS_SIDE = 9000;

/** Analisa um PDF (sem renderizar) — usado para validar antes do upload. */
export async function inspectPdf(data: ArrayBuffer, pageNumber = 1) {
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    if (pageNumber > doc.numPages) throw new Error(`O PDF só tem ${doc.numPages} página(s).`);
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const result = extractSegments(await page.getOperatorList(), pdfjs.OPS as unknown as PdfOps, viewport.transform);
    const text = await page.getTextContent();
    const str = text.items.map((i) => ("str" in i ? i.str : "")).join(" ");
    return { verdict: classifyPdf(result), stampDenominators: findScaleStamps(str), pageCount: doc.numPages };
  } finally {
    await task.destroy();
  }
}

export async function loadPlan(url: string, pageNumber = 1): Promise<LoadedPlan> {
  const task = pdfjs.getDocument({ url });
  const doc = await task.promise;
  if (pageNumber > doc.numPages) throw new Error(`O PDF só tem ${doc.numPages} página(s).`);
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const renderScale = Math.min(3, MAX_CANVAS_SIDE / Math.max(viewport.width, viewport.height));

  const [opList, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
  const result = extractSegments(opList, pdfjs.OPS as unknown as PdfOps, viewport.transform);

  const pageCount = doc.numPages;
  const scaled = page.getViewport({ scale: renderScale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(scaled.width);
  canvas.height = Math.floor(scaled.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: scaled }).promise;

  const blob = await new Promise<Blob>((ok, fail) =>
    canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Falha a renderizar o PDF."))), "image/png"),
  );
  canvas.width = canvas.height = 0; // liberta memória
  await task.destroy();

  const str = text.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  return {
    width: viewport.width,
    height: viewport.height,
    imageUrl: URL.createObjectURL(blob),
    renderScale,
    segments: result.segments,
    verdict: classifyPdf(result),
    stampDenominators: findScaleStamps(str),
    pageCount,
  };
}
