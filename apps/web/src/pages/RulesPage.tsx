import { useEffect, useMemo, useState } from "react";
import {
  CIRCUIT_KINDS,
  RULE_STATES,
  RULE_STATE_LABEL,
  RULE_TABLES,
  RULE_TABLE_IDS,
  ROOM_TYPE_LABEL,
  approvalBlockers,
  type ColumnDef,
  type RoomType,
  type RuleRow,
  type RuleState,
  type RuleTableId,
} from "@orc/core";
import { api } from "../api";
import { RULES_CHANGED, Shell } from "../Shell";

const optionLabel = (col: ColumnDef, v: string) => {
  if (col.key === "divisao") return ROOM_TYPE_LABEL[v as RoomType]?.split(" (")[0] ?? v;
  if ((CIRCUIT_KINDS as readonly string[]).includes(v)) return v === "iluminacao" ? "iluminação" : v;
  return v;
};

const show = (v: string | number | null | undefined) =>
  v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : v;

export function RulesPage({ tableId }: { tableId: RuleTableId }) {
  const def = RULE_TABLES[tableId];
  const [rows, setRows] = useState<RuleRow[] | null>(null);
  const [summary, setSummary] = useState<Record<string, { total: number; pending: number }>>({});
  const [onlyPending, setOnlyPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSummary = () =>
    api.ruleSummary().then((s) => {
      setSummary(Object.fromEntries(s.map((t) => [t.id, t])));
      window.dispatchEvent(new Event(RULES_CHANGED));
    }, () => {});

  useEffect(() => {
    setRows(null);
    api.listRules(tableId).then(setRows, (e: Error) => setError(e.message));
    void refreshSummary();
  }, [tableId]);

  const visible = useMemo(() => (rows ?? []).filter((r) => !onlyPending || r.state !== "aprovada"), [rows, onlyPending]);

  const replace = (row: RuleRow) => {
    setRows((rs) => rs?.map((r) => (r.id === row.id ? row : r)) ?? rs);
    void refreshSummary();
  };

  async function addRow() {
    const row = await api.createRule(tableId);
    setRows((rs) => [...(rs ?? []), row]);
    void refreshSummary();
  }

  async function removeRow(id: string) {
    await api.deleteRule(tableId, id);
    setRows((rs) => rs?.filter((r) => r.id !== id) ?? rs);
    void refreshSummary();
  }

  return (
    <Shell section="regras" crumbs={[{ label: "Regras", href: "#/regras" }, { label: def.label }]}>
      <div className="page wide">
        <header className="page-header">
          <h1>Regras</h1>
          <p className="muted">
            Só as linhas <strong>aprovadas</strong> entram nos cálculos. Alterar uma regra aprovada retira-lhe a aprovação.
          </p>
        </header>

        <nav className="tabs" aria-label="Tabelas de regras">
          {RULE_TABLE_IDS.map((id) => (
            <a key={id} href={`#/regras/${id}`} className={id === tableId ? "active" : ""}>
              {RULE_TABLES[id].label}
              {summary[id] && (
                <span className={`tab-count ${summary[id].pending ? "pending" : "done"}`} title={`${summary[id].pending} por aprovar de ${summary[id].total}`}>
                  {summary[id].pending ? summary[id].pending : "✔"}
                </span>
              )}
            </a>
          ))}
        </nav>

        <section className="card">
          <div className="rules-head">
            <div>
              <p>{def.description}</p>
              {def.requiresSource && <p className="muted small">Para aprovar uma linha é obrigatório indicar a fonte (ex.: "RTIEBT 801.2", "formador").</p>}
              {def.commercial && <p className="muted small">Valores comerciais: ficam só na tua base de dados local, nunca no GitHub.</p>}
            </div>
            <div className="rules-actions">
              <label className="check">
                <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
                Só por aprovar
              </label>
              <a className="button" href={`/api/rules/${tableId}/export`} download>
                Exportar CSV
              </a>
              <button className="primary" onClick={addRow}>
                + Linha
              </button>
            </div>
          </div>

          {error && <p className="error">{error}</p>}
          {rows === null ? (
            <p className="muted">A carregar…</p>
          ) : (
            <div className="grid-scroll">
              <table className="table rules-table">
                <thead>
                  <tr>
                    {def.columns.map((c) => (
                      <th key={c.key} style={{ minWidth: c.width }}>
                        {c.label}
                        {c.unit && <span className="muted"> ({c.unit})</span>}
                        {c.required && <span className="req" title="Obrigatório para aprovar">*</span>}
                      </th>
                    ))}
                    <th style={{ minWidth: 130 }}>Estado</th>
                    <th style={{ minWidth: 150 }}>Fonte</th>
                    <th style={{ minWidth: 220 }}>Notas</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <RuleRowEditor key={r.id} tableId={tableId} row={r} onSaved={replace} onDelete={() => removeRow(r.id)} />
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={def.columns.length + 4} className="muted">
                        {onlyPending ? "Tudo aprovado nesta tabela." : "Sem linhas."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}

function RuleRowEditor({ tableId, row, onSaved, onDelete }: { tableId: RuleTableId; row: RuleRow; onSaved: (r: RuleRow) => void; onDelete: () => void }) {
  const def = RULE_TABLES[tableId];
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const blockers = approvalBlockers(def, row);

  async function save(patch: Parameters<typeof api.updateRule>[2]) {
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.updateRule(tableId, row.id, patch));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr className={`rule-row state-${row.state} ${saving ? "saving" : ""}`}>
        {def.columns.map((c) => (
          <td key={c.key}>
            {c.kind === "enum" ? (
              <select
                aria-label={c.label}
                value={row.values[c.key] === null ? "" : String(row.values[c.key])}
                onChange={(e) => save({ values: { [c.key]: e.target.value || null } })}
              >
                <option value="">—</option>
                {c.options!.map((o) => (
                  <option key={o} value={o}>
                    {optionLabel(c, o)}
                  </option>
                ))}
              </select>
            ) : (
              <CellInput
                label={c.label}
                numeric={c.kind !== "text"}
                value={show(row.values[c.key])}
                onCommit={(v) => save({ values: { [c.key]: v } })}
              />
            )}
          </td>
        ))}
        <td>
          <select
            aria-label="Estado"
            className={`state-select state-${row.state}`}
            value={row.state}
            onChange={(e) => save({ state: e.target.value as RuleState })}
            title={row.state !== "aprovada" && blockers.length ? `Para aprovar: ${blockers.join(", ")}` : undefined}
          >
            {RULE_STATES.map((s) => (
              <option key={s} value={s} disabled={s === "aprovada" && blockers.length > 0}>
                {RULE_STATE_LABEL[s]}
              </option>
            ))}
          </select>
        </td>
        <td>
          <CellInput label="Fonte" value={row.source} onCommit={(v) => save({ source: v })} />
        </td>
        <td>
          <CellInput label="Notas" value={row.notes} onCommit={(v) => save({ notes: v })} />
        </td>
        <td>
          <button className="icon-btn" title="Apagar linha" aria-label="Apagar linha" onClick={onDelete}>
            ×
          </button>
        </td>
      </tr>
      {(error || (row.state !== "aprovada" && blockers.length > 0 && row.state === "proposta")) && (
        <tr className="rule-msg">
          <td colSpan={def.columns.length + 4} className={error ? "error small" : "muted small"}>
            {error ?? `Para aprovar: ${blockers.join(", ")}.`}
          </td>
        </tr>
      )}
    </>
  );
}

function CellInput({ label, value, numeric, onCommit }: { label: string; value: string; numeric?: boolean; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      aria-label={label}
      className={numeric ? "num-input" : ""}
      inputMode={numeric ? "decimal" : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(value);
      }}
    />
  );
}
