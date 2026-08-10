/**
 * @fileoverview Session-backed run journal helpers for side-panel reconnects.
 * @module ChatRunRecovery
 */

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
  return { pointer, journal: response.journal };
}

/**
 * Render a reconnect notice using text nodes only.
 * @param {HTMLElement|null} chatArea
 * @param {object|null} recovery
 * @param {Function} [onDismiss]
 * @returns {HTMLElement|null}
 */
export function renderRunRecoveryNotice(chatArea, recovery, onDismiss) {
  if (!chatArea || !recovery?.journal) return null;
  const existing = chatArea.querySelector('[data-run-recovery]');
  if (existing) return existing;

  const { journal } = recovery;
  const card = document.createElement('div');
  card.className = 'message system-message run-recovery-notice';
  card.dataset.runRecovery = 'true';
  card.setAttribute('role', 'status');

  const title = document.createElement('strong');
  title.textContent = journal.terminal ? 'Previous run recovered' : 'Run reconnect available';
  card.appendChild(title);

  const detail = document.createElement('p');
  const objective = String(journal.objective || '').trim();
  const status = String(journal.status || 'unknown');
  detail.textContent = objective
    ? `${status}: ${objective.slice(0, 220)}`
    : `${status}: activity restored from the background worker.`;
  card.appendChild(detail);

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'btn btn-outline-secondary btn-sm';
  dismiss.textContent = journal.terminal ? 'Dismiss' : 'Keep visible';
  dismiss.addEventListener('click', () => {
    if (journal.terminal) void clearActiveRun();
    onDismiss?.(card);
  });
  card.appendChild(dismiss);
  chatArea.appendChild(card);
  return card;
}

export async function restoreRunJournal(chatArea) {
  try {
    const recovery = await loadActiveRunJournal();
    if (recovery) renderRunRecoveryNotice(chatArea, recovery);
  } catch (error) {
    console.warn('Chat: run journal recovery failed:', error.message);
  }
}

export const runRecoveryStorageKeys = Object.freeze({ activeRun: ACTIVE_RUN_KEY });
