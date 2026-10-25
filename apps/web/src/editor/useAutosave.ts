import { useCallback, useEffect, useRef, useState } from "react";
import type { FloorState } from "@orc/core";
import { ApiError, api, type Floor } from "../api";

export type SaveStatus = "guardado" | "por guardar" | "a guardar" | "erro" | "conflito";
type Meta = { name: string; ceilingHeightM: number };

/**
 * Gravação automática (~700 ms depois da última alteração) com controlo de revisão:
 * um 409 (outro separador gravou entretanto) passa a "conflito" e pára de gravar.
 * Também trata da aprovação, que grava primeiro o que estiver pendente.
 */
export function useAutosave(floor: Floor, state: FloorState, meta: Meta, setMessage: (m: string | null) => void) {
  const [approvedAt, setApprovedAt] = useState(floor.approvedAt);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("guardado");
  const revRef = useRef(floor.rev);
  const latest = useRef({ state, meta });
  latest.current = { state, meta };
  const savedRef = useRef(JSON.stringify({ state: floor.state, meta: { name: floor.name, ceilingHeightM: floor.ceilingHeightM } }));
  const savingRef = useRef(false);
  const againRef = useRef(false);

  const flush = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) {
      againRef.current = true;
      return false;
    }
    const snapshot = JSON.stringify(latest.current);
    if (snapshot === savedRef.current) return true;
    savingRef.current = true;
    setSaveStatus("a guardar");
    let ok = false;
    try {
      const { state: st, meta: m } = latest.current;
      const r = await api.saveFloor(floor.id, { rev: revRef.current, state: st, name: m.name, ceilingHeightM: m.ceilingHeightM });
      revRef.current = r.rev;
      savedRef.current = snapshot;
      setApprovedAt(r.approvedAt);
      ok = true;
    } catch (err) {
      setSaveStatus(err instanceof ApiError && err.status === 409 ? "conflito" : "erro");
      setMessage(`Não foi possível guardar: ${(err as Error).message}`);
      againRef.current = false;
      return false;
    } finally {
      savingRef.current = false;
    }
    if (againRef.current || JSON.stringify(latest.current) !== savedRef.current) {
      againRef.current = false;
      return flush();
    }
    setSaveStatus("guardado");
    return ok;
  }, [floor.id]);

  useEffect(() => {
    if (saveStatus === "conflito") return;
    if (JSON.stringify({ state, meta }) === savedRef.current) return;
    setSaveStatus("por guardar");
    const t = setTimeout(() => void flush(), 700);
    return () => clearTimeout(t);
  }, [state, meta, flush, saveStatus]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(latest.current) !== savedRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const approve = async () => {
    setMessage(null);
    if (!(await flush())) return;
    try {
      const r = await api.approveFloor(floor.id);
      setApprovedAt(r.approvedAt);
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  return { saveStatus, approvedAt, approve };
}
