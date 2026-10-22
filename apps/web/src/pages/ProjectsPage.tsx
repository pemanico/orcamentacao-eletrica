import { useEffect, useMemo, useState, type FormEvent } from "react";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, type ProjectStatus } from "@orc/core";
import { api, type Project } from "../api";
import { Shell } from "../Shell";
import { StatusBadge } from "../StatusBadge";
import { go } from "../nav";

export function ProjectsPage({ archived = false }: { archived?: boolean }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [counts, setCounts] = useState({ active: 0, archived: 0 });
  const [filter, setFilter] = useState<ProjectStatus | "">("");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", client: "", address: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProjects(null);
    api.listProjects(archived).then(
      (r) => {
        setProjects(r.projects);
        setCounts(r.counts);
      },
      (e: Error) => setError(e.message),
    );
  }, [archived]);

  const byStatus = useMemo(() => {
    const m = new Map<ProjectStatus, number>();
    for (const p of projects ?? []) m.set(p.status, (m.get(p.status) ?? 0) + 1);
    return m;
  }, [projects]);
  const shown = (projects ?? []).filter((p) => !filter || p.status === filter);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await api.createProject(form);
      go(`/projeto/${p.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell section="projetos" crumbs={archived ? [{ label: "Projetos", href: "#/" }, { label: "Arquivados" }] : [{ label: "Projetos" }]}>
      <div className="page">
        <header className="page-header">
          <h1>{archived ? "Projetos arquivados" : "Projetos"}</h1>
        </header>

        {!archived && (
          <section className="card">
            <h2>Novo projeto</h2>
            <form className="form-row" onSubmit={create}>
              <label>
                Nome
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Moradia Sintra" />
              </label>
              <label>
                Cliente
                <input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
              </label>
              <label className="grow">
                Morada
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </label>
              <button className="primary" disabled={busy || !form.name.trim()}>
                Criar
              </button>
            </form>
            {error && <p className="error">{error}</p>}
          </section>
        )}

        <nav className="tabs" aria-label="Ativos ou arquivados">
          <a href="#/" className={!archived ? "active" : ""}>
            Ativos <span className="tab-count done">{counts.active}</span>
          </a>
          <a href="#/arquivados" className={archived ? "active" : ""}>
            Arquivados <span className="tab-count done">{counts.archived}</span>
          </a>
        </nav>

        <section className="card">
          {!archived && (projects?.length ?? 0) > 0 && (
            <div className="status-filter" role="group" aria-label="Filtrar por estado">
              <button className={filter === "" ? "chip active" : "chip"} onClick={() => setFilter("")}>
                Todos <span className="muted">{projects?.length}</span>
              </button>
              {PROJECT_STATUSES.filter((s) => byStatus.get(s)).map((s) => (
                <button key={s} className={filter === s ? "chip active" : "chip"} onClick={() => setFilter(s)}>
                  {PROJECT_STATUS_LABEL[s]} <span className="muted">{byStatus.get(s)}</span>
                </button>
              ))}
            </div>
          )}
          {!archived && <p className="muted small">Tudo é gravado automaticamente. Clica num projeto para continuar onde ficaste.</p>}
          {projects === null ? (
            <p className="muted">A carregar…</p>
          ) : shown.length === 0 ? (
            <p className="muted">{archived ? "Nenhum projeto arquivado." : "Ainda não há projetos."}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Projeto</th>
                  <th>Estado</th>
                  <th>Cliente</th>
                  <th>Morada</th>
                  <th>Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => go(`/projeto/${p.id}`)}>
                    <td>{p.name}</td>
                    <td>
                      <StatusBadge status={p.status} archived={!!p.archivedAt} />
                    </td>
                    <td>{p.client}</td>
                    <td>{p.address}</td>
                    <td>{new Date(p.updatedAt).toLocaleString("pt-PT")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </Shell>
  );
}
