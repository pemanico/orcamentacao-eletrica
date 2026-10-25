# Estado do projeto — passagem entre chats

Última atualização: 2026-10-25 · commit `eadb787` · repo https://github.com/pemanico/orcamentacao-eletrica

Lê isto primeiro num chat novo. O plano de design aprovado está em
https://claude.ai/code/artifact/2ec78d2f-2f64-4915-9ce5-c4920dc2438e (fases F0–F5).

## Como trabalhar com o Ordep

- Português de Portugal. Direto, sem validações vazias: questiona, aponta falhas e pontos cegos.
- Ele valida tudo: o motor/agente propõe, ele aprova. **O LLM nunca calcula**; só regras
  aprovadas entram em cálculos; qualquer alteração retira a aprovação.
- Uso pessoal, corre no PC dele (Windows, Node ≥ 22.13). Ele é engenheiro informático.
- Não escrever código novo de uma fase sem ele pedir/aprovar.
- Privacidade: o DXF/PDF da casa dele **nunca** vão para o repo (público). Valores
  comerciais (horas, preço da hora, margens) ficam só na base de dados local (`data/`).

## Decisões de produto (resumo)

Instalação residencial **monofásica**, normas portuguesas (RTIEBT). Input: PDF vetorial do
arquiteto (sempre com escala/cotas) ou DXF (casas novas; DWG converte-se com ODA File
Converter). Renovações: só PDF ou levantamento à mão ("sem planta" fica para depois).
Domótica fica para depois. Potência contratada é decisão dele (app calcula e avisa);
diferenciais automáticos. Cablagem v1 = estimativa média de metros para custo. Materiais
manuais (scraping depois). Mão de obra por horas (valores ainda desconhecidos). Markup 25 %
sobre o custo. 3 orçamentos = 3 gamas de material. Orçamento detalhado, web + PDF.
Quadro: unifilar + disposição física.

Circuitos que ele deu: C1 tomadas sala; C2–C4 tomadas quartos; C5 tomadas WC; C6 forno;
placa; exaustor/frigorífico/isoladas cozinha; C8 lavandaria; C9 ilum. quartos; C10 ilum. WC;
C11 ilum. cozinha+sala+garagem; bomba de calor; AC (a numeração dele tinha repetidos — por
confirmar).

## Feito

- **F1 planta (PDF)**: importar, calibrar (compara com o carimbo), paredes com snap (canto e
  linhas diagonais ganham ao orto), portas/janelas, divisões (open space = vários tipos),
  validação, aprovar. Testado com PDF real: 20 min, áreas certas.
- **DXF**: parser próprio (LINE, LWPOLYLINE c/ bulge, POLYLINE, ARC, CIRCLE, TEXT/MTEXT,
  DIMENSION, INSERT, HATCH → layers `"<layer> [trama]"`). Unidades deduzidas das cotas
  (o cabeçalho do DXF real dizia cm, desenho em m). Deteção das plantas de piso pelos nomes
  das divisões (cartões com miniatura; implantação dá aviso). Painel de layers Ver/Snap.
  Escala exata. Nome e tipo da divisão preenchidos a partir do texto do arquiteto.
  Testado com o DXF da casa dele: "impecável, ficou perfeito".
- **Vários pisos**: adicionar piso a partir de ficheiro já importado; apagar piso.
- **Regras (F0)** em menu próprio, editáveis na app: tipos de divisão, defaults por divisão,
  tipos de circuito, equipamentos, mão de obra, parâmetros. Estados A definir → Proposta →
  Aprovada; técnicas exigem fonte; exportar CSV para o formador.
- **Tipos de divisão**: base + sala das máquinas/área técnica + closet; "+ Novo tipo" no
  diálogo; código imutável enquanto usado; aviso de tipos sem defaults.
- **Projetos**: workflow Levantamento → Orçamento → Enviado → Adjudicado → Em obra →
  Concluído (+ Perdido), arquivar, apagar com confirmação (bloqueado a partir de Adjudicado),
  histórico.
- **Referência RTIEBT** (`regras/referencia_rtiebt.csv`): valores tirados da Portaria
  949-A/2006 consolidada (PDF do Ordep, não está no repo), com artigo e página DR. Coluna
  **Carga** em Tipos de circuito e Equipamentos (deduzida; linhas antigas migradas no
  arranque). Botão **Preencher com referência**: pré-visualiza, só células vazias, nunca
  linhas aprovadas, fica em Proposta, acrescenta a fonte. Aviso de linhas da mesma carga
  desalinhadas. Decisão dele: **não** separar especificação por carga do agrupamento C-n.
- **Calculadora de secções** (`packages/core/src/sizing.ts`, página `#/regras/calculadora`):
  IB → In (433.2) → k1·k2 → secção (52-C1, mínimo 801.5.8) → ΔU (52O, ρ do CINEL). Calibres e
  ρ na tabela Parâmetros (só aprovados contam quando há algum; senão resultado "provisório").
  Exercício do CINEL (termo 4,6 kW, 35 °C, 3 circ., 25 m) refeito com o 52-C1 dá **C20 + 4 mm²**
  (o material do curso dava 6 mm² por usar a coluna de 3 condutores carregados). Sem
  verificação de curto-circuito (Icn ≥ Icc máx, Icc mín ≥ Im): falta a impedância da rede.
  Ainda não ligada aos circuitos do projeto (F2/F3).
