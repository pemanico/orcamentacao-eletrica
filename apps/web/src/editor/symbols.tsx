/**
 * Símbolos dos pontos na planta — simbologia americana (decisão do Ordep, 2026-11-01).
 * O ponto guarda só o código do elemento; o desenho sai daqui, por isso trocar de simbologia
 * (ex.: IEC 60617) é mudar só este ficheiro.
 *
 * Tamanho em píxeis de ecrã (sw converte), para o símbolo se ler em qualquer zoom.
 */
import { placementKind } from "@orc/core";

/** Abreviatura de uma tomada dedicada: tomada_forno → F, tomada_maquina_roupa → MR. */
const ABBR: Record<string, string> = {
  tomada_forno: "F",
  tomada_placa: "P",
  tomada_frigorifico: "FR",
  tomada_exaustor: "EX",
  tomada_microondas: "MO",
  tomada_maquina_loica: "ML",
  tomada_maquina_roupa: "MR",
  tomada_bancada: "B",
  tomada_bomba_calor: "BC",
};

export function PointSymbol({ elemento, x, y, sw, selected }: { elemento: string; x: number; y: number; sw: (px: number) => number; selected?: boolean }) {
  const r = sw(7);
  const stroke = sw(selected ? 2.5 : 1.6);
  const label = (t: string, size = 9) => (
    <text x={x} y={y + sw(size * 0.36)} fontSize={sw(size)} textAnchor="middle" className="point-label">
      {t}
    </text>
  );
  const e = elemento.toLowerCase();
  const kind = placementKind(e);
  let body;
  if (e === "tomada_rede") {
    // dados/telefone: triângulo
    body = <polygon points={`${x},${y - r} ${x + r},${y + r * 0.8} ${x - r},${y + r * 0.8}`} strokeWidth={stroke} />;
  } else if (e === "tomada_tv") {
    body = (
      <>
        <rect x={x - r} y={y - r * 0.8} width={r * 2} height={r * 1.6} strokeWidth={stroke} />
        {label("TV", 7)}
      </>
    );
  } else if (kind === "teto") {
    // ponto de luz: círculo com cruz; foco encastrado: círculo com R
    body = (
      <>
        <circle cx={x} cy={y} r={r} strokeWidth={stroke} />
        {e.includes("foco") ? (
          label("R", 9)
        ) : (
          <path d={`M ${x - r * 0.7} ${y - r * 0.7} L ${x + r * 0.7} ${y + r * 0.7} M ${x + r * 0.7} ${y - r * 0.7} L ${x - r * 0.7} ${y + r * 0.7}`} strokeWidth={stroke} />
        )}
      </>
    );
  } else if (kind === "porta" || kind === "junto_janela") {
    // interruptor: S; comutado: S3; comando de estore: SM
    const t = kind === "junto_janela" ? "SM" : e.includes("comutad") ? "S3" : e.includes("inversor") ? "S4" : "S";
    body = label(t, 11);
  } else if (kind === "janela") {
    body = (
      <>
        <rect x={x - r} y={y - r} width={r * 2} height={r * 2} strokeWidth={stroke} />
        {label("M", 9)}
      </>
    );
  } else {
    // tomada: círculo com duas linhas paralelas (duplex receptacle); dedicadas com abreviatura
    const abbr = ABBR[e] ?? (e.startsWith("tomada_") ? e.slice(7, 9).toUpperCase() : "");
    body = (
      <>
        <circle cx={x} cy={y} r={r} strokeWidth={stroke} />
        <path d={`M ${x - r * 1.5} ${y - r * 0.35} L ${x + r * 1.5} ${y - r * 0.35} M ${x - r * 1.5} ${y + r * 0.35} L ${x + r * 1.5} ${y + r * 0.35}`} strokeWidth={stroke} />
        {abbr && (
          <text x={x + r * 1.3} y={y + r * 1.9} fontSize={sw(8)} className="point-label">
            {abbr}
          </text>
        )}
      </>
    );
  }
  return <g className={`point-symbol ${selected ? "selected" : ""}`}>{body}</g>;
}
