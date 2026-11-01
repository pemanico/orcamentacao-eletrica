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

/** Nome por extenso dos elementos conhecidos; os outros: código com espaços. */
const NAMES: Record<string, string> = {
  tomada: "Tomada",
  tomada_tv: "Tomada de TV",
  tomada_rede: "Tomada de rede (RJ45)",
  tomada_forno: "Tomada do forno",
  tomada_placa: "Tomada da placa",
  tomada_frigorifico: "Tomada do frigorífico",
  tomada_exaustor: "Tomada do exaustor",
  tomada_microondas: "Tomada do micro-ondas",
  tomada_maquina_loica: "Tomada da máquina da loiça",
  tomada_maquina_roupa: "Tomada da máquina da roupa",
  tomada_bancada: "Tomada de bancada",
  tomada_bomba_calor: "Tomada da bomba de calor",
  ponto_luz: "Ponto de luz",
  foco: "Foco encastrado",
  interruptor: "Interruptor",
  interruptor_comutado: "Comutador de escada",
  interruptor_estore: "Comando de estore",
  estore_motor: "Motor de estore",
  quadro_eletrico: "Quadro elétrico (QE)",
  ati: "Quadro de telecomunicações (ATI)",
};

/**
 * Equipamentos do piso: não vêm dos defaults por divisão, põem-se sempre à mão e estão sempre
 * na paleta. O QE é a origem dos percursos de cabo (F3).
 */
export const FLOOR_EQUIPMENT = ["quadro_eletrico", "ati"] as const;

export function elementName(code: string): string {
  const known = NAMES[code.toLowerCase()];
  if (known) return known;
  const s = code.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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
  if (e === "quadro_eletrico") {
    // quadro (panelboard): retângulo com metade preenchida
    body = (
      <>
        <rect x={x - r * 1.6} y={y - r * 0.8} width={r * 3.2} height={r * 1.6} strokeWidth={stroke} />
        <polygon points={`${x - r * 1.6},${y + r * 0.8} ${x + r * 1.6},${y - r * 0.8} ${x + r * 1.6},${y + r * 0.8}`} className="filled" strokeWidth={stroke} />
      </>
    );
  } else if (e === "ati") {
    body = (
      <>
        <rect x={x - r * 1.6} y={y - r * 0.8} width={r * 3.2} height={r * 1.6} strokeWidth={stroke} />
        {label("ATI", 7.5)}
      </>
    );
  } else if (e === "tomada_rede") {
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