- Achados no RTIEBT que contrariam resumos de IA: fogão mínimo **4 mm²** (801.5.8);
  30 mA obrigatório só em WC, tomadas exteriores ≤ 20 A, piscina, VE e terra > 500 Ω
  (no resto, diferencial ≤ 500 mA — 801.5.4.1/801.5.9; 30 mA em tudo é prática);
  **sem Ks** dentro da habitação no regulamento; 8 pontos por circuito "em regra"
  (801.5.3); "compartimento" não está definido (potência mínima 801.5.2.2).
- **Dados**: SQLite em `data/orcamentacao.db`, autosave, cópias de segurança, página Dados.

## Pendente (por ordem)

1. **Ele**: aprovar a tabela "Defaults por divisão" (linhas "A definir": cozinha luz,
   máquina loiça, lavandaria, corredor quantidade, exteriores, sala tomadas/interruptores;
   corredor > 2 portas: inversor ou telerruptor?). Bloqueia a F2.
2. **Ele (formador)**: horas de mão de obra, preço da hora; e o que o RTIEBT não fixa:
   disjuntor por tipo de circuito, Ks por tipo de utilização (e sobre que potência se
   aplica), potência dos equipamentos, cos φ, o que conta como "compartimento", método de
   instalação/k2 por omissão (tubos separados 52-E3 vs mesmo elemento 52-E1; paredes com
   isolamento → método A), 30 mA em todos os circuitos (prática) ou só onde é obrigatório.
   Bomba de calor de AQS: climatização ou termoacumulador? (secção mínima igual, 2,5 mm²).
   Secção 702 (piscina) ainda por ler. Mostrar ao formador o erro do exercício do
   termoacumulador (6 vs 4 mm²) e a regra "compartimento > 4 m², sem cozinha e WC" (não está
   no RTIEBT — de onde vem?). Curva do disjuntor (B/C/D) e Icc: que valores usa para a rede?
3. **Ele**: cronometrar o piso 0 traçado a partir do DXF. Se > 10 min → gerar paredes
   automaticamente a partir de `arq_corte` + contornos das tramas (proposto, adiado).
4. Sugerido: tipo próprio "Casa das máquinas da piscina" com defaults próprios (bomba de
   filtração, quadro parcial, equipotencial, 30 mA).
5. **F2**: colocação de pontos a partir das regras aprovadas (+ etiquetas QE/MLL/MLR/MO/PF do
   DXF). Na F3 perguntar por onde passam os tubos (laje, teto falso, desvão) — muda os metros.
6. **Regras da F4 (quadro/unifilar)** — anotadas, por aprovar, sem código:
   - calibre de cada interruptor diferencial ≥ disjuntor a montante, ou ≥ Σ IB·Ks dos
     circuitos que alimenta (o ID não se protege contra sobrecargas; ID 40 A com DCP 45 A falha);
   - VE: diferencial individual por ponto de ligação, mín. tipo A, corta todos os ativos
     incluindo neutro (RTIEBT 722.531.2.101); proteção contra sobreintensidades individual
     (722.533.101);
   - casas de banho (701), tomadas exteriores ≤ 20 A (471.2.3) e piscina (702) atrás de 30 mA;
   - todos os circuitos com diferencial, ≤ 500 mA (801.5.4.1, 801.5.9); 30 mA e tipo A em
     tudo é prática (decisão dele);
   - reserva no quadro (20–25 %) é prática, não RTIEBT.
7. Fonte "sem planta" para renovações. F3–F5 conforme o plano.

## A casa dele (caso de teste)

Vivenda térrea (só piso 0; o DXF fala de "piso -1 retirado"). Usar a **Planta 3**
(alterações) do DXF. Tem piscina com casa das máquinas, área técnica, closet, garagem,
3 quartos, escritório, 4–5 IS, alpendres. O DXF real (`2022-015-CASA-AP-LIC-R3.dxf`) não
está no repo; pede-o a ele se precisares.

## Arquitetura técnica

Monorepo npm workspaces, TypeScript, `"type": "module"`.

```
packages/core   lógica pura (geometria, escala, snap, pdfSegments, dxf, roomNames,
                roomTypes, rules, projects, validate, schema zod). Testes node:test + tsx.
apps/server     node:http + Router mínimo, node:sqlite (DatabaseSync). 127.0.0.1:5174.
                db.ts (projects, floors, project_events; migrações via PRAGMA table_info),
                rules.ts (tabela rules, seed de regras/*.csv só em tabela vazia), app.ts.
apps/web        React 19 + pdf.js 6 (build legacy) + editor SVG; esbuild (scripts/build-web.mjs).
                Router por hash: #/ #/arquivados #/projeto/:id #/piso/:id #/regras/:t #/dados
e2e             Playwright (Chromium) — editor.test.ts, dxf.test.ts
regras/         CSV iniciais (sem valores comerciais)
```

- Coordenadas em **unidades de página PDF** (pontos, y para baixo); metros via
  `scale.metersPerUnit`. DXF mapeado "como PDF a 1:100" (`PAGE_UNITS_PER_METER`).
- Concorrência otimista: `rev` + 409. Autosave ~700 ms.
- Comandos: `npm start`, `npm run dev`, `npm test`, `npm run typecheck`,
  `npm run test:e2e`. Estado dos testes: core 54, servidor 36, e2e 27 — tudo verde.
- No ambiente cloud do Claude o registo npm está bloqueado: node_modules são symlinks para
  `/opt/npm-tools/node_modules` (mais `node_modules/@orc/core` e `@orc/server` → pastas do repo); `typecheck:web` não corre lá (faltam @types). No PC dele
  é `npm install` normal.
