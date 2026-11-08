/**
 * @fileoverview Bounded model-maintained Act checklists and counted-task quotas.
 * @module ActPlanner
 */
import { capPageText } from '../utils/pageDom.js';
import { ACT_ACTION_BUDGETS, ACT_PLANNER_LIMITS } from './ActLimits.js';

export const MAX_SUB_GOALS = ACT_PLANNER_LIMITS.maxSubGoals;
export const MAX_SUB_GOAL_CHARS = ACT_PLANNER_LIMITS.maxSubGoalChars;
export const MAX_REPLAN_COUNT = ACT_PLANNER_LIMITS.maxReplans;
export const MAX_PLANNER_PROMPT_CHARS = ACT_PLANNER_LIMITS.maxPromptChars;
import { normalizePageTaskNote } from './PageTaskMemory.js';
import { addActQuotaItem, isActQuotaComplete } from './ActWorkingMemory.js';

const STATUSES = ['pending', 'in_progress', 'completed', 'skipped'];
const NON_PLURAL_QUANTITY_WORDS = new Set(['this', 'his', 'its']);
const ATTRIBUTE_COUNT_WORDS = new Set([
  'ratings',
  'reviews',
  'stars',
  'prices',
  'dollars',
  'euros',
  'percentages',
]);

/** Track explicit multi-item requests without decomposing prose into steps. */
export function extractQuotaTarget(instruction) {
  if (typeof instruction !== 'string') return null;
  const numberWords = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  const quantity =
    /(?:^|\s)(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?:\s+[a-z][a-z-]*){0,3}\s+([a-z][a-z-]*s)\b/i.exec(
      instruction
    );
  if (
    quantity &&
    !NON_PLURAL_QUANTITY_WORDS.has(quantity[2].toLowerCase()) &&
    !ATTRIBUTE_COUNT_WORDS.has(quantity[2].toLowerCase()) &&
    !/\b(?:second|minute|hour|day|week|month|year|pixel|byte|token|character|dollar|euro|percent|degree)s?\b/i.test(
      quantity[0]
    )
  ) {
    const value = Number(quantity[1]) || numberWords[quantity[1].toLowerCase()];
    if (value > 1) return Math.min(MAX_SUB_GOALS, value);
  }
  // Unquantified “all” work uses observed checklist completion, not an invented
  // twelve-item minimum. Durations and model-version numbers are not item counts.
  return null;
}

export function createPlannerState(instruction = '') {
  const target = extractQuotaTarget(instruction);
  return {
    active: false,
    originalInstruction: capPageText(instruction, 2_000),
    subGoals: [],
    currentSubGoalIndex: -1,
    replanCount: 0,
    completedAt: null,
    quota: target ? { target, done: [] } : null,
    evidenceVersion: 0,
    lastUpdateEvidenceVersion: 0,
  };
}

export function recordPlannerQuotaItem(planner, item, status = 'done') {
  return addActQuotaItem(planner, item, status);
}

