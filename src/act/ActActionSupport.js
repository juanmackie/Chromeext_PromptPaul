/**
 * @fileoverview Run-scoped Act budget accounting and post-action receipts.
 * @module actActionSupport
 */
import { ACT_ACTION_BUDGETS, PAGE_ACTION_RECEIPT_DISPOSITIONS } from './ActLimits.js';
import { hasObservedPageScrollMovement } from './ActScrollState.js';

// Fraction of a budget at which a one-shot warning is emitted.
export const ACT_ACTION_BUDGET_WARNING_RATIO = 0.75;

/**
 * Consume one budget slot before an action dispatches. Emits a one-shot
 * warning event when the budget crosses the warning ratio.
 * @param {object} run Live run state (mutated in place).
 * @param {string} bucket Budget bucket name (observation|navigation|mutation).
 * @param {string} actionName Action about to dispatch.
 * @param {(runId: string, event: object) => void} emitEvent Event sink.
 * @returns {{ok: boolean, result?: object}}
 */
export function consumePageActionBudget(run, bucket, actionName, emitEvent) {
  const count = Number(run.pageActions.budgets?.[bucket] || 0);
  const limit = ACT_ACTION_BUDGETS[bucket];
  if (count >= limit) {
    return {
      ok: false,
      result: {
        error: 'PAGE_ACTION_LIMIT',
        budget: bucket,
        message: `The ${bucket} page-action budget was reached for this run (${limit}).`,
      },
    };
  }
  run.pageActions.budgets[bucket] = count + 1;
  run.pageActions.actions += 1;
  const warningAt = Math.ceil(limit * ACT_ACTION_BUDGET_WARNING_RATIO);
  if (count + 1 >= warningAt && !run.pageActions.budgetWarnings.has(bucket)) {
    run.pageActions.budgetWarnings.add(bucket);
    emitEvent(run.id, {
      type: 'page_action_warning',
      code: 'PAGE_ACTION_BUDGET_WARNING',
      action: actionName,
      budget: bucket,
      actions: count + 1,
      limit,
      message: `The ${bucket} page-action budget is nearly exhausted. Finish or summarize this part of the task soon.`,
    });
  }
  return { ok: true };
}

/**
 * Return a budget slot charged before an action that never reached the page.
 * Only pre-dispatch failures qualify: nothing was dispatched, so charging the
 * run for it would exhaust the mutation budget on actions the page never saw.
 * @param {object} run
 * @param {string} bucket
 */
export function refundPageActionBudget(run, bucket) {
  const count = Number(run?.pageActions?.budgets?.[bucket] || 0);
  if (count <= 0) return;
  run.pageActions.budgets[bucket] = count - 1;
  run.pageActions.actions = Math.max(0, Number(run.pageActions.actions || 0) - 1);
}

/**
 * Build the bounded action receipt from observed snapshot/navigation evidence.
 * @param {string} actionName
 * @param {object} result Executor result.
 * @param {object} previousSnapshot
 * @param {object} nextSnapshot
 * @param {boolean} navigationObserved
 * @param {boolean} [unexpectedNavigation]
 */
