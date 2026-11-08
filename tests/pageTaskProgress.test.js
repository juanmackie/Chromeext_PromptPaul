import { describe, expect, it, vi } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';
import { capturePageTaskTarget } from '../src/orchestrator/PageTaskProgress.js';
import { ACT_PROGRESS_CAPS } from '../src/act/ActLimits.js';
import { createStubSkillManager } from './helpers/runOrchestrator.js';

describe('Day 3: Act progress card page_task_progress events', () => {
  function makeProgressRun(overrides = {}) {
    return {
      id: 'run-progress-1',
      status: 'running',
      objective: 'Fill out the form and submit it.',
      eventSequence: 0,
      eventJournal: [],
      journalUpdatedAt: 0,
      pageActions: {
        enabled: true,
        currentActivityAction: 'page_click',
        currentTabTitle: 'Checkout',
        currentTabOrigin: 'https://shop.example.com:8443',
        lastActionReceipt: { disposition: 'delivered_verified' },
        planner: null,
        pendingConfirmation: null,
        pendingUserInput: null,
        pendingManualIntervention: null,
        ...overrides,
      },
    };
  }

  function boot(overrides = {}) {
    const run = makeProgressRun(overrides);
    const orch = new RunOrchestrator(createStubSkillManager());
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    orch.activeRuns.set(run.id, run);
    return { orch, run, events };
  }

  it('emits a bounded page_task_progress reflecting current action, target, and waiting', () => {
    const { orch, run, events } = boot({ pendingConfirmation: { id: 'conf-9' } });
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event).toBeTruthy();
    expect(event.status).toBe('running');
    expect(event.hasPlanner).toBe(false);
    expect(event.currentAction).toBe('page_click');
    expect(event.waiting).toBe('approval');
    expect(event.waitingRequestId).toBe('conf-9');
    expect(event.target.label).toBe('Checkout');
    expect(event.target).not.toHaveProperty('url');
    expect(event.receipt.disposition).toBe('delivered_verified');
  });

  it('uses a bounded origin label as target when no tab title is available', () => {
    const { orch, run, events } = boot({ currentTabTitle: '' });
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event.target).toEqual({ label: 'https://shop.example.com:8443', origin: true });
  });

  it('maps planner sub-goal statuses to current/completed/blocked and reports task completion separately', () => {
    const planner = {
      active: true,
      completedAt: Date.now(),
      currentSubGoalIndex: 2,
      subGoals: [
        { description: 'Open the form', status: 'completed' },
        { description: 'Fill required fields', status: 'completed' },
        { description: 'Review summary', status: 'in_progress' },
        { description: 'Submit', status: 'pending' },
        { description: 'Confirm receipt', status: 'skipped' },
      ],
    };
    const { orch, run, events } = boot({ planner, currentActivityAction: null });
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event.hasPlanner).toBe(true);
    expect(event.taskComplete).toBe(true);
    expect(event.currentStep).toBe('Review summary');
    expect(event.steps.map((s) => s.status)).toEqual([
      'completed',
      'completed',
      'current',
      'pending',
      'blocked',
    ]);
    // A resolved planner is still distinct from any single verified receipt.
    expect(event.receipt).toBeNull();
  });

  it('maps waiting states from each pending interaction', () => {
    const { orch: o1, run: r1, events: e1 } = boot({ pendingUserInput: { id: 'input-1' } });
    o1._emitPageTaskProgress(r1);
    expect(e1.find((e) => e.type === 'page_task_progress').waiting).toBe('answer');

    const {
      orch: o2,
      run: r2,
      events: e2,
    } = boot({ pendingManualIntervention: { id: 'manual-1' } });
    o2._emitPageTaskProgress(r2);
    expect(e2.find((e) => e.type === 'page_task_progress').waiting).toBe('manual');
  });

  it('emits a terminal progress event with final status before completion', () => {
    const run = makeProgressRun({ planner: null });
    const orch = new RunOrchestrator(createStubSkillManager());
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    orch.activeRuns.set(run.id, run);
    run.status = 'complete';
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event.status).toBe('complete');
  });
});

