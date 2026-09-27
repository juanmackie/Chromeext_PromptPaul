/**
 * @fileoverview Current-tab page-action opt-in state and sidebar toggle.
 * @module ChatPageAutomation
 */

import { selectActRecoveryOutcome } from './ChatRunRecovery.js';

const PAGE_ACTIONS_ENABLED_KEY = 'pageActionsEnabled';
const PAGE_ACTIONS_STORAGE = 'session';

let pageActionsToggleElement = null;
let pageActionsArmed = false;
let pageActionsRunActive = false;
let pageActionsStateVersion = 0;

function getPageActionsStorage() {
  return chrome.storage[PAGE_ACTIONS_STORAGE];
}

function storageError() {
  const error = chrome.runtime?.lastError;
  return error ? new Error(error.message || 'Act permission storage failed.') : null;
}

function renderPageActionsToggle() {
  if (!pageActionsToggleElement) return;
  applyPageActionsToggle(pageActionsToggleElement, pageActionsArmed);
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
 * Enable or disable page actions for the current browser session.
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export function setPageActionsEnabled(enabled) {
  pageActionsStateVersion += 1;
  pageActionsArmed = Boolean(enabled);
  renderPageActionsToggle();
  return new Promise((resolve, reject) => {
    getPageActionsStorage().set({ [PAGE_ACTIONS_ENABLED_KEY]: pageActionsArmed }, () => {
      const error = storageError();
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * Keep the sidebar Act toggle visually active for the lifetime of an
 * accepted page-action run.
 * @param {boolean} active
 */
export function setPageActionsRunActive(active) {
  pageActionsRunActive = Boolean(active);
  renderPageActionsToggle();
}

function findConfirmationCard(chatArea, confirmationId) {
  return Array.from(chatArea?.querySelectorAll?.('[data-page-action-confirmation]') || []).find(
    (card) => card.dataset.pageActionConfirmation === confirmationId
  );
}

function getActivityCard(chatArea, runId = '') {
  const cards = Array.from(chatArea?.querySelectorAll?.('[data-page-action-activity]') || []);
  return cards.find((card) => card.dataset.pageActionRunId === runId) || (runId ? null : cards[0]);
}

/**
 * Translate an Act delivery disposition into plain language, preserving the
 * distinction between a verified single action and whole-task completion.
 * @param {string|null} disposition
 * @returns {string}
 */
export function formatPlainLanguageDisposition(disposition) {
  switch (disposition) {
    case 'delivered_verified':
      return 'Verified';
    case 'delivered_unverified':
      return 'Performed - verification unavailable';
    case 'not_delivered':
      return 'Not performed';
    default:
      return '';
  }
}

function getProgressCard(chatArea, runId = '') {
  const cards = Array.from(chatArea?.querySelectorAll?.('[data-page-task-progress]') || []);
  return cards.find((card) => card.dataset.pageActionRunId === runId) || (runId ? null : cards[0]);
}

const WAITING_LABELS = {
  approval: 'Approval needed',
  answer: 'Answer needed',
  manual: 'Manual step required',
};

/**
 * Render/update the run-scoped readable Act progress card from bounded
 * page_task_progress events. The card shows the current step and target page,
 * pending-interaction waiting states, plain-language delivery for the current
 * action, and — only when a planner exists — completed/current/blocked steps.
 * Runs without a planner show the current action only and never invent a plan
 * or a completion percentage. A collapsed technical log (fed separately by
 * page_action_state events) is available for troubleshooting.
 * @param {HTMLElement|null} chatArea
 * @param {object} event
 * @param {string} [runId]
 * @returns {HTMLElement|null}
 */
export function updatePageTaskProgress(chatArea, event = {}, runId = '') {
  if (!chatArea) return null;
  const runKey = String(runId || event.runId || '').slice(0, 128);
  let card = getProgressCard(chatArea, runKey);
  if (!card) {
    card = document.createElement('div');
    card.className = 'message system-message page-task-progress';
    card.dataset.pageTaskProgress = 'true';
    card.dataset.pageActionRunId = runKey;
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');

    const heading = document.createElement('strong');
    heading.textContent = 'Act progress';
    card.appendChild(heading);

    const status = document.createElement('p');
    status.className = 'page-task-progress-status';
    card.appendChild(status);

    const waiting = document.createElement('p');
    waiting.className = 'page-task-progress-waiting';
    card.appendChild(waiting);

    const receipt = document.createElement('p');
    receipt.className = 'page-task-progress-receipt';
    card.appendChild(receipt);

    const outcome = document.createElement('div');
    outcome.className = 'page-task-progress-outcome';
    card.appendChild(outcome);

    const steps = document.createElement('ol');
    steps.className = 'page-task-progress-steps';
    steps.setAttribute('aria-label', 'Planner steps');
    card.appendChild(steps);

    const history = document.createElement('details');
    history.className = 'page-task-progress-history';
    const summary = document.createElement('summary');
    summary.textContent = 'Activity details';
    const historyList = document.createElement('ol');
    historyList.className = 'page-action-activity-list';
    history.append(summary, historyList);
    card.appendChild(history);

    chatArea.appendChild(card);
  }

  const status = card.querySelector('.page-task-progress-status');
  const waiting = card.querySelector('.page-task-progress-waiting');
  const receipt = card.querySelector('.page-task-progress-receipt');
  const outcome = card.querySelector('.page-task-progress-outcome');
  const steps = card.querySelector('.page-task-progress-steps');
  const historyList = card.querySelector('.page-task-progress-history .page-action-activity-list');

  // Current step + target page (sanitized label only).
  if (status) {
    const parts = [];
    const step =
      String(event.title || event.currentStep || event.currentAction || '').replace(/^page_/, '') ||
      'Inspecting page';
    parts.push(`Current: ${step}`);
    if (event.target?.label) {
      parts.push(
        event.target.origin ? `Target: ${event.target.label}` : `On: ${event.target.label}`
      );
    }
    status.textContent = parts.join(' · ');
  }

  // Waiting state maps from existing pending-interaction events.
  if (waiting) {
    waiting.textContent = event.waiting
      ? `⏳ ${WAITING_LABELS[event.waiting] || event.waiting}`
      : '';
    waiting.hidden = !event.waiting;
  }

  // Plain-language delivery for the current action. A verified single action is
  // NOT reported as whole-task completion.
  if (receipt) {
    const disposition = formatPlainLanguageDisposition(event.receipt?.disposition);
    const text = disposition
      ? `Last action (${String(event.receipt.actionName || 'page action').replace(/^page_/, '')}): ${disposition}`
      : event.taskComplete
        ? 'All planner steps resolved.'
        : '';
    receipt.textContent = text;
    receipt.hidden = !text;
  }

  // Deterministic Act outcome: verified work, unresolved work, and the single
  // best next recovery action, selected from ACTUAL runtime state. Rendered in
  // the run-scoped activity card and routed onto existing controls (approval /
  // clarification / manual Resume / Watch run / checkpoint Resume) rather than
  // a parallel recovery UI. Bounded facts arrive in event.outcome; checkpoint
  // presence is folded in when provided.
  if (outcome && event.outcome && typeof event.outcome === 'object') {
    const computed = selectActRecoveryOutcome({
      ...event.outcome,
      hasCheckpoint: Boolean(event.outcome.hasCheckpoint),
    });
    outcome.textContent = '';
    const lines = [];
    if (computed.hasVerifiedWork) {
      lines.push(
        `Verified work: ${computed.verifiedCount} step${computed.verifiedCount === 1 ? '' : 's'} confirmed.`
      );
    } else {
      lines.push('Verified work: none.');
    }
    if (computed.unresolved.length > 0) {
      lines.push(`Unresolved: ${computed.unresolved.join(', ')}.`);
    } else {
      lines.push('Unresolved: none.');
    }
    lines.push(`Next: ${computed.recoveryMessage}`);
    const body = document.createElement('p');
    body.className = 'page-task-progress-outcome-body';
    const arrow = document.createElement('strong');
    arrow.textContent = 'Outcome — ';
    body.appendChild(arrow);
    body.appendChild(document.createTextNode(lines.join(' ')));
    outcome.appendChild(body);

    // Distinct declined marker when the user denied the last requested action:
    // a change of approach (or a fresh inspection) is in flight, not a retry
    // of the rejected control.
    let declined = outcome.querySelector('.page-task-progress-outcome-declined');
    if (!declined) {
      declined = document.createElement('p');
      declined.className = 'page-task-progress-outcome-declined';
      declined.setAttribute('role', 'status');
      outcome.appendChild(declined);
    }
    declined.textContent = event.outcome.declined
      ? 'Declined: the user denied the last requested action. The task is changing approach instead of repeating it.'
      : '';
    declined.hidden = !event.outcome.declined;
    outcome.hidden = false;
  } else if (outcome && outcome.childElementCount === 0) {
    outcome.hidden = true;
  }

  // Planner steps rendered only when a planner exists.
  if (steps && historyList) {
    steps.textContent = '';
    if (event.hasPlanner && Array.isArray(event.steps)) {
      steps.hidden = false;
      for (const step of event.steps.slice(0, 12)) {
        const li = document.createElement('li');
        li.dataset.stepStatus = step.status || 'pending';
        const marker =
          step.status === 'completed'
            ? '✓'
            : step.status === 'blocked'
              ? '✗'
              : step.status === 'current'
                ? '●'
                : '○';
        li.textContent = `${marker} ${String(step.label || '').slice(0, 220)}`;
        steps.appendChild(li);
      }
    } else {
      steps.hidden = true;
    }

    // Append a technical line to the collapsed troubleshooting log.
    if (event.currentAction || event.currentStep) {
      const entry = document.createElement('li');
      entry.dataset.activityKey = `task-progress:${String(event.sequence || 'update')}`;
      const target = event.target?.label ? ` on ${event.target.label}` : '';
      const disposition = formatPlainLanguageDisposition(event.receipt?.disposition);
      entry.textContent = `${String(event.currentAction || event.currentStep || 'progress').replace(
        /^page_/,
        ''
      )}${target}${disposition ? ` - ${disposition}` : ''}`;
      historyList.appendChild(entry);
      while (historyList.children.length > 12) {
        historyList.removeChild(historyList.firstElementChild);
      }
    }
  }

  // Preserve reader scroll position unless already near the bottom.
  const remaining = chatArea.scrollHeight - chatArea.scrollTop - (chatArea.clientHeight || 0);
  if (!Number.isFinite(remaining) || remaining <= 40) chatArea.scrollTop = chatArea.scrollHeight;
  return card;
}

/**
 * Append one raw page-action line to the collapsed troubleshooting log inside
 * the run-scoped progress card. Used when page_action_state events arrive
 * without a matching page_task_progress event in the same batch.
 * @param {HTMLElement|null} chatArea
 * @param {object} event
 * @returns {void}
 */
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
  const runId = String(event.runId || '').slice(0, 128);
  let card = getActivityCard(chatArea, runId);
  if (!card) {
    card = document.createElement('div');
    card.className = 'message system-message page-action-activity';
    card.dataset.pageActionActivity = 'true';
    card.dataset.pageActionRunId = runId;
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    const heading = document.createElement('strong');
    heading.textContent = 'Page activity';
    card.appendChild(heading);
    const details = document.createElement('details');
    details.className = 'page-action-activity-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Activity details';
    const list = document.createElement('ol');
    list.className = 'page-action-activity-list';
    details.append(summary, list);
    card.appendChild(details);
    chatArea.appendChild(card);
  }

  const list = card.querySelector('.page-action-activity-list');
  if (!list) return card;
  const key = `${runId}:${String(event.sequence || `${event.action || 'action'}-${event.state || 'update'}`)}`;
  let item = Array.from(list.children).find((entry) => entry.dataset.activityKey === key);
  if (!item) {
    item = document.createElement('li');
    item.dataset.activityKey = key;
    list.appendChild(item);
  }
  const action = String(event.action || 'page action').replace(/^page_/, '');
  const target = event.target?.label ? `, ${event.target.label}` : '';
  const state = event.state || (event.type === 'page_action_warning' ? 'warning' : 'updated');
  const disposition = String(event.receipt?.disposition || '').replaceAll('_', ' ');
  const receiptText = disposition ? `, ${disposition}` : '';
  item.textContent = `${action}${target}: ${state}${receiptText}${event.message ? `, ${event.message}` : ''}`;
  while (list.children.length > 12) list.removeChild(list.firstElementChild);
  const remaining = chatArea.scrollHeight - chatArea.scrollTop - (chatArea.clientHeight || 0);
  if (!Number.isFinite(remaining) || remaining <= 40) chatArea.scrollTop = chatArea.scrollHeight;
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
  const showError = (message) => {
    let error = card.querySelector('.page-action-inline-error');
    if (!error) {
      error = document.createElement('p');
      error.className = 'page-action-inline-error';
      error.setAttribute('role', 'alert');
      card.appendChild(error);
    }
    error.textContent = message;
  };
  submit.addEventListener('click', async () => {
    submit.disabled = true;
    input.disabled = true;
    try {
      const response = await onSubmit?.(event.requestId, input.value);
      if (response?.success === false)
        throw new Error(response.error || 'The answer was not sent.');
      card.dataset.decision = 'sent';
    } catch (error) {
      input.disabled = false;
      submit.disabled = false;
      showError(error.message || 'The answer could not be sent. Try again.');
    }
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
  const previousFocus = document.activeElement;
  const card = document.createElement('div');
  card.className = 'message system-message page-action-confirmation';
  card.dataset.pageManualIntervention = event.requestId;
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-live', 'assertive');
  card.setAttribute('aria-modal', 'true');
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
    activeTab.textContent = `Active ${tabId}${activeTitle ? `, ${activeTitle}` : ''}${
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
  const showError = (message) => {
    let error = card.querySelector('.page-action-inline-error');
    if (!error) {
      error = document.createElement('p');
      error.className = 'page-action-inline-error';
      error.setAttribute('role', 'alert');
      card.appendChild(error);
    }
    error.textContent = message;
  };
  const restoreFocus = () => {
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  };
  const settle = (state) => {
    resume.disabled = true;
    stop.disabled = true;
    card.dataset.decision = state;
    restoreFocus();
  };
  card._restorePageActionFocus = restoreFocus;
  resume.addEventListener('click', async () => {
    resume.disabled = true;
    stop.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'pageManualInterventionResume',
        runId,
        requestId: event.requestId,
        ownerToken: event.ownerToken || '',
        sourceTabId,
      });
      if (!response?.success) throw new Error(response?.error || 'Resume was not accepted.');
      settle('resumed');
    } catch (error) {
      resume.disabled = false;
      stop.disabled = false;
      showError(error.message || 'Resume failed. Try again.');
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
  resume.focus();
  const remaining = chatArea.scrollHeight - chatArea.scrollTop - (chatArea.clientHeight || 0);
  if (!Number.isFinite(remaining) || remaining <= 40) chatArea.scrollTop = chatArea.scrollHeight;
  return card;
}

function applyPageActionsToggle(element, enabled) {
  if (!element) return;
  const active = Boolean(enabled) || pageActionsRunActive;
  element.setAttribute('aria-pressed', String(active));
  element.dataset.runActive = String(pageActionsRunActive);
  element.disabled = pageActionsRunActive;
  element.title = pageActionsRunActive
    ? 'Act is running. Page actions stay enabled for this run.'
    : active
      ? 'Page actions are on for this browser session. Click to disable bounded page and tab actions.'
      : 'Page actions are off. Click to enable bounded page and tab actions.';
}

/**
 * Wire the explicit current-page action permission toggle.
 * @param {HTMLElement|null} toggleElement
 * @param {object} loadingManagerRef
 */
export function initPageActionsToggle(toggleElement, loadingManagerRef) {
  if (!toggleElement) return;

  pageActionsToggleElement = toggleElement;
  const initialStateVersion = pageActionsStateVersion;
  isPageActionsEnabled().then((enabled) => {
    if (initialStateVersion !== pageActionsStateVersion) return;
    pageActionsArmed = enabled;
    renderPageActionsToggle();
  });
  toggleElement.addEventListener('click', async () => {
    const next = !pageActionsArmed;
    try {
      await setPageActionsEnabled(next);
      renderPageActionsToggle();
      loadingManagerRef?.showToast?.(
        next
          ? 'Page actions enabled for this browser session. Risky actions still require approval.'
          : 'Page actions disabled for this browser session.',
        'info'
      );
    } catch (error) {
      pageActionsArmed = !next;
      renderPageActionsToggle();
      loadingManagerRef?.showToast?.(error.message || 'Could not update Act permission.', 'error');
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === PAGE_ACTIONS_STORAGE && changes[PAGE_ACTIONS_ENABLED_KEY]) {
      pageActionsStateVersion += 1;
      pageActionsArmed = Boolean(changes[PAGE_ACTIONS_ENABLED_KEY].newValue);
      renderPageActionsToggle();
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

  const previousFocus = document.activeElement;
  const card = document.createElement('div');
  card.className = 'message system-message page-action-confirmation';
  card.dataset.pageActionConfirmation = event.confirmationId;
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-live', 'assertive');
  card.setAttribute('aria-modal', 'true');

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

  if (typeof event.inputPreview === 'string' && event.inputPreview) {
    const inputPreview = document.createElement('p');
    inputPreview.className = 'page-action-confirmation-input-preview';
    inputPreview.textContent = `Text to type: ${event.inputPreview}`;
    card.appendChild(inputPreview);
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

  const showError = (message) => {
    let error = card.querySelector('.page-action-inline-error');
    if (!error) {
      error = document.createElement('p');
      error.className = 'page-action-inline-error';
      error.setAttribute('role', 'alert');
      card.appendChild(error);
    }
    error.textContent = message;
  };
  const disableAll = () => {
    approve.disabled = true;
    approveAll.disabled = true;
    deny.disabled = true;
    stop.disabled = true;
  };
  const enableAll = () => {
    approve.disabled = false;
    approveAll.disabled = false;
    deny.disabled = false;
    stop.disabled = false;
  };

  const decide = async (approved, approveForSession = false) => {
    disableAll();
    try {
      const response = await onDecision?.(event.confirmationId, approved, approveForSession);
      if (response?.success === false)
        throw new Error(response.error || 'Decision was not accepted.');
      card.dataset.decision = approveForSession
        ? 'approved-session'
        : approved
          ? 'approved'
          : 'denied';
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      card.setAttribute(
        'aria-label',
        approveForSession
          ? 'Page action approved for this session'
          : approved
            ? 'Page action approved'
            : 'Page action denied'
      );
    } catch (error) {
      enableAll();
      showError(error.message || 'The decision could not be sent. Try again.');
    }
  };
  approve.addEventListener('click', () => decide(true));
  approveAll.addEventListener('click', () => decide(true, true));
  deny.addEventListener('click', () => decide(false));
  stop.addEventListener('click', () => {
    disableAll();
    card.dataset.decision = 'stopped';
    card.setAttribute('aria-label', 'Page action run stopped');
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    onStop?.();
  });
  controls.append(approve, approveAll, deny, stop);
  card.appendChild(controls);
  chatArea.appendChild(card);
  card._restorePageActionFocus = () => {
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  };
  approve.focus();
  const remaining = chatArea.scrollHeight - chatArea.scrollTop - (chatArea.clientHeight || 0);
  if (!Number.isFinite(remaining) || remaining <= 40) chatArea.scrollTop = chatArea.scrollHeight;
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
  let decision = 'denied';
  let label = 'Page action denied';
  if (event.timedOut) {
    decision = 'no-answer';
    label = 'No answer; page action was not performed';
  } else if (event.approveAll) {
    decision = 'approved-session';
    label = 'Page action approved for this session';
  } else if (event.approved) {
    decision = 'approved';
    label = 'Page action approved';
  }
  card.dataset.decision = decision;
  card.setAttribute('aria-label', label);
  card._restorePageActionFocus?.();
}

/**
 * Resolve all visible approval cards when a run is stopped.
 * @param {HTMLElement|null} chatArea
 */
export function cancelPageActionConfirmations(chatArea) {
  if (!chatArea) return;
  chatArea
    .querySelectorAll('[data-page-action-confirmation], [data-page-manual-intervention]')
    .forEach((card) => {
      card.querySelectorAll('button').forEach((button) => {
        button.disabled = true;
      });
      card.dataset.decision = 'cancelled';
      card.setAttribute('aria-label', 'Page action confirmation cancelled');
      card._restorePageActionFocus?.();
    });
}
