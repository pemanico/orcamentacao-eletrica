import { useEffect, useState, type FormEvent } from "react";
import { api, type ProjectDetail } from "../api";
import { go } from "../nav";
import { inspectPdf } from "../pdf";

export function ProjectPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<string | null>(null);
  const [meta, setMeta] = useState({ name: "R/C", ceilingHeightM: "2,60", pdfPage: "1" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getProject(projectId).then(setProject, (e: Error) => setError(e.message));
  }, [projectId]);

  async function addFloor(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setCheck("A analisar o PDF…");
    try {
      const page = Number(meta.pdfPage) || 1;
      // Rejeita digitalizações antes de enviar: o servidor não analisa o PDF.
      const info = await inspectPdf(await file.arrayBuffer(), page);
      if (!info.verdict.ok) {
        setCheck(null);
        setError(info.verdict.reason);
        return;
      }
      setCheck(
        `${info.verdict.segmentCount.toLocaleString("pt-PT")} linhas vetoriais` +
          (info.stampDenominators.length ? ` · escala no carimbo: ${info.stampDenominators.map((d) => `1:${d}`).join(", ")}` : " · sem escala no carimbo"),
      );
      const floor = await api.createFloor(projectId, file, {
        name: meta.name,
        ceilingHeightM: Number(meta.ceilingHeightM.replace(",", ".")),
        pdfPage: page,
      });
      go(`/piso/${floor.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!project) {
    return <div className="page">{error ? <p className="error">{error}</p> : <p className="muted">A carregar…</p>}</div>;
  }

  return (
    <div className="page">
      <header className="page-header">
        <a href="#/" className="back">
          ← Projetos
        </a>
        <h1>{project.name}</h1>
        <p className="muted">{[project.client, project.address].filter(Boolean).join(" · ")}</p>
      </header>

      <section className="card">
        <h2>Pisos</h2>
        {project.floors.length === 0 ? (
          <p className="muted">Sem pisos. Começa por importar a planta do arquiteto.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Piso</th>
                <th>Pé-direito</th>
                <th>PDF</th>
                <th>Escala</th>
                <th>Paredes</th>
                <th>Divisões</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {project.floors.map((f) => (
                <tr key={f.id} className="clickable" onClick={() => go(`/piso/${f.id}`)}>
                  <td>{f.name}</td>
                  <td>{f.ceilingHeightM.toLocaleString("pt-PT")} m</td>
                  <td className="muted">{f.pdfOriginalName}</td>
                  <td>{f.calibrated ? "✔" : "—"}</td>
                  <td>{f.wallCount}</td>
                  <td>{f.roomCount}</td>
                  <td>
                    {f.approvedAt ? (
                      <span className="badge ok">Aprovado</span>
                    ) : f.errorCount > 0 ? (
                      <span className="badge">{f.errorCount} por resolver</span>
                    ) : (
                      <span className="badge warn">Por aprovar</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Importar planta (PDF do CAD)</h2>
        <form className="form-row" onSubmit={addFloor}>
          <label className="grow">
            Ficheiro PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setCheck(null);
                setError(null);
              }}
            />
          </label>
          <label>
            Nome do piso
            <input required value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
          </label>
          <label className="narrow">
            Pé-direito (m)
            <input required inputMode="decimal" value={meta.ceilingHeightM} onChange={(e) => setMeta({ ...meta, ceilingHeightM: e.target.value })} />
          </label>
          <label className="narrow">
            Página
            <input inputMode="numeric" value={meta.pdfPage} onChange={(e) => setMeta({ ...meta, pdfPage: e.target.value })} />
          </label>
          <button className="primary" disabled={busy || !file}>
            Importar
          </button>
        </form>
        {check && <p className="muted">{check}</p>}
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  );
}
