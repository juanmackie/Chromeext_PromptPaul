/**
 * @fileoverview Act benchmark comparison gate contracts.
 * @module actScoreGateTests
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { compareActScores, readReport } = createRequire(import.meta.url)(
  '../scripts/compare-act-scores.js'
);

const report = (overrides = {}) => ({
  provider: 'api',
  model: 'gpt-4.1-mini',
  runsPerTask: 1,
  tasks: [
    'search-enter',
    'prefilled-form',
    'validation-error',
    'mind2web-37564222',
    'mind2web-1a16a98f',
    'mind2web-0633c328',
  ],
  overallPassRate: 2 / 3,
  ...overrides,
});

describe('Act score gate', () => {
  it('allows a held or improved score on the same fixed benchmark', () => {
    expect(compareActScores(report(), report({ overallPassRate: 1 }))).toMatchObject({
      baselinePassRate: 2 / 3,
      candidatePassRate: 1,
      passed: true,
    });
    expect(compareActScores(report(), report())).toMatchObject({ passed: true });
  });

  it('refuses a report whose attempts produced no measurement', () => {
    const filePath = path.join(os.tmpdir(), `act-report-${process.pid}-${Date.now()}.json`);
    const base = report({
      measurable: false,
      invalidAttempts: 34,
      records: report().tasks.map(() => ({})),
    });
    fs.writeFileSync(filePath, JSON.stringify(base));
    try {
      expect(() => readReport(filePath)).toThrow(/not a measured capability score/i);
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });

  it('rejects lower scores and incomparable reports', () => {
    expect(compareActScores(report(), report({ overallPassRate: 1 / 2 })).passed).toBe(false);
    expect(() => compareActScores(report(), report({ tasks: ['other-task'] }))).toThrow(
      'same model, tasks, provider, run count, and schema'
    );
    expect(() => compareActScores(report(), report({ schemaVersion: 4 }))).toThrow(
      'same model, tasks, provider, run count, and schema'
    );
  });
});
