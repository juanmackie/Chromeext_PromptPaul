/**
 * @fileoverview Bounded, read-only Act progress projections for live events.
 * @module PageTaskProgress
 */
import { ACT_PROGRESS_CAPS, PAGE_ACTION_RECEIPT_DISPOSITIONS } from '../act/ActLimits.js';

const STEP_LABEL_CAP = ACT_PROGRESS_CAPS.maxStepLabelChars;
const TARGET_LABEL_CAP = ACT_PROGRESS_CAPS.maxTargetLabelChars;
const MAX_STEPS = ACT_PROGRESS_CAPS.maxSteps;

/**
 * Build the bounded progress projection sent to the chat UI.
 * @param {object} run
 * @returns {object}
 */
export function buildPageTaskProgressEvent(run) {
  const pa = run?.pageActions;
  const planner = pa?.planner;
  const steps = [];
  let hasPlanner = false;
  if (planner?.active && Array.isArray(planner.subGoals)) {
    hasPlanner = true;
    const currentIndex = Number.isInteger(planner.currentSubGoalIndex)
      ? planner.currentSubGoalIndex
      : -1;
    planner.subGoals.slice(0, MAX_STEPS).forEach((goal, index) => {
      let status = 'pending';
      if (goal?.status === 'completed') status = 'completed';
      else if (goal?.status === 'skipped') status = 'blocked';
      else if (index === currentIndex || goal?.status === 'in_progress') status = 'current';
      steps.push({
        index,
        label: String(goal?.description || '').slice(0, STEP_LABEL_CAP),
        status,
      });
    });
  }

  let currentStep = null;
  if (planner?.active && Array.isArray(planner.subGoals)) {
    const current = planner.subGoals[planner.currentSubGoalIndex];
    currentStep = current ? String(current.description || '').slice(0, STEP_LABEL_CAP) : null;
  } else if (pa?.currentActivityAction) {
    currentStep = String(pa.currentActivityAction).slice(0, 64);
  }

  let waiting = null;
  let waitingRequestId = null;
  if (pa?.pendingConfirmation) {
    waiting = 'approval';
    waitingRequestId = pa.pendingConfirmation.id || null;
  } else if (pa?.pendingUserInput) {
    waiting = 'answer';
    waitingRequestId = pa.pendingUserInput.id || null;
  } else if (pa?.pendingManualIntervention) {
    waiting = 'manual';
    waitingRequestId = pa.pendingManualIntervention.id || null;
  }

  let target = null;
  const title = String(pa?.currentTabTitle || '').trim();
  const origin = String(pa?.currentTabOrigin || '').trim();
  if (title) target = { label: title.slice(0, TARGET_LABEL_CAP) };
  else if (origin) target = { label: origin.slice(0, TARGET_LABEL_CAP), origin: true };

  let receipt = null;
  const lastReceipt = pa?.lastActionReceipt;
  if (
    pa?.currentActivityAction &&
    lastReceipt &&
    PAGE_ACTION_RECEIPT_DISPOSITIONS.has(lastReceipt.disposition)
  ) {
    receipt = {
      disposition: lastReceipt.disposition,
      actionName: String(pa.currentActivityAction).slice(0, 64),
    };
  }

  const taskComplete = pa?.actOutcome
    ? pa.actOutcome.status === 'done'
    : hasPlanner
      ? Boolean(planner.completedAt)
      : false;
  const disposition = pa?.lastActionReceipt?.disposition
    ? String(pa.lastActionReceipt.disposition).slice(0, 32)
    : receipt?.disposition || null;
  let completedSteps = 0;
  let blockedSteps = 0;
  let remainingSteps = 0;
  for (const step of steps) {
    if (step.status === 'completed') completedSteps += 1;
    else if (step.status === 'blocked' || step.status === 'skipped') blockedSteps += 1;
    else remainingSteps += 1;
  }
  const outcome = {
    status: String(run.status || 'running').slice(0, 24),
    waiting: waiting || null,
    taskComplete,
    unverified: disposition === 'delivered_unverified' || disposition === 'in_flight',
    notDelivered: disposition === 'not_delivered',
    verified: disposition === 'delivered_verified',
    declined: Boolean(pa?.lastDeniedAction),
    completedSteps: Math.min(completedSteps, MAX_STEPS),
    blockedSteps: Math.min(blockedSteps, MAX_STEPS),
    remainingSteps: Math.min(remainingSteps, MAX_STEPS),
  };

  return {
    type: 'page_task_progress',
    status: run.status || 'running',
    hasPlanner,
    steps,
    currentStep,
    currentAction: pa?.currentActivityAction ? String(pa.currentActivityAction).slice(0, 64) : null,
    title: pa?.currentActionTitle ? String(pa.currentActionTitle).slice(0, 80) : null,
    target,
    waiting,
    waitingRequestId,
    receipt,
    taskComplete,
    outcome,
    ...(pa?.actOutcome ? { actOutcome: pa.actOutcome } : {}),
  };
}

/**
 * Store only a bounded title and origin derived from a fresh page snapshot.
 * @param {object} run
 * @param {object} snapshot
 */
export function capturePageTaskTarget(run, snapshot) {
  run.pageActions.currentTabTitle = String(snapshot?.title || '')
    .trim()
    .slice(0, TARGET_LABEL_CAP);
  let origin;
  try {
    origin = new URL(String(snapshot?.url || '')).origin.slice(0, TARGET_LABEL_CAP);
  } catch (_) {
    origin = '';
  }
  run.pageActions.currentTabOrigin = origin;
}
