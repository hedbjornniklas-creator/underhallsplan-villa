from pathlib import Path
import json
import shutil
import zipfile
from xml.sax.saxutils import escape

from fontTools.ttLib import TTFont as FontFile
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from pypdf import PdfReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.utils import ImageReader


OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
ASSETS = OUT / 'assets'
FONTS = ASSETS / 'fonts'
FONTS.mkdir(parents=True, exist_ok=True)
SOURCE_FONTS = OUT.parent / 'renoapp-brand' / 'assets' / 'fonts'
for name in ('Manrope-variable.ttf', 'OFL.txt'):
    shutil.copy2(SOURCE_FONTS / name, FONTS / name)
for weight in (400, 600, 700):
    target = FONTS / f'Manrope-{weight}.ttf'
    instance = instantiateVariableFont(FontFile(FONTS / 'Manrope-variable.ttf'), {'wght': weight}, inplace=False)
    for platform, encoding, language in ((3, 1, 1033), (1, 0, 0)):
        for name_id, value in ((1, f'Manrope {weight}'), (2, 'Regular'), (3, f'ManropeStatic-{weight}'), (4, f'Manrope {weight}'), (6, f'ManropeStatic-{weight}')):
            instance['name'].setName(value, name_id, platform, encoding, language)
    instance.save(target)
    pdfmetrics.registerFont(TTFont(f'M{weight}', str(target)))
pdfmetrics.registerFontFamily('M400', normal='M400', bold='M700', italic='M400', boldItalic='M700')

C = {
    'ink': '#252A2D', 'hover': '#101518', 'accent': '#F2D76A', 'selected': '#FFF7D6',
    'gecko': '#4D929A',
    'white': '#FFFFFF', 'paper': '#F4F6F6', 'muted': '#596368', 'line': '#D5DCDD',
    'control': '#7C888D', 'link': '#206961', 'focus': '#206961',
    'success': '#24664B', 'success-bg': '#EAF4EE',
    'warning': '#7B5012', 'warning-bg': '#FFF1DB',
    'error': '#A52E42', 'error-bg': '#FCEEF0',
    'info': '#285D82', 'info-bg': '#EAF2F9',
}


def luminance(value):
    values = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    values = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values]
    return sum(a * b for a, b in zip(values, (.2126, .7152, .0722)))


def contrast(a, b):
    lo, hi = sorted((luminance(C[a]), luminance(C[b])))
    return (hi + .05) / (lo + .05)


pairs = [('white', 'ink'), ('ink', 'white'), ('ink', 'accent'), ('ink', 'selected'),
         ('muted', 'white'), ('muted', 'paper'), ('link', 'white'),
         ('success', 'success-bg'), ('warning', 'warning-bg'), ('error', 'error-bg'), ('info', 'info-bg')]
assert all(contrast(a, b) >= 4.5 for a, b in pairs)
assert contrast('focus', 'white') >= 3
assert contrast('control', 'white') >= 3
ratios = {f'{a}/{b}': round(contrast(a, b), 2) for a, b in pairs}
(ASSETS / 'colors.json').write_text(json.dumps({'profileVersion': '2.1', 'productName': 'Gizmo', 'endorsement': 'från HusHub', 'colors': C, 'textContrastRatios': ratios,
    'controlContrast': round(contrast('control', 'white'), 2), 'focusContrast': round(contrast('focus', 'white'), 2)}, indent=2), encoding='utf8')
(ASSETS / 'tokens.css').write_text('/* Gizmo profile tokens. Reference only; application CSS is unchanged. */\n:root {\n'
    + ''.join(f'  --gizmo-{key}: {value};\n' for key, value in C.items())
    + '  --gizmo-font: "Manrope", Arial, sans-serif;\n  --gizmo-radius: 6px;\n'
    + '  --gizmo-space-unit: 4px;\n  --gizmo-control-height: 44px;\n'
    + '  --gizmo-row-height: 56px;\n  --gizmo-focus-width: 2px;\n'
    + '  --gizmo-focus-offset: 2px;\n}\n', encoding='utf8')


def outlined_word(word, size, x, baseline, color, weight=700):
    font = FontFile(FONTS / f'Manrope-{weight}.ttf')
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    offset, paths = 0, []
    scale = size / font['head'].unitsPerEm
    for char in word:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        paths.append(f'<path d="{pen.getCommands()}" transform="translate({offset} 0)"/>')
        offset += glyphs[name].width
    result = f'<g fill="{color}" transform="translate({x} {baseline}) scale({scale} {-scale})">' + ''.join(paths) + '</g>'
    return result, offset * scale


