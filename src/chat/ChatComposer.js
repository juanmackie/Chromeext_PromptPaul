/**
 * @fileoverview Chat Composer Module - composer-led chat UI primitives.
 *
 * Owns the visible context tray, the contextual quick-action row, and inline
 * Stop/Retry/Edit/Continue recovery so chat.js stays under its line limit.
 * State is read from the DOM (tray item visibility, the input area's
 * data-run-state attribute) so no duplicated state lives in chat.js.
 *
 * @module ChatComposer
 */

import { RUN_STATES, isActiveRunState, isRunState } from '../utils/runState.js';
import { shouldGateActRetry } from './ChatRunRecovery.js';

/* ── Quick-action descriptors ────────────────────────────────────────── */

const TEXT_ACTIONS = [
  { id: 'analyze', label: 'Analyze', type: 'analyze' },
  { id: 'proofread', label: 'Proofread', type: 'mode', mode: 'proofread' },
  {
    id: 'explain',
    label: 'Explain',
    type: 'prompt',
    instruction: 'Explain this text in simple terms.',
    actionLabel: 'run Explain',
  },
];

const PAGE_ACTIONS = [
  { id: 'page-summary', label: 'Summary', type: 'mode', mode: 'summary' },
  { id: 'page-tldr', label: 'TL;DR', type: 'mode', mode: 'tldr' },
  { id: 'page-technical', label: 'Technical', type: 'mode', mode: 'technical' },
];

// Starter actions show beside the prompt when the composer has NO attached context.
const STARTER_ACTIONS = [
  { id: 'page-summarize', label: 'Summarize page', type: 'page-summarize' },
  { id: 'ask-page', label: 'Ask about page', type: 'ask-page' },
  { id: 'act-page', label: 'Act on page', type: 'act-page' },
];

// The row is capped so it never crowds the composer; the rest go to overflow.
const MAX_VISIBLE_ACTIONS = 4;

/**
 * Reads the composer-relevant context state from the DOM.
 * @param {Object} tray - Context tray element (or element-like object).
 * @param {Object} container - Input area element carrying data-run-state.
 * @returns {Object} Context state snapshot.
 */
export function getContextState(tray, container) {
  const children = tray ? Array.from(tray.children || []) : [];
  const findHidden = (id) => (children.find((c) => c.id === id) || { hidden: true }).hidden;
  const runState = container && container.dataset ? container.dataset.runState : RUN_STATES.IDLE;
  return {
    hasSelectedText: !findHidden('selected-text-strip'),
    hasPageContext: !findHidden('page-context-strip'),
    hasMedia: !findHidden('attachment-strip'),
    runState: isRunState(runState) ? runState : RUN_STATES.IDLE,
    isActive: isActiveRunState(runState),
  };
}

/**
 * Full set of context-aware quick-action descriptors for a context state,
 * including optional page-scoped site suggestions and the no-context starters.
 * @param {Object} state - Context state from getContextState().
 * @param {Array} [siteActions] - Site-suggestion descriptors (page-scoped).
 * @returns {Array} Quick-action descriptors.
 */
export function getContextActions(state, siteActions = []) {
  const actions = [];
  const hasSelectedText = Boolean(state && state.hasSelectedText);
  const hasPageContext = Boolean(state && state.hasPageContext);
  const hasMedia = Boolean(state && state.hasMedia);
  if (hasSelectedText) actions.push(...TEXT_ACTIONS);
  if (hasPageContext) actions.push(...PAGE_ACTIONS);
  if (hasPageContext && Array.isArray(siteActions)) actions.push(...siteActions);
  // No attached context: offer starter actions so the panel starts work.
  // Site suggestions stay page-scoped (only when page context is attached).
  if (!hasSelectedText && !hasPageContext && !hasMedia) actions.push(...STARTER_ACTIONS);
  return actions;
}

/**
 * Quick-action descriptors shown directly in the row, capped so the compact
 * row stays at or under MAX_VISIBLE_ACTIONS.
 * @param {Object} state - Context state from getContextState().
 * @param {Array} [siteActions] - Site-suggestion descriptors.
 * @param {number} [limit] - Max actions in the row (default MAX_VISIBLE_ACTIONS).
 * @returns {Array} Quick-action descriptors for the row.
 */
export function getQuickActions(state, siteActions = [], limit = MAX_VISIBLE_ACTIONS) {
  return getContextActions(state, siteActions).slice(0, limit);
}

