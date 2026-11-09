#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInput } from './build.mjs';
import { NotionClient, digest, findRequest, REQUEST_CAPTION, validateRequest } from './notion-package.mjs';

const uuid=/^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;
const rich=text=>Array.from({length:Math.ceil(text.length/1900)},(_,i)=>({type:'text',text:{content:text.slice(i*1900,(i+1)*1900)}}));
const limit=20*1024*1024;

// Upload only explicit, reviewed sources. No AI, job database schema or identity
// is hardcoded; one ordinary Notion page is sufficient.
export async function preparePackage({pageId,resume,letter,resumeTemplate,letterTemplate,approved=false}, {client,now=()=>new Date()}={}) {
  if(!approved) throw new Error('Review both documents and pass --approve-sources to authorize these exact inputs');
  if(!uuid.test(pageId??'')) throw new Error('Provide a Notion page UUID, not a database or view URL');
  const existing=await client.children(pageId);
  // Never append a second request to an existing package, including malformed
  // requests. Use a new version page or deliberately edit the existing request.
  if(existing.some(b=>b.type==='code' && (
    (b.code.caption??[]).map(r=>r.plain_text??r.text?.content??'').join('')===REQUEST_CAPTION ||
    (b.code.rich_text??[]).map(r=>r.plain_text??r.text?.content??'').join('').includes('"schemaVersion"')
  ))) throw new Error('This page already contains a request; use a new version page or edit it deliberately');
  const documents=[];
  for(const [type,source,template] of [['resume',resume,resumeTemplate],['cover-letter',letter,letterTemplate]]) {
    if(!source || !template) throw new Error('Both Markdown sources and their reference-based templates are required');
    const input=await loadInput(resolve(source),resolve(template),type);
    if(!input.reference) throw new Error('Both templates must include referenceDocx; import your approved Word designs first');
    const files=[['source',`${type}.md`,Buffer.from(input.sourceText),'text/markdown'],
      ['profile',`${type}.template.json`,Buffer.from(input.templateText),'application/json'],
      ['reference',`${type}-reference.docx`,input.reference,'application/vnd.openxmlformats-officedocument.wordprocessingml.document']];
    if(files.some(f=>f[2].length>limit)) throw new Error('A source exceeds the 20 MiB single-upload limit');
    documents.push({type,files});
  }
  // All local inputs are validated before the first upload.
  const children=[];
  for(const document of documents) for(const [,name,bytes,mime] of document.files) children.push(await client.upload(name,bytes,mime));
  // Do not retry an ambiguous append: uploaded-but-unattached files expire.
  let saved;
  try { saved=await client.api(`blocks/${pageId}/children`,{method:'PATCH',body:{children}}); }
  catch { throw new Error('Source attachment result uncertain; inspect this page before preparing again'); }
  if(saved.results?.length!==6 || saved.results.some(b=>!uuid.test(b.id??''))) throw new Error('Could not verify six source block IDs; inspect this page before retrying');
  let index=0;
  const request=validateRequest({schemaVersion:1,approval:{approved:true,approvedAt:now().toISOString()},documents:documents.map(d=>({
    type:d.type,...Object.fromEntries(d.files.map(([key,,bytes])=>[key,{blockId:saved.results[index++].id,sha256:digest(bytes)}]))
  }))});
  const requestHash=digest(JSON.stringify(request));
  const block={object:'block',type:'code',code:{language:'json',caption:rich(REQUEST_CAPTION),rich_text:rich(JSON.stringify(request))}};
  try {await client.api(`blocks/${pageId}/children`,{method:'PATCH',body:{children:[block]}});}
  catch {
    let recovered;
    try {recovered=findRequest(await client.children(pageId));} catch {}
    if(!recovered || digest(JSON.stringify(recovered))!==requestHash) throw new Error('Request attachment result uncertain; inspect this page before retrying');
  }
  if(digest(JSON.stringify(findRequest(await client.children(pageId))))!==requestHash) throw new Error('Saved request does not match; inspect this page');
  return {status:'prepared',notionPageId:pageId,requestHash};
}

const help=`Prepare a reviewed Notion package (one-time per version page)

  node src/prepare-notion.mjs --page <uuid> --resume <resume.md>
    --resume-template <template.json> --letter <cover-letter.md>
    --letter-template <template.json> --approve-sources

Set NOTION_TOKEN securely in the environment. Both templates must refer to your
own approved Word references. This uploads six sources and one checksum request;
it does not generate documents or submit a job application. See NOTION_WORKFLOW.md.
`;

if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  const args=process.argv.slice(2);
  if(!args.length || args.includes('--help')) console.log(help);
  else try {
    const options={};const seen=new Set();
    for(let i=0;i<args.length;i++) {
      const flag=args[i];if(seen.has(flag)) throw new Error('Repeated option');seen.add(flag);
      if(flag==='--approve-sources') {options.approved=true;continue;}
      const key={'--page':'pageId','--resume':'resume','--letter':'letter','--resume-template':'resumeTemplate','--letter-template':'letterTemplate'}[flag];
      if(!key || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Unknown or missing option; use --help');
      options[key]=args[++i];
    }
    console.log(JSON.stringify(await preparePackage(options,{client:new NotionClient(process.env.NOTION_TOKEN)})));
  } catch {console.error('Package preparation failed. Check inputs, connection access and existing page state. Do not retry an uncertain write without inspecting the page.');process.exitCode=1;}
}
