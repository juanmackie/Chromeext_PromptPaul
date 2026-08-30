import { afterEach, describe, expect, it, vi } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';
import {
  clearPageActionCheckpoint,
  getPageActionCheckpoint,
  listPageActionCheckpoints,
  resetPageActionCheckpointsForTests,
  savePageActionCheckpoint,
} from '../src/utils/pageActionCheckpoint.js';

afterEach(() => {
  resetPageActionCheckpointsForTests();
});

function createSkillManager() {
  return {
    resolveSkill: () => null,
    getEligibleSnapshot: () => [],
    getSkillsList: () => [],
    getSlashCommands: () => [],
  };
}

describe('pageActionCheckpoint', () => {
  it('stores bounded execution metadata without note text or secrets', async () => {
    await savePageActionCheckpoint({
      runId: 'run-1',
      sourceTabId: 7,
      targetTabId: 8,
      profileId: 'default',
      provider: 'api',
      instruction: 'Complete the public form',
      actionName: 'page_click',
      toolCallId: 'tool-1',
      actionHash: 'hash-1',
      snapshotId: 'snapshot-1',
      status: 'in_flight',
      budgets: { observation: 2, navigation: 1, mutation: 3 },
      planner: {
        active: true,
        currentSubGoalIndex: 0,
        replanCount: 1,
        notesCount: 2,
        subGoals: [
          {
            description: 'Complete the public form',
            status: 'blocked',
            blockReason: 'The safe control was not available.',
            outcome: 'The password was entered',
            attemptCount: 1,
          },
        ],
      },
    });

    const checkpoint = await getPageActionCheckpoint('run-1');
    expect(checkpoint).toMatchObject({
      runId: 'run-1',
      sourceTabId: 7,
      targetTabId: 8,
      actionName: 'page_click',
      status: 'in_flight',
    });
    expect(checkpoint.planner.subGoals[0]).not.toHaveProperty('outcome');
    expect(checkpoint.planner.subGoals[0]).toMatchObject({
      status: 'blocked',
      blockReason: 'The safe control was not available.',
    });
    expect(JSON.stringify(checkpoint)).not.toMatch(/password was entered/i);
  });

  it('keeps an uncertain mutation checkpoint and restores it only through explicit resume', async () => {
    const orchestrator = new RunOrchestrator(createSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') {
          return {
            success: true,
            snapshot: {
              snapshotId: 'snapshot-1',
              url: 'https://example.test/form',
              title: 'Form',
              elements: [{ index: 0, tag: 'input', label: 'Search' }],
            },
          };
        }
        const error = new Error('bridge timed out after delivery');
        error.code = 'PAGE_ACTION_TIMEOUT';
        throw error;
      },
    });
    orchestrator._emitEvent = vi.fn();
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      profileId: 'default',
      provider: 'api',
      messages: [{ role: 'user', content: '1. Fill the search field\n2. Review results' }],
    });
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

    const checkpoint = await getPageActionCheckpoint(runId);
    expect(checkpoint).toMatchObject({
      runId,
      actionName: 'page_input',
      status: 'in_flight',
    });

    checkpoint.planner.subGoals[0].status = 'blocked';
    checkpoint.planner.subGoals[0].blockReason = 'The first page was unavailable.';
    const resumedId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      profileId: 'default',
      provider: 'api',
      messages: [{ role: 'user', content: checkpoint.instruction }],
      actCheckpoint: checkpoint,
    });
    const resumed = orchestrator.getRun(resumedId);
    expect(resumed.pageActions.snapshot).toBeNull();
    expect(resumed.pageActions.recoveryCheckpoint).toMatchObject({
      actionName: 'page_input',
      evidence: 'unknown_delivery_after_worker_restart',
    });
    expect(resumed.pageActions.planner.subGoals[0]).toMatchObject({
      status: 'blocked',
      blockReason: 'The first page was unavailable.',
    });
    expect(orchestrator._buildSystemPrompt(resumed, [])).toContain('explicitly resumed');
    expect(orchestrator.getRunJournal(resumedId).pageActions.recovery).toMatchObject({
      actionName: 'page_input',
      evidence: 'unknown_delivery_after_worker_restart',
    });
    expect((await orchestrator._buildTools(resumed)).map((tool) => tool.function.name)).toEqual([
      'page_get_state',
    ]);
  });

  it('retains an unverified delivery checkpoint until a later inspection', async () => {
    const orchestrator = new RunOrchestrator(createSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => ({
        success: true,
        snapshot: {
          snapshotId: actionName === 'page_get_state' ? 'snapshot-1' : 'snapshot-2',
          url: 'https://example.test/form',
          elements: [{ index: 0, tag: 'button', label: 'Save draft' }],
        },
      }),
    });
    orchestrator._emitEvent = () => {};
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      profileId: 'default',
      provider: 'api',
    });
    await orchestrator.executeTool(runId, {
      id: 'state-2',
      function: { name: 'page_get_state', arguments: '{}' },
    });
    const result = await orchestrator.executeTool(runId, {
      id: 'click-uncertain',
      function: {
        name: 'page_click',
        arguments: JSON.stringify({ snapshotId: 'snapshot-1', index: 0 }),
      },
    });

    expect(result.result.actionReceipt.disposition).toBe('delivered_unverified');
    expect(await getPageActionCheckpoint(runId)).toMatchObject({
      runId,
      status: 'uncertain_delivery',
      actionName: 'page_click',
    });
    await orchestrator.executeTool(runId, {
      id: 'state-after-uncertain',
      function: { name: 'page_get_state', arguments: '{}' },
    });
    expect(await getPageActionCheckpoint(runId)).toBeNull();
  });

  it('bounds records and clears a completed run checkpoint', async () => {
    for (let index = 0; index < 12; index += 1) {
      await savePageActionCheckpoint({
        runId: `run-${index}`,
        actionName: 'page_input',
        status: 'in_flight',
        actionHash: `hash-${index}`,
      });
    }
    const records = await listPageActionCheckpoints();
    expect(records).toHaveLength(8);
    expect(records[0].runId).toBe('run-4');

    await clearPageActionCheckpoint('run-11');
    expect(await getPageActionCheckpoint('run-11')).toBeNull();
  });
});
