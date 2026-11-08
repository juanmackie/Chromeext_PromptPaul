/**
 * @fileoverview Act benchmark comparison gate contracts.
 * @module actScoreGateTests
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { compareActScores } = createRequire(import.meta.url)('../scripts/compare-act-scores.js');

const report = (overrides = {}) => ({
  provider: 'api',
  model: 'gpt-4.1-mini',
  runsPerTask: 2,
  tasks: ['search-enter', 'prefilled-form', 'validation-error'],
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

  it('rejects lower scores and incomparable reports', () => {
    expect(compareActScores(report(), report({ overallPassRate: 1 / 2 })).passed).toBe(false);
    expect(() => compareActScores(report(), report({ tasks: ['other-task'] }))).toThrow(
      'same model, tasks, provider, and run count'
    );
  });
});
