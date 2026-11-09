"""Create a fictional reference using ordinary Word styles for round-trip checks."""
from pathlib import Path
import sys
from docx import Document
from docx.shared import Inches,Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH

destination=Path(sys.argv[1])
doc=Document()
section=doc.sections[0]
section.page_width,section.page_height=Inches(8.5),Inches(11)
section.top_margin=section.bottom_margin=section.left_margin=section.right_margin=Inches(0.75)
normal=doc.styles['Normal']
normal.font.name='Arial';normal.font.size=Pt(11)
normal.paragraph_format.line_spacing=1.15
normal.paragraph_format.space_after=Pt(8)
name=doc.add_paragraph()
run=name.add_run('Example Candidate');run.bold=True;run.font.size=Pt(14)
name.add_run('\ncandidate@example.com')
name.alignment=WD_ALIGN_PARAGRAPH.LEFT
doc.add_paragraph('November 9, 2026')
doc.add_paragraph('Hiring Team\nExample Company')
subject=doc.add_paragraph('Re: Documentation Lead');subject.runs[0].bold=True
doc.add_paragraph('Dear Hiring Team,')
doc.add_paragraph('This fictional cover letter demonstrates a reference-based publishing workflow. The Markdown copy provides the words, while the reference document supplies the formatting.')
doc.add_paragraph('Paragraph spacing, line breaks, and selective emphasis should survive the round trip. These examples contain no real applicant or employer information.')
doc.add_paragraph('Thank you for considering my application.')
doc.add_paragraph('Sincerely,\nExample Candidate')
doc.core_properties.author='';doc.core_properties.last_modified_by=''
doc.core_properties.title='Fictional Cover Letter Reference'
destination.parent.mkdir(parents=True,exist_ok=True)
doc.save(destination)
