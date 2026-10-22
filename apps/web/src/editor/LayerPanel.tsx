import { useMemo, useState } from "react";
import type { DxfLayerRow } from "../dxfPlan";

/**
 * Layers do DXF dentro da planta escolhida: "Ver" mostra no fundo, "Snap" decide onde o
 * cursor agarra (por defeito só as paredes).
 */
export function LayerPanel({
  layers,
  hidden,
  snap,
  onChange,
  onChangeRegion,
}: {
  layers: DxfLayerRow[];
  hidden: string[];
  snap: string[];
  onChange: (hidden: string[], snap: string[]) => void;
  onChangeRegion?: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(true);
  const h = useMemo(() => new Set(hidden), [hidden]);
  const s = useMemo(() => new Set(snap), [snap]);
  const shown = layers.filter((l) => l.name.toLowerCase().includes(filter.toLowerCase()));

  const toggle = (set: Set<string>, name: string) => {
    const n = new Set(set);
    if (n.has(name)) n.delete(name);
    else n.add(name);
    return [...n];
  };

  return (
    <section className="layer-panel">
      <div className="compact-row">
        <h3 style={{ margin: 0 }}>
          Layers do DXF <span className="muted">({layers.length})</span>
        </h3>
        <button className="small-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Recolher" : "Mostrar"}
        </button>
      </div>
      {open && (
        <>
          <p className="muted small">
            Snap em: <strong>{snap.length ? snap.join(", ") : "nenhuma — o cursor não agarra a nada"}</strong>
          </p>
          <div className="row">
            <button
              className="small-btn"
              onClick={() => onChange(layers.map((l) => l.name).filter((n) => !s.has(n) && !/texto|text/i.test(n)), snap)}
              title="Esconde tudo exceto as layers de snap e os textos"
            >
              Só paredes e nomes
            </button>
            <button className="small-btn" onClick={() => onChange([], snap)}>
              Mostrar todas
            </button>
            {onChangeRegion && (
              <button className="small-btn" onClick={onChangeRegion}>
                Outra planta…
              </button>
            )}
          </div>
          {layers.length > 8 && <input className="layer-filter" placeholder="Filtrar layers…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
          <table className="table compact layer-table">
            <thead>
              <tr>
                <th>Layer</th>
                <th title="Mostrar no fundo">Ver</th>
                <th title="O cursor agarra a esta layer">Snap</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.name}>
                  <td title={`${l.segments} linhas, ${l.texts} textos`}>
                    {l.name} <span className="muted">{l.segments || l.texts}</span>
                  </td>
                  <td>
                    <input type="checkbox" aria-label={`Ver ${l.name}`} checked={!h.has(l.name)} onChange={() => onChange(toggle(h, l.name), snap)} />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Snap ${l.name}`}
                      checked={s.has(l.name)}
                      disabled={l.segments === 0}
                      onChange={() => onChange(hidden, toggle(s, l.name))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
