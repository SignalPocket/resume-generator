import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { parseMarkdown, plainText } from '../src/markdown.mjs';
import { createDocx } from '../src/docx.mjs';
import { build, loadInput } from '../src/build.mjs';
import { runPython } from '../src/python.mjs';
import { fileURLToPath } from 'node:url';

const example = new URL('../examples/resume.md',import.meta.url);
function unzip(buffer) {
  const entries = {};
  let offset=0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size=buffer.readUInt32LE(offset+18), nameSize=buffer.readUInt16LE(offset+26), extra=buffer.readUInt16LE(offset+28);
    const start=offset+30+nameSize+extra;
    entries[buffer.subarray(offset+30,offset+30+nameSize).toString()] = inflateRawSync(buffer.subarray(start,start+size)).toString();
    offset=start+size;
  }
  return entries;
}

test('Markdown preserves Unicode, bold, links, wrapped text, and page breaks', () => {
  const blocks=parseMarkdown('# Candidate\n\n## Experience\n\n### Writer | Company | 2020-Present\n\n- A **bold** point & [link](https://example.com?a=1&b=2)\n\nWrapped\nparagraph.\n\n<!-- pagebreak -->\n\n## Education');
  assert.match(plainText(blocks), /A bold point & link/);
  assert.match(plainText(blocks), /Wrapped paragraph\./);
  assert.ok(blocks.some(b=>b.type==='pagebreak'));
  assert.equal(blocks[3].runs.find(r=>r.href).href,'https://example.com/?a=1&b=2');
});

test('unsupported structures and unsafe links fail rather than losing content', () => {
  for (const bad of ['# Candidate\n# Second\n## Summary','## Summary','\n# Candidate\n## Summary\n\n| table |','\n# Candidate\n## Summary\n\n  - nested','\n# Candidate\n## Summary\n\n[x](javascript:alert)','# Candidate\n## Summary\n\n**unfinished']) {
    assert.throws(()=>parseMarkdown(bad));
  }
});

test('DOCX includes real list numbering, heading styles and escaped hyperlink targets',async()=>{
  const {blocks,settings}=await loadInput(example);
  const package1=await createDocx(blocks,settings);
  assert.deepEqual(package1,await createDocx(blocks,settings));
  const entries=unzip(package1);
  assert.ok(Object.keys(entries).length>=6);
  assert.match(entries['word/document.xml'], /w:pStyle w:val="ListBullet"/);
  assert.match(entries['word/styles.xml'], /<w:numPr>/);
  assert.match(entries['word/document.xml'], /w:hyperlink r:id=/);
  assert.match(entries['word/styles.xml'], /w:outlineLvl/);
  assert.ok(!entries['word/document.xml'].includes('<w:tbl>'));
  const escaped=unzip(await createDocx(parseMarkdown('# A & B\n## Summary\n\n[x](https://example.com?a=1&b=2)'),settings));
  assert.match(escaped['word/_rels/document.xml.rels'], /a=1&amp;b=2/);
  assert.match(escaped['word/document.xml'], /A &amp; B/);
});

test('concurrent builds save separate versions and leave source unchanged',async()=>{
  const output=await mkdtemp(join(tmpdir(),'resume-generator-'));
  try {
    const before=await readFile(example);
    const args={source:example,application:'example-role',output,docxOnly:true};
    const [a,b]=await Promise.all([build(args),build(args)]);
    assert.notEqual(a.directory,b.directory);
    assert.deepEqual(await readFile(example),before);
    assert.deepEqual(await readFile(join(a.directory,'source.md')),before);
    assert.equal(a.sourceSha256,b.sourceSha256);
    assert.deepEqual((await readdir(join(output,'example-role'))).sort(),['v001','v002']);
    assert.ok(a.warnings.includes('PDF and page count not checked'));
  } finally { await rm(output,{recursive:true,force:true}); }
});

