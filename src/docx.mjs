import { fileURLToPath } from 'node:url';
import { runPython } from './python.mjs';
export function validateTemplate(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('Template must be a JSON object');
  const ranges = { bodySize:[9,14], nameSize:[14,28], sectionSize:[10,18], marginInches:[0.4,1.25], paragraphAfterPt:[0,12], sectionBeforePt:[0,20], lineSpacing:[1,1.5], maxPages:[1,10] };
  if (typeof t.font !== 'string' || !t.font.trim() || t.font.length > 80) throw new Error('Template font must be a nonempty font name');
  for (const [key, [min,max]] of Object.entries(ranges)) {
    if (!Number.isFinite(t[key]) || t[key] < min || t[key] > max) throw new Error(`Template ${key} must be between ${min} and ${max}`);
  }
  if (!Number.isInteger(t.maxPages)) throw new Error('Template maxPages must be an integer');
  for (const key of Object.keys(t)) if (!['font','referenceDocx','headerContactLines','documentType'].includes(key) && !(key in ranges)) throw new Error(`Unknown template property: ${key}`);
  if (t.documentType !== undefined && !['resume','cover-letter'].includes(t.documentType)) throw new Error('Document type must be resume or cover-letter');
  if (t.referenceDocx !== undefined && (typeof t.referenceDocx !== 'string' || !t.referenceDocx)) throw new Error('referenceDocx must be a file path');
  if (t.headerContactLines !== undefined && (!Number.isInteger(t.headerContactLines) || t.headerContactLines < 0 || t.headerContactLines > 5)) throw new Error('headerContactLines must be between 0 and 5');
  return t;
}

export async function createDocx(blocks, template, reference) {
  const settings = validateTemplate(template);
  return runPython([fileURLToPath(new URL('./document.py', import.meta.url)), 'docx'], JSON.stringify({blocks, settings, reference:reference?.toString('base64')}));
}
