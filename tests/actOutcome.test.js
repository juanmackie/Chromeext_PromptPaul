/**
 * @fileoverview Act terminal outcome derivation for re-verified runs.
 * @module actOutcomeTests
 */
import { describe, expect, it } from 'vitest';
import { deriveActOutcome } from '../src/orchestrator/ActOutcome.js';

function runWith({ receipt = null, reverified = false } = {}) {
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

  it('reports done for a verified last mutation without re-inspection', () => {
    expect(
      deriveActOutcome(runWith({ receipt: { disposition: 'delivered_verified' } }), 'complete')
    ).toEqual({ status: 'done', reason: null });
  });
});
