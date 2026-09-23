from functools import lru_cache
from io import BytesIO
from pathlib import Path
import json
import hashlib
import shutil
import zipfile

from fontTools.ttLib import TTFont as FontFile
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image
from pypdf import PdfReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
ASSETS = OUT / 'assets'
FONTS = ASSETS / 'fonts'
FONTS.mkdir(parents=True, exist_ok=True)
PRODUCT = 'BesiktApp / Överlåtelsebesiktning'
STEM = 'BesiktApp-OB'
VERSION = '1.2'
PAGE_COUNT = 17
PROFILE_SPEC = ROOT / 'docs/OB_BRAND_PROFILE.md'
EXAMPLES = ASSETS / 'examples'
for name in ('desktop-v1.2.png', 'mobile-v1.2.png'):
    assert (EXAMPLES / name).is_file(), f'Missing approved design reference: {name}'
(EXAMPLES / 'provenance.json').write_text(json.dumps({
    'profileVersion': VERSION,
    'designDirectionApprovedAt': '2026-09-23',
    'kind': 'AI-generated visual references, not implemented application screenshots',
    'tool': 'Built-in image generation',
    'data': 'Fictional records',
    'modifiedAfterGeneration': False,
    'specification': 'docs/OB_BRAND_PROFILE.md',
    'files': {name: hashlib.sha256((EXAMPLES / name).read_bytes()).hexdigest()
              for name in ('desktop-v1.2.png', 'mobile-v1.2.png')},
}, indent=2), encoding='utf8')
LOGO_SOURCE = ROOT / 'public/report-assets/BesiktApp.png'
LOGO = ASSETS / 'logo/BesiktApp.png'
LOGO.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(LOGO_SOURCE, LOGO)
(LOGO.parent / 'provenance.json').write_text(json.dumps({
    'source': 'public/report-assets/BesiktApp.png',
    'sha256': hashlib.sha256(LOGO.read_bytes()).hexdigest(),
    'modified': False,
    'usage': 'Existing BesiktApp product logo. OB is a separate module label, not part of the wordmark.',
}, indent=2), encoding='utf8')
SOURCE_FONTS = OUT.parent / 'renoapp-brand/assets/fonts'
for name in ('Manrope-variable.ttf', 'OFL.txt'):
    shutil.copy2(SOURCE_FONTS / name, FONTS / name)
for weight in (400, 600, 700):
    target = FONTS / f'Manrope-{weight}.ttf'
    font = instantiateVariableFont(FontFile(FONTS / 'Manrope-variable.ttf'), {'wght': weight}, inplace=False)
    for platform, encoding, language in ((3, 1, 1033), (1, 0, 0)):
        for name_id, value in ((1, f'Manrope {weight}'), (2, 'Regular'), (3, f'ManropeStatic-{weight}'),
                               (4, f'Manrope {weight}'), (6, f'ManropeStatic-{weight}')):
            font['name'].setName(value, name_id, platform, encoding, language)
    font.save(target)
    pdfmetrics.registerFont(TTFont(f'M{weight}', str(target)))
pdfmetrics.registerFontFamily('M400', normal='M400', bold='M700', italic='M400', boldItalic='M700')

C = {
    'primary': '#245EB5', 'hover': '#1D4890', 'selected': '#EDF3FC',
    'ink': '#25313B', 'muted': '#596571', 'white': '#FFFFFF', 'paper': '#F4F6F8',
    'line': '#D4DCE4', 'control': '#78838F',
    'link': '#245EB5', 'focus': '#245EB5',
    'success': '#276144', 'success-bg': '#EAF4EC',
    'warning': '#81551A', 'warning-bg': '#FFF2DA',
    'error': '#A23140', 'error-bg': '#FCEEF0',
    'info': '#265C7B', 'info-bg': '#EAF2F8',
}


def luminance(value):
    values = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    values = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values]
    return sum(a * b for a, b in zip(values, (.2126, .7152, .0722)))


def ratio(a, b):
    lo, hi = sorted((luminance(C[a]), luminance(C[b])))
    return (hi + .05) / (lo + .05)


PAIRS = [('white', 'primary'), ('white', 'hover'), ('ink', 'white'), ('ink', 'paper'),
         ('muted', 'white'), ('muted', 'paper'), ('primary', 'selected'),
         ('link', 'white'), ('success', 'success-bg'), ('warning', 'warning-bg'),
         ('error', 'error-bg'), ('info', 'info-bg')]
assert all(ratio(a, b) >= 4.5 for a, b in PAIRS)
assert all(ratio(a, b) >= 3 for a, b in [('control', 'white'), ('focus', 'white'), ('focus', 'paper')])
RATIOS = {f'{a}/{b}': round(ratio(a, b), 2) for a, b in PAIRS}
(ASSETS / 'colors.json').write_text(json.dumps({'profileVersion': VERSION,
    'designDirection': 'approved', 'newListImplemented': False,
    'colors': C, 'textContrastRatios': RATIOS, 'controlContrast': round(ratio('control', 'white'), 2)}, indent=2), encoding='utf8')
(ASSETS / 'tokens.css').write_text('/* OB profile 1.2. Design tokens only; this file does not apply them to the app. */\n.ob-brand {\n'
    + ''.join(f'  --ob-brand-{key}: {value};\n' for key, value in C.items())
    + '  --ob-brand-font: "Manrope", Arial, sans-serif;\n  --ob-brand-radius: 6px;\n'
    + '  --ob-brand-space-unit: 4px;\n  --ob-brand-control-height: 48px;\n'
    + '  --ob-brand-body-size: 16px;\n  --ob-brand-body-line-height: 24px;\n'
    + '  --ob-brand-overview-title-size: 26px;\n  --ob-brand-overview-title-line-height: 34px;\n'
    + '  --ob-brand-mobile-title-size: 22px;\n  --ob-brand-mobile-title-line-height: 30px;\n'
    + '  --ob-brand-list-size: 16px;\n  --ob-brand-list-line-height: 24px;\n'
    + '  --ob-brand-list-meta-size: 14px;\n  --ob-brand-list-meta-line-height: 20px;\n'
    + '  --ob-brand-list-marker-width: 3px;\n  --ob-brand-list-divider-width: 1px;\n'
    + '  --ob-brand-heading-weight: 600;\n  --ob-brand-control-min-height: 44px;\n'
    + '  --ob-brand-focus-width: 3px;\n  --ob-brand-focus-offset: 2px;\n}\n', encoding='utf8')


