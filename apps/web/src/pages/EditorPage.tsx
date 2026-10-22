import { useEffect, useState } from "react";
import { api, type Floor } from "../api";
import { loadPlan, type LoadedPlan } from "../pdf";
import { Editor } from "../editor/Editor";
import { Shell, type Crumb } from "../Shell";

export function EditorPage({ floorId }: { floorId: string }) {
  const [floor, setFloor] = useState<Floor | null>(null);
  const [plan, setPlan] = useState<LoadedPlan | null>(null);
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
        const p = await loadPlan(api.pdfUrl(floorId), f.pdfPage);
        url = p.imageUrl;
        if (cancelled) return URL.revokeObjectURL(p.imageUrl);
        setPlan(p);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [floorId]);

  const crumbs: Crumb[] = [
    { label: "Projetos", href: "#/" },
    { label: projectName, href: floor ? `#/projeto/${floor.projectId}` : undefined },
    { label: floor ? `Piso ${floor.name}` : "…" },
  ];
  const body = error ? (
    <div className="page"><p className="error">{error}</p></div>
  ) : !floor || !plan ? (
    <div className="page"><p className="muted">A carregar a planta…</p></div>
  ) : !plan.verdict.ok ? (
    <div className="page"><p className="error">{plan.verdict.reason}</p></div>
  ) : (
    <Editor floor={floor} plan={plan} />
  );
  return (
    <Shell section="projetos" crumbs={crumbs} full>
      {body}
    </Shell>
  );
}
