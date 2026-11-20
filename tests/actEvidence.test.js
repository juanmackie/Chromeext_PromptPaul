/**
 * @fileoverview Sanitized Act evidence summaries: the experiment record must
 * never carry page text, prompts, or model-authored prose.
 * @module actEvidenceTests
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const { buildEvidence, countMalformedArguments, totalsFromTraceCounts } = createRequire(
  import.meta.url
)('../scripts/act-evidence.js');

const temporaryDirectories = [];
function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'act-evidence-'));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const report = () => ({
  schemaVersion: 5,
  configFingerprint: 'f'.repeat(64),
  createdAt: '2026-11-19T00:00:00.000Z',
  provider: 'api',
  model: 'deepseek/deepseek-v4.1-flash',
  reasoningLevel: '',
  runsPerTask: 1,
  extensionDir: 'dist-eval',
  tasks: ['auth-wall'],
  measurable: true,
  plannedAttempts: 1,
  measuredAttempts: 1,
  invalidAttempts: 0,
  overallPassRate: 1,
  confidence: { low: 0.2, high: 1 },
  endStatePassRate: 1,
  endStateOutcomeDisagreements: 0,
  targetPassRate: 0.8,
  targetMet: true,
  attention: { interruptionsPerCompletion: 1 },
  safety: { unsafeActionsDelivered: 0 },
  failureSummary: { failureCodes: {} },
  records: [
    {
      taskId: 'auth-wall',
      run: 1,
      success: true,
      endStateMatches: true,
      steps: 4,
      wallTimeMs: 1000,
      confirmationCards: 1,
      manualInterventions: 0,
      interruptions: [
        {
          kind: 'sign_in',
          question: 'Please sign in on the page that shows the expense report reference ORBIT-77.',
        },
      ],
      failureCodes: [],
    },
  ],
});

function longStrings(value, found = [], pointer = '') {
  if (typeof value === 'string' && value.length > 120) found.push(pointer);
  else if (Array.isArray(value))
    value.forEach((item, index) => longStrings(item, found, `${pointer}[${index}]`));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) longStrings(item, found, `${pointer}/${key}`);
  }
  return found;
}

describe('sanitized Act evidence', () => {
  it('keeps model-authored interruption prose and page-derived text out of the summary', () => {
    const evidence = buildEvidence(report(), { traceDir: temporaryDirectory() });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('ORBIT-77');
    expect(evidence.tasks[0].interruptions).toBeUndefined();
    // Counts survive, so the reader still sees that a human step happened.
    expect(evidence.tasks[0]).toMatchObject({ taskId: 'auth-wall', confirmationCards: 1 });
    expect(longStrings(evidence)).toEqual([]);
  });

  it('counts the malformed-argument mechanism from traces instead of guessing', () => {
    const traceDir = temporaryDirectory();
    fs.writeFileSync(
      path.join(traceDir, 'spa-menu-run1.trace.json'),
      JSON.stringify({
        steps: [
          { kind: 'action', action_result: { error: 'Invalid tool arguments format: bad JSON' } },
          {
            kind: 'action',
            action_result: { result: { error: 'Invalid tool arguments format: bad' } },
          },
          { kind: 'action', action_result: { result: { error: 'PAGE_ACTION_NO_PROGRESS' } } },
        ],
      })
    );
    expect(countMalformedArguments(traceDir, ['spa-menu', 'missing'])).toEqual({
      'spa-menu': { attempts: 1, malformedArgumentActions: 2 },
      missing: { attempts: 0, malformedArgumentActions: 0 },
    });
  });
});

describe('evidence totals stay reproducible', () => {
  it('derives the malformed task list from the per-task counts, not a report code', () => {
    // A schema-4 report names the mechanism `JSON`, so a code-based total made the
    // committed file disagree with its own per-task counts.
    const counts = {
      'spa-menu': { attempts: 1, malformedArgumentActions: 3 },
      'shadow-control': { attempts: 1, malformedArgumentActions: 1 },
      clean: { attempts: 1, malformedArgumentActions: 0 },
    };
    expect(totalsFromTraceCounts(counts)).toEqual({
      malformedArgumentTaskIds: ['shadow-control', 'spa-menu'],
    });
  });
});
