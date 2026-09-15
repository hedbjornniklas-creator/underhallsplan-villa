from pathlib import Path
from xml.sax.saxutils import escape
import json, shutil, zipfile
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from fontTools.ttLib import TTFont as FontFile
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from pypdf import PdfReader

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
A=OUT/'assets'
F=A/'fonts'
for weight in (400,600,700):
    target=F/f'Manrope-{weight}.ttf'
    instance=instantiateVariableFont(FontFile(F/'Manrope-variable.ttf'),{'wght':weight},inplace=False)
    # Unique names prevent PDF font deduplication across static instances.
    for platform,encoding,language in [(3,1,1033),(1,0,0)]:
        for name_id,value in [(1,f'Manrope {weight}'),(2,'Regular'),(3,f'ManropeStatic-{weight}'),(4,f'Manrope {weight}'),(6,f'ManropeStatic-{weight}')]:
            instance['name'].setName(value,name_id,platform,encoding,language)
    instance.save(target)
    pdfmetrics.registerFont(TTFont(f'M{weight}',str(target)))
pdfmetrics.registerFontFamily('M400',normal='M400',bold='M700',italic='M400',boldItalic='M700')

C={'blue':'#476786','blueSoft':'#EAF0F5','apricot':'#F6E7DC','ink':'#293239',
   'muted':'#58636D','white':'#FFFFFF','mist':'#F4F6F7','line':'#CFD7DE',
   'success':'#2C7159','successBg':'#E8F2EC','warning':'#805C1C','warningBg':'#FFF2D9',
   'error':'#A33F40','errorBg':'#FBEDEE','focus':'#274C70'}
def lum(h):
    values=[int(h[i:i+2],16)/255 for i in (1,3,5)]
    values=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values]
    return sum(a*b for a,b in zip(values,[.2126,.7152,.0722]))
def contrast(a,b):
    x,y=sorted([lum(a),lum(b)])
    return (y+.05)/(x+.05)
pairs=[('white','blue'),('ink','white'),('muted','white'),('ink','apricot'),('blue','blueSoft'),('success','successBg'),('warning','warningBg'),('error','errorBg')]
ratios={f'{a}/{b}':round(contrast(C[a],C[b]),2) for a,b in pairs}
assert all(v>=4.5 for v in ratios.values())
(A/'colors.json').write_text(json.dumps({'colors':C,'contrastRatios':ratios},indent=2),encoding='utf8')
(A/'tokens.css').write_text(':root {\n'+''.join(f'  --reno-{k}: {v};\n' for k,v in C.items())+'  --reno-font: "Manrope", Arial, sans-serif;\n  --reno-radius: 6px;\n  --reno-spacing: 8px;\n}\n',encoding='utf8')

def svg_logo(ink,blue,icon=False):
    symbol=f'<path d="M6 23 L30 4 L54 23 V57 H6 Z" fill="none" stroke="{blue}" stroke-width="4.5" stroke-linejoin="round"/><path d="M17 35 L26 44 L44 26" fill="none" stroke="{blue}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>'
    if icon:return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="RenoApp">{symbol}</svg>'
    f=FontFile(F/'Manrope-700.ttf'); gs=f.getGlyphSet(); cmap=f.getBestCmap(); pen=SVGPathPen(gs)
    offset=0; parts=[]; scale=42/f['head'].unitsPerEm
    for char in 'RenoApp':
        name=cmap[ord(char)]; pen=SVGPathPen(gs); gs[name].draw(pen)
        parts.append(f'<path d="{pen.getCommands()}" transform="translate({offset} 0)"/>')
        offset+=gs[name].width
    width=round(78+offset*scale+4)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 64" role="img" aria-label="RenoApp">{symbol}<g fill="{ink}" transform="translate(76 46) scale({scale} {-scale})">'+''.join(parts)+'</g></svg>'
for name,ink,blue,icon in [('primary',C['ink'],C['blue'],False),('mono',C['ink'],C['ink'],False),('white','#FFFFFF','#FFFFFF',False),('symbol',C['ink'],C['blue'],True)]:
    (A/f'renoapp-{name}.svg').write_text(svg_logo(ink,blue,icon),encoding='utf8')

