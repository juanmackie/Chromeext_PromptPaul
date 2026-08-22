/**
 * @fileoverview Current-tab page-action opt-in state and sidebar toggle.
 * @module ChatPageAutomation
 */

const PAGE_ACTIONS_ENABLED_KEY = 'pageActionsEnabled';
const PAGE_ACTIONS_MULTI_TAB_KEY = 'pageActionsMultiTabEnabled';
const PAGE_ACTIONS_STORAGE = 'session';

function getPageActionsStorage() {
  return chrome.storage[PAGE_ACTIONS_STORAGE];
}

/**
 * Read the session-scoped page-action opt-in state without consuming it.
 * @returns {Promise<boolean>}
 */
export function isPageActionsEnabled() {
  return new Promise((resolve) => {
    getPageActionsStorage().get([PAGE_ACTIONS_ENABLED_KEY], (result) => {
      resolve(Boolean(result?.[PAGE_ACTIONS_ENABLED_KEY]));
    });
  });
}

/**
 * Arm page actions for the next run in the current browser session.
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export function setPageActionsEnabled(enabled) {
  return new Promise((resolve) => {
    getPageActionsStorage().set({ [PAGE_ACTIONS_ENABLED_KEY]: Boolean(enabled) }, resolve);
  });
}

/**
 * Read and consume the page-action opt-in state for one run.
 * @returns {Promise<boolean>}
 */
export function consumePageActionsEnabled() {
  return new Promise((resolve) => {
    const storage = getPageActionsStorage();
    storage.get([PAGE_ACTIONS_ENABLED_KEY], (result) => {
      const enabled = Boolean(result?.[PAGE_ACTIONS_ENABLED_KEY]);
      storage.remove([PAGE_ACTIONS_ENABLED_KEY], () => resolve(enabled));
    });
  });
}

export function isPageActionsMultiTabEnabled() {
  return new Promise((resolve) => {
    chrome.storage.local.get([PAGE_ACTIONS_MULTI_TAB_KEY], (result) => {
      resolve(Boolean(result?.[PAGE_ACTIONS_MULTI_TAB_KEY]));
    });
  });
}

function applyMultiTabToggle(element, enabled) {
  if (!element) return;
  element.setAttribute('aria-pressed', String(enabled));
  element.title = enabled
    ? 'Multi-tab page actions are on — new sites require approval'
    : 'Multi-tab page actions are off';
}

export function initPageActionsMultiTabToggle(toggleElement, loadingManagerRef) {
  if (!toggleElement) return;
  isPageActionsMultiTabEnabled().then((enabled) => applyMultiTabToggle(toggleElement, enabled));
  toggleElement.addEventListener('click', async () => {
    const next = toggleElement.getAttribute('aria-pressed') !== 'true';
    await chrome.storage.local.set({ [PAGE_ACTIONS_MULTI_TAB_KEY]: next });
    applyMultiTabToggle(toggleElement, next);
    loadingManagerRef?.showToast?.(
      next ? 'Multi-tab actions enabled for the next run.' : 'Multi-tab actions disabled.',
      'info'
    );
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[PAGE_ACTIONS_MULTI_TAB_KEY]) {
      applyMultiTabToggle(toggleElement, Boolean(changes[PAGE_ACTIONS_MULTI_TAB_KEY].newValue));
    }
  });
}

function findConfirmationCard(chatArea, confirmationId) {
  return Array.from(chatArea?.querySelectorAll?.('[data-page-action-confirmation]') || []).find(
    (card) => card.dataset.pageActionConfirmation === confirmationId
  );
}

function getActivityCard(chatArea) {
  return chatArea?.querySelector?.('[data-page-action-activity]') || null;
}

/**
 * Render/update one compact activity card for the current page-action run.
 * Repeated tool events update this card instead of adding one system message
 * per action, keeping the chat readable and reducing DOM churn.
 * @param {HTMLElement|null} chatArea
 * @param {object} event
 * @returns {HTMLElement|null}
 */