describe('Day 3: page_task_progress journal safety', () => {
  function newOrch() {
    return new RunOrchestrator(createStubSkillManager());
  }

  it('persists only bounded safe fields and never raw URL/DOM/screenshots/arguments', () => {
    const safe = newOrch()._journalEvent({
      type: 'page_task_progress',
      status: 'running',
      hasPlanner: true,
      taskComplete: false,
      currentStep: 'Review summary',
      currentAction: 'page_click',
      target: { label: 'Checkout', origin: false },
      waiting: 'approval',
      waitingRequestId: 'conf-9',
      receipt: { disposition: 'delivered_verified', actionName: 'page_click' },
      steps: [
        { index: 0, label: 'Open the form', status: 'completed' },
        { index: 1, label: 'Fill required fields', status: 'current' },
      ],
      // These would violate the journal contract if persisted unconditionally:
      dom: '<input name=password>',
      screenshot: 'data:image/png;base64,c2VjcmV0',
      argument: { value: 'secret' },
      sequence: 6,
      timestamp: 2000,
    });
    expect(safe.type).toBe('page_task_progress');
    expect(safe.status).toBe('running');
    expect(safe.hasPlanner).toBe(true);
    expect(safe.taskComplete).toBe(false);
    expect(safe.currentStep).toBe('Review summary');
    expect(safe.target).toEqual({ label: 'Checkout', origin: false });
    expect(safe.waiting).toBe('approval');
    expect(safe.waitingRequestId).toBe('conf-9');
    expect(safe.receipt).toEqual({ disposition: 'delivered_verified', actionName: 'page_click' });
    expect(safe.steps).toEqual([
      { index: 0, label: 'Open the form', status: 'completed' },
      { index: 1, label: 'Fill required fields', status: 'current' },
    ]);
    expect(safe.dom).toBeUndefined();
    expect(safe.screenshot).toBeUndefined();
    expect(safe.argument).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain('password');
    expect(JSON.stringify(safe)).not.toContain('secret');
  });

  it('caps step count and per-step label length, and falls back unknown statuses to pending', () => {
    const safe = newOrch()._journalEvent({
      type: 'page_task_progress',
      status: 'running',
      hasPlanner: true,
      steps: Array.from({ length: 20 }, (_, i) => ({
        index: i,
        label: 'x'.repeat(500),
        status: i % 3 === 0 ? 'done' : 'weird-status',
      })),
      sequence: 7,
      timestamp: 3000,
    });
    expect(safe.steps.length).toBe(12);
    expect(safe.steps[0].label.length).toBe(180);
    // 'done' is not a persisted status vocabulary value; it maps back to pending.
    expect(safe.steps[0].status).toBe('pending');
    expect(safe.steps[1].status).toBe('pending');
  });
});

describe('page task progress target capture', () => {
  it('stores a bounded title and origin without retaining the page URL', () => {
    const run = { pageActions: {} };
    capturePageTaskTarget(run, {
      title: ` ${'x'.repeat(ACT_PROGRESS_CAPS.maxTargetLabelChars + 20)} `,
      url: 'https://shop.example.com/checkout?token=private#payment',
    });
    expect(run.pageActions.currentTabTitle).toHaveLength(ACT_PROGRESS_CAPS.maxTargetLabelChars);
    expect(run.pageActions.currentTabOrigin).toBe('https://shop.example.com');
    expect(JSON.stringify(run)).not.toContain('private');
    expect(JSON.stringify(run)).not.toContain('/checkout');
  });

  it('clears the origin when a snapshot URL is invalid', () => {
    const run = { pageActions: { currentTabOrigin: 'https://old.example.com' } };
    capturePageTaskTarget(run, { title: '', url: 'not-a-url' });
    expect(run.pageActions.currentTabTitle).toBe('');
    expect(run.pageActions.currentTabOrigin).toBe('');
  });
});