W, H = 960, 640
PDF = OUT / f'{STEM}-varumarkesprofil-v{VERSION}.pdf'
c = canvas.Canvas(str(PDF), pagesize=(W, H))
c.setTitle(f'{PRODUCT} | Varumärkesprofil | Version {VERSION}')
c.setAuthor('HusHub')
c.setSubject('Beslutad visuell riktning för ÖB. RenoApp-baserade listor; ingen appimplementation i denna leverans.')
PAGE = 0


def color(value):
    return HexColor(C.get(value, value))


def rect(x, y, w, h, fill='white', radius=0, stroke=None):
    c.setFillColor(color(fill)); c.setStrokeColor(color(stroke or fill)); c.setLineWidth(.8)
    c.roundRect(x, H - y - h, w, h, radius, fill=1, stroke=int(stroke is not None))


def line(x, y, x2, y2, fill='line', width=.8):
    c.setStrokeColor(color(fill)); c.setLineWidth(width); c.setLineCap(0)
    c.line(x, H - y, x2, H - y2)


def text(s, x, y, size=14, fill='ink', weight=400, maxw=None):
    width = pdfmetrics.stringWidth(s, f'M{weight}', size)
    assert x >= 0 and x + width <= W - 22, (PAGE, s, x + width)
    assert y + size < 638, (PAGE, s, y)
    if maxw is not None:
        assert width <= maxw, (PAGE, s, width, maxw)
    c.setFont(f'M{weight}', size); c.setFillColor(color(fill))
    c.drawString(x, H - y - size, s)


def p(s, x, y, w=410, size=14, fill='ink', weight=400, limit=589, leading=None):
    style = ParagraphStyle('body', fontName=f'M{weight}', fontSize=size, leading=leading or size * 1.45,
                           textColor=color(fill), spaceAfter=0)
    paragraph = Paragraph(s, style)
    _, height = paragraph.wrap(w, H)
    assert x + w <= W - 22 and y + height <= limit, (PAGE, s[:65], y, height, limit)
    paragraph.drawOn(c, x, H - y - height)
    return y + height


def title(kicker, headline, sub=None):
    global PAGE
    PAGE += 1
    rect(0, 0, W, H)
    text('BesiktApp / ÖB', 42, 23, 15, weight=700)
    text(kicker.upper(), 666, 26, 10, 'muted', 600, maxw=252)
    line(42, 56, 918, 56)
    text(headline, 42, 78, 31, weight=700, maxw=876)
    if sub:
        p(sub, 42, 128, 866, 13, 'muted', limit=174)


def end():
    line(42, 603, 918, 603)
    text(f'VARUMÄRKESPROFIL {VERSION}  /  BESLUTAD DESIGNRIKTNING  /  23 SEPTEMBER 2026', 42, 615, 8, 'muted')
    text(f'{PAGE:02}', 894, 613, 10, 'muted')
    c.showPage()


def svg(raw, x, y, width):
    drawing = svg2rlg(BytesIO(raw.encode('utf8')))
    factor = width / drawing.width
    height = drawing.height * factor
    drawing.scale(factor, factor)
    renderPDF.draw(drawing, c, x, H - y - height)


def logo(x, y, width=365):
    with Image.open(LOGO) as source:
        height = width * source.height / source.width
    c.drawImage(str(LOGO), x, H - y - height, width=width, height=height, mask='auto')


def reference_image(name, x, y, max_width, max_height):
    path = EXAMPLES / name
    with Image.open(path) as source:
        factor = min(max_width / source.width, max_height / source.height)
        width, height = source.width * factor, source.height * factor
    c.drawImage(str(path), x, H - y - height, width=width, height=height, mask='auto')


@lru_cache
def icon_source(name):
    return (ASSETS / 'icons' / f'{name}.svg').read_text(encoding='utf8')


def icon(name, x, y, size=22, fill='ink'):
    svg(icon_source(name).replace('#25312D', C.get(fill, fill)), x, y, size)


def button(label, x, y, w=190, h=48, primary=True, size=13, glyph=None):
    rect(x, y, w, h, 'primary' if primary else 'white', 6, None if primary else 'control')
    tw = pdfmetrics.stringWidth(label, 'M600', size)
    total = tw + (26 if glyph else 0)
    assert total < w - 16, (PAGE, label, total, w)
    start = x + (w - total) / 2
    if glyph:
        icon(glyph, start, y + (h - 18) / 2, 18, 'white' if primary else 'ink')
        start += 26
    text(label, start, y + (h - size) / 2 - 2, size, 'white' if primary else 'ink', 600)


def badge(label, x, y, tone='info', glyph=None):
    tw = pdfmetrics.stringWidth(label, 'M600', 10)
    w = tw + (38 if glyph else 18)
    rect(x, y, w, 24, f'{tone}-bg', 3)
    if glyph:
        icon(glyph, x + 7, y + 5, 14, tone)
    text(label, x + (27 if glyph else 9), y + 5, 10, tone, 600)
    return w


# 01: Direction and family resemblance.
title('Riktning', 'BesiktApp. En tydlig blå profil för ÖB.',
      'RenoApps lugna listformspråk möter ÖB:s blå identitet. BesiktApp och den befintliga logotypen behålls.')
