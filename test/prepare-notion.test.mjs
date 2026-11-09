import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePackage } from '../src/prepare-notion.mjs';
import { findRequest, digest } from '../src/notion-package.mjs';
const id='11111111-1111-4111-8111-111111111111';
async function fixture(fn) {
  const root=await mkdtemp(join(tmpdir(),'prepare-notion-'));
  try {
    await writeFile(join(root,'reference.docx'),'fictional-reference');
    const profile={font:'Arial',bodySize:11,nameSize:14,sectionSize:12,marginInches:1,paragraphAfterPt:4,sectionBeforePt:6,lineSpacing:1.15,maxPages:3,referenceDocx:'reference.docx'};
    await writeFile(join(root,'resume.md'),'# Example Candidate\n\n## Summary\n\nReviewed text.');
    await writeFile(join(root,'cover-letter.md'),'Dear Hiring Team,\n\nReviewed letter.');
    await writeFile(join(root,'resume.json'),JSON.stringify({...profile,documentType:'resume'}));
    await writeFile(join(root,'letter.json'),JSON.stringify({...profile,documentType:'cover-letter'}));
    const blocks=[];const uploads=[];let writes=0;
    const client={children:async()=>structuredClone(blocks),upload:async(name,bytes)=>{uploads.push({name,bytes});return {type:'file',file:{name}};},
      api:async(path,{body})=>{writes++;const results=body.children.map((b,i)=>({...b,id:`00000000-0000-4000-8000-${String(blocks.length+i).padStart(12,'0')}`}));blocks.push(...results);return {results};}};
    await fn({client,blocks,uploads,get writes(){return writes;},options:{pageId:id,resume:join(root,'resume.md'),letter:join(root,'cover-letter.md'),resumeTemplate:join(root,'resume.json'),letterTemplate:join(root,'letter.json'),approved:true}});
  } finally {await rm(root,{recursive:true,force:true});}
}
test('preparation binds six source hashes to actual saved block IDs and rejects duplicate requests',async()=>fixture(async f=>{
  assert.equal((await preparePackage(f.options,{client:f.client})).status,'prepared');
  const r=findRequest(f.blocks);assert.equal(r.documents[0].source.blockId,f.blocks[0].id);
  assert.equal(r.documents[0].source.sha256,digest(f.uploads[0].bytes));
  assert.equal(r.documents[1].reference.sha256,digest(f.uploads[5].bytes));
  assert.equal(f.blocks.length,7);
  await assert.rejects(preparePackage(f.options,{client:f.client}),/already contains/);
  assert.equal(f.uploads.length,6);
}));
test('unapproved or invalid inputs perform no uploads',async()=>fixture(async f=>{
  await assert.rejects(preparePackage({...f.options,approved:false},{client:f.client}),/approve-sources/);
  await writeFile(f.options.letterTemplate,'{}');
  await assert.rejects(preparePackage(f.options,{client:f.client}));
  assert.equal(f.uploads.length,0);assert.equal(f.writes,0);
}));
test('ambiguous source append does not cause a blind retry',async()=>fixture(async f=>{
  f.client.api=async()=>{throw Error('connection lost');};
  await assert.rejects(preparePackage(f.options,{client:f.client}),/uncertain/);
  assert.equal(f.uploads.length,6);assert.equal(f.blocks.length,0);
}));
test('uncertain request append recovers by reading the exact saved request',async()=>fixture(async f=>{
  const api=f.client.api;
  f.client.api=async(path,args)=>{const saved=await api(path,args);if(args.body.children[0].type==='code')throw Error('connection lost');return saved;};
  assert.equal((await preparePackage(f.options,{client:f.client})).status,'prepared');
  assert.equal(f.blocks.length,7);
}));
