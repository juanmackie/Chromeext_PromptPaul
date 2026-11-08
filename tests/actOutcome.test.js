/**
 * @fileoverview Act terminal outcome derivation for re-verified runs.
 * @module actOutcomeTests
 */
import { describe, expect, it } from 'vitest';
import { deriveActOutcome } from '../src/act/index.js';

function runWith({
  receipt = null,
  reverified = false,
  pageMutationOccurred = false,
  finalVerificationCompleted = false,
} = {}) {
  return {
    status: 'complete',
    resilience: { wrapUp: false },
    pageActions: {
      enabled: true,
      lastBlockReason: null,
      lastDecisionOutcome: null,
      pendingConfirmation: null,
      confirmationTimedOut: false,
      lastDeniedAction: null,
      pendingManualIntervention: null,
      pendingUserInput: null,
      lastActionReceipt: receipt,
      reverifiedAfterUnverified: reverified,
      pageMutationOccurred,
      finalVerificationCompleted,
      snapshot: { snapshotId: 'evaluation-snapshot' },
      planner: null,
    },
  };
}

describe('deriveActOutcome re-verification', () => {
  it('reports ambiguous while the last mutation is unverified and unreinspected', () => {
    expect(
      deriveActOutcome(runWith({ receipt: { disposition: 'delivered_unverified' } }), 'complete')
    ).toEqual({ status: 'failed', reason: 'ambiguous' });
  });

  it('reports done after a fresh verified inspection follows the unverified mutation', () => {
    expect(
      deriveActOutcome(
        runWith({ receipt: { disposition: 'delivered_unverified' }, reverified: true }),
        'complete'
      )
    ).toEqual({ status: 'done', reason: null });
  });

  it('keeps an in-flight mutation ambiguous even after a verified inspection', () => {
    expect(
      deriveActOutcome(
        runWith({ receipt: { disposition: 'in_flight' }, reverified: true }),
        'complete'
      )
    ).toEqual({ status: 'failed', reason: 'ambiguous' });
  });

  it('requires a fresh final inspection after a delivered page mutation', () => {
    expect(
      deriveActOutcome(
        runWith({
          receipt: { disposition: 'delivered_verified' },
          pageMutationOccurred: true,
        }),
        'complete'
      )
    ).toEqual({ status: 'failed', reason: 'ambiguous' });
  });

  it('reports done after a delivered mutation receives fresh final verification', () => {
    expect(
      deriveActOutcome(
        runWith({
          receipt: { disposition: 'delivered_verified' },
          pageMutationOccurred: true,
          finalVerificationCompleted: true,
        }),
        'complete'
      )
    ).toEqual({ status: 'done', reason: null });
  });
});
