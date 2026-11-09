import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';
import { validateTemplate } from './docx.mjs';
import { runPython } from './python.mjs';

export const REQUEST_CAPTION = 'ResumeGenerator request v1';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
const rich = text => [{type:'text',text:{content:text}}];
const textOf = values => (values ?? []).map(v=>v.plain_text ?? v.text?.content ?? '').join('');

export function validateRequest(request) {
  if (request?.schemaVersion !== 1 || request.approval?.approved !== true ||
      !request.approval?.approvedAt || !Number.isFinite(Date.parse(request.approval.approvedAt))) {
    throw new Error('A dated approval of the exact sources is required');
  }
  if (!Array.isArray(request.documents) || request.documents.length !== 2 ||
      request.documents.map(d=>d.type).sort().join(',') !== 'cover-letter,resume') {
    throw new Error('The package must contain one resume and one cover letter');
  }
  for (const doc of request.documents) {
    for (const key of ['source','profile','reference']) {
      if (!uuid.test(doc[key]?.blockId ?? '') || !sha.test(doc[key]?.sha256 ?? '')) {
        throw new Error(`Invalid ${key} block ID or checksum`);
      }
    }
  }
  return request;
}

export function findRequest(blocks) {
  const captioned = blocks.filter(b=>b.type==='code' && textOf(b.code.caption)===REQUEST_CAPTION);
  // The Notion Markdown connector cannot set code captions. Accept one explicitly
  // structured request when no captioned request exists; reject ambiguity.
  const matches = captioned.length ? captioned : blocks.filter(b=>{
    if(b.type!=='code' || textOf(b.code.caption)) return false;
    try {
      const value=JSON.parse(textOf(b.code.rich_text));
      return value?.schemaVersion===1 && value?.approval && Array.isArray(value?.documents);
    } catch {return false;}
  });
  if (matches.length !== 1) throw new Error('Expected exactly one ResumeGenerator request block');
  return validateRequest(JSON.parse(textOf(matches[0].code.rich_text)));
}

export function trustedFileUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['.amazonaws.com','.notion-static.com','.notionusercontent.com'].some(s=>url.hostname.endsWith(s))) {
    throw new Error('Expected an HTTPS Notion-managed file URL');
  }
  return url;
}

export class NotionClient {
  constructor(token, fetchImpl=fetch) {
    if (!token) throw new Error('NOTION_TOKEN must be configured as a private runner secret');
    this.token=token; this.fetch=fetchImpl;
  }
  async api(path, {method='GET',body}={}) {
    const form = body instanceof FormData;
    const response=await this.fetch(`https://api.notion.com/v1/${path}`, {
      method, headers:{Authorization:`Bearer ${this.token}`,'Notion-Version':'2026-03-11',
        ...(!form && body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:form ? body : JSON.stringify(body)} : {}),
      signal:AbortSignal.timeout(60000), redirect:'error'
    });
    // Do not include Notion error bodies, signed URLs, or source content in logs.
    if (!response.ok) throw new Error(`Notion ${method} request failed (${response.status})`);
    return response.json();
  }
  async children(page) {
    const blocks=[]; let cursor;
    do {
      const result=await this.api(`blocks/${page}/children?page_size=100${cursor?`&start_cursor=${encodeURIComponent(cursor)}`:''}`);
      blocks.push(...result.results); cursor=result.has_more ? result.next_cursor : null;
      if (result.has_more && !cursor) throw new Error('Incomplete Notion pagination');
    } while(cursor);
    return blocks;
  }
  async file(spec) {
    const block=await this.api(`blocks/${spec.blockId}`);
    if (!['file','pdf'].includes(block.type) || block[block.type]?.type!=='file') {
      throw new Error('Approved sources must be uploaded Notion file blocks');
    }
    const url=trustedFileUrl(block[block.type].file.url);
    const response=await this.fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
    if (!response.ok) throw new Error('Could not retrieve approved Notion file');
    const chunks=[]; let size=0;
    for await (const chunk of response.body) {
      size+=chunk.length;
      if(size>20*1024*1024) throw new Error('Notion source exceeds 20 MiB');
      chunks.push(chunk);
    }
    const bytes=Buffer.concat(chunks);
    if(digest(bytes)!==spec.sha256) throw new Error('Source changed after approval; approve the new version first');
    return bytes;
  }
  async upload(filename,bytes,type) {
    const upload=await this.api('file_uploads',{method:'POST',body:{mode:'single_part',filename,content_type:type}});
    const data=new FormData(); data.append('file',new Blob([bytes],{type}),filename);
    const sent=await this.api(`file_uploads/${upload.id}/send`,{method:'POST',body:data});
    if(sent.status!=='uploaded') throw new Error('Notion did not confirm the upload');
    return {object:'block',type:'file',file:{type:'file_upload',file_upload:{id:upload.id},name:filename}};
  }
}

