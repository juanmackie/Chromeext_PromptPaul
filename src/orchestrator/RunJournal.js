/**
 * @fileoverview Bounded run-event journal serialization and session persistence.
 * @module RunJournal
 */

import { ACT_PROGRESS_CAPS } from '../act/ActLimits.js';
import { ACT_OUTCOME_REASONS } from '../act/ActOutcome.js';
import { getPageActionSiteOrigin } from '../utils/pageActionSitePolicies.js';
import { redactProviderErrorMessage } from '../utils/runResilience.js';

export const RUN_JOURNAL_STORAGE_KEY = 'promptPaulRunJournalsV1';

export const RUN_JOURNAL_CAPS = Object.freeze({
  maxEvents: 128,
  maxBytes: 512 * 1024,
  maxRuns: 24,
  coalesceMs: 25,
});

/**
 * Owns the bounded, session-scoped recovery journal for orchestrator runs.
 * @class
 */
export class RunJournal {
  constructor() {
    this.writePromise = Promise.resolve();
    this.pendingSnapshots = new Map();
    this.drainActive = false;
    this.drainTimer = null;
    this.drainResolve = null;
  }

  /**
   * Append a safe event and schedule its latest run snapshot for persistence.
   * @param {object} run
   * @param {object} event
   * @returns {void}
   */
  recordEvent(run, event) {
    run.eventJournal = [...(run.eventJournal || []), this.sanitizeEvent(event)].slice(
      -RUN_JOURNAL_CAPS.maxEvents
    );
    this.persist(run);
  }

