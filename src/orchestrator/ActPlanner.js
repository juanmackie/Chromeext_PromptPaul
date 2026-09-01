/**
 * @fileoverview Session-scoped sub-goal planner for long-horizon Act mode runs.
 * Active state lives in run.pageActions.planner. A separate bounded session
 * checkpoint stores only recovery metadata before a page mutation.
 * @module ActPlanner
 */

import { capPageText } from '../utils/pageDom.js';

/** Maximum number of sub-goals per run. */
export const MAX_SUB_GOALS = 8;

/** Maximum character length for a single sub-goal description. */
export const MAX_SUB_GOAL_CHARS = 200;

/** Maximum replan attempts per run to prevent infinite decomposition loops. */
export const MAX_REPLAN_COUNT = 3;

/** Maximum instruction length accepted by planner decomposition. */
export const MAX_PLANNER_INSTRUCTION_CHARS = 2_000;

/** Maximum prompt-block length sent to the model. */
export const MAX_PLANNER_PROMPT_CHARS = 4_000;

/** Minimum instruction length to trigger automatic planner activation. */
export const PLANNER_INSTRUCTION_MIN_LENGTH = 100;

/**
 * Patterns that suggest a multi-step instruction warranting planner activation.
 * Checked case-insensitively against the user instruction.
 */
const MULTI_STEP_SIGNALS = [
  /\bthen\b/i,
  /\bafter\b/i,
  /\bnext\b/i,
  /\band also\b/i,
  /\bfinally\b/i,
  /\bstep\s*\d/i,
  /\d+\.\s+/,
  /\bfirst\b.*\bsecond\b/i,
  /\bcompare\b/i,
  /\bresearch\b.*\bthen\b/i,
  /\bfind\b.*\band\b/i,
];

const ACTION_VERB_PATTERN =
  /(?:open|go|visit|search|find|read|review|compare|check|download|create|move|save|send|fill|select|enter|click|submit|add|remove|update|copy|collect|record|label|archive)\b/i;

/**
 * Split prose into bounded action-oriented clauses for the initial plan.
 * @param {string} instruction
 * @returns {string[]}
 */
function splitInstructionIntoClauses(instruction) {
  const units = instruction.split(/[.!?;]+|\r?\n+/);
  const clauses = [];
  for (const unit of units) {
    const chained = unit.split(
      /\s+(?:(?:and\s+)?then|after(?:\s+that)?|next|finally|and\s+also)\s+/i
    );
    for (const chain of chained) {
      const actionClauses = chain.split(
        new RegExp(`,\\s+(?=(?:and\\s+)?${ACTION_VERB_PATTERN.source})`, 'i')
      );
      for (const clause of actionClauses) {
        const normalized = clause.trim().replace(/[,.\s]+$/, '');
        if (normalized.length > 5) clauses.push(normalized);
      }
    }
  }
  return clauses;
}

/**
 * Determine whether an instruction should activate the sub-goal planner.
 * @param {string} instruction
 * @returns {boolean}
 */
export function shouldActivatePlanner(instruction) {
  if (typeof instruction !== 'string') return false;
  const trimmed = instruction.trim();
  if (trimmed.length > PLANNER_INSTRUCTION_MIN_LENGTH) return true;
  return (
    MULTI_STEP_SIGNALS.some((pattern) => pattern.test(trimmed)) ||
    splitInstructionIntoClauses(trimmed).length > 1
  );
}

/**
 * Generate bounded sub-goals from a user instruction.
 * This is a heuristic decomposition; the model refines via replan if needed.
 * @param {string} instruction
 * @returns {Array<{description: string, status: string}>}
 */
