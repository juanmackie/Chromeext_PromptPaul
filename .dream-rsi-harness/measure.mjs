#!/usr/bin/env node
/** @fileoverview Measure exact actions on a pinned Mind2Web train-only sample. */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { checkReadiness } from './check.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const evalRootArgument = args.length === 2 && args[0] === '--eval-root' ? args[1] : null;
const EVAL_ROOT = path.resolve(
  evalRootArgument || path.resolve(ROOT, '..', 'prompt-paul-agent-eval')
);
const DATA_DIR = path.join(EVAL_ROOT, 'artifacts', 'mind2web', 'source');
const ARTIFACT_DIR = path.join(EVAL_ROOT, 'artifacts', 'mind2web');
const CORPUS_PATH = path.join(ARTIFACT_DIR, 'train.jsonl');
const CORPUS_MANIFEST_PATH = path.join(ARTIFACT_DIR, 'train.manifest.json');
const CASES_PATH = path.join(ARTIFACT_DIR, 'train-cases-10.json');
const ENV_FILE = path.join(EVAL_ROOT, '.env');
const BUILD_PATH = path.join(ROOT, 'dist-eval');
const PREPARE_SCRIPT = path.join(EVAL_ROOT, 'scripts', 'prepare-mind2web.mjs');
const LIVE_SCRIPT = path.join(EVAL_ROOT, 'scripts', 'mind2web-live.mjs');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const cleanEnv = () => {
  const env = { ...process.env, PROMPT_PAUL_EXTENSION_ROOT: ROOT };
  for (const name of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY']) {
    delete env[name];
  }
  return env;
};

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function runNode(
  args,
  { cwd = EVAL_ROOT, env = cleanEnv(), timeout = 20 * 60 * 1000 } = {}
) {
  return execFileAsync(process.execPath, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
}

async function ensureTrainingCorpus() {
  const [hasCorpus, hasManifest] = await Promise.all([
    exists(CORPUS_PATH),
    exists(CORPUS_MANIFEST_PATH),
  ]);
  if (hasCorpus !== hasManifest) {
    throw Object.assign(new Error('Partial training artifacts.'), { failClass: 'invalid_train_input' });
  }
  if (!hasCorpus) {
    try {
      await runNode([
        PREPARE_SCRIPT,
        '--data-dir',
        DATA_DIR,
        '--split',
        'train',
        '--max-actions',
        '100',
      ]);
    } catch {
      throw Object.assign(new Error('Training data preparation failed.'), {
        failClass: 'missing_or_invalid_train_data',
      });
    }
  }
  const [corpusBytes, manifestBytes] = await Promise.all([
    readFile(CORPUS_PATH),
    readFile(CORPUS_MANIFEST_PATH),
  ]);
  let manifest;
  let rows;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
    rows = corpusBytes
      .toString('utf8')
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    throw Object.assign(new Error('Training artifacts are invalid.'), {
      failClass: 'invalid_train_input',
    });
  }
  if (
    manifest.split !== 'train' ||
    manifest.outputSha256 !== sha256(corpusBytes) ||
    manifest.selection?.strategy !== 'first_supported_action_per_task_id' ||
    !Number.isSafeInteger(manifest.selection?.maxActions) ||
    manifest.selection.maxActions < 10 ||
    manifest.selection.maxActions > 10_000 ||
    !Array.isArray(manifest.sourceFiles) ||
    manifest.sourceFiles.length === 0 ||
    manifest.sourceFiles.some(
      (source) =>
        typeof source.path !== 'string' ||
        !source.path.startsWith('data/train/') ||
        typeof source.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(source.sha256)
    ) ||
    !Array.isArray(rows) ||
    rows.length < 10 ||
    rows.length > manifest.selection.maxActions ||
    rows.some((row) => row.split !== 'train' || row.expected?.supported !== true)
  ) {
    throw Object.assign(new Error('Training artifacts are not a valid train-only cohort.'), {
      failClass: 'invalid_train_input',
    });
  }
}

