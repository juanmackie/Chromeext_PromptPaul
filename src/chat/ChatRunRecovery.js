/**
 * @fileoverview Session-backed run journal and Act checkpoint recovery helpers.
 * @module ChatRunRecovery
 */

import { listPageActionCheckpoints } from '../utils/pageActionCheckpoint.js';

const ACTIVE_RUN_KEY = 'promptPaulActiveRunV1';

/**
 * Decide, from ACTUAL runtime state, whether generic Retry must NOT replay an
 * Act request. Blind replay is only dangerous when the last mutation may have
 * been delivered but not verified (delivered_unverified / in-flight), or an
 * interrupted checkpoint exists (uncertain_delivery / in_flight) whose state on
 * the page is unknown. In those cases retrying could duplicate the change, so
 * the caller must route through the fresh-inspection recovery path instead.
 * @param {object} [state] - { unverified, hasCheckpoint, status, disposition }
 * @returns {boolean}
 */
export function shouldGateActRetry(state = {}) {
  const s = state || {};
  const disposition = s.disposition || s.lastReceipt?.disposition;
  return Boolean(
    s.unverified === true ||
    s.hasCheckpoint === true ||
    disposition === 'delivered_unverified' ||
    disposition === 'in_flight' ||
    s.status === 'in_flight' ||
    s.status === 'uncertain_delivery'
  );
}

/**
 * Deterministically summarize an Act run's outcome and the single best next
 * recovery action, selected from ACTUAL runtime state (receipt dispositions,
 * checkpoint presence, blocked planner steps, pending interactions). Used by the
 * readable progress card and by the Retry gate. Never invents a parallel
 * recovery UI: the returned action maps onto existing Stop / Watch run /
 * Resume / clarification controls.
 * @param {object} [state]
 * @param {boolean} [state.unverified] - last delivery could not be confirmed.
 * @param {boolean} [state.notDelivered] - last action was not delivered.
 * @param {boolean} [state.verified] - last delivery was verified.
 * @param {boolean} [state.hasCheckpoint] - an in-flight/uncertain checkpoint exists.
 * @param {boolean} [state.taskComplete] - all planner steps resolved.
 * @param {boolean} [state.active] - the run is still live.
 * @param {string|null} [state.waiting] - 'approval'|'answer'|'manual'|null.
 * @param {string} [state.status] - run status (complete/error/stopped/running...).
 * @param {number} [state.completedSteps] - verified planner steps.
 * @param {number} [state.blockedSteps] - blocked planner steps.
 * @param {number} [state.remainingSteps] - unfinished planner steps.
 * @returns {{hasVerifiedWork: boolean, verifiedCount: number, unresolved: string[], recoveryAction: string, recoveryMessage: string, gated: boolean}}
 */
export function selectActRecoveryOutcome(state = {}) {
  const s = state || {};
  const waiting = s.waiting || null;
  const terminal = !['running', 'streaming', 'stopping'].includes(
    String(s.status || '').toLowerCase()
  );

  const verifiedCount = (Number(s.completedSteps) || 0) + (s.verified === true ? 1 : 0);
  const hasVerifiedWork = verifiedCount > 0;
  const blockedSteps = Number(s.blockedSteps) || 0;
  const remainingSteps = Number(s.remainingSteps) || 0;

  const unresolved = [];
  if (s.unverified === true) unresolved.push('unverified-mutation');
  if (s.notDelivered === true) unresolved.push('not-delivered');
  if (blockedSteps > 0) unresolved.push('blocked-steps');
  if ((remainingSteps > 0 || s.taskComplete !== true) && s.unverified !== true) {
    unresolved.push('unfinished-steps');
  }
  if (waiting) unresolved.push(`waiting-${waiting}`);

  let recoveryAction = 'finished';
  let recoveryMessage = 'No recovery is needed — this run finished with no unresolved work.';
  if (s.active === true && !s.taskComplete && !waiting) {
    recoveryAction = 'watch';
    recoveryMessage = 'The task is still running. Watch run to follow its live progress.';
  } else if (waiting === 'approval') {
    recoveryAction = 'approve';
    recoveryMessage = 'A page action is awaiting approval. Approve or deny it to continue.';
  } else if (waiting === 'answer') {
    recoveryAction = 'answer';
    recoveryMessage = 'A question is awaiting your answer. Respond to continue.';
  } else if (waiting === 'manual') {
    recoveryAction = 'resume';
    recoveryMessage = 'A manual step is paused. Complete it in the tab, then Resume.';
  } else if (s.unverified === true || s.hasCheckpoint === true) {
    recoveryAction = 'fresh-inspection';
    recoveryMessage =
      'The last page action may or may not have applied. Re-running it could duplicate the change — inspect the page fresh before continuing.';
  } else if (blockedSteps > 0) {
    recoveryAction = 'fresh-inspection';
    recoveryMessage = 'A planner step was blocked. Re-inspect the page before retrying it.';
  } else if (remainingSteps > 0 && !s.taskComplete && terminal) {
    recoveryAction = 'retry-or-continue';
    recoveryMessage = 'The task stopped before finishing. Continue from where it left off.';
  } else if (!hasVerifiedWork && terminal && !s.taskComplete) {
    recoveryAction = 'retry';
    recoveryMessage = 'Nothing was changed on the page, so retrying the request is safe.';
  }

  return {
    hasVerifiedWork,
    verifiedCount,
    unresolved,
    recoveryAction,
    recoveryMessage,
    gated: recoveryAction === 'fresh-inspection',
  };
}

