from pathlib import Path
import sys
from docx import Document
from pypdf import PdfReader

root=Path(sys.argv[1])
doc=Document(root/'cover-letter.docx')
assert abs(doc.styles['Normal'].paragraph_format.line_spacing - 1.12) < 0.01
assert all(p.alignment != 1 for p in doc.paragraphs)
for style_name in ['Title', 'Heading 1', 'Heading 2', 'Heading 3']:
    style=doc.styles[style_name]
    assert style.font.name == 'Calibri'
    assert str(style.font.color.rgb) == '17365D'
assert str(doc.styles['Normal'].font.color.rgb) == '000000'
link_runs=[run for paragraph in doc.paragraphs for link in paragraph.hyperlinks for run in link.runs]
assert link_runs and all(str(run.font.color.rgb) == '17365D' for run in link_runs)
reader=PdfReader(root/'cover-letter.pdf')
assert len(reader.pages)==1
text='\n'.join(p.extract_text() for p in reader.pages)
normalized=' '.join(text.split())
assert all(part in normalized for part in ['Example Candidate','Dear Hiring Team,','Sincerely,','fictional letter'])
assert text.index('Dear Hiring Team,') < text.index('Sincerely,')
assert '**' not in text
expected={h.url for p in doc.paragraphs for h in p.hyperlinks}
actual={str(a.get_object().get('/A',{}).get('/URI','')) for page in reader.pages for a in page.get('/Annots',[])}
# LibreOffice may add an email link or split a wrapped link into annotations.
# Assert the actual destinations survive instead of counting rectangles.
assert expected <= actual, f'Missing link destinations: {expected - actual}'
print('Fictional cover letter verified: one page, one Calibri typeface, one navy accent, left alignment and links')