export function buildPageActionReceipt(
  actionName,
  result,
  previousSnapshot,
  nextSnapshot,
  navigationObserved,
  unexpectedNavigation = false
) {
  if (actionName === 'page_scroll') {
    const changed = hasObservedPageScrollMovement(previousSnapshot, nextSnapshot);
    return {
      disposition: changed ? 'delivered_verified' : 'delivered_unverified',
      evidence: { kind: 'scroll_position', changed },
    };
  }
  const supplied = result?.actionReceipt;
  if (supplied && typeof supplied === 'object') {
    const disposition = String(supplied.disposition || '');
    if (PAGE_ACTION_RECEIPT_DISPOSITIONS.has(disposition)) {
      const evidence = {
        kind: String(supplied.evidence?.kind || 'executor_observation').slice(0, 64),
      };
      if (typeof supplied.evidence?.matched === 'boolean')
        evidence.matched = supplied.evidence.matched;
      if (typeof supplied.evidence?.changed === 'boolean')
        evidence.changed = supplied.evidence.changed;
      if (supplied.evidence?.scope) evidence.scope = String(supplied.evidence.scope).slice(0, 32);
      if (typeof supplied.evidence?.pageEffectObserved === 'boolean') {
        evidence.pageEffectObserved = supplied.evidence.pageEffectObserved;
      }
      return {
        disposition,
        evidence,
      };
    }
  }

  if (actionName === 'page_get_state') {
    return {
      disposition: 'delivered_verified',
      evidence: { kind: 'snapshot_captured', snapshotId: nextSnapshot?.snapshotId || '' },
    };
  }

  if (actionName === 'page_wait' || actionName === 'page_batch') {
    return {
      disposition: 'delivered_verified',
      evidence: { kind: 'read_only_observation', changed: Boolean(nextSnapshot) },
    };
  }

  if (unexpectedNavigation) {
    return {
      disposition: 'delivered_unverified',
      evidence: { kind: 'page_changed_during_action', changed: true },
    };
  }

  if (navigationObserved) {
    return {
      disposition: 'delivered_verified',
      evidence: { kind: 'navigation_observed', url: nextSnapshot?.url || '' },
    };
  }

  if (
    actionName === 'page_click' &&
    result?.success === true &&
    previousSnapshot?.routeId &&
    nextSnapshot?.routeId &&
    previousSnapshot.routeId !== nextSnapshot.routeId
  ) {
    return {
      disposition: 'delivered_verified',
      evidence: { kind: 'route_changed' },
    };
  }

  return {
    disposition: 'delivered_unverified',
    evidence: {
      kind: result?.success === true ? 'executor_success_without_postcondition' : 'not_delivered',
      changed:
        Boolean(previousSnapshot?.fingerprint) &&
        Boolean(nextSnapshot?.fingerprint) &&
        previousSnapshot.fingerprint !== nextSnapshot.fingerprint,
    },
  };
}

import { MAX_APPROVAL_WAIT_EXTENSION_MS } from '../orchestrator/RunBudget.js';
import {
  getPageActionSiteOrigin,
  isPageActionSensitiveOrigin,
} from '../utils/pageActionSitePolicies.js';
import { sanitizePageActionUrl } from '../utils/pageDom.js';

/**
 * Request approval for a gated action and wait for the decision. The run's
 * provider-clock deadline is paused for the whole time the card is open and
 * extended by the elapsed approval time (capped by MAX_APPROVAL_WAIT_EXTENSION_MS).
 * @param {{assertActive: (run: object) => void, emitEvent: (runId: string, event: object) => void, extendDeadline: (run: object) => void}} deps
 * @param {object} run
 * @param {string} actionName
 * @param {object} args
 * @param {object} target
 * @param {object} policy
 * @returns {Promise<boolean>}
 */
