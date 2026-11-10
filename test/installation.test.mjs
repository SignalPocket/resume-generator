import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runPython } from '../src/python.mjs';

function launcher(results, calls) {
  return (command, args) => {
    calls.push([command, ...args]);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    const result = results.shift();
    queueMicrotask(() => {
      if (typeof result === 'string') child.emit('error', Object.assign(new Error(result), { code: result }));
      else {
        child.stdout.write(result.code ? '' : 'ok');
        child.stderr.write(result.code ? 'missing dependency' : '');
        child.emit('close', result.code);
      }
    });
    return child;
  };
}

test('Windows launcher failures try py -3 and preserve arguments', async () => {
  for (const code of ['ENOENT', 'EACCES', 'EPERM']) {
    const calls = [];
    const result = await runPython(['document.py', 'build'], 'input', {
      spawnProcess: launcher([code, { code: 0 }], calls), env: {}, platform: 'win32',
    });
    assert.equal(result.toString(), 'ok');
    assert.deepEqual(calls, [['python', 'document.py', 'build'], ['py', '-3', 'document.py', 'build']]);
  }
});

test('explicit Python paths and document failures never fall back', async () => {
  const calls = [];
  await assert.rejects(runPython([], '', {
    spawnProcess: launcher(['EACCES'], calls), env: { RESUME_PYTHON: 'chosen-python' }, platform: 'win32',
  }), /Cannot launch configured Python interpreter/);
  assert.equal(calls.length, 1);
  calls.length = 0;
  await assert.rejects(runPython([], '', {
    spawnProcess: launcher([{ code: 1 }], calls), env: {}, platform: 'win32',
  }), /missing dependency/);
  assert.equal(calls.length, 1);
});

test('inaccessible default interpreters report actionable setup guidance', async () => {
  await assert.rejects(runPython([], '', {
    spawnProcess: launcher(['EACCES', 'ENOENT'], []), env: {}, platform: 'win32',
  }), /No usable Python interpreter.*RESUME_PYTHON/);
});

test('ZIP source checking needs no Git and rejects private artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'resume-zip-check-'));
  try {
    await mkdir(join(root, 'scripts'));
    await copyFile(new URL('../scripts/check-public-package.mjs', import.meta.url), join(root, 'scripts', 'check-public-package.mjs'));
    await writeFile(join(root, 'README.md'), 'Fictional source\n');
    const command = join(root, 'scripts', 'check-public-package.mjs');
    const clean = spawnSync(process.execPath, [command], { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, PATH: '' } });
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /source-tree files/);
    await mkdir(join(root, 'outputs'));
    await writeFile(join(root, 'outputs', 'resume.pdf'), '%PDF-test');
    await writeFile(join(root, '.env'), 'placeholder');
    const dirty = spawnSync(process.execPath, [command], { encoding: 'utf8' });
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /outputs\/resume.pdf/);
    assert.match(dirty.stderr, /local environment files/);
    await rm(join(root, 'outputs'), { recursive: true });
    await rm(join(root, '.env'));
    await mkdir(join(root, '.git'));
    await writeFile(join(root, 'untracked.md'), ['person', 'example.invalid'].join('@'));
    const source = spawnSync(process.execPath, [command, '--source-tree'], { encoding: 'utf8' });
    assert.equal(source.status, 1);
    assert.match(source.stderr, /untracked.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
