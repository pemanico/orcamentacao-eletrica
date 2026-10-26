import { useEffect, useMemo, useState } from "react";
import {
  CIRCUIT_KINDS,
  LOAD_LABEL,
  QUANTITY_BASE_LABEL,
  type QuantityBase,
  REFERENCE_TABLES,
  loadInconsistencies,
  type LoadKind,
  type ReferenceFillPlan,
  RULE_STATES,
  RULE_STATE_LABEL,
  RULE_TABLES,
  RULE_TABLE_IDS,
  approvalBlockers,
  roomTypeShort,
  type ColumnDef,
  type RoomTypeInfo,
  type RuleRow,
  type RuleState,
  type RuleTableId,
} from "@orc/core";
import { api } from "../api";
import { RULES_CHANGED, Shell } from "../Shell";
import { useRoomTypes } from "../roomTypes";

const optionLabel = (col: ColumnDef, v: string, catalog: RoomTypeInfo[]) => {
  if (col.key === "divisao" || col.key === "defaults_como") return roomTypeShort(catalog, v);
  if (col.key === "carga") return LOAD_LABEL[v as LoadKind] ?? v;
  if (col.key === "por") return QUANTITY_BASE_LABEL[v as QuantityBase] ?? v;
  if ((CIRCUIT_KINDS as readonly string[]).includes(v)) return v === "iluminacao" ? "iluminação" : v;
  return v;
};

/** Minúsculas sem acentos, para pesquisar "cozinha" e encontrar "Cozinha" ou "cozínha". */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const show = (v: string | number | null | undefined) =>
  v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : v;

