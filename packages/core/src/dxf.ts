/**
 * Leitor de DXF (texto, AutoCAD R12 até 2018+) para o que a app precisa: linhas por layer,
 * textos (nomes das divisões) e cotas (para deduzir as unidades). Não é um leitor completo:
 * ignora hatches, splines e sólidos, e aproxima arcos por segmentos.
 *
 * Lições do primeiro ficheiro real (moradia, 2022):
 *  - o cabeçalho ($INSUNITS) pode mentir: dizia centímetros e o desenho estava em metros;
 *  - um DXF é o projeto inteiro (implantação, várias versões do piso, alçados, cortes)
 *    no mesmo espaço de modelo → é preciso escolher a região da planta;
 *  - as paredes vêm numa layer própria ("arq_corte"), em linhas duplas.
 */
import type { Point, Segment } from "./types";

export interface DxfSegment extends Segment {
  layer: string;
}

export interface DxfText {
  layer: string;
  at: Point;
  height: number;
  text: string;
}

export interface DxfDimension {
  layer: string;
  a: Point;
  b: Point;
  /** valor medido, em unidades do desenho */
  measured: number;
}

export interface DxfLayerInfo {
  name: string;
  segments: number;
  texts: number;
}

export interface DxfDrawing {
  version: string | null;
  /** $INSUNITS do cabeçalho: 1 pol, 2 pés, 4 mm, 5 cm, 6 m (pode estar errado) */
  headerUnits: number | null;
  segments: DxfSegment[];
  texts: DxfText[];
  dimensions: DxfDimension[];
  layers: DxfLayerInfo[];
  extents: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** entidades ignoradas por tipo (para diagnóstico) */
  skipped: Record<string, number>;
}

export class DxfError extends Error {}

/**
 * Sufixo das layers "virtuais" com o contorno das tramas (HATCH). No primeiro DXF real as
 * divisórias finas só existiam como tramas, sem linhas de parede.
 */
export const HATCH_SUFFIX = " [trama]";
export const isHatchLayer = (name: string) => name.endsWith(HATCH_SUFFIX);

type Code = number;
type Pair = [Code, string];

interface RawEntity {
  type: string;
  pairs: Pair[];
}

interface Block {
  base: Point;
  entities: RawEntity[];
}

type Mat = [number, number, number, number, number, number]; // a b c d e f: x' = a x + c y + e
const IDENT: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const ap = (m: Mat, x: number, y: number): Point => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
const matScale = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

function toPairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isInteger(code)) throw new DxfError(`DXF mal formado perto da linha ${i + 1}.`);
    out.push([code, lines[i + 1]!.trim()]);
  }
  return out;
}

const num = (p: Pair[], code: Code, fallback = 0) => {
  const v = p.find((x) => x[0] === code);
  const n = v ? Number(v[1]) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const str = (p: Pair[], code: Code) => p.find((x) => x[0] === code)?.[1];

/** Limpa códigos de formatação de MTEXT: {\fArial|b0;Quarto}\P → "Quarto" */
export function cleanMText(s: string): string {
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\P/g, " ")
    .replace(/\\[ACcFfHhQTWp][^;\\{}]*;/g, "")
    .replace(/\\[LlOoKkNn]/g, "")
    .replace(/\\S([^;]*);/g, (_, x: string) => x.replace(/[#^/]/, "/"))
    .replace(/%%[cC]/g, "Ø")
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Aproxima um arco (graus, sentido anti-horário) por pontos. */
function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number): Point[] {
  let end = a1;
  while (end <= a0) end += 360;
  const n = Math.max(2, Math.ceil((end - a0) / 15));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = ((a0 + ((end - a0) * i) / n) * Math.PI) / 180;
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
  });
}

/** Segmento de LWPOLYLINE com bulge (arco): devolve os pontos intermédios. */
function bulgePoints(p: Point, q: Point, bulge: number): Point[] {
  if (Math.abs(bulge) < 1e-9) return [q];
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(q.x - p.x, q.y - p.y);
  if (chord === 0) return [q];
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  const d = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const ux = (q.x - p.x) / chord;
  const uy = (q.y - p.y) / chord;
  const sign = (bulge > 0 ? 1 : -1) * (Math.abs(theta) > Math.PI ? -1 : 1);
  const cx = mx - uy * d * sign;
  const cy = my + ux * d * sign;
  const a0 = Math.atan2(p.y - cy, p.x - cx);
  const n = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 12)));
  return Array.from({ length: n }, (_, i) => {
    const t = a0 + (theta * (i + 1)) / n;
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
  });
}