test('failed PDF export cleans partial output and does not consume a version',async()=>{
  const output=await mkdtemp(join(tmpdir(),'resume-generator-'));
  try {
    await assert.rejects(build({source:example,application:'example',output,pdfExporter:async()=>{throw new Error('conversion failed');}}),/conversion failed/);
    assert.deepEqual(await readdir(join(output,'example')),[]);
    await assert.rejects(build({source:example,application:'../escape',output,docxOnly:true}),/Application must/);
  } finally { await rm(output,{recursive:true,force:true}); }
});

test('PDF page-limit warning preserves output and records renderer and PDF hash',async()=>{
  const output=await mkdtemp(join(tmpdir(),'resume-generator-'));
  try {
    const result=await build({source:example,application:'long-resume',output,pdfExporter:async(docx,pdf)=>{
      // Stub the external renderer boundary; this checks bookkeeping, not rendering.
      await writeFile(pdf,'%PDF-1.7\nfixture');
      return {pages:3,renderer:'test fixture'};
    }});
    assert.match(result.warnings[0],/3 pages/);
    assert.equal(result.pdfSha256.length,64);
    assert.equal(result.renderer,'test fixture');
    assert.ok((await readdir(result.directory)).includes('resume.pdf'));
  } finally { await rm(output,{recursive:true,force:true}); }
});

test('invalid template cannot create a build directory',async()=>{
  const output=await mkdtemp(join(tmpdir(),'resume-generator-'));
  try {
    const template=join(output,'invalid.json');
    await writeFile(template,JSON.stringify({font:'Arial',bodySize:4}));
    await assert.rejects(build({source:example,application:'invalid',output,template,docxOnly:true}),/Template/);
    assert.deepEqual(await readdir(output),['invalid.json']);
  } finally { await rm(output,{recursive:true,force:true}); }
});

test('bold links and separate employer headings retain their meaning',()=>{
  const blocks=parseMarkdown('# Name\n\n**[email@example.com](mailto:email@example.com)**\n\n## Experience\n\n### Role\n\n#### Employer | Dates');
  assert.deepEqual(blocks[1].runs,[{text:'email@example.com',href:'mailto:email@example.com',bold:true}]);
  assert.equal(blocks[4].type,'employer');
});

test('reference import preserves formatting while Markdown remains authoritative',async()=>{
  const output=await mkdtemp(join(tmpdir(),'resume-reference-'));
  try {
    const reference=join(output,'source.docx');
    const imported=join(output,'imported');
    await runPython(['-c',`from docx import Document
from docx.shared import Pt, Inches
import sys
d=Document()
d.sections[0].top_margin=d.sections[0].bottom_margin=d.sections[0].left_margin=d.sections[0].right_margin=Inches(0.5)
d.styles['Normal'].font.size=Pt(10.5)
p=d.add_paragraph()
r=p.add_run('Example Name'); r.bold=True; r.font.size=Pt(14)
p.add_run('\\nExample City\\nexample@example.com')
d.add_paragraph('Example headline')
d.add_paragraph('Summary',style='Heading 2')
d.add_paragraph('Original summary content.')
d.add_paragraph('Experience',style='Heading 2')
d.add_paragraph('Example role',style='Heading 3')
d.add_paragraph('Example employer',style='Heading 4')
d.save(sys.argv[1])`,reference]);
    const before=await readFile(reference);
    await runPython([fileURLToPath(new URL('../src/import_resume.py',import.meta.url)),reference,'--out',imported]);
    const source=join(imported,'resume.md'),template=join(imported,'template.json');
    const result=await build({source,template,application:'reference',output,docxOnly:true});
    await runPython([fileURLToPath(new URL('./verify_roundtrip.py',import.meta.url)),result.directory]);
    await writeFile(source,(await readFile(source,'utf8')).replace('Original summary content.','Changed in Markdown.'));
    const changed=await build({source,template,application:'reference',output,docxOnly:true});
    await runPython(['-c',"from docx import Document; import sys; text='\\n'.join(p.text for p in Document(sys.argv[1]).paragraphs); assert 'Changed in Markdown.' in text; assert 'Original summary content.' not in text",join(changed.directory,'resume.docx')]);
    assert.deepEqual(await readFile(reference),before);
    await assert.rejects(runPython([fileURLToPath(new URL('../src/import_resume.py',import.meta.url)),reference,'--out',imported]),/FileExistsError/);
  } finally { await rm(output,{recursive:true,force:true}); }
});