export function generateSubGoals(instruction) {
  if (typeof instruction !== 'string' || !instruction.trim()) return [];
  const boundedInstruction = instruction.trim().slice(0, MAX_PLANNER_INSTRUCTION_CHARS);

  // Try numbered list extraction first
  const numberedPattern = /(?:^|\n)\s*(?:\d+[.)-]|[-•])\s*(.+?)(?=\n\s*(?:\d+[.)-]|[-•])|$)/gi;
  const extracted = [];
  let match;
  while ((match = numberedPattern.exec(boundedInstruction)) !== null) {
    const text = capPageText(match[1].trim(), MAX_SUB_GOAL_CHARS);
    if (text.length > 5) extracted.push({ description: text, status: 'pending' });
  }

  // Fall back to action-oriented prose splitting when no structured list exists.
  if (extracted.length === 0) {
    const clauses = splitInstructionIntoClauses(boundedInstruction);
    for (const clause of clauses) {
      extracted.push({
        description: capPageText(clause, MAX_SUB_GOAL_CHARS),
        status: 'pending',
      });
    }
  }

  // If still empty, treat the whole instruction as one sub-goal
  if (extracted.length === 0) {
    extracted.push({
      description: capPageText(boundedInstruction, MAX_SUB_GOAL_CHARS),
      status: 'pending',
    });
  }

  if (extracted.length > MAX_SUB_GOALS) {
    const overflow = extracted.slice(MAX_SUB_GOALS - 1);
    extracted.length = MAX_SUB_GOALS - 1;
    extracted.push({
      description: capPageText(
        `Complete remaining requested items (${overflow.length}): ${overflow
          .map((goal) => goal.description)
          .join('; ')}`,
        MAX_SUB_GOAL_CHARS
      ),
      status: 'pending',
      overflow: true,
      overflowCount: overflow.length,
    });
  }

  return extracted;
}

/**
 * Create initial planner state for a run.
 * @param {string} instruction
 * @returns {object|null} Planner state or null if planner should not activate.
 */
export function createPlannerState(instruction) {
  if (!shouldActivatePlanner(instruction)) return null;
  const subGoals = generateSubGoals(instruction);
  if (subGoals.length === 0) return null;
  return {
    active: true,
    originalInstruction: capPageText(instruction, 2000),
    subGoals,
    currentSubGoalIndex: 0,
    replanCount: 0,
    completedAt: null,
  };
}

/**
 * Get the current active sub-goal description.
 * @param {object|null} planner
 * @returns {string}
 */
export function getCurrentSubGoal(planner) {
  if (!planner?.active || !Array.isArray(planner.subGoals)) return '';
  const goal = planner.subGoals[planner.currentSubGoalIndex];
  return goal?.description || '';
}

/**
 * Advance to the next pending sub-goal after completing the current one.
 * @param {object} planner
 * @param {string} outcomeNote - Brief note about what was accomplished.
 * @returns {{advanced: boolean, allDone: boolean}}
 */
export function advanceSubGoal(planner, outcomeNote, receipt = {}) {
  if (!planner?.active || !Array.isArray(planner.subGoals)) {
    return { advanced: false, allDone: true };
  }

  const currentIndex = planner.currentSubGoalIndex;
  if (currentIndex >= 0 && currentIndex < planner.subGoals.length) {
    planner.subGoals[currentIndex].status = 'done';
    planner.subGoals[currentIndex].outcome = capPageText(outcomeNote || '', MAX_SUB_GOAL_CHARS);
    planner.subGoals[currentIndex].completionEvidence = {
      subGoalIndex: Number.isInteger(receipt.subGoalIndex) ? receipt.subGoalIndex : null,
      disposition: receipt.disposition === 'delivered_verified' ? 'delivered_verified' : '',
      actionName: capPageText(receipt.actionName, 64),
      evidenceKind: capPageText(receipt.evidence?.kind, 64),
      receiptId: Number(receipt.receiptId) || null,
    };
  }

  // Find next pending sub-goal
  let nextIndex = -1;
  for (let i = currentIndex + 1; i < planner.subGoals.length; i++) {
    if (planner.subGoals[i].status === 'pending') {
      nextIndex = i;
      break;
    }
  }

  if (nextIndex === -1) {
    // Check if any remaining are pending (could be gaps from skips)
    nextIndex = planner.subGoals.findIndex((g) => g.status === 'pending');
  }

  if (nextIndex === -1) {
    planner.completedAt = Date.now();
    return { advanced: false, allDone: true };
  }

  planner.currentSubGoalIndex = nextIndex;
  planner.subGoals[nextIndex].status = 'in_progress';
  return { advanced: true, allDone: false };
}