W,H=960,640
pdf=OUT/'RenoApp-varumarkesprofil-v1.pdf'
c=canvas.Canvas(str(pdf),pagesize=(W,H))
c.setTitle('RenoApp | Varumärkesprofil | Förslag 1.0')
c.setAuthor('RenoApp / HusHub')
PAGE=0
def rect(x,y,w,h,fill,r=0,stroke=None):
    c.setFillColor(HexColor(C.get(fill,fill)))
    c.setStrokeColor(HexColor(C.get(stroke,stroke) if stroke else C.get(fill,fill)))
    c.roundRect(x,H-y-h,w,h,r,fill=1,stroke=int(stroke is not None))
def line(x,y,x2,y2,col='line',width=1):
    c.setStrokeColor(HexColor(C.get(col,col)));c.setLineWidth(width)
    c.setLineCap(1)
    c.line(x,H-y,x2,H-y2)
def text(s,x,y,size=14,color='ink',weight=400):
    c.setFont(f'M{weight}',size);c.setFillColor(HexColor(C.get(color,color)));c.drawString(x,H-y-size,s)
def p(s,x,y,w=400,size=14,color='ink',weight=400):
    style=ParagraphStyle('body',fontName=f'M{weight}',fontSize=size,leading=size*1.5,textColor=HexColor(C.get(color,color)),spaceAfter=0)
    para=Paragraph(s,style); _,height=para.wrap(w,H)
    assert y+height<596,(PAGE,s[:70],y,height)
    para.drawOn(c,x,H-y-height)
    return y+height
def title(k,t,sub=None):
    global PAGE
    PAGE+=1
    rect(0,0,W,H,'white')
    text('RenoApp',42,22,15,weight=700)
    text(k.upper(),650,26,10,'muted',600)
    line(42,56,918,56)
    text(t,42,77,32,weight=700)
    if sub:p(sub,42,127,855,13,'muted')
def end():
    line(42,603,918,603)
    text('VARUMÄRKESPROFIL 1.0  /  FÖRSLAG  /  14 SEPTEMBER 2026',42,615,8,'muted')
    text(f'{PAGE:02}',894,613,10,'muted')
    c.showPage()
def logo(x,y,scale=1,white=False,mono=False):
    col='white' if white else 'ink' if mono else 'blue'
    pts=[(6,23),(30,4),(54,23),(54,57),(6,57),(6,23)]
    for a,b in zip(pts,pts[1:]):line(x+a[0]*scale,y+a[1]*scale,x+b[0]*scale,y+b[1]*scale,col,4.5*scale)
    line(x+17*scale,y+35*scale,x+26*scale,y+44*scale,col,4.5*scale)
    line(x+26*scale,y+44*scale,x+44*scale,y+26*scale,col,4.5*scale)
    text('RenoApp',x+76*scale,y+3*scale,42*scale,'white' if white else 'ink',700)
def button(s,x,y,w=205):
    rect(x,y,w,42,'blue',6)
    tw=pdfmetrics.stringWidth(s,'M600',13)
    text(s,x+(w-tw)/2,y+10,13,'white',600)
def image(path,x,y,w,h):
    c.drawImage(str(path),x,H-y-h,width=w,height=h,preserveAspectRatio=True,anchor='c',mask='auto')

# 01: A compact visual identity board.
title('Riktning','Enklare att förstå. Lättare att hantera.')
rect(0,177,960,257,'mist')
logo(78,210,1.35)
p('Renoveringsansökningar<br/>som styrelsen förstår.',510,212,390,28,'ink',700)
p('Mindre mejlande. Bättre överblick.',513,322,350,16,'blue')
button('Anslut föreningen',514,367)
for i,(key,label) in enumerate([('blue','Dämpat blått'),('apricot','Ljus aprikos'),('ink','Grafit'),('blueSoft','Blådis')]):
    rect(42+i*224,462,210,44,key)
    text(label,42+i*224,517,13,weight=600)
    text(C[key],42+i*224,541,11,'muted')