test('cover letters preserve hard breaks and blank slots without resume headings',()=>{
  const blocks=parseMarkdown('Dear Hiring Team,\n\nA body paragraph.\n\n<!-- blank -->\n\nSincerely,  \nExample Candidate',{documentType:'cover-letter'});
  assert.equal(blocks[2].type,'blank');
  assert.equal(blocks[3].runs[0].text,'Sincerely,\nExample Candidate');
  assert.throws(()=>parseMarkdown('Dear Hiring Team,\n\nBody.'),/candidate name/);
});

test('separate Heading 1 name does not shift body section role and employer styles',async()=>{
  const output=await mkdtemp(join(tmpdir(),'separate-name-'));
  try {
    const reference=join(output,'source.docx');const imported=join(output,'imported');
    await runPython(['-c',`from docx import Document
from docx.shared import Inches
import sys
d=Document()
s=d.sections[0];s.top_margin=s.bottom_margin=s.left_margin=s.right_margin=Inches(0.75)
d.add_paragraph('Example Candidate',style='Heading 1')
d.add_paragraph('Example City | candidate@example.com')
d.add_paragraph('Documentation Lead')
d.add_paragraph('Summary',style='Heading 2')
d.add_paragraph('Reviewed example summary.')
d.add_paragraph('Experience',style='Heading 2')
d.add_paragraph('Writer',style='Heading 3')
d.add_paragraph('Example Company | 2020–Present',style='Heading 4')
d.add_paragraph('Reviewed example contribution.',style='List Bullet')
d.save(sys.argv[1])`,reference]);
    await runPython([fileURLToPath(new URL('../src/import_resume.py',import.meta.url)),reference,'--out',imported]);
    assert.match(await readFile(join(imported,'resume.md'),'utf8'),/#### Example Company/);
    const result=await build({source:join(imported,'resume.md'),template:join(imported,'template.json'),application:'separate-header',output,docxOnly:true});
    await runPython([fileURLToPath(new URL('./verify_roundtrip.py',import.meta.url)),result.directory]);
  } finally {await rm(output,{recursive:true,force:true});}
});

test('generic cover letters and reference round trips preserve letter formatting',async()=>{
  const output=await mkdtemp(join(tmpdir(),'cover-letter-'));
  try {
    const source=new URL('../examples/cover-letter.md',import.meta.url);
    const generic=await build({source,application:'letter',documentType:'cover-letter',output,docxOnly:true});
    assert.equal(generic.documentType,'cover-letter');
    const original=join(generic.directory,'cover-letter.docx');
    await runPython(['-c',"from docx import Document; import sys; d=Document(sys.argv[1]); assert d.styles['Normal'].paragraph_format.line_spacing==1.15; assert all(p.alignment != 1 for p in d.paragraphs); assert any('Sincerely,\\nExample Candidate' in p.text for p in d.paragraphs)",original]);
    const imported=join(output,'imported');
    await runPython([fileURLToPath(new URL('../src/import_resume.py',import.meta.url)),original,'--out',imported,'--type','cover-letter']);
    const result=await build({source:join(imported,'cover-letter.md'),template:join(imported,'template.json'),application:'roundtrip',output,docxOnly:true});
    await runPython([fileURLToPath(new URL('./verify_roundtrip.py',import.meta.url)),result.directory]);
    await assert.rejects(loadInput(source,fileURLToPath(new URL('../templates/cover-letter.json',import.meta.url)),'resume'),/conflicts with the selected template/);
  } finally { await rm(output,{recursive:true,force:true}); }
});
