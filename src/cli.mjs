#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadInput } from './build.mjs';
import { runPython } from './python.mjs';

const help = `ResumeGenerator

  node src/cli.mjs check <resume.md> [--template <template.json>]
  node src/cli.mjs import <reference.docx> --out <new-directory>
      [--type resume|cover-letter]
  node src/cli.mjs build <resume.md> --application <company-role>
      [--type resume|cover-letter] [--template <template.json>] [--out <directory>] [--docx-only]

Builds Word with python-docx and PDF with headless LibreOffice, like Greenhouse.
Each build saves a new version with source, template, readable text and hashes.
`;

try {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(help);
  } else {
    const [command, source, ...flags] = args;
    if (!['build','check','import'].includes(command) || !source || source.startsWith('--')) throw new Error(help);
    const options = {source:resolve(source)};
    const seen = new Set();
    for (let i=0; i<flags.length; i++) {
      const flag = flags[i];
      if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
      seen.add(flag);
      if (flag === '--docx-only' && command === 'build') { options.docxOnly = true; continue; }
      const key = {'--application':'application','--out':'output','--template':'template','--type':'documentType'}[flag];
      if (!key || (command === 'check' && !['template','documentType'].includes(key)) || (command === 'import' && !['output','documentType'].includes(key))) throw new Error(`Unknown option: ${flag}`);
      const value = flags[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      options[key] = value;
    }
    if (command === 'import') {
      if (!options.output) throw new Error('Import requires --out with a new directory');
      const result = await runPython([fileURLToPath(new URL('./import_resume.py',import.meta.url)),options.source,'--out',resolve(options.output),'--type',options.documentType??'resume']);
      console.log(result.toString().trim());
    } else if (command === 'check') {
      const { blocks } = await loadInput(options.source, options.template, options.documentType);
      console.log(`Valid document: ${blocks.length} content blocks. No files created.`);
    } else {
      const result = await build(options);
      console.log(`Saved: ${result.directory}`);
      if (result.pages) console.log(`Pages: ${result.pages}`);
      for (const warning of result.warnings) console.warn(`Review: ${warning}`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