end()

# 02: Brand strategy.
title('Positionering','Vi säljer enkelhet, inte fler funktioner.','RenoApp hjälper BRF-styrelser att hantera renoveringsansökningar med bättre struktur och överblick.')
text('Målgrupp',42,183,21,weight=700)
p('Primärt: ledamöter i bostadsrättsföreningars styrelser. De behöver förstå vad som planeras och vad som har lämnats in, utan att bli systemexperter.',42,222,401)
p('Sekundärt: boende som ska ansöka. De ska hitta rätt ingång, förstå frågorna och kunna komplettera samma ärende.',42,333,401)
text('Tre saker vi ska vara kända för',502,183,21,weight=700)
for y,h,b in [(228,'Begripligt','Vardagliga ord, tydliga frågor och ett avgränsat ärende.'),(333,'Samlat','Ansökan, underlag, dialog och beslut på samma plats.'),(438,'Styrelsens kontroll','Stöd i processen. Styrelsen bedömer och beslutar.')]:
    text(h,502,y,18,'blue',700);p(b,502,y+31,405,14)
p('<b>Varumärkesrelation:</b> RenoApp är tjänsten. HusHub är avsändaren bakom den. Använd ”RenoApp från HusHub” i sidfot och om-information.',42,493,400,12)
end()

# 03: Logo audit and recommendation.
title('Logotyp','Behåll igenkänningen. Ta bort bruset.','Ett rekommenderat logotypförslag, inte en genomförd ändring av den befintliga appen.')
text('Nuvarande',42,183,15,'muted',600)
image(ROOT/'public/landing/Renoapp.png',42,220,390,145)
text('Föreslagen förenkling',505,183,15,'muted',600)
logo(513,244,1.05)
p('Hus, bock och verktyg kommunicerar området, men många detaljer, färger och skuggor konkurrerar i små format.',42,399,400,14)
p('Behåll huset och bocken. Ta bort hammare, skiftnyckel och effekter. Ett enhetligt ordmärke och en dämpad blå symbol ger ett lugnare uttryck.',505,399,400,14)
rect(42,520,876,60,'apricot')
p('Bocken står för struktur och tydlighet, inte för en garanti om tekniskt eller juridiskt godkännande. Förslaget behöver godkännas och särprägeln bör kontrolleras före lansering.',57,532,845,12)
end()

# 04: Practical logo rules.
title('Logotypsystem','En logotyp, flera användbara format.')
logo(65,176,.85)
rect(498,170,420,105,'blue',6);logo(520,192,.85,white=True)
logo(65,309,.85,mono=True)
text('Symbol för små ytor',500,313,15,weight=600)
image_dummy=False
# Symbol alone, using the same master geometry.
c.saveState();c.translate(520,H-391);c.scale(.65,.65)
c.setStrokeColor(HexColor(C['blue']));c.setLineWidth(4.5)
path=c.beginPath();path.moveTo(6,41);path.lineTo(30,60);path.lineTo(54,41);path.lineTo(54,7);path.lineTo(6,7);path.close();c.drawPath(path)
path=c.beginPath();path.moveTo(17,29);path.lineTo(26,20);path.lineTo(44,38);c.drawPath(path);c.restoreState()
p('<b>Frizon:</b> minst en halv symbolbredd runt hela märket.<br/><b>Minsta storlek:</b> ordmärke 120 px brett digitalt / 30 mm i tryck. Symbol 24 px; förenklad ikon bör provas separat vid 16 px.',42,429,414,13)
p('<b>Gör inte:</b> tänj, rotera, skugga eller lägg märket i en egen dekorativ ruta. Byt inte färg efter kampanj. Placera aldrig på en rörig bakgrund.',500,429,406,13)
p('Leverans: primär, enfärgad, vit och fristående symbol som SVG. Ordmärket är omvandlat till banor och kräver inget installerat typsnitt.',42,543,861,11,'muted')
end()