/**
 * Persist only the opaque run identity needed to reconnect the panel.
 * @param {string|null} runId
 * @param {number|null} sourceTabId
 * @returns {Promise<void>}
 */
export function setActiveRun(runId, sourceTabId = null) {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return Promise.resolve();
  if (!runId) return clearActiveRun();
  return chrome.storage.session.set({
    [ACTIVE_RUN_KEY]: {
      runId: String(runId),
      sourceTabId: sourceTabId ?? null,
      savedAt: Date.now(),
    },
  });
}

/**
 * Clear the panel's reconnect pointer without touching the journal itself.
 * @returns {Promise<void>}
 */
export function clearActiveRun() {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return Promise.resolve();
  return chrome.storage.session.remove([ACTIVE_RUN_KEY]);
}

/**
 * Read the active-run pointer and fetch its bounded journal from the worker.
 * @returns {Promise<object|null>}
 */
export async function loadActiveRunJournal() {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return null;
  const result = await chrome.storage.session.get([ACTIVE_RUN_KEY]);
  const pointer = result?.[ACTIVE_RUN_KEY];
  if (!pointer?.runId) return null;
  const response = await chrome.runtime.sendMessage({
    action: 'getRunJournal',
    runId: pointer.runId,
  });
  if (!response?.success || !response.journal) return null;
  return {
    pointer,
    journal: response.journal,
    active: response.active === true,
    ownerToken: response.active ? String(response.ownerToken || '') : '',
  };
}

/**
 * Render a reconnect notice using text nodes only.
 * @param {HTMLElement|null} chatArea
 * @param {object|null} recovery
 * @param {Function} [onDismiss]
 * @param {Function} [onResume]
 * @param {Function} [onWatch]
 * @param {Function} [onTerminal]
 * @returns {HTMLElement|null}
 */
export function renderRunRecoveryNotice(
  chatArea,
  recovery,
  onDismiss,
  onResume,
  onWatch,
  onTerminal
) {
  if (!chatArea || (!recovery?.journal && !recovery?.checkpoint)) return null;
  const existing = chatArea.querySelector('[data-run-recovery]');
  if (existing) return existing;

  const { journal, checkpoint } = recovery;
  const card = document.createElement('div');
  card.className = 'message system-message run-recovery-notice';
  card.dataset.runRecovery = 'true';
  card.setAttribute('role', 'status');

  const title = document.createElement('strong');
  title.textContent = checkpoint
    ? 'Interrupted Act task available'
    : journal.terminal
      ? 'Previous run recovered'
      : 'Run reconnect available';
  card.appendChild(title);

  const detail = document.createElement('p');
  const objective = String(journal?.objective || checkpoint?.instruction || '').trim();
  const status = String(journal?.status || 'paused');
  detail.textContent = checkpoint
    ? `${status}: Act paused before a page action was confirmed delivered. Resume will inspect the page first.`
    : objective
      ? `${status}: ${objective.slice(0, 220)}`
      : `${status}: activity restored from the background worker.`;
  card.appendChild(detail);

  if (checkpoint) {
    const warning = document.createElement('p');
    warning.textContent =
      'The previous mutation may have been delivered. Prompt Paul will not repeat it automatically.';
    card.appendChild(warning);
  }

  const isActiveRun = recovery.active === true && !checkpoint && !journal?.terminal;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'btn btn-outline-secondary btn-sm';
  dismiss.textContent = isActiveRun ? 'Watch run' : 'Dismiss';
  dismiss.addEventListener('click', async () => {
    if (isActiveRun && typeof onWatch === 'function') {
      dismiss.disabled = true;
      try {
        await onWatch(recovery, card);
        card.remove();
      } catch (_) {
        dismiss.disabled = false;
      }
      return;
    }
    if (journal?.terminal && !checkpoint) {
      void clearActiveRun();
      onTerminal?.(recovery);
    }
    onDismiss?.(card);
  });
  card.appendChild(dismiss);

  if (checkpoint && typeof onResume === 'function') {
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'btn btn-primary btn-sm';
    resume.textContent = 'Resume Act';
    resume.addEventListener('click', async () => {
      resume.disabled = true;
      dismiss.disabled = true;
      try {
        await onResume?.(checkpoint, card);
      } catch (_) {
        resume.disabled = false;
        dismiss.disabled = false;
      }
    });
    card.appendChild(resume);
  }
  chatArea.appendChild(card);
  return card;
}

export async function loadActRecovery() {
  const recovery = await loadActiveRunJournal();
  const checkpoints = await listPageActionCheckpoints();
  const checkpoint = recovery?.active
    ? null
    : checkpoints
        .filter((entry) => ['in_flight', 'uncertain_delivery'].includes(entry?.status))
        .sort((left, right) => Number(right.savedAt || 0) - Number(left.savedAt || 0))[0] || null;
  if (!recovery && !checkpoint) return null;
  return { ...(recovery || {}), checkpoint };
}

export async function restoreRunJournal(chatArea, onResume, onWatch, onTerminal) {
  try {
    const recovery = await loadActRecovery();
    if (recovery) {
      if (recovery.journal?.terminal && typeof onTerminal === 'function') {
        onTerminal(recovery);
      } else {
        renderRunRecoveryNotice(
          chatArea,
          recovery,
          (card) => card.remove(),
          onResume,
          onWatch,
          onTerminal
        );
      }
    }
  } catch (error) {
    console.warn('Chat: run journal recovery failed:', error.message);
  }
}

export const runRecoveryStorageKeys = Object.freeze({ activeRun: ACTIVE_RUN_KEY });