/**
 * Contornos de um HATCH: caminhos em polilinha (com bulge) ou em arestas (linhas e arcos).
 * Splines e elipses nas arestas são ignoradas.
 */
export function hatchBoundaries(p: Pair[]): Point[][] {
  const out: Point[][] = [];
  let i = p.findIndex(([c]) => c === 91);
  if (i < 0) return out;
  const nPaths = Number(p[i]![1]);
  i++;
  const at = (k: number) => Number(p[k]?.[1]);
  for (let path = 0; path < nPaths && i < p.length; path++) {
    while (i < p.length && p[i]![0] !== 92) i++;
    if (i >= p.length) break;
    const flag = at(i++);
    if (flag & 2) {
      const hasBulge = at(i++) !== 0; // 72
      const closed = at(i++) !== 0; // 73
      const n = at(i++); // 93
      const verts: { x: number; y: number; bulge: number }[] = [];
      for (let v = 0; v < n && i + 1 < p.length; v++) {
        const x = at(i++);
        const y = at(i++);
        let bulge = 0;
        if (hasBulge && p[i]?.[0] === 42) bulge = at(i++);
        verts.push({ x, y, bulge });
      }
      const pts: Point[] = verts.length ? [{ x: verts[0]!.x, y: verts[0]!.y }] : [];
      const segs = closed ? verts.length : verts.length - 1;
      for (let q = 0; q < segs; q++) {
        const a = verts[q]!;
        const b = verts[(q + 1) % verts.length]!;
        pts.push(...bulgePoints(a, b, a.bulge));
      }
      if (pts.length > 1) out.push(pts);
    } else {
      const nEdges = at(i++); // 93
      for (let e = 0; e < nEdges && i < p.length; e++) {
        const type = at(i++); // 72
        if (type === 1) {
          out.push([
            { x: at(i), y: at(i + 1) },
            { x: at(i + 2), y: at(i + 3) },
          ]);
          i += 4;
        } else if (type === 2) {
          const [cx, cy, r, a0, a1, ccw] = [at(i), at(i + 1), at(i + 2), at(i + 3), at(i + 4), at(i + 5)];
          i += 6;
          // arestas em sentido horário guardam os ângulos espelhados (como no ezdxf)
          out.push(ccw ? arcPoints(cx, cy, r, a0, a1) : arcPoints(cx, cy, r, 360 - a1, 360 - a0));
        } else {
          // elipse (3) ou spline (4): salta até à próxima aresta ou ao fim do caminho
          while (i < p.length && p[i]![0] !== 72 && p[i]![0] !== 97 && p[i]![0] !== 92) i++;
        }
      }
    }
    // objetos de origem associados (97 + handles 330)
    if (p[i]?.[0] === 97) {
      const k = at(i++);
      i += k;
    }
  }
  return out;
}

