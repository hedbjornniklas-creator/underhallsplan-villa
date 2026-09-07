from pathlib import Path
from urllib.parse import urlparse, unquote
import re
import subprocess
from pypdf import PdfReader
import pdfplumber

root=Path(__file__).resolve().parent
repo=root.parents[2]
pdf=repo/'output/pdf/hushub-usp-2026-09-06.pdf'
reader=PdfReader(str(pdf))
uris=set()
for page in reader.pages:
    for ref in page.get('/Annots',[]):
        annotation=ref.get_object()
        action=annotation.get('/A',{})
        if action.get('/URI'): uris.add(str(action['/URI']))
    assert '\ufffd' not in (page.extract_text() or '')
    assert 'LINKTOKEN' not in (page.extract_text() or '')
for uri in uris:
    parsed=urlparse(uri)
    assert parsed.scheme=='https',uri
    if parsed.netloc=='github.com':
        path=unquote(parsed.path.split('/blob/60ce844/',1)[1])
        result=subprocess.run(['git','cat-file','-e',f'60ce844:{path}'],cwd=repo,capture_output=True)
        assert result.returncode==0,(path,result.stderr)
        if parsed.fragment.startswith('L'):
            content=subprocess.run(['git','show',f'60ce844:{path}'],cwd=repo,capture_output=True,check=True).stdout
            assert int(parsed.fragment[1:])<=len(content.splitlines()),uri
with pdfplumber.open(pdf) as document:
    for i,page in enumerate(document.pages,1):
        for char in page.chars:
            assert -1<=char['x0']<=page.width+1,(i,char)
            assert -1<=char['x1']<=page.width+1,(i,char)
            assert -1<=char['top']<=page.height+1,(i,char)
assert len(reader.pages)==5
print(f'PASS: {len(reader.pages)} pages, {len(uris)} unique HTTPS links, all repository paths and line anchors valid, no replacement glyphs or off-page text. PDF bytes={pdf.stat().st_size}')
