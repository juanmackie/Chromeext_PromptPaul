/**
 * @fileoverview Bounded, run-scoped memory of page actions and route visits.
 * @module ActWorkingMemory
 */

import { capPageText, pageStateHash, sanitizePageActionUrl } from '../utils/pageDom.js';
import { ACT_WORKING_MEMORY_CAPS } from './ActLimits.js';

export { ACT_WORKING_MEMORY_CAPS } from './ActLimits.js';

const RECEIPTS = new Set(['delivered_verified', 'delivered_unverified', 'not_delivered']);
const MUTATING_ACTIONS = new Set([
  'page_click',
  'page_select',
  'page_input',
  'page_keypress',
  'page_set_value',
]);

/** Create fresh memory for one live Act run. Never serialize this object. */
export function createActWorkingMemory() {
  return { ledger: [], visited: [], nextStep: 1, toggleBlockedTargetKey: '' };
}

/**
 * Hash safe target identity independent of snapshot indices/fingerprints.
 * @param {object} target
 * @returns {string}
 */
export function makeActTargetKey(target = {}) {
  const label = capPageText(target.label || target.name || target.tag, 120);
  const href = target.href ? sanitizePageActionUrl(target.href) : '';
  return pageStateHash(
    JSON.stringify({
      role: capPageText(target.role, 48).toLowerCase(),
      tag: capPageText(target.tag, 32).toLowerCase(),
      label: label.toLowerCase().replace(/\s+/gu, ' ').trim(),
      href,
    })
  );
}

/** Derive a short effect category from safe action result metadata. */
export function deriveActActionEffect(input = {}) {
  if (input.navigated === true) return 'navigated';
  if (input.routeChanged === true || input.actionReceipt?.evidence?.kind === 'route_changed') {
    return 'route_changed';
  }
  const changes = Array.isArray(input.scopeDiff?.changes) ? input.scopeDiff.changes : [];
  if (changes.some((change) => change?.kind === 'added')) return 'opened';
  if (changes.some((change) => change?.kind === 'removed')) return 'closed';
  if (changes.length || input.scopeDiff?.fingerprintChanged === true) return 'changed';
  return 'none';
}

/** Add an opaque visited identity, preserving insertion order and the fixed cap. */
export function markActVisited(memory, kind, identity) {
  if (!memory || typeof memory !== 'object') return false;
  if (!Array.isArray(memory.visited)) memory.visited = [];
  const value = `${kind}:${String(identity || '').slice(0, 32)}`;
  if (value.length <= kind.length + 1 || memory.visited.includes(value)) return false;
  memory.visited.push(value);
  memory.visited = memory.visited.slice(-ACT_WORKING_MEMORY_CAPS.maxVisited);
  return true;
}

/** Whether the loop guard has armed a block for this exact stable target. */
export function shouldBlockActTarget(memory, targetKey) {
  return Boolean(targetKey && memory?.toggleBlockedTargetKey === targetKey);
}

function delivered(entry) {
  return entry.receipt === 'delivered_verified' || entry.receipt === 'delivered_unverified';
}

/**
 * Record a bounded action and detect toggle oscillation after the action was delivered.
 * @returns {{entry: object, toggleDetected: boolean, activationCount: number}}
 */
export function recordActAction(memory, input = {}) {
  if (!memory || typeof memory !== 'object')
    return { entry: null, toggleDetected: false, activationCount: 0 };
  if (!Array.isArray(memory.ledger)) memory.ledger = [];
  if (!Array.isArray(memory.visited)) memory.visited = [];
  const target = input.target && typeof input.target === 'object' ? input.target : {};
  const targetKey = String(
    input.targetKey || (target.tag || target.role || target.label ? makeActTargetKey(target) : '')
  );
  const receipt = RECEIPTS.has(input.receipt?.disposition)
    ? input.receipt.disposition
    : RECEIPTS.has(input.receipt)
      ? input.receipt
      : 'not_delivered';
  const scopeChanges = Array.isArray(input.scopeDiff?.changes) ? input.scopeDiff.changes : [];
  const entry = {
    step:
      Number.isInteger(input.step) && input.step > 0 ? input.step : Number(memory.nextStep) || 1,
    action: capPageText(input.action, 40),
    targetKey,
    label: capPageText(
      target.label || target.name || target.tag,
      ACT_WORKING_MEMORY_CAPS.maxLabelChars
    ),
    role: capPageText(target.role || target.tag, 48),
    index: Number.isInteger(target.index) && target.index >= 0 ? target.index : null,
    receipt,
    effect: deriveActActionEffect(input),
    added: scopeChanges.filter((change) => change?.kind === 'added').length,
    removed: scopeChanges.filter((change) => change?.kind === 'removed').length,
    routeId: capPageText(input.routeId, 12),
    beforeFingerprint: capPageText(input.beforeFingerprint, 16),
    afterFingerprint: capPageText(input.afterFingerprint, 16),
  };
  memory.nextStep = entry.step + 1;
  const previousActivations = memory.ledger
    .slice(-5)
    .filter(
      (item) =>
        item.targetKey === targetKey &&
        item.action === 'page_click' &&
        delivered(item) &&
        item.effect !== 'none'
    );
  const mutatingActivation =
    MUTATING_ACTIONS.has(entry.action) && targetKey && delivered(entry) && entry.effect !== 'none';
  const activationCount = mutatingActivation
    ? previousActivations.length + 1
    : previousActivations.length;
  const returnedToPriorState =
    mutatingActivation &&
    entry.action === 'page_click' &&
    entry.beforeFingerprint &&
    entry.afterFingerprint &&
    previousActivations.length > 0 &&
    previousActivations.at(-1).beforeFingerprint === entry.afterFingerprint &&
    previousActivations.at(-1).afterFingerprint !== entry.afterFingerprint;
  const repeatedToggle =
    mutatingActivation &&
    entry.action === 'page_click' &&
    [...previousActivations, entry]
      .slice(-6)
      .filter(
        (item) =>
          item.targetKey === targetKey &&
          MUTATING_ACTIONS.has(item.action) &&
          delivered(item) &&
          item.effect !== 'none'
      ).length >= 3;
  const toggleDetected = Boolean(returnedToPriorState || repeatedToggle);

  memory.ledger.push(entry);
  memory.ledger = memory.ledger.slice(-ACT_WORKING_MEMORY_CAPS.maxEntries);
  if (targetKey && delivered(entry)) {
    if (
      MUTATING_ACTIONS.has(entry.action) &&
      memory.toggleBlockedTargetKey &&
      memory.toggleBlockedTargetKey !== targetKey
    ) {
      memory.toggleBlockedTargetKey = '';
    }
    markActVisited(memory, 'target', targetKey);
  }
  if (
    entry.routeId &&
    delivered(entry) &&
    (entry.effect === 'route_changed' || entry.effect === 'navigated')
  ) {
    markActVisited(memory, 'route', entry.routeId);
  }
  if (toggleDetected) memory.toggleBlockedTargetKey = targetKey;
  return { entry, toggleDetected, activationCount };
}