export function parseDxf(text: string, opts: { maxSegments?: number } = {}): DxfDrawing {
  const maxSegments = opts.maxSegments ?? 2_000_000;
  if (!/^\s*0\s*\r?\n\s*SECTION/.test(text)) {
    throw new DxfError("Não é um DXF em texto. Se for um DXF binário ou um DWG, converte para DXF ASCII (ODA File Converter).");
  }
  const pairs = toPairs(text);

  let version: string | null = null;
  let headerUnits: number | null = null;
  const blocks = new Map<string, Block>();
  const modelEntities: RawEntity[] = [];

  // ---- 1.ª passagem: secções, cabeçalho, blocos e entidades
  let i = 0;
  while (i < pairs.length) {
    const [c, v] = pairs[i]!;
    if (c === 0 && v === "SECTION") {
      const name = pairs[i + 1]?.[1];
      i += 2;
      if (name === "HEADER") {
        while (i < pairs.length && !(pairs[i]![0] === 0 && pairs[i]![1] === "ENDSEC")) {
          const [hc, hv] = pairs[i]!;
          if (hc === 9 && hv === "$ACADVER") version = pairs[i + 1]?.[1] ?? null;
          if (hc === 9 && hv === "$INSUNITS") headerUnits = Number(pairs[i + 1]?.[1]);
          i++;
        }
      } else if (name === "BLOCKS" || name === "ENTITIES") {
        let block: { name: string; base: Point; entities: RawEntity[] } | null = null;
        let cur: RawEntity | null = null;
        const flush = () => {
          if (!cur) return;
          if (name === "ENTITIES") modelEntities.push(cur);
          else if (block) block.entities.push(cur);
          cur = null;
        };
        while (i < pairs.length && !(pairs[i]![0] === 0 && pairs[i]![1] === "ENDSEC")) {
          const [ec, ev] = pairs[i]!;
          if (ec === 0) {
            flush();
            if (ev === "BLOCK") {
              const bp: Pair[] = [];
              i++;
              while (i < pairs.length && pairs[i]![0] !== 0) bp.push(pairs[i++]!);
              block = { name: str(bp, 2) ?? "", base: { x: num(bp, 10), y: num(bp, 20) }, entities: [] };
              continue;
            }
            if (ev === "ENDBLK") {
              if (block) blocks.set(block.name, { base: block.base, entities: block.entities });
              block = null;
              i++;
              while (i < pairs.length && pairs[i]![0] !== 0) i++;
              continue;
            }
            cur = { type: ev, pairs: [] };
          } else if (cur) {
            (cur as RawEntity).pairs.push(pairs[i]!);
          }
          i++;
        }
        flush();
      }
      continue;
    }
    i++;
  }

  // ---- 2.ª passagem: geometria (com blocos expandidos)
  const segments: DxfSegment[] = [];
  const texts: DxfText[] = [];
  const dimensions: DxfDimension[] = [];
  const skipped: Record<string, number> = {};

  const emit = (layer: string, a: Point, b: Point) => {
    if (segments.length >= maxSegments) return;
    if (a.x === b.x && a.y === b.y) return;
    segments.push({ layer, a, b });
  };
  const emitPath = (layer: string, m: Mat, pts: Point[], closed = false) => {
    const t = pts.map((p) => ap(m, p.x, p.y));
    for (let k = 0; k + 1 < t.length; k++) emit(layer, t[k]!, t[k + 1]!);
    if (closed && t.length > 2) emit(layer, t[t.length - 1]!, t[0]!);
  };

  const walk = (ents: RawEntity[], m: Mat, parentLayer: string | null, depth: number) => {
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k]!;
      const p = e.pairs;
      if (str(p, 67) === "1") continue; // espaço de papel
      let layer = str(p, 8) ?? "0";
      if (layer === "0" && parentLayer) layer = parentLayer; // entidades na layer 0 herdam a do bloco
      switch (e.type) {
        case "LINE":
          emitPath(layer, m, [
            { x: num(p, 10), y: num(p, 20) },
            { x: num(p, 11), y: num(p, 21) },
          ]);
          break;
        case "LWPOLYLINE": {
          const verts: { x: number; y: number; bulge: number }[] = [];
          for (const [c, v] of p) {
            if (c === 10) verts.push({ x: Number(v), y: 0, bulge: 0 });
            else if (c === 20 && verts.length) verts[verts.length - 1]!.y = Number(v);
            else if (c === 42 && verts.length) verts[verts.length - 1]!.bulge = Number(v);
          }
          const closed = (num(p, 70) & 1) === 1;
          const pts: Point[] = verts.length ? [{ x: verts[0]!.x, y: verts[0]!.y }] : [];
          const n = closed ? verts.length : verts.length - 1;
          for (let q = 0; q < n; q++) {
            const a = verts[q]!;
            const b = verts[(q + 1) % verts.length]!;
            pts.push(...bulgePoints(a, b, a.bulge));
          }
          emitPath(layer, m, pts);
          break;
        }
        case "POLYLINE": {
          // vértices vêm a seguir como entidades VERTEX até SEQEND
          const pts: Point[] = [];
          const closed = (num(p, 70) & 1) === 1;
          while (k + 1 < ents.length && ents[k + 1]!.type === "VERTEX") {
            k++;
            pts.push({ x: num(ents[k]!.pairs, 10), y: num(ents[k]!.pairs, 20) });
          }
          if (k + 1 < ents.length && ents[k + 1]!.type === "SEQEND") k++;
          emitPath(layer, m, pts, closed);
          break;
        }
        case "ARC":
          emitPath(layer, m, arcPoints(num(p, 10), num(p, 20), num(p, 40), num(p, 50), num(p, 51)));
          break;
        case "CIRCLE":
          emitPath(layer, m, arcPoints(num(p, 10), num(p, 20), num(p, 40), 0, 360));
          break;
        case "TEXT":
        case "MTEXT": {
          const raw =
            e.type === "MTEXT"
              ? p.filter(([c]) => c === 3).map(([, v]) => v).join("") + (str(p, 1) ?? "")
              : (str(p, 1) ?? "");
          const t = e.type === "MTEXT" ? cleanMText(raw) : cleanMText(raw);
          if (t) texts.push({ layer, at: ap(m, num(p, 10), num(p, 20)), height: num(p, 40, 0.2) * matScale(m), text: t });
          break;
        }
        case "DIMENSION": {
          const measured = num(p, 42, NaN);
          if (Number.isFinite(measured) && measured > 0) {
            dimensions.push({ layer, a: ap(m, num(p, 13), num(p, 23)), b: ap(m, num(p, 14), num(p, 24)), measured: measured * matScale(m) });
          }
          break; // o desenho da cota (bloco *D) não interessa
        }
        case "INSERT": {
          const b = blocks.get(str(p, 2) ?? "");
          if (!b || depth > 6) break;
          const sx = num(p, 41, 1);
          const sy = num(p, 42, 1);
          const rot = (num(p, 50) * Math.PI) / 180;
          const cols = Math.max(1, num(p, 70, 1));
          const rows = Math.max(1, num(p, 71, 1));
          const dc = num(p, 44);
          const dr = num(p, 45);
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const cos = Math.cos(rot);
              const sin = Math.sin(rot);
              const ox = num(p, 10) + (c * dc * cos - r * dr * sin);
              const oy = num(p, 20) + (c * dc * sin + r * dr * cos);
              const local: Mat = [cos * sx, sin * sx, -sin * sy, cos * sy, ox, oy];
              const toBase: Mat = [1, 0, 0, 1, -b.base.x, -b.base.y];
              walk(b.entities, mul(m, mul(local, toBase)), layer, depth + 1);
            }
          }
          break;
        }
        case "HATCH": {
          for (const path of hatchBoundaries(p)) emitPath(layer + HATCH_SUFFIX, m, path);
          break;
        }
        case "VERTEX":
        case "SEQEND":
        case "ATTDEF":
        case "ATTRIB":
          break;
        default:
          skipped[e.type] = (skipped[e.type] ?? 0) + 1;
      }
    }
  };
  walk(modelEntities, IDENT, null, 0);

  if (segments.length === 0) throw new DxfError("O DXF não tem linhas no espaço de modelo.");

  const layerMap = new Map<string, DxfLayerInfo>();
  const L = (n: string) => layerMap.get(n) ?? layerMap.set(n, { name: n, segments: 0, texts: 0 }).get(n)!;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of segments) {
    L(s.layer).segments++;
    for (const q of [s.a, s.b]) {
      if (q.x < minX) minX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.x > maxX) maxX = q.x;
      if (q.y > maxY) maxY = q.y;
    }
  }
  for (const t of texts) L(t.layer).texts++;

  return {
    version,
    headerUnits,
    segments,
    texts,
    dimensions,
    layers: [...layerMap.values()].sort((a, b) => b.segments - a.segments),
    extents: { minX, minY, maxX, maxY },
    skipped,
  };
}

