# Regras (fase F0)

Tabelas que o motor de regras vai usar na F2. **Só linhas com `estado = aprovada` entram
em cálculos.** Edita em Excel (separador `;`).

| Ficheiro | Conteúdo | No repositório? |
| --- | --- | --- |
| `defaults-divisoes.csv` | Pontos por defeito por tipo de divisão | Sim |
| `tipos-circuito.csv` | Secção, disjuntor, diferencial por tipo de circuito | Sim |
| `equipamentos.csv` | Potência e simultaneidade dos equipamentos dedicados | Sim |
| `mao-de-obra.exemplo.csv` | Modelo: copia para `mao-de-obra.local.csv` e preenche | Só o modelo |
| `*.local.csv` | Os teus valores de MO, margens e preços | **Não** (gitignore) |

Estados: `proposta` (dito pelo Ordep, por confirmar) · `A DEFINIR` / `A VALIDAR` /
`EM FALTA` / `A PREENCHER` · `aprovada`.

Os valores técnicos (secções, calibres, diferenciais, coeficientes) vêm das RTIEBT ou do
formador, com a fonte na coluna própria. Nunca de um LLM.