GECKO_BODY = [
    ('M', 39, 17), ('C', 38, 13, 40, 9, 44, 7),
    ('C', 49, 4, 56, 5, 57, 9), ('C', 59, 13, 54, 19, 48, 21),
    ('L', 42, 22), ('C', 38, 26, 37, 31, 34, 37),
    ('C', 30, 43, 25, 46, 24, 49), ('C', 22, 55, 25, 59, 30, 59),
    ('C', 34, 59, 36, 56, 34, 54), ('C', 40, 57, 36, 63, 30, 63),
    ('C', 21, 63, 17, 57, 18, 50), ('C', 19, 43, 21, 40, 23, 35),
    ('C', 27, 27, 31, 22, 39, 17), ('Z',),
]
GECKO_LIMBS = [
    [('M', 35, 23), ('L', 29, 16), ('L', 25, 17)],
    [('M', 40, 24), ('L', 44, 30), ('L', 50, 29)],
    [('M', 25, 37), ('L', 17, 34), ('L', 14, 38)],
    [('M', 29, 39), ('L', 34, 44), ('L', 38, 42)],
]
GECKO_TOES = [
    (25, 17, 24, 9), (25, 17, 20, 14), (26, 17, 29, 11),
    (50, 29, 51, 23), (50, 29, 56, 27), (50, 29, 54, 34),
    (14, 38, 9, 35), (14, 38, 8, 41), (14, 38, 15, 44),
    (38, 42, 37, 37), (38, 42, 44, 40), (38, 42, 43, 46),
]


def svg_path(commands):
    return ' '.join(str(value) for command in commands for value in command)


def svg_symbol(fill):
    # One geometry source keeps the vector export and PDF mark identical.
    parts = [f'<path d="{svg_path(GECKO_BODY)}" fill="{fill}"/>']
    for limb in GECKO_LIMBS:
        parts.append(f'<path d="{svg_path(limb)}" fill="none" stroke="{fill}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>')
    for x1, y1, x2, y2 in GECKO_TOES:
        parts.append(f'<path d="M{x1} {y1} L{x2} {y2}" stroke="{fill}" stroke-width="2.7" stroke-linecap="round"/><circle cx="{x2}" cy="{y2}" r="2.1" fill="{fill}"/>')
    return ''.join(parts)


def svg_logo(ink, accent, symbol_only=False, endorsed=False):
    symbol = svg_symbol(accent)
    if symbol_only:
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Gizmo">{symbol}</svg>'
    word, width = outlined_word('Gizmo', 42, 78, 47, ink)
    extra = outlined_word('från HusHub', 12, 80, 70, ink, 400)[0] if endorsed else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {round(82 + width)} {80 if endorsed else 64}" role="img" aria-label="Gizmo från HusHub">{symbol}{word}{extra}</svg>'


for name, ink, accent, symbol, endorsed in (
    ('primary', C['ink'], C['gecko'], False, False),
    ('mono', C['ink'], C['ink'], False, False),
    ('white', C['white'], C['white'], False, False),
    ('symbol', C['ink'], C['gecko'], True, False),
    ('endorsed', C['ink'], C['gecko'], False, True),
):
    (ASSETS / f'gizmo-{name}.svg').write_text(svg_logo(ink, accent, symbol, endorsed), encoding='utf8')

W, H = 960, 640
PDF = OUT / 'Gizmo-varumarkesprofil-v2-1.pdf'
c = canvas.Canvas(str(PDF), pagesize=(W, H))
c.setTitle('Gizmo från HusHub | Varumärkesprofil 2.1 | Gecko')
c.setAuthor('HusHub')
c.setSubject('Gizmo med den valda geckoödlan, förenklad ödlesymbol och riktlinjer för användning. Ingen appändring.')
PAGE = 0


def color(value):
    return HexColor(C.get(value, value))


def rect(x, y, w, h, fill='white', radius=0, stroke=None):
    c.setFillColor(color(fill))
    c.setStrokeColor(color(stroke or fill))
    c.setLineWidth(.8)
    c.roundRect(x, H - y - h, w, h, radius, fill=1, stroke=int(stroke is not None))


def line(x, y, x2, y2, fill='line', width=.8):
    c.setStrokeColor(color(fill))
    c.setLineWidth(width)
    c.setLineCap(0)
    c.line(x, H - y, x2, H - y2)


def text(s, x, y, size=14, fill='ink', weight=400, maxw=None):
    width = pdfmetrics.stringWidth(s, f'M{weight}', size)
    assert x + width < W - 22, (PAGE, s, x + width)
    if maxw is not None:
        assert width <= maxw, (PAGE, s, width, maxw)
    c.setFont(f'M{weight}', size)
    c.setFillColor(color(fill))
    c.drawString(x, H - y - size, s)


