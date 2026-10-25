#!/usr/bin/env node
/** @fileoverview Assert that the evaluator builds inside its current isolated workspace. */
import assert from 'node:assert/strict';
import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evalRoot = path.resolve(sourceRoot, '..', 'prompt-paul-agent-eval');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'prompt-paul-measure-root-'));
const excludedRoots = new Set(['.git', '.dream-rsi', 'node_modules', 'dist', 'dist-dev', 'dist-eval']);

try {
  await cp(sourceRoot, tempRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(sourceRoot, source);
      if (!relative) return true;
      const firstComponent = relative.split(path.sep, 1)[0];
      return !excludedRoots.has(firstComponent);
    },
  });

  await execFileAsync(
    process.execPath,
    [path.join(sourceRoot, '.dream-rsi-harness', 'measure.mjs'), '--eval-root', evalRoot, '--build-only'],
    { cwd: tempRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 20 * 60 * 1000 }
  );

  for (const file of [
    'manifest.json',
    'src/utils/evalHook.js',
    'build-metadata.json',
    'eval-bridge/extension-bridge.html',
    'eval-bridge/extension-bridge.js',
  ]) {
    await access(path.join(tempRoot, 'dist-eval', file));
  }

  const casesPath = path.join(evalRoot, 'artifacts', 'mind2web', 'train-cases-10.json');
  const casesHash = createHash('sha256').update(await readFile(casesPath)).digest('hex');
  const env = { ...process.env };
  for (const name of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY']) {
    delete env[name];
  }
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      path.join(evalRoot, 'scripts', 'mind2web-live.mjs'),
      '--data-dir',
      path.join(evalRoot, 'artifacts', 'mind2web', 'source'),
      '--split',
      'train',
      '--prepare-cases',
      '--limit',
      '10',
      '--cases-file',
      casesPath,
      '--extension-dir',
      path.join(tempRoot, 'dist-eval'),
    ],
    { cwd: evalRoot, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 20 * 60 * 1000 }
  );
  const summary = JSON.parse(stdout.trim().split(/\r?\n/u).at(-1));
  assert.equal(summary.split, 'train');
  assert.equal(summary.cases, 10);
  assert.equal(summary.providerCalls, 0);
  assert.equal(createHash('sha256').update(await readFile(casesPath)).digest('hex'), casesHash);

  console.log('isolated_workspace_extension_preflight_ok');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
