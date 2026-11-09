"""Greenhouse-style publishing: python-docx, then headless LibreOffice.

Adapted from the style and paragraph generation pattern in
SignalPocket/greenhouse-sentinel-docs scripts/export_handbook.py.
Content parsing and version management remain in the Node CLI.
"""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
from datetime import datetime, timezone
from io import BytesIO
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED


def font(style, name, size):
    style.font.name = name
    style.font.size = Pt(size)
    style.font.color.rgb = RGBColor(0, 0, 0)
    for key in ('ascii', 'hAnsi', 'eastAsia', 'cs'):
        style.element.get_or_add_rPr().rFonts.set(qn(f'w:{key}'), name)


def add_run(paragraph, data):
    run = paragraph.add_run(data['text'])
    if data.get('bold'):
        run.bold = True
    if data.get('href'):
        relation = paragraph.part.relate_to(
            data['href'],
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
            is_external=True,
        )
        link = OxmlElement('w:hyperlink')
        link.set(qn('r:id'), relation)
        run.underline = True
        link.append(run._r)
        paragraph._p.append(link)


def create_docx(payload):
    if payload.get('reference'):
        return create_from_reference(payload)
    settings = payload['settings']
    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Inches(8.5), Inches(11)
    section.top_margin = section.bottom_margin = Inches(settings['marginInches'])
    section.left_margin = section.right_margin = Inches(settings['marginInches'])
    normal = doc.styles['Normal']
    font(normal, settings['font'], settings['bodySize'])
    normal.paragraph_format.space_after = Pt(settings['paragraphAfterPt'])
    normal.paragraph_format.line_spacing = settings['lineSpacing']
    normal.paragraph_format.widow_control = True
    for name, size in [('Title', settings['nameSize']), ('Heading 1', settings['sectionSize']), ('Heading 2', settings['bodySize'])]:
        style = doc.styles[name]
        font(style, settings['font'], size)
        style.font.bold = True
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.keep_together = True
        style.paragraph_format.space_before = Pt(settings['sectionBeforePt'] if name == 'Heading 1' else 4)
        style.paragraph_format.space_after = Pt(4)
        borders = style.element.get_or_add_pPr().find(qn('w:pBdr'))
        if borders is not None:
            borders.getparent().remove(borders)
    bullet = doc.styles['List Bullet']
    font(bullet, settings['font'], settings['bodySize'])
    bullet.paragraph_format.space_after = Pt(2)
    bullet.paragraph_format.left_indent = Inches(0.17)
    bullet.paragraph_format.first_line_indent = Inches(-0.13)
    in_header = settings.get('documentType') != 'cover-letter'
    styles = {'name': 'Title', 'section': 'Heading 1', 'role': 'Heading 2', 'employer': 'Heading 3', 'bullet': 'List Bullet', 'paragraph': 'Normal', 'blank':'Normal'}
    for block in payload['blocks']:
        if block['type'] == 'pagebreak':
            doc.add_page_break()
            continue
        if block['type'] == 'section':
            in_header = False
        paragraph = doc.add_paragraph(style=styles[block['type']])
        if in_header:
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for data in block['runs']:
            add_run(paragraph, data)
    doc.core_properties.author = ''
    doc.core_properties.last_modified_by = ''
    doc.core_properties.title = 'Cover Letter' if settings.get('documentType') == 'cover-letter' else 'Resume'
    doc.core_properties.created = doc.core_properties.modified = datetime(2000, 1, 1, tzinfo=timezone.utc)
    return stable_package(doc)


