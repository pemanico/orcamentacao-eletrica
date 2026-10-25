import { useCallback, useEffect, useState, type RefObject } from "react";
import type { Point } from "@orc/core";

/** Vista do editor: zoom no cursor (roda), ajustar ao ecrã e conversão ecrã → página. */
export function useViewport(svgRef: RefObject<SVGSVGElement | null>, wrapRef: RefObject<HTMLDivElement | null>, plan: { width: number; height: number }) {
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const k = Math.min(width / plan.width, height / plan.height) * 0.95;
    setView({ k, tx: (width - plan.width * k) / 2, ty: (height - plan.height * k) / 2 });
  }, [plan.width, plan.height]);

  useEffect(() => {
    fit();
  }, [fit]);

  const toPage = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.tx) / view.k, y: (clientY - r.top - view.ty) / view.k };
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(60, Math.max(0.05, v.k * Math.pow(1.0015, -e.deltaY)));
        return { k, tx: mx - ((mx - v.tx) / v.k) * k, ty: my - ((my - v.ty) / v.k) * k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  return { view, setView, fit, toPage };
}
