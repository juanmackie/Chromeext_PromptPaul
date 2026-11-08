/**
 * @fileoverview Provider-call limits and run-scoped deadline accounting.
 * @module RunBudget
 */

import { RUN_RESILIENCE_DEFAULTS } from '../utils/runResilience.js';

export const MAX_APPROVAL_WAIT_EXTENSION_MS = 10 * 60 * 1_000;

function clamp(value, fallback, min, max) {
  const normalized = Number(value);
  return Number.isFinite(normalized)
    ? Math.min(max, Math.max(min, Math.floor(normalized)))
    : fallback;
}

/** Normalize configurable provider budgets at the run boundary. */
export function createRunBudgetConfig(options = {}) {
  return {
    maxIterations: clamp(options.maxIterations, RUN_RESILIENCE_DEFAULTS.maxIterations, 1, 1_000),
    runBudgetMs: clamp(
      options.runBudgetMs,
      RUN_RESILIENCE_DEFAULTS.runBudgetMs,
      30_000,
      24 * 60 * 60 * 1_000
    ),
    maxProviderRetries: clamp(
      options.maxProviderRetries,
      RUN_RESILIENCE_DEFAULTS.maxProviderRetries,
      0,
      5
    ),
    requestTimeoutMs: clamp(
      options.requestTimeoutMs,
      RUN_RESILIENCE_DEFAULTS.requestTimeoutMs,
      1_000,
      30 * 60 * 1_000
    ),
  };
}

/** Create fresh provider budget state for one run. */
export function createRunBudgetState(config, now = Date.now()) {
  return {
    apiCallCount: 0,
    maxIterations: config.maxIterations,
    runBudgetMs: config.runBudgetMs,
    deadlineAt: now + config.runBudgetMs,
    graceCall: false,
    wrapUp: false,
    wrapUpNotice: false,
    providerRetries: 0,
    contextRecoveryAttempted: false,
    contextCompactions: 0,
    emptySignature: '',
    emptyStreak: 0,
  };
}

/** Claim one provider call, allowing one final call after a run limit. */
export function claimProviderCall(state, startedAt, now = Date.now()) {
  if (now >= startedAt + state.runBudgetMs * 0.8) state.wrapUpNotice = true;
  const exhausted = state.apiCallCount >= state.maxIterations || now >= state.deadlineAt;
  if (!exhausted) {
    state.apiCallCount += 1;
    return { claimed: true, wrapUp: false };
  }
  if (state.graceCall) return { claimed: false, wrapUp: false };
  state.graceCall = true;
  state.wrapUp = true;
  state.apiCallCount += 1;
  return { claimed: true, wrapUp: true };
}

/** Extend the provider deadline for a bounded approval-card wait. */
export function extendDeadlineForApprovalWait(state, now = Date.now()) {
  const startedAt = state?.approvalWaitStartedAt;
  if (!startedAt) return false;
  const elapsed = now - Number(startedAt);
  if (elapsed > 0) {
    state.deadlineAt =
      Number(state.deadlineAt || 0) + Math.min(elapsed, MAX_APPROVAL_WAIT_EXTENSION_MS);
    state.approvalWaitExtensions = Number(state.approvalWaitExtensions || 0) + 1;
  }
  state.approvalWaitStartedAt = null;
  return elapsed > 0;
}
