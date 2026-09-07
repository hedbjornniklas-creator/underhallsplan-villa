from pathlib import Path
import re
import html
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUTPUT = REPO / 'output' / 'pdf' / 'hushub-usp-2026-09-06.pdf'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
for name, filename in [('Arial','arial.ttf'),('ArialBold','arialbd.ttf'),('ArialItalic','ariali.ttf'),('ArialBoldItalic','arialbi.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(Path('C:/Windows/Fonts') / filename)))
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='ArialBold', italic='ArialItalic', boldItalic='ArialBoldItalic')

NAVY = colors.HexColor('#172b4d')
BLUE = colors.HexColor('#2869c8')
MUTED = colors.HexColor('#596579')
styles = {
 'title': ParagraphStyle('title', fontName='ArialBold', fontSize=26, leading=30, textColor=NAVY, spaceAfter=15),
 'h2': ParagraphStyle('h2', fontName='ArialBold', fontSize=18, leading=23, textColor=NAVY, spaceAfter=15, keepWithNext=True),
 'h3': ParagraphStyle('h3', fontName='ArialBold', fontSize=11.4, leading=15, textColor=NAVY, spaceBefore=10, spaceAfter=5, keepWithNext=True),
 'body': ParagraphStyle('body', fontName='Arial', fontSize=9.8, leading=14, textColor=NAVY, spaceAfter=8),
 'note': ParagraphStyle('note', fontName='ArialItalic', fontSize=8.6, leading=12.2, textColor=MUTED, spaceBefore=5, spaceAfter=8),
 'bullet': ParagraphStyle('bullet', fontName='Arial', fontSize=9.8, leading=14, textColor=NAVY, leftIndent=12, firstLineIndent=-10, spaceAfter=7),
}

def markup(text):
    links=[]
    def stash(m):
        links.append((m.group(1),m.group(2)))
        return f'LINKTOKEN{len(links)-1}ENDTOKEN'
    text=re.sub(r'\[([^\]]+)\]\((https://[^\s]+)\)', stash, text)
    text=html.escape(text)
    text=re.sub(r'\*\*(.+?)\*\*',r'<b>\1</b>',text)
    text=re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)',r'<i>\1</i>',text)
    for i,(label,url) in enumerate(links):
        text=text.replace(f'LINKTOKEN{i}ENDTOKEN',f'<a href="{html.escape(url,quote=True)}" color="#2869c8">{html.escape(label)}</a>')
    return text

source=(ROOT/'report-source.md').read_text(encoding='utf-8')
source=source.replace('<!-- PAGE -->','\n\n<!-- PAGE -->\n\n')
story=[]
for block in re.split(r'\n\s*\n',source.strip()):
    if block.strip()=='<!-- PAGE -->':
        story.append(PageBreak()); continue
    if block.startswith('# '):
        lines=block.splitlines()
        for line in lines:
            if line.startswith('# '): story.append(Paragraph(markup(line[2:]),styles['title']))
            elif line.startswith('## '): story.append(Paragraph(markup(line[3:]),styles['h2']))
            else: story.append(Paragraph(markup(line),styles['note']))
        continue
    if block.startswith('## '):
        story.append(Paragraph(markup(block[3:]),styles['h2'])); continue
    if block.startswith('### '):
        lines=block.splitlines()
        story.append(Paragraph(markup(lines[0][4:]),styles['h3']))
        if len(lines)>1:
            if lines[1].startswith('- '):
                for line in lines[1:]:
                    story.append(Paragraph('• '+markup(line[2:]),styles['bullet']))
            else:
                story.append(Paragraph(markup(' '.join(lines[1:])),styles['body']))
        continue
    if block.startswith('- '):
        for line in block.splitlines():
            story.append(Paragraph('• '+markup(line[2:]),styles['bullet']))
        continue
    key='note' if block.startswith('*') and not block.startswith('**') else 'body'
    story.append(Paragraph(markup(block.replace('\n',' ')),styles[key]))

class NumberedCanvas(canvas.Canvas):
    def __init__(self,*a,**kw):
        super().__init__(*a,**kw); self.states=[]
    def showPage(self):
        self.states.append(dict(self.__dict__)); self._startPage()
    def save(self):
        total=len(self.states)
        for state in self.states:
            self.__dict__.update(state)
            self.setFillColor(NAVY); self.setFont('ArialBold',9)
            self.drawString(44,805,'H U S H U B')
            self.setFillColor(MUTED); self.setFont('Arial',8)
            self.drawRightString(551,805,'POSITIONERING  /  6 SEPTEMBER 2026')
            self.setStrokeColor(colors.HexColor('#dae2ec')); self.setLineWidth(.6)
            self.line(44,794,551,794); self.line(44,45,551,45)
            self.drawString(44,31,'Arbetsunderlag • Funktioner, kundnytta och möjliga USP:er')
            self.drawRightString(551,31,f'{self._pageNumber} / {total}')
            super().showPage()
        super().save()

doc=SimpleDocTemplate(str(OUTPUT),pagesize=(595.28,841.89),rightMargin=44,leftMargin=44,topMargin=63,bottomMargin=61,
 title='HusHubs starkaste säljargument',author='HusHub • Researchunderlag',subject='BesiktApp och RenoApp - befintliga fördelar och framtida möjligheter')
doc.build(story,canvasmaker=NumberedCanvas)
reader=PdfReader(str(OUTPUT))
print(f'OUTPUT {OUTPUT}')
print(f'PAGES {len(reader.pages)}')
for i,page in enumerate(reader.pages,1):
    text=page.extract_text() or ''
    links=[a.get_object() for a in page.get('/Annots',[]) if a.get_object().get('/Subtype')=='/Link']
    print(f'PAGE {i}: chars={len(text)}, links={len(links)}, opening={text[:90]!r}')
assert len(reader.pages)==5, f'Expected 5 pages, got {len(reader.pages)}'
assert all((p.extract_text() or '').strip() for p in reader.pages)
assert 'personlig hjälp' in '\n'.join(p.extract_text() or '' for p in reader.pages).lower()
