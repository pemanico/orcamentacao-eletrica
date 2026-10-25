import { useEffect, useState, type ReactNode } from "react";
import { CalibrationError, ROOM_TYPES, dist, normalizeName, roomTypeShort, type Point, type RoomTypeInfo } from "@orc/core";
import { roomColor } from "../roomTypes";
import { formatM } from "./draw";
import { parseNum } from "./util";

/** Campo numérico que aceita vírgula decimal e só grava ao sair/Enter. */
export function NumberField({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value).replace(".", ","));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(String(Math.round(value * 1000) / 1000).replace(".", ",")), [value]);
  const commitText = () => {
    const v = parseNum(text);
    if (!Number.isFinite(v) || v < min || v > max) {
      setError(`Entre ${min} e ${max}.`);
      return;
    }
    setError(null);
    if (v !== value) onCommit(v);
  };
  return (
    <label>
      {label}
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {error && <span className="error small">{error}</span>}
    </label>
  );
}

export function TypePicker({
  value,
  onChange,
  catalog,
  onCreate,
}: {
  value: string[];
  /** `label`: nome do tipo acabado de criar (o catálogo ainda não o tem) */
  onChange: (v: string[], label?: string) => void;
  catalog: RoomTypeInfo[];
  /** cria um tipo novo e devolve o código */
  onCreate: (name: string, base: string | null) => Promise<string>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // tipos usados pela divisão que entretanto deixaram de existir continuam visíveis
  const missing = value.filter((c) => !catalog.some((t) => t.code === c));
  const toggle = (code: string, on: boolean) => onChange(on ? [...value, code] : value.filter((x) => x !== code));

  async function create() {
    const n = name.trim();
    if (!n) return;
    const existing = catalog.find((t) => normalizeName(t.short) === normalizeName(n) || normalizeName(t.label) === normalizeName(n));
    if (existing) {
      if (!value.includes(existing.code)) onChange([...value, existing.code]);
      setAdding(false);
      setName("");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const code = await onCreate(n, base || null);
      onChange([...value, code], n);
      setAdding(false);
      setName("");
      setBase("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="types">
      <legend>Tipo (vários = open space)</legend>
      {[...catalog.map((t) => ({ code: t.code, label: t.label, mine: !t.builtin })), ...missing.map((c) => ({ code: c, label: `${c} (já não existe)`, mine: true }))].map((t) => (
        <label key={t.code} className="check">
          <input type="checkbox" checked={value.includes(t.code)} onChange={(e) => toggle(t.code, e.target.checked)} />
          <span className="swatch" style={{ background: roomColor(t.code, catalog) }} />
          {t.label}
          {t.mine && <span className="muted small" title="Criado por ti (Regras → Tipos de divisão)"> ★</span>}
        </label>
      ))}
      <div className="new-type">
        {adding ? (
          <>
            <input
              autoFocus
              aria-label="Nome do novo tipo"
              placeholder="ex.: Adega"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void create();
                }
              }}
            />
            <select aria-label="Defaults do novo tipo" value={base} onChange={(e) => setBase(e.target.value)}>
              <option value="">Defaults próprios (definir em Regras)</option>
              {ROOM_TYPES.filter((t) => t !== "outro").map((t) => (
                <option key={t} value={t}>
                  Usa os defaults de {roomTypeShort(catalog, t)}
                </option>
              ))}
            </select>
            <div className="row">
              <button type="button" className="small-btn primary" disabled={!name.trim() || busy} onClick={() => void create()}>
                Criar tipo
              </button>
              <button type="button" className="small-btn" onClick={() => setAdding(false)}>
                Cancelar
              </button>
            </div>
            {error && <p className="error small">{error}</p>}
          </>
        ) : (
          <button type="button" className="small-btn" onClick={() => setAdding(true)}>
            + Novo tipo
          </button>
        )}
      </div>
    </fieldset>
  );
}

export function Modal({ title, children, onCancel }: { title: string; children: ReactNode; onCancel: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function CalibrationDialog({
  pair,
  stamps,
  onCancel,
  onConfirm,
}: {
  pair: { a: Point; b: Point };
  stamps: number[];
  onCancel: () => void;
  onConfirm: (meters: number, stamp: number | null) => void;
}) {
  const [meters, setMeters] = useState("");
  const [stamp, setStamp] = useState<string>(stamps.length === 1 ? String(stamps[0]) : "");
  const [error, setError] = useState<string | null>(null);
  const units = dist(pair.a, pair.b);
  const suggested = stamp ? (units * 0.0254 * Number(stamp)) / 72 : null;

  const submit = () => {
    try {
      onConfirm(parseNum(meters), stamp ? Number(stamp) : null);
    } catch (e) {
      setError(e instanceof CalibrationError ? e.message : (e as Error).message);
    }
  };

  return (
    <Modal title="Calibrar escala" onCancel={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label>
          Comprimento real da cota (m)
          <input autoFocus inputMode="decimal" value={meters} onChange={(e) => setMeters(e.target.value)} placeholder="ex.: 4,20" />
        </label>
        <label>
          Escala indicada no carimbo (só para conferir)
          <select value={stamp} onChange={(e) => setStamp(e.target.value)}>
            <option value="">Nenhuma / não sei</option>
            {[...new Set([...stamps, 50, 100])].sort((a, b) => a - b).map((d) => (
              <option key={d} value={d}>
                1:{d}
                {stamps.includes(d) ? " (lida no PDF)" : ""}
              </option>
            ))}
          </select>
        </label>
        {suggested !== null && (
          <p className="muted">
            Se o PDF estiver à escala do carimbo, esta medida tem {formatM(suggested)} m.
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row end">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button className="primary" disabled={!meters.trim()}>
            Calibrar
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function RoomDialog({
  suggestion,
  catalog,
  onCreateType,
  existingNames,
  onCancel,
  onConfirm,
}: {
  suggestion?: { name: string; type: string | null };
  catalog: RoomTypeInfo[];
  onCreateType: (name: string, base: string | null) => Promise<string>;
  existingNames: string[];
  onCancel: () => void;
  onConfirm: (name: string, types: string[]) => void;
}) {
  const [name, setName] = useState(suggestion?.name ?? "");
  const [types, setTypes] = useState<string[]>(suggestion?.type ? [suggestion.type] : []);
  const duplicate = existingNames.some((n) => n.trim().toLowerCase() === name.trim().toLowerCase());

  return (
    <Modal title="Nova divisão" onCancel={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && types.length) onConfirm(name.trim(), types);
        }}
      >
        <label>
          Nome
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Quarto 1" />
        </label>
        {suggestion && <p className="muted small">Nome lido da planta do arquiteto. Confirma o tipo (vários = open space).</p>}
        {duplicate && <p className="warn small">Já existe uma divisão com este nome.</p>}
        <TypePicker
          value={types}
          catalog={catalog}
          onCreate={onCreateType}
          onChange={(t, label) => {
            setTypes(t);
            if (!name.trim() && t.length === 1) setName(label ?? roomTypeShort(catalog, t[0]!));
          }}
        />
        <div className="row end">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button className="primary" disabled={!name.trim() || types.length === 0}>
            Criar divisão
          </button>
        </div>
      </form>
    </Modal>
  );
}
