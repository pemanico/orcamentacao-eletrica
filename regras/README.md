# Regras — valores iniciais

Estes CSV só servem para **carregar a base de dados na primeira vez** que a app arranca.
Depois disso as regras editam-se na app (menu **Regras**) e ficam na tua base de dados
local (`data/`), que nunca vai para o GitHub. Os valores comerciais (horas, preço da hora,
margens) nunca devem ser escritos aqui.

Para levar ao formador: na app, **Regras → Exportar CSV** (abre no Excel, separador `;`).

## `referencia_rtiebt.csv` — valores do regulamento

Não é carga inicial: é a **fonte** do botão **Preencher com referência** (Regras → Tipos de
circuito, Equipamentos, Parâmetros). Só tem valores do RTIEBT (Portaria 949-A/2006, versão
consolidada com a secção 722 dos veículos elétricos), cada um com o artigo ou quadro e a
página do Diário da República (6682-(N)). Nada comercial.

Colunas: `grupo;chave;valor;unidade;fonte;notas` (UTF-8 com BOM, para o Excel).

Inclui também as tabelas de correntes admissíveis (52-C1, métodos A e B), fatores k1 (52-D1)
e k2 (52-E1, 52-E3), quedas de tensão (52O) e métodos de instalação (52H). Estas ainda não
entram em nenhuma tabela da app: ficam para o motor de cálculo das secções (F2/F3).

O que o regulamento **não** fixa não está aqui e não é inventado: disjuntor por circuito
(o RTIEBT só exige In ≤ Iz), potência dos aparelhos, fatores de simultaneidade dentro da
habitação (311.2 e 801.1.1.1: "de acordo com as necessidades"), cos φ.
