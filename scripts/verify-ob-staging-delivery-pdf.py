"""Verify the isolated frozen-delivery fixture; never read a customer report."""
import hashlib
import json
from pathlib import Path

from pypdf import PdfReader

folder = Path(__file__).resolve().parent.parent / '.cache' / 'ob-staging-app'
manifest = json.loads((folder / 'delivery-latest.json').read_text(encoding='utf8'))
assert manifest['project'] == 'https://lodbgdbmfdtdzfaezblx.supabase.co'
assert manifest['completed'] is True
output = Path(manifest['output']).resolve()
assert output.parent == folder.resolve() and output.name.startswith('delivery-')
pdf = output / 'frozen-report.pdf'
assert hashlib.sha256(pdf.read_bytes()).hexdigest() == manifest['pdfSha256']
reader = PdfReader(pdf)
pages = [' '.join((page.extract_text() or '').split()) for page in reader.pages]
text = ' '.join(pages)
markers = ['FRYST TEST HUS 1: separat notering.', 'FRYST TEST HUS 2: separat notering.']
note_pages = []
for marker in markers:
    assert text.count(marker) == 1, marker
    note_pages.append(next(i for i, page in enumerate(pages) if marker in page))
assert note_pages[0] < note_pages[1]
assert not any(all(marker in page for marker in markers) for page in pages)
main = next(page for page in pages if 'Byggnads\u00e5r: 1980' in page)
guest = next(page for page in pages if 'Byggnads\u00e5r: 2020' in page)
assert 'Byggnaden var om\u00f6blerad' in main
assert 'fullt m\u00f6blerad' not in main
assert 'M\u00f6blering: fullt m\u00f6blerad' in guest
assert '1980' not in guest and '2020' not in main
assert 'omoblerad' not in text and 'fullt_moblerad' not in text
assert 'TEST Gasthus' in pages[note_pages[1]]
for index in note_pages:
    assert 'Bild 1' in pages[index]
    assert len(list(reader.pages[index].images)) > 0
result = {
    'pages': len(pages), 'sha256_matches': True,
    'conditions_separated': True, 'furnishing_correct': True,
    'notes_unique_and_separated': True,
    'note_pages': [index + 1 for index in note_pages],
    'images_present_on_note_pages': True,
    'visual_review_required': True,
}
(output / 'pdf-validation.json').write_text(json.dumps(result, indent=2), encoding='utf8')
print(json.dumps(result, indent=2))