def p(s, x, y, w=400, size=14, fill='ink', weight=400, limit=589, leading=None):
    style = ParagraphStyle('body', fontName=f'M{weight}', fontSize=size, leading=leading or size * 1.46,
                           textColor=color(fill), spaceAfter=0)
    paragraph = Paragraph(s, style)
    _, height = paragraph.wrap(w, H)
    assert y + height <= limit, (PAGE, s[:70], y, height, limit)
    paragraph.drawOn(c, x, H - y - height)
    return y + height


def title(kicker, headline, sub=None):
    global PAGE
    PAGE += 1
    rect(0, 0, W, H)
    text('Gizmo från HusHub', 42, 23, 15, weight=700)
    text(kicker.upper(), 666, 26, 10, 'muted', 600, maxw=252)
    line(42, 56, 918, 56)
    text(headline, 42, 78, 31, weight=700, maxw=876)
    if sub:
        p(sub, 42, 128, 866, 13, 'muted', limit=174)


def end():
    line(42, 603, 918, 603)
    text('VARUMÄRKESPROFIL 2.1  /  GIZMO  /  16 SEPTEMBER 2026', 42, 615, 8, 'muted')
    text(f'{PAGE:02}', 894, 613, 10, 'muted')
    c.showPage()


def symbol(x, y, scale=1, ink='ink', accent='gecko'):
    c.saveState()
    c.translate(x, H - y)
    c.scale(scale, -scale)
    c.setFillColor(color(accent))
    c.setStrokeColor(color(accent))
    c.setLineCap(1)
    c.setLineJoin(1)
    for commands, width in [(GECKO_BODY, 0)] + [(limb, 4.5) for limb in GECKO_LIMBS]:
        path = c.beginPath()
        for operation, *values in commands:
            {'M': path.moveTo, 'L': path.lineTo, 'C': path.curveTo, 'Z': path.close}[operation](*values)
        c.setLineWidth(width)
        c.drawPath(path, fill=int(width == 0), stroke=int(width > 0))
    c.setLineWidth(2.7)
    for x1, y1, x2, y2 in GECKO_TOES:
        c.line(x1, y1, x2, y2)
        c.circle(x2, y2, 2.1, fill=1, stroke=0)
    c.restoreState()


def logo(x, y, scale=1, ink='ink', accent='gecko', endorsed=False):
    symbol(x, y, scale, ink, accent)
    # Manrope baseline matches the outlined SVG master.
    c.setFont('M700', 42 * scale)
    c.setFillColor(color(ink))
    c.drawString(x + 78 * scale, H - y - 47 * scale, 'Gizmo')
    if endorsed:
        c.setFont('M400', 12 * scale)
        c.drawString(x + 80 * scale, H - y - 70 * scale, 'från HusHub')


def mascot(x, y, height):
    c.drawImage(ImageReader(str(ASSETS / 'gizmo-gecko-white.png')), x, H - y - height,
                width=height * 2 / 3, height=height)


def button(label, x, y, w=190, h=42, primary=True, size=13):
    rect(x, y, w, h, 'ink' if primary else 'white', 6, None if primary else 'control')
    tw = pdfmetrics.stringWidth(label, 'M600', size)
    assert tw < w - 20, (label, tw, w)
    text(label, x + (w - tw) / 2, y + (h - size) / 2 - 2, size, 'white' if primary else 'ink', 600)


def badge(label, x, y, tone='info', w=None):
    tw = pdfmetrics.stringWidth(label, 'M600', 10)
    w = w or tw + 18
    rect(x, y, w, 23, f'{tone}-bg', 3)
    text(label, x + 9, y + 4, 10, tone, 600)


# 01: Brand direction.
title('Riktning', 'Tydligt ansvar. Nästa steg i sikte.')
rect(0, 178, 960, 270, 'white')
rect(42, 203, 5, 213, 'accent')
logo(65, 204, .95, endorsed=True)
p('Samla arbetet.<br/>Få det gjort.', 65, 304, 510, 32, weight=700)
p('Uppdrag, kalkyl och uppföljning.', 67, 414, 510, 16, 'muted')
mascot(674, 171, 284)
for i, (key, label) in enumerate((('ink', 'Grafit'), ('accent', 'Gizmogul'), ('paper', 'Ljus arbetsyta'), ('gecko', 'Geckoturkos'))):
    x = 42 + i * 224
    rect(x, 471, 210, 37, key)
    text(label, x, 520, 13, weight=600)
    text(C[key], x, 544, 11, 'muted')
end()