export async function publishPackage(pageId, {client, builder=build, verify, workRoot}={}) {
  if(!uuid.test(pageId ?? '')) throw new Error('A valid Notion application page ID is required');
  const initial=await client.children(pageId);
  const request=findRequest(initial);
  const requestHash=digest(JSON.stringify(request));
  const marker=`ResumeGenerator package ${requestHash}`;
  const completed=blocks=>blocks.some(b=>b.type==='paragraph' && textOf(b.paragraph.rich_text)===marker);
  if(completed(initial)) return {status:'already-attached',requestHash};
  const root=await mkdtemp(join(workRoot ?? tmpdir(),'resume-notion-'));
  try {
    const outputs=[];
    for(const doc of request.documents) {
      const [source,profile,reference]=await Promise.all(['source','profile','reference'].map(k=>client.file(doc[k])));
      const settings=validateTemplate(JSON.parse(profile.toString('utf8')));
      if(!settings.referenceDocx || (doc.type==='cover-letter' && settings.documentType!=='cover-letter')) {
        throw new Error('Both documents require approved reference-based profiles');
      }
      // Ignore paths supplied by the profile; the exact approved reference is local to this build.
      settings.referenceDocx=`${doc.type}-reference.docx`;
      const sourcePath=join(root,`${doc.type}.md`);
      const templatePath=join(root,`${doc.type}.template.json`);
      await writeFile(sourcePath,source);
      await writeFile(templatePath,JSON.stringify(settings));
      await writeFile(join(root,settings.referenceDocx),reference);
      const result=await builder({source:sourcePath,template:templatePath,documentType:doc.type,
        application:doc.type,output:join(root,'outputs')});
      if(result.renderer!=='LibreOffice headless' || result.warnings?.length) {
        throw new Error('Generation needs review: expected a complete LibreOffice build within the approved page limit');
      }
      await verify(result.directory);
      for(const extension of ['docx','pdf']) {
        const bytes=await readFile(join(result.directory,`${doc.type}.${extension}`));
        outputs.push({name:`${doc.type}-${requestHash.slice(0,12)}.${extension}`,bytes,type:extension==='pdf'?
          'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
      }
    }
    // A page edit while the job ran must not silently publish an obsolete approval.
    const current=await client.children(pageId);
    if(digest(JSON.stringify(findRequest(current)))!==requestHash) throw new Error('Approval changed while generating; nothing attached');
    if(completed(current)) return {status:'already-attached',requestHash};
    const attachments=[];
    for(const output of outputs) attachments.push(await client.upload(output.name,output.bytes,output.type));
    const children=[{object:'block',type:'heading_2',heading_2:{rich_text:rich('Generated documents - visual review required')}},
      {object:'block',type:'paragraph',paragraph:{rich_text:rich(marker)}},
      {object:'block',type:'paragraph',paragraph:{rich_text:rich(`Generated ${new Date().toISOString()}. Approved source checksums verified. Word and PDF use one conversion pipeline. Application has not been submitted.`)}},
      ...attachments];
    try {
      await client.api(`blocks/${pageId}/children`,{method:'PATCH',body:{children}});
    } catch(error) {
      // Never blindly repeat an ambiguous write. A later run checks the stable marker.
      if(!completed(await client.children(pageId))) throw new Error('Attachment result uncertain; inspect the Notion page before retrying',{cause:error});
    }
    const saved=await client.children(pageId);
    if(!completed(saved) || !attachments.every(a=>saved.some(b=>b.type==='file' && b.file.name===a.file.name))) {
      throw new Error('Could not verify every saved attachment; inspect the Notion page');
    }
    return {status:'attached-awaiting-visual-review',requestHash};
  } finally {await rm(root,{recursive:true,force:true});}
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  try {
    const page=process.env.NOTION_PAGE_ID;
    const verify=directory=>runPython([join(dirname(fileURLToPath(import.meta.url)),'verify_generated.py'),directory]);
    const result=await publishPackage(page,{client:new NotionClient(process.env.NOTION_TOKEN),verify});
    console.log(JSON.stringify(result));
  } catch {
    // Parser/build errors can include source fragments; do not echo them.
    console.error('Package generation failed. Check request, checksums, connection access and local build. Inspect Notion before retrying uncertain attachments.');
    process.exitCode=1;
  }
}