line(42, 182, 918, 182)
line(42, 448, 918, 448)
logo(50, 236, 359)
text('Överlåtelsebesiktning', 53, 360, 20, 'primary', 600)
p('Se tydligt.<br/>Dokumentera rätt.', 530, 211, 384, 33, weight=700)
p('Iakttagelse, bild och plats.<br/>Ett sammanhängande underlag.', 533, 320, 371, 16, 'muted')
button('Öppna ÖB-runda', 533, 387, 223)
for i, (key, label) in enumerate((('primary', 'ÖB-blå'), ('ink', 'Grafit'), ('paper', 'Ljus arbetsyta'), ('white', 'Vita innehållsytor'))):
    x = 42 + i * 224
    rect(x, 475, 210, 34, key, stroke='line' if key in ('paper', 'white') else None)
    text(label, x, 521, 13, weight=600); text(C[key], x, 546, 11, 'muted')
end()

# 02: Name hierarchy, audience and limits.
title('Positionering', 'Verktyget stödjer. Besiktningsmannen bedömer.',
      'Saklig dokumentation, tydlig plats och läsbara utlåtanden. Inga löften om ett felfritt hus.')
text('För vem?', 42, 187, 21, weight=700)
p('Primärt för besiktningsmannen som behöver arbeta snabbt på mobilen och granska sammanhanget på datorn.', 42, 230)
p('Mottagaren är kunden som behöver förstå iakttagelser, risker, begränsningar och eventuell fortsatt teknisk utredning.', 42, 323)
p('<b>Löftet:</b> Rätt underlag på rätt plats, från besök till utlåtande. Tydlighet utan att tona ned osäkerhet.', 42, 426)
text('Namn som håller ihop', 510, 187, 21, weight=700)
for y, head, body in ((231, 'HusHub', 'Gemensam plattform och avsändare för produktfamiljen.'),
                      (317, 'BesiktApp', 'Produkten för besiktningar. Samma namn och logotyp för ÖB, TU och EB.'),
                      (403, 'ÖB / Överlåtelsebesiktning', 'Modulnamn i text, separat från logotypen. ÖB-runda är arbetsvyn.')):
    text(head, 510, y, 17, weight=700); p(body, 510, y + 30, 406, 13)
rect(42, 538, 876, 45, 'selected')
p('Denna profil gäller ÖB. TU och EB kan senare följa samma grundstruktur, men deras namn, bedömningar, rapporter och behörigheter ändras inte här.', 55, 548, 850, 11)
end()

# 03: Preserve the product's actual logo, not a newly drawn module identity.
title('Logotyp & modulnamn', 'Behåll BesiktApp. Låt ÖB vara modulen.',
      'Den befintliga logotypen återanvänds oförändrad. Förslaget till en ny hussymbol i version 1.0 utgår.')
logo(52, 207, 371)
text('BEFINTLIG PRODUKTLOGOTYP', 55, 344, 10, 'muted', 600)
text('Modulnamnet är vanlig text', 510, 192, 20, weight=700)
text('Överlåtelsebesiktning', 510, 236, 25, 'primary', 700)
p('Skriv ut namnet vid ingången till modulen. Använd ÖB i kompakta sammanhang och ÖB-runda för arbetsvyn. Sätt inte ihop ÖB med ordmärket till en ny logotyp.', 510, 291, 406, 13)
line(42, 401, 918, 401)
p('<b>Placering:</b> på vit eller ljus, lugn yta. Bevara originalets proportioner och färger. Rekommenderad frizon: minst 25 % av logotypens höjd.', 42, 426, 414, 13)
p('<b>Trånga ytor:</b> låt modul- och sidrubrik ta plats inne i arbetsflödet. Upprepa inte produktlogotypen i varje rum eller dialog.', 510, 426, 406, 13)
p('Original: public/report-assets/BesiktApp.png (1 096 × 311 px). Ingen ny vit variant, omfärgning eller fristående symbol ingår. Större tryck kräver ett verifierat original i lämpligt format.', 42, 523, 876, 11, 'muted')
end()

# 04: Color roles and checked contrast.
title('Färger', 'ÖB förblir blått. Färg ersätter inte text.',
      'Dagens ÖB-blå behålls. Övrig färg förklarar innehåll och status; logotypens originalfärger är undantagna.')
for i, (key, label) in enumerate((('primary', 'Primär handling'), ('selected', 'Vald yta'), ('ink', 'Text'), ('muted', 'Sekundär text'), ('paper', 'Arbetsyta'), ('control', 'Kontur & fält'))):
    x = 42 + i * 147
    rect(x, 184, 135, 63, key)
    text(label, x, 259, 11, weight=600); text(C[key], x, 282, 11, 'muted')
text('Kontrast i vardagsläget', 42, 330, 20, weight=700)
p(f'Vit text på ÖB-blått: <b>{RATIOS["white/primary"]:.2f}:1</b>.<br/>Grafit på vitt: <b>{RATIOS["ink/white"]:.2f}:1</b>.<br/>Sekundär text på vitt: <b>{RATIOS["muted/white"]:.2f}:1</b>.', 42, 370, 410)
p('Ingen ljusgrå text på vit bakgrund för rumsnamn. Undvik sänkt opacitet på hela rader. Inaktiva knappar ska fortfarande gå att läsa.', 42, 472, 408, 13)
text('Skilj status från innehåll', 510, 330, 20, weight=700)
for y, tone, label, desc, glyph in ((375, 'success', 'Sparad', 'Teknisk sparstatus', 'Check'),
        (414, 'warning', 'Risk', 'Besiktningsinnehåll', 'TriangleAlert'),
        (453, 'info', 'Utredning', 'Fortsatt teknisk utredning', 'Search'),
        (492, 'error', 'Kunde inte sparas', 'Fel som kräver åtgärd', 'TriangleAlert')):
    badge(label, 510, y, tone, glyph); text(desc, 705, y + 5, 11, 'muted')