# 02: Positioning, brand hierarchy and scope.
title('Positionering', 'En arbetsyta för ansvar och genomförande.',
      'För den som samordnar små åtgärder, flera entreprenörer och så småningom ett helt hus.')
text('Vem vi hjälper', 42, 183, 20, weight=700)
p('Primärt: byggledare, mindre entreprenörer och fastighetsansvariga som planerar, tar in priser och följer upp arbete.', 42, 222, 410)
p('Sekundärt: beställaren som ska välja och godkänna, samt underentreprenören som behöver ett tydligt underlag och en enkel svarsväg.', 42, 315, 410)
p('<b>Löftet:</b> Samlat underlag, tydligt ansvar och synliga nästa steg. Inte ännu en lista som måste hållas uppdaterad på flera ställen.', 42, 424, 410)
text('En tydlig varumärkesfamilj', 506, 183, 20, weight=700)
for y, head, body in (
    (225, 'HusHub', 'Avsändare och gemensam plattform.'),
    (306, 'Gizmo', 'Produktnamnet. I extern kommunikation: Gizmo från HusHub.'),
    (387, 'Uppdrag', 'Ett funktionsnamn i Gizmo, tillsammans med Åtgärder och Offertförfrågningar.'),
):
    text(head, 506, y, 20, weight=700)
    p(body, 506, y + 31, 404, 13)
rect(42, 539, 876, 43, 'selected')
p('Profilen täcker även önskad framtida riktning. Fakturering, leverantörspriser och automatiska kontakter får inte marknadsföras som klara innan de är verifierade i produkten.', 55, 546, 850, 11)
end()

# 03: Logo master and usage.
title('Logotyp', 'Gizmo först. HusHub som avsändare.',
      'Den förenklade geckoödlan ersätter G-symbolen. Manrope-ordmärket och avsändaren från HusHub behålls.')
logo(60, 190, 1.05, endorsed=True)
rect(500, 184, 418, 112, 'ink', 6)
logo(519, 207, .9, 'white', 'white')
text('Enfärgad', 42, 322, 12, 'muted', 600)
logo(52, 345, .75, 'ink', 'ink')
text('Symbol', 500, 322, 12, 'muted', 600)
symbol(506, 347, .85)
text('32 px min.', 575, 363, 12, 'muted')
symbol(662, 348, .5)
text('Förenklad, inte en 3D-miniatyr', 711, 360, 11, 'muted')
p('<b>Frizon:</b> minst en halv symbolbredd.<br/><b>Minsta bredd:</b> logotyp 160 px / 40 mm i tryck. Med avsändarrad minst 200 px. Symbol minst 32 px.', 42, 448, 416, 13)
p('<b>Använd inte:</b> skuggor, utsträckning, nya poser eller statusfärger i logotypen. Under 32 px används en separat provad appikon, inte en nedskalad 3D-figur.', 500, 448, 412, 13)
p('SVG-filerna har ordmärken som banor. Namnets och symbolens tillgänglighet är inte kontrollerad. Appens befintliga logotyp är oförändrad i denna leverans.', 42, 557, 874, 11, 'muted')
end()

# 04: Mascot identity and usage boundaries.
title('Karaktär', 'Samma ödla. En tydlig roll.',
      'Gizmo är produktens igenkännbara karaktär. Den ska göra produkten vänligare, inte ta över arbetsytan.')
mascot(73, 180, 361)
text('Behåll det som gör den till Gizmo', 421, 183, 20, weight=700)
p('Turkos kropp, ljus buk, stora mörka ögon, rundade tådynor, böjd svans och diskret fjällmönster. Vänlig och nyfiken, utan kläder eller robotdetaljer.', 421, 222, 488, 13)
text('Där karaktären får synas', 421, 318, 20, weight=700)
p('Introduktion, hjälp, välkomstvyer och utvald marknadsföring. Använd samma bild eller godkända varianter, med luft runt figuren.', 421, 356, 488, 13)
text('Där arbetet kommer först', 421, 437, 20, weight=700)
p('Ingen figur i varje tabellrad, kalkyl eller offert. Inga ständiga rörelser eller överlägg över kontroller. Status visas alltid med begriplig text.', 421, 475, 488, 13)
text('Illustration på vit bakgrund', 81, 550, 12, 'muted')
p('Återskapad från den valda referensen. Inte en riggad 3D-modell eller transparent friläggning. Eventuell animation följer faktisk status och respekterar minskad rörelse.', 421, 551, 488, 10, 'muted')
end()

# 05: Color and semantic status.
title('Färger', 'Lugn arbetsyta. Turkos igenkänning.',
      'Grafit för huvudhandlingar. Geckoturkos för identiteten. Gult är kvar som diskret urvals- och profilaccent.')