// ----------------------------------------------------------------- unidades

export type DxfUnit = "m" | "cm" | "mm";
export const METERS_PER_DXF_UNIT: Record<DxfUnit, number> = { m: 1, cm: 0.01, mm: 0.001 };
export const HEADER_UNITS: Record<number, DxfUnit> = { 4: "mm", 5: "cm", 6: "m" };

export interface UnitGuess {
  unit: DxfUnit;
  /** de onde veio a dedução */
  basis: "cotas" | "cabecalho" | "tamanho";
  /** o cabeçalho diz outra coisa */
  headerDisagrees: boolean;
  medianDimension: number | null;
}

/**
 * Deduz as unidades a partir das cotas: numa planta de habitação as cotas típicas vão de
 * 0,1 a 20 m. A mediana diz em que unidade foram desenhadas. O cabeçalho só serve de
 * desempate, porque pode estar errado.
 */
export function guessUnits(d: Pick<DxfDrawing, "dimensions" | "headerUnits" | "extents">, region?: Region): UnitGuess {
  const header = d.headerUnits !== null ? (HEADER_UNITS[d.headerUnits] ?? null) : null;
  const dims = d.dimensions
    .filter((x) => !region || inRegion(x.a, region))
    .map((x) => x.measured)
    .sort((a, b) => a - b);
  const pick = (v: number): DxfUnit => (v < 40 ? "m" : v < 4000 ? "cm" : "mm");
  if (dims.length >= 3) {
    const median = dims[Math.floor(dims.length / 2)]!;
    const unit = pick(median);
    return { unit, basis: "cotas", headerDisagrees: header !== null && header !== unit, medianDimension: median };
  }
  if (header) return { unit: header, basis: "cabecalho", headerDisagrees: false, medianDimension: null };
  const e = region ?? d.extents;
  const size = e ? Math.max(e.maxX - e.minX, e.maxY - e.minY) : 30;
  // uma planta de uma casa cabe em ~10–80 m
  const unit: DxfUnit = size < 400 ? "m" : size < 40000 ? "cm" : "mm";
  return { unit, basis: "tamanho", headerDisagrees: false, medianDimension: null };
}

