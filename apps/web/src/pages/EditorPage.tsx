import { useEffect, useState } from "react";
import { api, type Floor } from "../api";
import { loadPlan, type LoadedPlan } from "../pdf";
import { Editor } from "../editor/Editor";

export function EditorPage({ floorId }: { floorId: string }) {
  const [floor, setFloor] = useState<Floor | null>(null);
  const [plan, setPlan] = useState<LoadedPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const f = await api.getFloor(floorId);
        if (cancelled) return;
        setFloor(f);
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

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!floor || !plan) return <div className="page"><p className="muted">A carregar a planta…</p></div>;
  if (!plan.verdict.ok) return <div className="page"><p className="error">{plan.verdict.reason}</p></div>;
  return <Editor floor={floor} plan={plan} />;
}
