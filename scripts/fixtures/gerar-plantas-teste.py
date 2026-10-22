import sys
from reportlab.lib.pagesizes import A3, landscape
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
out = sys.argv[1]
M = 10*mm  # 1 m at 1:100
W, H = landscape(A3)
ox, oy = 60*mm, 60*mm  # origin (bottom-left of house)
c = canvas.Canvas(out + "/planta_t2_1-100.pdf", pagesize=(W, H))
c.setLineWidth(0.7)
def wall(x1,y1,x2,y2,t=0.15):
    # double line wall, thickness t metres (horizontal or vertical only)
    if y1==y2:
        c.line(ox+x1*M, oy+y1*M, ox+x2*M, oy+y2*M)
        c.line(ox+x1*M, oy+(y1+t)*M, ox+x2*M, oy+(y2+t)*M)
    else:
        c.line(ox+x1*M, oy+y1*M, ox+x2*M, oy+y2*M)
        c.line(ox+(x1+t)*M, oy+y1*M, ox+(x2+t)*M, oy+y2*M)
# exterior 10 x 8
wall(0,0,10,0); wall(0,8,10,8); wall(0,0,0,8); wall(10,0,10,8)
# interior
wall(4.2,0,4.2,8)        # separa sala/cozinha de quartos
wall(4.2,4,10,4)         # quarto 1 / quarto 2
wall(7,4,7,8)            # WC
# anexo com parede diagonal (alçado chanfrado), de (10,8) a (13,5)
c.line(ox+10*M, oy+8*M, ox+13*M, oy+5*M)
c.line(ox+10.15*M, oy+8*M, ox+13*M, oy+5.15*M)
# furniture-ish noise (rectangles + hatching)
for i in range(40):
    c.line(ox+0.5*M+i*0.08*M, oy+0.5*M, ox+0.5*M+i*0.08*M, oy+1.1*M)
c.rect(ox+1*M, oy+5*M, 2*M, 1*M)
# door arc
c.arc(ox+4.2*M-0.8*M, oy+2*M-0.8*M, ox+4.2*M+0.8*M, oy+2*M+0.8*M, 0, 90)
# dimension line (cota) 4.20 m along bottom
c.setLineWidth(0.3)
c.line(ox, oy-8*mm, ox+4.2*M, oy-8*mm)
c.line(ox, oy-10*mm, ox, oy-6*mm); c.line(ox+4.2*M, oy-10*mm, ox+4.2*M, oy-6*mm)
c.setFont("Helvetica", 8); c.drawString(ox+2*M, oy-7*mm, "4.20")
c.drawString(ox+1.5*M, oy+6.5*M, "SALA")
c.drawString(ox+6*M, oy+2*M, "QUARTO 1")
c.setFont("Helvetica", 10); c.drawString(W-120*mm, 20*mm, "PLANTA PISO 0 - ESCALA 1:100")
c.showPage(); c.save()
# raster fixture
from PIL import Image, ImageDraw
img = Image.new("RGB",(800,600),"white"); d=ImageDraw.Draw(img); d.rectangle([100,100,700,500],outline="black",width=4)
img.save("" + out + "/_scan.png")
c = canvas.Canvas(out + "/digitalizacao.pdf", pagesize=(W,H))
c.drawImage("" + out + "/_scan.png", 20*mm, 20*mm, width=380*mm, height=260*mm)
c.showPage(); c.save()
print("ok")
