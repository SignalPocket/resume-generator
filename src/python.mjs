import { spawn } from 'node:child_process';

// Resolve a real Python interpreter; callers can select their virtual environment.
export async function runPython(args, input) {
  const configured = process.env.RESUME_PYTHON || process.env.CODEX_PRIMARY_RUNTIME_PYTHON;
  const candidates = configured ? [[configured]] : process.platform === 'win32'
    ? [['python'], ['py','-3']] : [['python3'], ['python']];
  for (const [command, ...prefix] of candidates) {
    try {
      return await new Promise((ok, fail) => {
        const child = spawn(command,[...prefix,...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});
        const out=[];
        let error='';
        child.stdout.on('data',data=>out.push(data));
        child.stderr.on('data',data=>{error=(error+data).slice(-8000);});
        child.stdin.on('error',()=>{});
        child.on('error',fail);
        child.on('close',code=>code===0 ? ok(Buffer.concat(out)) : fail(new Error(`Python document build failed:\n${error}`)));
        child.stdin.end(input);
      });
    } catch (error) { if(error.code !== 'ENOENT') throw error; }
  }
  throw new Error('Python 3 was not found. Install Python dependencies from requirements.txt and set RESUME_PYTHON to its executable.');
}