describe('Day 4: page_task_progress deterministic outcome facts', () => {
  function makeProgressRun(overrides = {}) {
    return {
      id: 'run-outcome-1',
      status: 'running',
      objective: 'Fill out the form and submit it.',
      eventSequence: 0,
      eventJournal: [],
      journalUpdatedAt: 0,
      pageActions: {
        enabled: true,
        currentActivityAction: 'page_click',
        currentTabTitle: 'Checkout',
        currentTabOrigin: 'https://shop.example.com',
        lastActionReceipt: { disposition: 'delivered_verified' },
        planner: null,
        pendingConfirmation: null,
        pendingUserInput: null,
        pendingManualIntervention: null,
        ...overrides,
      },
    };
  }

  function boot(overrides = {}) {
    const run = makeProgressRun(overrides);
    const orch = new RunOrchestrator(createStubSkillManager());
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    orch.activeRuns.set(run.id, run);
    return { orch, run, events };
  }

  it('flags unverified when the last receipt was delivered_unverified', () => {
    const { orch, run, events } = boot({
      lastActionReceipt: { disposition: 'delivered_unverified' },
    });
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event.outcome).toBeTruthy();
    expect(event.outcome.unverified).toBe(true);
    expect(event.outcome.notDelivered).toBe(false);
    expect(event.outcome.verified).toBe(false);
    expect(event.outcome.status).toBe('running');
    expect(event.outcome.taskComplete).toBe(false);
  });

  it('flags notDelivered and verified independently of unverified', () => {
    const {
      orch: o1,
      run: r1,
      events: e1,
    } = boot({
      lastActionReceipt: { disposition: 'not_delivered' },
    });
    o1._emitPageTaskProgress(r1);
    const ev1 = e1.find((e) => e.type === 'page_task_progress');
    expect(ev1.outcome.notDelivered).toBe(true);
    expect(ev1.outcome.unverified).toBe(false);

    const {
      orch: o2,
      run: r2,
      events: e2,
    } = boot({
      lastActionReceipt: { disposition: 'delivered_verified' },
    });
    o2._emitPageTaskProgress(r2);
    const ev2 = e2.find((e) => e.type === 'page_task_progress');
    expect(ev2.outcome.verified).toBe(true);
    expect(ev2.outcome.unverified).toBe(false);
  });

  it('derives completed/blocked/remaining steps from planner sub-goal statuses', () => {
    const planner = {
      active: true,
      completedAt: null,
      currentSubGoalIndex: 2,
      subGoals: [
        { description: 'Open the form', status: 'completed' },
        { description: 'Fill required fields', status: 'completed' },
        { description: 'Review summary', status: 'in_progress' },
        { description: 'Submit', status: 'pending' },
        { description: 'Confirm receipt', status: 'skipped' },
      ],
    };
    const { orch, run, events } = boot({ planner, currentActivityAction: null });
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event.outcome.completedSteps).toBe(2);
    expect(event.outcome.blockedSteps).toBe(1);
    expect(event.outcome.remainingSteps).toBe(2);
    expect(event.outcome.taskComplete).toBe(false);
  });

  it('reflects the final terminal status and resolved planner', () => {
    const { orch, run, events } = boot({ planner: null });
    run.status = 'complete';
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event.outcome.status).toBe('complete');
  });

  it('journal-persists only bounded safe outcome booleans and counts, never arguments', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const safe = orch._journalEvent({
      type: 'page_task_progress',
      status: 'complete',
      outcome: {
        status: 'complete',
        waiting: 'approval',
        taskComplete: true,
        unverified: true,
        notDelivered: false,
        verified: false,
        completedSteps: 3,
        blockedSteps: 1,
        remainingSteps: 0,
        // Intentionally hostile values that must be dropped/coerced, never persisted raw.
        argument: { value: 'secret' },
        screenshot: 'data:image/png;base64,secret',
      },
      sequence: 9,
      timestamp: 5000,
    });
    expect(safe.outcome).toBeTruthy();
    expect(safe.outcome.unverified).toBe(true);
    expect(safe.outcome.waiting).toBe('approval');
    expect(safe.outcome.taskComplete).toBe(true);
    expect(safe.outcome.completedSteps).toBe(3);
    expect(safe.outcome.blockedSteps).toBe(1);
    expect(safe.outcome.remainingSteps).toBe(0);
    expect(safe.outcome.argument).toBeUndefined();
    expect(safe.outcome.screenshot).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain('secret');
  });

  it('does not persist an arbitrary unrelated outcome block from another event type', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const safe = orch._journalEvent({
      type: 'tool_execution',
      outcome: { bad: true, data: 'secret' },
    });
    expect(safe.outcome).toBeUndefined();
  });
});

describe('Act planning and consent are independent', () => {
  it('never enables auto-approval or emits an approval-scope notice from long prose', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    orch._emitEvent = vi.fn();
    const run = {
      pageActions: { enabled: true, sessionApproval: false },
      conversationHistory: [
        {
          role: 'user',
          content: 'Open the menu, then review the entries and select the requested entry.',
        },
      ],
    };
    orch._initializeActPlanner(run);
    expect(run.pageActions.planner.subGoals).toEqual([]);
    expect(run.pageActions.planner.autoApproval).toBeUndefined();
    expect(run.pageActions.sessionApproval).toBe(false);
    expect(orch._emitEvent).not.toHaveBeenCalled();
  });
});
