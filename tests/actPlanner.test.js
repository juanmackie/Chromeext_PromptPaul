import { describe, expect, it, vi } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';
import {
  MAX_REPLAN_COUNT,
  MAX_SUB_GOALS,
  MAX_SUB_GOAL_CHARS,
  buildPlannerPromptBlock,
  createPlannerState,
  evaluateProgress,
  generateSubGoals,
  replan,
  shouldActivatePlanner,
} from '../src/orchestrator/ActPlanner.js';

function createSkillManager() {
  return {
    resolveSkill: () => null,
    getEligibleSnapshot: () => [],
    getSkillsList: () => [],
    getSlashCommands: () => [],
  };
}

describe('ActPlanner', () => {
  it('activates only for long or clearly multi-step instructions', () => {
    expect(shouldActivatePlanner('Click the button')).toBe(false);
    expect(shouldActivatePlanner('Click the button, then enter the title')).toBe(true);
    expect(shouldActivatePlanner('Open inbox, label invoices')).toBe(true);
    expect(shouldActivatePlanner('a'.repeat(101))).toBe(true);
  });

  it('decomposes numbered instructions into bounded sub-goals', () => {
    const instruction = Array.from(
      { length: 17 },
      (_, index) => `${index + 1}. Do task ${index + 1}`
    ).join('\n');
    const goals = generateSubGoals(instruction);

    expect(goals).toHaveLength(MAX_SUB_GOALS);
    expect(goals.every((goal) => goal.status === 'pending')).toBe(true);
    expect(goals.every((goal) => goal.description.length <= MAX_SUB_GOAL_CHARS)).toBe(true);
    expect(goals.at(-1)).toMatchObject({ overflow: true, overflowCount: 6 });
  });

  it('splits prose into action clauses for long-horizon instructions', () => {
    const goals = generateSubGoals(
      'Open Gmail, search for invoices, download the matching files, and then organize them.'
    );

    expect(goals.map((goal) => goal.description)).toEqual([
      'Open Gmail',
      'search for invoices',
      'download the matching files',
      'organize them',
    ]);
  });

  it('advances on a verified action followed by a meaningful note', () => {
    const planner = createPlannerState('1. Open the page\n2. Complete the form');
    const result = evaluateProgress(
      planner,
      { disposition: 'delivered_verified', actionName: 'page_open_tab', subGoalIndex: 0 },
      'Page opened successfully'
    );

    expect(result.advance).toBe(true);
    expect(planner.subGoals[0].status).toBe('done');
    expect(planner.subGoals[0].completionEvidence).toMatchObject({
      subGoalIndex: 0,
      disposition: 'delivered_verified',
    });
    expect(planner.currentSubGoalIndex).toBe(1);
    expect(planner.subGoals[1].status).toBe('in_progress');
  });

  it('accepts matching read-only receipts but rejects mismatched evidence', () => {
    const planner = createPlannerState('1. Find the invoice\n2. Review the result');
    expect(
      evaluateProgress(
        planner,
        { actionName: 'page_find_text', disposition: 'delivered_verified', subGoalIndex: 0 },
        'Found the invoice on the page'
      ).advance
    ).toBe(true);
    expect(
      evaluateProgress(
        planner,
        { actionName: 'page_click', disposition: 'delivered_verified', subGoalIndex: 0 },
        'Clicked an unrelated control'
      ).advance
    ).toBe(false);
  });

  it('does not advance a goal from a receipt owned by another goal', () => {
    const planner = createPlannerState('1. Open the page\n2. Complete the form');
    planner.currentSubGoalIndex = 1;
    planner.subGoals[1].status = 'in_progress';

    const result = evaluateProgress(
      planner,
      { actionName: 'page_open_tab', disposition: 'delivered_verified', subGoalIndex: 0 },
      'The page opened successfully'
    );

    expect(result.advance).toBe(false);
    expect(planner.subGoals[1].status).toBe('in_progress');
  });

  it('blocks a repeatedly failing sub-goal and moves on', () => {
    const planner = createPlannerState('1. Open the page\n2. Complete the form');
    evaluateProgress(planner, {
      disposition: 'not_delivered',
      message: 'Bridge failed',
      actionName: 'page_open_tab',
      subGoalIndex: 0,
    });
    const result = evaluateProgress(planner, {
      disposition: 'not_delivered',
      message: 'Bridge failed again',
      actionName: 'page_open_tab',
      subGoalIndex: 0,
    });

    expect(result.blocked).toBe(true);
    expect(planner.subGoals[0].status).toBe('blocked');
    expect(planner.currentSubGoalIndex).toBe(1);
  });

  it('enforces the replan cap while preserving resolved goals', () => {
    const planner = createPlannerState('1. Open the page\n2. Complete the form');
    planner.subGoals[0].status = 'done';

    for (let index = 0; index < MAX_REPLAN_COUNT; index += 1) {
      expect(replan(planner, '1. Revisit the page\n2. Finish the remaining task').replanned).toBe(
        true
      );
    }
    expect(replan(planner, '1. Try again')).toEqual({ replanned: false, blocked: true });
    expect(planner.replanCount).toBe(MAX_REPLAN_COUNT);
    expect(planner.subGoals.some((goal) => goal.status === 'done')).toBe(true);
  });

  it('renders bounded progress and budget state for the model', () => {
    const planner = createPlannerState('1. Open the page\n2. Complete the form');
    const prompt = buildPlannerPromptBlock(
      planner,
      { observation: 2, navigation: 1, mutation: 3 },
      { observation: 256, navigation: 96, mutation: 64 }
    );

    expect(prompt).toContain('CURRENT SUB-GOAL (1/2)');
    expect(prompt).toContain('Budget remaining: obs=254, nav=95, mut=61');
    expect(prompt.length).toBeLessThan(2000);

    planner.subGoals[0].status = 'done';
    planner.subGoals[0].outcome = 'The page was inspected successfully.';
    expect(buildPlannerPromptBlock(planner)).toContain('COMPLETED OUTCOMES');
    expect(buildPlannerPromptBlock(planner)).toContain('The page was inspected successfully.');
    planner.subGoals[1].status = 'blocked';
    planner.subGoals[1].blockReason = 'The required control was unavailable.';
    expect(buildPlannerPromptBlock(planner)).toContain('BLOCKED OUTCOMES');

    planner.completedAt = Date.now();
    expect(buildPlannerPromptBlock(planner)).toContain('ALL SUB-GOALS RESOLVED');

    planner.subGoals[0].description = 'line one\nline two';
    expect(buildPlannerPromptBlock(planner)).toContain('line one line two');
    expect(buildPlannerPromptBlock(planner).length).toBeLessThanOrEqual(4_000);
  });
});

