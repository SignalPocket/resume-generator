import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const failures=[];
for(const path of files){
  if(/^(applications|outputs|acceptance|user-content)\//i.test(path) || /\.(docx|pdf|zip)$/i.test(path)) {
    failures.push(`${path}: private/application artifacts must not be in the public source tree`);
    continue;
  }
  const text=readFileSync(path,'utf8');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) && !path.endsWith('check-public-package.mjs')) failures.push(`${path}: private key marker`);
  for(const match of text.matchAll(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    if(!['example.com','example.org','example.net'].includes(match[1].toLowerCase())) failures.push(`${path}: non-example email address`);
  }
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
else console.log(`Public-package check passed for ${files.length} tracked files. Review history and repository visibility separately.`);
