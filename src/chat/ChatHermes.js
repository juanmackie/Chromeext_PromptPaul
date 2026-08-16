/**
 * @fileoverview Hermes approval card rendering for the side panel.
 * @module ChatHermes
 */

const DECISION_LABELS = {
  once: 'Allowed once',
  session: 'Allowed for this session',
  always: 'Always allowed',
  deny: 'Denied',
  stopped: 'Stopped',
  complete: 'Closed when the run completed',
  error: 'Closed because the run failed',
  aborted: 'Closed because the run stopped',
};

function findHermesApproval(chatArea, approvalId) {
  if (!chatArea || !approvalId) return null;
  return Array.from(chatArea.querySelectorAll('[data-hermes-approval]')).find(
    (entry) => entry.dataset.hermesApproval === approvalId
  );
}

function settleCard(card, state) {
  if (!card) return null;
  card.dataset.decision = state;
  card.dataset.state = 'settled';
  card.setAttribute('aria-label', `Hermes approval: ${DECISION_LABELS[state] || state}`);
  card.querySelectorAll('button').forEach((button) => {
    button.disabled = true;
  });
  let status = card.querySelector('[data-hermes-approval-status]');
  if (!status) {
    status = document.createElement('span');
    status.dataset.hermesApprovalStatus = 'true';
    status.className = 'text-muted';
    card.appendChild(status);
  }
  status.textContent = DECISION_LABELS[state] || 'Hermes approval settled.';
  return card;
}

/**
 * Settle one Hermes approval card after the gateway accepts a decision.
 * @param {HTMLElement|null} chatArea - Chat message container.
 * @param {object} event - Approval update containing approvalId and choice.
 * @returns {HTMLElement|null}
 */
export function settleHermesApproval(chatArea, event) {
  return settleCard(findHermesApproval(chatArea, event?.approvalId), event?.choice || 'deny');
}

/**
 * Settle all outstanding Hermes approval cards when a run ends.
 * @param {HTMLElement|null} chatArea - Chat message container.
 * @param {string} state - Terminal state.
 * @returns {number} Number of cards settled.
 */
export function settleHermesApprovals(chatArea, state) {
  if (!chatArea || typeof chatArea.querySelectorAll !== 'function') return 0;
  let count = 0;
  chatArea.querySelectorAll('[data-hermes-approval]').forEach((card) => {
    if (card.dataset.state !== 'settled') {
      settleCard(card, state);
      count += 1;
    }
  });
  return count;
}

/**
 * Render a bounded Hermes server approval card.
 * @param {HTMLElement|null} chatArea - Chat message container.
 * @param {object} event - Sanitized Hermes approval event.
 * @param {Function} onDecision - Receives the selected Hermes choice.
 * @param {Function} onStop - Stops the active run.
 * @returns {HTMLElement|null}
 */
export function renderHermesApproval(chatArea, event, onDecision, onStop) {
  if (!chatArea || !event?.approvalId) return null;
  const existing = findHermesApproval(chatArea, event.approvalId);
  if (existing) return existing;

  const card = document.createElement('div');
  card.className = 'message system-message page-action-confirmation';
  card.dataset.hermesApproval = event.approvalId;
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-live', 'assertive');

  const title = document.createElement('strong');
  title.textContent = 'Hermes approval needed';
  card.appendChild(title);

  const summary = document.createElement('p');
  summary.textContent = String(event.summary || 'Hermes wants to run an approved operation.').slice(
    0,
    800
  );
  card.appendChild(summary);

  const controls = document.createElement('div');
  controls.className = 'page-action-confirmation-controls';
  const choices = [
    ['once', 'Allow once', 'btn btn-primary btn-sm'],
    ['session', 'Allow this session', 'btn btn-outline-primary btn-sm'],
    ['always', 'Always allow', 'btn btn-outline-warning btn-sm'],
    ['deny', 'Deny', 'btn btn-outline-secondary btn-sm'],
  ].filter(
    ([choice]) =>
      !Array.isArray(event.choices) || event.choices.length === 0 || event.choices.includes(choice)
  );
  const buttons = choices.map(([choice, label, className]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', () => {
      buttons.forEach((entry) => {
        entry.disabled = true;
      });
      card.dataset.decision = choice;
      onDecision?.(choice);
    });
    controls.appendChild(button);
    return button;
  });
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'btn btn-outline-danger btn-sm';
  stop.textContent = 'Stop';
  stop.addEventListener('click', () => {
    buttons.forEach((entry) => {
      entry.disabled = true;
    });
    stop.disabled = true;
    card.dataset.decision = 'stopped';
    onStop?.();
  });
  controls.appendChild(stop);
  card.appendChild(controls);
  chatArea.appendChild(card);
  chatArea.scrollTop = chatArea.scrollHeight;
  return card;
}