export function updatePageActionActivity(chatArea, event = {}) {
  if (!chatArea) return null;
  let card = getActivityCard(chatArea);
  if (!card) {
    card = document.createElement('div');
    card.className = 'message system-message page-action-activity';
    card.dataset.pageActionActivity = 'true';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    const heading = document.createElement('strong');
    heading.textContent = 'Page activity';
    card.appendChild(heading);
    const list = document.createElement('ol');
    list.className = 'page-action-activity-list';
    card.appendChild(list);
    chatArea.appendChild(card);
  }

  const list = card.querySelector('.page-action-activity-list');
  if (!list) return card;
  const key = String(event.sequence || `${event.action || 'action'}-${event.state || 'update'}`);
  let item = Array.from(list.children).find((entry) => entry.dataset.activityKey === key);
  if (!item) {
    item = document.createElement('li');
    item.dataset.activityKey = key;
    list.appendChild(item);
  }
  const action = String(event.action || 'page action').replace(/^page_/, '');
  const target = event.target?.label ? ` — ${event.target.label}` : '';
  const state = event.state || (event.type === 'page_action_warning' ? 'warning' : 'updated');
  const disposition = String(event.receipt?.disposition || '').replaceAll('_', ' ');
  const receiptText = disposition ? ` — ${disposition}` : '';
  item.textContent = `${action}${target}: ${state}${receiptText}${event.message ? ` — ${event.message}` : ''}`;
  while (list.children.length > 12) list.removeChild(list.firstElementChild);
  chatArea.scrollTop = chatArea.scrollHeight;
  return card;
}

export function renderPageUserInputRequest(chatArea, event, onSubmit) {
  if (!chatArea || !event?.requestId) return null;
  const card = document.createElement('div');
  card.className = 'message system-message page-user-input-request';
  card.dataset.pageUserInput = event.requestId;
  const question = document.createElement('p');
  question.textContent = String(event.question || 'Please provide clarification.').slice(0, 600);
  card.appendChild(question);
  const controls = document.createElement('div');
  controls.className = 'page-action-confirmation-controls';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 2_000;
  input.className = 'form-control';
  input.setAttribute('aria-label', 'Answer');
  controls.appendChild(input);
  for (const option of Array.isArray(event.options) ? event.options.slice(0, 6) : []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-outline-secondary btn-sm';
    button.textContent = String(option).slice(0, 120);
    button.addEventListener('click', () => {
      input.value = button.textContent;
      input.focus();
    });
    controls.appendChild(button);
  }
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn btn-primary btn-sm';
  submit.textContent = 'Send';
  submit.addEventListener('click', () => {
    submit.disabled = true;
    input.disabled = true;
    onSubmit?.(event.requestId, input.value);
  });
  controls.appendChild(submit);
  card.appendChild(controls);
  chatArea.appendChild(card);
  input.focus();
  return card;
}

export function handlePageUserInputRequest(chatArea, event, runId, sourceTabId) {
  if (event?.type === 'page_manual_intervention_request') {
    return handlePageManualInterventionRequest(chatArea, event, runId, sourceTabId);
  }
  return renderPageUserInputRequest(chatArea, event, (requestId, answer) =>
    chrome.runtime.sendMessage({
      action: 'pageUserInputResponse',
      runId,
      requestId,
      answer,
      ownerToken: event.ownerToken || '',
      sourceTabId,
    })
  );
}

