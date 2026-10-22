import { useEffect, useState, type FormEvent } from "react";
import { api, type DataInfo, type Project } from "../api";
import { go } from "../nav";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", client: "", address: "" });
  const [busy, setBusy] = useState(false);

  const [info, setInfo] = useState<DataInfo | null>(null);
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects, (e: Error) => setError(e.message));
    api.info().then(setInfo, () => setInfo(null));
  }, []);

  async function backup() {
    setBackupMsg(null);
    try {
      const r = await api.backup();
      setBackupMsg({ ok: true, text: `Cópia criada em ${r.folder}` });
      setInfo(await api.info());
    } catch (err) {
      setBackupMsg({ ok: false, text: `Não foi possível criar a cópia: ${(err as Error).message}` });
    }
  }

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
        <p className="muted small">Tudo é gravado automaticamente. Clica num projeto para continuar onde ficaste.</p>
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
      {info && (
        <section className="card data-card">
          <h2>Os teus dados</h2>
          <dl className="facts">
            <dt>Base de dados</dt>
            <dd className="path">{info.dbFile}</dd>
            <dt>Conteúdo</dt>
            <dd>
              {info.projects} projeto(s) · {info.floors} piso(s) · {(info.dbBytes / 1024).toLocaleString("pt-PT", { maximumFractionDigits: 0 })} KB
            </dd>
            <dt>Última gravação</dt>
            <dd>{info.lastSavedAt ? new Date(info.lastSavedAt).toLocaleString("pt-PT") : "—"}</dd>
            <dt>Cópias de segurança</dt>
            <dd>
              {info.backupCount === 0 ? (
                <span className="warn">Nenhuma ainda.</span>
              ) : (
                <>
                  {info.backupCount} · última: {formatStamp(info.lastBackup)}
                </>
              )}
              <div className="path muted">{info.backupDir}</div>
            </dd>
          </dl>
          <button className="primary" onClick={backup}>
            Fazer cópia de segurança agora
          </button>
          {backupMsg && <p className={backupMsg.ok ? "ok" : "error"}>{backupMsg.text}</p>}
          <p className="muted small">
            A cópia inclui a base de dados e os PDFs. Fica no mesmo disco: copia a pasta das cópias para o OneDrive ou uma pen de vez em quando.
          </p>
        </section>
      )}
    </div>
  );
}

/** "copia-20261022-210809" → "22/10/2026 21:08" */
function formatStamp(name: string | null) {
  const m = name && /copia-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(name);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : (name ?? "—");
}