# 05: Colors and contrast.
title('Färger','Mjuk färg. Tydlig kontrast.','Blått är handling och igenkänning. Aprikos är värme. Vitt och grafit bär huvuddelen av sidan.')
swatches=[('blue','Reno blå'),('apricot','Aprikos'),('ink','Grafit'),('white','Vitt'),('blueSoft','Blådis'),('muted','Sekundär text')]
for i,(key,name) in enumerate(swatches):
    x=42+i*147;rect(x,183,136,82,key,stroke='line' if key=='white' else None)
    text(name,x,278,12,weight=700);text(C[key],x,302,11,'muted')
text('Fördelning',42,351,19,weight=700)
p('Cirka 70 % vitt, 15 % ljusa neutrala ytor, 10 % blått och 5 % aprikos. Riktvärden för visuellt lugn, inte en matematisk regel.',42,385,390,13)
text('Kontrollerade textkombinationer',502,351,19,weight=700)
for i,(a,b,label) in enumerate([('white','blue','Vit text på blå knapp'),('muted','white','Sekundär text på vitt'),('ink','apricot','Grafit på aprikos')]):
    text(f'{label}: {ratios[a+"/"+b]:.2f}:1',502,388+i*31,13)
p('<b>Aprikos används som yta, aldrig som ljus text på vitt.</b> Håll knappar mörkare än dekorativa detaljer. Statusfärger är ett separat funktionellt system.',42,495,390,13)
p('WCAG AA: minst 4,5:1 för normal text och 3:1 för stor text. Färgkoderna är kontrollerade; den färdiga sidan behöver även testas för fokus, storlek och interaktion.',502,495,405,12,'muted')
end()

# 06: Type.
title('Typografi','Manrope. Ett typsnitt räcker.','Rekommendation: lokal webbfont med vikterna 400, 600 och 700. Reserv: Arial, sans-serif.')
text('Renoveringsansökningar',42,188,37,weight=700)
text('som styrelsen förstår.',42,237,37,'blue',700)
text('Å Ä Ö  /  å ä ö  /  0123456789',42,307,23)
p('Den boende får hjälp att lämna rätt uppgifter. Ni får ansökan och underlagen samlade på ett ställe.',42,364,421,16)
text('Webbskala',552,191,19,weight=700)
rows=[('H1','48 / 52 px','32 / 38 px','700'),('H2','32 / 40 px','26 / 34 px','700'),('H3','22 / 30 px','20 / 28 px','600'),('Brödtext','18 / 28 px','16 / 25 px','400'),('Knapp','16 / 22 px','16 / 22 px','600'),('Detalj','14 / 20 px','14 / 20 px','400')]
text('Stil',552,230,10,'muted');text('Dator',628,230,10,'muted');text('Mobil',741,230,10,'muted');text('Vikt',858,230,10,'muted')
for i,row in enumerate(rows):
    y=258+i*37
    for x,s in zip([552,628,741,858],row):text(s,x,y,11)
    line(552,y+28,907,y+28)
p('Storlekar väljs vid brytpunkter, inte genom kontinuerlig skalning med fönsterbredden. Teckenavstånd 0. Undvik tunna vikter, långa versalrubriker och tät brödtext.',42,494,426,12)
p('Typsnitt: Manrope, distribuerat via Google Fonts under SIL Open Font License. Fontfil och licens ingår. Ingen extern fontladdning behövs.',552,511,354,11,'muted')
end()

# 07: Voice and messaging.
title('Språk & budskap','Vänlig, rak och sakkunnig. Inte myndighetston.')
text('Huvudbudskap',42,184,15,'muted',600)
p('Renoveringsansökningar<br/>som styrelsen förstår.',42,217,411,27,'blue',700)
p('Den boende får hjälp att lämna rätt uppgifter. Ni får ansökan och underlagen samlade på ett ställe.',42,316,411,15)
text('Skriv så här',507,184,19,weight=700)
for y,s in [(226,'”Ni får bättre överblick över ärendet.”'),(266,'”Begär in de underlag ni behöver.”'),(306,'”Komplettera samma ansökan.”')]:text(s,507,y,14)
text('Undvik',507,379,19,weight=700)
p('”Revolutionerande helhetsplattform.”<br/>”Garanterat korrekta underlag.”<br/>”Vi godkänner er renovering.”',507,418,396,14)
rect(42,504,418,68,'apricot')
p('Rubriken handlar om tydliga ansökningar, inte om styrelsens kompetens. Undvik skämt om okunniga ledamöter eller besvärliga boende.',55,516,391,11)
end()