/**
 * Mark the current sub-goal as blocked and optionally skip to the next.
 * @param {object} planner
 * @param {string} reason
 * @returns {{skipped: boolean, allDone: boolean}}
 */
export function blockCurrentSubGoal(planner, reason) {
  if (!planner?.active || !Array.isArray(planner.subGoals)) {
    return { skipped: false, allDone: true };
  }

  const currentIndex = planner.currentSubGoalIndex;
  if (currentIndex >= 0 && currentIndex < planner.subGoals.length) {
    planner.subGoals[currentIndex].status = 'blocked';
    planner.subGoals[currentIndex].blockReason = capPageText(reason || '', MAX_SUB_GOAL_CHARS);
  }

  // Find next pending
  const nextIndex = planner.subGoals.findIndex((g) => g.status === 'pending');
  if (nextIndex === -1) {
    planner.completedAt = Date.now();
    return { skipped: false, allDone: true };
  }

  planner.currentSubGoalIndex = nextIndex;
  planner.subGoals[nextIndex].status = 'in_progress';
  return { skipped: true, allDone: false };
}

/**
 * Replan remaining sub-goals when the current plan is inadequate.
 * Respects the replan cap to prevent infinite loops.
 * @param {object} planner
 * @param {string} newInstruction - Updated instruction reflecting current context.
 * @returns {{replanned: boolean, blocked: boolean}}
 */
export function replan(planner, newInstruction) {
  if (!planner?.active) return { replanned: false, blocked: true };
  if (planner.replanCount >= MAX_REPLAN_COUNT) {
    return { replanned: false, blocked: true };
  }

  planner.replanCount += 1;
  const newSubGoals = generateSubGoals(newInstruction);

  // Preserve already-completed/blocked sub-goals, replace pending ones
  const preserved = planner.subGoals.filter((g) => g.status === 'done' || g.status === 'blocked');
  const replacement = newSubGoals.slice(0, MAX_SUB_GOALS - preserved.length);
  if (newSubGoals.length > replacement.length && replacement.length > 0) {
    const last = replacement[replacement.length - 1];
    const overflow = newSubGoals.slice(replacement.length);
    last.description = capPageText(
      `Complete remaining replanned items (${overflow.length}): ${overflow
        .map((goal) => goal.description)
        .join('; ')}`,
      MAX_SUB_GOAL_CHARS
    );
    last.overflow = true;
    last.overflowCount = overflow.length + Number(last.overflowCount || 0);
  }

  planner.subGoals = [...preserved, ...replacement];
  planner.currentSubGoalIndex = planner.subGoals.findIndex((g) => g.status === 'pending');
  if (planner.currentSubGoalIndex === -1) {
    planner.completedAt = Date.now();
  } else {
    planner.subGoals[planner.currentSubGoalIndex].status = 'in_progress';
  }

  return { replanned: true, blocked: false };
}

/**
 * Evaluate progress after a page action result.
 * Returns guidance for the orchestrator on whether to advance, replan, or continue.
 * @param {object} planner
 * @param {object} actionResult - The page action result envelope.
 * @param {string} [note] - Optional note recorded via page_record_note.
 * @returns {{advance: boolean, replan: boolean, blocked: boolean, allDone: boolean}}
 */
/**
 * Check that every resolved sub-goal has a safe completion explanation.
 * @param {object|null} planner
 * @returns {boolean}
 */
