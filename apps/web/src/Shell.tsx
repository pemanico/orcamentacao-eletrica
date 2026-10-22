import { useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export interface Crumb {
  label: string;
  href?: string;
}

/** Disparado sempre que uma regra muda, para o contador do menu se atualizar. */
export const RULES_CHANGED = "orc:regras-alteradas";

export type Section = "projetos" | "regras" | "dados";

/** Barra de topo comum: menu + caminho de navegação (breadcrumb). */
export function Shell({ section, crumbs, children, full = false }: { section: Section; crumbs: Crumb[]; children: ReactNode; full?: boolean }) {
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    const load = () =>
      api.ruleSummary().then(
        (t) => setPending(t.reduce((n, x) => n + x.pending, 0)),
        () => setPending(null),
      );
    void load();
    window.addEventListener(RULES_CHANGED, load);
    return () => window.removeEventListener(RULES_CHANGED, load);
  }, []);

  return (
    <div className={`shell ${full ? "shell-full" : ""}`}>
      <header className="topbar">
        <a href="#/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⚡
          </span>
          Orçamentação
        </a>
        <nav className="menu" aria-label="Menu principal">
          <a href="#/" className={section === "projetos" ? "active" : ""}>
            Projetos
          </a>
          <a href="#/regras" className={section === "regras" ? "active" : ""}>
            Regras
            {pending !== null && pending > 0 && (
              <span className="menu-badge" title={`${pending} regra(s) por aprovar`}>
                {pending}
              </span>
            )}
          </a>
          <a href="#/dados" className={section === "dados" ? "active" : ""}>
            Dados
          </a>
        </nav>
        <ol className="crumbs" aria-label="Estás aqui">
          {crumbs.map((c, i) => (
            <li key={i}>
              {c.href && i < crumbs.length - 1 ? <a href={c.href}>{c.label}</a> : <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>}
            </li>
          ))}
        </ol>
      </header>
      <div className="shell-body">{children}</div>
    </div>
  );
}
