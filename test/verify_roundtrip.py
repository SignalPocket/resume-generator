"""Compare an imported resume with its Markdown-generated Word and PDF output."""
from pathlib import Path
from zipfile import ZipFile
import json
import sys

from docx import Document
from lxml import etree


def verify_word(reference, generated):
    source, result = Document(reference), Document(generated)
    assert len(source.paragraphs) == len(result.paragraphs)
    for index, (a, b) in enumerate(zip(source.paragraphs, result.paragraphs)):
        assert a.text.rstrip() == b.text.rstrip(), f'Paragraph {index} wording changed'
        assert a.style.style_id == b.style.style_id, f'Paragraph {index} style changed'
        properties = lambda p: etree.tostring(p._p.pPr,method='c14n') if p._p.pPr is not None else None
        assert properties(a) == properties(b), f'Paragraph {index} direct formatting changed'
    links = lambda doc: [(h.text,h.url) for p in doc.paragraphs for h in p.hyperlinks]
    assert links(source) == links(result), 'Hyperlink text or destinations changed'
    with ZipFile(reference) as a, ZipFile(generated) as b:
        assert set(a.namelist()) == set(b.namelist()), 'Package parts added or lost'
        changed = [name for name in a.namelist() if a.read(name) != b.read(name)]
        assert set(changed) <= {'word/document.xml'}, f'Preserve-only parts changed: {changed}'
        for element in [b'noBreakHyphen',b'<w:numPr>',b'<w:hyperlink ']:
            assert a.read('word/document.xml').count(element) == b.read('word/document.xml').count(element), f'{element} count differs'
        assert len(source.element.xpath('//w:br')) == len(result.element.xpath('//w:br')), 'Word line-break elements changed'
    return {'paragraphs':len(result.paragraphs),'hyperlinks':len(links(result)),'preservedPackageParts':len(a.namelist())-1,'textChanges':[]}


def verify_images(directory, stem='resume'):
    from PIL import Image, ImageChops
    from pypdf import PdfReader
    directory = Path(directory)
    reference = sorted((directory/'qa/reference').glob('page-*.png'))
    generated = sorted((directory/'qa/generated').glob('page-*.png'))
    assert len(reference) == len(generated) > 0
    a,b = PdfReader(directory/'reference.pdf'),PdfReader(directory/f'{stem}.pdf')
    assert len(a.pages) == len(b.pages) == len(reference)
    page_text = lambda p: '\n'.join(line.rstrip() for line in p.extract_text().splitlines())
    assert [page_text(p) for p in a.pages] == [page_text(p) for p in b.pages], 'PDF text or pagination changed'
    differences=[]
    for index,(ref,out) in enumerate(zip(reference,generated),1):
        first,second = Image.open(ref).convert('RGB'),Image.open(out).convert('RGB')
        assert first.size == second.size
        delta=ImageChops.difference(first,second)
        box=delta.getbbox()
        if box:
            delta.save(directory/f'qa/diff-{index}.png')
        differences.append({'page':index,'different':bool(box),'bounds':box})
    report={'pages':len(reference),'pixelDifferences':differences,'pixelMatch':not any(d['different'] for d in differences)}
    (directory/'visual-comparison.json').write_text(json.dumps(report,indent=2)+'\n')
    assert report['pixelMatch'], 'Reference and generated page images differ; inspect the diff images'
    return report


if __name__ == '__main__':
    directory=Path(sys.argv[1])
    stem='cover-letter' if (directory/'cover-letter.docx').exists() else 'resume'
    report=verify_word(directory/'reference.docx',directory/f'{stem}.docx')
    if '--images' in sys.argv:
        report.update(verify_images(directory,stem))
    (directory/'roundtrip-checks.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))