# 08: Visual language.
title('Bildspråk & gränssnitt','Visa en sak i taget. Låt appen bevisa nyttan.')
text('Välj',42,181,21,weight=700)
p('Riktiga appbilder med testdata. Ett ärende eller en handling per utsnitt. Vardagsnära bilder av hem och föreningsarbete när de tillför något.',42,220,408,14)
p('Enkla linjeikoner från Lucide i samma storlek och linjetjocklek. Dekoration är underordnad innehållet. Post-it-filmen kan vara ett kampanjformat, inte hela webbens formspråk.',42,325,408,14)
text('Undvik',507,181,21,weight=700)
p('Många skärmbilder samtidigt, små oläsliga dashboards, generiska handslag och foton som inte berättar något. Inga påhittade kundomdömen eller användarsiffror.',507,220,398,14)
text('Enkelt komponentuttryck',507,337,18,weight=700)
button('Anslut föreningen',507,381)
text('Se hur det fungerar',738,393,13,'blue',600)
for y,col,bg,label in [(450,'success','successBg','Inkommet'),(487,'warning','warningBg','Komplettering begärd'),(524,'error','errorBg','Kunde inte skickas')]:
    rect(507,y,278,28,bg,4);text(label,519,y+4,12,col,600)
p('8 px grundrytm. 6 px knappradie. 44 px som designmål för klickytor. Tydliga etiketter och synligt tangentbordsfokus. Färg kompletteras alltid med text.',42,475,408,13)
end()

# 09: Landing concept reference, clearly labeled.
title('Webbkoncept','En ingång. Ett tydligt erbjudande.','Visuell riktning för renoapp.se. Bilden är en konceptskiss, inte en färdig sida eller den faktiska appen.')
mock=Path('C:/Users/hedbj/.codex/generated_images/01a07ab6-a0ed-77c1-a6e6-4ee36a7f1209/exec-6d46043c-4b20-40da-870b-096f8c479b5a.png')
image(mock,42,178,575,383)
text('Prioriterad ordning',652,184,18,weight=700)
p('1. Vad RenoApp löser.<br/>2. Tre konkreta fördelar.<br/>3. En tydlig appvy.<br/>4. Så fungerar processen.<br/>5. Pris och betalningspunkt.<br/>6. Vanliga frågor.<br/>7. Anslut föreningen.',652,224,265,13)
p('Mobil: en spalt, samma budskap. Inloggning och boendes ansökningsväg ska vara lätta att hitta även vid återbesök.',652,418,265,12)
p('Den fastställda paletten i denna profil är något mörkare än skissen för tydligare kontrast.',652,512,265,11,'muted')
end()

# 10: Example applications.
title('Marknadsföring','Samma identitet i annons, mejl och film.')
rect(42,177,413,369,'blueSoft',6)
logo(63,195,.55)
p('Renoveringsansökningar<br/>som styrelsen förstår.',67,283,360,24,'ink',700)
p('Underlag samlade.<br/>Mindre mejlande.<br/>Bättre överblick.',67,367,340,17)
button('Läs mer på renoapp.se',67,476,255)
text('Exempel: socialt inlägg',42,561,11,'muted')
text('Mejl till styrelsen',506,184,20,weight=700)
p('<b>Ämne:</b> En enklare väg för era renoveringsansökningar',506,224,403,14)
p('Hej!<br/><br/>Med RenoApp får boende hjälp att beskriva sin renovering. Styrelsen kan begära in underlag och följa ärendet på ett ställe.<br/><br/>Ingen fast avgift. Ni betalar först när ni väljer att ta ett ärende vidare.',506,286,401,14)
button('Se hur RenoApp fungerar',506,484,260)
p('Film: 30 sekunder, ett budskap per scen. Kombinera illustrationer med tydliga apputsnitt. Texta tal och låt filmen fungera utan ljud.',506,538,400,11,'muted')
end()

