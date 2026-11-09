// A deliberately small Markdown dialect: reject unsupported syntax rather than
// quietly losing content in an application document.
export function inline(text, line = 1) {
  if (text.startsWith('**') && text.endsWith('**') && text.indexOf('**',2) === text.length-2) {
    return inline(text.slice(2,-2),line).map(run=>({...run,bold:true}));
  }
  const tokens = [];
  const pattern = /\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > end) tokens.push({ text: text.slice(end, match.index) });
    if (match[1]) {
      let url;
      try { url = new URL(match[2]); } catch { throw new Error(`Line ${line}: invalid link URL`); }
      if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) {
        throw new Error(`Line ${line}: unsupported link protocol ${url.protocol}`);
      }
      tokens.push({ text: match[1], href: url.href });
    } else tokens.push(...inline(match[3],line).map(run=>({...run,bold:true})));
    end = match.index + match[0].length;
  }
  if (end < text.length) tokens.push({ text: text.slice(end) });
  for (const token of tokens) {
    if (/\*|`|!\[|\]\(|\[[^\]]*\]/.test(token.text)) {
      throw new Error(`Line ${line}: unsupported or incomplete inline Markdown`);
    }
  }
  return tokens;
}

export function parseMarkdown(source, {documentType = 'resume'} = {}) {
  if (!['resume','cover-letter'].includes(documentType)) throw new Error('Document type must be resume or cover-letter');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(source)) throw new Error('Input contains unsupported control characters');
  const blocks = [];
  let paragraph = [];
  let paragraphLine = 1;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', runs: inline(paragraph.join(' ').replace(/\n /g,'\n'), paragraphLine) });
    paragraph = [];
  };
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const hardBreak = / {2,}$/.test(lines[i]) || lines[i].endsWith('\\');
    const line = lines[i].trimEnd().replace(/\\$/, '');
    if (!line.trim()) { flush(); continue; }
    if (line === '<!-- pagebreak -->') { flush(); blocks.push({ type: 'pagebreak' }); continue; }
    if (line === '<!-- blank -->' && documentType === 'cover-letter') { flush(); blocks.push({type:'blank',runs:[]}); continue; }
    const heading = /^(#{1,4}) (.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: ['name', 'section', 'role', 'employer'][heading[1].length - 1], runs: inline(heading[2], i + 1) });
      continue;
    }
    if (/^[-*] /.test(line)) {
      flush(); blocks.push({ type: 'bullet', runs: inline(line.slice(2), i + 1) }); continue;
    }
    if (/^\s|^#|^>|^```|^---$|^\d+[.)] |^\||<[^>]+>/.test(line)) {
      throw new Error(`Line ${i + 1}: unsupported Markdown block; use headings, paragraphs, and bullets`);
    }
    if (!paragraph.length) paragraphLine = i + 1;
    paragraph.push(line + (hardBreak ? '\n' : ''));
  }
  flush();
  if (documentType === 'resume' && (blocks[0]?.type !== 'name' || blocks.filter(b => b.type === 'name').length !== 1)) {
    throw new Error('Start with exactly one # candidate name');
  }
  if (documentType === 'resume' && !blocks.some(b => b.type === 'section')) throw new Error('Include at least one ## section');
  if (documentType === 'cover-letter' && (!blocks.some(b=>b.type==='paragraph') || blocks.filter(b=>b.type==='name').length>1)) throw new Error('A cover letter needs body paragraphs and at most one # name');
  return blocks;
}

export function plainText(blocks) {
  return blocks.map(b => b.type === 'pagebreak' ? '\f' : b.runs.map(r => r.text).join('')).join('\n');
}
