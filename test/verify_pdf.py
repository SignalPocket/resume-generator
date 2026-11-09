"""Integration assertions against real LibreOffice output, never a mock PDF."""
import json
from pathlib import Path
import sys

from pypdf import PdfReader

root = Path(sys.argv[1])
reader = PdfReader(root / 'resume.pdf')
manifest = json.loads((root / 'manifest.json').read_text())
assert manifest['renderer'] == 'LibreOffice headless'
assert manifest['pages'] == len(reader.pages) == 1
text = '\n'.join(page.extract_text() for page in reader.pages)
assert 'Example Candidate' in text
assert 'Earlier Example Company' in text
assert 'Example University' in text
assert '**' not in text and '[Portfolio]' not in text
positions = [text.index(label) for label in ['Example Candidate', 'Summary', 'Core Capabilities', 'Professional Experience', 'Education']]
assert positions == sorted(positions), 'PDF reading order differs from source'
links = [str(annotation.get_object().get('/A', {}).get('/URI', ''))
         for page in reader.pages for annotation in page.get('/Annots', [])]
assert 'https://example.com/' in links
assert 'https://example.com/docs' in links
print('Real PDF verified: one page, text order and clickable links retained')
