/** Ferramentas do editor da planta (atalho de teclado e ajuda mostrada no topo). */
export type Tool = "selecionar" | "calibrar" | "parede" | "porta" | "janela" | "divisao";

export const TOOLS: { id: Tool; label: string; key: string; help: string }[] = [
  { id: "selecionar", label: "Selecionar", key: "V", help: "Clica para selecionar. Arrasta o fundo para mover a vista. Arrasta os pontos de um elemento selecionado para o corrigir. Delete apaga." },
  { id: "calibrar", label: "Calibrar", key: "C", help: "Clica nos dois extremos de uma cota conhecida (a mais longa possível) e indica o valor real." },
  { id: "parede", label: "Parede", key: "W", help: "Clica ponto a ponto ao longo das paredes. Esc ou duplo clique termina. Orto ligado: segmentos horizontais/verticais (Shift inverte)." },
  { id: "porta", label: "Porta", key: "P", help: "Clica sobre uma parede traçada. Depois, com a porta selecionada: F inverte o lado de abertura, H a dobradiça." },
  { id: "janela", label: "Janela", key: "J", help: "Clica sobre uma parede traçada." },
  { id: "divisao", label: "Divisão", key: "D", help: "Clica nos cantos da divisão. Fecha clicando no primeiro ponto ou com Enter. Em open space, desenha uma área e escolhe vários tipos." },
];

/** Elemento selecionado no editor. */
export type Selection = { kind: "wall" | "opening" | "room"; id: string } | null;