  /**
   * Return a bounded event projection safe for session storage and reconnect.
   * @param {object} event
   * @returns {object}
   */
  sanitizeEvent(event) {
    const safe = { sequence: event.sequence, timestamp: event.timestamp, type: event.type };
    if (event.actOutcome && ['done', 'blocked', 'failed'].includes(event.actOutcome.status)) {
      safe.actOutcome = {
        status: event.actOutcome.status,
        reason: ACT_OUTCOME_REASONS.includes(event.actOutcome.reason)
          ? event.actOutcome.reason
          : null,
      };
    }
    for (const key of [
      'state',
      'action',
      'code',
      'message',
      'summary',
      'risk',
      'confirmationId',
      'approved',
      'approveAll',
      'timedOut',
      'actions',
      'limit',
      'toolName',
      'requestId',
      'approvalId',
    ]) {
      if (event[key] !== undefined) {
        safe[key] = typeof event[key] === 'string' ? event[key].slice(0, 240) : event[key];
      }
    }
    if (event.type === 'complete') {
      const fullContent = String(event.content || '');
      if (fullContent.length > 8_000) {
        safe.content = fullContent.slice(0, 8_000);
        safe.contentTruncated = true;
        safe.originalLength = fullContent.length;
      } else {
        safe.content = fullContent;
      }
      if (event.grounding) safe.grounding = event.grounding;
      if (event.completion) safe.completion = event.completion;
    }
    if (event.type === 'error') safe.error = redactProviderErrorMessage(event.error, 240);
    if (event.siteOrigin) safe.siteOrigin = getPageActionSiteOrigin(event.siteOrigin);
    for (const key of ['title', 'origin', 'destination', 'reason']) {
      if (typeof event[key] === 'string') safe[key] = event[key].slice(0, 240);
    }
    if (event.target?.label) safe.target = { label: String(event.target.label).slice(0, 160) };

    if (
      event.type === 'page_user_input_request' ||
      event.type === 'page_manual_intervention_request'
    ) {
      if (typeof event.question === 'string') safe.question = event.question.slice(0, 600);
      if (Array.isArray(event.options)) {
        safe.options = event.options
          .slice(0, 8)
          .map((option) => (typeof option === 'string' ? option.slice(0, 120) : option));
      }
      if (event.activeTab) {
        safe.activeTab = {
          tabId: Number.isInteger(event.activeTab.tabId) ? event.activeTab.tabId : null,
          title: String(event.activeTab.title || '')
            .trim()
            .slice(0, 120),
          origin: String(event.activeTab.origin || '')
            .trim()
            .slice(0, 160),
        };
      }
    }
    if (event.type === 'page_task_progress') {
      safe.status = String(event.status || 'running').slice(0, 32);
      safe.hasPlanner = Boolean(event.hasPlanner);
      safe.taskComplete = Boolean(event.taskComplete);
      if (typeof event.currentStep === 'string') safe.currentStep = event.currentStep.slice(0, 240);
      if (typeof event.currentAction === 'string')
        safe.currentAction = event.currentAction.slice(0, 64);
      if (typeof event.title === 'string') safe.title = event.title.slice(0, 80);
      if (event.target?.label) {
        safe.target = {
          label: String(event.target.label).slice(0, 160),
          origin: Boolean(event.target.origin),
        };
      }
      if (event.waiting) safe.waiting = String(event.waiting).slice(0, 16);
      if (event.waitingRequestId)
        safe.waitingRequestId = String(event.waitingRequestId).slice(0, 64);
      if (event.receipt?.disposition) {
        safe.receipt = {
          disposition: String(event.receipt.disposition).slice(0, 32),
          actionName: String(event.receipt.actionName || '').slice(0, 64),
        };
      }
      if (event.outcome && typeof event.outcome === 'object') {
        safe.outcome = {
          status: String(event.outcome.status || 'running').slice(0, 24),
          waiting: ['approval', 'answer', 'manual'].includes(event.outcome.waiting)
            ? event.outcome.waiting
            : null,
          taskComplete: Boolean(event.outcome.taskComplete),
          unverified: Boolean(event.outcome.unverified),
          notDelivered: Boolean(event.outcome.notDelivered),
          verified: Boolean(event.outcome.verified),
          declined: Boolean(event.outcome.declined),
          completedSteps: Math.min(
            Number(event.outcome.completedSteps) || 0,
            ACT_PROGRESS_CAPS.maxSteps
          ),
          blockedSteps: Math.min(
            Number(event.outcome.blockedSteps) || 0,
            ACT_PROGRESS_CAPS.maxSteps
          ),
          remainingSteps: Math.min(
            Number(event.outcome.remainingSteps) || 0,
            ACT_PROGRESS_CAPS.maxSteps
          ),
        };
      }
      if (Array.isArray(event.steps)) {
        safe.steps = event.steps.slice(0, ACT_PROGRESS_CAPS.maxSteps).map((step) => ({
          index: Number.isInteger(step?.index) ? step.index : null,
          label: String(step?.label || '').slice(0, ACT_PROGRESS_CAPS.maxStepLabelChars),
          status: ['pending', 'current', 'completed', 'blocked'].includes(step?.status)
            ? step.status
            : 'pending',
        }));
      }
    }
    return safe;
  }

  /**
   * Build a bounded recovery snapshot without live page data or credentials.
   * @param {object} run
   * @returns {object}
   */
  getSnapshot(run) {
    return {
      version: 1,
      runId: run.id,
      sourceTabId: run.sourceTabId || null,
      status: run.status,
      startedAt: run.startedAt || null,
      updatedAt: run.journalUpdatedAt || Date.now(),
      eventSequence: run.eventSequence || 0,
      objective: String(run.objective || '').slice(0, 4_000),
      resilience: run.resilience
        ? {
            apiCallCount: Number(run.resilience.apiCallCount || 0),
            maxIterations: Number(run.resilience.maxIterations || 0),
            runBudgetMs: Number(run.resilience.runBudgetMs || 0),
            wrapUp: Boolean(run.resilience.wrapUp),
            contextCompactions: Number(run.resilience.contextCompactions || 0),
            approvalWaitExtensions: Number(run.resilience.approvalWaitExtensions || 0),
          }
        : null,
      pageActions: run.pageActions
        ? {
            enabled: Boolean(run.pageActions.enabled),
            actions: Number(run.pageActions.actions || 0),
            budgets: { ...(run.pageActions.budgets || {}) },
            noteCount: Array.isArray(run.pageActions.notes) ? run.pageActions.notes.length : 0,
            documentUrl: run.pageActions.documentUrl || null,
            fingerprint: run.pageActions.snapshot?.fingerprint || null,
            loopWarnings: Number(run.pageActions.loopWarnings || 0),
            lastDeniedAction: run.pageActions.lastDeniedAction
              ? { action: String(run.pageActions.lastDeniedAction.action || '').slice(0, 64) }
              : null,
            currentActionTitle: run.pageActions.currentActionTitle
              ? String(run.pageActions.currentActionTitle).slice(0, 80)
              : null,
            recovery: run.pageActions.recoveryCheckpoint
              ? {
                  actionName: String(run.pageActions.recoveryCheckpoint.actionName || '').slice(
                    0,
                    64
                  ),
                  evidence: 'unknown_delivery_after_worker_restart',
                }
              : null,
          }
        : null,
      events: run.eventJournal || [],
      terminal: Boolean(run.terminal),
    };
  }