/** Render only bounded ledger metadata into the system prompt. */
export function buildActWorkingMemoryPrompt(memory) {
  const ledger = Array.isArray(memory?.ledger)
    ? memory.ledger.slice(-ACT_WORKING_MEMORY_CAPS.maxEntries)
    : [];
  if (!ledger.length) return '';
  const lines = ledger.map((entry) => {
    const label = capPageText(entry.label || entry.action, ACT_WORKING_MEMORY_CAPS.maxLabelChars);
    const targetCount = ledger.filter(
      (candidate) =>
        candidate.targetKey &&
        candidate.targetKey === entry.targetKey &&
        MUTATING_ACTIONS.has(candidate.action)
    ).length;
    const effect =
      entry.effect === 'opened'
        ? `opened ${entry.added} controls`
        : entry.effect === 'closed'
          ? `closed ${entry.removed} controls`
          : entry.effect.replace('_', ' ');
    const actionName = String(entry.action || '')
      .replace(/^page_/u, '')
      .replace(/_/gu, ' ');
    const suffix =
      targetCount % 100 >= 11 && targetCount % 100 <= 13
        ? 'th'
        : { 1: 'st', 2: 'nd', 3: 'rd' }[targetCount % 10] || 'th';
    return `${entry.step}. ${actionName} "${label}"${entry.role ? ` (${entry.role})` : ''} → ${effect}${targetCount > 1 ? ` · ${targetCount}${suffix} activation of this control` : ''}`;
  });
  return `RECENT PAGE ACTIONS (automatic, untrusted, this run only):\n${lines.join('\n')}`.slice(
    0,
    ACT_WORKING_MEMORY_CAPS.maxPromptChars
  );
}

/** Count an item only once in an active bounded quota. */
export function addActQuotaItem(planner, item, status = 'done') {
  const quota = planner?.quota;
  if (!quota || !Array.isArray(quota.done) || !['done', 'skipped'].includes(status)) {
    return { added: false, count: Number(quota?.done?.length) || 0 };
  }
  const label = capPageText(item, ACT_WORKING_MEMORY_CAPS.maxLabelChars);
  const key = pageStateHash(label.toLowerCase().replace(/\s+/gu, ' ').trim());
  if (!label || !key || quota.done.some((entry) => entry.key === key)) {
    return { added: false, count: quota.done.length };
  }
  const target = Math.max(0, Math.min(12, Number(quota.target) || 0));
  if (quota.done.length >= target) return { added: false, count: quota.done.length };
  quota.done.push({ key, label, status });
  if (
    quota.done.length >= target &&
    planner.subGoals?.every((goal) => goal.status === 'done' || goal.status === 'blocked')
  ) {
    planner.completedAt = Date.now();
  }
  return { added: true, count: quota.done.length };
}

/** Testable quota completion predicate shared by planner and orchestrator. */
export function isActQuotaComplete(planner) {
  return (
    !planner?.quota ||
    (Array.isArray(planner.quota.done) && planner.quota.done.length >= planner.quota.target)
  );
}

/** Whether an opaque route digest has already been visited. */
export function hasActVisited(memory, kind, identity) {
  return (
    Array.isArray(memory?.visited) &&
    memory.visited.includes(`${kind}:${String(identity || '').slice(0, 32)}`)
  );
}

/** Nudge emitted when read-only observations stop adding information. */
export const ACT_IDENTICAL_OBSERVATION_NOTICE =
  'You observed the identical page state three times in a row. Do not observe again: act on an observed control, adjust a prior action, or finish with a summary of verified work.';

/**
 * Track consecutive read-only observations that all saw the identical page
 * fingerprint. Run-local only; never checkpointed or journaled.
 * @param {object} state Run-scoped page-action state (mutated in place).
 * @param {string} fingerprint Current snapshot fingerprint.
 * @returns {number} The updated streak.
 */
export function recordIdenticalObservation(state, fingerprint) {
  if (!state || typeof state !== 'object') return 0;
  const observed = String(fingerprint || '');
  state.identicalObservationStreak =
    observed && observed === state.lastObservedFingerprint
      ? (Number(state.identicalObservationStreak) || 0) + 1
      : 1;
  state.lastObservedFingerprint = observed;
  return state.identicalObservationStreak;
}
