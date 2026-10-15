import { useCallback, useState } from "react";

/** Histórico simples de estados imutáveis para anular/refazer. */
export function useHistory<T>(initial: T, limit = 200) {
  const [h, setH] = useState({ past: [] as T[], present: initial, future: [] as T[] });

  const commit = useCallback(
    (next: T | ((cur: T) => T)) =>
      setH((s) => {
        const value = typeof next === "function" ? (next as (cur: T) => T)(s.present) : next;
        if (value === s.present) return s;
        return { past: [...s.past, s.present].slice(-limit), present: value, future: [] };
      }),
    [limit],
  );

  const undo = useCallback(
    () =>
      setH((s) =>
        s.past.length === 0
          ? s
          : { past: s.past.slice(0, -1), present: s.past[s.past.length - 1]!, future: [s.present, ...s.future] },
      ),
    [],
  );

  const redo = useCallback(
    () =>
      setH((s) =>
        s.future.length === 0 ? s : { past: [...s.past, s.present], present: s.future[0]!, future: s.future.slice(1) },
      ),
    [],
  );

  return { state: h.present, commit, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
