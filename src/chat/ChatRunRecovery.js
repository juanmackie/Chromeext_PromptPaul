/**
 * @fileoverview Session-backed run journal and Act checkpoint recovery helpers.
 * @module ChatRunRecovery
 */

import { listPageActionCheckpoints } from '../utils/pageActionCheckpoint.js';

const ACTIVE_RUN_KEY = 'promptPaulActiveRunV1';

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
