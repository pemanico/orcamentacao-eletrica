import { useEffect, useState } from "react";
import { api, type DataInfo } from "../api";
import { Shell } from "../Shell";

export function DataPage() {
  const [info, setInfo] = useState<DataInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.info().then(setInfo, (e: Error) => setError(e.message));
  }, []);

  async function backup() {
    setBackupMsg(null);
    setBusy(true);
    try {
      const r = await api.backup();
      setBackupMsg({ ok: true, text: `Cópia criada em ${r.folder}` });
      setInfo(await api.info());
    } catch (err) {
      setBackupMsg({ ok: false, text: `Não foi possível criar a cópia: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell section="dados" crumbs={[{ label: "Dados" }]}>
      <div className="page">
        <header className="page-header">
          <h1>Os teus dados</h1>
          <p className="muted">Tudo o que fazes na app (projetos, plantas, regras) é gravado automaticamente nesta base de dados.</p>
        </header>
        {error && <p className="error">{error}</p>}
        {info && (
          <section className="card data-card">
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
            <button className="primary" onClick={backup} disabled={busy}>
              Fazer cópia de segurança agora
            </button>
            {backupMsg && <p className={backupMsg.ok ? "ok" : "error"}>{backupMsg.text}</p>}
            <p className="muted small">
              A cópia inclui a base de dados (com as regras) e os PDFs. Fica no mesmo disco: copia a pasta das cópias para o OneDrive ou uma pen
              de vez em quando.
            </p>
          </section>
        )}
      </div>
    </Shell>
  );
}

/** "copia-20261022-210809" → "22/10/2026 21:08" */
function formatStamp(name: string | null) {
  const m = name && /copia-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(name);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : (name ?? "—");
}
