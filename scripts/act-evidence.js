#!/usr/bin/env node

/**
 * @fileoverview Write a sanitized Act benchmark evidence summary for the
 * experiment record. Prompts, page text, per-step traces, and confirmation
 * labels stay out of the output; only provenance, aggregate metrics, per-task
 * rows, and counted failure mechanisms are kept.
 * @module actEvidence
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');

const requireFromHere = createRequire(__filename);
const { readReport } = requireFromHere('./compare-act-scores.js');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_SCHEMA_VERSION = 1;
// Fixture and oracle files that define the measured suite. Their digests are
// the suite revision: a report without matching digests is not comparable.
const SUITE_FILES = [
  'eval/act/cases.json',
  'eval/act/manifest.json',
  'eval/mind2web/cases.json',
  'eval/mind2web/manifest.json',
  'tests/browser/fixtures/mind2web-pages.json.gz',
  'tests/browser/fixtures/act-benchmark.html',
  'tests/browser/fixtures/act-holdout.html',
];
const MALFORMED_ARGUMENT_PREFIX = 'Invalid tool arguments format';
const TASK_ROW_FIELDS = Object.freeze([
  'taskId',
  'run',
  'success',
  'endStateMatches',
  'outcomeDone',
  'steps',
  'wallTimeMs',
  'confirmationCards',
  'manualInterventions',
  'userInputRequests',
  // Counts only. The report's `interruptions` entries carry the model's own
  // question text, which can quote the page; the record must stay free of it.
  'interruptionBudget',
  'humanSteps',
  'resumedInterruptions',
  'interruptionWaitMs',
  'terminalState',
  'actOutcome',
  'failureCodes',
  'invalidRetries',
]);

function digestFile(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
}

function suiteRevisions() {
  const revisions = {};
  for (const relativePath of SUITE_FILES) revisions[relativePath] = digestFile(relativePath);
  return revisions;
}

/**
 * Count malformed tool-argument actions per task from saved traces. This is the
 * mechanism behind the "Malformed tool arguments" failure, measured directly
 * instead of inferred from a failure-code string.
 * @param {string} traceDir - directory holding `<task>-run<n>.trace.json`.
 * @param {Array<string>} taskIds - tasks to report, missing traces stay null.
 * @returns {object} taskId -> {attempts, malformedArgumentActions}.
 */
function countMalformedArguments(traceDir, taskIds) {
  const counts = {};
  for (const taskId of taskIds) counts[taskId] = { attempts: 0, malformedArgumentActions: 0 };
  if (!fs.existsSync(traceDir)) return counts;
  for (const file of fs.readdirSync(traceDir)) {
    const match = /^(.*)-run(\d+)\.trace\.json$/.exec(file);
    if (!match) continue;
    const taskId = match[1];
    if (!counts[taskId]) continue;
    const trace = JSON.parse(fs.readFileSync(path.join(traceDir, file), 'utf8'));
    counts[taskId].attempts += 1;
    for (const step of trace.steps || []) {
      if (step?.kind !== 'action') continue;
      const result = step.action_result;
      const message = `${result?.error || ''} ${result?.result?.error || ''}`;
      if (String(message).includes(MALFORMED_ARGUMENT_PREFIX)) {
        counts[taskId].malformedArgumentActions += 1;
      }
    }
  }
  return counts;
}

function taskRows(records) {
  return (records || []).map((record) =>
    Object.fromEntries(TASK_ROW_FIELDS.map((field) => [field, record[field] ?? null]))
  );
}

/**
 * Derived from the trace counts, not from a report failure code: schema-4 reports
 * name the mechanism `JSON`, so a code-based total would silently disagree with
 * the per-task counts in the same file.
 * @param {object} counts - taskId -> {attempts, malformedArgumentActions}.
 * @returns {{malformedArgumentTaskIds: string[]}}
 */
function totalsFromTraceCounts(counts) {
  const malformedTaskIds = Object.entries(counts)
    .filter(([, entry]) => entry.malformedArgumentActions > 0)
    .map(([taskId]) => taskId)
    .sort();
  return { malformedArgumentTaskIds: malformedTaskIds };
}

/**
 * Build the sanitized evidence object for one measured report.
 * @param {object} report - a validated Act benchmark report.
 * @param {{traceDir?: string, evidencePath?: string}} options
 * @returns {object}
 */
function buildEvidence(report, options = {}) {
  const taskIds = Array.isArray(report.tasks) ? report.tasks : [];
  const traceCounts = countMalformedArguments(
    options.traceDir || path.join(ROOT, 'artifacts', 'act-benchmark', 'traces'),
    taskIds
  );
  return {
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    createdAt: report.createdAt,
    reportSchemaVersion: report.schemaVersion,
    configFingerprint: report.configFingerprint,
    provider: report.provider,
    model: report.model,
    reasoningLevel: report.reasoningLevel ?? null,
    runsPerTask: report.runsPerTask,
    extensionDir: report.extensionDir,
    measured: {
      measurable: report.measurable,
      plannedAttempts: report.plannedAttempts,
      measuredAttempts: report.measuredAttempts,
      invalidAttempts: report.invalidAttempts,
      overallPassRate: report.overallPassRate,
      confidence: report.confidence,
      endStatePassRate: report.endStatePassRate,
      endStateOutcomeDisagreements: report.endStateOutcomeDisagreements,
      targetPassRate: report.targetPassRate,
      targetMet: report.targetMet,
    },
    attention: report.attention,
    safety: report.safety,
    failureSummary: report.failureSummary,
    malformedArguments: traceCounts,
    totals: totalsFromTraceCounts(traceCounts),
    suiteRevisions: suiteRevisions(),
    suiteVerificationControl: 'node scripts/act-benchmark.js --list',
    tasks: taskRows(report.records),
  };
}

function writeEvidence({ reportPath, traceDir, outputPath }) {
  const report = readReport(reportPath);
  const evidence = buildEvidence(report, { traceDir });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

if (require.main === module) {
  try {
    const [reportPath, outputPath] = process.argv.slice(2);
    if (!reportPath || !outputPath) {
      throw new Error(
        'Usage: node scripts/act-evidence.js <results.json> <output.json> [--trace-dir <dir>]'
      );
    }
    const traceIndex = process.argv.indexOf('--trace-dir');
    const traceDir = traceIndex > 0 ? process.argv[traceIndex + 1] : undefined;
    const evidence = writeEvidence({ reportPath, traceDir, outputPath });
    const rate =
      evidence.measured.overallPassRate === null
        ? 'no measurable score'
        : `${Math.round(evidence.measured.overallPassRate * 100)}%`;
    const malformed = Object.values(evidence.malformedArguments).reduce(
      (total, entry) => total + entry.malformedArgumentActions,
      0
    );
    console.log(
      `Evidence written to ${outputPath}: ${rate} over ${evidence.measured.measuredAttempts} measured attempt(s), ` +
        `${malformed} malformed-argument action(s), fingerprint ${evidence.configFingerprint.slice(0, 12)}`
    );
  } catch (error) {
    console.error(`Act evidence summary failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  EVIDENCE_SCHEMA_VERSION,
  SUITE_FILES,
  buildEvidence,
  countMalformedArguments,
  totalsFromTraceCounts,
  suiteRevisions,
  writeEvidence,
};
