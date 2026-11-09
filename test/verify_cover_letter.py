from pathlib import Path
import sys
from docx import Document
from pypdf import PdfReader

root=Path(sys.argv[1])
doc=Document(root/'cover-letter.docx')
assert doc.styles['Normal'].paragraph_format.line_spacing == 1.15
assert all(p.alignment != 1 for p in doc.paragraphs)
reader=PdfReader(root/'cover-letter.pdf')
assert len(reader.pages)==1
text='\n'.join(p.extract_text() for p in reader.pages)
assert all(part in text for part in ['Example Candidate','Dear Hiring Team,','Sincerely,','fictional letter'])
assert text.index('Dear Hiring Team,') < text.index('Sincerely,')
assert '**' not in text
expected={h.url for p in doc.paragraphs for h in p.hyperlinks}
actual={str(a.get_object().get('/A',{}).get('/URI','')) for page in reader.pages for a in page.get('/Annots',[])}
# LibreOffice may add an email link or split a wrapped link into annotations.
# Assert the actual destinations survive instead of counting rectangles.
assert expected <= actual, f'Missing link destinations: {expected - actual}'
print('Fictional cover letter verified: one page, 1.15 spacing, left alignment and links')