p('I uppdragslistan är statustexten neutral; färg får komplettera vid vänsterkanten. Risk, Utredning och sparstatus i arbetsvyn behåller sina egna märkningar.', 510, 543, 407, 11)
end()

# 05: Type, spacing, touch and field constraints.
title('Typografi & rytm', 'Läsbart på plats. Precist på kontoret.',
      'Manrope med lokal fontfil och teckenavstånd 0. Normal text 400, viktig information 600, vikt 700 sparsamt.')
text('Huvudbyggnad', 42, 186, 34, weight=700)
text('Entréplan · Badrum', 42, 241, 21, 'muted')
p('En iakttagelse ska gå att läsa utan att öppna fler rutor. Platsen ska alltid gå att identifiera.', 42, 297, 416, 16)
text('Å Ä Ö  /  å ä ö  /  Plan -1 / 0 / 1', 42, 389, 21, weight=600)
p('Långa byggnads- och rumsnamn får radbrytas. Förkorta inte betydelsebärande text till enbart tre punkter. Befintliga planbenämningar behålls.', 42, 441, 416, 13)
for x, value in ((510, 'Stil'), (650, 'Dator'), (752, 'Mobil'), (863, 'Vikt')):
    text(value, x, 189, 11, 'muted', 600)
for i, row in enumerate((('Översiktsrubrik', '26 / 34', '22 / 30', '600'), ('Rum / dialog', '22 / 30', '22 / 30', '700'),
                       ('Brödtext', '16 / 24', '16 / 24', '400'), ('Knapptext', '14 / 20', '16 / 24', '600'),
                       ('Metatext', '14 / 20', '14 / 20', '400'))):
    y = 232 + i * 43
    for x, value in zip((510, 650, 752, 863), row): text(value, x, y, 12)
    line(510, y + 29, 918, y + 29)
p('Storlek / radavstånd i px. Fasta storlekar vid brytpunkter. Mobilens textfält börjar vid 16 px. Förstoring och tangentbord provas separat.', 510, 478, 404, 12, 'muted')
rect(42, 550, 876, 33, 'paper')
text('4/8 px rytm  ·  6 px hörn  ·  48 px klickytor som mål  ·  tydligt fokus  ·  ingen färg som ensam signal', 54, 558, 11, weight=600)
end()

# 06: Vocabulary and truthful system messages.
title('Språk', 'Skilj iakttagelse, bedömning och nästa steg.',
      'Kort, sakligt och respektfullt. Noteringsförslag är stöd för besiktningsmannen, inte automatiska slutsatser.')
text('Skriv så här', 42, 184, 20, weight=700); text('Undvik', 510, 184, 20, weight=700)
for i, (yes, no, why) in enumerate((
    ('Synlig spricka noterades i fasaden.', 'Huset är skadat.', 'Beskriv det som har iakttagits. Dra inte större slutsatser än underlaget medger.'),
    ('Ej åtkomligt vid besiktningen.', 'Inget att notera.', 'Otillgängligt är inte samma sak som undersökt utan noterad avvikelse.'),
    ('Ta bort från noteringen', 'Radera bild', 'Skilj mellan att koppla loss en bild och att radera den från besiktningen.'),
    ('Sparad / Sparat lokalt / Kunde inte sparas', 'Klart!', 'Klart kan vara en knapp, men är inte en sparbekräftelse. Visa bara bekräftad sparstatus.'),
)):
    y = 228 + i * 76
    text(yes, 42, y, 14, 'primary', 600, maxw=445); text(no, 510, y, 14, 'muted')
    text(why, 42, y + 29, 11, 'muted', maxw=876); line(42, y + 61, 918, y + 61)
p('<b>Begrepp:</b> Fastighet = sammanhanget. Byggnad = huset eller komplementbyggnaden. Besiktning = det aktuella uppdraget. Plats = rum eller utvändig byggnadsdel. Notering = dokumenterad iakttagelse och bedömning.', 42, 548, 875, 11)
end()

# 07: Desktop workspace and multi-building hierarchy.
title('Dator & byggnader', 'Samma fastighet. Tydlig byggnad i varje vy.',
      'Fyra byggnader och långa namn. Fiktivt innehåll visar hur grupperingen håller även när mängden ökar.')
rect(42, 181, 876, 391, 'white', 6, 'line'); line(290, 182, 290, 571)
logo(57, 192, 132)
text('Överlåtelsebesiktning', 58, 236, 11, 'primary', 600)
text('Fastighet & uppdrag', 58, 263, 10)
text('Handlingar & upplysningar', 58, 282, 10)
for i, label in enumerate(('HUVUDBYGGNAD', 'GÄSTHUS MED UTHYRNINGSDEL', 'GARAGE OCH VERKSTAD', 'VÄXTHUS OCH FÖRRÅD')):
    y = 309 + i * 54
    text(label, 58, y, 8, 'muted', 600, maxw=220)
    text('Förutsättningar', 68, y + 16, 10)
    if i == 1:
        rect(52, y + 30, 228, 21, 'selected', 3); rect(52, y + 30, 3, 21, 'primary')
    text('ÖB-runda', 68, y + 33, 10, 'primary' if i == 1 else 'ink', 600 if i == 1 else 400)
text('Granska', 58, 535, 10); text('Skicka utlåtande', 58, 552, 10)
text('Exempelgatan 12 / Gästhus med uthyrningsdel', 312, 201, 11, 'muted')
text('Noteringar', 312, 228, 24, weight=700)
rect(312, 271, 582, 39, 'white', 6, 'control'); icon('Search', 324, 281, 18)
text('Sök bland dina noteringar', 353, 282, 12, 'muted')
for y, place, note, tone, label in (
    (332, 'Entréplan · Badrum och tvättutrymme vid groventré',
     'Rörgenomföring noterades i golvet intill duschplatsen. Tätskiktets anslutning kunde inte bedömas okulärt.', 'warning', 'Risk'),
    (444, 'Utsida · Fasad mot gemensam innergård',
     'Öppning noterades vid anslutningen mellan tillbyggnad och befintlig fasad. Detaljen behöver utredas.', 'info', 'Utredning')):
    p(place, 324, y, 547, 10, 'muted', limit=y + 34)
    p(note, 324, y + 25, 436, 12, weight=600, limit=y + 89)
    badge(label, 797, y + 27, tone); line(312, y + 99, 894, y + 99)