  /** @param {object} run @param {boolean} immediate @returns {void} */
  persist(run, immediate = false) {
    if (typeof chrome === 'undefined' || !chrome.storage?.session || !run) return;
    this.pendingSnapshots.set(run.id, this.getSnapshot(run));
    this._limitPendingSnapshots();
    this._startDrain(immediate || run.terminal === true);
  }

  _limitPendingSnapshots() {
    while (this.pendingSnapshots.size > RUN_JOURNAL_CAPS.maxRuns) {
      let oldestRunId = null;
      let oldestUpdatedAt = Infinity;
      for (const [runId, snapshot] of this.pendingSnapshots) {
        const updatedAt = Number(snapshot?.updatedAt || 0);
        if (updatedAt < oldestUpdatedAt) {
          oldestRunId = runId;
          oldestUpdatedAt = updatedAt;
        }
      }
      if (oldestRunId === null) break;
      this.pendingSnapshots.delete(oldestRunId);
    }
  }

  _startDrain(force = false) {
    if (this.drainActive || this.pendingSnapshots.size === 0) return;
    if (this.drainTimer !== null) {
      if (!force) return;
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    if (!force) {
      this.writePromise = new Promise((resolve) => {
        this.drainResolve = resolve;
        this.drainTimer = setTimeout(() => {
          this.drainTimer = null;
          this._beginDrain();
        }, RUN_JOURNAL_CAPS.coalesceMs);
      });
      return;
    }
    this._beginDrain();
  }

  _beginDrain() {
    if (this.drainActive || this.pendingSnapshots.size === 0) return;
    this.drainActive = true;
    const scheduledResolve = this.drainResolve;
    this.drainResolve = null;
    this.writePromise = this._drainWrites().finally(() => scheduledResolve?.());
  }

  async _drainWrites() {
    let latestRetryAttempted = false;
    try {
      while (this.pendingSnapshots.size > 0) {
        const snapshots = new Map(this.pendingSnapshots);
        this.pendingSnapshots.clear();
        try {
          const result = await chrome.storage.session.get([RUN_JOURNAL_STORAGE_KEY]);
          const journals = { ...(result?.[RUN_JOURNAL_STORAGE_KEY] || {}) };
          for (const [runId, snapshot] of snapshots) {
            if (JSON.stringify(snapshot).length > RUN_JOURNAL_CAPS.maxBytes) {
              snapshot.events = snapshot.events.slice(-32);
            }
            journals[runId] = snapshot;
          }
          const ordered = Object.entries(journals).sort(
            (left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0)
          );
          for (const [staleRunId] of ordered.slice(RUN_JOURNAL_CAPS.maxRuns))
            delete journals[staleRunId];
          await chrome.storage.session.set({ [RUN_JOURNAL_STORAGE_KEY]: journals });
        } catch (_) {
          const hasNewerPendingSnapshots = this.pendingSnapshots.size > 0;
          for (const [runId, snapshot] of snapshots) {
            if (!this.pendingSnapshots.has(runId)) this.pendingSnapshots.set(runId, snapshot);
          }
          this._limitPendingSnapshots();
          if (hasNewerPendingSnapshots && !latestRetryAttempted) {
            latestRetryAttempted = true;
            continue;
          }
          return false;
        }
      }
    } finally {
      this.drainActive = false;
    }
  }

  static getStorageKey() {
    return RUN_JOURNAL_STORAGE_KEY;
  }
}