describe('RunOrchestrator ActPlanner integration', () => {
  it('does not activate from appended page context alone', () => {
    const orchestrator = new RunOrchestrator(createSkillManager());
    const run = {
      id: 'run-context',
      pageActions: { enabled: true, planner: null, sessionApproval: false },
      conversationHistory: [
        {
          role: 'user',
          content: 'Summarize this page\n\n--- Page content ---\n' + 'x'.repeat(500),
        },
      ],
    };

    orchestrator._initializeActPlanner(run);

    expect(run.pageActions.planner).toBeNull();
    expect(run.pageActions.sessionApproval).toBe(false);
  });

  it('emits one user-facing notice when planner activation is observed', () => {
    const orchestrator = new RunOrchestrator(createSkillManager());
    const emitEvent = vi.fn();
    orchestrator._emitEvent = emitEvent;
    const run = {
      id: 'run-notice',
      pageActions: { enabled: true, planner: null, sessionApproval: false },
      conversationHistory: [{ role: 'user', content: '1. Open the page\n2. Complete the form' }],
    };

    orchestrator._initializeActPlanner(run, { notify: true });

    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith(
      'run-notice',
      expect.objectContaining({
        type: 'page_action_notice',
        code: 'PAGE_PLANNER_ACTIVATED',
      })
    );
  });

  it('initializes the planner after the first execute message arrives', () => {
    const orchestrator = new RunOrchestrator(createSkillManager());
    orchestrator._emitEvent = () => {};
    const run = {
      id: 'run-1',
      pageActions: { enabled: true, planner: null, sessionApproval: false },
      conversationHistory: [
        {
          role: 'user',
          content: [{ type: 'text', text: '1. Open the page\n2. Complete the form' }],
        },
      ],
    };

    orchestrator._initializeActPlanner(run);

    expect(run.pageActions.planner?.active).toBe(true);
    expect(run.pageActions.planner.subGoals).toHaveLength(2);
    expect(run.pageActions.planner.autoApprovalPending).toBe(true);
    expect(run.pageActions.sessionApproval).toBe(false);

    let resolved;
    run.pageActions.pendingConfirmation = {
      id: 'confirmation-1',
      resolve: (value) => (resolved = value),
    };
    orchestrator.activeRuns.set(run.id, run);
    expect(orchestrator.resolvePageActionDecision(run.id, 'confirmation-1', true)).toBe(true);
    expect(resolved).toBe(true);
    expect(run.pageActions.sessionApproval).toBe(false);
    expect(run.pageActions.planner.autoApproval).toBe(true);
    expect(run.pageActions.planner.autoApprovalPending).toBe(false);
  });

  it('consumes one action receipt so duplicate notes cannot advance twice', async () => {
    const orchestrator = new RunOrchestrator(createSkillManager(), {
      pageActionExecutor: async (tabId, actionName) =>
        actionName === 'page_get_state'
          ? {
              snapshot: {
                snapshotId: 'snapshot-1',
                url: 'https://example.test/form',
                title: 'Form',
                elements: [{ index: 0, tag: 'input', label: 'Search', sensitive: false }],
              },
            }
          : {
              snapshot: {
                snapshotId: 'snapshot-2',
                url: 'https://example.test/form',
                title: 'Form',
              },
            },
    });
    orchestrator._emitEvent = () => {};
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      messages: [{ role: 'user', content: '1. Fill the search field\n2. Review the results' }],
    });

    const run = orchestrator.activeRuns.get(runId);
    run.pageActions.planner.autoApproval = true;
    run.pageActions.planner.autoApprovalPending = false;
    await orchestrator.executeTool(runId, {
      id: 'state-1',
      function: { name: 'page_get_state', arguments: '{}' },
    });
    await orchestrator.executeTool(runId, {
      id: 'input-1',
      function: {
        name: 'page_input',
        arguments: JSON.stringify({ snapshotId: 'snapshot-1', index: 0, text: 'query' }),
      },
    });
    expect(run.pageActions.planner.pendingReceipt).toMatchObject({
      disposition: 'delivered_unverified',
    });

    const note = (id) =>
      orchestrator.executeTool(runId, {
        id,
        function: {
          name: 'page_record_note',
          arguments: JSON.stringify({ text: 'Search filled' }),
        },
      });
    await note('note-1');
    expect(run.pageActions.planner.currentSubGoalIndex).toBe(0);
    expect(run.pageActions.planner.pendingReceipt).toBeNull();
    await note('note-2');
    expect(run.pageActions.planner.currentSubGoalIndex).toBe(0);
  });

  it('retains a verified mutation receipt through required reinspection', async () => {
    const orchestrator = new RunOrchestrator(createSkillManager());
    orchestrator._emitEvent = () => {};
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      messages: [{ role: 'user', content: '1. Fill the search field\n2. Review the results' }],
    });
    const run = orchestrator.getRun(runId);

    orchestrator._recordPlannerActionResult(run, 'page_input', {
      result: {
        actionReceipt: {
          disposition: 'delivered_verified',
          evidence: { kind: 'input_value_match', matched: true },
        },
      },
    });
    orchestrator._recordPlannerActionResult(run, 'page_get_state', {
      result: {
        actionReceipt: {
          disposition: 'delivered_verified',
          evidence: { kind: 'snapshot_captured' },
        },
      },
    });

    expect(run.pageActions.planner.pendingReceipt).toMatchObject({
      actionName: 'page_input',
      disposition: 'delivered_verified',
    });
    await orchestrator.executeTool(runId, {
      id: 'planner-note-after-inspection',
      function: {
        name: 'page_record_note',
        arguments: JSON.stringify({ text: 'The search field now contains the requested query.' }),
      },
    });
    expect(run.pageActions.planner.currentSubGoalIndex).toBe(1);
  });

  it('rejects a stale receipt from another current sub-goal', async () => {
    const orchestrator = new RunOrchestrator(createSkillManager());
    orchestrator._emitEvent = () => {};
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      messages: [{ role: 'user', content: '1. Open the work page\n2. Review it' }],
    });
    const run = orchestrator.getRun(runId);

    orchestrator._recordPlannerActionResult(run, 'page_open_tab', {
      result: {
        actionReceipt: {
          subGoalIndex: 1,
          disposition: 'delivered_verified',
          evidence: { kind: 'owned_tab_ready' },
        },
      },
    });

    expect(run.pageActions.planner.pendingReceipt).toBeUndefined();
  });

  it('records verified receipts for successful owned-tab actions', async () => {
    const pageTabExecutor = vi.fn(async () => ({
      openedTabId: 9,
      targetTabId: 9,
      ready: true,
      reused: true,
    }));
    const orchestrator = new RunOrchestrator(createSkillManager(), { pageTabExecutor });
    orchestrator._emitEvent = () => {};
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      messages: [{ role: 'user', content: '1. Open the work page\n2. Review it' }],
    });

    const result = await orchestrator.executeTool(runId, {
      id: 'planner-open-tab',
      function: {
        name: 'page_open_tab',
        arguments: JSON.stringify({ url: 'https://example.test/work' }),
      },
    });

    expect(result.result.actionReceipt).toMatchObject({
      disposition: 'delivered_verified',
      evidence: { kind: 'owned_tab_reused' },
    });
    expect(orchestrator.getRun(runId).pageActions.planner.pendingReceipt).toMatchObject({
      actionName: 'page_open_tab',
      disposition: 'delivered_verified',
    });
  });

  it('keeps high-risk actions confirmation-gated after planner approval', async () => {
    const orchestrator = new RunOrchestrator(createSkillManager(), {
      pageActionExecutor: async () => ({
        snapshot: { snapshotId: 'snapshot-2', url: 'https://example.test' },
      }),
    });
    orchestrator._emitEvent = () => {};
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      messages: [{ role: 'user', content: '1. Review the page\n2. Delete the item' }],
    });
    const run = orchestrator.activeRuns.get(runId);
    run.pageActions.snapshot = {
      snapshotId: 'snapshot-1',
      url: 'https://example.test',
      elements: [{ index: 0, tag: 'button', label: 'Delete item', sensitive: false }],
    };
    run.pageActions.documentUrl = 'https://example.test';
    run.pageActions.planner.autoApproval = true;
    run.pageActions.planner.autoApprovalPending = false;
    const confirmation = vi
      .spyOn(orchestrator, '_requestPageActionConfirmation')
      .mockResolvedValue(true);

    await orchestrator.executeTool(runId, {
      id: 'delete-1',
      function: {
        name: 'page_click',
        arguments: JSON.stringify({ snapshotId: 'snapshot-1', index: 0 }),
      },
    });

    expect(confirmation).toHaveBeenCalledTimes(1);
    confirmation.mockRestore();
  });

  it('advertises replan while active and removes page tools after completion', async () => {
    const orchestrator = new RunOrchestrator(createSkillManager());
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      messages: [{ role: 'user', content: '1. Review the page\n2. Finish the task' }],
    });
    const run = orchestrator.activeRuns.get(runId);
    run.pageActions.snapshot = { snapshotId: 'snapshot-1', url: 'https://example.test' };

    const toolNames = (await orchestrator._buildTools(run)).map((tool) => tool.function.name);
    expect(toolNames).toContain('page_replan');

    orchestrator._recordPlannerActionResult(run, 'page_list_tabs', {
      success: true,
      result: {
        tabs: [{ tabId: 7 }],
        actionReceipt: {
          disposition: 'delivered_verified',
          evidence: { kind: 'tabs_listed' },
        },
      },
    });
    expect(run.pageActions.planner.pendingReceipt).toMatchObject({
      actionName: 'page_list_tabs',
      disposition: 'delivered_verified',
    });

    run.pageActions.planner.subGoals.forEach((goal) => {
      goal.status = 'blocked';
      goal.blockReason = 'Not needed for this test';
    });
    run.pageActions.planner.completedAt = Date.now();
    expect((await orchestrator._buildTools(run)).map((tool) => tool.function.name)).toEqual([
      'page_get_state',
    ]);
    expect(orchestrator._getEffectiveToolChoice(run)).toBe('page_get_state');
    run.pageActions.finalVerificationCompleted = true;
    expect(await orchestrator._buildTools(run)).toEqual([]);
    expect(orchestrator._getEffectiveToolChoice(run)).toBe('none');
  });

  it('requires a fresh inspection before the planner can finish', async () => {
    const orchestrator = new RunOrchestrator(createSkillManager(), {
      pageActionExecutor: async () => ({
        success: true,
        snapshot: { snapshotId: 'final-state', url: 'https://example.test' },
      }),
    });
    orchestrator._emitEvent = () => {};
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      messages: [{ role: 'user', content: '1. Review the page\n2. Finish the task' }],
    });
    const run = orchestrator.getRun(runId);
    run.pageActions.snapshot = { snapshotId: 'old-state', url: 'https://example.test' };
    run.pageActions.planner.subGoals.forEach((goal) => {
      goal.status = 'blocked';
      goal.blockReason = 'Test completion evidence';
    });
    run.pageActions.planner.completedAt = Date.now();

    expect(orchestrator._getEffectiveToolChoice(run)).toBe('page_get_state');
    const result = await orchestrator.executeTool(runId, {
      id: 'final-verification',
      function: { name: 'page_get_state', arguments: '{}' },
    });

    expect(result.result.actionReceipt.disposition).toBe('delivered_verified');
    expect(run.pageActions.finalVerificationCompleted).toBe(true);
    expect(await orchestrator._buildTools(run)).toEqual([]);
    expect(orchestrator._getEffectiveToolChoice(run)).toBe('none');
  });

  it('continues instead of silently completing unresolved planner goals', async () => {
    const orchestrator = new RunOrchestrator(createSkillManager());
    orchestrator._emitEvent = vi.fn();
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      messages: [{ role: 'user', content: '1. Review the page\n2. Finish the task' }],
    });
    const run = orchestrator.getRun(runId);
    run.accumulatedText = 'I started the task.';
    orchestrator.execute = vi.fn(async () => {});

    await orchestrator._finalizeTextResponse(run);

    expect(orchestrator.execute).toHaveBeenCalledWith(runId, { continueConversation: true }, true);
    expect(orchestrator._emitEvent).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({ type: 'continuation_start' })
    );
    expect(run.conversationHistory.at(-1).content).toContain('unresolved sub-goals');
    expect(run.status).not.toBe('complete');
  });

  it('rejects final verification without receipt-consistent progress', async () => {
    const orchestrator = new RunOrchestrator(createSkillManager(), {
      pageActionExecutor: async () => ({
        success: true,
        snapshot: { snapshotId: 'final-state', url: 'https://example.test' },
      }),
    });
    orchestrator._emitEvent = () => {};
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      messages: [{ role: 'user', content: '1. Review the page\n2. Finish the task' }],
    });
    const run = orchestrator.getRun(runId);
    run.pageActions.planner.subGoals.forEach((goal) => {
      goal.status = 'done';
      goal.completionEvidence = {
        disposition: 'delivered_unverified',
        evidenceKind: 'action_dispatched',
      };
    });
    run.pageActions.planner.completedAt = Date.now();

    const result = await orchestrator.executeTool(runId, {
      id: 'invalid-final-verification',
      function: { name: 'page_get_state', arguments: '{}' },
    });

    expect(run.pageActions.finalVerificationCompleted).toBe(false);
    expect(result.result.finalVerification).toMatchObject({ verified: false });
    expect((await orchestrator._buildTools(run)).map((tool) => tool.function.name)).toEqual([
      'page_get_state',
    ]);
  });

  it('rejects non-string replacement plans at the runtime boundary', async () => {
    const orchestrator = new RunOrchestrator(createSkillManager());
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      messages: [{ role: 'user', content: '1. Review the page\n2. Finish the task' }],
    });

    const result = await orchestrator.executeTool(runId, {
      id: 'invalid-replan-1',
      function: { name: 'page_replan', arguments: JSON.stringify({ instruction: {} }) },
    });

    expect(result.result).toMatchObject({ error: 'PAGE_REPLAN_INVALID' });
  });

  it('replans through the bounded runtime tool', async () => {
    const orchestrator = new RunOrchestrator(createSkillManager());
    orchestrator._emitEvent = () => {};
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      messages: [{ role: 'user', content: '1. Review the page\n2. Finish the task' }],
    });

    const result = await orchestrator.executeTool(runId, {
      id: 'replan-1',
      function: {
        name: 'page_replan',
        arguments: JSON.stringify({
          instruction: '1. Inspect the new page\n2. Finish the new task',
        }),
      },
    });

    expect(result.result.replanned).toBe(true);
    expect(orchestrator.activeRuns.get(runId).pageActions.planner.replanCount).toBe(1);
  });
});