for i, (key, label) in enumerate((('ink', 'Grafit'), ('gecko', 'Geckoturkos'), ('accent', 'Gizmogul'), ('white', 'Vitt'), ('paper', 'Arbetsyta'), ('muted', 'Sekundär text'), ('link', 'Petrol'))):
    x = 42 + i * 127
    rect(x, 183, 114, 68, key, stroke='line' if key in ('white', 'paper') else None)
    text(label, x, 264, 11, weight=600)
    text(C[key], x, 286, 11, 'muted')
text('Grundregel', 42, 334, 20, weight=700)
p('Låt cirka 85 % vara vitt och neutralt. Turkos hör till ödlan och logotypen, inte till varje kontroll. Använd mörk petrol för läsbar länktext. Gult förblir en liten accent.', 42, 372, 410, 13)
p(f'Vit text på grafit: <b>{ratios["white/ink"]:.2f}:1</b>.<br/>Grafit på gult: <b>{ratios["ink/accent"]:.2f}:1</b>.<br/>Sekundär text på vitt: <b>{ratios["muted/white"]:.2f}:1</b>.', 42, 475, 410, 13)
text('Status är ett eget system', 500, 334, 20, weight=700)
for y, tone, label, desc in ((375, 'success', 'Klart', 'Utfört eller bekräftat'), (415, 'warning', 'Behöver kompletteras', 'Något kräver uppmärksamhet'), (455, 'error', 'Kunde inte sparas', 'Fel med en tydlig åtgärd'), (495, 'info', 'Väntar på svar', 'Pågående eller väntande')):
    badge(label, 500, y, tone)
    text(desc, 700, y + 4, 10, 'muted')
p('Vald rad: ljusgul yta + mörk markering. Varning: text + varningssymbol. Färg får aldrig vara den enda skillnaden.', 500, 541, 410, 11)
end()

# 06: Typography and control geometry.
title('Typografi & rytm', 'Samma familj som RenoApp. Tätare arbetsläge.',
      'Manrope 400, 600 och 700. Lokal font med Arial som reserv. Teckenavstånd 0.')
text('Badrum, övre plan', 42, 185, 34, weight=700)
text('Tre arbeten väntar på pris.', 42, 237, 22, 'muted')
p('Samla underlaget och granska förfrågan innan den skickas. Pris och omfattning ska vara lätta att jämföra.', 42, 293, 410, 16)
text('Å Ä Ö  /  å ä ö  /  12 450 kr', 42, 386, 23, weight=600)
p('Använd tabulära siffror i prislistor där fontstödet finns. Högerställ belopp. Skriv alltid om priset är exklusive eller inklusive moms.', 42, 438, 408, 13)
rows = [('Sidrubrik', '28 / 36', '24 / 32', '700'), ('Panelrubrik', '20 / 28', '20 / 28', '700'), ('Brödtext', '16 / 24', '16 / 24', '400'), ('Tabelltext', '14 / 20', '16 / 24', '400'), ('Knapptext', '14 / 20', '16 / 24', '600'), ('Metatext', '12 / 18', '14 / 20', '400')]
for x, value in ((505, 'Stil'), (644, 'Dator'), (755, 'Mobil'), (867, 'Vikt')):
    text(value, x, 188, 11, 'muted', 600)
for i, row in enumerate(rows):
    y = 229 + i * 39
    for x, value in zip((505, 644, 755, 867), row):
        text(value, x, y, 12)
    line(505, y + 28, 918, y + 28)
p('Storlek / radavstånd i px. Fasta storlekar vid brytpunkter, inte kontinuerlig skalning med fönsterbredden.', 505, 479, 411, 12, 'muted')
rect(42, 544, 876, 38, 'paper')
text('4/8 px grundrytm  ·  6 px hörnradie  ·  44 px kontroller  ·  56 px normal tabellrad', 57, 554, 12, weight=600)
end()

# 07: Vocabulary and copy.
title('Språk', 'Säg vad som händer. Inte hur systemet tänker.',
      'Saklig, hjälpsam och kort. Ingen myndighetston, inga stora tekniklöften och inga skämt om användaren.')
