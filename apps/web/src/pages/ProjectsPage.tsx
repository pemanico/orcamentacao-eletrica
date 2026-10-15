import { useEffect, useState, type FormEvent } from "react";
import { api, type Project } from "../api";
import { go } from "../nav";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", client: "", address: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listProjects().then(setProjects, (e: Error) => setError(e.message));
  }, []);

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
    <div className="page">
      <header className="page-header">
        <h1>Orçamentação Elétrica</h1>
        <p className="muted">Fase 1 · planta</p>
      </header>

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

      <section className="card">
        <h2>Projetos</h2>
        {projects === null ? (
          <p className="muted">A carregar…</p>
        ) : projects.length === 0 ? (
          <p className="muted">Ainda não há projetos.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Projeto</th>
                <th>Cliente</th>
                <th>Morada</th>
                <th>Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => go(`/projeto/${p.id}`)}>
                  <td>{p.name}</td>
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
  );
}