# 11: Product boundaries, pricing and entry points.
title('Erbjudande & ingångar','Var tydlig även där det kostar.','Prisnivån är inte beslutad. Publicera inte 1 000 kr som fast pris innan belopp och moms är bekräftade.')
text('Gratis att ansluta',42,184,20,'blue',700)
p('Ingen fast avgift. Föreningen kan ansluta sig och ta emot ansökningar utan att varje inskickad ansökan blir en kostnad.',42,225,410,14)
text('Betalning när ärendet tas vidare',42,331,20,'blue',700)
p('Avgiften uppstår när styrelsen väljer att påbörja handläggningen. Det är inte samma sak som att godkänna renoveringen.',42,373,410,14)
p('<b>I gränssnittet:</b> visa belopp, moms och vad som ingår före bekräftelsen. Kompletteringar inom samma ärende bör ingå; omfattningen behöver fastställas.',42,466,410,13)
text('renoapp.se',509,184,24,weight=700)
p('Marknadssida och framtida huvudingång. Den ska sälja till styrelsen och hjälpa återkommande användare vidare.',509,228,390,14)
for y,h,b in [(327,'Anslut föreningen','Till befintligt BRF-flöde på HusHub.'),(403,'Logga in','Till RenoApps befintliga inloggning.'),(479,'Ansök om renovering','Till befintlig föreningssökning / ansökan.')]:
    text(h,509,y,16,'blue',700);p(b,509,y+30,400,12)
p('Programmet ligger kvar på hushub.se. Ingen flytt, ompekning eller publicering ingår i detta förslag.',42,555,864,11,'muted')
end()

# 12: Delivery and approval.
title('Leverans & nästa steg','En sammanhållen riktning. Inte ett påtvingat byte.')
text('Det här ingår',42,181,21,weight=700)
p('• Varumärkesprofil som PDF.<br/>• Logotypförslag i fyra SVG-varianter.<br/>• Manrope-font och licens.<br/>• Färgkoder, CSS-variabler och kontrastvärden.<br/>• Exempel på webb, annons och mejl.',42,223,416,14)
text('Godkänn innan införande',509,181,21,weight=700)
p('1. Den förenklade logotypen och paletten.<br/>2. Huvudbudskap och textton.<br/>3. Pris, moms och tjänstens omfattning.<br/>4. Särprägel och rättigheter för logotypen.<br/>5. Slutlig webbskiss på mobil och dator.',509,223,404,14)
p('Alla tillgångar är förslag. Ingen befintlig logotyp, färg, kod, domän eller produktfunktion har ändrats. Inför först på den nya marknadssidan; planera därefter ett separat beslut om appens utseende.',42,396,413,13)
text('Källor & underlag',509,394,18,weight=700)
sources=[('Manrope / Google Fonts','https://fonts.google.com/specimen/Manrope'),('SIL Open Font License / fontpaket','https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt'),('WCAG 2.2 / textkontrast','https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html')]
for i,(label,url) in enumerate(sources):
    y=430+i*29;text(label,509,y,12,'blue');c.linkURL(url,(509,H-y-19,906,H-y),relative=0)
p('Övrigt underlag: er nuvarande logotyp, godkänd färgriktning och samtal om målgrupp, enkelhet och betalningsmodell.',509,532,401,11,'muted')
end()
c.save()
reader=PdfReader(pdf)
assert len(reader.pages)==12
for i,page in enumerate(reader.pages):
    assert len(page.extract_text())>150,(i,'empty page')
with zipfile.ZipFile(OUT/'RenoApp-profilpaket-v1.zip','w',zipfile.ZIP_DEFLATED) as z:
    z.write(pdf,pdf.name)
    for file in A.rglob('*'):
        if file.is_file():z.write(file,file.relative_to(OUT))
print(json.dumps({'pdf':str(pdf),'pages':len(reader.pages),'contrast':ratios},ensure_ascii=False))
