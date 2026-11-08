/**
 * @fileoverview Run-scoped Act action execution and policy coordination.
 * @module actExecution
 */
import { ACT_ACTION_BUDGETS, PAGE_ACTION_RECEIPT_DISPOSITIONS } from './ActLimits.js';
import { recordPlannerEvidence, recordPlannerQuotaItem } from './ActPlanner.js';
import {
  createActWorkingMemory,
  hasActVisited,
  makeActTargetKey,
  markActVisited,
  recordActAction,
  shouldBlockActTarget,
} from './ActWorkingMemory.js';
import {
  hasObservedPageScrollMovement,
  pageScrollLocationKey,
  pageScrollStateKey,
  pageScrollVisitKey,
} from './ActScrollState.js';
import { normalizePageTaskNote } from './PageTaskMemory.js';
import { getActManualBlockReason, recordActOutcomeResult } from './ActOutcome.js';
import { hasReceiptConsistentProgress } from './ActPlanner.js';
import {
  PAGE_ACTION_OCCLUSION_CODE,
  PAGE_ACTION_RISKS,
  buildPageActionOcclusionFailure,
  evaluatePageActionPolicy,
  isPageActionName,
  isPageActionPreDispatchFailure,
  isPageActionReadOnly,
  isPageTabActionName,
  normalizePageActionArgs,
  normalizePageTabActionArgs,
  normalizePageUserInputArgs,
  normalizePageManualInterventionArgs,
} from '../utils/pageActionPolicy.js';
import { normalizePageSnapshot, pageStateHash, sanitizePageActionUrl } from '../utils/pageDom.js';
import { isPageActionSensitiveOrigin } from '../utils/pageActionSitePolicies.js';
import { buildIndexedPageRegions, diffPageActionSnapshots } from '../utils/pageActionScopeDiff.js';
import { recordDevDiagnostic } from '../utils/devDiagnostics.js';
import {
  clearPageActionCheckpoint,
  savePageActionCheckpoint,
} from '../utils/pageActionCheckpoint.js';
import { getPageActionSiteOrigin } from '../utils/pageActionSitePolicies.js';
import { MAX_APPROVAL_WAIT_EXTENSION_MS } from '../orchestrator/RunBudget.js';

const PAGE_ACTION_TAB_FAILURE_CODES = new Set([
  'PAGE_ACTION_NO_CONTENT_SCRIPT',
  'PAGE_ACTION_MESSAGE_FAILED',
  'PAGE_ACTION_TIMEOUT',
  'PAGE_ACTION_NAVIGATION_FAILED',
  'PAGE_ACTION_NAVIGATION_TIMEOUT',
  'PAGE_ACTION_TAB_UNAVAILABLE',
  'PAGE_ACTION_INJECTION_FAILED',
]);
const MAX_UNPRODUCTIVE_SCROLLS_PER_STATE = 3;
// Identical search queries repeated without verified progress are a stall loop:
// the model re-submits the same text instead of opening an observed match.
// The guard below tracks normalized query text (case/whitespace-insensitive,
// bounded) and blocks the third identical attempt until verified progress
// clears it. Counts are run-local and never checkpointed or journaled.
// page_input is tracked regardless of submit so repeated typing of the same
// query without an explicit submit still counts (observed in openrouter/free
// traces that typed then pressed Enter via page_keypress).
function normalizeActQueryKey(actionName, args = {}) {
  let raw = '';
  if (actionName === 'page_find_text') raw = args?.query ?? '';
  else if (actionName === 'page_input' && typeof args?.text === 'string') raw = args.text;
  else if (actionName === 'page_wait' && args?.text) raw = args.text;
  else return '';
  return String(raw).trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 160);
}
// Searches that never lead to opening a result are a stall loop: the model
// refines queries until the budget burns instead of acting on observed
// matches. Only an actual site-search submission counts. `page_find_text` is a
// read-only in-page observation (locating a label, caption, or price in the
// current document), not a search: counting it here blocked legitimate reading
// work after six lookups and pushed the model into pointless scrolls. Its own
// identical-query guard still blocks the third repeat of the same term.
// The counter resets on verified navigation. Run-local only; never
// checkpointed or journaled.
const MAX_UNOPENED_ACT_SEARCHES = 6;
function isActSearchAction(actionName, args = {}) {
  if (actionName === 'page_input' && args?.submit === true) return true;
  return false;
}
// Max wall-clock time an open approval card can extend the run deadline. A
// confirmation-gated action pauses the provider clock while the user decides;
// this cap bounds that pause so an abandoned card cannot immortalize a run.
const PAGE_ACTION_BUDGET_WARNING_RATIO = 0.75;

// Bounded cardinality/length caps for the readable Act progress event. Labels
// and target identity are always trimmed and are safe to persist in the journal.
export class ActExecutionMethods {
  _isPageActionTabFailure(error) {
    return Boolean(error && PAGE_ACTION_TAB_FAILURE_CODES.has(String(error.code || '')));
  }