text('Aktiv byggnad visas både i menyn och i innehållet. Namn och noteringar får radbrytas, inte döljas.', 42, 580, 10, 'muted')
end()

# 08: Field workflow, same room and note patterns.
title('Mobil & ÖB-runda', 'En tydlig väg tillbaka. Verktygen där de behövs.',
      'Illustrerade arbetsvyer i reducerad skala. Symboler från Lucide, samma som i applikationen.')
for x in (42, 362): rect(x, 179, 288, 403, 'white', 8, 'line')
icon('ArrowLeft', 55, 199, 19); text('Entréplan', 85, 191, 10, 'muted'); text('Badrum', 85, 210, 19, weight=700)
icon('ArrowRightLeft', 269, 201, 19, 'primary'); icon('Trash2', 299, 201, 18, 'error'); line(43, 244, 329, 244)
button('Fri notering', 55, 256, 164, 40, True, 12, 'Pencil'); button('Ta bild', 227, 256, 90, 40, False, 11, 'Camera')
rect(55, 307, 262, 39, 'white', 6, 'control'); icon('Search', 65, 318, 16); text('Sök det du ser…', 91, 319, 12, 'muted')
text('Denna plats', 76, 364, 11, 'primary', 600); text('Hela biblioteket', 201, 364, 10, 'muted'); line(55, 389, 183, 389, 'primary', 2)
rect(43, 404, 286, 36, 'paper'); text('Noterat här', 56, 414, 12, weight=700); text('1', 303, 414, 11, 'muted')
text('Ytskikt', 56, 454, 10, 'muted'); p('Synlig spricka noterades i en golvplatta.', 56, 476, 231, 13, weight=600, limit=532)
icon('ChevronRight', 297, 480, 18); line(43, 541, 329, 541)
for x, glyph, label in ((65, 'MapPin', 'Platser'), (155, 'FileText', 'Noteringar'), (252, 'Inbox', 'Att bearbeta')):
    icon(glyph, x + 9, 548, 16, 'primary' if label == 'Platser' else 'muted'); text(label, x, 568, 8, 'muted')
icon('ArrowLeft', 376, 199, 19); text('Notering', 406, 198, 20, weight=700)
icon('ArrowRightLeft', 589, 201, 18, 'primary'); icon('Trash2', 618, 201, 18, 'error'); line(363, 244, 649, 244)
icon('MapPin', 376, 258, 15, 'primary'); text('Entréplan · Badrum', 399, 259, 11, 'muted')
text('Notering', 376, 294, 11, weight=600); rect(376, 317, 260, 85, 'white', 6, 'control')
p('Synlig spricka noterades i en golvplatta.', 389, 330, 231, 13, limit=392)
text('Risk och fortsatt teknisk utredning', 376, 421, 10); line(376, 450, 636, 450)
text('Bilder', 376, 463, 12, weight=700)
for x, glyph, label in ((376, 'Camera', 'Ta bild'), (465, 'Images', 'Välj bilder'), (554, 'Inbox', 'Bildbank')):
    rect(x, 487, 82, 39, 'white', 5, 'control'); icon(glyph, x + 8, 500, 14); text(label, x + 28, 500, 9)
line(363, 534, 649, 534); icon('Check', 376, 551, 16, 'success'); text('Sparad', 397, 553, 10, 'success')
button('Klart', 555, 539, 81, 39, True, 11, 'Check')
text('Profilens regler', 687, 190, 19, weight=700)
p('Tillbakapil på samma plats.<br/><br/>Flytt och radering i sidhuvudet.<br/><br/>En enda skrollande dialogyta.<br/><br/>Tre tydliga bildval.<br/><br/>Sparstatus nära avslutet.', 687, 231, 226, 13)
p('Behåll svep som genväg, men låt aldrig svep vara enda vägen mellan platser.', 687, 499, 226, 12)
end()

# 09: Harder mobile states; proposed visual behavior, not claimed implementation.
title('Mobil under belastning', 'Långa namn och sparfel får också plats.',
      'Fiktiva layoutprov vid 360 px mobilbredd, visade i 80 % skala. Detta är designkrav, inte körda apptester.')