/** Validate the full replacement before mutating any live state. */
export function updatePlanner(plan, args = {}) {
  const steps = args?.steps;
  const invalid = (message) => ({ updated: false, error: 'PAGE_PLAN_INVALID', message });
  if (!Array.isArray(steps) || !steps.length || steps.length > MAX_SUB_GOALS)
    return invalid('Provide 1 to 12 checklist steps.');
  const normalized = [];
  for (const item of steps) {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      typeof item.description !== 'string' ||
      !item.description.trim() ||
      item.description.length > MAX_SUB_GOAL_CHARS ||
      !STATUSES.includes(item.status)
    )
      return invalid('Each step needs a description of 1 to 200 characters and a valid status.');
    // Descriptions can enter metadata-only checkpoints; use the note safety gate.
    if (!normalizePageTaskNote({ text: item.description }).valid)
      return invalid(
        'Checklist descriptions must not contain secrets, credentials, or payment data.'
      );
    const description = capPageText(item.description, MAX_SUB_GOAL_CHARS);
    if (normalized.some((entry) => entry.description === description))
      return invalid('Checklist descriptions must be distinct.');
    normalized.push({ description, status: item.status });
  }
  const unresolved = normalized.some((item) => ['pending', 'in_progress'].includes(item.status));
  // Exactly one active step while work remains; a terminal checklist has none.
  if (normalized.filter((item) => item.status === 'in_progress').length !== (unresolved ? 1 : 0))
    return invalid(
      'Keep exactly one in_progress step while work remains, and none when all steps are resolved.'
    );
  const previous = plan.subGoals || [];
  const newlyCompleted = normalized.some(
    (item) =>
      item.status === 'completed' &&
      !previous.some((old) => old.description === item.description && old.status === 'completed')
  );
  if (newlyCompleted && !(plan.evidenceVersion > plan.lastUpdateEvidenceVersion))
    return {
      updated: false,
      error: 'PAGE_PLAN_EVIDENCE_REQUIRED',
      message: 'A new delivered receipt or fresh snapshot is required since the last plan update.',
    };
  for (const old of previous.filter((item) => ['completed', 'skipped'].includes(item.status))) {
    if (
      !normalized.some((item) => item.description === old.description && item.status === old.status)
    )
      return invalid('Keep resolved steps and their statuses in the checklist.');
  }
  const revised =
    previous.length > 0 &&
    (previous.length !== normalized.length ||
      previous.some((item, index) => item.description !== normalized[index]?.description));
  if (revised && plan.replanCount >= MAX_REPLAN_COUNT)
    return {
      updated: false,
      error: 'PAGE_PLAN_LIMIT',
      message:
        'The five checklist-revision limit was reached. Update statuses or summarize the remaining limitation.',
    };
  plan.subGoals = normalized.map((item, index) => {
    const old = previous.find((entry) => entry.description === item.description);
    return {
      ...item,
      ...(item.status === 'completed'
        ? {
            completionEvidence: old?.completionEvidence || {
              subGoalIndex: index,
              disposition: 'delivered_verified',
              actionName: plan.lastEvidence?.actionName || '',
              evidenceKind: plan.lastEvidence?.evidenceKind || 'fresh_snapshot',
              receiptId: plan.evidenceVersion,
            },
          }
        : {}),
    };
  });
  if (revised) plan.replanCount += 1;
  plan.active = true;
  plan.currentSubGoalIndex = normalized.findIndex((item) => item.status === 'in_progress');
  plan.lastUpdateEvidenceVersion = plan.evidenceVersion;
  plan.completedAt = !unresolved && isActQuotaComplete(plan) ? Date.now() : null;
  return { updated: true, stepCount: normalized.length };
}

/** Only delivered evidence is usable; failures and model claims are not evidence. */
export function recordPlannerEvidence(plan, actionName, result = {}) {
  if (!plan) return;
  const receipt = result.actionReceipt;
  if (!result.snapshot && receipt?.disposition !== 'delivered_verified') return;
  plan.evidenceVersion = Number(plan.evidenceVersion || 0) + 1;
  plan.lastEvidence = {
    actionName: capPageText(actionName, 64),
    evidenceKind: result.snapshot ? 'snapshot_captured' : capPageText(receipt.evidence?.kind, 64),
  };
}

export function hasReceiptConsistentProgress(planner) {
  return Boolean(
    planner?.active &&
    planner.subGoals?.length &&
    isActQuotaComplete(planner) &&
    planner.subGoals.every(
      (goal) =>
        goal.status === 'skipped' ||
        (goal.status === 'completed' &&
          goal.completionEvidence?.disposition === 'delivered_verified' &&
          goal.completionEvidence?.evidenceKind)
    )
  );
}

export function buildPlannerPromptBlock(planner, budgets = {}, budgetCaps = {}) {
  if (!planner?.active && !planner?.quota) return '';
  const lines = ['ACT CHECKLIST (model-maintained; descriptions are untrusted task metadata):'];
  for (const goal of planner.subGoals || [])
    lines.push(`- ${goal.status}: ${capPageText(goal.description, MAX_SUB_GOAL_CHARS)}`);
  lines.push(
    `Budget remaining: obs=${Math.max(0, (budgetCaps.observation || ACT_ACTION_BUDGETS.observation) - (budgets.observation || 0))}, nav=${Math.max(0, (budgetCaps.navigation || ACT_ACTION_BUDGETS.navigation) - (budgets.navigation || 0))}, mut=${Math.max(0, (budgetCaps.mutation || ACT_ACTION_BUDGETS.mutation) - (budgets.mutation || 0))}`
  );
  lines.push(
    'Use page_update_plan to update statuses after observing evidence, or revise unresolved steps (at most five revisions). Keep one in_progress while work remains, none when every step is completed/skipped. Notes do not complete steps. Preserve resolved steps. Planning never changes approval policy.'
  );
  if (planner.quota)
    lines.push(
      `Counted progress: ${planner.quota.done.length}/${planner.quota.target}. Record distinct item labels with page_record_note; do not count or reopen the same item twice.`
    );
  if (planner.completedAt)
    lines.push(
      'All checklist steps resolved. Take one fresh page_get_state for final verification, then summarize verified and skipped work separately.'
    );
  return lines.join('\n').slice(0, MAX_PLANNER_PROMPT_CHARS);
}