def stable_package(doc):
    result = BytesIO()
    doc.save(result)
    # python-docx's ZIP timestamps otherwise vary between identical builds.
    stable = BytesIO()
    with ZipFile(result) as source, ZipFile(stable, 'w', compression=ZIP_DEFLATED) as target:
        for name in source.namelist():
            info = ZipInfo(name, date_time=(2000, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            target.writestr(info, source.read(name))
    return stable.getvalue()


def reference_kind(paragraph, heading_offset=2):
    if paragraph.style.name.startswith('Heading '):
        return {heading_offset:'section',heading_offset+1:'role',heading_offset+2:'employer'}.get(int(paragraph.style.name[-1]), 'section')
    if paragraph._p.xpath('./w:pPr/w:numPr') or paragraph.style.name in ('List Paragraph', 'List Bullet'):
        return 'bullet'
    return 'paragraph'


def reference_run(paragraph, token):
    candidates = [r for r in paragraph.runs if r.text.strip()]
    if token.get('href'):
        link = next((h for h in paragraph.hyperlinks if h.url == token['href']), None)
        if link is None and paragraph.hyperlinks:
            link = paragraph.hyperlinks[0]
        if link is not None and link.runs:
            return deepcopy(link.runs[0]._r.rPr)
    matching = [r for r in candidates if bool(r.bold) == bool(token.get('bold'))]
    run = (matching or candidates or [None])[0]
    return deepcopy(run._r.rPr) if run is not None else None


def add_reference_run(target, token, prototype):
    run = target.add_run()
    # Preserve Word's nonbreaking-hyphen elements through readable Unicode in MD.
    import re
    for part in re.split('([\u2011\u00ad\n\t])', token['text']):
        if part in ('\u2011','\u00ad'):
            run._r.append(OxmlElement('w:noBreakHyphen' if part == '\u2011' else 'w:softHyphen'))
        elif part == '\n':
            run.add_break()
        elif part == '\t':
            run.add_tab()
        elif part:
            run.add_text(part)
    properties = reference_run(prototype, token)
    if properties is not None:
        run._r.insert(0, properties)
    if token.get('bold'):
        run.bold = True
    if token.get('href'):
        relation = target.part.relate_to(token['href'], 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', is_external=True)
        link = OxmlElement('w:hyperlink')
        link.set(qn('r:id'), relation)
        link.append(run._r)
        target._p.append(link)
    return run


def create_from_reference(payload):
    """Reuse source paragraph components and package styles, replacing all text.

    Exact-shape imports reuse each paragraph's properties. If blocks are added,
    an existing component of the same semantic type becomes its prototype.
    """
    doc = Document(BytesIO(base64.b64decode(payload['reference'])))
    if doc.tables or doc.element.xpath('//w:ins|//w:del|//w:commentRangeStart|//w:drawing|//w:sdt|//w:fldChar'):
        raise ValueError('Reference contains tables, revisions, comments, drawings, controls or fields; review before importing')
    originals = list(doc.paragraphs)
    blocks = list(payload['blocks'])
    letter = payload['settings'].get('documentType') == 'cover-letter'
    contact_lines = payload['settings'].get('headerContactLines', 0)
    if letter:
        pass
    elif contact_lines:
        if blocks[0]['type'] != 'name' or any(b['type'] != 'paragraph' for b in blocks[1:contact_lines+1]):
            raise ValueError('Reference header requires a name followed by contact paragraphs')
        blocks = [{'type':'identity','parts':blocks[:contact_lines+1]}] + blocks[contact_lines+1:]
    else:
        blocks[0] = {**blocks[0], 'type':'identity', 'parts':[blocks[0]]}
    heading_offset = min([int(p.style.name[-1]) for p in originals if p.style.name.startswith('Heading ')] or [2])
    original_types = ['paragraph' if p.text.strip() else 'blank' for p in originals] if letter else ['identity'] + [reference_kind(p,heading_offset) for p in originals[1:]]
    if letter and len(blocks) != len(originals):
        raise ValueError('Reference cover letters preserve paragraph slots; use the generic letter template when adding or removing paragraphs')
    exact_shape = [b['type'] for b in blocks] == original_types
    prototypes = {kind:originals[original_types.index(kind)] for kind in set(original_types)}
    # Retain the section geometry and all non-body package parts.
    for paragraph in originals:
        doc.element.body.remove(paragraph._p)
    for index, block in enumerate(blocks):
        if block['type'] == 'pagebreak':
            doc.add_page_break()
            continue
        prototype = originals[index] if exact_shape else prototypes.get(block['type'])
        if prototype is None:
            raise ValueError(f'Reference has no component for {block["type"]}')
        paragraph = doc.add_paragraph()
        if prototype._p.pPr is not None:
            paragraph._p.insert(0, deepcopy(prototype._p.pPr))
        if block['type'] == 'identity':
            for part_index, part in enumerate(block['parts']):
                for token in part['runs']:
                    if part_index == 0:
                        # Name typography comes from the original name run.
                        add_reference_run(paragraph, token, prototype)
                    elif token.get('href'):
                        add_reference_run(paragraph, token, prototype)
                    else:
                        paragraph.add_run(token['text'])
                if part_index < len(block['parts'])-1:
                    if part_index == 0:
                        add_reference_run(paragraph, {'text':'\n','bold':True}, prototype)
                    else:
                        paragraph.add_run('\n')
        else:
            for token in block['runs']:
                add_reference_run(paragraph, token, prototype)
    generated = stable_package(doc)
    # python-docx serializes loaded parts when saving. For reference fidelity,
    # carry all untouched package parts over byte-for-byte, including styles,
    # theme, numbering, settings, core properties and custom XML.
    source_bytes = base64.b64decode(payload['reference'])
    final = BytesIO()
    from lxml import etree
    relationships_part = 'word/_rels/document.xml.rels'
    with ZipFile(BytesIO(source_bytes)) as original, ZipFile(BytesIO(generated)) as rebuilt, ZipFile(final,'w') as target:
        relationships = etree.fromstring(original.read(relationships_part))
        existing = {node.get('Id') for node in relationships}
        new_links = [node for node in etree.fromstring(rebuilt.read(relationships_part)) if node.get('Id') not in existing]
        for node in new_links:
            relationships.append(node)
        for name in original.namelist():
            data = original.read(name)
            if name == 'word/document.xml':
                data = rebuilt.read(name)
            elif name == relationships_part and new_links:
                data = etree.tostring(relationships, xml_declaration=True, encoding='UTF-8', standalone=True)
            info = ZipInfo(name,date_time=(2000,1,1,0,0,0))
            info.compress_type = ZIP_DEFLATED
            target.writestr(info,data)
    return final.getvalue()


def export_pdf(docx, pdf, result):
    from pypdf import PdfReader
    configured = os.environ.get('RESUME_SOFFICE')
    soffice = configured or shutil.which('libreoffice') or shutil.which('soffice')
    if not soffice:
        raise RuntimeError('Headless LibreOffice was not found. Install LibreOffice Writer or set RESUME_SOFFICE to soffice. No Microsoft Word automation is used.')
    docx, pdf = Path(docx).resolve(), Path(pdf).resolve()
    # A private profile avoids attaching to a user's open LibreOffice session.
    with tempfile.TemporaryDirectory(prefix='resume-lo-', dir=docx.parent) as temporary:
        profile = Path(temporary) / 'profile'
        output = Path(temporary) / 'pdf'
        output.mkdir()
        process = subprocess.run([
            soffice, f'-env:UserInstallation={profile.as_uri()}',
            '--headless', '--convert-to', 'pdf', '--outdir', str(output), str(docx),
        ], capture_output=True, text=True, timeout=90)
        generated = output / f'{docx.stem}.pdf'
        if process.returncode or not generated.is_file():
            raise RuntimeError(f'LibreOffice conversion failed: {process.stdout}\n{process.stderr}')
        reader = PdfReader(generated)
        pages = len(reader.pages)
        if pages < 1:
            raise RuntimeError('LibreOffice produced an empty PDF')
        shutil.copyfile(generated, pdf)
    Path(result).write_text(json.dumps({'pages': pages, 'renderer': 'LibreOffice headless'}), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['docx', 'pdf'])
    parser.add_argument('--docx')
    parser.add_argument('--pdf')
    parser.add_argument('--result')
    args = parser.parse_args()
    if args.mode == 'docx':
        sys.stdout.buffer.write(create_docx(json.loads(sys.stdin.buffer.read())))
    else:
        if not all([args.docx, args.pdf, args.result]):
            parser.error('pdf mode requires --docx, --pdf, and --result')
        export_pdf(args.docx, args.pdf, args.result)