for x in (42, 362): rect(x, 179, 288, 403, 'white', 8, 'line')
icon('ArrowLeft', 54, 196, 19); text('Rum', 87, 196, 14, weight=700)
icon('ArrowRightLeft', 267, 196, 19, 'primary'); icon('Trash2', 299, 196, 18, 'error')
text('Gästhus med uthyrningsdel', 55, 234, 11.2, 'muted', maxw=260)
text('Plan -1', 55, 254, 11.2, 'muted')
p('Badrum och tvättutrymme vid groventré', 55, 278, 262, 17.6, weight=700, limit=359, leading=24)
line(43, 345, 329, 345)
button('Fri notering', 55, 357, 164, 39, True, 12.8, 'Pencil')
button('Ta bild', 227, 357, 90, 39, False, 11.2, 'Camera')
rect(55, 409, 262, 39, 'white', 6, 'control'); icon('Search', 65, 420, 16)
text('Sök det du ser…', 91, 420, 12.8, 'muted')
rect(43, 464, 286, 34, 'paper'); text('Noterat här', 55, 474, 12.8, weight=700)
p('Rörgenomföring noterades intill duschplatsen.', 55, 514, 235, 12.8, limit=568)
icon('ChevronRight', 298, 531, 17)
icon('ArrowLeft', 375, 196, 19); text('Notering', 406, 196, 18, weight=700)
icon('ArrowRightLeft', 588, 196, 18, 'primary'); icon('Trash2', 618, 196, 18, 'error')
line(363, 231, 649, 231)
p('Gästhus med uthyrningsdel<br/>Plan -1 · Badrum och tvättutrymme vid groventré', 376, 247, 260, 11.2, 'muted', limit=311, leading=16)
text('Notering', 376, 322, 12.8, weight=600)
rect(376, 348, 260, 96, 'white', 6, 'control')
p('Rörgenomföring noterades i golvet intill duschplatsen.', 387, 359, 237, 12.8, limit=433, leading=19.2)
rect(376, 457, 260, 59, 'error-bg', 4)
icon('TriangleAlert', 386, 468, 17, 'error'); text('Kunde inte sparas', 411, 467, 12.8, 'error', 600)
text('Inte sparad på servern.', 387, 490, 11.2, 'error')
button('Försök igen', 488, 529, 148, 39, True, 12.8)
text('När utrymmet tar slut', 687, 189, 18, weight=700)
p('Låt rubriken växa på höjden. Flytt och radering ligger kvar i en egen verktygsrad.', 687, 231, 226, 12.8)
p('Behåll läsbar textstorlek. Lägg bildval i fler rader vid behov; krymp inte klickytorna.', 687, 322, 226, 12.8)
p('Ett olöst sparläge ska gå att hitta tills det är löst. Bevara texten och visa en åtgärd. Visa inte Sparad utan bekräftelse.', 687, 413, 226, 12.8)
p('200 % textförstoring och öppet tangentbord ska provas i appen före införande.', 687, 529, 226, 10.5, 'muted')
end()

# 10: Photo and note states, not a new workflow specification.
title('Bilder & återkoppling', 'Skilj på bild, koppling och sparstatus.',
      'Återanvänd ÖB-rundans flöden. Profilen ska göra deras betydelse tydligare, inte lägga till fler steg.')
for i, (glyph, head, body) in enumerate((('Camera', 'Ta bild', 'Dokumentera på plats.'), ('Images', 'Välj bilder', 'Välj en eller flera från enheten.'), ('Inbox', 'Bildbank', 'Koppla ohanterade besiktningsbilder.'))):
    x = 42 + i * 297
    icon(glyph, x, 189, 28, 'primary'); text(head, x + 42, 190, 19, weight=700)
    p(body, x, 238, 267, 13)
line(42, 291, 918, 291)
text('När bilden ligger fel', 42, 318, 20, weight=700)
icon('Link2', 44, 363, 19, 'primary'); text('Ta bort från noteringen', 75, 361, 16, weight=600)
p('Bilden behålls i besiktningen och kan kopplas på nytt.', 75, 392, 378, 13)
icon('Trash2', 44, 455, 19, 'error'); text('Radera från besiktningen', 75, 453, 16, 'error', 600)
p('Separat, tydligt bekräftad åtgärd. Beskriv konsekvensen innan den genomförs.', 75, 484, 378, 13)
text('När arbetet sparas', 510, 318, 20, weight=700)
badge('Sparad', 510, 362, 'success', 'Check'); p('Bekräftad av servern. Inte synonymt med skickat utlåtande.', 658, 363, 254, 12)
badge('Sparat lokalt', 510, 422, 'info', 'WifiOff'); p('Använd bara när underlaget verkligen finns beständigt på enheten.', 658, 423, 254, 12)
badge('Sparfel', 510, 486, 'error', 'TriangleAlert'); p('Olöst läge och åtgärd ska gå att hitta även när den tillfälliga notisen försvunnit.', 658, 487, 254, 12)
p('Bilden förstoras vid tryck. Koppla bild erbjuder Befintlig notering eller Ny notering. Avbryt ska inte skapa en tom notering.', 42, 557, 874, 11, 'muted')
end()

# 10: Report and email sender boundaries.
title('Utlåtande & mejl', 'Besiktningsföretaget är avsändare.',
      'Appens identitet stödjer arbetet. Kundens rapport ska i första hand identifiera besiktningen och ansvarig avsändare.')
rect(42, 181, 315, 392, 'white', 2, 'line'); rect(43, 182, 313, 5, 'primary')
text('EXEMPEL BESIKTNING AB', 65, 211, 12, weight=700)
p('Överlåtelse-<br/>besiktning', 65, 254, 267, 27, weight=700)
text('Exempelgatan 12', 65, 342, 18, weight=600); text('Huvudbyggnad och gästhus', 65, 374, 12, 'muted')
line(65, 420, 333, 420)
text('Besiktningsdatum', 65, 442, 10, 'muted'); text('16 september 2026', 65, 463, 13)
text('FIKTIVT LAYOUTEXEMPEL', 65, 515, 9, 'muted', 600)
text('Skapat med BesiktApp', 65, 544, 9, 'muted')
text('Tydlig struktur', 409, 188, 20, weight=700)
p('Fastighet, byggnad, datum och besiktningsman ska vara lätta att hitta. Risk och fortsatt teknisk utredning får egna rubriker. Texten ska fungera även i svartvitt.', 409, 230, 498, 13)
text('Trygg överlämning', 409, 337, 20, weight=700)
p('Mejlet visar företagets namn, vilket objekt det gäller och en tydlig väg till utlåtandet. Skilj sparad, skickad och levererad rapport åt. Använd inte varumärket som kvalitetsstämpel för byggnaden.', 409, 379, 498, 13)
rect(409, 492, 509, 81, 'selected', 4)
p('<b>Befintliga utlåtanden lämnas orörda.</b><br/>Ett framtida tema får inte skriva om arkiverade PDF:er, kundlänkar, besiktningsinnehåll, certifieringar eller avsändaruppgifter.', 423, 508, 480, 12)
end()