/**
 * Context-aware actions that could not fit in the row and belong in the
 * existing overflow menu.
 * @param {Object} state - Context state from getContextState().
 * @param {Array} [siteActions] - Site-suggestion descriptors.
 * @param {number} [limit] - Max actions in the row (default MAX_VISIBLE_ACTIONS).
 * @returns {Array} Quick-action descriptors for the overflow menu.
 */
export function getOverflowActions(state, siteActions = [], limit = MAX_VISIBLE_ACTIONS) {
  return getContextActions(state, siteActions).slice(limit);
}

/**
 * Determines whether the context tray should be visible.
 * @param {Object} tray - Context tray element.
 * @returns {boolean} True when at least one tray item is visible.
 */
export function isTrayVisible(tray) {
  if (!tray || !tray.children) return false;
  return Array.from(tray.children).some((child) => !child.hidden);
}

/**
 * Create the main conversation action controller.
 * @param {object} options - Action dependencies supplied by chat.js.
 * @returns {{refresh: Function, handleClick: Function}}
 */
export function createConversationController({
  button,
  isBusy,
  getConfig,
  stop,
  resetHermes,
  clearLocal,
  onError,
}) {
  async function refresh() {
    if (!button) return;
    try {
      const config = await getConfig();
      if (!isBusy()) button.textContent = config?.provider === 'hermes' ? 'New chat' : 'Clear';
    } catch (_) {
      if (!isBusy()) button.textContent = 'Clear';
    }
  }

  async function handleClick() {
    if (isBusy()) {
      await stop();
      return;
    }

    try {
      const config = await getConfig();
      if (config?.provider === 'hermes') await resetHermes(config.profileId);
      clearLocal();
      await refresh();
    } catch (error) {
      if (typeof onError === 'function') onError(error);
    }
  }

  return { refresh, handleClick };
}

/**
 * Reads the most recent user prompt from the chat area DOM.
 * @param {Object} chatArea - Chat area element.
 * @returns {string|null} The last user prompt or null.
 */
export function getLastUserPrompt(chatArea) {
  if (!chatArea || typeof chatArea.querySelectorAll !== 'function') return null;
  const userMessages = chatArea.querySelectorAll('.user-message');
  if (userMessages.length === 0) return null;
  const last = userMessages[userMessages.length - 1];
  if (last.dataset && last.dataset.prompt) return last.dataset.prompt;
  const text = last.textContent || '';
  return text.replace(/^You:\s*/, '').trim() || null;
}

/**
 * Reads the structured request/context identity bound to the most recent
 * user message (the originating prompt request object used for the response
 * that this recovery row replays). Undefined when none was captured.
 * @param {Object} chatArea - Chat area element.
 * @returns {Object|undefined} The originating prompt request object or undefined.
 */
export function getLastUserRequest(chatArea) {
  if (!chatArea || typeof chatArea.querySelectorAll !== 'function') return undefined;
  const userMessages = chatArea.querySelectorAll('.user-message');
  if (userMessages.length === 0) return undefined;
  return userMessages[userMessages.length - 1].requestIdentity;
}

/**
 * Finds the latest assistant bubble (the current streaming bubble or the
 * most recent completed response).
 * @param {Object} chatArea - Chat area element.
 * @returns {Object|null} The last .llm-message element or null.
 */
export function getLastAssistantBubble(chatArea) {
  if (!chatArea || typeof chatArea.querySelectorAll !== 'function') return null;
  const bubbles = chatArea.querySelectorAll('.message.llm-message');
  return bubbles.length ? bubbles[bubbles.length - 1] : null;
}

/**
 * Appends an inline Stop button to a streaming bubble (idempotent).
 * @param {Object} bubble - The streaming message element.
 * @param {Function} onStop - Stop handler.
 */