  _getPageActionInstruction(run) {
    const plannerInstruction = run?.pageActions?.planner?.originalInstruction;
    if (plannerInstruction) return String(plannerInstruction).slice(0, 2_000);
    const messages = Array.isArray(run?.conversationHistory) ? run.conversationHistory : [];
    let latest = null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        latest = messages[index];
        break;
      }
    }
    const content =
      typeof latest?.content === 'string'
        ? latest.content
        : Array.isArray(latest?.content)
          ? latest.content
              .filter((part) => part?.type === 'text' || part?.type === 'input_text')
              .map((part) => String(part.text || part.content || ''))
              .join(' ')
          : '';
    const separator = content.indexOf('\n\n--- ');
    return (separator >= 0 ? content.slice(0, separator) : content).slice(0, 2_000);
  }

  async _savePageActionCheckpoint(run, actionName, toolCall, actionHash) {
    if (!run?.pageActions?.enabled || !this._isPageActionMutation(actionName)) return;
    const planner = run.pageActions.planner;
    await savePageActionCheckpoint({
      runId: run.id,
      sourceTabId: Number(run.sourceTabId) || null,
      targetTabId: Number(run.pageActions.targetTabId || run.sourceTabId) || null,
      profileId: run.config?.profileId,
      provider: run.config?.provider,
      instruction: this._getPageActionInstruction(run),
      actionName,
      toolCallId: toolCall?.id,
      actionHash,
      snapshotId: run.pageActions.snapshot?.snapshotId,
      status: 'in_flight',
      savedAt: Date.now(),
      budgets: run.pageActions.budgets,
      planner: planner
        ? {
            active: planner.active,
            currentSubGoalIndex: planner.currentSubGoalIndex,
            replanCount: planner.replanCount,
            subGoals: planner.subGoals,
            notesCount: run.pageActions.notes?.length || 0,
          }
        : null,
      receipt: run.pageActions.lastActionReceipt,
    });
  }

  async _settlePageActionCheckpoint(run, actionName, toolCall, actionHash, receipt) {
    if (!run?.id) return;
    if (actionName === 'page_get_state') {
      await clearPageActionCheckpoint(run.id);
      return;
    }
    if (!this._isPageActionMutation(actionName)) return;
    if (receipt?.disposition === 'delivered_unverified') {
      await savePageActionCheckpoint({
        runId: run.id,
        sourceTabId: Number(run.sourceTabId) || null,
        targetTabId: Number(run.pageActions.targetTabId || run.sourceTabId) || null,
        profileId: run.config?.profileId,
        provider: run.config?.provider,
        instruction: this._getPageActionInstruction(run),
        actionName,
        toolCallId: toolCall?.id,
        actionHash,
        snapshotId: run.pageActions.snapshot?.snapshotId,
        status: 'uncertain_delivery',
        savedAt: Date.now(),
        budgets: run.pageActions.budgets,
        planner: run.pageActions.planner
          ? {
              active: run.pageActions.planner.active,
              currentSubGoalIndex: run.pageActions.planner.currentSubGoalIndex,
              replanCount: run.pageActions.planner.replanCount,
              subGoals: run.pageActions.planner.subGoals,
              notesCount: run.pageActions.notes?.length || 0,
            }
          : null,
        receipt,
      });
      return;
    }
    await clearPageActionCheckpoint(run.id);
  }

  _isPageActionMutation(actionName) {
    if (isPageActionName(actionName)) {
      return !isPageActionReadOnly(actionName);
    }
    return isPageTabActionName(actionName) && actionName !== 'page_list_tabs';
  }

  _needsFreshPageInspection(run) {
    return Boolean(
      run?.pageActions?.lastActionReceipt?.disposition === 'delivered_unverified' &&
      run.pageActions.reverifiedAfterUnverified !== true &&
      run.pageActions.freshActionSnapshotAfterUnverified !== true
    );
  }

  _pageActionInspectionRequiredResult() {
    return {
      success: true,
      result: {
        error: 'PAGE_ACTION_INSPECTION_REQUIRED',
        message:
          'The previous mutation was not verified. Inspect the current page with page_get_state before taking another state-changing action.',
        actionReceipt: {
          disposition: 'not_delivered',
          evidence: { kind: 'inspection_required' },
        },
      },
    };
  }

  _assertPageActionRunActive(run) {
    if (run.abortController.signal.aborted || !this.activeRuns.has(run.id))
      throw new DOMException('The run was aborted.', 'AbortError');
  }

  _recordPlannerActionResult(run, actionName, outcome) {
    recordPlannerEvidence(run?.pageActions?.planner, actionName, outcome?.result);
    recordActOutcomeResult(run?.pageActions, outcome?.result);
  }

  _quarantinePageActionTab(run, error, failedTabId = null) {
    const tabId = Number(failedTabId || run.pageActions?.targetTabId || run.sourceTabId || 0);
    if (!run.pageActions.unavailableTabs) run.pageActions.unavailableTabs = new Set();
    if (tabId) run.pageActions.unavailableTabs.add(tabId);
    let recovery = { tabId, nextTargetTabId: null, available: false };
    try {
      recovery =
        this.pageActionTabFailureHandler?.(run.id, tabId, {
          code: error?.code,
          message: error?.message,
        }) || recovery;
    } catch (_) {
      // A tab registry failure must not turn a recoverable page failure into a
      // run-wide crash.
    }
    recordDevDiagnostic('page_action_tab_quarantined', {
      runId: run.id,
      tabId,
      error,
      recovery,
    });
    run.pageActions.documentUrl = null;
    run.pageActions.snapshot = null;
    run.pageActions.elementIndex = new Map();
    run.pageActions.elementIndexDocumentUrl = null;
    run.pageActions.lastActionHash = '';
    run.pageActions.lastActionReceipt = null;
    run.pageActions.reverifiedAfterUnverified = false;
    run.pageActions.freshActionSnapshotAfterUnverified = false;
    if (recovery.nextTargetTabId) {
      run.pageActions.targetTabId = recovery.nextTargetTabId;
    } else {
      // Keep the failed source tab addressable for a fresh page_get_state
      // probe after the user reloads it. Non-source tabs remain skipped.
      run.pageActions.targetTabId = tabId === run.sourceTabId ? tabId : null;
    }
    return recovery;
  }

  _pageActionBudgetBucket(actionName, target, policy = {}) {
    if (isPageActionReadOnly(actionName) || actionName === 'page_list_tabs') {
      return 'observation';
    }
    if (
      actionName === 'page_open_tab' ||
      actionName === 'page_open_link' ||
      actionName === 'page_switch_tab' ||
      actionName === 'page_go_back' ||
      policy.navigation === true ||
      (actionName === 'page_click' && target?.href)
    ) {
      return 'navigation';
    }
    return 'mutation';
  }

  _consumePageActionBudget(run, bucket, actionName) {
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
    const warningAt = Math.ceil(limit * PAGE_ACTION_BUDGET_WARNING_RATIO);
    if (count + 1 >= warningAt && !run.pageActions.budgetWarnings.has(bucket)) {
      run.pageActions.budgetWarnings.add(bucket);
      this._emitEvent(run.id, {
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
  _refundPageActionBudget(run, bucket) {
    const count = Number(run?.pageActions?.budgets?.[bucket] || 0);
    if (count <= 0) return;
    run.pageActions.budgets[bucket] = count - 1;
    run.pageActions.actions = Math.max(0, Number(run.pageActions.actions || 0) - 1);
  }

  /**
   * Single actionable message for an unreachable page-action bridge.
   * @returns {string}
   */
  _pageActionConnectionErrorMessage() {
    return (
      'The page stopped responding to page actions (the Prompt Paul content script is ' +
      'disconnected). Reload the tab and try again.'
    );
  }

  /**
   * Bounded activity message when the tab navigates during an Act run.
   * @returns {string}
   */
  _pageActionNavigationRecoveryMessage() {
    return (
      'The page changed during this run. The previous snapshot was discarded and the ' +
      'current page will be inspected before continuing.'
    );
  }

  /**
   * Read the current document identity and report whether it changed. A missing
   * identity is still treated as a terminal bridge/tab failure; a changed
   * identity is recoverable and must be adopted before another mutation.
   * @private
   * @param {object} run
   * @returns {Promise<{changed: boolean, unavailable?: boolean, url?: string}>}
   */
  async _checkPageActionDocument(run) {
    if (!this.pageActionDocumentProvider || !run.pageActions?.documentUrl) {
      return { changed: false };
    }
    let current = null;
    try {
      current = await this.pageActionDocumentProvider(
        run.pageActions.targetTabId || run.sourceTabId
      );
    } catch (_) {
      current = null;
    }
    const url = sanitizePageActionUrl(current?.url || '');
    if (!url) return { changed: false, unavailable: true };
    return { changed: url !== run.pageActions.documentUrl, url };
  }

  /**
   * Adopt a newly observed document and discard all state derived from the old
   * snapshot. The origin is recorded because the user explicitly enabled Act
   * for the active target tab and chose automatic continuation across page
   * changes.
   * @private
   * @param {object} run
   * @param {string} url
   */
  _adoptPageActionDocument(run, url) {
    const nextUrl = sanitizePageActionUrl(url);
    if (!nextUrl) return;
    run.pageActions.documentUrl = nextUrl;
    run.pageActions.snapshot = null;
    // Indices are only stable within one document, so a new document starts a
    // fresh index instead of carrying entries that no longer resolve.
    run.pageActions.elementIndex = new Map();
    run.pageActions.elementIndexDocumentUrl = nextUrl;
    run.pageActions.lastActionHash = '';
    run.pageActions.lastActionReceipt = null;
    run.pageActions.reverifiedAfterUnverified = false;
    run.pageActions.freshActionSnapshotAfterUnverified = false;
    run.pageActions.repeatedActionCount = 0;
    run.pageActions.noProgressMutationCount = 0;
    run.pageActions.occludedTargetKey = '';
    run.pageActions.occludedRepeatCount = 0;
    try {
      run.pageActions.allowedOrigins.add(new URL(nextUrl).origin);
    } catch (_) {
      // Sanitization already bounds the value; invalid URLs are ignored.
    }
  }

  /**
   * Accumulate the indexed controls observed for the current document.
   *
   * A region-scoped snapshot lists only its own slice of the index, so
   * replacing the element set with it strands every control the model already
   * found elsewhere on the page. Indices are global and stable within a
   * document, so entries merge by index rather than replace. The accumulator is
   * keyed to the snapshot URL, which makes a document change invalidate it
   * without separate bookkeeping.
   * @private
   * @param {object} run
   * @param {object|null} snapshot - Normalized snapshot to merge.
   */
  _mergePageActionElements(run, snapshot) {
    const pageActions = run?.pageActions;
    if (!pageActions || !Array.isArray(snapshot?.elements) || snapshot.elements.length === 0) {
      return;
    }
    const documentUrl = sanitizePageActionUrl(snapshot.url || '');
    if (!documentUrl || documentUrl !== pageActions.elementIndexDocumentUrl) {
      pageActions.elementIndex = new Map();
      pageActions.elementIndexDocumentUrl = documentUrl;
    }
    for (const element of snapshot.elements) {
      if (Number.isInteger(element?.index)) pageActions.elementIndex.set(element.index, element);
    }
  }

  /**
   * Resolve an indexed control from the accumulated document index, falling
   * back to the latest snapshot payload so a single-snapshot run is unchanged.
   * @private
   * @param {object} run
   * @param {number} index
   * @returns {object|null}
   */
  _resolvePageActionElement(run, index) {
    const pageActions = run?.pageActions;
    if (!pageActions) return null;
    const accumulated = pageActions.elementIndex?.get(index);
    if (accumulated) return accumulated;
    return pageActions.snapshot?.elements?.find((element) => element?.index === index) || null;
  }

  /**
   * Return the bounded result for a mutation that was not sent because its
   * snapshot belonged to the previous document.
   * @private
   * @param {object} run
   * @param {string} actionName
   * @returns {{success: boolean, result: object}}
   */
  _pageActionDocumentChangedResult(run, actionName) {
    const message = this._pageActionNavigationRecoveryMessage();
    this._emitEvent(run.id, {
      type: 'page_action_warning',
      code: 'PAGE_ACTION_PAGE_CHANGED',
      action: actionName,
      message,
    });
    return {
      success: true,
      result: {
        pageChanged: true,
        actionReceipt: {
          disposition: 'not_delivered',
          evidence: { kind: 'page_changed_before_action' },
        },
        notice: `${message} Call page_get_state before the next action.`,
      },
    };
  }

  _buildPageActionReceipt(
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

  _buildEvalDryRunResult(actionName, args, target, policy) {
    const sensitive = Boolean(target?.sensitive);
    const intendedArgs = { ...args };
    if (sensitive && intendedArgs.text !== undefined)
      intendedArgs.text = '[REDACTED_SENSITIVE_CONTROL]';
    return {
      success: true,
      result: {
        dryRun: true,
        message:
          'Evaluation dry-run intercepted this state-changing action before delivery. No page change occurred; do not retry the action or say it was performed.',
        intendedAction: {
          name: actionName,
          args: intendedArgs,
          target: {
            index: args.index,
            tag: target?.tag,
            role: target?.role,
            label: target?.label || target?.name || target?.tag,
            sensitive,
          },
          risk: policy.risk,
          requiresConfirmation: policy.requiresConfirmation,
        },
        actionReceipt: {
          disposition: 'not_delivered',
          evidence: { kind: 'dry_run_intercepted', risk: policy.risk },
        },
      },
    };
  }

  _blockPageActionSite(run) {
    const newlyBlocked = !run.pageActions.siteBlocked;
    run.pageActions.siteBlocked = true;
    run.pageActions.lastBlockReason = 'site_blocked';
    run.pageActions.snapshot = null;
    run.pageActions.navigationPending = false;
    const message =
      'Act stopped on a blocked site. Review site policies in Options and start a new run.';
    if (newlyBlocked)
      this._emitEvent(run.id, {
        type: 'page_action_warning',
        code: 'PAGE_ACTION_SITE_BLOCKED',
        message,
      });
    return { success: true, result: { error: 'PAGE_ACTION_SITE_BLOCKED', handled: true, message } };
  }

  async _pageActionSiteGate(run, tabId, destination = '') {
    if (run.pageActions.siteBlocked)
      return {
        success: true,
        result: {
          error: 'PAGE_ACTION_SITE_BLOCKED',
          message: 'This run stopped on a blocked site. Review site policies in Options.',
        },
      };
    if (!Object.keys(run.pageActions.sitePolicies || {}).length) return null;
    const current =
      destination ||
      (this.pageActionDocumentProvider
        ? (await this.pageActionDocumentProvider(tabId))?.url
        : run.pageActions.snapshot?.url || run.pageActions.documentUrl);
    const origin = getPageActionSiteOrigin(current);
    if (!origin)
      return {
        success: true,
        result: {
          error: 'PAGE_ACTION_UNAVAILABLE',
          message: 'The target site could not be verified before Act inspection.',
        },
      };
    const policy = evaluatePageActionPolicy({
      actionName: 'page_get_state',
      origin,
      sitePolicies: run.pageActions.sitePolicies,
    });
    if (policy.allowed) return null;
    return this._blockPageActionSite(run);
  }

  async _staleSnapshotRecovery(run, toolCall) {
    const refreshed = await this._executePageAction(run.id, 'page_get_state', {
      id: `stale-recovery-${toolCall?.id || Date.now()}`,
      type: 'function',
      function: { name: 'page_get_state', arguments: '{}' },
    });
    const snapshot = refreshed?.result?.snapshot || null;
    return {
      success: true,
      result: {
        error: 'PAGE_STATE_STALE',
        message: snapshot
          ? 'The requested action was not delivered. A fresh page snapshot is included below; use its snapshotId and current indices for the next action.'
          : 'The page snapshot is stale and automatic reinspection did not succeed. Call page_get_state before acting.',
        ...(snapshot ? { snapshot } : {}),
        actionReceipt: { disposition: 'not_delivered', evidence: { kind: 'stale_snapshot' } },
      },
    };
  }

  async _executePageAction(runId, actionName, toolCall) {
    const actionStartedAt = Date.now();
    const run = this.activeRuns.get(runId);
    recordDevDiagnostic('page_action_requested', {
      runId,
      toolCallId: toolCall?.id,
      action: actionName,
      targetTabId: run?.pageActions?.targetTabId || run?.sourceTabId || null,
      enabled: Boolean(run?.pageActions?.enabled),
    });
    if (!run || !run.pageActions?.enabled) {
      return {
        success: true,
        result: {
          error: 'PAGE_ACTIONS_DISABLED',
          message: 'Page actions are not enabled for this run.',
        },
      };
    }
    run.pageActions.currentActivityAction = actionName;
    // A fresh inspection means the model moved on from a denied action, so the
    // planner nudge and distinct declined card state clear on the next look.
    if (actionName === 'page_get_state') run.pageActions.lastDeniedAction = null;
    if (run.pageActions.pendingManualIntervention) {
      return {
        success: true,
        result: {
          error: 'PAGE_MANUAL_INTERVENTION_PENDING',
          message: 'Resume the manual step before using page actions.',
        },
      };
    }
    const currentTargetTabId = Number(run.pageActions.targetTabId || run.sourceTabId || 0) || null;
    const siteBlock = await this._pageActionSiteGate(run, currentTargetTabId);
    this._assertPageActionRunActive(run);
    if (siteBlock) return siteBlock;
    const targetUnavailable = run.pageActions.unavailableTabs?.has(currentTargetTabId);
    if (!currentTargetTabId || (targetUnavailable && actionName !== 'page_get_state')) {
      return {
        success: true,
        result: {
          error: 'PAGE_TASK_NO_HEALTHY_TABS',
          handled: true,
          scope: 'tab',
          message:
            'No healthy owned tab is available for this page action. Continue with recorded findings or ask the user to restore a tab.',
          actionReceipt: { disposition: 'not_delivered', evidence: { kind: 'no_healthy_tab' } },
        },
      };
    }
    if (targetUnavailable && actionName === 'page_get_state') {
      // A fresh inspection is the explicit recovery path after a user reload.
      // If it fails again, the catch path re-quarantines the tab.
      run.pageActions.unavailableTabs.delete(currentTargetTabId);
    }

    const normalized = normalizePageActionArgs(
      actionName,
      this._parseToolArguments(toolCall.function.arguments)
    );
    if (!normalized.valid) {
      return { success: true, result: { error: 'PAGE_ACTION_INVALID', message: normalized.error } };
    }

    const args = normalized.value;
    const indexedObservation =
      actionName === 'page_hover' || (actionName === 'page_scroll' && args.index != null);
    if (actionName === 'page_keypress' && args.index == null) {
      args.snapshotId ||= run.pageActions.snapshot?.snapshotId;
      args.focused = true;
    }
    // Keep the optional bounded model-supplied title for the progress card.
    // It is display-only, never sent to the page, and falls back to the
    // event-type label when absent.
    run.pageActions.currentActionTitle =
      typeof args?.title === 'string' && args.title.trim() ? String(args.title).slice(0, 80) : null;
    if (
      (!isPageActionReadOnly(actionName) || indexedObservation) &&
      args.snapshotId !== run.pageActions.snapshot?.snapshotId
    ) {
      return this._staleSnapshotRecovery(run, toolCall);
    }

    const isMutation = !isPageActionReadOnly(actionName);
    let actionTarget = null;
    if (args.focused) actionTarget = run.pageActions.snapshot?.focusedElement;
    else if (!isPageActionReadOnly(actionName) || indexedObservation)
      actionTarget = this._resolvePageActionElement(run, args.index);
    if (actionTarget?.elementKey) args.elementKey = actionTarget.elementKey;
    run.pageActions.memory ||= createActWorkingMemory();
    const stableTargetKey = actionTarget ? makeActTargetKey(actionTarget) : '';
    const scrollProgressKey =
      actionName === 'page_scroll'
        ? pageStateHash(
            JSON.stringify({
              fingerprint: run.pageActions.snapshot?.fingerprint || '',
              routeId: run.pageActions.snapshot?.routeId || '',
              direction: args.direction,
              focusedIndex: run.pageActions.snapshot?.focusedElement?.index ?? null,
              scrollState: {
                windowX: run.pageActions.snapshot?.scroll?.x,
                windowY: run.pageActions.snapshot?.scroll?.y,
                containers: (run.pageActions.snapshot?.scrollContainers || []).map((entry) => ({
                  index: entry.index,
                  top: entry.top,
                  left: entry.left,
                })),
              },
              target:
                args.containerIndex != null
                  ? `container:${args.containerIndex}`
                  : args.index != null
                    ? `element:${stableTargetKey}`
                    : 'viewport',
              position:
                args.containerIndex != null
                  ? (() => {
                      const container = run.pageActions.snapshot?.scrollContainers?.find(
                        (entry) => entry.index === args.containerIndex
                      );
                      return ['left', 'right'].includes(args.direction)
                        ? container?.left
                        : container?.top;
                    })()
                  : ['left', 'right'].includes(args.direction)
                    ? run.pageActions.snapshot?.scroll?.x
                    : run.pageActions.snapshot?.scroll?.y,
            })
          )
        : '';
    const scrollObservationStateKey =
      actionName === 'page_scroll' ? pageScrollStateKey(run.pageActions.snapshot) : '';
    if (
      actionName === 'page_scroll' &&
      run.pageActions.scrollStalled &&
      run.pageActions.scrollStallLocationKey !== pageScrollLocationKey(run)
    ) {
      run.pageActions.scrollStalled = false;
      run.pageActions.scrollStallLocationKey = '';
      run.pageActions.scrollStallRejectedCalls = 0;
      run.pageActions.scrollPositionVisits?.clear();
      run.pageActions.noProgressScrollCount = 0;
      run.pageActions.noProgressScrollKeys?.clear();
    }
    if (actionName === 'page_scroll' && run.pageActions.scrollStalled) {
      run.pageActions.scrollStallRejectedCalls += 1;
      if (run.pageActions.scrollStallRejectedCalls >= 2) run.resilience.wrapUp = true;
      return {
        success: true,
        result: {
          error: 'PAGE_SCROLL_STALLED',
          handled: true,
          message:
            'Scrolling is blocked because repeated scrolls did not advance this task. Use page_find_text or follow an observed relevant link. This repeated request was not sent to the page.',
          snapshot: run.pageActions.snapshot,
          actionReceipt: {
            disposition: 'not_delivered',
            evidence: { kind: 'scroll_stall_blocked' },
          },
        },
      };
    }
    if (scrollObservationStateKey) {
      if (
        run.pageActions.noProgressScrollStateKey &&
        run.pageActions.noProgressScrollStateKey !== scrollObservationStateKey
      ) {
        run.pageActions.noProgressScrollKeys?.clear();
        run.pageActions.noProgressScrollCount = 0;
      }
      run.pageActions.noProgressScrollStateKey = scrollObservationStateKey;
    }
    const previousNoProgressScroll = scrollProgressKey
      ? run.pageActions.noProgressScrollKeys?.get(scrollProgressKey)
      : null;
    if (previousNoProgressScroll) {
      return {
        success: true,
        result: {
          error: 'PAGE_SCROLL_NO_PROGRESS',
          handled: true,
          message:
            'A previous scroll from this position did not move the page, so the same target and direction were not dispatched again. Use another observed scroll container, search for the exact text, or follow an observed link.',
          snapshot: run.pageActions.snapshot,
          actionReceipt: {
            disposition: 'not_delivered',
            evidence: { kind: 'repeated_no_progress_scroll' },
          },
        },
      };
    }
    if (
      actionName === 'page_scroll' &&
      run.pageActions.noProgressScrollCount >= MAX_UNPRODUCTIVE_SCROLLS_PER_STATE
    ) {
      return {
        success: true,
        result: {
          error: 'PAGE_SCROLL_NO_PROGRESS',
          handled: true,
          message:
            'Three scroll attempts produced no visible movement on this page. Search for the exact text with page_find_text, follow an observed link, or inspect a different page instead of trying more scroll targets.',
          snapshot: run.pageActions.snapshot,
          actionReceipt: {
            disposition: 'not_delivered',
            evidence: { kind: 'scroll_stall_blocked' },
          },
        },
      };
    }
    const repeatedQueryKey = normalizeActQueryKey(actionName, args);
    const searchAction = isActSearchAction(actionName, args);
    if (repeatedQueryKey) {
      run.pageActions.repeatedQueryCounts ||= new Map();
      const priorRepeats = run.pageActions.repeatedQueryCounts.get(repeatedQueryKey) || 0;
      if (priorRepeats >= 2) {
        run.pageActions.loopWarnings += 1;
        const message =
          'This exact search query was already tried twice without verified progress, so it was not dispatched again. Open an observed matching result with page_open_link or page_click, refine the query with different terms, or summarize the verified findings instead of repeating the search.';
        this._emitEvent(run.id, {
          type: 'page_action_warning',
          code: 'PAGE_ACTION_REPEATED_QUERY',
          action: actionName,
          message,
        });
        return {
          success: true,
          result: {
            error: 'PAGE_ACTION_REPEATED_QUERY',
            handled: true,
            message,
            snapshot: run.pageActions.snapshot,
            actionReceipt: {
              disposition: 'not_delivered',
              evidence: { kind: 'repeated_query_blocked' },
            },
          },
        };
      }
    }
    if (searchAction && (run.pageActions.unopenedSearchCount || 0) >= MAX_UNOPENED_ACT_SEARCHES) {
      run.pageActions.loopWarnings += 1;
      const message =
        'Six consecutive searches produced no opened result, so this search was not dispatched. Open the best observed matching result with page_open_link or page_click instead of searching again, or summarize the verified findings. page_find_text is not a search and remains available for reading the current page.';
      this._emitEvent(run.id, {
        type: 'page_action_warning',
        code: 'PAGE_ACTION_SEARCH_WITHOUT_OPEN',
        action: actionName,
        message,
      });
      return {
        success: true,
        result: {
          error: 'PAGE_ACTION_SEARCH_WITHOUT_OPEN',
          handled: true,
          message,
          snapshot: run.pageActions.snapshot,
          actionReceipt: {
            disposition: 'not_delivered',
            evidence: { kind: 'search_without_open_blocked' },
          },
        },
      };
    }
    if (isMutation && shouldBlockActTarget(run.pageActions.memory, stableTargetKey)) {
      run.pageActions.loopWarnings += 1;
      const message =
        'This control already toggled back to its previous state. The repeat activation was blocked; choose a different control or ask for guidance.';
      this._emitEvent(run.id, {
        type: 'page_action_warning',
        code: 'PAGE_ACTION_TOGGLE_LOOP',
        action: actionName,
        message,
      });
      return {
        success: true,
        result: {
          error: 'PAGE_ACTION_TOGGLE_LOOP',
          handled: true,
          message,
          actionReceipt: {
            disposition: 'not_delivered',
            evidence: { kind: 'toggle_loop_blocked' },
          },
        },
      };
    }
    const actionHash = pageStateHash(
      JSON.stringify({
        actionName,
        index: args.index ?? null,
        option: args.option ?? null,
        key: args.key ?? null,
        count: args.count ?? null,
        submit: args.submit === true,
        valueHash: args.value ? pageStateHash(args.value) : '',
        mode: args.mode ?? null,
        textHash: args.text ? pageStateHash(args.text) : '',
        targetLabel: actionTarget?.label || actionTarget?.name || actionTarget?.tag || '',
        targetText: actionTarget?.text || '',
        targetChecked: actionTarget?.checked ?? null,
        valueHashBefore: actionTarget?.value ? pageStateHash(actionTarget.value) : '',
        fingerprint: run.pageActions.snapshot?.fingerprint || '',
      })
    );
    const repeatsPreviousAction = isMutation && actionHash === run.pageActions.lastActionHash;
    // Count only mutations that reached the page executor. A stale or
    // obscured target was never delivered, so counting it here can permanently
    // lock the model out of the only action that could change the page.
    if (isMutation && repeatsPreviousAction && run.pageActions.repeatedActionCount >= 2) {
      run.pageActions.loopWarnings += 1;
      this._emitEvent(run.id, {
        type: 'page_action_warning',
        code: 'PAGE_ACTION_LOOP_DETECTED',
        action: actionName,
        message:
          'The same page mutation was requested repeatedly without a visible page-state change. Inspect the page or ask the user for clarification.',
      });
      return {
        success: true,
        result: {
          error: 'PAGE_ACTION_LOOP_DETECTED',
          message:
            'The same page mutation was blocked after repeated attempts without a visible state change. Call page_get_state or ask the user for clarification.',
        },
      };
    }

    // A dispatched mutation that produced neither a page change nor a verified
    // receipt made no progress. Unlike the repeated-action guard above, this sees
    // a run that keeps trying *different* controls that all do nothing, which an
    // action-hash comparison cannot detect.
    if (isMutation && (run.pageActions.noProgressMutationCount || 0) >= 3) {
      run.pageActions.loopWarnings += 1;
      this._emitEvent(run.id, {
        type: 'page_action_warning',
        code: 'PAGE_ACTION_NO_PROGRESS',
        action: actionName,
        message:
          'Three page mutations in a row had no visible effect. Inspect the page or ask the user for clarification.',
      });
      return {
        success: true,
        result: {
          error: 'PAGE_ACTION_NO_PROGRESS',
          message:
            'Three page mutations produced no page change and no verified result, so this one was blocked. Call page_get_state to inspect the page, try a different control, or ask the user for clarification.',
        },
      };
    }

    const target = actionTarget;
    if ((!isPageActionReadOnly(actionName) || actionName === 'page_hover') && !target) {
      return {
        success: true,
        result: {
          error: 'PAGE_STATE_STALE',
          message: 'The target is not in the current page snapshot. Call page_get_state again.',
        },
      };
    }
    if (isMutation && this._needsFreshPageInspection(run))
      return this._pageActionInspectionRequiredResult();

    const actionOrigin = getPageActionSiteOrigin(
      actionTarget?.frameOrigin || run.pageActions.snapshot?.url || run.pageActions.documentUrl
    );
    const documentOrigin = getPageActionSiteOrigin(
      run.pageActions.snapshot?.url || run.pageActions.documentUrl
    );
    const sensitiveOrigin =
      isPageActionSensitiveOrigin(actionOrigin) || isPageActionSensitiveOrigin(documentOrigin);
    const sessionApproval = run.pageActions.sessionApproval && !sensitiveOrigin;
    const policy = evaluatePageActionPolicy({
      actionName,
      target,
      args,
      trustedMode: run.pageActions.trustedMode,
      origin: actionOrigin,
      documentOrigin,
      sitePolicies: run.pageActions.sitePolicies,
    });
    const diagnosticTarget = target
      ? {
          index: args.index,
          tag: target.tag,
          role: target.role,
          sensitive: Boolean(target.sensitive),
          disabled: target.disabled === true,
          hasHref: Boolean(target.href),
          valuePresent: Boolean(target.valuePresent),
        }
      : null;
    recordDevDiagnostic(
      'page_action_policy_detail',
      {
        runId,
        toolCallId: toolCall?.id,
        action: actionName,
        tabId: currentTargetTabId,
        args: target?.sensitive ? { ...args, text: '[REDACTED_SENSITIVE_CONTROL]' } : args,
        target: diagnosticTarget,
        policy,
      },
      { persist: false }
    );
    recordDevDiagnostic('page_action_policy', {
      runId,
      toolCallId: toolCall?.id,
      action: actionName,
      tabId: currentTargetTabId,
      target: diagnosticTarget,
      policy,
    });
    if (!policy.allowed) {
      return {
        success: true,
        result: {
          error: policy.code || 'PAGE_ACTION_BLOCKED',
          message: policy.reason,
          risk: policy.risk,
        },
      };
    }
    if (
      target?.href &&
      (actionName === 'page_click' || (actionName === 'page_keypress' && args.key === 'Enter'))
    ) {
      const destinationBlock = await this._pageActionSiteGate(run, currentTargetTabId, target.href);
      this._assertPageActionRunActive(run);
      if (destinationBlock) return destinationBlock;
    }
    // Dry-run proposals are never dispatched; report the real policy requirement
    // without asking a person to approve an action that will not occur.
    if (run.config?.evalDryRun === true && isMutation) {
      const dryRunResult = this._buildEvalDryRunResult(actionName, args, target, policy);
      run.pageActions.evalDryRunMutationIntercepted = true;
      run.pageActions.evalDryRunFinalInspectionComplete = false;
      run.pageActions.lastActionReceipt = dryRunResult.result.actionReceipt;
      this._emitEvent(run.id, {
        type: 'page_action_state',
        state: 'complete',
        action: actionName,
        receipt: dryRunResult.result.actionReceipt,
        target: { label: target.label || target.name || target.tag, risk: policy.risk },
      });
      return dryRunResult;
    }

    let safeLinkNavigation = false;
    if (target?.href && policy.navigation === true) {
      try {
        safeLinkNavigation = ['http:', 'https:'].includes(new URL(target.href).protocol);
      } catch (_) {
        safeLinkNavigation = false;
      }
    }
    // Act grants a bounded read/navigation lease. Safe HTTP(S) link navigation
    // does not require a new per-site prompt; writes and risky controls still
    // use the normal confirmation policy.
    const requiresConfirmation =
      policy.risk === PAGE_ACTION_RISKS.HIGH ||
      (policy.requiresConfirmation && !safeLinkNavigation && !sessionApproval);
    let explicitlyApproved = false;
    if (requiresConfirmation) {
      recordDevDiagnostic('page_action_approval_requested', {
        runId,
        action: actionName,
        risk: policy.risk,
        reason: policy.reason,
      });
      const approved = await this._requestPageActionConfirmation(
        run,
        actionName,
        args,
        target,
        policy
      );
      recordDevDiagnostic('page_action_approval_decision', {
        runId,
        action: actionName,
        approved,
        risk: policy.risk,
      });
      if (!approved) {
        return {
          success: true,
          result: {
            error: 'PAGE_ACTION_DENIED',
            message: 'The user denied this page action.',
            risk: policy.risk,
          },
        };
      }
      explicitlyApproved = true;
    }

    // Bind the run to the document the model first observes. If the active tab
    // changed since the last snapshot, adopt the new document and never send a
    // stale mutation. page_get_state is allowed to proceed so it can establish
    // the fresh snapshot in the same tool turn.
    if (run.pageActions.documentUrl) {
      const documentStatus = await this._checkPageActionDocument(run);
      if (documentStatus.unavailable) {
        const error = new Error(this._pageActionConnectionErrorMessage());
        error.code = 'PAGE_ACTION_NO_CONTENT_SCRIPT';
        throw error;
      }
      if (documentStatus.changed) {
        this._adoptPageActionDocument(run, documentStatus.url);
        if (!isPageActionReadOnly(actionName)) {
          return this._pageActionDocumentChangedResult(run, actionName);
        }
      }
    }

    const budgetBucket = this._pageActionBudgetBucket(actionName, target, policy);
    const budget = this._consumePageActionBudget(run, budgetBucket, actionName);
    recordDevDiagnostic('page_action_budget', {
      runId,
      action: actionName,
      bucket: budgetBucket,
      result: budget,
      used: run.pageActions.budgets?.[budgetBucket],
      limits: ACT_ACTION_BUDGETS,
    });
    if (!budget.ok) return budget;
    if (isMutation) await this._savePageActionCheckpoint(run, actionName, toolCall, actionHash);
    this._emitEvent(run.id, {
      type: 'page_action_state',
      state: 'running',
      action: actionName,
      target: target
        ? { label: target.label || target.name || target.tag, risk: policy.risk }
        : null,
    });
    // A confirmed or session-approved click may navigate even when the
    // control's label does not match the conservative navigation-word
    // heuristic (for example a Tasks icon). Treat that approval as permission
    // for one transition; trusted-mode-only ordinary clicks do not get this
    // fallback.
    const expectedNavigation =
      policy.navigation === true ||
      ((actionName === 'page_click' ||
        (actionName === 'page_keypress' && args.key === 'Enter') ||
        (actionName === 'page_input' && args.submit === true)) &&
        (explicitlyApproved || sessionApproval));
    run.pageActions.navigationPending = expectedNavigation;
    let result;
    const previousSnapshot = run.pageActions.snapshot;
    try {
      const previousDocumentUrl = run.pageActions.documentUrl;
      result = await this.pageActionExecutor(
        run.pageActions.targetTabId || run.sourceTabId,
        actionName,
        args,
        {
          runId,
          signal: run.abortController.signal,
          expectNavigation: expectedNavigation,
        }
      );
      const landedBlock = await this._pageActionSiteGate(
        run,
        currentTargetTabId,
        result?.navigationUrl || result?.snapshot?.url || ''
      );
      if (landedBlock) return landedBlock;
      const reportedNavigationUrl = sanitizePageActionUrl(result?.navigationUrl || '');
      const normalizedSnapshot = result?.snapshot ? normalizePageSnapshot(result.snapshot) : null;
      const snapshotChangedDocument = Boolean(
        normalizedSnapshot?.url &&
        previousDocumentUrl &&
        normalizedSnapshot.url !== previousDocumentUrl
      );
      const navigationObserved = Boolean(result?.navigated || snapshotChangedDocument);

      const unexpectedNavigation =
        navigationObserved && !expectedNavigation && actionName !== 'page_get_state';

      if (navigationObserved) {
        const nextDocumentUrl = reportedNavigationUrl || normalizedSnapshot?.url || '';
        if (!nextDocumentUrl) {
          const navigationError = new Error(
            'The approved page navigation completed without a readable destination.'
          );
          navigationError.code = 'PAGE_ACTION_NAVIGATION_FAILED';
          throw navigationError;
        }
        if (unexpectedNavigation) {
          // The action may have been delivered before the document changed, so
          // retain only an unverified receipt and force a fresh inspection.
          this._adoptPageActionDocument(run, nextDocumentUrl);
          result.navigated = true;
          result.pageChanged = true;
          result.snapshot = undefined;
          result.notice = `${this._pageActionNavigationRecoveryMessage()} Call page_get_state before the next action.`;
        } else {
          // An approved navigation, or a fresh page_get_state response, replaces
          // the document identity. Full navigations force the next turn through
          // page_get_state because the old bridge has no usable snapshot.
          this._adoptPageActionDocument(run, nextDocumentUrl);
          const snapshotMatchesNavigation =
            Boolean(normalizedSnapshot?.url) && normalizedSnapshot.url === nextDocumentUrl;
          run.pageActions.snapshot = snapshotMatchesNavigation ? normalizedSnapshot : null;
          if (snapshotMatchesNavigation) {
            this._mergePageActionElements(run, normalizedSnapshot);
            result.snapshot = normalizedSnapshot;
          } else {
            result.snapshot = undefined;
          }
        }
      } else if (normalizedSnapshot) {
        run.pageActions.snapshot = normalizedSnapshot;
        // Keep controls from earlier snapshots of this same document resolvable.
        this._mergePageActionElements(run, normalizedSnapshot);
        result.snapshot = normalizedSnapshot;
        this._capturePageTaskTarget(run, normalizedSnapshot);
        if (actionName === 'page_get_state') {
          run.pageActions.scrollPositionVisits ||= new Map();
          if (run.pageActions.scrollPositionVisits.size === 0) {
            run.pageActions.scrollPositionVisits.set(pageScrollVisitKey(normalizedSnapshot), 1);
          }
        }
        if (!run.pageActions.documentUrl && normalizedSnapshot.url) {
          // First observation binds the run to this document.
          run.pageActions.documentUrl = normalizedSnapshot.url;
        }
        if (normalizedSnapshot.url) {
          try {
            run.pageActions.allowedOrigins.add(new URL(normalizedSnapshot.url).origin);
          } catch (_) {
            // The normalized URL is already bounded; an invalid value is ignored.
          }
        }
      }

      if (actionName === 'page_find_text' && result && typeof result === 'object') {
        // Link indices resolve against the orchestrator's merged, frame-aware
        // snapshot. The content script's local session ID is not accepted by
        // page_open_link and would make a valid observed result unusable.
        result.snapshotId = run.pageActions.snapshot?.snapshotId || null;
      }

      const receipt = this._buildPageActionReceipt(
        actionName,
        result,
        previousSnapshot,
        normalizedSnapshot,
        navigationObserved,
        unexpectedNavigation
      );
      result.actionReceipt = receipt;
      const verifiedActProgress =
        (actionName === 'page_find_text' && result?.found === true) ||
        (navigationObserved && !unexpectedNavigation) ||
        (isMutation && receipt?.disposition === 'delivered_verified');
      if (verifiedActProgress) {
        run.pageActions.scrollStalled = false;
        run.pageActions.scrollStallLocationKey = '';
        run.pageActions.scrollStallRejectedCalls = 0;
        run.pageActions.scrollPositionVisits?.clear();
        run.pageActions.noProgressScrollCount = 0;
        run.pageActions.noProgressScrollKeys?.clear();
      }
      if (repeatedQueryKey) {
        run.pageActions.repeatedQueryCounts ||= new Map();
        const prior = run.pageActions.repeatedQueryCounts.get(repeatedQueryKey) || 0;
        run.pageActions.repeatedQueryCounts.set(repeatedQueryKey, prior + 1);
        while (run.pageActions.repeatedQueryCounts.size > 12) {
          const oldestKey = run.pageActions.repeatedQueryCounts.keys().next().value;
          run.pageActions.repeatedQueryCounts.delete(oldestKey);
        }
      }
      // Verified non-search navigation proves the run moved past the search
      // loop (a result was opened), so the identical-query history and the
      // unopened-search streak reset. This check sits outside the query-key
      // block because opening actions (click, open_link) carry no query text.
      // A navigating search submission does not reset them: results were
      // shown but nothing was opened. Verified field read-backs do not clear
      // them either.
      if (
        receipt?.disposition === 'delivered_verified' &&
        (navigationObserved || unexpectedNavigation) &&
        !searchAction
      ) {
        run.pageActions.repeatedQueryCounts?.clear();
        run.pageActions.unopenedSearchCount = 0;
      }
      if (searchAction) {
        run.pageActions.unopenedSearchCount = (run.pageActions.unopenedSearchCount || 0) + 1;
      }
      if (actionName === 'page_scroll') {
        run.pageActions.noProgressScrollKeys ||= new Map();
        const scrollMoved = hasObservedPageScrollMovement(previousSnapshot, normalizedSnapshot);
        if (receipt?.disposition === 'delivered_unverified' && scrollProgressKey) {
          if (run.pageActions.noProgressScrollStateKey !== scrollObservationStateKey) {
            run.pageActions.noProgressScrollStateKey = scrollObservationStateKey;
            run.pageActions.noProgressScrollCount = 0;
          }
          run.pageActions.noProgressScrollCount += 1;
          run.pageActions.noProgressScrollKeys.set(scrollProgressKey, Date.now());
          while (run.pageActions.noProgressScrollKeys.size > 12) {
            const oldestKey = run.pageActions.noProgressScrollKeys.keys().next().value;
            run.pageActions.noProgressScrollKeys.delete(oldestKey);
          }
        } else if (scrollMoved) {
          run.pageActions.noProgressScrollKeys.clear();
          run.pageActions.noProgressScrollCount = 0;
          run.pageActions.noProgressScrollStateKey = pageScrollStateKey(normalizedSnapshot);
          run.pageActions.scrollPositionVisits ||= new Map();
          const nextPositionKey = pageScrollVisitKey(normalizedSnapshot);
          const priorVisits = run.pageActions.scrollPositionVisits.get(nextPositionKey) || 0;
          run.pageActions.scrollPositionVisits.set(nextPositionKey, priorVisits + 1);
          while (run.pageActions.scrollPositionVisits.size > 16) {
            const oldestKey = run.pageActions.scrollPositionVisits.keys().next().value;
            run.pageActions.scrollPositionVisits.delete(oldestKey);
          }
          if (priorVisits > 0) {
            run.pageActions.scrollStalled = true;
            run.pageActions.scrollStallLocationKey = pageScrollLocationKey(run);
            run.pageActions.scrollStallRejectedCalls = 0;
          }
        }
        if (run.pageActions.noProgressScrollCount >= MAX_UNPRODUCTIVE_SCROLLS_PER_STATE) {
          run.pageActions.scrollStalled = true;
          run.pageActions.scrollStallLocationKey = pageScrollLocationKey(run);
          run.pageActions.scrollStallRejectedCalls = 0;
        }
      }
      if (isMutation) {
        run.pageActions.lastActionReceipt = receipt;
        // Any dispatched mutation is page interaction, so a prior occlusion
        // streak for another target no longer describes consecutive attempts.
        run.pageActions.occludedTargetKey = '';
        run.pageActions.occludedRepeatCount = 0;
        run.pageActions.reverifiedAfterUnverified = false;
        run.pageActions.freshActionSnapshotAfterUnverified = Boolean(
          receipt?.disposition === 'delivered_unverified' &&
          normalizedSnapshot &&
          !navigationObserved &&
          !unexpectedNavigation
        );
        if (repeatsPreviousAction) run.pageActions.repeatedActionCount += 1;
        else {
          run.pageActions.lastActionHash = actionHash;
          run.pageActions.repeatedActionCount = 1;
        }
        // Progress means the page changed, or the action proved its own effect
        // with a verified receipt (a matching input read-back, for example).
        // Typing into a field therefore never counts as progress-free even when
        // the fingerprint cannot see the new value.
        const snapshotChanged = Boolean(
          previousSnapshot?.fingerprint &&
          normalizedSnapshot?.fingerprint &&
          previousSnapshot.fingerprint !== normalizedSnapshot.fingerprint
        );
        const madeProgress =
          Boolean(result?.pageChanged) ||
          snapshotChanged ||
          receipt?.disposition === 'delivered_verified';
        run.pageActions.noProgressMutationCount = madeProgress
          ? 0
          : (run.pageActions.noProgressMutationCount || 0) + 1;
      } else {
        if (actionName === 'page_get_state')
          run.pageActions.freshActionSnapshotAfterUnverified = false;
        // A fresh snapshot clears the streak only when it shows a page change.
        // Re-reading an unchanged page must not let a mutation loop reset its
        // no-progress counter.
        const observedPageChange = Boolean(
          actionName === 'page_get_state' &&
          previousSnapshot?.fingerprint &&
          normalizedSnapshot?.fingerprint &&
          previousSnapshot.fingerprint !== normalizedSnapshot.fingerprint
        );
        if (observedPageChange) run.pageActions.noProgressMutationCount = 0;
        // A fresh verified observation re-grounds the run after an unverified
        // mutation, so the terminal outcome no longer blames a stale receipt.
        if (
          actionName === 'page_get_state' &&
          receipt?.disposition === 'delivered_verified' &&
          result?.snapshot
        ) {
          run.pageActions.reverifiedAfterUnverified = true;
        }
        if (
          actionName === 'page_get_state' &&
          run.config?.evalDryRun === true &&
          run.pageActions.evalDryRunMutationIntercepted &&
          receipt?.disposition === 'delivered_verified' &&
          result?.snapshot
        ) {
          run.pageActions.evalDryRunFinalInspectionComplete = true;
        }
      }
      if (isMutation && previousSnapshot && normalizedSnapshot) {
        result.scopeDiff = {
          ...diffPageActionSnapshots(previousSnapshot, normalizedSnapshot),
          regions: buildIndexedPageRegions(normalizedSnapshot),
        };
      }
      if (actionName === 'page_get_state' && normalizedSnapshot?.routeId) {
        markActVisited(run.pageActions.memory, 'route', normalizedSnapshot.routeId);
      }
      const routeEntered = Boolean(
        isMutation &&
        normalizedSnapshot?.routeId &&
        receipt.disposition === 'delivered_verified' &&
        (navigationObserved || receipt.evidence?.kind === 'route_changed')
      );
      const routeWasVisited = routeEntered
        ? hasActVisited(run.pageActions.memory, 'route', normalizedSnapshot.routeId)
        : true;
      if (routeEntered && !routeWasVisited && run.pageActions.planner?.quota) {
        const routeLabel = actionTarget?.label || actionTarget?.name || normalizedSnapshot.title;
        const safeQuotaItem = normalizePageTaskNote({
          text: 'A verified page route was entered.',
          item: routeLabel,
          status: 'done',
        });
        if (safeQuotaItem.valid) {
          recordPlannerQuotaItem(run.pageActions.planner, safeQuotaItem.value.item, 'done');
        }
      }
      const memoryResult = recordActAction(run.pageActions.memory, {
        action: actionName,
        target: actionTarget,
        targetKey: stableTargetKey,
        receipt,
        scopeDiff: result.scopeDiff,
        navigated: Boolean(result?.navigated || navigationObserved),
        routeChanged: normalizedSnapshot?.routeChanged === true,
        routeId: normalizedSnapshot?.routeId,
        beforeFingerprint: previousSnapshot?.fingerprint,
        afterFingerprint: normalizedSnapshot?.fingerprint,
      });
      if (memoryResult.toggleDetected) {
        const addedIndices = (result.scopeDiff?.changes || [])
          .filter((change) => change.kind === 'added')
          .map((change) => Number(change.index))
          .filter((index) => Number.isInteger(index) && index >= 0)
          .slice(0, 8);
        const addedTargets = addedIndices.length
          ? ` Newly visible controls: [${addedIndices.join('] [')}].`
          : '';
        const message =
          'This control toggles its state and has now restored the earlier page state. Do not activate it again; choose one of the newly visible controls or ask for guidance.' +
          addedTargets;
        run.pageActions.loopWarnings += 1;
        result.toggleDetected = true;
        result.notice = message;
        result.message = `${result.message || ''} ${message}`.trim();
        this._emitEvent(run.id, {
          type: 'page_action_warning',
          code: 'PAGE_ACTION_TOGGLE_DETECTED',
          action: actionName,
          message,
        });
      }
      if (
        actionName === 'page_get_state' &&
        (run.pageActions.planner?.completedAt || run.pageActions.finalVerificationRequested)
      ) {
        const verificationReceipt = result?.actionReceipt;
        const planner = run.pageActions.planner;
        const receiptConsistent = !planner?.active || hasReceiptConsistentProgress(planner);
        if (
          verificationReceipt?.disposition === 'delivered_verified' &&
          receiptConsistent &&
          result?.snapshot
        ) {
          run.pageActions.finalVerificationCompleted = true;
          if (planner?.active) {
            planner.finalVerificationEvidence = {
              disposition: 'delivered_verified',
              evidenceKind: String(verificationReceipt.evidence?.kind || '').slice(0, 64),
            };
          }
        } else {
          result.finalVerification = {
            verified: false,
            reason: receiptConsistent
              ? 'A fresh verified snapshot is required before the final summary.'
              : 'Resolved sub-goals lack verified completion evidence; do not finalize the task.',
          };
        }
      }

      if (actionName === 'page_get_state' && result?.snapshot && !result.snapshot.actionableHint) {
        const elementCount = Array.isArray(result.snapshot.elements)
          ? result.snapshot.elements.length
          : 0;
        if (elementCount === 0) {
          const hasText = Boolean(
            result.snapshot.header || result.snapshot.content || result.snapshot.footer
          );
          result.snapshot.actionableHint = hasText
            ? 'This page exposes no interactive controls. You can read the content above, but you ' +
              'cannot click, type, or select here. If the task needs a form or app, ask the user to ' +
              'open the target page.'
            : 'This page is empty: no content and no interactive controls, so there is nothing to act ' +
              'on. Ask the user to open the page they want you to work on.';
        }
      }
      if (actionName !== 'page_get_state' && result?.navigated && !result.notice) {
        result.notice =
          'Navigation completed in the current tab. Call page_get_state before the next action to inspect the new page.';
      } else if (actionName !== 'page_get_state' && result?.snapshot && !result.notice) {
        result.notice =
          'Action completed and the page snapshot was refreshed with a new snapshotId. ' +
          'Re-read the current snapshot before your next action and use the latest index numbers.';
      }
      if (result && typeof result === 'object') {
        result.tabId = Number(run.pageActions.targetTabId || run.sourceTabId || 0) || null;
      }
      run.pageActions.navigationPending = false;
      await this._settlePageActionCheckpoint(
        run,
        actionName,
        toolCall,
        actionHash,
        result?.actionReceipt
      );
      recordDevDiagnostic(
        'page_action_result_detail',
        {
          runId,
          toolCallId: toolCall?.id,
          action: actionName,
          result,
        },
        { persist: false }
      );
      recordDevDiagnostic('page_action_result', {
        runId,
        toolCallId: toolCall?.id,
        action: actionName,
        tabId: run.pageActions.targetTabId || run.sourceTabId || null,
        snapshot: result?.snapshot
          ? {
              snapshotId: result.snapshot.snapshotId,
              fingerprint: result.snapshot.fingerprint,
              url: result.snapshot.url,
              elementCount: Array.isArray(result.snapshot.elements)
                ? result.snapshot.elements.length
                : 0,
              contentChars: String(result.snapshot.content || '').length,
            }
          : null,
        navigated: Boolean(result?.navigated),
        pageChanged: Boolean(result?.pageChanged),
        receipt: result?.actionReceipt || null,
        scopeDiff: result?.scopeDiff || null,
        durationMs: Date.now() - actionStartedAt,
      });
    } catch (error) {
      run.pageActions.navigationPending = false;
      const tabFailure = this._isPageActionTabFailure(error);
      const message = tabFailure
        ? `${this._pageActionConnectionErrorMessage()} This tab is unavailable for the moment; continuing with any other tabs in the task.`
        : error.message || 'The page action failed.';
      recordDevDiagnostic('page_action_error', {
        runId,
        toolCallId: toolCall?.id,
        action: actionName,
        error,
        handled: tabFailure,
        durationMs: Date.now() - actionStartedAt,
      });
      this._emitEvent(run.id, {
        type: 'page_action_state',
        state: 'error',
        action: actionName,
        error: message,
      });
      if (error.code === 'PAGE_ACTION_UNRESPONSIVE' && isMutation) {
        const pause = await this._executePageManualIntervention(runId, {
          id: `unresponsive-${toolCall?.id || Date.now()}`,
          function: {
            name: 'page_pause_for_user',
            arguments: JSON.stringify({
              question:
                'The page stopped responding after the last action. It may be showing a browser dialog (alert, confirmation, or Leave site?). Switch to the tab, answer it, then press Resume.',
            }),
          },
        });
        if (pause?.result?.error === 'PAGE_MANUAL_INTERVENTION_TIMEOUT') {
          const recovery = this._quarantinePageActionTab(run, error);
          return {
            success: true,
            result: {
              error: 'PAGE_ACTION_UNRESPONSIVE',
              message:
                'The page did not resume before the manual-intervention timeout; the tab was quarantined.',
              tabId: recovery.tabId,
              actionReceipt: {
                disposition: 'delivered_unverified',
                evidence: { kind: 'page_unresponsive' },
              },
            },
          };
        }
        if (pause?.result?.resumed !== true) {
          return {
            success: true,
            result: {
              error: pause?.result?.error || 'PAGE_ACTION_UNRESPONSIVE',
              message: pause?.result?.message
                ? `Manual intervention did not resume: ${pause.result.message} The previous action was not replayed and remains unverified.`
                : 'Manual intervention did not resume. The previous action was not replayed and remains unverified.',
              actionReceipt: {
                disposition: 'delivered_unverified',
                evidence: { kind: 'page_unresponsive' },
              },
            },
          };
        }
        const inspected = await this._executePageAction(runId, 'page_get_state', {
          id: `unresponsive-inspect-${toolCall?.id || Date.now()}`,
          function: { name: 'page_get_state', arguments: '{}' },
        });
        const hasFreshSnapshot = Boolean(inspected?.result?.snapshot);
        return {
          ...inspected,
          result: {
            ...inspected?.result,
            message: hasFreshSnapshot
              ? 'The user resumed. Use this fresh snapshot; the previous action was not replayed.'
              : 'The user resumed, but fresh inspection failed. Inspect the page again before acting; the previous action was not replayed.',
            actionReceipt: {
              disposition: 'delivered_unverified',
              evidence: { kind: 'page_unresponsive' },
            },
          },
        };
      }
      if (isMutation && isPageActionPreDispatchFailure(error)) {
        // Nothing reached the page: the click was withheld because the target is
        // covered. Record not_delivered, return the mutation slot, and leave the
        // no-progress streak alone so one covered control cannot lock the run out
        // of every other mutation.
        this._refundPageActionBudget(run, budgetBucket);
        if (error.code === 'PAGE_STATE_STALE') {
          return this._staleSnapshotRecovery(run, toolCall);
        }
        const failure = buildPageActionOcclusionFailure({
          occluder: error.occluder,
          targetLabel: target?.label || target?.name || target?.tag || '',
        });
        // Occluded clicks never reach the page, so the delivered-mutation loop
        // guards cannot see a model retrying the same covered control forever.
        // Count consecutive occlusions per target on the current snapshot only:
        // any page change or dispatched action restarts the streak, and only the
        // repeated attempt is redirected, never the target itself.
        if (failure.code === PAGE_ACTION_OCCLUSION_CODE && stableTargetKey) {
          const occludedKey = `${stableTargetKey}|${run.pageActions.snapshot?.fingerprint || ''}`;
          if (run.pageActions.occludedTargetKey === occludedKey) {
            run.pageActions.occludedRepeatCount = (run.pageActions.occludedRepeatCount || 0) + 1;
          } else {
            run.pageActions.occludedTargetKey = occludedKey;
            run.pageActions.occludedRepeatCount = 1;
          }
          if (run.pageActions.occludedRepeatCount >= 3) {
            run.pageActions.loopWarnings += 1;
            const redirectMessage =
              `The target "${target?.label || target?.name || target?.tag || 'control'}" is still ` +
              'covered after repeated attempts, so this click was not dispatched again. Do not click ' +
              'it again on this page state: use page_keypress Enter on the focused input, search with ' +
              'page_find_text, or choose a different observed control. Call page_get_state if the page changed.';
            this._emitEvent(run.id, {
              type: 'page_action_warning',
              code: 'PAGE_ACTION_OCCLUDED_REPEATED',
              action: actionName,
              occluder: failure.occluder,
              message: redirectMessage,
            });
            return {
              success: true,
              result: {
                error: 'PAGE_ACTION_OCCLUDED_REPEATED',
                message: redirectMessage,
                suggestion:
                  'Use page_keypress Enter on the focused input, page_find_text, or a different observed control.',
                occluder: failure.occluder,
                actionReceipt: {
                  disposition: 'not_delivered',
                  evidence: { kind: 'occluded_target_repeated' },
                },
              },
            };
          }
        }
        const actionReceipt = {
          disposition: 'not_delivered',
          evidence: { kind: 'pre_dispatch_blocked', code: failure.code },
        };
        this._emitEvent(run.id, {
          type: 'page_action_warning',
          code: failure.code,
          action: actionName,
          occluder: failure.occluder,
          message: failure.message,
        });
        return {
          success: true,
          result: {
            error: failure.code,
            message: failure.message,
            suggestion: failure.suggestion,
            occluder: failure.occluder,
            actionReceipt,
          },
        };
      }
      if (tabFailure) {
        const recovery = this._quarantinePageActionTab(run, error);
        const actionReceipt = {
          disposition: actionName === 'page_get_state' ? 'not_delivered' : 'delivered_unverified',
          evidence: { kind: 'tab_unavailable', code: error.code || 'PAGE_TAB_UNAVAILABLE' },
        };
        this._emitEvent(run.id, {
          type: 'page_action_warning',
          code: 'PAGE_ACTION_TAB_UNAVAILABLE',
          action: actionName,
          tabId: recovery.tabId,
          nextTargetTabId: recovery.nextTargetTabId,
          message: recovery.available
            ? 'This tab was skipped and the run moved to another owned tab.'
            : 'No other healthy owned tab is available; the run can still summarize partial progress.',
        });
        return {
          success: true,
          result: {
            error: 'PAGE_TAB_UNAVAILABLE',
            code: error.code || 'PAGE_ACTION_TAB_UNAVAILABLE',
            handled: true,
            scope: 'tab',
            tabId: recovery.tabId,
            nextTargetTabId: recovery.nextTargetTabId,
            message,
            actionReceipt,
          },
        };
      }
      throw error;
    }
    this._emitEvent(run.id, {
      type: 'page_action_state',
      state: 'complete',
      action: actionName,
      receipt: result?.actionReceipt || null,
      target: target
        ? { label: target.label || target.name || target.tag, risk: policy.risk }
        : null,
    });
    return { success: true, result };
  }

  async _executePageTabAction(runId, actionName, toolCall) {
    const run = this.activeRuns.get(runId);
    if (!run?.pageActions?.enabled || !this.pageTabExecutor) {
      return {
        success: true,
        result: {
          error: 'MULTI_TAB_ACTIONS_DISABLED',
          message: 'Multi-tab page actions are disabled for this run.',
        },
      };
    }
    run.pageActions.currentActivityAction = actionName;
    // Tab actions do not accept a model title; clear any stale page-action
    // title so the card falls back to the event-type label.
    run.pageActions.currentActionTitle = null;

    const normalized = normalizePageTabActionArgs(
      actionName,
      this._parseToolArguments(toolCall.function.arguments)
    );
    if (!normalized.valid) {
      return { success: true, result: { error: 'PAGE_TAB_INVALID', message: normalized.error } };
    }
    const args = normalized.value;
    // Validate the current owned target first. Requested tab IDs must pass the
    // tab controller's ownership check before any metadata is read from them.
    const currentTabId = run.pageActions.targetTabId || run.sourceTabId;
    const siteBlock =
      (await this._pageActionSiteGate(run, currentTabId)) ||
      (actionName === 'page_open_tab'
        ? await this._pageActionSiteGate(run, currentTabId, args.url)
        : null);
    this._assertPageActionRunActive(run);
    if (siteBlock) return siteBlock;
    if (actionName === 'page_open_tab') {
      let destination;
      try {
        destination = new URL(args.url);
      } catch (_) {
        return {
          success: true,
          result: { error: 'PAGE_TAB_INVALID', message: 'A valid destination URL is required.' },
        };
      }
      let sourceOrigin = '';
      try {
        sourceOrigin = new URL(run.pageActions.snapshot?.url || run.pageActions.documentUrl || '')
          .origin;
      } catch (_) {
        sourceOrigin = '';
      }
      const objective = String(run.objective || '').toLowerCase();
      const explicitlyRequested = objective.includes(destination.hostname.toLowerCase());
      const observedLink = Array.from(run.pageActions.elementIndex?.values?.() || []).some(
        (element) => {
          try {
            const link = new URL(element.href);
            return link.origin === destination.origin && link.pathname === destination.pathname;
          } catch (_) {
            return false;
          }
        }
      );
      if (
        sourceOrigin &&
        destination.origin !== sourceOrigin &&
        !explicitlyRequested &&
        !observedLink &&
        (!run.pageActions.sessionApproval || isPageActionSensitiveOrigin(destination.origin))
      ) {
        const approved = await this._requestPageActionConfirmation(
          run,
          actionName,
          args,
          { href: args.url, label: destination.hostname, tag: 'link' },
          {
            risk: 'medium',
            requiresConfirmation: true,
            reason:
              'Opening an unrequested external destination may disclose information in its URL.',
          }
        );
        if (!approved) {
          return {
            success: true,
            result: {
              error: 'PAGE_ACTION_DENIED',
              message: 'The user denied opening this external destination.',
            },
          };
        }
      }
    }
    if (actionName === 'page_open_link') {
      if (args.snapshotId !== run.pageActions.snapshot?.snapshotId) {
        return {
          success: true,
          result: {
            error: 'PAGE_STATE_STALE',
            message: 'The page snapshot is stale. Call page_get_state again before opening a link.',
          },
        };
      }
      // Resolve through the shared document index so a link discovered before
      // a region-scoped read stays addressable, exactly like page_click.
      const target = this._resolvePageActionElement(run, args.index);
      if (!target) {
        return {
          success: true,
          result: {
            error: 'PAGE_STATE_STALE',
            message: 'The link is not in the current page snapshot. Call page_get_state again.',
          },
        };
      }
      if (target.elementKey) args.elementKey = target.elementKey;
      const policy = evaluatePageActionPolicy({
        actionName,
        target,
        trustedMode: run.pageActions.trustedMode,
        origin: getPageActionSiteOrigin(
          run.pageActions.snapshot?.url || run.pageActions.documentUrl
        ),
        sitePolicies: run.pageActions.sitePolicies,
      });
      if (!policy.allowed) {
        return {
          success: true,
          result: { error: 'PAGE_ACTION_BLOCKED', message: policy.reason, risk: policy.risk },
        };
      }
      let origin = '';
      try {
        origin = new URL(target.href).origin;
      } catch (_) {
        origin = '';
      }
      // Opening a safe HTTP(S) link is covered by the Act lease. Keep
      // destructive/download controls blocked by the page policy, but do not
      // add a confirmation card for each newly visited origin.
      if (policy.risk === PAGE_ACTION_RISKS.HIGH) {
        const approved = await this._requestPageActionConfirmation(
          run,
          actionName,
          args,
          target,
          policy
        );
        if (!approved)
          return {
            success: true,
            result: {
              error: 'PAGE_ACTION_DENIED',
              message: 'The user denied this page action.',
              risk: policy.risk,
            },
          };
      }
      const linkBlock = await this._pageActionSiteGate(
        run,
        run.pageActions.targetTabId || run.sourceTabId,
        target.href
      );
      if (linkBlock) return linkBlock;
      if (origin) run.pageActions.allowedOrigins.add(origin);
      const budget = this._consumePageActionBudget(
        run,
        this._pageActionBudgetBucket(actionName, target, policy),
        actionName
      );
      if (!budget.ok) return budget;
      const actionHash = pageStateHash(
        JSON.stringify({
          actionName,
          index: args.index,
          snapshotId: args.snapshotId,
          target: target.label || target.name || target.tag || '',
          fingerprint: run.pageActions.snapshot?.fingerprint || '',
        })
      );
      await this._savePageActionCheckpoint(run, actionName, toolCall, actionHash);
      this._emitEvent(run.id, {
        type: 'page_action_state',
        state: 'running',
        action: actionName,
        target: { label: target.label || target.text || target.tag, risk: policy.risk },
      });
      try {
        const resolved = await this.pageActionExecutor(
          run.pageActions.targetTabId || run.sourceTabId,
          actionName,
          args,
          { runId, signal: run.abortController.signal }
        );
        let rawUrl;
        try {
          const parsed = new URL(String(resolved?.linkUrl || ''));
          if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsafe scheme');
          rawUrl = parsed.href;
        } catch (_) {
          const error = new Error('The selected link has no safe HTTP(S) destination.');
          error.code = 'PAGE_NAVIGATION_BLOCKED';
          throw error;
        }
        const background = args.background === true;
        const targetTabId = run.pageActions.targetTabId || run.sourceTabId;
        const result = await this.pageTabExecutor(
          runId,
          background ? 'page_open_tab' : 'page_navigate_tab',
          background ? { url: rawUrl, background: true } : { url: rawUrl, tabId: targetTabId },
          { signal: run.abortController.signal }
        );
        const landedBlock = await this._pageActionSiteGate(
          run,
          result?.openedTabId || result?.targetTabId || targetTabId
        );
        if (landedBlock) return landedBlock;
        const resolvedSnapshot = resolved?.snapshot
          ? normalizePageSnapshot(resolved.snapshot)
          : null;
        if (result?.ready === false) {
          const failure = new Error(
            result?.tabError?.message ||
              (background
                ? 'The new tab is not ready for page actions.'
                : 'The current tab is not ready for page actions.')
          );
          failure.code = result?.tabError?.code || 'PAGE_ACTION_TAB_UNAVAILABLE';
          const recovery = this._quarantinePageActionTab(run, failure, result.openedTabId);
          return {
            success: true,
            result: {
              error: 'PAGE_TAB_UNAVAILABLE',
              code: failure.code,
              handled: true,
              scope: 'tab',
              tabId: result.openedTabId || null,
              nextTargetTabId: recovery.nextTargetTabId,
              message: background
                ? 'The new tab did not become ready; it was skipped and the run can continue.'
                : 'The current tab did not become ready; the run can continue with partial progress.',
              actionReceipt: {
                disposition: 'not_delivered',
                evidence: { kind: 'tab_unavailable' },
              },
            },
          };
        }
        if (args.background === true) {
          // The source-tab bridge rotates its snapshot ID while resolving the
          // link. Keep that fresh snapshot for the next source-tab action.
          if (resolvedSnapshot) {
            run.pageActions.snapshot = resolvedSnapshot;
            run.pageActions.documentUrl = resolvedSnapshot.url || run.pageActions.documentUrl;
          }
        } else if (result?.targetTabId) {
          run.pageActions.targetTabId = result.targetTabId;
          run.pageActions.documentUrl = null;
          run.pageActions.snapshot = null;
        }
        if (resolved?.actionReceipt && typeof resolved.actionReceipt === 'object') {
          result.actionReceipt = resolved.actionReceipt;
        } else if (!result.actionReceipt) {
          result.actionReceipt = {
            disposition: 'delivered_verified',
            evidence: {
              kind: background ? 'owned_tab_link_opened' : 'current_tab_link_navigated',
            },
          };
        }
        await this._settlePageActionCheckpoint(
          run,
          actionName,
          toolCall,
          actionHash,
          result.actionReceipt
        );
        // Opening a link is the progress the search-loop guards wait for:
        // a verified open clears the identical-query and unopened-search state.
        if (result.actionReceipt?.disposition === 'delivered_verified') {
          run.pageActions.repeatedQueryCounts?.clear?.();
          run.pageActions.unopenedSearchCount = 0;
        }
        this._emitEvent(run.id, {
          type: 'page_action_state',
          state: 'complete',
          action: actionName,
          receipt: result.actionReceipt || null,
        });
        return { success: true, result };
      } catch (error) {
        this._emitEvent(run.id, {
          type: 'page_action_state',
          state: 'error',
          action: actionName,
          error: error.message || 'The link could not be opened.',
        });
        if (this._isPageActionTabFailure(error)) {
          const recovery = this._quarantinePageActionTab(run, error);
          return {
            success: true,
            result: {
              error: 'PAGE_TAB_UNAVAILABLE',
              code: error.code,
              handled: true,
              scope: 'tab',
              tabId: recovery.tabId,
              nextTargetTabId: recovery.nextTargetTabId,
              message: this._pageActionConnectionErrorMessage(),
              actionReceipt: {
                disposition: 'not_delivered',
                evidence: { kind: 'tab_unavailable' },
              },
            },
          };
        }
        return {
          success: true,
          result: { error: error.code || 'PAGE_TAB_FAILED', message: error.message },
        };
      }
    }
    if (actionName === 'page_open_tab') {
      // Safe HTTP(S) origins are inside the bounded Act lease after any
      // required cross-origin confirmation. The tab controller still
      // restricts access to tabs created by this run.
      try {
        run.pageActions.allowedOrigins.add(new URL(args.url).origin);
      } catch (_) {
        return {
          success: true,
          result: { error: 'PAGE_TAB_INVALID', message: 'A valid destination URL is required.' },
        };
      }
    }
    if (actionName === 'page_close_tab' && !run.pageActions.sessionApproval) {
      const approved = await this._requestPageActionConfirmation(
        run,
        actionName,
        args,
        { label: `tab ${args.tabId}`, tag: 'tab' },
        {
          risk: 'medium',
          requiresConfirmation: true,
          reason: 'Closing a tab is a reversible browser action limited to tabs owned by this run.',
        }
      );
      if (!approved) {
        return {
          success: true,
          result: { error: 'PAGE_TAB_CLOSE_DENIED', message: 'The user denied closing the tab.' },
        };
      }
    }
    const budget = this._consumePageActionBudget(
      run,
      this._pageActionBudgetBucket(actionName, null, {}),
      actionName
    );
    if (!budget.ok) return budget;
    const actionHash = pageStateHash(JSON.stringify({ actionName, args }));
    await this._savePageActionCheckpoint(run, actionName, toolCall, actionHash);
    this._emitEvent(run.id, { type: 'page_action_state', state: 'running', action: actionName });
    try {
      const result = await this.pageTabExecutor(runId, actionName, args, {
        signal: run.abortController.signal,
      });
      if (actionName !== 'page_list_tabs' && actionName !== 'page_close_tab') {
        const landedBlock = await this._pageActionSiteGate(
          run,
          result?.openedTabId ||
            result?.targetTabId ||
            args.tabId ||
            run.pageActions.targetTabId ||
            run.sourceTabId
        );
        if (landedBlock) return landedBlock;
      }
      if (result && !result.actionReceipt) {
        result.actionReceipt = {
          disposition: result.ready === false ? 'not_delivered' : 'delivered_verified',
          evidence: {
            kind:
              actionName === 'page_open_tab'
                ? result.reused
                  ? 'owned_tab_reused'
                  : 'owned_tab_ready'
                : actionName === 'page_switch_tab'
                  ? 'owned_tab_selected'
                  : actionName === 'page_go_back'
                    ? 'owned_tab_back_navigation'
                    : 'owned_tab_closed',
          },
        };
      }
      if (['page_switch_tab', 'page_go_back'].includes(actionName) && result?.ready === false) {
        const failure = new Error(
          result?.tabError?.message || 'The selected tab is not ready for page actions.'
        );
        failure.code = result?.tabError?.code || 'PAGE_ACTION_TAB_UNAVAILABLE';
        const recovery = this._quarantinePageActionTab(run, failure, args.tabId);
        return {
          success: true,
          result: {
            error: 'PAGE_TAB_UNAVAILABLE',
            code: failure.code,
            handled: true,
            scope: 'tab',
            tabId: args.tabId,
            nextTargetTabId: recovery.nextTargetTabId,
            message: 'The selected tab did not become ready; the run stayed on a healthy tab.',
            actionReceipt: { disposition: 'not_delivered', evidence: { kind: 'tab_unavailable' } },
          },
        };
      }
      if (actionName === 'page_open_tab' && result?.ready === false) {
        const failure = new Error(
          result?.tabError?.message || 'The new tab is not ready for page actions.'
        );
        failure.code = result?.tabError?.code || 'PAGE_ACTION_TAB_UNAVAILABLE';
        const recovery = this._quarantinePageActionTab(run, failure, result.openedTabId);
        return {
          success: true,
          result: {
            error: 'PAGE_TAB_UNAVAILABLE',
            code: failure.code,
            handled: true,
            scope: 'tab',
            tabId: result.openedTabId || null,
            nextTargetTabId: recovery.nextTargetTabId,
            message: 'The new tab did not become ready; it was skipped and the run can continue.',
            actionReceipt: { disposition: 'not_delivered', evidence: { kind: 'tab_unavailable' } },
          },
        };
      }
      if (result?.targetTabId && !(actionName === 'page_open_tab' && args.background === true)) {
        run.pageActions.targetTabId = result.targetTabId;
        if (['page_switch_tab', 'page_open_tab', 'page_go_back'].includes(actionName)) {
          run.pageActions.documentUrl = null;
          run.pageActions.snapshot = null;
        }
      }
      await this._settlePageActionCheckpoint(
        run,
        actionName,
        toolCall,
        actionHash,
        result?.actionReceipt
      );
      // A verified opened tab is result-opening progress: clear the
      // identical-query and unopened-search loop state.
      if (
        actionName === 'page_open_tab' &&
        result?.actionReceipt?.disposition === 'delivered_verified'
      ) {
        run.pageActions.repeatedQueryCounts?.clear?.();
        run.pageActions.unopenedSearchCount = 0;
      }
      this._emitEvent(run.id, { type: 'page_action_state', state: 'complete', action: actionName });
      return { success: true, result };
    } catch (error) {
      this._emitEvent(run.id, {
        type: 'page_action_state',
        state: 'error',
        action: actionName,
        error: error.message || 'The tab action failed.',
      });
      if (this._isPageActionTabFailure(error)) {
        const recovery = this._quarantinePageActionTab(run, error);
        return {
          success: true,
          result: {
            error: 'PAGE_TAB_UNAVAILABLE',
            code: error.code,
            handled: true,
            scope: 'tab',
            tabId: recovery.tabId,
            nextTargetTabId: recovery.nextTargetTabId,
            message: this._pageActionConnectionErrorMessage(),
            actionReceipt: { disposition: 'not_delivered', evidence: { kind: 'tab_unavailable' } },
          },
        };
      }
      return {
        success: true,
        result: { error: error.code || 'PAGE_TAB_FAILED', message: error.message },
      };
    }
  }

  _executePageManualIntervention(runId, toolCall) {
    const run = this.activeRuns.get(runId);
    if (!run?.pageActions?.enabled) {
      return Promise.resolve({
        success: true,
        result: {
          error: 'PAGE_ACTIONS_DISABLED',
          message: 'Page actions are not enabled for this run.',
        },
      });
    }
    if (!run.pageActions.snapshot) {
      return Promise.resolve({
        success: true,
        result: {
          error: 'PAGE_STATE_REQUIRED',
          message: 'Inspect the current page before requesting a manual step.',
        },
      });
    }
    if (run.pageActions.pendingManualIntervention || run.pageActions.pendingUserInput) {
      return Promise.resolve({
        success: true,
        result: {
          error: 'PAGE_MANUAL_INTERVENTION_PENDING',
          message: 'Another user interaction is already active.',
        },
      });
    }
    const normalized = normalizePageManualInterventionArgs(
      this._parseToolArguments(toolCall.function.arguments)
    );
    if (!normalized.valid) {
      return Promise.resolve({
        success: true,
        result: { error: 'PAGE_MANUAL_INTERVENTION_INVALID', message: normalized.error },
      });
    }
    const requestId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const observedSnapshot = run.pageActions.snapshot;
    run.pageActions.lastBlockReason = getActManualBlockReason(observedSnapshot);
    let activeOrigin = '';
    try {
      activeOrigin = new URL(observedSnapshot.url || '').origin.slice(0, 160);
    } catch (_) {
      activeOrigin = '';
    }
    const activeTab = {
      tabId: Number(run.pageActions.targetTabId || run.sourceTabId || 0),
      title: String(observedSnapshot.title || '')
        .trim()
        .slice(0, 120),
      origin: activeOrigin,
    };
    run.pageActions.snapshot = null;
    run.pageActions.lastActionHash = '';
    run.pageActions.lastActionReceipt = null;
    run.pageActions.reverifiedAfterUnverified = false;
    run.pageActions.freshActionSnapshotAfterUnverified = false;
    this._emitEvent(run.id, {
      type: 'page_manual_intervention_request',
      requestId,
      question: normalized.value.question,
      activeTab,
      state: 'paused',
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (run.pageActions.pendingManualIntervention?.id !== requestId) return;
        run.abortController.signal.removeEventListener('abort', onAbort);
        run.pageActions.pendingManualIntervention = null;
        resolve({
          success: true,
          result: {
            error: 'PAGE_MANUAL_INTERVENTION_TIMEOUT',
            message: 'The manual-intervention request expired. Inspect the page before continuing.',
          },
        });
      }, 300_000);
      const onAbort = () => {
        clearTimeout(timer);
        if (run.pageActions.pendingManualIntervention?.id !== requestId) return;
        run.pageActions.pendingManualIntervention = null;
        reject(new DOMException('The run was aborted.', 'AbortError'));
      };
      run.abortController.signal.addEventListener('abort', onAbort, { once: true });
      run.pageActions.pendingManualIntervention = {
        id: requestId,
        resolve: async () => {
          clearTimeout(timer);
          run.abortController.signal.removeEventListener('abort', onAbort);
          run.pageActions.pendingManualIntervention = null;
          try {
            await this.pageActionExecutor(
              run.pageActions.targetTabId || run.sourceTabId,
              'clearPageActionSession',
              {},
              { runId, signal: run.abortController.signal }
            );
          } catch (_) {
            // The next forced page_get_state still fails closed if the bridge is gone.
          }
          run.pageActions.snapshot = null;
          run.pageActions.lastActionHash = '';
          run.pageActions.lastActionReceipt = null;
          run.pageActions.reverifiedAfterUnverified = false;
          run.pageActions.freshActionSnapshotAfterUnverified = false;
          this._emitEvent(run.id, {
            type: 'page_manual_intervention_resumed',
            requestId,
            state: 'resumed',
            message: 'Manual step finished. Inspect the current page before acting again.',
          });
          resolve({
            success: true,
            result: {
              resumed: true,
              message: 'Manual step finished. Call page_get_state before the next action.',
            },
          });
        },
        reject: onAbort,
      };
    });
  }

  _executePageUserInput(runId, toolCall) {
    const run = this.activeRuns.get(runId);
    if (!run?.pageActions?.enabled) {
      return Promise.resolve({
        success: true,
        result: {
          error: 'PAGE_ACTIONS_DISABLED',
          message: 'Page actions are not enabled for this run.',
        },
      });
    }
    if (run.pageActions.pendingManualIntervention) {
      return Promise.resolve({
        success: true,
        result: {
          error: 'PAGE_MANUAL_INTERVENTION_PENDING',
          message: 'Resume the manual step before requesting another answer.',
        },
      });
    }
    if (run.pageActions.pendingUserInput) {
      return Promise.resolve({
        success: true,
        result: {
          error: 'PAGE_USER_INPUT_PENDING',
          message: 'Another user-input request is active.',
        },
      });
    }
    const normalized = normalizePageUserInputArgs(
      this._parseToolArguments(toolCall.function.arguments)
    );
    if (!normalized.valid) {
      return Promise.resolve({
        success: true,
        result: { error: 'PAGE_USER_INPUT_INVALID', message: normalized.error },
      });
    }
    const requestId = `input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (run.pageActions.pendingUserInput?.id !== requestId) return;
        run.abortController.signal.removeEventListener('abort', onAbort);
        run.pageActions.pendingUserInput = null;
        resolve({
          success: true,
          result: { error: 'PAGE_USER_INPUT_TIMEOUT', message: 'The user did not answer in time.' },
        });
      }, 120_000);
      const onAbort = () => {
        clearTimeout(timer);
        if (run.pageActions.pendingUserInput?.id !== requestId) return;
        run.pageActions.pendingUserInput = null;
        reject(new DOMException('The run was aborted.', 'AbortError'));
      };
      run.abortController.signal.addEventListener('abort', onAbort, { once: true });
      run.pageActions.pendingUserInput = {
        id: requestId,
        resolve: (value) => {
          clearTimeout(timer);
          run.abortController.signal.removeEventListener('abort', onAbort);
          run.pageActions.pendingUserInput = null;
          resolve({ success: true, result: { answer: String(value || '').slice(0, 2_000) } });
        },
        reject: onAbort,
      };
      this._emitEvent(run.id, {
        type: 'page_user_input_request',
        requestId,
        question: normalized.value.question,
        options: normalized.value.options,
      });
    });
  }

  resolvePageUserInput(runId, requestId, answer) {
    const pending = this.activeRuns.get(runId)?.pageActions?.pendingUserInput;
    if (!pending || pending.id !== requestId) return false;
    pending.resolve(answer);
    return true;
  }

  resolvePageManualIntervention(runId, requestId, resume) {
    const pending = this.activeRuns.get(runId)?.pageActions?.pendingManualIntervention;
    if (!pending || pending.id !== requestId || resume !== true) return false;
    void pending.resolve();
    return true;
  }

  _requestPageActionConfirmation(run, actionName, args, target, policy) {
    this._assertPageActionRunActive(run);
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
        this._emitEvent(run.id, {
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
          this._extendDeadlineForApprovalWait(run);
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
      this._emitEvent(run.id, {
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

  resolvePageActionDecision(runId, confirmationId, approved, approveAll = false) {
    const run = this.activeRuns.get(runId);
    const pending = run?.pageActions?.pendingConfirmation;
    if (!pending || pending.id !== confirmationId) return false;
    const isApproved = approved === true;
    const sessionApproved =
      isApproved &&
      approveAll === true &&
      !isPageActionSensitiveOrigin(pending.siteOrigin) &&
      !isPageActionSensitiveOrigin(pending.documentOrigin);
    if (sessionApproved) run.pageActions.sessionApproval = true;
    pending.resolve(isApproved);
    this._emitEvent(runId, {
      type: 'page_action_decision',
      confirmationId,
      approved: isApproved,
      approveAll: sessionApproved,
      action: pending.action || null,
    });
    return true;
  }
}

export function installActExecutionMethods(target) {
  for (const name of Object.getOwnPropertyNames(ActExecutionMethods.prototype)) {
    if (name === 'constructor') continue;
    Object.defineProperty(
      target.prototype,
      name,
      Object.getOwnPropertyDescriptor(ActExecutionMethods.prototype, name)
    );
  }
}