# 11: Authentic imagery and marketing without certification claims.
title('Bildspråk & budskap', 'Visa vad besiktningsmannen faktiskt gör.',
      'Arbetsmoment, tydliga detaljer och relevanta byggnader. Undvik motiv som antyder garantier eller myndighetsgodkännande.')
photo = ROOT / 'public/landing/besiktning-editorial-v2.png'
c.drawImage(str(photo), 42, H - 180 - 353, width=283, height=353, preserveAspectRatio=True, mask='auto')
p('Befintlig redaktionell bild från webbplatsen. Referens för bildton, inte dokumentation från en besiktning.', 42, 544, 283, 10, 'muted')
text('Motiv och ton', 371, 185, 20, weight=700)
p('Besiktningsarbete i ljusa, verklighetsnära miljöer. I produktvyer används testdata. En skada ska visas skarpt och med sammanhang, utan filter som förändrar bevisvärdet.', 371, 226, 536, 14)
text('Budskap att bygga vidare på', 371, 332, 20, weight=700)
p('Från iakttagelse till tydligt utlåtande.<br/>Bilder och noteringar på rätt plats.<br/>Överblick över varje byggnad.', 371, 376, 538, 19, 'primary', 600)
p('<b>Undvik:</b> “Vi hittar alla fel”, automatiska godkännanden, påhittade kundomdömen och stora AI-löften. AI-sökning ingår inte i den nya ÖB-rundans profil.', 371, 498, 539, 13)
end()

# 13: List rules are approved design, not a new workflow or rollout.
title('Listformspråk 1.2', 'RenoApps lugn. ÖB:s blå identitet.',
      'Beslutad riktning 23 september 2026. En sammanhängande översikt utan att blanda ihop bekräftelse och besiktning.')
text('Låt innehållet leda', 42, 185, 20, weight=600)
p('Vita rader, neutral statustext och tunna horisontella linjer. En smal vänstermarkering kan komplettera texten, aldrig ersätta den.', 42, 225, 412, 14)
p('Inga färgade helrader, statuspiller, stora upprepade primärknappar eller kort inuti kort. Sökning och filter samlas i en lugn verktygsrad.', 42, 323, 412, 14)
p('Listtext 16/24 px, metatext 14/20 px. Vikt 400 för text och 600 för viktig information. Radbryt hellre än att krympa texten.', 42, 429, 412, 13)
text('Två lägen, inte en statuskedja', 510, 185, 19, weight=600)
rect(510, 228, 408, 136, 'white', stroke='line')
rect(510, 228, 3, 136, 'warning')
text('Ängsvägen 3', 528, 240, 16, weight=600)
text('Sara Berg', 528, 266, 13, 'muted')
text('Bekräftelse', 528, 298, 13, 'muted'); text('Inväntar kund', 733, 298, 13)
text('Besiktning', 528, 328, 13, 'muted'); text('Pågår', 733, 328, 13)
p('En tidig start kan vara Pågår och samtidigt Inväntar kund. Kundens godkännande är inte besiktningsmannens acceptans eller en färdig besiktning.', 510, 387, 406, 13)
p('Visa aldrig Klar bara för att en bekräftelse har blivit en besiktning. Godkännanden, avstämning, behörigheter och utskick ändras inte av profilen.', 510, 473, 406, 13)
line(42, 549, 918, 549)
p('Återstår före implementation: verifiera statusmappning, filter, vänstermarkeringens prioritet och aktuell bekräftelse efter ersättning. Bilden är inte affärslogik.', 42, 562, 876, 11, 'muted', limit=598)
end()

# 14: Preserve the reviewed desktop image as reference, not production evidence.
title('Datorreferens', 'Befintliga verktyg. En gemensam lista under.',
      'AI-genererat koncept med fiktiva uppgifter, visat i reducerad skala. Originalbilden medföljer profilpaketet.')
reference_image('desktop-v1.2.png', 42, 183, 600, 398)
text('ÖB-uppdrag', 681, 188, 20, weight=600)
p('De fyra befintliga ingångarna finns kvar under övergången. Listan samlar uppdragen utan att ersätta arbetsvyerna.', 681, 231, 234, 13)
p('En rad per uppdrag, inte per fastighet. Kund och adress får tydlig visuell vikt. Bekräftelse och besiktning har egna kolumner.', 681, 331, 234, 13)
p('Använd tydliga åtgärdsnamn som Öppna besiktning. Kortord i bilden är inte ett krav på implementationen.', 681, 446, 234, 13)
p('Textspecifikationen har företräde framför bildens pixelmått och enskilda formuleringar.', 681, 542, 234, 10, 'muted', limit=590)
end()

# 15: The mobile reference retains separate state labels and reachable shortcuts.
title('Mobilreferens', 'Uppdragen först. Genvägar när de behövs.',
      'Godkänd visuell riktning, inte ett genomfört mobiltest. Samma neutrala listformspråk med ÖB-blå handlingar.')
reference_image('mobile-v1.2.png', 76, 180, 264, 405)
text('Genvägar i stället för fyra öppna formulär', 390, 185, 20, weight=600, maxw=525)
p('De befintliga verktygen samlas under en utfällbar rad. Funktionerna finns kvar, men skjuter inte uppdragslistan långt ned på sidan.', 390, 227, 523, 14)
text('En läsbar rad per uppdrag', 390, 314, 20, weight=600)
p('Adress, kund och datum följs av två tydligt etiketterade lägen: Bekräftelse och Besiktning. Direkt åtkomst till båda arbetsvyerna, utan sidscrollning.', 390, 355, 523, 14)
text('Kompakt utan att bli smått', 390, 441, 20, weight=600)
p('16 px huvudinnehåll. Radbryt långa värden och behåll minst 44 px pekmål, med 48 px som mål. Filter blir väljare när bredden inte räcker.', 390, 482, 523, 14)
p('Kontrollera även 320 px, 200 % textförstoring, skärmläsare och tangentbord i den senare implementationen.', 390, 564, 523, 11, 'muted', limit=596)
end()