export function handlePageManualInterventionRequest(chatArea, event, runId, sourceTabId) {
  if (!chatArea || !event?.requestId) return null;
  const existing = chatArea.querySelector(`[data-page-manual-intervention="${event.requestId}"]`);
  if (existing) return existing;
  const card = document.createElement('div');
  card.className = 'message system-message page-action-confirmation';
  card.dataset.pageManualIntervention = event.requestId;
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-live', 'assertive');
  const title = document.createElement('strong');
  title.textContent = 'Manual step needed';
  card.appendChild(title);
  const question = document.createElement('p');
  question.textContent = String(
    event.question || 'Complete the safe step in the visible tab.'
  ).slice(0, 600);
  card.appendChild(question);
  if (event.activeTab) {
    const activeTab = document.createElement('p');
    activeTab.className = 'page-action-confirmation-context';
    const activeTitle = String(event.activeTab.title || '').trim();
    const activeOrigin = String(event.activeTab.origin || '').trim();
    const tabId = Number.isInteger(event.activeTab.tabId)
      ? `tab ${event.activeTab.tabId}`
      : 'active tab';
    activeTab.textContent = `Active ${tabId}${activeTitle ? ` — ${activeTitle}` : ''}${
      activeOrigin ? ` (${activeOrigin})` : ''
    }`;
    card.appendChild(activeTab);
  }
  const controls = document.createElement('div');
  controls.className = 'page-action-confirmation-controls';
  const resume = document.createElement('button');
  resume.type = 'button';
  resume.className = 'btn btn-primary btn-sm';
  resume.textContent = 'Resume';
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'btn btn-outline-danger btn-sm';
  stop.textContent = 'Stop';
  const settle = (state) => {
    resume.disabled = true;
    stop.disabled = true;
    card.dataset.decision = state;
  };
  resume.addEventListener('click', async () => {
    settle('resumed');
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'pageManualInterventionResume',
        runId,
        requestId: event.requestId,
        ownerToken: event.ownerToken || '',
        sourceTabId,
      });
      if (!response?.success) card.dataset.decision = 'error';
    } catch (_) {
      card.dataset.decision = 'error';
    }
  });
  stop.addEventListener('click', () => {
    settle('stopped');
    void chrome.runtime.sendMessage({
      action: 'abortRun',
      runId,
      ownerToken: event.ownerToken || '',
      sourceTabId,
    });
  });
  controls.append(resume, stop);
  card.appendChild(controls);
  chatArea.appendChild(card);
  chatArea.scrollTop = chatArea.scrollHeight;
  return card;
}

function applyPageActionsToggle(element, enabled) {
  if (!element) return;
  element.setAttribute('aria-pressed', String(enabled));
  element.title = enabled
    ? 'Page actions are on — click to disable current-page actions'
    : 'Page actions are off — click to enable current-page actions';
}

/**
 * Wire the explicit current-page action permission toggle.
 * @param {HTMLElement|null} toggleElement
 * @param {object} loadingManagerRef
 */
export function initPageActionsToggle(toggleElement, loadingManagerRef) {
  if (!toggleElement) return;

  isPageActionsEnabled().then((enabled) => applyPageActionsToggle(toggleElement, enabled));
  toggleElement.addEventListener('click', async () => {
    const next = toggleElement.getAttribute('aria-pressed') !== 'true';
    await setPageActionsEnabled(next);
    applyPageActionsToggle(toggleElement, next);
    loadingManagerRef?.showToast?.(
      next
        ? 'Page actions enabled for the next run. Risky actions still require approval.'
        : 'Page actions disabled for the next run.',
      'info'
    );
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === PAGE_ACTIONS_STORAGE && changes[PAGE_ACTIONS_ENABLED_KEY]) {
      applyPageActionsToggle(toggleElement, Boolean(changes[PAGE_ACTIONS_ENABLED_KEY].newValue));
    }
  });
}

/**
 * Render an approval card using text nodes only; page text and model summaries
 * must never become HTML. The card shows bounded origin/title context and an
 * explicit Stop affordance that aborts the run.
 * @param {HTMLElement|null} chatArea
 * @param {object} event
 * @param {Function} onDecision - called with (confirmationId, approved, approveAll).
 * @param {Function} [onStop] - called when the user stops the run from the card.
 * @returns {HTMLElement|null}
 */
