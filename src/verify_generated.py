"""Check real converted output before attaching it for human visual review."""
import json
import re
import sys
from hashlib import sha256
from pathlib import Path
from pypdf import PdfReader

def normalized(text):
    return re.sub(r'\s+', '', text.replace('\u2011', '-').replace('\u2010', '-').replace('\u00ad', ''))

def verify(folder):
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    stem = 'cover-letter' if manifest['documentType'] == 'cover-letter' else 'resume'
    reader = PdfReader(folder / f'{stem}.pdf')
    assert manifest['renderer'] == 'LibreOffice headless'
    assert len(reader.pages) == manifest['pages']
    for name, key in [('source.md', 'sourceSha256'), (f'{stem}.docx', 'docxSha256'), (f'{stem}.pdf', 'pdfSha256')]:
        assert sha256((folder / name).read_bytes()).hexdigest() == manifest[key], f'{name} changed'
    actual = normalized('\n'.join(page.extract_text() for page in reader.pages))
    position = 0
    for line in (folder / f'{stem}.txt').read_text(encoding='utf-8').splitlines():
        value = normalized(line)
        if value:
            match = actual.find(value, position)
            assert match >= 0, 'PDF text is incomplete or out of order'
            position = match + len(value)
    # Intentionally do not claim visual readiness from these text checks.
    print('Real PDF content, reading order, page count and checksums verified; visual review required')

if __name__ == '__main__':
    verify(Path(sys.argv[1]))