export function requestPageActionConfirmation(deps, run, actionName, args, target, policy) {
  const { assertActive, emitEvent, extendDeadline } = deps;
  assertActive(run);
  if (run.pageActions.pendingConfirmation) {
    const error = new Error('Another page action is already waiting for approval.');
    error.code = 'PAGE_ACTION_CONFIRMATION_PENDING';
    throw error;
  }

  const confirmationId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const label = String(
    target?.label || target?.name || target?.text || target?.tag || 'page control'
  )
    .trim()
    .slice(0, 120);
  const summary = `${actionName.replace(/^page_/, '')} ${label}`.trim();
  // Bounded origin/title context so the user can tell which page the action
  // targets before approving; never includes query strings or secrets.
  const snapshot = run.pageActions.snapshot;
  let origin = '';
  try {
    origin = new URL(target?.frameOrigin || snapshot?.url || '').hostname;
  } catch (_) {
    origin = '';
  }
  const contextTitle = String(snapshot?.title || '')
    .trim()
    .slice(0, 120);
  let destination = '';
  let destinationOrigin = '';
  let destinationHasQueryOrFragment = false;
  try {
    if (target?.href) {
      const targetUrl = new URL(target.href);
      destination = sanitizePageActionUrl(targetUrl.href).slice(0, 240);
      destinationOrigin = targetUrl.hostname.slice(0, 120);
      destinationHasQueryOrFragment =
        target?.linkHasQueryOrFragment === true || Boolean(targetUrl.search || targetUrl.hash);
    }
  } catch (_) {
    destination = '';
    destinationOrigin = '';
  }
  return new Promise((resolve, reject) => {
    const timeoutMs = Math.min(
      MAX_APPROVAL_WAIT_EXTENSION_MS,
      Math.max(
        1_000,
        Number(run.config.pageActionConfirmationTimeoutMs) || MAX_APPROVAL_WAIT_EXTENSION_MS
      )
    );
    const timer = setTimeout(() => {
      const pending = run.pageActions.pendingConfirmation;
      if (!pending || pending.id !== confirmationId) return;
      emitEvent(run.id, {
        type: 'page_action_decision',
        confirmationId,
        approved: false,
        approveAll: false,
        timedOut: true,
        action: actionName,
      });
      pending.resolve(false, true);
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      if (run.pageActions.pendingConfirmation?.id !== confirmationId) return;
      run.pageActions.pendingConfirmation = null;
      reject(new DOMException('The run was aborted.', 'AbortError'));
    };
    run.abortController.signal.addEventListener('abort', onAbort, { once: true });
    run.pageActions.pendingConfirmation = {
      id: confirmationId,
      action: actionName,
      siteOrigin: getPageActionSiteOrigin(target?.frameOrigin || snapshot?.url),
      documentOrigin: getPageActionSiteOrigin(snapshot?.url || run.pageActions.documentUrl),
      resolve: (approved, timedOut = false) => {
        clearTimeout(timer);
        run.abortController.signal.removeEventListener('abort', onAbort);
        run.pageActions.pendingConfirmation = null;
        // Pause the deadline clock for the whole time the card waited, then
        // record a bounded declined marker when the user said no (covers the
        // explicit deny and the auto-timeout path in one place).
        extendDeadline(run);
        run.pageActions.confirmationTimedOut = timedOut;
        run.pageActions.lastDecisionOutcome = approved
          ? null
          : timedOut
            ? 'needs_confirmation'
            : 'declined';
        if (approved) {
          run.pageActions.lastDeniedAction = null;
        } else if (!timedOut) {
          run.pageActions.lastDeniedAction = {
            action: String(actionName).slice(0, 64),
            at: Date.now(),
          };
        }
        resolve(Boolean(approved));
      },
      reject: onAbort,
    };
    // Begin the approval-wait window that pauses the provider budget; the
    // extension is applied exactly once inside the resolve funnel above.
    run.resilience.approvalWaitStartedAt = Date.now();
    emitEvent(run.id, {
      type: 'page_action_confirmation',
      confirmationId,
      action: actionName,
      args: { ...args, text: undefined },
      summary,
      origin: origin.slice(0, 120),
      siteOrigin: getPageActionSiteOrigin(target?.frameOrigin || snapshot?.url),
      siteTrustAllowed:
        !isPageActionSensitiveOrigin(
          getPageActionSiteOrigin(target?.frameOrigin || snapshot?.url)
        ) &&
        !isPageActionSensitiveOrigin(
          getPageActionSiteOrigin(snapshot?.url || run.pageActions.documentUrl)
        ),
      destination,
      destinationOrigin,
      destinationHasQueryOrFragment,
      inputPreview:
        actionName === 'page_input' && target?.sensitive !== true && typeof args.text === 'string'
          ? args.text.slice(0, 280)
          : undefined,
      title: contextTitle,
      target: { label, tag: target?.tag || '', risk: policy.risk },
      risk: policy.risk,
      reason: policy.reason,
    });
  });
}