export function renderPageActionConfirmation(chatArea, event, onDecision, onStop) {
  if (!chatArea || !event?.confirmationId) return null;
  const existing = findConfirmationCard(chatArea, event.confirmationId);
  if (existing) return existing;

  const card = document.createElement('div');
  card.className = 'message system-message page-action-confirmation';
  card.dataset.pageActionConfirmation = event.confirmationId;
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-live', 'assertive');

  const title = document.createElement('strong');
  title.textContent = 'Approval needed for page action';
  card.appendChild(title);

  // Bounded origin/title context so the user can see which page the action
  // targets. Values come from the orchestrator as plain bounded strings.
  if (event.origin || event.destinationOrigin || event.destination || event.title) {
    const context = document.createElement('p');
    context.className = 'page-action-confirmation-context';
    const parts = [];
    if (event.title) parts.push(event.title);
    if (event.origin) parts.push(`(${event.origin})`);
    context.textContent = `On ${parts.join(' ')}`;
    card.appendChild(context);
  }

  if (event.destination) {
    const destination = document.createElement('p');
    destination.className = 'page-action-confirmation-destination';
    destination.textContent = `Destination: ${event.destination}`;
    card.appendChild(destination);
  }

  const summary = document.createElement('p');
  summary.textContent = `${event.summary || event.action || 'Page action'} (${event.risk || 'risk unknown'})`;
  card.appendChild(summary);

  const reason = document.createElement('p');
  reason.className = 'page-action-confirmation-reason';
  reason.textContent = event.reason || 'This action may change the current page.';
  card.appendChild(reason);

  const controls = document.createElement('div');
  controls.className = 'page-action-confirmation-controls';
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'btn btn-primary btn-sm';
  approve.textContent = 'Approve';
  const approveAll = document.createElement('button');
  approveAll.type = 'button';
  approveAll.className = 'btn btn-outline-primary btn-sm';
  approveAll.textContent = 'Approve all this session';
  approveAll.title = 'Approve all policy-allowed page actions for this chat run.';
  const deny = document.createElement('button');
  deny.type = 'button';
  deny.className = 'btn btn-outline-secondary btn-sm';
  deny.textContent = 'Deny';
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'btn btn-outline-danger btn-sm';
  stop.textContent = 'Stop';

  const disableAll = () => {
    approve.disabled = true;
    approveAll.disabled = true;
    deny.disabled = true;
    stop.disabled = true;
  };

  const decide = (approved, approveForSession = false) => {
    disableAll();
    onDecision?.(event.confirmationId, approved, approveForSession);
    card.dataset.decision = approveForSession
      ? 'approved-session'
      : approved
        ? 'approved'
        : 'denied';
    card.setAttribute(
      'aria-label',
      approveForSession
        ? 'Page action approved for this session'
        : approved
          ? 'Page action approved'
          : 'Page action denied'
    );
  };
  approve.addEventListener('click', () => decide(true));
  approveAll.addEventListener('click', () => decide(true, true));
  deny.addEventListener('click', () => decide(false));
  stop.addEventListener('click', () => {
    disableAll();
    card.dataset.decision = 'stopped';
    card.setAttribute('aria-label', 'Page action run stopped');
    onStop?.();
  });
  controls.append(approve, approveAll, deny, stop);
  card.appendChild(controls);
  chatArea.appendChild(card);
  chatArea.scrollTop = chatArea.scrollHeight;
  return card;
}

/**
 * Mark a confirmation card as resolved or cancelled.
 * @param {HTMLElement|null} chatArea
 * @param {object} event
 */
export function resolvePageActionConfirmation(chatArea, event) {
  if (!chatArea || !event?.confirmationId) return;
  const card = findConfirmationCard(chatArea, event.confirmationId);
  if (!card) return;
  card.querySelectorAll('button').forEach((button) => {
    button.disabled = true;
  });
  card.dataset.decision = event.approveAll
    ? 'approved-session'
    : event.approved
      ? 'approved'
      : 'denied';
  card.setAttribute(
    'aria-label',
    event.approveAll
      ? 'Page action approved for this session'
      : event.approved
        ? 'Page action approved'
        : 'Page action denied'
  );
}

/**
 * Resolve all visible approval cards when a run is stopped.
 * @param {HTMLElement|null} chatArea
 */
export function cancelPageActionConfirmations(chatArea) {
  if (!chatArea) return;
  chatArea.querySelectorAll('[data-page-action-confirmation]').forEach((card) => {
    card.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    card.dataset.decision = 'cancelled';
    card.setAttribute('aria-label', 'Page action confirmation cancelled');
  });
}

export const pageActionStorageKeys = Object.freeze({
  enabled: PAGE_ACTIONS_ENABLED_KEY,
  multiTab: PAGE_ACTIONS_MULTI_TAB_KEY,
  trustedMode: 'pageActionsTrustedMode',
});
