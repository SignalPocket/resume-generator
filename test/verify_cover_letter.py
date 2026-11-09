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
assert len(reader.pages[0].get('/Annots',[]))==2
print('Fictional cover letter verified: one page, 1.15 spacing, left alignment and links')
