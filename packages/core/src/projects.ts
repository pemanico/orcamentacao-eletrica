/**
 * Workflow de estados de um projeto. Arquivar NÃO é um estado: é uma marca à parte
 * (arquiva-se uma obra concluída ou um orçamento perdido sem perder o estado).
 */
export const PROJECT_STATUSES = ["levantamento", "orcamento", "enviado", "adjudicado", "em_obra", "concluido", "perdido"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  levantamento: "Levantamento",
  orcamento: "Orçamento",
  enviado: "Enviado",
  adjudicado: "Adjudicado",
  em_obra: "Em obra",
  concluido: "Concluído",
  perdido: "Perdido",
};

export const PROJECT_STATUS_HELP: Record<ProjectStatus, string> = {
  levantamento: "A preparar a planta e a recolher o que o cliente quer.",
  orcamento: "A montar os orçamentos.",
  enviado: "Proposta entregue ao cliente, à espera de resposta.",
  adjudicado: "O cliente aceitou. Ainda não começou.",
  em_obra: "Obra a decorrer. Regista as horas reais.",
  concluido: "Obra terminada.",
  perdido: "O cliente não aceitou ou escolheu outro.",
};

/** Transições permitidas (incluindo recuar um passo, para corrigir enganos ou rever o orçamento). */
export const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  levantamento: ["orcamento"],
  orcamento: ["enviado", "levantamento"],
  enviado: ["adjudicado", "perdido", "orcamento"],
  adjudicado: ["em_obra", "enviado"],
  em_obra: ["concluido", "adjudicado"],
  concluido: ["em_obra"],
  perdido: ["orcamento"],
};

/** Transições "para a frente" (as que a página mostra como ação principal). */
export const isForward = (from: ProjectStatus, to: ProjectStatus) =>
  to === "perdido" || PROJECT_STATUSES.indexOf(to) > PROJECT_STATUSES.indexOf(from);

export const canTransition = (from: ProjectStatus, to: ProjectStatus) => PROJECT_TRANSITIONS[from].includes(to);

/**
 * Projetos que chegaram a obra têm histórico real (horas, margens) que serve para
 * calibrar as regras: esses arquivam-se, não se apagam.
 */
export const DELETE_BLOCKED: readonly ProjectStatus[] = ["adjudicado", "em_obra", "concluido"];
export const canDeleteProject = (status: ProjectStatus) => !DELETE_BLOCKED.includes(status);
