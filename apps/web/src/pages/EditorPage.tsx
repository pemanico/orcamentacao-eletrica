import { useEffect, useMemo, useState } from "react";
import {
  DXF_LAYER_VERSION,
  defaultSnapLayer,
  defaultVisibleLayer,
  parseDxf,
  upgradeLayerMeta,
  type DxfDrawing,
  type DxfSourceMeta,
  type DxfUnit,
  type Region,
} from "@orc/core";
import { api, type Floor } from "../api";
import { loadPlan, type LoadedPlan } from "../pdf";
import { buildDxfPlan, layersInRegion } from "../dxfPlan";
import { Editor } from "../editor/Editor";
import { DxfSetup } from "../editor/DxfSetup";
import { LayerPanel } from "../editor/LayerPanel";
import { Shell, type Crumb } from "../Shell";

const completeMeta = (m: Floor["sourceMeta"]): DxfSourceMeta | null =>
  m && m.region && m.unit ? { region: m.region, unit: m.unit, hidden: m.hidden ?? [], snap: m.snap ?? [], layerVersion: m.layerVersion } : null;

export function EditorPage({ floorId }: { floorId: string }) {
  const [floor, setFloor] = useState<Floor | null>(null);
  const [pdfPlan, setPdfPlan] = useState<LoadedPlan | null>(null);
  const [drawing, setDrawing] = useState<DxfDrawing | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>("…");

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const f = await api.getFloor(floorId);
        if (cancelled) return;
        setFloor(f);
        api.getProject(f.projectId).then((p) => !cancelled && setProjectName(p.name), () => {});
        if (f.sourceKind === "dxf") {
          const text = await (await fetch(api.pdfUrl(floorId))).text();
          if (!cancelled) setDrawing(parseDxf(text));
          return;
        }
        const p = await loadPlan(api.pdfUrl(floorId), f.pdfPage);
        url = p.imageUrl;
        if (cancelled) return URL.revokeObjectURL(p.imageUrl);
        setPdfPlan(p);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [floorId]);

  const meta = completeMeta(floor?.sourceMeta ?? null);
  const dxfPlan = useMemo(() => (drawing && meta ? buildDxfPlan(drawing, meta) : null), [drawing, JSON.stringify(meta)]);
  useEffect(() => () => dxfPlan && URL.revokeObjectURL(dxfPlan.imageUrl), [dxfPlan]);
  const regionLayers = useMemo(() => (drawing && meta ? layersInRegion(drawing, meta.region) : []), [drawing, JSON.stringify(meta?.region)]);

  // pisos configurados antes de haver layers "[trama]": atualiza uma vez e grava
  useEffect(() => {
    if (!drawing || !meta || !floor) return;
    const up = upgradeLayerMeta(meta, layersInRegion(drawing, meta.region).map((l) => l.name));
    if (!up.changed) return;
    setFloor({ ...floor, sourceMeta: up.meta });
    api.saveFloorSource(floorId, { hidden: up.meta.hidden, snap: up.meta.snap, layerVersion: up.meta.layerVersion }).catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing, meta?.layerVersion, floor?.id]);

  async function confirmRegion(region: Region, unit: DxfUnit) {
    const layers = layersInRegion(drawing!, region).map((l) => l.name);
    const f = await api.saveFloorSource(floorId, {
      region,
      unit,
      hidden: layers.filter((n) => !defaultVisibleLayer(n)),
      snap: layers.filter(defaultSnapLayer),
      layerVersion: DXF_LAYER_VERSION,
    });
    setFloor(f);
    setChoosing(false);
  }

  async function changeLayers(hidden: string[], snap: string[]) {
    setFloor((f) => (f ? { ...f, sourceMeta: { ...f.sourceMeta, hidden, snap } } : f)); // resposta imediata
    try {
      await api.saveFloorSource(floorId, { hidden, snap });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const crumbs: Crumb[] = [
    { label: "Projetos", href: "#/" },
    { label: projectName, href: floor ? `#/projeto/${floor.projectId}` : undefined },
    { label: floor ? `Piso ${floor.name}` : "…" },
  ];

  const hasGeometry = !!floor && (floor.state.walls.length > 0 || floor.state.rooms.length > 0 || floor.state.openings.length > 0);

  let body;
  if (error) body = <div className="page"><p className="error">{error}</p></div>;
  else if (!floor) body = <div className="page"><p className="muted">A carregar…</p></div>;
  else if (floor.sourceKind === "dxf") {
    if (!drawing) body = <div className="page"><p className="muted">A ler o DXF…</p></div>;
    else if (!meta || choosing)
      body = (
        <DxfSetup
          drawing={drawing}
          initial={meta ? { region: meta.region, unit: meta.unit } : null}
          onConfirm={confirmRegion}
          onCancel={meta ? () => setChoosing(false) : undefined}
        />
      );
    else
      body = (
        <Editor
          key={JSON.stringify(meta.region) + meta.unit}
          floor={floor}
          plan={dxfPlan!}
          sourcePanel={
            <LayerPanel
              layers={regionLayers}
              hidden={meta.hidden}
              snap={meta.snap}
              onChange={changeLayers}
              onChangeRegion={hasGeometry ? undefined : () => setChoosing(true)}
            />
          }
        />
      );
  } else if (!pdfPlan) body = <div className="page"><p className="muted">A carregar a planta…</p></div>;
  else if (!pdfPlan.verdict.ok) body = <div className="page"><p className="error">{pdfPlan.verdict.reason}</p></div>;
  else body = <Editor floor={floor} plan={pdfPlan} />;

  return (
    <Shell section="projetos" crumbs={crumbs} full>
      {body}
    </Shell>
  );
}