export function ensureStopButton(bubble, onStop) {
  if (typeof document === 'undefined') return;
  if (!bubble || typeof bubble.querySelector !== 'function') return;
  if (bubble.querySelector('[data-inline-stop]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.inlineStop = 'true';
  button.className = 'ext-btn ext-btn--sm ext-btn--destructive inline-stop-btn';
  button.textContent = 'Stop';
  button.title = 'Stop generating';
  button.addEventListener('click', () => {
    if (typeof onStop === 'function') onStop();
  });
  bubble.appendChild(button);
}

/**
 * Appends the inline Retry/Edit/Continue recovery row to a message
 * (idempotent per message). The originating prompt AND its structured
 * request/context identity are bound once at creation time to the
 * transcript then-current, so buttons on older response bubbles re-run
 * their own request (with its original attachments/selection/page context)
 * instead of the newest one.
 * @param {Object} messageDiv - The message element to attach to.
 * @param {Object} options - Which actions to offer: { retry, edit, continue }.
 * @param {Object} handlers - { onStop, onPrompt, onEdit, onActFreshInspection }
 *   callbacks.
 * @param {Object} chatArea - Chat area element (to resolve the originating prompt).
 * @param {Object} [actOutcome] - Terminal Act outcome facts. When the run ended
 *   with an unverified/in-flight mutation, generic Retry is gated: instead of
 *   replaying (which could duplicate the change) the row routes through the
 *   fresh-inspection recovery path via handlers.onActFreshInspection.
 */
export function ensureRecoveryRow(messageDiv, options, handlers, chatArea, actOutcome = null) {
  if (typeof document === 'undefined') return;
  if (!messageDiv || typeof messageDiv.querySelector !== 'function') return;
  if (messageDiv.querySelector('[data-recovery-row]')) return;

  const row = document.createElement('div');
  row.className = 'message-actions';
  row.dataset.recoveryRow = 'true';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Response actions');

  // Bind the originating prompt and its request/context identity once at
  // creation time. Re-reading the whole transcript on every click would
  // resolve the newest prompt/context, so Retry/Edit on an older response
  // would act on the (possibly different) current request.
  const instruction = getLastUserPrompt(chatArea);
  const request = getLastUserRequest(chatArea);
  const retryGated = shouldGateActRetry(actOutcome);

  if (options.retry !== false) {
    if (retryGated) {
      // The originating Act request ended with a mutation whose delivery could
      // not be verified. NEVER auto-replay it: explain the uncertainty and
      // route through the existing fresh-inspection/checkpoint recovery path.
      const gate = makeRecoveryButton('Re-inspect first', 'Inspect the page before continuing');
      gate.addEventListener('click', () => {
        if (typeof handlers.onActFreshInspection === 'function') {
          handlers.onActFreshInspection(actOutcome);
        }
      });
      row.appendChild(gate);
    } else {
      const retry = makeRecoveryButton('Retry', 'Re-run the original request');
      retry.addEventListener('click', () => {
        if (typeof handlers.onPrompt !== 'function') return;
        // Pass the full structured request/context identity so the replay uses
        // the ORIGINAL context, not the current (possibly changed) one. Falls
        // back to the plain prompt when no structured identity was captured.
        handlers.onPrompt(request ? { instruction, request } : instruction, 'retry');
      });
      row.appendChild(retry);
    }
  }

  if (options.edit !== false) {
    const edit = makeRecoveryButton('Edit', 'Edit the original request and resend');
    edit.addEventListener('click', () => {
      if (typeof handlers.onEdit === 'function') {
        handlers.onEdit(instruction, request);
      }
    });
    row.appendChild(edit);
  }

  if (options.continue === true) {
    const cont = makeRecoveryButton('Continue', 'Continue from the last response');
    cont.addEventListener('click', () => {
      if (typeof handlers.onPrompt === 'function') {
        handlers.onPrompt('Continue', 'continue');
      }
    });
    row.appendChild(cont);
  }

  messageDiv.appendChild(row);
}

/**
 * Creates a small recovery action button.
 * @param {string} label - Button text.
 * @param {string} title - Accessible title.
 * @returns {HTMLButtonElement} The button element.
 */
function makeRecoveryButton(label, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ext-btn ext-btn--sm ext-btn--ghost';
  button.textContent = label;
  button.title = title;
  return button;
}

/* ── Composer controller ─────────────────────────────────────────────── */

/**
 * Initializes the composer-led UI. Wires tray visibility, the contextual
 * quick-action row, and run-state driven inline recovery.
 * @param {Object} options - Wiring options.
 * @param {Object} options.container - The #input-area element.
 * @param {Object} options.tray - The #context-tray element.
 * @param {Object} options.row - The #quick-actions-row element.
 * @param {Object} options.chatArea - The #chat-area element.
 * @param {Object} options.inputField - The #user-input textarea.
 * @param {Object} options.overflowMenu - The existing #quick-actions-menu element
 *   that receives context actions which do not fit in the row.
 * @param {boolean} [options.actEnabled] - Initial Act permission state.
 * @param {Array} [options.siteActions] - Initial page-scoped site suggestions.
 * @param {Object} options.handlers - Action callbacks: { onStop, onPrompt,
 *   onEdit, onMode, onPageMode, onAnalyze, onDetachPage, onPageSummary,
 *   onAskPage, onActPage }.
 * @returns {Object} The composer controller with refresh(), setPageContext(),
 *   setSiteActions(), and setActEnabled() methods.
 */
export function initComposer(options) {
  const { container, tray, row, chatArea, overflowMenu, handlers } = options || {};
  let actEnabled = Boolean(options && options.actEnabled);
  let currentSiteActions = (options && options.siteActions) || [];
  const useMutationObserver =
    typeof MutationObserver === 'function' &&
    container &&
    typeof container.isConnected === 'boolean';

  function refresh() {
    syncTrayVisibility();
    const state = getContextState(tray, container);
    renderQuickActions(state);
    syncRunState(state);
  }

  function renderQuickActions(state) {
    if (!row) return;
    if (typeof document === 'undefined') return;
    // Hide the action row during an active run rather than leave orphaned chips.
    if (state && state.isActive) {
      row.innerHTML = '';
      row.hidden = true;
      return;
    }
    const visible = getQuickActions(state, currentSiteActions);
    const overflow = getOverflowActions(state, currentSiteActions);
    row.innerHTML = '';
    if (visible.length > 0) {
      const label = document.createElement('span');
      label.className = 'quick-actions-label';
      label.textContent = 'Quick actions';
      row.appendChild(label);
    }
    for (const action of visible) {
      row.appendChild(makeActionChip(action));
    }
    const actIndicator = makeActIndicator(state);
    if (actIndicator) row.appendChild(actIndicator);
    row.hidden = visible.length === 0 && !actEnabled;
    renderOverflowActions(overflow);
  }

  function makeActionChip(action) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ext-chip';
    chip.textContent = action.label;
    chip.title = action.title || action.label;
    chip.addEventListener('click', () => dispatchAction(action));
    return chip;
  }

  // Surf the sticky Act session permission beside the composer while idle.
  function makeActIndicator(state) {
    if (!actEnabled || !state || state.isActive) return null;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ext-chip ext-chip--act';
    chip.textContent = 'Act: on';
    chip.title = 'Page actions are on for this browser session. Click to disable.';
    chip.setAttribute('aria-pressed', 'true');
    chip.addEventListener('click', () => {
      if (typeof handlers.onActPage === 'function') handlers.onActPage();
    });
    return chip;
  }

  function renderOverflowActions(overflow) {
    if (!overflowMenu || typeof document === 'undefined') return;
    let section = overflowMenu.querySelector('[data-context-overflow]');
    if (overflow.length === 0) {
      if (section) section.remove();
      return;
    }
    if (!section) {
      section = document.createElement('section');
      section.className = 'quick-actions-section';
      section.dataset.contextOverflow = 'true';
      const heading = document.createElement('h2');
      heading.textContent = 'Context';
      const chipContainer = document.createElement('div');
      chipContainer.dataset.contextOverflowChips = 'true';
      section.append(heading, chipContainer);
      overflowMenu.appendChild(section);
    }
    let chipContainer = section.querySelector('[data-context-overflow-chips]');
    if (!chipContainer) {
      chipContainer = document.createElement('div');
      chipContainer.dataset.contextOverflowChips = 'true';
      section.appendChild(chipContainer);
    }
    chipContainer.innerHTML = '';
    for (const action of overflow) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'quick-action-button quick-action-menu-item';
      chip.textContent = action.label;
      chip.title = action.title || action.label;
      chip.dataset.closeQuickActions = 'true';
      chip.addEventListener('click', () => dispatchAction(action));
      chipContainer.appendChild(chip);
    }
  }

  function dispatchAction(action) {
    if (!action) return;
    switch (action.type) {
      case 'analyze':
        if (typeof handlers.onAnalyze === 'function') handlers.onAnalyze();
        return;
      case 'mode':
        if (typeof handlers.onMode === 'function') handlers.onMode(action.mode);
        return;
      case 'prompt':
        if (typeof handlers.onPrompt === 'function') {
          handlers.onPrompt(action.instruction, action.actionLabel || action.label);
        }
        return;
      case 'page-summarize':
        if (typeof handlers.onPageSummary === 'function') handlers.onPageSummary();
        return;
      case 'ask-page':
        if (typeof handlers.onAskPage === 'function') handlers.onAskPage();
        return;
      case 'act-page':
        if (typeof handlers.onActPage === 'function') handlers.onActPage();
        return;
      default:
        if (action.type === 'site' && typeof action.run === 'function') action.run();
        return;
    }
  }

  function syncRunState(state) {
    if (!chatArea) return;
    const renderRecovery = (bubble, options) => {
      const actOutcome =
        typeof handlers.getRunActOutcome === 'function' ? handlers.getRunActOutcome() : null;
      ensureRecoveryRow(bubble, options, handlers, chatArea, actOutcome);
    };
    if (state.isActive) {
      const bubble = getLastAssistantBubble(chatArea);
      if (bubble) ensureStopButton(bubble, handlers.onStop);
      return;
    }
    if (state.runState === RUN_STATES.COMPLETE) {
      const bubble = getLastAssistantBubble(chatArea);
      if (bubble) renderRecovery(bubble, { retry: true, edit: true, continue: true });
    } else if (state.runState === RUN_STATES.ERROR || state.runState === RUN_STATES.STOPPED) {
      const bubble = getLastAssistantBubble(chatArea);
      if (bubble) renderRecovery(bubble, { retry: true, edit: true, continue: false });
    }
  }

  function syncTrayVisibility() {
    if (!tray) return;
    const shouldHide = !isTrayVisible(tray);
    // Avoid writing the same boolean attribute from inside the observer that
    // watches it. Chrome can deliver same-value attribute writes as mutation
    // records, which would otherwise keep refresh() running indefinitely.
    if (tray.hidden !== shouldHide) tray.hidden = shouldHide;
  }

  // Tray visibility follows its items' hidden attributes.
  if (useMutationObserver) {
    new MutationObserver(syncTrayVisibility).observe(tray, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });
  }

  // Run state drives inline recovery; quick actions follow context.
  if (useMutationObserver) {
    new MutationObserver(refresh).observe(container, {
      attributes: true,
      attributeFilter: ['data-run-state'],
    });
  } else if (container && typeof container.addEventListener === 'function') {
    container.addEventListener('data-run-state', refresh);
  }

  // The quick-action row reacts to tray context changes too.
  if (useMutationObserver) {
    new MutationObserver(refresh).observe(tray, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });
  }

  // Wire the tray's page-context Remove button to the detach handler.
  const pageContextStrip = tray
    ? Array.from(tray.children || []).find((child) => child.id === 'page-context-strip')
    : null;
  const pageContextRemoveButton =
    pageContextStrip && typeof pageContextStrip.querySelector === 'function'
      ? pageContextStrip.querySelector('#page-context-remove-button')
      : null;
  if (pageContextRemoveButton && typeof handlers?.onDetachPage === 'function') {
    pageContextRemoveButton.addEventListener('click', () => handlers.onDetachPage());
  }

  syncTrayVisibility();
  refresh();

  return {
    refresh,
    setPageContext(page) {
      if (!tray) return;
      const strip = Array.from(tray.children || []).find(
        (child) => child.id === 'page-context-strip'
      );
      if (!strip) return;
      const details =
        typeof strip.querySelector === 'function'
          ? strip.querySelector('#page-context-details')
          : null;
      const titleEl =
        typeof strip.querySelector === 'function' ? strip.querySelector('.attachment-title') : null;
      if (page) {
        if (titleEl) titleEl.textContent = page.title || 'Page content';
        const type = page.type || 'Page content';
        if (details) {
          const trunc = page.truncated || /trimmed/i.test(String(page.details || ''));
          const base = String(page.details || page.url || '')
            .replace(/\s*\(trimmed\)\s*/gi, '')
            .trim();
          const parts = [];
          if (type && type !== 'Page content') parts.push(type);
          if (base) parts.push(base);
          details.textContent =
            `${parts.join(' · ')}${trunc ? ' · trimmed to fit context budget' : ''}`.trim();
        }
        strip.hidden = false;
      } else {
        strip.hidden = true;
        if (details) details.textContent = '';
        if (titleEl) titleEl.textContent = 'Page content';
      }
      syncTrayVisibility();
      refresh();
    },
    setSiteActions(actions) {
      currentSiteActions = Array.isArray(actions) ? actions : [];
      refresh();
    },
    setActEnabled(enabled) {
      const next = Boolean(enabled);
      if (next !== actEnabled) {
        actEnabled = next;
        refresh();
      }
    },
  };
}

export const chatComposer = {
  initComposer,
  getContextState,
  getContextActions,
  getQuickActions,
  getOverflowActions,
  createConversationController,
  getLastUserPrompt,
  getLastUserRequest,
  getLastAssistantBubble,
  ensureStopButton,
  ensureRecoveryRow,
};