// ----------------------------------------------------------------- região → página

export interface Region {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const inRegion = (p: Point, r: Region) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

export const normalizeRegion = (a: Point, b: Point): Region => ({
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
});

/** Unidades de página por metro: a geometria do DXF é posta "como se fosse" um PDF a 1:100. */
export const PAGE_UNITS_PER_METER = 72 / 0.0254 / 100;

export interface DxfToPage {
  /** unidades de página por unidade do DXF */
  k: number;
  region: Region;
  width: number;
  height: number;
  toPage: (p: Point) => Point;
}

/** O DXF tem y para cima; a página tem y para baixo e começa no canto superior esquerdo da região. */
export function dxfToPage(region: Region, unit: DxfUnit): DxfToPage {
  const k = METERS_PER_DXF_UNIT[unit] * PAGE_UNITS_PER_METER;
  return {
    k,
    region,
    width: (region.maxX - region.minX) * k,
    height: (region.maxY - region.minY) * k,
    toPage: (p) => ({ x: (p.x - region.minX) * k, y: (region.maxY - p.y) * k }),
  };
}

/** Segmento que toca a região (pelo menos um extremo dentro, ou a atravessa pelo meio). */
export function segmentTouchesRegion(s: Segment, r: Region): boolean {
  if (inRegion(s.a, r) || inRegion(s.b, r)) return true;
  if (Math.max(s.a.x, s.b.x) < r.minX || Math.min(s.a.x, s.b.x) > r.maxX) return false;
  if (Math.max(s.a.y, s.b.y) < r.minY || Math.min(s.a.y, s.b.y) > r.maxY) return false;
  return true;
}

// ----------------------------------------------------------------- layers por defeito

const SNAP_LAYER = /corte|parede|wall|alvenaria|a-wall/i;
const HIDDEN_LAYER = /trama|hatch|vegeta|arvore|árvore|grelha|norte|top_|cv_|cadastro|viewport|defpoints|folha|rotulo|rótulo/i;

/** Snap por defeito: layers de paredes e contornos de tramas (que no ficheiro real incluem as divisórias). */
export const defaultSnapLayer = (name: string) => SNAP_LAYER.test(name) || isHatchLayer(name);
export const defaultVisibleLayer = (name: string) => isHatchLayer(name) || !HIDDEN_LAYER.test(name);

export interface DxfSourceMeta {
  region: Region;
  unit: DxfUnit;
  hidden: string[];
  snap: string[];
  /** versão das regras de layers com que o piso foi configurado */
  layerVersion?: number;
}

/** 2 = contornos das tramas como layers "[trama]" (out. 2026). */
export const DXF_LAYER_VERSION = 2;

/**
 * Atualiza a configuração de layers de um piso configurado com uma versão anterior:
 * as layers "[trama]" (que não existiam) passam a ser visíveis e com snap.
 */
export function upgradeLayerMeta(meta: DxfSourceMeta, regionLayers: string[]): { meta: DxfSourceMeta; changed: boolean } {
  if ((meta.layerVersion ?? 1) >= DXF_LAYER_VERSION) return { meta, changed: false };
  const tramas = regionLayers.filter(isHatchLayer);
  const snap = [...new Set([...meta.snap, ...tramas])];
  const hidden = meta.hidden.filter((n) => !isHatchLayer(n));
  return { meta: { ...meta, snap, hidden, layerVersion: DXF_LAYER_VERSION }, changed: true };
}

// ----------------------------------------------------------------- deteção das plantas

export interface PlanCandidate {
  region: Region;
  /** nomes das divisões encontrados (sem repetidos, pela ordem do desenho) */
  rooms: string[];
  wallSegments: number;
}

/**
 * Encontra as plantas de piso dentro do DXF: agrupa os nomes de divisões ("Quarto 1",
 * "IS.2", "Cozinha"…) que estão próximos e devolve a região de cada grupo. Assim não é
 * preciso procurar a planta no meio da implantação, alçados e cortes.
 */
export function findPlanCandidates(
  d: Pick<DxfDrawing, "texts" | "segments" | "dimensions" | "headerUnits" | "extents">,
  isRoomName: (text: string) => boolean,
  opts: { linkMeters?: number; marginMeters?: number; minRooms?: number } = {},
): PlanCandidate[] {
  const unit = guessUnits(d).unit;
  const perM = 1 / METERS_PER_DXF_UNIT[unit];
  const link = (opts.linkMeters ?? 9) * perM;
  const margin = (opts.marginMeters ?? 5) * perM;
  const minRooms = opts.minRooms ?? 3;
  const pts = d.texts.filter((t) => isRoomName(t.text));
  if (pts.length === 0) return [];

  // agrupamento por proximidade (union-find em grelha)
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const cell = (v: number) => Math.floor(v / link);
  const grid = new Map<string, number[]>();
  pts.forEach((t, i) => {
    const k = `${cell(t.at.x)},${cell(t.at.y)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  pts.forEach((t, i) => {
    const cx = cell(t.at.x);
    const cy = cell(t.at.y);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (j <= i) continue;
          const o = pts[j]!;
          if (Math.hypot(o.at.x - t.at.x, o.at.y - t.at.y) <= link) parent[find(i)] = find(j);
        }
  });
  const groups = new Map<number, number[]>();
  pts.forEach((_, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(i));

  const out: PlanCandidate[] = [];
  for (const idx of groups.values()) {
    const names = [...new Set(idx.map((i) => pts[i]!.text))];
    if (names.length < minRooms) continue;
    const xs = idx.map((i) => pts[i]!.at.x);
    const ys = idx.map((i) => pts[i]!.at.y);
    const region = { minX: Math.min(...xs) - margin, minY: Math.min(...ys) - margin, maxX: Math.max(...xs) + margin, maxY: Math.max(...ys) + margin };
    const wallSegments = d.segments.filter((s) => (defaultSnapLayer(s.layer) || SNAP_LAYER.test(s.layer)) && segmentTouchesRegion(s, region)).length;
    out.push({ region, rooms: names, wallSegments });
  }
  // mais divisões primeiro; empate → da esquerda para a direita, de cima para baixo
  return out.sort((a, b) => b.rooms.length - a.rooms.length || a.region.minX - b.region.minX || b.region.maxY - a.region.maxY);
}

/**
 * Layers que distinguem cada planta das outras (ex.: só uma tem "arq_demolir" → é a planta
 * de alterações). Devolve, por candidata, até `max` layers presentes nela e ausentes noutra.
 */
export function distinctiveLayers(d: Pick<DxfDrawing, "segments" | "texts">, regions: Region[], max = 3): string[][] {
  const counts = regions.map((r) => {
    const m = new Map<string, number>();
    for (const s of d.segments) if (segmentTouchesRegion(s, r)) m.set(s.layer, (m.get(s.layer) ?? 0) + 1);
    for (const t of d.texts) if (inRegion(t.at, r)) m.set(t.layer, (m.get(t.layer) ?? 0) + 1);
    return m;
  });
  return counts.map((m, i) =>
    [...m]
      .filter(([layer, n]) => n >= 8 && counts.some((o, j) => j !== i && (o.get(layer) ?? 0) < Math.max(2, n * 0.1)))
      .sort((a, b) => b[1] - a[1])
      .map(([layer]) => layer.replace(HATCH_SUFFIX, ""))
      .filter((l, k, all) => all.indexOf(l) === k)
      .slice(0, max),
  );
}
