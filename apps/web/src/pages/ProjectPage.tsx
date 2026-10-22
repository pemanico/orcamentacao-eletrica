import { useEffect, useState, type FormEvent } from "react";
import { api, type ProjectDetail } from "../api";
import { go } from "../nav";
import { inspectPdf } from "../pdf";
import { Shell } from "../Shell";
import { StatusBadge } from "../StatusBadge";
import {
  PROJECT_STATUS_HELP,
  PROJECT_STATUS_LABEL,
  PROJECT_TRANSITIONS,
  canDeleteProject,
  isForward,
  type ProjectStatus,
} from "@orc/core";

export function ProjectPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<string | null>(null);
  const [meta, setMeta] = useState({ name: "R/C", ceilingHeightM: "2,60", pdfPage: "1" });
  const [busy, setBusy] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = () => api.getProject(projectId).then(setProject, (e: Error) => setError(e.message));
  useEffect(() => {
    void reload();
  }, [projectId]);

  async function act(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

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
    return (
      <Shell section="projetos" crumbs={[{ label: "Projetos", href: "#/" }, { label: "…" }]}>
        <div className="page">{error ? <p className="error">{error}</p> : <p className="muted">A carregar…</p>}</div>
      </Shell>
    );
  }

  return (
    <Shell section="projetos" crumbs={[{ label: "Projetos", href: "#/" }, { label: project.name }]}>
    <div className="page">
      <header className="page-header">
        <h1>
          {project.name} <StatusBadge status={project.status} archived={!!project.archivedAt} />
        </h1>
        <p className="muted">{[project.client, project.address].filter(Boolean).join(" · ")}</p>
      </header>

      <section className="card workflow">
        <Stepper status={project.status} />
        <p className="muted">{PROJECT_STATUS_HELP[project.status]}</p>
        {project.archivedAt ? (
          <div className="row">
            <span className="muted">Arquivado em {new Date(project.archivedAt).toLocaleString("pt-PT")}.</span>
            <button onClick={() => act(() => api.archiveProject(project.id, false))}>Desarquivar</button>
          </div>
        ) : (
          <div className="row">
            {PROJECT_TRANSITIONS[project.status]
              .filter((to) => isForward(project.status, to))
              .map((to) => (
                <button
                  key={to}
                  className={to === "perdido" ? "danger" : "primary"}
                  onClick={() => act(() => api.setProjectStatus(project.id, to))}
                >
                  {to === "perdido" ? "Marcar como perdido" : `Avançar para ${PROJECT_STATUS_LABEL[to]}`}
                </button>
              ))}
            {PROJECT_TRANSITIONS[project.status]
              .filter((to) => !isForward(project.status, to))
              .map((to) => (
                <button key={to} onClick={() => act(() => api.setProjectStatus(project.id, to))}>
                  ↶ Voltar a {PROJECT_STATUS_LABEL[to]}
                </button>
              ))}
            <span className="spacer" />
            <button onClick={() => act(() => api.archiveProject(project.id, true))}>Arquivar</button>
          </div>
        )}
        {actionError && <p className="error">{actionError}</p>}
      </section>

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

      <section className="card">
        <h2>Histórico</h2>
        <ol className="history">
          {project.events.map((e, i) => (
            <li key={i}>
              <time>{new Date(e.at).toLocaleString("pt-PT")}</time>
              <span>{describeEvent(e.kind, e.from, e.to)}</span>
              {e.note && <span className="muted"> · {e.note}</span>}
            </li>
          ))}
        </ol>
      </section>

      <section className="card danger-zone">
        <h2>Apagar projeto</h2>
        {canDeleteProject(project.status) ? (
          <>
            <p className="muted">
              Apaga o projeto, os pisos e os PDFs. <strong>Não pode ser desfeito</strong>. Se só queres tirá-lo da lista, arquiva-o.
            </p>
            <button className="danger" onClick={() => setDeleting(true)}>
              Apagar projeto…
            </button>
          </>
        ) : (
          <p className="muted">
            Um projeto "{PROJECT_STATUS_LABEL[project.status]}" tem histórico de obra (horas reais, margens) que serve para calibrar as regras.
            Não pode ser apagado: arquiva-o.
          </p>
        )}
      </section>
      {deleting && (
        <DeleteDialog
          name={project.name}
          floors={project.floors.length}
          onCancel={() => setDeleting(false)}
          onConfirm={async (typed) => {
            await api.deleteProject(project.id, typed);
            go("/");
          }}
        />
      )}
    </div>
    </Shell>
  );
}

const STEPS: ProjectStatus[] = ["levantamento", "orcamento", "enviado", "adjudicado", "em_obra", "concluido"];

function Stepper({ status }: { status: ProjectStatus }) {
  const lost = status === "perdido";
  const current = lost ? STEPS.indexOf("enviado") : STEPS.indexOf(status);
  return (
    <ol className="stepper" aria-label="Estado do projeto">
      {STEPS.map((s, i) => (
        <li key={s} className={i < current ? "done" : i === current ? (lost ? "lost" : "current") : ""} aria-current={i === current ? "step" : undefined}>
          <span className="dot">{i < current ? "✓" : i + 1}</span>
          {i === current && lost ? "Perdido" : PROJECT_STATUS_LABEL[s]}
        </li>
      ))}
    </ol>
  );
}

function describeEvent(kind: string, from: ProjectStatus | null, to: ProjectStatus | null) {
  if (kind === "criado") return "Projeto criado";
  if (kind === "arquivado") return "Arquivado";
  if (kind === "desarquivado") return "Desarquivado";
  return `${from ? PROJECT_STATUS_LABEL[from] : "—"} → ${to ? PROJECT_STATUS_LABEL[to] : "—"}`;
}

function DeleteDialog({ name, floors, onCancel, onConfirm }: { name: string; floors: number; onCancel: () => void; onConfirm: (typed: string) => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-label="Apagar projeto">
        <h3>Apagar "{name}"?</h3>
        <p>
          Vai apagar o projeto, {floors} piso(s) e os respetivos PDFs. Não há forma de recuperar, a não ser a partir de uma cópia de segurança.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await onConfirm(typed);
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          <label>
            Para confirmar, escreve o nome do projeto
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="row end">
            <button type="button" onClick={onCancel}>
              Cancelar
            </button>
            <button className="danger solid" disabled={busy || typed.trim() !== name.trim()}>
              Apagar definitivamente
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