function parseSummary(stdout) {
  for (const line of stdout.trim().split(/\r?\n/u).reverse()) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && value.split) return value;
    } catch {
      // The live runner writes progress lines before its final JSON summary.
    }
  }
  return null;
}

function emit(result, exitCode = 0) {
  console.log(JSON.stringify(result));
  if (exitCode !== 0) process.exitCode = exitCode;
}

async function main() {
  await ensureTrainingCorpus();

  try {
    await runNode([path.join(ROOT, 'scripts', 'build.js'), '--eval'], {
      cwd: ROOT,
      timeout: 20 * 60 * 1000,
    });
    const bridgeDir = path.join(BUILD_PATH, 'eval-bridge');
    await mkdir(bridgeDir, { recursive: true });
    await Promise.all(
      ['extension-bridge.html', 'extension-bridge.js'].map((file) =>
        copyFile(path.join(EVAL_ROOT, 'bridge', file), path.join(bridgeDir, file))
      )
    );
    await Promise.all([
      readFile(path.join(BUILD_PATH, 'manifest.json')),
      readFile(path.join(BUILD_PATH, 'src', 'utils', 'evalHook.js')),
      readFile(path.join(BUILD_PATH, 'build-metadata.json')),
    ]);
  } catch {
    emit({ score: 0, valid: false, fail_class: 'extension_build_failed' }, 1);
    return;
  }

  let result;
  try {
    const env = cleanEnv();
    const { stdout } = await runNode(
      [
        `--env-file=${ENV_FILE}`,
        LIVE_SCRIPT,
        '--data-dir',
        DATA_DIR,
        '--split',
        'train',
        '--run',
        '--limit',
        '10',
        '--temperature',
        '0',
        '--cases-file',
        CASES_PATH,
        '--extension-dir',
        BUILD_PATH,
      ],
      { env, timeout: 30 * 60 * 1000 }
    );
    result = parseSummary(stdout);
  } catch {
    emit({ score: 0, valid: false, fail_class: 'training_evaluation_failed' }, 1);
    return;
  }

  if (!result) {
    emit({ score: 0, valid: false, fail_class: 'invalid_evaluation_output' }, 1);
    return;
  }
  const score = result.microActionAccuracy;
  const complete =
    result.split === 'train' &&
    result.requestedScoredActions === 10 &&
    result.runAttempts === 10 &&
    result.attempted === 10 &&
    result.passed + result.failed === 10 &&
    result.skipped === 0 &&
    result.errors === 0 &&
    result.timeouts === 0 &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 1;
  if (!complete) {
    emit({
      score: Number.isFinite(score) ? score : 0,
      valid: false,
      fail_class: 'incomplete_or_invalid_score',
      runId: result.runId,
      split: result.split,
      attempted: result.attempted,
      errors: result.errors,
      timeouts: result.timeouts,
    }, 1);
    return;
  }

  const readiness = await checkReadiness({ evalRoot: EVAL_ROOT });
  if (!readiness.valid || readiness.score !== 1) {
    emit({
      score,
      valid: false,
      fail_class: readiness.fail_class || 'training_inputs_not_pinned',
      runId: result.runId,
      split: 'train',
      attempted: result.attempted,
    }, 1);
    return;
  }

  emit({
    score,
    valid: true,
    fail_class: 'ok',
    unit: 'fraction of exact annotated actions',
    runId: result.runId,
    split: 'train',
    attempted: result.attempted,
    passed: result.passed,
    failed: result.failed,
    corpusSha256: result.corpusSha256,
  });
}

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node .dream-rsi-harness/measure.mjs [--eval-root <evaluation-repository>]');
} else if (
  args.length !== 0 &&
  !(args.length === 2 && args[0] === '--eval-root' && Boolean(args[1]))
) {
  emit({ score: 0, valid: false, fail_class: 'train_only_evaluator_rejects_arguments' }, 1);
} else {
  try {
    await main();
  } catch (error) {
    emit({ score: 0, valid: false, fail_class: error?.failClass || 'measurement_error' }, 1);
  }
}
