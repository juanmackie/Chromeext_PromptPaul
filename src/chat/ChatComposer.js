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

/**
 * Reads the composer-relevant context state from the DOM.
 * @param {Object} tray - Context tray element (or element-like object).
 * @param {Object} container - Input area element carrying data-run-state.
 * @returns {Object} Context state snapshot.
 */
export function getContextState(tray, container) {
  const children = tray ? Array.from(tray.children || []) : [];
  const findHidden = (id) => {
    const el = children.find((child) => child.id === id);
    return el ? Boolean(el.hidden) : true;
  };
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
 * Returns the quick-action descriptors valid for a context state.
 * @param {Object} state - Context state from getContextState().
 * @returns {Array} Quick-action descriptors.
 */
export function getQuickActions(state) {
  const actions = [];
  if (state && state.hasSelectedText) {
    actions.push(...TEXT_ACTIONS);
  }
  if (state && state.hasPageContext) {
    actions.push(...PAGE_ACTIONS);
  }
  return actions;
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
 * (idempotent per message). The prompt is bound once at creation time to
 * the transcript then-current, so buttons on older response bubbles re-run
 * their own request instead of the newest one.
 * @param {Object} messageDiv - The message element to attach to.
 * @param {Object} options - Which actions to offer: { retry, edit, continue }.
 * @param {Object} handlers - { onStop, onPrompt, onEdit } callbacks.
 * @param {Object} chatArea - Chat area element (to resolve the originating prompt).
 */
export function ensureRecoveryRow(messageDiv, options, handlers, chatArea) {
  if (typeof document === 'undefined') return;
  if (!messageDiv || typeof messageDiv.querySelector !== 'function') return;
  if (messageDiv.querySelector('[data-recovery-row]')) return;

  const row = document.createElement('div');
  row.className = 'message-actions';
  row.dataset.recoveryRow = 'true';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Response actions');

  // Bind the originating prompt once at creation time. Re-reading the
  // whole transcript on every click would resolve the newest prompt, so
  // Retry/Edit on an older response would act on an unrelated request.
  const instruction = getLastUserPrompt(chatArea);

  if (options.retry !== false) {
    const retry = makeRecoveryButton('Retry', 'Re-run the last prompt');
    retry.addEventListener('click', () => {
      if (instruction && typeof handlers.onPrompt === 'function') {
        handlers.onPrompt(instruction, 'retry');
      }
    });
    row.appendChild(retry);
  }

  if (options.edit !== false) {
    const edit = makeRecoveryButton('Edit', 'Edit the last prompt and resend');
    edit.addEventListener('click', () => {
      if (typeof handlers.onEdit === 'function') handlers.onEdit(instruction);
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
 * @param {Object} options.handlers - Action callbacks: { onStop, onPrompt,
 *   onEdit, onMode, onPageMode, onAnalyze, onDetachPage }.
 * @returns {Object} The composer controller with a refresh() method.
 */
export function initComposer(options) {
  const { container, tray, row, chatArea, handlers } = options || {};
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
    const actions = getQuickActions(state);
    row.innerHTML = '';
    if (actions.length > 0) {
      const label = document.createElement('span');
      label.className = 'quick-actions-label';
      label.textContent = 'Quick actions';
      row.appendChild(label);
    }
    for (const action of actions) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ext-chip';
      chip.textContent = action.label;
      chip.title = action.title || action.label;
      chip.addEventListener('click', () => dispatchAction(action));
      row.appendChild(chip);
    }
    row.hidden = actions.length === 0;
  }

  function dispatchAction(action) {
    if (action.type === 'analyze' && typeof handlers.onAnalyze === 'function') {
      handlers.onAnalyze();
    } else if (action.type === 'mode' && typeof handlers.onMode === 'function') {
      handlers.onMode(action.mode);
    } else if (action.type === 'prompt' && typeof handlers.onPrompt === 'function') {
      handlers.onPrompt(action.instruction, action.actionLabel || action.label);
    }
  }

  function syncRunState(state) {
    if (!chatArea) return;
    if (state.isActive) {
      const bubble = getLastAssistantBubble(chatArea);
      if (bubble) ensureStopButton(bubble, handlers.onStop);
      return;
    }
    if (state.runState === RUN_STATES.COMPLETE) {
      const bubble = getLastAssistantBubble(chatArea);
      if (bubble) {
        ensureRecoveryRow(bubble, { retry: true, edit: true, continue: true }, handlers, chatArea);
      }
    } else if (state.runState === RUN_STATES.ERROR || state.runState === RUN_STATES.STOPPED) {
      const bubble = getLastAssistantBubble(chatArea);
      if (bubble) {
        ensureRecoveryRow(bubble, { retry: true, edit: true, continue: false }, handlers, chatArea);
      }
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
      if (page) {
        if (details) details.textContent = `${page.details || page.url || ''}`;
        strip.hidden = false;
      } else {
        strip.hidden = true;
        if (details) details.textContent = '';
      }
      syncTrayVisibility();
      refresh();
    },
  };
}

export const chatComposer = {
  initComposer,
  getContextState,
  getQuickActions,
  createConversationController,
  getLastUserPrompt,
  getLastAssistantBubble,
  ensureStopButton,
  ensureRecoveryRow,
};