export function RulesPage({ tableId }: { tableId: RuleTableId }) {
  const def = RULE_TABLES[tableId];
  const [rows, setRows] = useState<RuleRow[] | null>(null);
  const [summary, setSummary] = useState<Record<string, { total: number; pending: number }>>({});
  const [onlyPending, setOnlyPending] = useState(false);
  const [search, setSearch] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { catalog } = useRoomTypes();
  const [fillPlan, setFillPlan] = useState<ReferenceFillPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const toggleSelected = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  async function approveSelected() {
    setError(null);
    setConfirmBulk(false);
    try {
      const r = await api.approveRules(tableId, [...selected]);
      const fresh = await api.listRules(tableId);
      setRows(fresh);
      setSelected(new Set());
      const label = (id: string) => {
        const row = fresh.find((x) => x.id === id);
        return row ? def.columns.slice(0, 2).map((c) => show(row.values[c.key])).filter(Boolean).join(" · ") : id;
      };
      setBulkResult(
        `${r.approved.length} aprovada(s).` +
          (r.skipped.length ? ` Ficaram por aprovar ${r.skipped.length}: ${r.skipped.map((x) => `${label(x.id)} (${x.blockers.join(", ")})`).join("; ")}.` : ""),
      );
      void refreshSummary();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const [fillDone, setFillDone] = useState<string | null>(null);

  async function previewFill() {
    setError(null);
    setFillDone(null);
    try {
      setFillPlan(await api.referencePreview(tableId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function applyFill() {
    setError(null);
    try {
      const done = await api.referenceApply(tableId);
      setFillPlan(null);
      const n = done.updates.length + done.inserts.length;
      setFillDone(n ? `${n} linha(s) preenchida(s), em Proposta. Revê e aprova uma a uma.` : "Nada para preencher.");
      setRows(await api.listRules(tableId));
      void refreshSummary();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const refreshSummary = () =>
    api.ruleSummary().then((s) => {
      setSummary(Object.fromEntries(s.map((t) => [t.id, t])));
      window.dispatchEvent(new Event(RULES_CHANGED));
    }, () => {});

  useEffect(() => {
    setRows(null);
    setFillPlan(null);
    setFillDone(null);
    setSelected(new Set());
    setConfirmBulk(false);
    setBulkResult(null);
    setSearch("");
    setRoomFilter("");
    api.listRules(tableId).then(setRows, (e: Error) => setError(e.message));
    void refreshSummary();
  }, [tableId]);

  const visible = useMemo(() => {
    const q = fold(search.trim());
    return (rows ?? []).filter((r) => {
      if (onlyPending && r.state === "aprovada") return false;
      if (roomFilter && r.values.divisao !== roomFilter) return false;
      if (!q) return true;
      const text = [
        ...def.columns.map((c) => (c.key === "divisao" && typeof r.values.divisao === "string" ? `${r.values.divisao} ${roomTypeShort(catalog, r.values.divisao)}` : show(r.values[c.key]))),
        r.source,
        r.notes,
      ].join(" ");
      return fold(text).includes(q);
    });
  }, [rows, onlyPending, search, roomFilter, def, catalog]);
  const roomsInTable = useMemo(
    () => (tableId === "defaults_divisao" ? [...new Set((rows ?? []).map((r) => r.values.divisao).filter((d): d is string => typeof d === "string"))] : []),
    [rows, tableId],
  );
  const selectable = visible.filter((r) => r.state !== "aprovada");
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

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
    setError(null);
    try {
      await api.deleteRule(tableId, id);
    } catch (e) {
      return setError((e as Error).message);
    }
    setRows((rs) => rs?.filter((r) => r.id !== id) ?? rs);
    void refreshSummary();
  }

  // defaults: tipos de divisão sem nenhuma linha (ex.: um tipo acabado de criar)
  const withoutDefaults =
    tableId === "defaults_divisao" && rows
      ? catalog.filter((t) => t.code !== "outro" && !t.base && !rows.some((r) => r.values.divisao === t.code))
      : [];

  async function addDefaultsFor(code: string) {
    const row = await api.createRule("defaults_divisao", { divisao: code, elemento: "ponto_luz" });
    setRows((rs) => [...(rs ?? []), row]);
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
          <a href="#/regras/calculadora">Calculadora de secções</a>
        </nav>

        <section className="card">
          <div className="rules-head">
            <div>
              <p>{def.description}</p>
              {def.requiresSource && <p className="muted small">Para aprovar uma linha é obrigatório indicar a fonte (ex.: "RTIEBT 801.2", "formador").</p>}
              {def.commercial && <p className="muted small">Valores comerciais: ficam só na tua base de dados local, nunca no GitHub.</p>}
            </div>
            <div className="rules-actions">
              <input
                type="search"
                className="rules-search"
                aria-label="Pesquisar nas regras"
                placeholder="Pesquisar…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setConfirmBulk(false);
                }}
              />
              {tableId === "defaults_divisao" && (
                <select
                  aria-label="Filtrar por divisão"
                  value={roomFilter}
                  onChange={(e) => {
                    setRoomFilter(e.target.value);
                    setConfirmBulk(false);
                  }}
                >
                  <option value="">Todas as divisões</option>
                  {roomsInTable.map((d) => (
                    <option key={d} value={d}>
                      {roomTypeShort(catalog, d)}
                    </option>
                  ))}
                </select>
              )}
              <label className="check">
                <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
                Só por aprovar
              </label>
              {REFERENCE_TABLES.includes(tableId) && (
                <button onClick={() => void previewFill()} title="Preenche células vazias com os valores do RTIEBT (regras/referencia_rtiebt.csv)">
                  Preencher com referência
                </button>
              )}
              <a className="button" href={`/api/rules/${tableId}/export`} download>
                Exportar CSV
              </a>
              <button className="primary" onClick={addRow}>
                + Linha
              </button>
            </div>
          </div>

          {withoutDefaults.length > 0 && (
            <p className="warn small" data-testid="sem-defaults">
              Tipos sem defaults:{" "}
              {withoutDefaults.map((t, i) => (
                <span key={t.code}>
                  {i > 0 && ", "}
                  <button className="link-btn" onClick={() => void addDefaultsFor(t.code)} title="Acrescenta uma linha para este tipo">
                    {t.short}
                  </button>
                </span>
              ))}
              . Sem linhas aprovadas, a F2 não propõe pontos nessas divisões.
            </p>
          )}
          {fillPlan && <FillPreview plan={fillPlan} onApply={() => void applyFill()} onCancel={() => setFillPlan(null)} />}
          {fillDone && (
            <p className="muted small" data-testid="fill-done">
              {fillDone}
            </p>
          )}
          {tableId === "tipos_circuito" &&
            rows &&
            loadInconsistencies(rows).map((m) => (
              <p key={m} className="warn small" data-testid="carga-desalinhada">
                Valores desalinhados — {m}
              </p>
            ))}
          {selected.size > 0 && (
            <div className="bulk-bar" data-testid="bulk-bar">
              <span>{selected.size} selecionada(s)</span>
              {confirmBulk ? (
                <>
                  <button className="primary" onClick={() => void approveSelected()}>
                    Confirmar: aprovar {selected.size} sem rever uma a uma
                  </button>
                  <button onClick={() => setConfirmBulk(false)}>Cancelar</button>
                </>
              ) : (
                <>
                  <button className="primary" onClick={() => setConfirmBulk(true)}>
                    Aprovar {selected.size} selecionada(s)
                  </button>
                  <button onClick={() => setSelected(new Set())}>Limpar seleção</button>
                </>
              )}
            </div>
          )}
          {bulkResult && (
            <p className="muted small" data-testid="bulk-result">
              {bulkResult}
            </p>
          )}
          {error && <p className="error">{error}</p>}
          {rows === null ? (
            <p className="muted">A carregar…</p>
          ) : (
            <div className="grid-scroll rules-table-scroll">
              <table className="table rules-table">
                <thead>
                  <tr>
                    <th className="sel-col">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todas as linhas por aprovar visíveis"
                        title="Seleciona as linhas visíveis que não estão aprovadas"
                        checked={allSelected}
                        disabled={selectable.length === 0}
                        onChange={(e) => {
                          setConfirmBulk(false);
                          setSelected(e.target.checked ? new Set(selectable.map((r) => r.id)) : new Set());
                        }}
                      />
                    </th>
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
                    <RuleRowEditor
                      key={r.id}
                      tableId={tableId}
                      row={r}
                      catalog={catalog}
                      onSaved={replace}
                      onDelete={() => removeRow(r.id)}
                      selected={selected.has(r.id)}
                      onSelect={(on) => {
                        setConfirmBulk(false);
                        toggleSelected(r.id, on);
                      }}
                    />
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={def.columns.length + 5} className="muted">
                        {search || roomFilter ? "Nenhuma linha corresponde ao filtro." : onlyPending ? "Tudo aprovado nesta tabela." : "Sem linhas."}
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

function FillPreview({ plan, onApply, onCancel }: { plan: ReferenceFillPlan; onApply: () => void; onCancel: () => void }) {
  const empty = plan.updates.length === 0 && plan.inserts.length === 0;
  return (
    <div className="card fill-preview" data-testid="fill-preview">
      <h3>Preencher com referência</h3>
      <p className="muted small">
        Só células vazias; linhas aprovadas não são tocadas; tudo fica em <strong>Proposta</strong> e a fonte (artigo RTIEBT) é acrescentada.
        O que o regulamento não fixa (disjuntor, potência dos aparelhos, simultaneidade na habitação) fica por preencher.
      </p>
      {empty && <p>Nada para preencher.</p>}
      {plan.updates.length > 0 && (
        <ul className="small">
          {plan.updates.map((u) => (
            <li key={u.id}>
              <strong>{u.label}</strong>:{" "}
              {u.changes.map((c) => `${c.label.toLowerCase()} = ${String(c.value).replace(".", ",")} (${c.source})`).join("; ")}
            </li>
          ))}
        </ul>
      )}
      {plan.inserts.length > 0 && (
        <ul className="small">
          {plan.inserts.map((i) => (
            <li key={i.label}>
              <strong>novo:</strong> {i.label} = {String(i.values.valor).replace(".", ",")} {i.values.unidade ?? ""} ({i.source})
            </li>
          ))}
        </ul>
      )}
      {plan.skipped.length > 0 && (
        <p className="muted small">
          Sem carga indicada (escolhe-a na coluna Carga): {plan.skipped.map((s) => s.label).join(", ")}.
        </p>
      )}
      <div className="rules-actions">
        <button onClick={onCancel}>Cancelar</button>
        {!empty && (
          <button className="primary" onClick={onApply}>
            Aplicar
          </button>
        )}
      </div>
    </div>
  );
}

function RuleRowEditor({
  tableId,
  row,
  catalog,
  onSaved,
  onDelete,
  selected,
  onSelect,
}: {
  tableId: RuleTableId;
  row: RuleRow;
  catalog: RoomTypeInfo[];
  onSaved: (r: RuleRow) => void;
  onDelete: () => void;
  selected: boolean;
  onSelect: (on: boolean) => void;
}) {
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
        <td className="sel-col">
          <input
            type="checkbox"
            aria-label="Selecionar linha"
            checked={selected}
            disabled={row.state === "aprovada"}
            onChange={(e) => onSelect(e.target.checked)}
          />
        </td>
        {def.columns.map((c) => (
          <td key={c.key}>
            {c.kind === "enum" ? (
              <select
                aria-label={c.label}
                value={row.values[c.key] === null ? "" : String(row.values[c.key])}
                onChange={(e) => save({ values: { [c.key]: e.target.value || null } })}
              >
                <option value="">—</option>
                {(c.dynamicOptions === "room_types" ? catalog.map((t) => t.code) : c.options!).map((o) => (
                  <option key={o} value={o}>
                    {optionLabel(c, o, catalog)}
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
          <td colSpan={def.columns.length + 5} className={error ? "error small" : "muted small"}>
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