# 16: Explicit release checks prevent a polished mockup from implying app readiness.
title('Kvalitetskrav', 'En profil är inte klar förrän den går att använda.',
      'Kontrollpunkter för en senare implementation. Godkända exempel i PDF:en ersätter inte tester av applikationen.')
text('Prov', 42, 186, 12, 'muted', 600)
text('Godkänt när', 321, 186, 12, 'muted', 600)
checks = (
    ('Smala skärmar & förstoring', 'Vid 320, 360 och 390 px samt 200 % textförstoring: inga överlapp, dolda handlingar eller horisontell sidskroll.'),
    ('Långa namn & uppdragsrader', 'Kund, adress och båda statusarna går att läsa. Byggnad och rum identifieras tydligt; rubriker får radbrytas.'),
    ('Lång text & tangentbord', 'Fokuserat fält och sparstatus går att nå. Inget innehåll döljs permanent bakom tangentbord eller bottenfält.'),
    ('Sparfel & svagt nät', 'Texten bevaras, felet ligger kvar och nästa åtgärd är tydlig. Lokalt sparande påstås bara när det är bekräftat.'),
    ('Fokus, kontrast & pekmål', 'Textpar når minst 4,5:1. Fokus och kontroller syns; tangentbord fungerar. Sikta på minst 48 × 48 px pekyta.'),
    ('Befintligt innehåll', 'Samma noteringar, bilder, kopplingar och rapportlänkar före och efter. Arkiverade PDF:er ändras inte.'),
)
for i, (label, criterion) in enumerate(checks):
    y = 222 + i * 57
    text(label, 42, y, 12, weight=600, maxw=263)
    p(criterion, 321, y, 587, 12, limit=y + 47, leading=17)
    line(42, y + 46, 918, y + 46)
p('Profilkontroll: rendera samtliga 17 sidor och kontrollera färgparen. Detta ersätter inte funktionstester, verkliga mobiltester eller publiceringsbeslut.', 42, 574, 876, 10, 'muted', limit=600)
end()

# 17: Package, accessible handoff and bounded adoption.
title('Leverans & införande', 'Förtydliga ÖB, utan att byta BesiktApp.',
      'Version 1.2. RenoApp-baserade listor, oförändrad logotyp och blå identitet. Ingen appändring i denna leverans.')
text('Profilpaket', 42, 185, 20, weight=700)
p('• 17-sidig guide och textspecifikation med beslutslogg.<br/>• Oförändrad BesiktApp-logotyp och källhänvisning.<br/>• Manrope, Lucide-ikoner och licenser.<br/>• Avgränsade CSS-variabler och färgdata.<br/>• Två godkända konceptbilder med fiktiva uppgifter.<br/>• Dator-, mobil- och införandekrav.', 42, 228, 425, 13)
text('Nästa införandesteg', 510, 185, 20, weight=700)
p('1. Verifiera datamappning och befintliga behörigheter.<br/>2. Bygg listan utan att ta bort äldre ingångar.<br/>3. Testa dator, mobil, textförstoring och fel.<br/>4. Granska riktiga arbetsflöden före publicering.<br/>5. Hantera rapporter och mejl separat.', 510, 228, 406, 13)
p('Återanvänd RenoApps formspråk, inte dess produktregler. Ändra inte andra moduler eller globala teman. Genomförd 1.1-implementation dokumenteras separat.', 510, 352, 406, 12)
text('Underlag', 42, 429, 18, weight=700)
p('RenoApps list-CSS och listkomponent, ÖB-profil 1.1 och granskade konceptbilder. OB_BRAND_PROFILE.md anger normativa regler, avgränsning och beslut. Historiska PDF:er lämnas orörda.', 42, 465, 425, 11, 'muted')
links = [
    ('W3C: textkontrast', 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html'),
    ('W3C: minsta pekmål', 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html'),
]
for i, (label, url) in enumerate(links):
    y = 430 + i * 27
    text(label, 510, y, 11, 'link'); c.linkURL(url, (510, H - y - 17, 914, H - y), relative=0)
p('Beräknade textpar: minst 4,5:1. Profilens klickytemål är 48 px. WCAG 2.2 AA anger 24 px som grundregel med undantag. Detta är inte en tillgänglighetscertifiering av appen.', 510, 494, 406, 10, 'muted')
p('Font: Manrope, SIL OFL. Ikoner: Lucide, ISC. Licenser ingår. Bildton: befintligt webbmaterial. Designbeslut 23 september 2026.', 510, 555, 406, 9, 'muted')
rect(42, 550, 425, 33, 'selected'); text('Endast profilfiler. Ingen appändring eller publicering.', 54, 560, 10, weight=600)
end()

c.save()
reader = PdfReader(PDF)
assert len(reader.pages) == PAGE_COUNT
for index, page in enumerate(reader.pages):
    content = page.extract_text()
    assert len(content) > 150 and '\ufffd' not in content, (index, 'missing or invalid text')
with zipfile.ZipFile(OUT / f'{STEM}-profilpaket-v{VERSION}.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.write(PDF, PDF.name)
    archive.write(OUT / 'README.md', 'README.md')
    archive.write(PROFILE_SPEC, 'OB_BRAND_PROFILE.md')
    package_files = [ASSETS / 'colors.json', ASSETS / 'tokens.css']
    for folder in ('fonts', 'icons', 'logo', 'examples'):
        package_files.extend(file for file in (ASSETS / folder).rglob('*') if file.is_file())
    for file in sorted(package_files): archive.write(file, file.relative_to(OUT))
print(json.dumps({'pdf': str(PDF), 'pages': len(reader.pages), 'contrast': RATIOS}, ensure_ascii=False))
