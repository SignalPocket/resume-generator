import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceTree = process.argv.includes('--source-tree') || !existsSync(join(root, '.git'));
function sourceFiles(directory = '') {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    if (['.git', 'node_modules', '.venv', '__pycache__'].includes(entry.name)) return [];
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Cannot inspect symbolic link: ${path}`);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}
const files=sourceTree ? sourceFiles() : execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const failures=[];
for(const path of files){
  if(/^(applications|outputs|acceptance|user-content)\//i.test(path) || /\.(docx|pdf|zip)$/i.test(path)) {
    failures.push(`${path}: private/application artifacts must not be in the public source tree`);
    continue;
  }
  if (/^\.env(?:\.|$)/i.test(path)) {
    failures.push(`${path}: local environment files must not be in the public source tree`);
    continue;
  }
  const text=readFileSync(join(root,path),'utf8');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) && !path.endsWith('check-public-package.mjs')) failures.push(`${path}: private key marker`);
  for(const match of text.matchAll(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    if(!['example.com','example.org','example.net'].includes(match[1].toLowerCase())) failures.push(`${path}: non-example email address`);
  }
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
else console.log(`Public-package check passed for ${files.length} ${sourceTree ? 'source-tree' : 'tracked'} files. Review history and repository visibility separately.`);