export function hasReceiptConsistentProgress(planner) {
  if (!planner?.active || !Array.isArray(planner.subGoals) || planner.subGoals.length === 0) {
    return false;
  }
  return planner.subGoals.every((goal, index) => {
    if (goal?.status === 'blocked') return Boolean(String(goal.blockReason || '').trim());
    return (
      goal?.status === 'done' &&
      goal.completionEvidence?.subGoalIndex === index &&
      goal.completionEvidence?.disposition === 'delivered_verified' &&
      Boolean(goal.completionEvidence.evidenceKind)
    );
  });
}

export function receiptMatchesCurrentGoal(planner, actionResult, note = '') {
  const currentIndex = planner?.currentSubGoalIndex;
  const goal = planner?.subGoals?.[currentIndex]?.description;
  const actionName = String(actionResult?.actionName || '').toLowerCase();
  if (!goal || !actionName) return false;
  if (!Number.isInteger(actionResult?.subGoalIndex) || actionResult.subGoalIndex !== currentIndex) {
    return false;
  }
  const text = `${goal} ${note}`.toLowerCase();
  const actionTerms = {
    page_get_state: ['inspect', 'review', 'check', 'read', 'verify', 'state'],
    page_find_text: ['find', 'search', 'locate', 'match'],
    page_scroll: ['scroll', 'read', 'view'],
    page_open_link: ['open', 'go', 'visit', 'navigate'],
    page_click: [
      'click',
      'open',
      'select',
      'submit',
      'send',
      'save',
      'create',
      'update',
      'delete',
      'remove',
      'archive',
      'label',
    ],
    page_input: ['type', 'enter', 'fill', 'write'],
    page_select: ['select', 'choose', 'pick'],
    page_list_tabs: ['tab', 'window'],
    page_open_tab: ['open', 'tab', 'page', 'window'],
    page_switch_tab: ['switch', 'tab', 'page', 'window'],
    page_close_tab: ['close', 'tab', 'page', 'window'],
  }[actionName];
  return !actionTerms || actionTerms.some((term) => text.includes(term));
}

export function evaluateProgress(planner, actionResult, note) {
  if (!planner?.active) {
    return { advance: false, replan: false, blocked: false, allDone: true };
  }

  const disposition = actionResult?.disposition || actionResult?.result?.disposition;
  const receipt = actionResult?.result?.actionReceipt || actionResult;
  if (
    !Number.isInteger(receipt?.subGoalIndex) ||
    receipt.subGoalIndex !== planner.currentSubGoalIndex
  ) {
    return { advance: false, replan: false, blocked: false, allDone: false };
  }

  // A verified delivery with a meaningful note suggests sub-goal completion.
  // Read-only receipts are valid evidence too, but only when the action/note
  // plausibly addresses the current goal.
  if (
    disposition === 'delivered_verified' &&
    note &&
    note.length > 10 &&
    receiptMatchesCurrentGoal(planner, actionResult, note)
  ) {
    const result = advanceSubGoal(planner, note, actionResult);
    return { advance: result.advanced, replan: false, blocked: false, allDone: result.allDone };
  }

  // Unverified delivery may still represent progress; don't auto-advance
  // but don't block either: let the model decide via notes.
  if (disposition === 'delivered_unverified') {
    return { advance: false, replan: false, blocked: false, allDone: false };
  }

  // Not delivered or error: check if this is a hard block
  if (disposition === 'not_delivered' || actionResult?.error) {
    // Only block if we've seen repeated failures on this sub-goal
    const currentGoal = planner.subGoals[planner.currentSubGoalIndex];
    if (currentGoal) {
      currentGoal.attemptCount = Number(currentGoal.attemptCount || 0) + 1;
      if (currentGoal.attemptCount >= 2) {
        const blockResult = blockCurrentSubGoal(
          planner,
          actionResult?.message || 'Repeated failure'
        );
        return {
          advance: false,
          replan: false,
          blocked: blockResult.skipped,
          allDone: blockResult.allDone,
        };
      }
    }
  }

  return { advance: false, replan: false, blocked: false, allDone: false };
}

