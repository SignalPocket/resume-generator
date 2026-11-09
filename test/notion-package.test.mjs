import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest, validateRequest, findRequest, trustedFileUrl, NotionClient, publishPackage, REQUEST_CAPTION } from '../src/notion-package.mjs';

const id='11111111-1111-4111-8111-111111111111';
const code=request=>({type:'code',code:{caption:[{plain_text:REQUEST_CAPTION}],rich_text:[{plain_text:JSON.stringify(request)}]}});
const bytes=Buffer.from('approved');
const spec=()=>({blockId:id,sha256:digest(bytes)});
const request=()=>({schemaVersion:1,approval:{approved:true,approvedAt:'2026-11-09T20:00:00Z'},
  documents:['resume','cover-letter'].map(type=>({type,source:spec(),profile:spec(),reference:spec()}))});

test('uncaptioned Markdown requests work and ambiguous requests fail',()=>{
  const a=code(request());a.code.caption=[];
  assert.equal(findRequest([a]).documents.length,2);
  assert.throws(()=>findRequest([a,a]),/exactly one/);
  const unrelated={type:'code',code:{caption:[],rich_text:[{plain_text:'{"example":true}'}]}};
  assert.equal(findRequest([unrelated,a]).documents.length,2);
});

test('generation requires dated approval, both documents, and exact source checksums',()=>{
  assert.equal(validateRequest(request()).documents.length,2);
  for(const change of [r=>r.approval.approved=false,r=>r.documents.pop(),r=>r.documents[0].source.sha256='changed']) {
    const r=request(); change(r); assert.throws(()=>validateRequest(r));
  }
  assert.throws(()=>findRequest([]),/exactly one/);
  assert.throws(()=>findRequest([code(request()),code(request())]),/exactly one/);
});

test('source retrieval rejects external URLs and changes made after approval',async()=>{
  for(const url of ['http://files.notion-static.com/a','https://evil.example/a','https://files.notion-static.com.evil.example/a']) {
    assert.throws(()=>trustedFileUrl(url));
  }
  trustedFileUrl('https://prod-files-secure.s3.us-west-2.amazonaws.com/approved');
  const mock=async url=>String(url).startsWith('https://api.notion.com/') ?
    Response.json({type:'file',file:{type:'file',file:{url:'https://files.notion-static.com/approved'}}}) : new Response('edited');
  await assert.rejects(new NotionClient('fake',mock).file(spec()),/changed after approval/);
});

test('Notion errors do not expose tokens or source bodies',async()=>{
  const client=new NotionClient('private-secret',async()=>new Response('private-source-text',{status:403}));
  await assert.rejects(client.api('blocks/example'),error=>!error.message.includes('private-')&&error.message.includes('403'));
});

function fakeClient(r=request()) {
  const blocks=[code(r)]; let attached=0;
  return {blocks,get attached(){return attached;},children:async()=>structuredClone(blocks),
    file:async spec=>spec.kind==='profile' ? Buffer.from(JSON.stringify({font:'Arial',bodySize:10.5,nameSize:14,sectionSize:14,marginInches:0.5,paragraphAfterPt:1,sectionBeforePt:6,lineSpacing:1,maxPages:3,referenceDocx:'old-path.docx',documentType:spec.docType})) : bytes,
    upload:async(name)=>({type:'file',file:{name}}),
    api:async(path,{body})=>{attached++;blocks.push(...body.children);return {results:body.children};}};
}
function configuredRequest(){const r=request();r.documents.forEach(d=>{d.profile.kind='profile';d.profile.docType=d.type;});return r;}
async function fakeBuild({source,output,application}) {
  assert.equal((await readFile(source)).toString(),'approved');
  const directory=join(output,application,'v001'); await mkdir(directory,{recursive:true});
  for(const extension of ['docx','pdf']) await writeFile(join(directory,`${application}.${extension}`),'test-only');
  return {directory,renderer:'LibreOffice headless',warnings:[]};
}

test('completed packages attach four files once and are safe to retry',async()=>{
  const client=fakeClient(configuredRequest()); let checked=0;
  const options={client,builder:fakeBuild,verify:async()=>{checked++;}};
  assert.equal((await publishPackage(id,options)).status,'attached-awaiting-visual-review');
  assert.equal(client.blocks.filter(b=>b.type==='file').length,4);
  assert.equal((await publishPackage(id,options)).status,'already-attached');
  assert.equal(client.attached,1); assert.equal(checked,2);
});

test('changing approval during generation prevents all output attachments',async()=>{
  const client=fakeClient(configuredRequest());
  await assert.rejects(publishPackage(id,{client,builder:async args=>{
    const changed=configuredRequest();changed.approval.approvedAt='2026-11-10T20:00:00Z';
    client.blocks[0]=code(changed);return fakeBuild(args);
  },verify:async()=>{}}),/Approval changed/);
  assert.equal(client.attached,0);
});

test('a PDF failure never attaches a partial package',async()=>{
  const client=fakeClient(configuredRequest());
  await assert.rejects(publishPackage(id,{client,builder:async()=>{throw new Error('PDF conversion failed');},verify:async()=>{}}),/PDF conversion failed/);
  assert.equal(client.attached,0);
});
