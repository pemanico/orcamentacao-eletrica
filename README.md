# Orçamentação Elétrica — F1 (planta)

Aplicação local, de uso pessoal, para orçamentar instalações elétricas residenciais
monofásicas a partir do PDF do arquiteto. Esta versão implementa a **fase F1** do plano
de design: importar a planta, calibrar a escala, traçar paredes/portas/janelas e definir
as divisões.

> Os resultados desta aplicação são ferramentas de orçamentação. Não são projeto
> elétrico nem documento de certificação.

## Requisitos

- **Node.js 22.13 ou superior** (usa o SQLite nativo do Node, `node:sqlite`).
  Confirma com `node -v`.

## Instalar e arrancar

```bash
npm install
npm start
```

Abre <http://127.0.0.1:5174>. O servidor só escuta em `127.0.0.1`: não fica acessível a
partir de outros computadores da rede.

Para desenvolver (recompila o frontend e reinicia o servidor a cada alteração):

```bash
npm run dev
```

## Os teus dados

Tudo fica na pasta `data/`:

- `data/orcamentacao.db` — base de dados SQLite (projetos, pisos, geometria)
- `data/pdfs/` — os PDFs importados

**Faz cópia de segurança desta pasta.** Tem dados de clientes. Para usar outra pasta:
`ORC_DATA_DIR=/caminho npm start`.

## Fluxo da F1

1. **Novo projeto** → nome, cliente, morada.
2. **Importar planta** → PDF exportado do CAD, nome do piso, pé-direito, página.
   Digitalizações (PDF imagem) são rejeitadas antes do envio.
3. **Calibrar** → clica nos dois extremos de uma cota longa e indica o valor real.
   Se o carimbo indicar uma escala (ex.: 1:100), a app compara e avisa quando o PDF foi
   impresso com "ajustar à página". Vale sempre a calibração.
4. **Paredes** → clica ponto a ponto. O cursor é atraído às linhas do PDF
   (quadrado = extremo, triângulo = ponto médio, círculo = sobre a linha).
5. **Portas e janelas** → clica sobre uma parede já traçada.
6. **Divisões** → clica nos cantos; fecha no primeiro ponto ou com Enter. Escolhe um ou
   mais tipos (vários tipos = open space, ex.: sala + cozinha).
7. **Aprovar piso** → só possível sem erros de validação. Qualquer alteração posterior
   retira a aprovação.

Grava automaticamente. Se abrires o mesmo piso em dois separadores, o segundo a gravar
recebe um aviso de conflito em vez de apagar o trabalho do primeiro.

### Atalhos

| Tecla | Ação |
| --- | --- |
| V / C / W / P / J / D | Selecionar / Calibrar / Parede / Porta / Janela / Divisão |
| O | Liga/desliga orto (Shift inverte temporariamente). Com orto ligado, um canto ou uma linha diagonal da planta continuam a ganhar ao orto, por isso as paredes diagonais traçam-se de canto a canto |
| Alt (manter) | Desliga o snap |
| Espaço + arrastar, botão do meio | Mover a vista |
| Roda do rato | Zoom no cursor |
| 0 | Ajustar ao ecrã |
| Esc / clique direito | Cancela o traçado em curso |
| Delete | Apaga o elemento selecionado |
| F / H | Porta selecionada: inverte abertura / dobradiça |
| Ctrl+Z, Ctrl+Y | Anular / refazer |

Com **Selecionar**, um elemento selecionado mostra pegas que podes arrastar para o
corrigir (extremos de paredes, cantos de divisões).

## Testes

```bash
npm test               # unitários: geometria, escala, snap, extração do PDF, API
npm run typecheck      # core + servidor
npm run typecheck:web  # frontend (precisa de @types/react, instalado pelo npm install)

npx playwright install chromium   # uma vez
npm run test:e2e       # browser real: fluxo completo da F1 com a planta de exemplo
```

A planta de exemplo (`packages/core/test/fixtures/planta_t2_1-100.pdf`) é um T2
desenhado a 1:100 em A3. Testa também com PDFs reais de arquitetos diferentes antes de
avançar para a F2.

## Estrutura

```
packages/core   lógica pura e testável: geometria, escala, snap, extração de vetores
                do PDF, validação do piso, schema (zod). Sem UI, sem base de dados.
apps/server     servidor HTTP (node:http) + SQLite (node:sqlite)
apps/web        React + pdf.js; editor em SVG
e2e             teste ponta-a-ponta com Playwright
scripts         build (esbuild) e modo de desenvolvimento
```

As coordenadas são guardadas em **unidades de página do PDF** (pontos, y para baixo),
não em metros. Os metros derivam da escala calibrada. Assim, recalibrar nunca desloca a
geometria em relação à planta.

## Diferenças em relação à stack do plano

O plano previa Fastify, Drizzle/better-sqlite3, Vite, Konva e Vitest. A F1 usa menos
dependências, com o mesmo resultado:

| Plano | F1 | Porquê |
| --- | --- | --- |
| Fastify | `node:http` + router mínimo | 8 rotas não justificam uma framework |
| better-sqlite3 + Drizzle | `node:sqlite` | Sem compilação nativa no `npm install` (relevante em Windows) |
| Vite | esbuild | Um script de build de 50 linhas |
| Konva | SVG | Zoom, hit-testing e espessuras constantes resolvem-se bem em SVG |
| Vitest | `node:test` | Já vem com o Node |

As dependências de execução são só: `react`, `react-dom`, `pdfjs-dist` e `zod`.

## Limitações conhecidas da F1

- Não é possível inserir ou apagar cantos de uma divisão já criada (apaga e redesenha).
- As paredes são traçadas ao longo de uma face; a espessura é informativa.
- Não se valida a sobreposição entre divisões.
- Um piso corresponde a uma página do PDF.
- O estado do piso é guardado como JSON validado. Será normalizado em tabelas na F2,
  quando os pontos tiverem de referenciar divisões.
