"""Integration assertions against real LibreOffice output, never a mock PDF."""
import json
from pathlib import Path
import sys

from docx import Document
from pypdf import PdfReader

root = Path(sys.argv[1])
doc = Document(root / 'resume.docx')
for style_name in ['Title', 'Heading 1', 'Heading 2', 'Heading 3']:
    style = doc.styles[style_name]
    assert style.font.name == 'Calibri'
    assert str(style.font.color.rgb) == '17365D'
assert doc.styles['Normal'].font.name == 'Calibri'
assert str(doc.styles['Normal'].font.color.rgb) == '000000'
link_runs = [run for paragraph in doc.paragraphs for link in paragraph.hyperlinks for run in link.runs]
assert link_runs and all(str(run.font.color.rgb) == '17365D' for run in link_runs)
reader = PdfReader(root / 'resume.pdf')
manifest = json.loads((root / 'manifest.json').read_text())
assert manifest['renderer'] == 'LibreOffice headless'
assert manifest['pages'] == len(reader.pages) == 2
text = '\n'.join(page.extract_text() for page in reader.pages)
assert 'Example Candidate' in text
assert 'Example Community Services' in text
assert 'Example State University' in text
assert '**' not in text and '[Portfolio]' not in text
positions = [text.index(label) for label in ['Example Candidate', 'Summary', 'Core Capabilities', 'Professional Experience', 'Earlier Experience', 'Selected Projects', 'Education', 'Training', 'Volunteer Service', 'Additional Skills']]
assert positions == sorted(positions), 'PDF reading order differs from source'
links = [str(annotation.get_object().get('/A', {}).get('/URI', ''))
         for page in reader.pages for annotation in page.get('/Annots', [])]
assert 'https://example.com/' in links
print('Real PDF verified: two pages, one Calibri typeface, one navy accent, text order and clickable links retained')