text('Vi skriver', 42, 184, 20, weight=700)
text('Vi undviker', 505, 184, 20, weight=700)
examples = [
    ('Granska förfrågan', 'Begär offert för valda', 'När nästa steg är en förhandsgranskning, inte ett utskick.'),
    ('Skicka förfrågan till Bygglaget', 'Kör / Verkställ', 'Mottagare och konsekvens ska vara tydliga före utskick.'),
    ('Sparat 14:13', 'Klart!', 'Skilj sparat, skickat, mottaget och accepterat åt.'),
    ('AI-förslag: 12 timmar', 'AI:n har räknat ut rätt pris', 'Gizmo är produkten. AI-förslag ska inte se ut som kontrollerade fakta.'),
]
for i, (yes, no, note) in enumerate(examples):
    y = 224 + i * 75
    text(yes, 42, y, 15, 'link', 600)
    text(no, 505, y, 15, 'muted')
    text(note, 42, y + 29, 11, 'muted')
    line(42, y + 60, 918, y + 60)
p('<b>Begrepp:</b> Uppdrag = helheten. Arbete = det som ska utföras. Arbetsdel = en del med egen utförare. Förfrågan = underlaget vi skickar. Offert = priset vi får tillbaka.', 42, 544, 867, 12)
end()

# 08: Assistant, authority and system status.
title('AI & förtroende', 'Karaktär, inte kvalitetsstämpel.',
      'Gizmo är produkten och dess maskot. AI-handlingar heter exempelvis Föreslå kalkyl med AI och Granska förslag.')
text('Ett användbart AI-förslag', 42, 185, 20, weight=700)
rect(42, 226, 416, 211, 'paper', 6, 'line')
text('AI-förslag att granska', 59, 241, 12, 'muted', 600)
text('Snickeri och målning som två arbeten', 59, 272, 16, weight=700)
p('Det gör det möjligt att ta in pris från två utförare och ändå följa samma innervägg.', 59, 306, 380, 13)
button('Använd förslaget', 59, 374, 180, h=39)
text('Avstå', 267, 385, 13, 'link', 600)
p('Fiktivt exempel. Ödlan innebär inte att ett pris är kontrollerat. Förslag visar antaganden och källa. Ett accepterat AI-förslag är inte en skickad beställning.', 42, 458, 416, 12)
text('Systemets språk måste vara sant', 505, 185, 20, weight=700)
states = [
    ('Arbetar', 'Förbereder kalkylförslag. Ingen procentsats utan verkligt mätbara framsteg.'),
    ('Källa saknas', 'Prisförslag, ej verifierat. Ange inte leverantörspris utan faktisk källa och tidpunkt.'),
    ('Fel', 'Kunde inte skapa förslaget. Försök igen. Visa inte interna nycklar, saldon eller tekniska fel.'),
    ('Offline', 'Sparat lokalt används bara om uppgifterna verkligen är beständigt lagrade på enheten.'),
]
for i, (head, body) in enumerate(states):
    y = 228 + i * 84
    text(head, 505, y, 14, weight=700)
    p(body, 505, y + 25, 409, 12)
p('Kort bekräftelse: befintlig toast uppe till höger. Fel som blockerar ett arbetsmoment måste dessutom gå att hitta igen där problemet ska åtgärdas.', 42, 542, 415, 11)
end()

# 09: Desktop visual application, deliberately not a full app implementation.
title('Dator', 'Överblick först. Detaljer när de behövs.',
      'Illustrerad konceptvy med fiktiva data. Samma arbetsflöde som offertprototypen, med den föreslagna identiteten.')
rect(42, 181, 876, 358, 'white', 6, 'line')
rect(43, 182, 145, 356, 'paper', 6)
logo(54, 196, .39)
for y, label, active in ((254, 'Arbeten', False), (296, 'Offertöversikt', True), (338, 'Uppföljning', False)):
    if active:
        rect(51, y - 6, 130, 33, 'selected', 4)
        rect(51, y - 6, 3, 33, 'ink')
    text(label, 63, y, 11, weight=600 if active else 400)
text('Exempelprojekt / Husrenovering', 212, 200, 10, 'muted')
text('Offertöversikt', 212, 222, 22, weight=700)
text('4 arbeten · 1 behöver kompletteras', 212, 256, 11, 'muted')
line(212, 289, 896, 289)
text('ARBETE', 222, 301, 9, 'muted', 600)
text('UTFÖRARE', 512, 301, 9, 'muted', 600)
text('STATUS', 697, 301, 9, 'muted', 600)
table = [('Justera täcklist', 'Bygglaget', 'Redo att granskas', 'success'), ('Bygga innervägg', 'Bygglaget', 'Redo att granskas', 'success'), ('Måla innervägg', 'Målarfirman', 'Mottagare saknas', 'warning'), ('Tätskikt och kakel', 'Badrumsfirman', 'Utkast', 'info')]
for i, (work, firm, status, tone) in enumerate(table):
    y = 332 + i * 43
    if i == 1:
        rect(212, y - 8, 684, 42, 'selected')
        rect(212, y - 8, 3, 42, 'ink')
    text(work, 222, y, 11, weight=600)
    text(firm, 512, y, 11)
    badge(status, 696, y - 3, tone)
    line(212, y + 34, 896, y + 34)
