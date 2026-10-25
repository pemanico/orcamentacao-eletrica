import { useState } from "react";

/** Preferência de interface guardada no browser (painel aberto, ajuda visível). */
export function usePref(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : raw === "1";
    } catch {
      return initial;
    }
  });
  const set = (next: boolean) => {
    setV(next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      /* sem armazenamento: fica só nesta sessão */
    }
  };
  return [v, set];
}
