/** Carregar a planta de fundo de um piso (PDF ou DXF), fora do editor (ex.: planta de pontos). */
import { parseDxf, type DxfSourceMeta } from "@orc/core";
import { api, type Floor } from "./api";
import { buildDxfPlan } from "./dxfPlan";
import { loadPlan, type LoadedPlan } from "./pdf";

/** Metadados de um piso DXF com a planta já escolhida (região e unidades), ou null. */
export const completeMeta = (m: Floor["sourceMeta"]): DxfSourceMeta | null =>
  m && m.region && m.unit ? { region: m.region, unit: m.unit, hidden: m.hidden ?? [], snap: m.snap ?? [], layerVersion: m.layerVersion } : null;

/** Planta de fundo do piso. O imageUrl é um blob URL: revogar quando deixar de ser usado. */
export async function loadFloorPlan(floor: Floor): Promise<LoadedPlan> {
  if (floor.sourceKind === "dxf") {
    const meta = completeMeta(floor.sourceMeta);
    if (!meta) throw new Error("Este piso DXF ainda não tem a planta escolhida.");
    const text = await (await fetch(api.pdfUrl(floor.id))).text();
    return buildDxfPlan(parseDxf(text), meta);
  }
  return loadPlan(api.pdfUrl(floor.id), floor.pdfPage);
}
