"""Content checks for the synthetic OB report; visual review is still required."""
import json
from pathlib import Path
from pypdf import PdfReader

folder = Path(__file__).resolve().parent.parent / '.cache' / 'ob-staging-app'
reader = PdfReader(folder / 'multi-building-test.pdf')
pages = [' '.join((page.extract_text() or '').split()) for page in reader.pages]
text = ' '.join(pages)
main_marker = 'TEST Huvudbyggnad:'
guest_marker = 'TEST G\u00e4sthus:'
main_pages = [i for i, page in enumerate(pages) if main_marker in page]
guest_pages = [i for i, page in enumerate(pages) if guest_marker in page]
assert len(main_pages) == len(guest_pages) == 1
assert main_pages[0] < guest_pages[0]
assert '1980' in pages[main_pages[0]] and 'Pl\u00e5t.' in pages[main_pages[0]]
assert '2020' in pages[guest_pages[0]] and 'Tr\u00e4panel.' in pages[guest_pages[0]]
assert guest_marker not in pages[main_pages[0]] and main_marker not in pages[guest_pages[0]]
assert 'Sparad i mobiltest.' in text, 'Exercise the mobile autosave before verification'
assert 'fullt_moblerad' not in text and 'fullt m\u00f6blerad' in pages[guest_pages[0]]
main_note = 'Testtext som ska finnas kvar efter byggnadsindelning.'
guest_note = 'Endast g\u00e4sthus: fiktiv notering f\u00f6r test av byggnadsindelning.'
assert text.count(main_note) == text.count(guest_note) == 1
assert not any(main_note in page and guest_note in page for page in pages)

# Fixture illustrations are 10:7. Logos/footer photos have other aspect ratios.
illustrations = []
for index, page in enumerate(reader.pages):
    for item in page.images:
        image = item.image.convert('RGB')
        if abs(image.width / image.height - 10 / 7) < .01:
            red, green, blue = image.getpixel((2, 2))
            kind = 'guest' if green > red + 10 and green > blue else 'main'
            illustrations.append({'page': index + 1, 'building': kind})
assert [item['building'] for item in illustrations].count('main') == 2
assert [item['building'] for item in illustrations].count('guest') == 2
assert illustrations[0] == {'page': 1, 'building': 'main'}
assert all(item['page'] > main_pages[0] + 1 for item in illustrations if item['building'] == 'guest')
result = {
    'pages': len(pages), 'conditions_separated': True, 'notes_separated': True,
    'mobile_autosave_present': True, 'readable_furnishing': True,
    'illustrations': illustrations,
    'visual_follow_up': 'Repeat building/room context when a photo continues on the next page.',
    'delivery_or_locking_tested': False,
}
(folder / 'pdf-validation.json').write_text(json.dumps(result, indent=2), encoding='utf8')
print(json.dumps(result, indent=2))
