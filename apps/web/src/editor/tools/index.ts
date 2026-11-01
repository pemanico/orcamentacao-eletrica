/**
 * Ferramentas do editor da planta, pela ordem da barra. Cada ferramenta é um ficheiro nesta
 * pasta com um ToolHandler (ver types.ts); acrescentar uma é acrescentá-la a esta lista.
 */
import { porta, janela } from "./abertura";
import { calibrar } from "./calibrar";
import { divisao } from "./divisao";
import { parede } from "./parede";
import { selecionar } from "./selecionar";

export const TOOLS = [selecionar, calibrar, parede, porta, janela, divisao] as const;

export type Tool = (typeof TOOLS)[number]["id"];

export const toolById = (id: Tool) => TOOLS.find((t) => t.id === id)!;

export type { HandleDrag, Selection, ToolContext, ToolHandler } from "./types";
