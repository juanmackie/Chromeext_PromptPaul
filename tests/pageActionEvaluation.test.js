/**
 * @fileoverview Credential-free browser-action evaluation corpus and guards.
 * @module pageActionEvaluation
 */

import { describe, expect, it } from 'vitest';
import corpus from './page-action-evaluation.json';
import {
  evaluatePageActionPolicy,
  normalizePageManualInterventionArgs,
} from '../src/utils/pageActionPolicy.js';

const REQUIRED_CASES = [
  'verified-input',
  'false-success-click',
  'partial-mutation-timeout',
  'stale-target',
  'repeated-mutation',
  'approval-timeout',
  'abort-pending-approval',
  'page-injection-is-data',
  'restricted-page',
  'sensitive-control',
  'hermes-page-actions-disabled',
];

const SAFE_PROVIDER_SET = new Set(['api', 'codex', 'hermes']);
const SECRET_PATTERN = /password|otp|api[-_ ]?key|token|secret|credential|payment/i;

export function createEvaluationRecord(testCase, provider) {
  return {
    caseId: testCase.id,
    provider,
    actionCount: 0,
    promptChars: 0,
    receiptDisposition: null,
    failureCode: null,
  };
}

describe('page-action evaluation corpus', () => {
  it('covers the required reliability and safety cases', () => {
    const ids = new Set(corpus.map((testCase) => testCase.id));
    expect([...ids]).toEqual(expect.arrayContaining(REQUIRED_CASES));
    expect(corpus).toHaveLength(REQUIRED_CASES.length);

    for (const testCase of corpus) {
      expect(testCase.id).toMatch(/^[a-z0-9-]+$/);
      expect(testCase.operation).toMatch(/^page_/);
      expect(testCase.providers.length).toBeGreaterThan(0);
      expect(testCase.providers.every((provider) => SAFE_PROVIDER_SET.has(provider))).toBe(true);
      expect(JSON.stringify(testCase)).not.toMatch(SECRET_PATTERN);
      for (const provider of testCase.providers) {
        expect(createEvaluationRecord(testCase, provider)).toMatchObject({
          caseId: testCase.id,
          provider,
          actionCount: 0,
          promptChars: 0,
        });
      }
    }
  });

  it('keeps sensitive controls blocked and manual prompts bounded', () => {
    expect(
      evaluatePageActionPolicy({
        actionName: 'page_input',
        target: { tag: 'input', label: 'Account password', sensitive: true },
        trustedMode: true,
      })
    ).toMatchObject({ allowed: false, risk: 'prohibited' });
    expect(
      normalizePageManualInterventionArgs({
        question: 'Complete the CAPTCHA in the visible tab, then resume.',
      }).valid
    ).toBe(true);
    expect(
      normalizePageManualInterventionArgs({ question: 'Enter the one-time code.' }).valid
    ).toBe(false);
  });

  it('keeps Hermes outside the client page-action provider matrix', () => {
    const hermesCase = corpus.find((testCase) => testCase.id === 'hermes-page-actions-disabled');
    expect(hermesCase.providers).toEqual(['hermes']);
    expect(corpus.filter((testCase) => testCase.providers.includes('hermes'))).toHaveLength(1);
  });
});