p('Kompakta listor, bibehållen radmarkering och sidopanel för redigering. En tydlig huvudhandling per aktuell kontext. Undvik stora hjälprutor och dekorativa kort i arbetsytan.', 42, 551, 876, 12)
end()

# 10: Mobile visual application and accessibility intent.
title('Mobil', 'Dokumentera snabbt. Ta besluten med överblick.',
      'Samma identitet, olika arbetssituationer. Datorn prioriteras för kalkyl och förfrågningar.')
rect(42, 179, 323, 399, 'white', 8, 'line')
logo(58, 192, .42)
text('Exempelprojekt', 64, 245, 11, 'muted')
text('Ny notering', 64, 269, 22, weight=700)
text('Plats', 64, 308, 11, weight=600)
rect(64, 328, 279, 40, 'white', 6, 'control')
text('Källare', 77, 339, 13)
text('Anteckning', 64, 382, 11, weight=600)
rect(64, 402, 279, 64, 'white', 6, 'control')
p('Täcklisten behöver fästas längs väggen.', 77, 413, 250, 13)
button('Ta foto', 64, 481, 131, 39, False)
button('Spela in', 207, 481, 136, 39, False)
button('Spara notering', 64, 532, 279, 33, True, 12)
text('På plats', 418, 186, 21, weight=700)
p('Fotografera, diktera, komplettera och kontrollera status. Kamera och mikrofon ska vara lätta att hitta. Inga dubbla funktioner som gör samma sak.', 418, 226, 489, 14)
text('På kontoret', 418, 330, 21, weight=700)
p('Fördela arbeten, jämför priser och granska exakt vad som skickas till varje mottagare. Tabeller och masshantering hör hemma här.', 418, 370, 489, 14)
p('<b>Interaktionsmål:</b> minst 44 × 44 px klickytor, synligt tangentbordsfokus och text som tål förstoring. Nederkantsknappar provas med öppet tangentbord och mobilens säkra yta.', 418, 470, 489, 13)
p('Vyn är en layoutillustration i reducerad skala. Ingen ny mobilfunktion eller offlinegaranti ingår i profilen.', 418, 558, 489, 10, 'muted')
end()

# 11: External recipient and brand boundaries.
title('Mejl & dokument', 'Mottagaren ska förstå ärendet, inte vårt system.',
      'Den som begär pris är avsändare. Gizmo är verktyget från HusHub, inte entreprenör eller avtalspart.')
rect(42, 182, 448, 369, 'white', 6, 'line')
rect(43, 183, 446, 5, 'accent')
text('EXEMPEL BYGG AB', 64, 207, 12, weight=700)
text('Offertförfrågan', 64, 244, 25, weight=700)
text('Innervägg och målning', 64, 284, 16, weight=600)
p('Hej!<br/><br/>Vi önskar ert totalpris för de valda arbetena. Omfattning och utvalda bilagor finns i förfrågan.', 64, 326, 402, 13)
button('Öppna förfrågan', 64, 440, 210)
text('Skickat via Gizmo från HusHub', 64, 510, 10, 'muted')
text('Tydlig avsändare', 532, 184, 20, weight=700)
p('Företag, kontaktperson, projekt, omfattning, svarstid och nästa handling. Håll tekniska systemnamn och interna processer utanför.', 532, 224, 377, 13)
text('Samma grafiska familj', 532, 328, 20, weight=700)
p('Vit bakgrund, grafitrubriker och en liten gul accent. Ingen stor maskot i offerter. PDF:er ska fungera även i svartvitt. Låt avsändarens identitet få utrymme.', 532, 368, 377, 13)
text('Rätt underlag till rätt mottagare', 532, 474, 17, weight=700)
p('Visa exakt vilka bilder och dokument som delas. Intern kostnad, marginal och andra mottagares offerter ska inte följa med.', 532, 509, 377, 12)
p('Fiktivt mejlexempel. Knappen är en illustration, inte ett aktivt utskick eller löfte om en viss leveransfunktion.', 42, 568, 876, 10, 'muted')
end()

# 12: Marketing and imagery.
title('Bildspråk & budskap', 'Visa arbetet. Låt produkten bevisa nyttan.',
      'Marknadsför överblick och kontroll. Inte mängden AI, funktioner eller automatisering.')
