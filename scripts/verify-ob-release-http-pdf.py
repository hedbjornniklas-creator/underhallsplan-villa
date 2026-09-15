"""Read-only PDF checks for the isolated HTTP fixture, never customer reports."""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
folder = root / '.cache' / 'ob-release'
manifest = json.loads((folder / 'http-report-latest.json').read_text(encoding='utf8'))
assert manifest['project'] == 'https://lodbgdbmfdtdzfaezblx.supabase.co'
assert manifest['completed'] is True
output = Path(manifest['output']).resolve()
assert output.parent == folder.resolve() and output.name.startswith('http-report-')

from pypdf import PdfReader

texts, images, results = [], [], []
for render in manifest['renders']:
    assert render['mode'] in ('cold', 'warm')
    pdf = output / (render['mode'] + '.pdf')
    assert hashlib.sha256(pdf.read_bytes()).hexdigest() == render['sha256']
    reader = PdfReader(pdf)
    pages = [' '.join((page.extract_text() or '').split()) for page in reader.pages]
    assert len(pages) == 17
    text = ' '.join(pages)
    markers = ['FRYST TEST HUS 1: separat notering.', 'FRYST TEST HUS 2: separat notering.']
    assert all(text.count(marker) == 1 for marker in markers)
    note_pages = [next(i for i, page in enumerate(pages) if marker in page) for marker in markers]
    assert note_pages[0] < note_pages[1]
    main = next(page for page in pages if 'Byggnads\u00e5r: 1980' in page)
    guest = next(page for page in pages if 'Byggnads\u00e5r: 2020' in page)
    assert 'Byggnaden var om\u00f6blerad' in main and 'fullt m\u00f6blerad' not in main
    assert 'M\u00f6blering: fullt m\u00f6blerad' in guest
    assert '1980' not in guest and '2020' not in main
    assert 'TEST Gasthus' in pages[note_pages[1]]
    for index in note_pages:
        assert 'Bild 1' in pages[index] and len(list(reader.pages[index].images)) > 0
    texts.append(pages)
    images.append([[hashlib.sha256(image.data).hexdigest() for image in page.images] for page in reader.pages])
    results.append({'mode': render['mode'], 'pages': len(pages), 'notePages': [i + 1 for i in note_pages],
                    'hashMatches': True, 'buildingFactsAndImagesPass': True})

assert texts[0] == texts[1], 'Cold/warm rendered text differs'
assert images[0] == images[1], 'Cold/warm embedded images differ'
for page in (5, 7, 16, 17):
    subprocess.run(['pdftoppm', '-f', str(page), '-l', str(page), '-scale-to', '1200', '-singlefile',
                    '-png', str(output / 'warm.pdf'), str(output / ('warm-page-' + str(page)))], check=True)
result = {'checks': results, 'coldWarmContentMatches': True, 'visualReviewRequired': True}
(output / 'pdf-validation.json').write_text(json.dumps(result, indent=2), encoding='utf8')
print(json.dumps(result))
