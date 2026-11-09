"""Import an existing single-column resume into editable Markdown plus a reference.

Never edits the input document. Unsupported content fails before output creation.
"""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import shutil

from docx import Document
from docx.oxml.ns import qn
from docx.text.hyperlink import Hyperlink


def run_text(run):
    parts = []
    for node in run._r:
        if node.tag == qn('w:t'):
            parts.append(node.text or '')
        elif node.tag == qn('w:noBreakHyphen'):
            parts.append('\u2011')
        elif node.tag == qn('w:softHyphen'):
            parts.append('\u00ad')
        elif node.tag in (qn('w:br'), qn('w:cr')):
            parts.append('\n')
        elif node.tag == qn('w:tab'):
            parts.append('\t')
    return ''.join(parts)


def segments(paragraph):
    result = []
    for item in paragraph.iter_inner_content():
        if isinstance(item, Hyperlink):
            for run in item.runs:
                result.append((run_text(run), bool(run.bold), item.url))
        else:
            result.append((run_text(item), bool(item.bold), None))
    return result


def markup(parts):
    merged = []
    for text, bold, url in parts:
        if not text:
            continue
        if any(char in text for char in ('*', '[', ']', '`')):
            raise ValueError('Source contains literal Markdown punctuation requiring manual review')
        if merged and merged[-1][1:] == (bold, url):
            previous = merged.pop()
            text = previous[0] + text
        merged.append((text, bold, url))
    output = ''
    for text, bold, url in merged:
        if '\n' in text or '\t' in text:
            raise ValueError('Body paragraph contains a line break or tab requiring manual mapping')
        # Keep surrounding whitespace outside emphasis markers.
        lead = text[:len(text)-len(text.lstrip())]
        trail = text[len(text.rstrip()):]
        core = text.strip()
        if not core:
            output += text
            continue
        if url:
            core = f'[{core}]({url})'
        if bold:
            core = f'**{core}**'
        output += lead + core + trail
    return output.rstrip()


def split_header(parts):
    lines = [[]]
    for text, bold, url in parts:
        pieces = text.split('\n')
        for i, piece in enumerate(pieces):
            if i:
                lines.append([])
            lines[-1].append((piece, bold, url))
    return [markup(line) for line in lines]


def import_resume(source, destination, document_type='resume'):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    doc = Document(source)
    if doc.tables or len(doc.sections) != 1 or doc.element.xpath('//w:ins|//w:del|//w:commentRangeStart|//w:drawing|//w:sdt|//w:fldChar'):
        raise ValueError('Import supports a clean single-section text resume without tables, fields, revisions or comments')
    if document_type == 'resume' and any(not p.text.strip() for p in doc.paragraphs):
        raise ValueError('Blank body paragraphs need explicit layout mapping before import')
    if any(p.text.strip() for s in doc.sections for part in (s.header, s.footer) for p in part.paragraphs):
        raise ValueError('Reference has header/footer text; review its preservation before importing')
    letter = document_type == 'cover-letter'
    # The name may itself use Heading 1; it is not a body section.
    heading_offset = min([int(p.style.name[-1]) for p in doc.paragraphs[1:] if p.style.name.startswith('Heading ')] or [2])
    header = [] if letter else split_header(segments(doc.paragraphs[0]))
    lines = [] if letter else ['# ' + header[0], *header[1:]]
    for p in (doc.paragraphs if letter else doc.paragraphs[1:]):
        if letter:
            if not p.text.strip():
                lines.append('<!-- blank -->')
            else:
                lines.append('  \n'.join(split_header(segments(p))))
            continue
        name = p.style.name
        if name.startswith('Heading '):
            prefix = {heading_offset:'## ', heading_offset+1:'### ', heading_offset+2:'#### '}.get(int(name[-1]))
            if prefix is None:
                raise ValueError(f'Unsupported source heading: {name}')
        elif p._p.xpath('./w:pPr/w:numPr') or name in ('List Paragraph','List Bullet'):
            prefix = '- '
        else:
            prefix = ''
        lines.append(prefix + markup(segments(p)))
    section = doc.sections[0]
    if not letter and len({section.top_margin,section.bottom_margin,section.left_margin,section.right_margin}) != 1:
        raise ValueError('Reference uses unequal margins; review template mapping')
    settings = {
        'documentType':document_type,
        'font':'Arial', 'bodySize':doc.styles['Normal'].font.size.pt if doc.styles['Normal'].font.size else 11,
        'nameSize':14, 'sectionSize':doc.styles[f'Heading {heading_offset}'].font.size.pt or 12,
        'marginInches':section.top_margin.inches, 'paragraphAfterPt':1,
        'sectionBeforePt':6, 'lineSpacing':1.15 if letter else 1, 'maxPages':1 if letter else 3,
        'referenceDocx':'reference.docx', 'headerContactLines':0 if letter else len(header)-1,
    }
    # Refuse to overwrite an earlier import or use the original's directory.
    destination.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(source,destination/'reference.docx')
    (destination/('cover-letter.md' if letter else 'resume.md')).write_text('\n\n'.join(lines)+'\n',encoding='utf-8')
    (destination/'template.json').write_text(json.dumps(settings,indent=2)+'\n',encoding='utf-8')
    (destination/'import.json').write_text(json.dumps({
        'originalFilename':source.name, 'originalSha256':sha256(source.read_bytes()).hexdigest(),
        'documentType':document_type, 'paragraphs':len(doc.paragraphs), 'links':sum(len(p.hyperlinks) for p in doc.paragraphs),
        'textChanges':[], 'formattingMode':'reference components',
    },indent=2)+'\n',encoding='utf-8')
    print(destination)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('--out', required=True)
    parser.add_argument('--type', choices=['resume','cover-letter'], default='resume')
    args = parser.parse_args()
    import_resume(args.source,args.out,args.type)
