"""
Gera um DXF sintético com as armadilhas do primeiro DXF real (moradia, 2022):
  - cabeçalho diz centímetros ($INSUNITS=5) mas o desenho está em METROS;
  - duas plantas no mesmo espaço de modelo (versão A em x 0..14, versão B em x 30..44);
  - paredes em linhas duplas na layer arq_corte, incluindo uma parede diagonal;
  - nomes das divisões em MTEXT com formatação, cotas, tramas, blocos e espaço de papel.

Uso: python3 scripts/fixtures/gerar-dxf-teste.py packages/core/test/fixtures/moradia_sintetica.dxf
"""
import sys

out = []
def pair(code, value):
    out.append(f"{code:>3}")
    out.append(str(value))

def section(name):
    pair(0, "SECTION"); pair(2, name)

def endsec():
    pair(0, "ENDSEC")

def line(layer, x1, y1, x2, y2, paper=False):
    pair(0, "LINE"); pair(8, layer)
    if paper: pair(67, 1)
    pair(10, x1); pair(20, y1); pair(30, 0); pair(11, x2); pair(21, y2); pair(31, 0)

def wall(x1, y1, x2, y2, t=0.2, layer="arq_corte"):
    """Parede como contorno fechado (duas faces + topos), como no ficheiro real."""
    import math
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    nx, ny = -dy / L * t, dx / L * t
    pts = [(x1, y1), (x2, y2), (x2 + nx, y2 + ny), (x1 + nx, y1 + ny)]
    pair(0, "LWPOLYLINE"); pair(8, layer); pair(90, 4); pair(70, 1)
    for x, y in pts:
        pair(10, round(x, 6)); pair(20, round(y, 6))

def mtext(layer, x, y, s, h=0.25):
    pair(0, "MTEXT"); pair(8, layer); pair(10, x); pair(20, y); pair(30, 0); pair(40, h); pair(1, s)

def dim(x1, y1, x2, y2):
    import math
    pair(0, "DIMENSION"); pair(8, "arq_cotas"); pair(2, "*D1")
    pair(10, x1); pair(20, y1 - 0.8); pair(13, x1); pair(23, y1); pair(14, x2); pair(24, y2)
    pair(42, round(math.hypot(x2 - x1, y2 - y1), 6))

def plan(ox, version):
    # contorno exterior 14 x 9 m com vãos (porta de entrada e janela)
    wall(ox + 0, 0, ox + 5, 0); wall(ox + 6, 0, ox + 14, 0)          # vão de 1 m na fachada
    wall(ox + 14, 0, ox + 14, 9); wall(ox + 14, 9, ox + 0, 9); wall(ox + 0, 9, ox + 0, 0)
    wall(ox + 7, 0, ox + 7, 9, t=0.15)                                # divisória sala / quartos
    wall(ox + 7, 4.5, ox + 14, 4.5, t=0.15)                           # quarto 1 / quarto 2
    # ala diagonal (anexo a 45°)
    wall(ox + 14, 9, ox + 17, 6)
    # texto das divisões, com formatação MTEXT
    mtext("arq_texto", ox + 2.5, 5, "{\\fArial|b0|i0;Sala de estar/jantar}")
    mtext("arq_texto", ox + 10, 7, "Quarto 1")
    mtext("arq_texto", ox + 10, 2.5, "Quarto 2" if version == "A" else "Escritório")
    mtext("arq_texto", ox + 1, 8.3, "QE.")                            # sigla de equipamento
    mtext("arq_texto", ox + 5, -2, "Alçado frontal")                   # não é divisão
    # cotas em metros (o que denuncia o cabeçalho errado)
    dim(ox + 0, 0, ox + 14, 0); dim(ox + 0, 0, ox + 0, 9); dim(ox + 7, 0, ox + 14, 0)
    dim(ox + 7, 4.5, ox + 14, 4.5); dim(ox + 5, 0, ox + 6, 0)
    # porta com arco (LWPOLYLINE com bulge)
    pair(0, "LWPOLYLINE"); pair(8, "arq_vista 1"); pair(90, 2); pair(70, 0)
    pair(10, ox + 6); pair(20, 0); pair(42, 0.41421356)
    pair(10, ox + 5); pair(20, 1)
    # mobiliário como bloco inserido (rodado 90° e escalado 2×)
    pair(0, "INSERT"); pair(8, "arq_mobiliario"); pair(2, "MESA")
    pair(10, ox + 3); pair(20, 3); pair(41, 2); pair(42, 2); pair(50, 90)
    # trama sem contorno (só padrão): não gera linhas
    pair(0, "HATCH"); pair(8, "arq_tramas"); pair(2, "SOLID")
    # divisória que SÓ existe como trama (como no ficheiro real): contorno em polilinha
    pair(0, "HATCH"); pair(8, "arq_tramas_claras"); pair(2, "SOLID"); pair(70, 1); pair(71, 0)
    pair(91, 1); pair(92, 2); pair(72, 0); pair(73, 1); pair(93, 4)
    for x, y in [(ox + 10.5, 0.2), (ox + 10.6, 0.2), (ox + 10.6, 4.5), (ox + 10.5, 4.5)]:
        pair(10, x); pair(20, y)
    pair(97, 0); pair(75, 0); pair(76, 1); pair(98, 1); pair(10, ox + 10.55); pair(20, 2)
    # outra divisória como trama com contorno em arestas (linhas)
    pair(0, "HATCH"); pair(8, "arq_estereotomia"); pair(2, "ANSI31"); pair(70, 0); pair(71, 0)
    pair(91, 1); pair(92, 1); pair(93, 4)
    for (a, b, c, d) in [(ox + 3.5, 4.5, ox + 7, 4.5), (ox + 7, 4.5, ox + 7, 4.6), (ox + 7, 4.6, ox + 3.5, 4.6), (ox + 3.5, 4.6, ox + 3.5, 4.5)]:
        pair(72, 1); pair(10, a); pair(20, b); pair(11, c); pair(21, d)
    pair(97, 0)

section("HEADER")
pair(9, "$ACADVER"); pair(1, "AC1032")
pair(9, "$INSUNITS"); pair(70, 5)
endsec()

section("BLOCKS")
pair(0, "BLOCK"); pair(8, "0"); pair(2, "MESA"); pair(70, 0); pair(10, 0); pair(20, 0); pair(30, 0)
for (a, b, c, d) in [(0, 0, 0.8, 0), (0.8, 0, 0.8, 0.4), (0.8, 0.4, 0, 0.4), (0, 0.4, 0, 0)]:
    line("0", a, b, c, d)
pair(0, "ENDBLK"); pair(8, "0")
endsec()

section("ENTITIES")
plan(0, "A")
plan(30, "B")
line("FA FOLHA", -100, -100, 100, -100, paper=True)  # espaço de papel: ignorado
for i in range(40):                                  # topografia longe, para o desenho ser "o projeto inteiro"
    line("TOP_CV_MESTRA", -200 + i * 5, 80, -195 + i * 5, 82)
endsec()
pair(0, "EOF")

with open(sys.argv[1], "w", newline="\r\n", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
print("ok", sys.argv[1])
