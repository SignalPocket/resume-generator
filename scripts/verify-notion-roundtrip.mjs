// Real Word/PDF conversion, fake Notion storage. No token or network required.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/build.mjs';
import { runPython } from '../src/python.mjs';
import { preparePackage } from '../src/prepare-notion.mjs';
import { publishPackage, digest } from '../src/notion-package.mjs';

const project=dirname(dirname(fileURLToPath(import.meta.url)));
const root=await mkdtemp(join(tmpdir(),'notion-fictional-roundtrip-'));
try {
  const sources={};
  for(const kind of ['resume','cover-letter']) {
    const initial=await build({source:join(project,'examples',`${kind}.md`),documentType:kind,application:kind,output:root,docxOnly:true});
    const imported=join(root,`${kind}-imported`);
    await runPython([join(project,'src','import_resume.py'),join(initial.directory,`${kind}.docx`),'--type',kind,'--out',imported]);
    sources[kind]={source:join(imported,`${kind}.md`),template:join(imported,'template.json')};
  }
  const page='11111111-1111-4111-8111-111111111111';
  const blocks=[];const uploads=new Map();let counter=0;
  const client={
    children:async()=>structuredClone(blocks),
    upload:async(name,bytes)=>{const uploadId=String(++counter);uploads.set(uploadId,{name,bytes});return {type:'file',file:{type:'file_upload',file_upload:{id:uploadId},name}};},
    api:async(path,{body})=>{assert.equal(path,`blocks/${page}/children`);const results=body.children.map(b=>({...b,id:`00000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`}));blocks.push(...results);return {results};},
    file:async spec=>{const b=blocks.find(b=>b.id===spec.blockId);assert.ok(b);const bytes=uploads.get(b.file.file_upload.id).bytes;assert.equal(digest(bytes),spec.sha256);return bytes;}
  };
  await preparePackage({pageId:page,resume:sources.resume.source,resumeTemplate:sources.resume.template,
    letter:sources['cover-letter'].source,letterTemplate:sources['cover-letter'].template,approved:true},{client});
  const verify=directory=>runPython([join(project,'src','verify_generated.py'),directory]);
  assert.equal((await publishPackage(page,{client,verify})).status,'attached-awaiting-visual-review');
  const before=blocks.length;
  assert.equal((await publishPackage(page,{client,verify})).status,'already-attached');
  assert.equal(blocks.length,before);
  const output=join(project,'outputs','fictional-notion-check');await mkdir(output,{recursive:true});
  const files=blocks.filter(b=>b.type==='file').slice(6);
  assert.equal(files.length,4);
  for(const b of files) {const f=uploads.get(b.file.file_upload.id);await writeFile(join(output,f.name),f.bytes);}
  console.log('Fictional Notion preparation, real Word/PDF conversion, four attachments and duplicate retry passed.');
  console.log(`Fictional review files: ${output}`);
} finally {await rm(root,{recursive:true,force:true});}