rect(42, 184, 423, 360, 'white', 6, 'line')
logo(61, 201, .55, endorsed=True)
p('Samla arbetet.<br/>Få det gjort.', 67, 288, 370, 30, weight=700)
p('Underlag, ansvar och uppföljning.<br/>På samma plats.', 67, 391, 211, 14)
mascot(300, 370, 161)
rect(67, 475, 34, 5, 'accent')
text('Gizmo från HusHub', 67, 502, 12, weight=600)
text('Välj bilder som visar något', 507, 183, 20, weight=700)
p('Riktiga arbetsmoment och tydliga före-/efterbilder från samma plats. Apputsnitt med fiktiva data som visar ett beslut eller nästa steg. Använd material ni får publicera.', 507, 223, 403, 13)
text('Håll gränssnittet sakligt', 507, 347, 20, weight=700)
p('Lucide-ikoner med gemensam linjetjocklek. Bilder förhandsvisas när de ska väljas. Verktygsikoner får hjälptext, men inte egna logotypfärger.', 507, 387, 403, 13)
p('<b>Undvik:</b> nya ödlor i varje kampanj, glödande AI-effekter, påhittade kundomdömen, täta collage och färger som byter betydelse mellan vyer.', 507, 496, 403, 12)
text('Exempel på socialt inlägg. Inga pris- eller funktionslöften.', 42, 562, 10, 'muted')
end()

# 13: Deliverables and implementation gates.
title('Leverans & införande', 'Ödlan tillbaka. Arbetsflödet består.',
      'Version 2.1 ersätter G-symbolen med geckon. Manrope, grafit, gult och de etablerade gränssnittsprinciperna består.')
text('Profilpaketet innehåller', 42, 184, 20, weight=700)
p('• Varumärkesprofil i 13 sidor.<br/>• Fyra logotypvarianter och ödlesymbol i SVG.<br/>• Geckoillustration på vit bakgrund i PNG.<br/>• Originalreferens och dokumenterad bildbearbetning.<br/>• Manrope-font med SIL OFL-licens.<br/>• Färger, CSS-variabler och gränssnittsexempel.', 42, 225, 425, 13)
text('Inför namnet utan att bryta flödet', 505, 184, 19, weight=700)
p('1. Kontrollera namn- och symboltillgänglighet.<br/>2. Visa Gizmo i modulval, logotyp och sidtitlar.<br/>3. Behåll Uppdrag som arbetsvy och funktionsnamn.<br/>4. Uppdatera mottagarvyer, mejl och dokument.<br/>5. Testa länkar, fokus, kontrast och alla statuslägen.', 505, 225, 410, 13)
p('Behåll befintliga URL:er, tabeller och API:er. Namnbytet kräver inte nya tekniska adresser. Gemensam HusHub-navigation och andra moduler ändras separat.', 505, 365, 410, 12)
text('Underlag och källor', 42, 414, 18, weight=700)
p('Vald geckoreferens från chatten Skapade applogotyperna. Tidigare namn Orbit används inte längre. Gizmo-profil 2.0 och RenoApp-profil 1.0. Vyerna är illustrationer, inte appskärmbilder.', 42, 448, 425, 11, 'muted')
links = [
    ('Manrope / licens ingår i paketet', 'https://fonts.google.com/specimen/Manrope'),
    ('W3C: textkontrast', 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html'),
    ('W3C: minsta pekmål', 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html'),
]
for i, (label, url) in enumerate(links):
    y = 434 + i * 28
    text(label, 505, y, 11, 'link')
    c.linkURL(url, (505, H - y - 17, 914, H - y), relative=0)
p('Färgparen uppfyller 4,5:1 för normal text. 44 px är profilens klickytemål; WCAG 2.2 AA har 24 px som grundregel med undantag. Detta certifierar inte den färdiga appen.', 505, 525, 410, 10, 'muted')
rect(42, 547, 425, 37, 'selected')
p('Endast profil och tillgångar uppdateras. Appen ändras inte. Tidigare PDF- och ZIP-versioner sparas som historik.', 54, 554, 399, 10)
end()

c.save()
reader = PdfReader(PDF)
assert len(reader.pages) == 13
for index, page in enumerate(reader.pages):
    assert len(page.extract_text()) > 150, (index, 'empty page')
with zipfile.ZipFile(OUT / 'Gizmo-profilpaket-v2-1.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.write(PDF, PDF.name)
    archive.write(OUT / 'README.md', 'README.md')
    for file in sorted(ASSETS.rglob('*')):
        if file.is_file():
            archive.write(file, file.relative_to(OUT))
print(json.dumps({'pdf': str(PDF), 'pages': len(reader.pages), 'contrast': ratios}, ensure_ascii=False))
