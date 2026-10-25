#!/usr/bin/env node
/** @fileoverview Validate the pinned training-only Mind2Web evaluation inputs. */
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_EVAL_ROOT = path.resolve(ROOT, '..', 'prompt-paul-agent-eval');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const isSha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

export async function checkReadiness({ evalRoot = DEFAULT_EVAL_ROOT } = {}) {
  const resolvedEvalRoot = path.resolve(evalRoot);
  const artifactDir = path.join(resolvedEvalRoot, 'artifacts', 'mind2web');
  const corpusPath = path.join(artifactDir, 'train.jsonl');
  const corpusManifestPath = path.join(artifactDir, 'train.manifest.json');
  const casesPath = path.join(artifactDir, 'train-cases-10.json');
  const graderPath = path.join(resolvedEvalRoot, 'src', 'scoring', 'scoreMind2WebAction.mjs');
  const checks = [];
  const [corpusExists, manifestExists, casesExists] = await Promise.all(
    [corpusPath, corpusManifestPath, casesPath].map(async (file) => {
      try {
        await access(file);
        return true;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    })
  );

  if (!corpusExists && !manifestExists && !casesExists) {
    return {
      score: 0,
      valid: true,
      fail_class: 'unready_baseline',
      checks: [{ name: 'train sample is prepared and pinned', passed: false }],
    };
  }
  if (corpusExists !== manifestExists) {
    return {
      score: 0,
      valid: false,
      fail_class: 'partial_train_artifacts',
      checks: [{ name: 'train corpus and manifest are paired', passed: false }],
    };
  }

  let corpusRows;
  let corpusManifest;
  let corpusHash;
  let corpusManifestHash;
  let graderHash;
  try {
    const [corpusBytes, manifestBytes, graderBytes] = await Promise.all([
      readFile(corpusPath),
      readFile(corpusManifestPath),
      readFile(graderPath),
    ]);
    corpusManifest = JSON.parse(manifestBytes.toString('utf8'));
    corpusHash = sha256(corpusBytes);
    corpusManifestHash = sha256(manifestBytes);
    graderHash = sha256(graderBytes);
    corpusRows = corpusBytes
      .toString('utf8')
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return {
      score: 0,
      valid: false,
      fail_class: 'invalid_train_input',
      checks: [{ name: 'train corpus, manifest, and grader are readable', passed: false }],
    };
  }

  const trainingCorpusValid =
    corpusManifest.split === 'train' &&
    corpusManifest.outputSha256 === corpusHash &&
    corpusManifest.selection?.strategy === 'first_supported_action_per_task_id' &&
    Number.isSafeInteger(corpusManifest.selection?.maxActions) &&
    corpusManifest.selection.maxActions >= 10 &&
    corpusManifest.selection.maxActions <= 10_000 &&
    Array.isArray(corpusManifest.sourceFiles) &&
    corpusManifest.sourceFiles.length > 0 &&
    corpusManifest.sourceFiles.every(
      (source) =>
        typeof source.path === 'string' &&
        source.path.startsWith('data/train/') &&
        isSha256(source.sha256)
    ) &&
    corpusRows.length >= 10 &&
    corpusRows.length <= corpusManifest.selection.maxActions &&
    corpusRows.every((row) => row.split === 'train' && row.expected?.supported === true);
  checks.push({ name: 'corpus, source hashes, and rows are train-only', passed: trainingCorpusValid });

  const casesPresent = casesExists;
  if (!casesPresent) {
    checks.push({ name: 'exactly ten train cases are pinned to the current grader', passed: false });
    return {
      score: checks.filter(({ passed }) => passed).length / 2,
      valid: trainingCorpusValid,
      fail_class: trainingCorpusValid ? 'unready_baseline' : 'invalid_train_input',
      checks,
    };
  }

  let caseManifest;
  try {
    caseManifest = JSON.parse((await readFile(casesPath, 'utf8')));
  } catch {
    return {
      score: 0,
      valid: false,
      fail_class: 'invalid_case_manifest',
      checks: [...checks, { name: 'case manifest is valid JSON', passed: false }],
    };
  }
  const supportedRows = new Map(
    corpusRows
      .filter((row) => row.expected?.supported === true)
      .map((row) => [`${row.taskId}\u0000${row.actionId}`, row])
  );
  const casesValid =
    caseManifest.schemaVersion === 1 &&
    caseManifest.split === 'train' &&
    caseManifest.limit === 10 &&
    caseManifest.corpusSha256 === corpusHash &&
    caseManifest.manifestSha256 === corpusManifestHash &&
    caseManifest.graderSha256 === graderHash &&
    Array.isArray(caseManifest.cases) &&
    caseManifest.cases.length === 10 &&
    Array.isArray(caseManifest.skipped) &&
    caseManifest.skipped.length <= 20 &&
    caseManifest.skipped.every((entry) => typeof entry.taskId === 'string' && entry.taskId.startsWith('train:')) &&
    new Set(caseManifest.cases.map(({ taskId, actionId }) => `${taskId}\u0000${actionId}`)).size === 10 &&
    caseManifest.cases.every(({ taskId, actionId }) => {
      const row = supportedRows.get(`${taskId}\u0000${actionId}`);
      return (
        typeof taskId === 'string' &&
        taskId.startsWith('train:') &&
        typeof actionId === 'string' &&
        Boolean(row)
      );
    });
  checks.push({ name: 'exactly ten train cases are pinned to the current grader', passed: casesValid });

  const valid = trainingCorpusValid && casesValid;
  return {
    score: checks.filter(({ passed }) => passed).length / checks.length,
    valid,
    fail_class: valid ? 'ok' : 'invalid_train_input',
    checks,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const validArgs =
    args.length === 0 ||
    (args.length === 2 && args[0] === '--eval-root' && Boolean(args[1]));
  if (!validArgs) {
    console.log(JSON.stringify({ score: 0, valid: false, fail_class: 'check_rejects_arguments' }));
    process.exitCode = 1;
  } else {
    try {
      const result = await checkReadiness({ evalRoot: args[1] || DEFAULT_EVAL_ROOT });
      console.log(JSON.stringify(result));
      if (!result.valid) process.exitCode = 1;
    } catch {
      console.log(JSON.stringify({ score: 0, valid: false, fail_class: 'check_error' }));
      process.exitCode = 1;
    }
  }
}
