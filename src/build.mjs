import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { runPython } from './python.mjs';
import { parseMarkdown, plainText } from './markdown.mjs';
import { createDocx, validateTemplate } from './docx.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const defaultTemplate = join(root, 'templates', 'default.json');
export const coverLetterTemplate = join(root, 'templates', 'cover-letter.json');
const sha256 = data => createHash('sha256').update(data).digest('hex');

export async function loadInput(source, template, documentType) {
  if (!template) {
    const sourcePath = source instanceof URL ? fileURLToPath(source) : resolve(source);
    const sidecar = join(dirname(sourcePath), `${basename(sourcePath, extname(sourcePath))}.template.json`);
    try {
      await readFile(sidecar, 'utf8');
      template = sidecar;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  template ??= documentType === 'cover-letter' ? coverLetterTemplate : defaultTemplate;
  const sourceText = await readFile(source, 'utf8');
  const templateText = await readFile(template, 'utf8');
  const settings = validateTemplate(JSON.parse(templateText));
  if (documentType && settings.documentType && documentType !== settings.documentType) throw new Error('Document type conflicts with the selected template');
  settings.documentType = documentType ?? settings.documentType ?? 'resume';
  const blocks = parseMarkdown(sourceText, {documentType:settings.documentType});
  const reference = settings.referenceDocx ? await readFile(resolve(dirname(resolve(template)), settings.referenceDocx)) : undefined;
  return { sourceText, templateText, blocks, settings, reference };
}

export async function exportPdf(docx, pdf, result) {
  await runPython([join(root,'src','document.py'), 'pdf', '--docx', docx, '--pdf', pdf, '--result', result]);
  return JSON.parse((await readFile(result,'utf8')).replace(/^\uFEFF/,''));
}

export async function build({ source, application, output = join(root,'outputs'), template, documentType, docxOnly = false, pdfExporter = exportPdf }) {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(application ?? '') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(application)) {
    throw new Error('Application must be a simple name such as company-role (letters, numbers, hyphens, underscores)');
  }
  const input = await loadInput(source, template, documentType);
  const stem = input.settings.documentType === 'cover-letter' ? 'cover-letter' : 'resume';
  const applicationDir = resolve(output, application);
  await mkdir(applicationDir, { recursive:true });
  const staging = join(applicationDir, `.build-${randomUUID()}`);
  await mkdir(staging);
  let reservation;
  let reserved = false;
  try {
    const docx = await createDocx(input.blocks, input.settings, input.reference);
    await writeFile(join(staging,`${stem}.docx`), docx);
    await writeFile(join(staging,'source.md'), input.sourceText);
    await writeFile(join(staging,'template.json'), input.reference ? JSON.stringify({...input.settings,referenceDocx:'reference.docx'},null,2)+'\n' : input.templateText);
    if (input.reference) await writeFile(join(staging,'reference.docx'),input.reference);
    await writeFile(join(staging,`${stem}.txt`), plainText(input.blocks) + '\n');
    let rendering = { renderer:null, pages:null };
    if (!docxOnly) {
      rendering = await pdfExporter(join(staging,`${stem}.docx`), join(staging,`${stem}.pdf`), join(staging,'render.json'));
      const pdf = await readFile(join(staging,`${stem}.pdf`));
      if (pdf.subarray(0,5).toString() !== '%PDF-' || !Number.isInteger(rendering.pages) || rendering.pages < 1) {
        throw new Error('PDF export did not produce a valid PDF and page count');
      }
      await rm(join(staging,'render.json'), { force:true });
    }
    const warnings = [];
    if (docxOnly) warnings.push('PDF and page count not checked');
    if (rendering.pages > input.settings.maxPages) warnings.push(`Document has ${rendering.pages} pages; template target is ${input.settings.maxPages}. Edit content or add an explicit page break; no text was removed or shrunk.`);
    const manifest = {
      generatorVersion:'0.4.0', documentType:input.settings.documentType, application, createdAt:new Date().toISOString(),
      sourceSha256:sha256(input.sourceText), templateSha256:sha256(input.templateText),
      ...(input.reference ? {referenceSha256:sha256(input.reference)} : {}),
      docxSha256:sha256(docx), ...rendering, warnings,
      ...(docxOnly ? {} : {pdfSha256:sha256(await readFile(join(staging,`${stem}.pdf`)))})
    };
    await writeFile(join(staging,'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
    let number = 1;
    for (;;) {
      reservation = join(applicationDir, `v${String(number).padStart(3,'0')}`);
      try { await mkdir(reservation); reserved = true; break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; number++; }
    }
    for (const name of [`${stem}.docx`,'source.md','template.json',`${stem}.txt`,'manifest.json', ...(!docxOnly ? [`${stem}.pdf`] : []), ...(input.reference ? ['reference.docx'] : [])]) {
      await copyFile(join(staging,name),join(reservation,name),constants.COPYFILE_EXCL);
    }
    await rm(staging, { recursive:true });
    return { directory:reservation, ...manifest };
  } catch (error) {
    await rm(staging,{recursive:true,force:true});
    if (reserved) await rm(reservation,{recursive:true,force:true});
    throw error;
  }
}
