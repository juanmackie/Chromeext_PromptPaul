/**
 * @fileoverview Derive bounded Act outcomes from runtime evidence, not model claims.
 * @module ActOutcome
 */
import { isActQuotaComplete } from './ActWorkingMemory.js';
import { hasReceiptConsistentProgress } from './ActPlanner.js';

export const ACT_OUTCOME_REASONS = Object.freeze([
  'sign_in_required',
  'captcha',
  'needs_confirmation',
  'declined',
  'ambiguous',
  'loop_detected',
  'budget_exhausted',
  'site_blocked',
]);
const FAILURE_REASONS = new Set(['ambiguous', 'loop_detected', 'budget_exhausted']);

export function normalizeActOutcome(value) {
  if (!value || !['done', 'blocked', 'failed'].includes(value.status)) return null;
  if (value.status === 'done' ? value.reason !== null : !ACT_OUTCOME_REASONS.includes(value.reason))
    return null;
  return { status: value.status, reason: value.reason };
}
export function deriveActOutcome(run, terminalType = run?.status) {
  const pa = run?.pageActions;
  if (!pa?.enabled) return null;
  if (pa.siteBlocked) return { status: 'blocked', reason: 'site_blocked' };
  let reason = ACT_OUTCOME_REASONS.includes(pa.lastBlockReason) ? pa.lastBlockReason : null;
  if (['declined', 'needs_confirmation'].includes(pa.lastDecisionOutcome))
    reason = pa.lastDecisionOutcome;
  if (pa.pendingConfirmation || pa.confirmationTimedOut) reason = 'needs_confirmation';
  else if (pa.lastDeniedAction) reason = 'declined';
  else if (pa.pendingManualIntervention) reason ||= 'needs_confirmation';
  else if (pa.pendingUserInput) reason ||= 'ambiguous';
  if (!reason && run.resilience?.wrapUp) reason = 'budget_exhausted';
  const unresolvedPlan =
    pa.planner?.active &&
    (!hasReceiptConsistentProgress(pa.planner) || !pa.finalVerificationCompleted);
  // The last receipt only tracks mutations, so a fresh verified inspection after
  // an unverified mutation means the run re-observed state through the mandated
  // verify loop instead of flying blind. Only an in-flight mutation stays
  // ambiguous on receipt grounds; quota, skipped, blocked and confirmation
  // grounds below are unchanged.
  const lastReceiptUnresolved =
    pa.lastActionReceipt?.disposition === 'in_flight' ||
    (pa.lastActionReceipt?.disposition === 'delivered_unverified' &&
      pa.reverifiedAfterUnverified !== true);
  const requiredFinalVerificationMissing =
    pa.pageMutationOccurred === true && pa.finalVerificationCompleted !== true;
  if (
    !reason &&
    (unresolvedPlan ||
      !isActQuotaComplete(pa.planner) ||
      pa.planner?.subGoals?.some((goal) => goal.status === 'skipped') ||
      !pa.snapshot ||
      lastReceiptUnresolved ||
      requiredFinalVerificationMissing)
  )
    reason = 'ambiguous';
  if (!reason && terminalType !== 'complete') reason = 'ambiguous';
  return reason
    ? { status: FAILURE_REASONS.has(reason) ? 'failed' : 'blocked', reason }
    : { status: 'done', reason: null };
}

/** Classify a pause from observed page signals, never from the model's explanation. */
export function getActManualBlockReason(snapshot) {
  const controls = snapshot?.elements || [];
  if (
    controls.some((element) => element.type === 'password') &&
    controls.some((element) => /\b(?:sign[ -]?in|log[ -]?in)\b/i.test(element.label || ''))
  )
    return 'sign_in_required';
  const text = `${snapshot?.title || ''}\n${snapshot?.content || ''}`.slice(0, 24_200);
  if (/\bcaptcha\b|verify (?:that )?you are (?:a )?human/i.test(text)) return 'captcha';
  return 'needs_confirmation';
}

/** A fresh observation or verified action can clear recoverable machine errors. */
export function recordActOutcomeResult(pa, result = {}) {
  if (!pa) return;
  const reasons = {
    PAGE_ACTION_SITE_BLOCKED: 'site_blocked',
    PAGE_ACTION_LOOP_DETECTED: 'loop_detected',
    PAGE_ACTION_TOGGLE_LOOP: 'loop_detected',
    PAGE_ACTION_NO_PROGRESS: 'loop_detected',
    PAGE_ACTION_OCCLUDED_REPEATED: 'loop_detected',
    PAGE_ACTION_LIMIT: 'budget_exhausted',
    PAGE_ACTION_SIGN_IN_REQUIRED: 'sign_in_required',
    PAGE_ACTION_CAPTCHA: 'captcha',
    PAGE_USER_INPUT_TIMEOUT: 'ambiguous',
  };
  if (reasons[result.error]) pa.lastBlockReason = reasons[result.error];
  else if (result.error) pa.lastBlockReason ||= 'ambiguous';
  else if (
    !result.error &&
    (result.snapshot || result.actionReceipt?.disposition === 'delivered_verified')
  ) {
    pa.lastBlockReason = null;
    pa.confirmationTimedOut = false;
  }
}