/**
 * Build a compact planner state block for injection into the system prompt.
 * @param {object|null} planner
 * @param {object} budgets - Current budget counts {observation, navigation, mutation}.
 * @param {object} budgetCaps - Budget limits {observation, navigation, mutation}.
 * @returns {string}
 */
export function buildPlannerPromptBlock(planner, budgets = {}, budgetCaps = {}) {
  if (!planner?.active) return '';

  const describeGoal = (goal) => capPageText(goal?.description, MAX_SUB_GOAL_CHARS);
  const lines = ['ACT PLANNER STATE:'];

  // Sub-goal progress
  const total = planner.subGoals.length;
  const done = planner.subGoals.filter((g) => g.status === 'done').length;
  const blocked = planner.subGoals.filter((g) => g.status === 'blocked').length;
  lines.push(
    `Progress: ${done}/${total} complete, ${blocked} blocked, replan ${planner.replanCount}/${MAX_REPLAN_COUNT}`
  );

  // Current sub-goal
  const current = planner.subGoals[planner.currentSubGoalIndex];
  if (current) {
    lines.push(
      `CURRENT SUB-GOAL (${planner.currentSubGoalIndex + 1}/${total}): ${describeGoal(current)}`
    );
    if (current.attemptCount > 0) {
      lines.push(`Attempts on current sub-goal: ${current.attemptCount}`);
    }
  }

  // Keep verified outcomes visible after the model re-inspects the page. This
  // prevents a required fresh snapshot from hiding the work it just verified.
  const completed = planner.subGoals.filter((g) => g.status === 'done' && g.outcome).slice(-4);
  if (completed.length > 0) {
    lines.push(
      'COMPLETED OUTCOMES (untrusted observations): ' +
        completed
          .map((goal) => `${describeGoal(goal)} → ${capPageText(goal.outcome, MAX_SUB_GOAL_CHARS)}`)
          .join(' | ')
    );
  }
  const blockedGoals = planner.subGoals
    .filter((g) => g.status === 'blocked' && g.blockReason)
    .slice(-4);
  if (blockedGoals.length > 0) {
    lines.push(
      'BLOCKED OUTCOMES (untrusted observations): ' +
        blockedGoals
          .map(
            (goal) => `${describeGoal(goal)} → ${capPageText(goal.blockReason, MAX_SUB_GOAL_CHARS)}`
          )
          .join(' | ')
    );
  }

  // Remaining sub-goals preview (max 3)
  const remaining = planner.subGoals
    .slice(planner.currentSubGoalIndex + 1)
    .filter((g) => g.status === 'pending')
    .slice(0, 3);
  if (remaining.length > 0) {
    lines.push('Upcoming: ' + remaining.map(describeGoal).join(' → '));
  }

  // Budget pacing
  const obsRemain = Math.max(0, (budgetCaps.observation || 192) - (budgets.observation || 0));
  const navRemain = Math.max(0, (budgetCaps.navigation || 72) - (budgets.navigation || 0));
  const mutRemain = Math.max(0, (budgetCaps.mutation || 48) - (budgets.mutation || 0));
  lines.push(`Budget remaining: obs=${obsRemain}, nav=${navRemain}, mut=${mutRemain}`);

  // Instructions
  lines.push(
    'Work on ONE sub-goal at a time. After completing it, call page_record_note with the outcome before advancing. ' +
      'If a sub-goal is blocked after 2 attempts, record why and move to the next. ' +
      'If the plan no longer fits the observed page, call page_replan with a concise replacement plan. ' +
      'Do NOT skip sub-goals silently. When all sub-goals are resolved, summarize verified work, ' +
      'blocked work, and any remaining limitation without claiming unverified success.'
  );

  if (planner.completedAt) {
    lines.push(
      'ALL SUB-GOALS RESOLVED. Produce a final summary now, separating verified work from blocked work.'
    );
  }

  return lines.join('\n').slice(0, MAX_PLANNER_PROMPT_CHARS);
}
