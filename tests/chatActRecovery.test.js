import { describe, it, expect } from 'vitest';
import { shouldGateActRetry, selectActRecoveryOutcome } from '../src/chat/ChatRunRecovery.js';

describe('shouldGateActRetry', () => {
  it('does not gate an ordinary Chat run (no Act outcome)', () => {
    expect(shouldGateActRetry(null)).toBe(false);
    expect(shouldGateActRetry(undefined)).toBe(false);
    expect(shouldGateActRetry({})).toBe(false);
    expect(shouldGateActRetry({ status: 'complete', verified: true })).toBe(false);
  });

  it('gates when the last delivery was unverified or in flight', () => {
    expect(shouldGateActRetry({ unverified: true })).toBe(true);
    expect(shouldGateActRetry({ status: 'in_flight' })).toBe(true);
    expect(shouldGateActRetry({ status: 'uncertain_delivery' })).toBe(true);
    expect(shouldGateActRetry({ lastReceipt: { disposition: 'delivered_unverified' } })).toBe(true);
    expect(shouldGateActRetry({ disposition: 'in_flight' })).toBe(true);
  });

  it('gates whenever an interrupted checkpoint exists', () => {
    expect(shouldGateActRetry({ hasCheckpoint: true })).toBe(true);
    expect(shouldGateActRetry({ hasCheckpoint: true, verified: true })).toBe(true);
  });

  it('does not gate a clean verified or not-delivered outcome', () => {
    expect(shouldGateActRetry({ dispose: 'delivered_verified' })).toBe(false);
    expect(shouldGateActRetry({ notDelivered: true, status: 'complete' })).toBe(false);
    expect(
      shouldGateActRetry({ lastReceipt: { disposition: 'not_delivered' }, status: 'complete' })
    ).toBe(false);
  });

  it('always gates when unverified regardless of other flags', () => {
    // Even an apparent success must not auto-replay if delivery was unverifiable.
    expect(shouldGateActRetry({ verified: true, completedSteps: 5, unverified: true })).toBe(true);
  });
});

describe('selectActRecoveryOutcome', () => {
  it('reports finished when there is no unresolved work and the task is done', () => {
    const out = selectActRecoveryOutcome({ status: 'complete', taskComplete: true });
    expect(out.hasVerifiedWork).toBe(false);
    expect(out.unresolved).toEqual([]);
    expect(out.recoveryAction).toBe('finished');
    expect(out.gated).toBe(false);
  });

  it('counts verified planner steps as verified work', () => {
    const out = selectActRecoveryOutcome({ status: 'complete', completedSteps: 3 });
    expect(out.hasVerifiedWork).toBe(true);
    expect(out.verifiedCount).toBe(3);
  });

  it('maps a pending approval to the existing approve control', () => {
    const out = selectActRecoveryOutcome({ status: 'running', waiting: 'approval' });
    expect(out.recoveryAction).toBe('approve');
    expect(out.unresolved).toContain('waiting-approval');
    expect(out.gated).toBe(false);
  });

  it('maps pending clarification to the existing answer control', () => {
    expect(selectActRecoveryOutcome({ waiting: 'answer' }).recoveryAction).toBe('answer');
  });

  it('maps a paused manual step to the existing Resume control', () => {
    expect(selectActRecoveryOutcome({ waiting: 'manual' }).recoveryAction).toBe('resume');
  });

  it('maps an unverified mutation to a gated fresh-inspection recovery', () => {
    const out = selectActRecoveryOutcome({
      status: 'complete',
      unverified: true,
      completedSteps: 2,
    });
    expect(out.recoveryAction).toBe('fresh-inspection');
    expect(out.gated).toBe(true);
    expect(out.hasVerifiedWork).toBe(true);
    expect(out.unresolved).toContain('unverified-mutation');
  });

  it('maps a present interrupted checkpoint to fresh-inspection', () => {
    expect(selectActRecoveryOutcome({ hasCheckpoint: true }).recoveryAction).toBe(
      'fresh-inspection'
    );
  });

  it('maps blocked planner steps to fresh-inspection', () => {
    const out = selectActRecoveryOutcome({ status: 'error', blockedSteps: 2 });
    expect(out.recoveryAction).toBe('fresh-inspection');
    expect(out.gated).toBe(true);
    expect(out.unresolved).toContain('blocked-steps');
  });

  it('suggests retry-or-continue for a terminal run left unfinished without changes', () => {
    const out = selectActRecoveryOutcome({ status: 'stopped', remainingSteps: 3 });
    expect(out.recoveryAction).toBe('retry-or-continue');
    expect(out.gated).toBe(false);
    expect(out.unresolved).toContain('unfinished-steps');
  });

  it('allows a plain retry only when nothing was changed on the page', () => {
    const out = selectActRecoveryOutcome({ status: 'error' });
    expect(out.recoveryAction).toBe('retry');
    expect(out.gated).toBe(false);
    expect(out.hasVerifiedWork).toBe(false);
  });

  it('prefers watch for an active run with no waiting interaction', () => {
    expect(selectActRecoveryOutcome({ status: 'running', active: true }).recoveryAction).toBe(
      'watch'
    );
  });

  it('never suggests raw re-run of unverified work', () => {
    const out = selectActRecoveryOutcome({ status: 'error', unverified: true, completedSteps: 1 });
    expect(out.recoveryAction).not.toBe('retry');
    expect(out.recoveryAction).not.toBe('retry-or-continue');
    expect(out.gated).toBe(true);
  });
});
