# Orçamentação Elétrica — F1 (planta: PDF e DXF) + F0 (regras)

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

Tudo é gravado automaticamente (o editor mostra "guardado" no canto inferior direito).
A página inicial mostra onde está a base de dados, a última gravação e as cópias feitas.

**Cópias de segurança:** botão "Fazer cópia de segurança agora" na página inicial. Cria
`data/copias/copia-AAAAMMDD-HHMMSS/` com a base de dados e os PDFs. Como fica no mesmo
disco, copia essa pasta para o OneDrive ou uma pen de vez em quando, ou põe as cópias
diretamente no OneDrive (PowerShell):

```powershell
$env:ORC_BACKUP_DIR = "$env:OneDrive\orcamentacao-copias"; npm start
```

Para usar outra pasta de dados: `$env:ORC_DATA_DIR = "C:\caminho"; npm start`.

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

## Importar DXF (casas novas)

Além do PDF, um piso pode vir de um **DXF**: pede-o ao arquiteto. Um **DWG** não se lê
diretamente (formato fechado): converte-o com o **ODA File Converter** (gratuito,
Output = `DXF`, versão `ACAD2018`) ou, no AutoCAD/BricsCAD, *Guardar como → DXF*.

1. **Importar** o `.dxf` na página do projeto.
2. **Escolher a planta**: o DXF é o projeto inteiro (implantação, versões, alçados, cortes).
   Arrasta um retângulo à volta da planta do piso.
3. **Confirmar as unidades**: são deduzidas das cotas do desenho, não do cabeçalho (que pode
   estar errado: no primeiro DXF real dizia centímetros e o desenho estava em metros).
   A medida da planta escolhida aparece ao lado, para conferires.
4. **Editor**: escala exata (não há calibração). Painel **Layers do DXF**: *Ver* mostra no
   fundo, *Snap* define onde o cursor agarra (por defeito as layers de paredes, ex.
   `arq_corte`, e os contornos das tramas). "Só paredes e nomes" limpa o fundo.
   As layers terminadas em **[trama]** são o contorno das tramas (HATCH): há arquitetos
   que desenham as divisórias finas só como trama, sem linhas de parede.
5. **Divisões**: ao fechares uma divisão à volta de um nome do arquiteto (ex. "Quarto 2",
   "IS.1", "Sala de estar/jantar"), o nome e o tipo ficam preenchidos. Também funciona com
   PDFs que tenham o texto da planta.

A região e as unidades só se mudam com o piso vazio (definem a escala). As layers mudam-se
a qualquer momento sem retirar a aprovação.

## Projetos: estados, arquivar e apagar

Cada projeto segue o workflow **Levantamento → Orçamento → Enviado → Adjudicado → Em obra →
Concluído**, com **Perdido** a partir de Enviado. Cada mudança fica no histórico do projeto.
É possível recuar um passo para corrigir um engano.

- **Arquivar** tira o projeto da lista sem perder nada e não muda o estado. É reversível.
- **Apagar** é definitivo (projeto, pisos e PDFs) e exige escrever o nome do projeto. Está
  bloqueado para projetos Adjudicados, Em obra ou Concluídos: têm o histórico real que serve
  para calibrar as regras, por isso arquivam-se.

## Regras (F0)

Menu **Regras**: cinco tabelas (defaults por divisão, tipos de circuito, equipamentos, mão
de obra, parâmetros). Edita diretamente nas células e grava ao sair da célula.

- Estados: **A definir** → **Proposta** → **Aprovada**. Só as aprovadas entram nos cálculos.
- Uma linha só pode ser aprovada com os campos obrigatórios (*) preenchidos; nas tabelas
  técnicas, também com a **fonte** (artigo RTIEBT, formador…).
- Alterar uma regra aprovada retira-lhe a aprovação.
- O número no menu **Regras** é o total por aprovar.
- **Exportar CSV** abre no Excel, para levar ao formador.

As regras ficam na base de dados local (`data/`), por isso as horas, o preço da hora e as
margens nunca vão para o GitHub. A pasta `regras/` só tem os valores iniciais, carregados
na primeira vez que a app arranca (nunca sobrescreve o que já editaste).

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
