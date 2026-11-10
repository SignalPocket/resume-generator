import { spawn } from 'node:child_process';

// Resolve a real Python interpreter; callers can select their virtual environment.
export async function runPython(args, input, { spawnProcess = spawn, env = process.env, platform = process.platform } = {}) {
  const configured = env.RESUME_PYTHON || env.CODEX_PRIMARY_RUNTIME_PYTHON;
  const candidates = configured ? [[configured]] : platform === 'win32'
    ? [['python'], ['py','-3']] : [['python3'], ['python']];
  for (const [command, ...prefix] of candidates) {
    try {
      return await new Promise((ok, fail) => {
        const child = spawnProcess(command,[...prefix,...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});
        const out=[];
        let error='';
        child.stdout.on('data',data=>out.push(data));
        child.stderr.on('data',data=>{error=(error+data).slice(-8000);});
        child.stdin.on('error',()=>{});
        child.on('error',fail);
        child.on('close',code=>code===0 ? ok(Buffer.concat(out)) : fail(new Error(`Python document build failed:\n${error}`)));
        child.stdin.end(input);
      });
    } catch (error) {
      // A Windows app-execution alias can exist on PATH but be inaccessible.
      // Only launch errors permit fallback; document/dependency errors must surface.
      if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      if (configured) throw new Error(`Cannot launch configured Python interpreter "${configured}" (${error.code}). Set RESUME_PYTHON to a working python.exe.`, { cause: error });
    }
  }
  throw new Error('No usable Python interpreter was found. Install Python 3.12 or newer and set RESUME_PYTHON to its executable. Then run that interpreter with -m pip install -r requirements.txt.');
}
