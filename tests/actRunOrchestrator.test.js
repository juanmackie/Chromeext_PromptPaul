import { describe, expect, it, vi } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';

function createStubSkillManager(overrides = {}) {
  return {
    resolveSkill(name) {
      if (overrides.resolveSkill) return overrides.resolveSkill(name);
      return null;
    },
    getEligibleSnapshot() {
      return overrides.eligibleSkills || [];
    },
    getSkillsList() {
      return overrides.eligibleSkills || [];
    },
    getSlashCommands() {
      return [];
    },
    hasSkill(name) {
      const names = (overrides.eligibleSkills || []).map((skill) => skill.name);
      return names.includes(name);
    },
    getSkillNames() {
      return (overrides.eligibleSkills || []).map((skill) => skill.name);
    },
    getSkillContent(name) {
      const skill = (overrides.eligibleSkills || []).find((entry) => entry.name === name);
      if (!skill) return null;
      return {
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions || `Instructions for ${skill.name}`,
        type: 'built-in',
        metadata: {},
      };
    },
  };
}

describe('RunOrchestrator page actions', () => {
  function makeSnapshot() {
    return {
      snapshotId: 'page-snap-1',
      url: 'https://example.test/form',
      title: 'Example form',
      header: 'Current page',
      content: '[0] <input label="Search">\\n[1] <button label="Open details">',
      footer: 'End of page',
      elements: [
        { index: 0, tag: 'input', label: 'Search', type: 'text', sensitive: false },
        { index: 1, tag: 'button', label: 'Open details', text: 'Open details', sensitive: false },
      ],
    };
  }

  function makeCall(id, name, args) {
    return { id, function: { name, arguments: JSON.stringify(args) } };
  }

  it('continues unresolved checklist work before locking tools for final verification', async () => {
    const run = {
      id: 'planner-resume-run',
      config: { tools: [] },
      status: 'running',
      accumulatedText: 'I found the first result.',
      conversationHistory: [],
      resilience: { wrapUp: false, actPlannerContinuations: 0 },
      pageActions: {
        enabled: true,
        snapshot: makeSnapshot(),
        pageMutationOccurred: true,
        finalVerificationCompleted: false,
        pendingConfirmation: null,
        pendingUserInput: null,
        pendingManualIntervention: null,
        planner: {
          active: true,
          completedAt: null,
          subGoals: [
            {
              description: 'Find the result',
              status: 'completed',
              completionEvidence: {
                disposition: 'delivered_verified',
                evidenceKind: 'snapshot_captured',
              },
            },
            { description: 'Open and inspect it', status: 'in_progress' },
          ],
        },
      },
    };
    const orch = new RunOrchestrator(createStubSkillManager());
    const events = [];
    orch.activeRuns.set(run.id, run);
    orch._emitEvent = (_runId, event) => events.push(event);
    orch.execute = vi.fn().mockResolvedValue(undefined);

    await expect(orch._continueUnresolvedActPlanner(run)).resolves.toBe(true);

    expect(events.find((event) => event.type === 'continuation_start').reason).toBe(
      'unresolved_act_planner'
    );
    expect(run.pageActions.finalVerificationRequested).not.toBe(true);
    const tools = await orch._buildTools(run);
    expect(tools.some((tool) => tool.function.name === 'page_click')).toBe(true);
    expect(tools.some((tool) => tool.function.name === 'page_update_plan')).toBe(true);
  });

  it('nudges quota item logging when steps resolve but counted items stay unrecorded', async () => {
    const verifiedEvidence = {
      disposition: 'delivered_verified',
      evidenceKind: 'snapshot_captured',
    };
    const run = {
      id: 'planner-quota-nudge-run',
      config: { tools: [] },
      status: 'running',
      accumulatedText: '',
      conversationHistory: [],
      resilience: { wrapUp: false, actPlannerContinuations: 0 },
      pageActions: {
        enabled: true,
        snapshot: makeSnapshot(),
        pageMutationOccurred: true,
        finalVerificationCompleted: false,
        pendingConfirmation: null,
        pendingUserInput: null,
        pendingManualIntervention: null,
        planner: {
          active: true,
          completedAt: null,
          subGoals: [
            {
              description: 'Open the first thread',
              status: 'completed',
              completionEvidence: verifiedEvidence,
            },
            {
              description: 'Open the second thread',
              status: 'completed',
              completionEvidence: verifiedEvidence,
            },
          ],
          quota: { target: 3, done: [{ key: 'a', label: 'First thread', status: 'done' }] },
        },
      },
    };
    const orch = new RunOrchestrator(createStubSkillManager());
    const events = [];
    orch.activeRuns.set(run.id, run);
    orch._emitEvent = (_runId, event) => events.push(event);
    orch.execute = vi.fn().mockResolvedValue(undefined);

    await expect(orch._continueUnresolvedActPlanner(run)).resolves.toBe(true);

    expect(events.find((event) => event.type === 'continuation_start').reason).toBe(
      'unresolved_act_planner'
    );
    const prompt = run.conversationHistory.at(-1)?.content || '';
    expect(prompt).toMatch(/counts 3 items and only 1 .* recorded done/);
    expect(prompt).toMatch(/page_record_note.*item label and done status/);
  });

  it('passes the merged snapshot element key to the page bridge for stale-target validation', async () => {
    const oldElementKey = 'page-old:0';
    const currentElementKey = 'page-new:0';
    let inspections = 0;
    let delivered = false;
    let mutationBudgetAtDispatch = null;
    const currentSnapshot = {
      ...makeSnapshot(),
      snapshotId: 'page-new',
      elements: [{ index: 1, elementKey: 'page-new:1', tag: 'button', label: 'Safe action' }],
    };
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName, args) => {
        if (actionName === 'page_get_state') {
          inspections += 1;
          return {
            success: true,
            snapshot:
              inspections === 1
                ? {
                    ...makeSnapshot(),
                    elements: [
                      { index: 0, elementKey: oldElementKey, tag: 'button', label: 'Help' },
                    ],
                  }
                : currentSnapshot,
          };
        }
        mutationBudgetAtDispatch = [...orch.activeRuns.values()][0].pageActions.budgets.mutation;
        if (args.elementKey !== currentElementKey) {
          const error = new Error('The indexed target changed after the snapshot. Inspect again.');
          error.code = 'PAGE_STATE_STALE';
          error.preDispatch = true;
          throw error;
        }
        delivered = true;
        return { success: true, message: 'clicked' };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const run = orch.activeRuns.get(runId);
    run.pageActions.sessionApproval = true;
    await orch.executeTool(runId, makeCall('key-state-1', 'page_get_state', {}));
    await orch.executeTool(
      runId,
      makeCall('key-state-2', 'page_get_state', { regionId: 'region-0' })
    );

    const mutationBudgetBefore = run.pageActions.budgets.mutation;
    const outcome = await orch.executeTool(
      runId,
      makeCall('key-stale-click', 'page_click', {
        snapshotId: 'page-new',
        index: 0,
      })
    );

    expect(outcome.result.error).toBe('PAGE_STATE_STALE');
    expect(outcome.result.snapshot).toMatchObject({ snapshotId: 'page-new' });
    expect(outcome.result.actionReceipt).toEqual({
      disposition: 'not_delivered',
      evidence: { kind: 'stale_snapshot' },
    });
    expect(mutationBudgetAtDispatch).toBeGreaterThan(mutationBudgetBefore);
    expect(run.pageActions.budgets.mutation).toBe(mutationBudgetBefore);
    expect(inspections).toBe(3);
    expect(delivered).toBe(false);
  });

  it('advertises page tools only for an explicitly opted-in run', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const disabledId = await orch.startRun({ tool_choice: 'auto', sourceTabId: 7 });
    const disabled = await orch._buildTools(orch.activeRuns.get(disabledId));
    expect(disabled.map((tool) => tool.function.name)).not.toContain('page_get_state');

    const enabledId = await orch.startRun({
      tool_choice: 'auto',
      pageActions: true,
      sourceTabId: 7,
    });
    const enabledRun = orch.activeRuns.get(enabledId);
    const initialTools = await orch._buildTools(enabledRun);
    expect(orch._getEffectiveToolChoice(enabledRun)).toBe('auto');
    expect(initialTools.map((tool) => tool.function.name)).toEqual(['page_get_state']);
    enabledRun.pageActions.snapshot = makeSnapshot();
    const enabled = await orch._buildTools(enabledRun);
    const batchTool = enabled.find((tool) => tool.function.name === 'page_batch');
    expect(batchTool.function.parameters.properties.actions.items.properties).toMatchObject({
      query: { type: 'string', maxLength: 120 },
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
    });
    expect(batchTool.function.parameters.properties.actions.items.properties.args).toBeUndefined();
    expect(orch._getEffectiveToolChoice(enabledRun)).toBe('auto');
    expect(enabled.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining([
        'page_get_state',
        'page_click',
        'page_input',
        'page_select',
        'page_scroll',
        'page_find_text',
        'page_wait',
        'page_batch',
      ])
    );

    const restricted = new RunOrchestrator(createStubSkillManager(), {
      pageActionAvailabilityProvider: async () => false,
    });
    await expect(
      restricted.startRun({
        tool_choice: 'auto',
        pageActions: true,
        sourceTabId: 7,
      })
    ).rejects.toMatchObject({
      code: 'PAGE_ACTION_UNAVAILABLE',
    });
  });

  it('executes page_find_text as bounded read-only observation', async () => {
    const calls = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName, args) => {
        calls.push({ actionName, args });
        return {
          success: true,
          found: true,
          snapshotId: 'content-script-session',
          matches: ['Used - Good Nintendo Switch Lite'],
          elementIndices: [1],
          actionReceipt: {
            disposition: 'delivered_verified',
            evidence: { kind: 'text_search', matched: true },
          },
        };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const run = orch.activeRuns.get(runId);
    run.pageActions.snapshot = makeSnapshot();

    const result = await orch.executeTool(
      runId,
      makeCall('find-text', 'page_find_text', { query: 'Used - Good' })
    );

    expect(result.result).toMatchObject({
      found: true,
      snapshotId: 'page-snap-1',
      actionReceipt: { disposition: 'delivered_verified' },
    });
    expect(calls).toEqual([{ actionName: 'page_find_text', args: { query: 'Used - Good' } }]);
    expect(run.pageActions.budgets).toMatchObject({ observation: 1, navigation: 0, mutation: 0 });
    expect(run.pageActions.repeatedActionCount).toBe(0);
  });

  it('executes wait and batches as read-only observations without approval', async () => {
    const calls = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName, args) => {
        calls.push({ actionName, args });
        if (actionName === 'page_batch') {
          return {
            success: true,
            snapshot: makeSnapshot(),
            results: [{ success: true, found: true, elementIndices: [1] }, { success: true }],
          };
        }
        return {
          success: true,
          satisfied: true,
          actionReceipt: {
            disposition: 'delivered_verified',
            evidence: { kind: 'wait_condition', matched: true },
          },
        };
      },
    });
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const run = orch.activeRuns.get(runId);
    run.pageActions.snapshot = makeSnapshot();

    const wait = await orch.executeTool(
      runId,
      makeCall('wait', 'page_wait', {
        condition: 'text',
        text: 'Results loaded',
        timeoutMs: 100,
      })
    );
    const batch = await orch.executeTool(
      runId,
      makeCall('batch', 'page_batch', {
        actions: [
          { name: 'page_find_text', args: { query: 'Results' } },
          { name: 'page_get_state', args: {} },
        ],
      })
    );

    expect(wait.result).toMatchObject({
      satisfied: true,
      actionReceipt: { disposition: 'delivered_verified' },
    });
    expect(batch.result).toMatchObject({
      snapshot: { snapshotId: 'page-snap-1' },
      actionReceipt: { disposition: 'delivered_verified' },
    });
    expect(calls.map(({ actionName }) => actionName)).toEqual(['page_wait', 'page_batch']);
    expect(run.pageActions.budgets).toMatchObject({ observation: 2, navigation: 0, mutation: 0 });
    expect(events.some((event) => event.type === 'page_action_confirmation')).toBe(false);
  });

  it('keeps the Act inspection tool available before a forced user tool', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const runId = await orch.startRun({
      tool_choice: 'lookup',
      tools: [
        {
          name: 'lookup',
          description: 'Lookup a record',
          parameters: { type: 'object', properties: {} },
          endpointUrl: 'https://tools.example.test/lookup',
        },
      ],
      pageActions: true,
      sourceTabId: 7,
    });
    const run = orch.activeRuns.get(runId);

    expect(orch._getEffectiveToolChoice(run)).toBe('auto');
    expect((await orch._buildTools(run)).map((tool) => tool.function.name)).toEqual([
      'page_get_state',
    ]);

    run.pageActions.snapshot = makeSnapshot();
    expect(orch._getEffectiveToolChoice(run)).toBe('lookup');
    expect((await orch._buildTools(run)).map((tool) => tool.function.name)).toContain('lookup');
    expect((await orch._buildTools(run)).map((tool) => tool.function.name)).toContain('page_click');
  });

  it('requires confirmation before a default-mode mutation and executes once after approval', async () => {
    const calls = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName, args) => {
        calls.push({ actionName, args });
        if (actionName === 'page_get_state') return { success: true, snapshot: makeSnapshot() };
        return { success: true, message: 'updated', snapshot: makeSnapshot() };
      },
    });
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('state-1', 'page_get_state', {}));

    const actionPromise = orch.executeTool(
      runId,
      makeCall('click-1', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    expect(confirmation).toMatchObject({ action: 'page_click', risk: 'medium' });
    // Bounded origin/title context is included for the approval card.
    expect(confirmation.origin).toBe('example.test');
    expect(confirmation.title).toBe('Example form');
    expect(calls).toHaveLength(1);

    expect(orch.resolvePageActionDecision(runId, confirmation.confirmationId, true)).toBe(true);
    const result = await actionPromise;
    expect(result.result.message).toBe('updated');
    expect(calls).toHaveLength(2);
    expect(orch.resolvePageActionDecision(runId, confirmation.confirmationId, true)).toBe(false);
  });

  it('includes a bounded typed-text preview in the live card but not in the journal', async () => {
    const events = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) =>
        actionName === 'page_get_state'
          ? { success: true, snapshot: makeSnapshot() }
          : { success: true, message: 'updated', snapshot: makeSnapshot() },
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('preview-state', 'page_get_state', {}));

    const pending = orch.executeTool(
      runId,
      makeCall('preview-input', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: `Draft ${'x'.repeat(320)}`,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    expect(confirmation.inputPreview).toHaveLength(280);
    expect(confirmation.inputPreview).toMatch(/^Draft /);
    expect(confirmation.args.text).toBeUndefined();
    expect(orch._journalEvent(confirmation).inputPreview).toBeUndefined();
    orch.resolvePageActionDecision(runId, confirmation.confirmationId, false);
    await pending;
  });

  it('returns a verified receipt from an executor postcondition', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) =>
        actionName === 'page_get_state'
          ? { success: true, snapshot: makeSnapshot() }
          : {
              success: true,
              message: 'updated',
              snapshot: makeSnapshot(),
              actionReceipt: {
                disposition: 'delivered_verified',
                evidence: { kind: 'input_value_match', matched: true },
              },
            },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('receipt-state', 'page_get_state', {}));

    const result = await orch.executeTool(
      runId,
      makeCall('receipt-input', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'hello',
      })
    );

    expect(result.result.actionReceipt).toEqual({
      disposition: 'delivered_verified',
      evidence: { kind: 'input_value_match', matched: true, changed: undefined },
    });
    expect(result.result.scopeDiff).toMatchObject({
      requiresFreshSnapshot: expect.any(Boolean),
      changedCount: expect.any(Number),
      regions: expect.any(Array),
    });
  });

  it('pauses for a safe manual step and forces fresh inspection on resume', async () => {
    const calls = [];
    const events = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        calls.push(actionName);
        if (actionName === 'clearPageActionSession') return { success: true };
        return { success: true, snapshot: makeSnapshot() };
      },
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('manual-state', 'page_get_state', {}));

    const pause = orch.executeTool(
      runId,
      makeCall('manual-pause', 'page_pause_for_user', {
        question: 'Complete the CAPTCHA in the visible tab, then resume.',
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = events.find((event) => event.type === 'page_manual_intervention_request');
    expect(request).toMatchObject({
      state: 'paused',
      question: expect.stringContaining('CAPTCHA'),
      activeTab: { tabId: 7, title: 'Example form', origin: 'https://example.test' },
    });

    const blocked = await orch.executeTool(
      runId,
      makeCall('manual-blocked', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    expect(blocked.result.error).toBe('PAGE_MANUAL_INTERVENTION_PENDING');
    expect(orch.resolvePageManualIntervention(runId, request.requestId, true)).toBe(true);
    await expect(pause).resolves.toMatchObject({ result: { resumed: true } });
    expect(orch.activeRuns.get(runId).pageActions.snapshot).toBeNull();
    expect(calls).toContain('clearPageActionSession');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'page_manual_intervention_resumed', state: 'resumed' }),
      ])
    );

    const refreshed = await orch.executeTool(
      runId,
      makeCall('manual-refresh', 'page_get_state', {})
    );
    expect(refreshed.result.snapshot.snapshotId).toBe('page-snap-1');
  });

  it('pauses on an unresponsive mutation, resumes with inspection, and never replays it', async () => {
    const events = [];
    let mutations = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state' || actionName === 'clearPageActionSession')
          return { success: true, snapshot: makeSnapshot() };
        mutations += 1;
        const error = new Error('May be showing a dialog.');
        error.code = 'PAGE_ACTION_UNRESPONSIVE';
        throw error;
      },
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('unresponsive-state', 'page_get_state', {}));
    const pending = orch.executeTool(
      runId,
      makeCall('unresponsive-click', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'page_action_confirmation')).toBe(true)
    );
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    orch.resolvePageActionDecision(runId, confirmation.confirmationId, true);
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'page_manual_intervention_request')).toBe(true)
    );
    const request = events.find((event) => event.type === 'page_manual_intervention_request');
    expect(request.question).toContain('browser dialog');
    expect(orch.resolvePageManualIntervention(runId, request.requestId, true)).toBe(true);
    const result = await pending;
    expect(result.result.actionReceipt).toEqual({
      disposition: 'delivered_unverified',
      evidence: { kind: 'page_unresponsive' },
    });
    expect(result.result.snapshot.snapshotId).toBe('page-snap-1');
    expect(mutations).toBe(1);
  });

  it('does not claim manual intervention resumed or inspect again when pause is refused', async () => {
    let stateReads = 0;
    let mutations = 0;
    const events = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') {
          stateReads += 1;
          return { success: true, snapshot: makeSnapshot() };
        }
        mutations += 1;
        throw Object.assign(new Error('The page stopped responding.'), {
          code: 'PAGE_ACTION_UNRESPONSIVE',
        });
      },
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    vi.spyOn(orch, '_executePageManualIntervention').mockResolvedValue({
      success: true,
      result: {
        error: 'PAGE_MANUAL_INTERVENTION_PENDING',
        message: 'Another user interaction is already active.',
      },
    });
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('unresumed-state', 'page_get_state', {}));
    const pending = orch.executeTool(
      runId,
      makeCall('unresumed-click', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'page_action_confirmation')).toBe(true)
    );
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    orch.resolvePageActionDecision(runId, confirmation.confirmationId, true);
    const result = await pending;
    expect(result.result.error).toBe('PAGE_MANUAL_INTERVENTION_PENDING');
    expect(result.result.message).toContain('did not resume');
    expect(result.result.snapshot).toBeUndefined();
    expect(result.result.actionReceipt).toMatchObject({ disposition: 'delivered_unverified' });
    expect(stateReads).toBe(1);
    expect(mutations).toBe(1);
  });

  it('does not claim a fresh snapshot when inspection fails after manual resume', async () => {
    const events = [];
    let stateReads = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'clearPageActionSession') return { success: true };
        if (actionName === 'page_get_state') {
          stateReads += 1;
          return stateReads === 1
            ? { success: true, snapshot: makeSnapshot() }
            : { success: false, error: 'PAGE_ACTION_TIMEOUT', message: 'Inspection timed out.' };
        }
        throw Object.assign(new Error('The page stopped responding.'), {
          code: 'PAGE_ACTION_UNRESPONSIVE',
        });
      },
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('failed-inspection-state', 'page_get_state', {}));
    const pending = orch.executeTool(
      runId,
      makeCall('failed-inspection-click', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'page_action_confirmation')).toBe(true)
    );
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    orch.resolvePageActionDecision(runId, confirmation.confirmationId, true);
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'page_manual_intervention_request')).toBe(true)
    );
    const request = events.find((event) => event.type === 'page_manual_intervention_request');
    orch.resolvePageManualIntervention(runId, request.requestId, true);
    const result = await pending;
    expect(result.result.snapshot).toBeUndefined();
    expect(result.result.message).toContain('fresh inspection failed');
    expect(result.result.message).not.toContain('Use this fresh snapshot');
    expect(stateReads).toBe(2);
  });

  it('quarantines an unresponsive tab when its manual-intervention pause expires', async () => {
    vi.useFakeTimers();
    const events = [];
    const quarantine = vi.fn(() => ({ tabId: 7, nextTargetTabId: null, available: false }));
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionTabFailureHandler: quarantine,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') return { success: true, snapshot: makeSnapshot() };
        const error = new Error('The page stopped responding.');
        error.code = 'PAGE_ACTION_UNRESPONSIVE';
        throw error;
      },
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('timeout-state', 'page_get_state', {}));
    const pending = orch.executeTool(
      runId,
      makeCall('timeout-click', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'page_action_confirmation')).toBe(true)
    );
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    orch.resolvePageActionDecision(runId, confirmation.confirmationId, true);
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'page_manual_intervention_request')).toBe(true)
    );
    const manual = events.find((event) => event.type === 'page_manual_intervention_request');
    expect(manual).toBeTruthy();
    await vi.advanceTimersByTimeAsync(300_000);
    const result = await pending;
    expect(result.result).toMatchObject({
      error: 'PAGE_ACTION_UNRESPONSIVE',
      actionReceipt: {
        disposition: 'delivered_unverified',
        evidence: { kind: 'page_unresponsive' },
      },
    });
    expect(quarantine).toHaveBeenCalledWith(
      runId,
      7,
      expect.objectContaining({ code: 'PAGE_ACTION_UNRESPONSIVE' })
    );
    expect(orch.activeRuns.get(runId).pageActions.unavailableTabs.has(7)).toBe(true);
    vi.useRealTimers();
  });

  it('navigates a cross-origin HTTP link under the bounded Act lease', async () => {
    const linkSnapshot = () => ({
      ...makeSnapshot(),
      elements: [
        ...makeSnapshot().elements,
        {
          index: 2,
          tag: 'a',
          role: 'link',
          label: 'External docs',
          text: 'External docs',
          href: 'https://external.example/docs?token=secret',
        },
      ],
    });
    let currentUrl = 'https://example.test/form';
    const events = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionDocumentProvider: async () => ({ url: currentUrl }),
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') return { success: true, snapshot: linkSnapshot() };
        currentUrl = 'https://external.example/docs';
        return { success: true, navigated: true, navigationUrl: currentUrl };
      },
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('link-state', 'page_get_state', {}));

    const result = await orch.executeTool(
      runId,
      makeCall('link-click', 'page_click', { snapshotId: 'page-snap-1', index: 2 })
    );
    expect(result.result.navigated).toBe(true);
    expect(orch.activeRuns.get(runId).pageActions.allowedOrigins).toContain(
      'https://external.example'
    );
  });

  it('confirms model-entered unrequested cross-origin tab URLs before opening them', async () => {
    const events = [];
    const tabCalls = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) =>
        actionName === 'page_get_state'
          ? { success: true, snapshot: makeSnapshot() }
          : { success: true },
      pageTabExecutor: async (_runId, actionName, args) => {
        tabCalls.push({ actionName, args });
        return { ready: true, openedTabId: 9, targetTabId: 9, tab: { tabId: 9, url: args.url } };
      },
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({
      pageActions: true,
      sourceTabId: 7,
      tool_choice: 'auto',
      messages: [{ role: 'user', content: 'Review the current page.' }],
    });
    await orch.executeTool(runId, makeCall('external-state', 'page_get_state', {}));

    const pending = orch.executeTool(
      runId,
      makeCall('external-open', 'page_open_tab', {
        url: 'https://attacker.example/private-note',
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    expect(confirmation).toMatchObject({
      action: 'page_open_tab',
      destination: 'https://attacker.example/private-note',
      destinationOrigin: 'attacker.example',
    });
    expect(tabCalls).toHaveLength(0);

    expect(orch.resolvePageActionDecision(runId, confirmation.confirmationId, true)).toBe(true);
    const result = await pending;
    expect(result.result.ready).toBe(true);
    expect(tabCalls).toHaveLength(1);
  });

  it('marks stripped query or fragment data on link confirmations without exposing it', async () => {
    const events = [];
    const destination = 'https://info.arxiv.org/help/submit/index.html?token=private#section';
    const snapshot = {
      ...makeSnapshot(),
      elements: [
        {
          index: 0,
          tag: 'a',
          role: 'link',
          label: 'Submit an Article',
          href: destination,
          linkHasQueryOrFragment: true,
          sensitive: false,
        },
      ],
    };
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) =>
        actionName === 'page_get_state'
          ? { success: true, snapshot }
          : { success: true, linkUrl: destination, snapshot },
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('link-secret-state', 'page_get_state', {}));

    const pending = orch.executeTool(
      runId,
      makeCall('link-secret-open', 'page_click', {
        snapshotId: 'page-snap-1',
        index: 0,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    expect(confirmation).toMatchObject({
      destination: 'https://info.arxiv.org/help/submit/index.html',
      destinationHasQueryOrFragment: true,
    });
    expect(JSON.stringify(confirmation)).not.toContain('private');
    orch.resolvePageActionDecision(runId, confirmation.confirmationId, false);
    const result = await pending;
    expect(result.result.error).toBe('PAGE_ACTION_DENIED');
  });

  it('does not prompt for a cross-origin destination named in the user request', async () => {
    const events = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) =>
        actionName === 'page_get_state'
          ? { success: true, snapshot: makeSnapshot() }
          : { success: true },
      pageTabExecutor: async (_runId, _actionName, args) => ({
        ready: true,
        openedTabId: 9,
        targetTabId: 9,
        tab: { tabId: 9, url: args.url },
      }),
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({
      pageActions: true,
      sourceTabId: 7,
      tool_choice: 'auto',
      messages: [{ role: 'user', content: 'Open reports.example for me.' }],
    });
    await orch.executeTool(runId, makeCall('named-state', 'page_get_state', {}));

    const result = await orch.executeTool(
      runId,
      makeCall('named-open', 'page_open_tab', { url: 'https://reports.example/daily' })
    );
    expect(result.result.ready).toBe(true);
    expect(events.some((event) => event.type === 'page_action_confirmation')).toBe(false);
  });

  it('navigates a blank-target link in the current tab without exposing its query string', async () => {
    const linkSnapshot = () => ({
      ...makeSnapshot(),
      elements: [
        ...makeSnapshot().elements,
        {
          index: 2,
          tag: 'a',
          role: 'link',
          label: 'Open report',
          text: 'Open report',
          href: 'https://reports.example/report',
          target: '_blank',
        },
      ],
    });
    const tabCalls = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) =>
        actionName === 'page_get_state'
          ? { success: true, snapshot: linkSnapshot() }
          : { success: true, linkUrl: 'https://reports.example/report?session=secret' },
      pageTabExecutor: async (_runId, actionName, args) => {
        tabCalls.push({ actionName, args });
        return {
          targetTabId: args.tabId,
          openedTabId: args.tabId,
          tab: { tabId: args.tabId, url: 'https://reports.example/report' },
          ready: true,
          navigated: true,
        };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({
      pageActions: true,
      pageActionsMultiTab: true,
      sourceTabId: 7,
      tool_choice: 'auto',
    });
    await orch.executeTool(runId, makeCall('blank-state', 'page_get_state', {}));

    const actionPromise = orch.executeTool(
      runId,
      makeCall('blank-open', 'page_open_link', {
        snapshotId: 'page-snap-1',
        index: 2,
      })
    );
    const result = await actionPromise;
    expect(result.result.tab.tabId).toBe(7);
    expect(tabCalls).toEqual([
      {
        actionName: 'page_navigate_tab',
        args: { url: 'https://reports.example/report?session=secret', tabId: 7 },
      },
    ]);
    expect(orch.activeRuns.get(runId).pageActions.snapshot).toBeNull();
  });

  it('retains the refreshed source snapshot after opening a link in the background', async () => {
    const linkSnapshot = (snapshotId) => ({
      ...makeSnapshot(),
      snapshotId,
      elements: [
        ...makeSnapshot().elements,
        {
          index: 2,
          tag: 'a',
          role: 'link',
          label: 'Open report',
          text: 'Open report',
          href: 'https://reports.example/report',
          target: '_blank',
        },
      ],
    });
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) =>
        actionName === 'page_get_state'
          ? { success: true, snapshot: linkSnapshot('page-snap-1') }
          : {
              success: true,
              linkUrl: 'https://reports.example/report',
              snapshot: linkSnapshot('page-snap-2'),
              actionReceipt: {
                disposition: 'delivered_verified',
                evidence: { kind: 'link_resolved' },
              },
            },
      pageTabExecutor: async (_runId, actionName, args) => ({
        actionName,
        targetTabId: 7,
        openedTabId: 12,
        tab: { tabId: 12, url: args.url },
      }),
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({
      pageActions: true,
      pageActionsMultiTab: true,
      sourceTabId: 7,
      tool_choice: 'auto',
    });
    await orch.executeTool(runId, makeCall('background-state', 'page_get_state', {}));

    const result = await orch.executeTool(
      runId,
      makeCall('background-open', 'page_open_link', {
        snapshotId: 'page-snap-1',
        index: 2,
        background: true,
      })
    );

    expect(result.result.actionReceipt).toMatchObject({ disposition: 'delivered_verified' });
    expect(orch.activeRuns.get(runId).pageActions.targetTabId).toBe(7);
    expect(orch.activeRuns.get(runId).pageActions.snapshot.snapshotId).toBe('page-snap-2');
  });

  it('approves similar low/medium actions for the run but always confirms high risk', async () => {
    const events = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async () => ({ success: true, snapshot: makeSnapshot() }),
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('state-session', 'page_get_state', {}));

    const firstAction = orch.executeTool(
      runId,
      makeCall('click-session', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const firstConfirmation = events.find((event) => event.type === 'page_action_confirmation');
    expect(
      orch.resolvePageActionDecision(runId, firstConfirmation.confirmationId, true, true)
    ).toBe(true);
    await firstAction;

    await orch.executeTool(runId, makeCall('state-session-after-click', 'page_get_state', {}));
    const run = orch.activeRuns.get(runId);
    expect(run.pageActions.sessionApproval).toBe(true);
    const ordinaryResult = await orch.executeTool(
      runId,
      makeCall('input-session', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'hello',
      })
    );
    expect(ordinaryResult.result.success).toBe(true);
    expect(events.filter((event) => event.type === 'page_action_confirmation')).toHaveLength(1);

    await orch.executeTool(runId, makeCall('state-session-before-high-risk', 'page_get_state', {}));
    run.pageActions.snapshot.elements[1] = {
      ...run.pageActions.snapshot.elements[1],
      label: 'Submit order',
      text: 'Submit order',
    };
    orch._mergePageActionElements(run, run.pageActions.snapshot);
    const confirmation = vi.spyOn(orch, '_requestPageActionConfirmation').mockResolvedValue(true);
    const highRiskResult = await orch.executeTool(
      runId,
      makeCall('click-session-high', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    expect(highRiskResult.result.success).toBe(true);
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect(confirmation.mock.calls[0][4].risk).toBe('high');
  });

  it('keeps session approval for later same-origin navigation-capable actions', async () => {
    const events = [];
    let snapshotVersion = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') {
          snapshotVersion += 1;
          return {
            success: true,
            snapshot: {
              ...makeSnapshot(),
              elements: [
                makeSnapshot().elements[0],
                {
                  ...makeSnapshot().elements[1],
                  label: snapshotVersion === 1 ? 'Open details' : 'Continue',
                  text: snapshotVersion === 1 ? 'Open details' : 'Continue',
                },
              ],
            },
          };
        }
        return { success: true, snapshot: makeSnapshot() };
      },
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('state-session-navigation', 'page_get_state', {}));

    const firstAction = orch.executeTool(
      runId,
      makeCall('click-session-navigation-1', 'page_click', {
        snapshotId: 'page-snap-1',
        index: 1,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const firstConfirmation = events.find((event) => event.type === 'page_action_confirmation');
    expect(firstConfirmation).toBeTruthy();
    expect(
      orch.resolvePageActionDecision(runId, firstConfirmation.confirmationId, true, true)
    ).toBe(true);
    await firstAction;

    await orch.executeTool(runId, makeCall('state-session-navigation-2', 'page_get_state', {}));
    const secondAction = orch.executeTool(
      runId,
      makeCall('click-session-navigation-2', 'page_click', {
        snapshotId: 'page-snap-1',
        index: 1,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirmations = events.filter((event) => event.type === 'page_action_confirmation');
    const secondConfirmation = confirmations[1];
    if (secondConfirmation) {
      orch.resolvePageActionDecision(runId, secondConfirmation.confirmationId, true);
    }
    await expect(secondAction).resolves.toMatchObject({ result: { success: true } });
    expect(confirmations).toHaveLength(1);

    await orch.executeTool(runId, makeCall('state-session-navigation-3', 'page_get_state', {}));
    orch.activeRuns.get(runId).pageActions.snapshot.elements.push({
      index: 2,
      tag: 'a',
      role: 'link',
      label: 'External docs',
      text: 'External docs',
      href: 'https://external.example/docs',
    });
    const newOriginAction = orch.executeTool(
      runId,
      makeCall('click-session-new-origin', 'page_click', {
        snapshotId: 'page-snap-1',
        index: 2,
      })
    );
    await expect(newOriginAction).resolves.toMatchObject({ result: { success: true } });
    expect(events.filter((event) => event.type === 'page_action_confirmation')).toHaveLength(1);
  });

  it('continues after an approved navigation and forces a fresh snapshot', async () => {
    let currentUrl = 'https://example.test/form';
    const tasksSnapshot = () => ({
      ...makeSnapshot(),
      content: '[0] <input label="Search">\\n[1] <button label="Tasks">',
      elements: [
        makeSnapshot().elements[0],
        { ...makeSnapshot().elements[1], label: 'Tasks', text: 'Tasks' },
      ],
    });
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => false,
      pageActionDocumentProvider: async () => ({ url: currentUrl }),
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'clearPageActionSession') return { success: true };
        if (actionName === 'page_get_state') {
          return {
            success: true,
            snapshot: { ...tasksSnapshot(), url: currentUrl },
          };
        }
        currentUrl = 'https://example.test/tasks';
        return {
          success: true,
          navigated: true,
          navigationUrl: currentUrl,
          message: 'navigated',
        };
      },
    });
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });

    await orch.executeTool(runId, makeCall('state-before-nav', 'page_get_state', {}));
    const actionPromise = orch.executeTool(
      runId,
      makeCall('click-nav', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    expect(confirmation).toBeTruthy();

    expect(orch.resolvePageActionDecision(runId, confirmation.confirmationId, true)).toBe(true);
    const result = await actionPromise;
    const run = orch.activeRuns.get(runId);
    expect(result.result.navigated).toBe(true);
    expect(result.result.notice).toContain('Navigation completed');
    expect(run.pageActions.documentUrl).toBe('https://example.test/tasks');
    expect(run.pageActions.snapshot).toBeNull();
    expect(orch._getEffectiveToolChoice(run)).toBe('auto');

    const refreshed = await orch.executeTool(
      runId,
      makeCall('state-after-nav', 'page_get_state', {})
    );
    expect(refreshed.result.snapshot.url).toBe('https://example.test/tasks');
    orch.abort(runId);
  });

  it('keeps the default approval card active for at least two minutes', async () => {
    vi.useFakeTimers();
    try {
      const events = [];
      const orch = new RunOrchestrator(createStubSkillManager(), {
        pageActionExecutor: async (_tabId, actionName) =>
          actionName === 'page_get_state'
            ? { success: true, snapshot: makeSnapshot() }
            : { success: true, snapshot: makeSnapshot() },
      });
      orch._emitEvent = (_runId, event) => events.push(event);
      const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
      await orch.executeTool(runId, makeCall('long-timeout-state', 'page_get_state', {}));
      const pending = orch.executeTool(
        runId,
        makeCall('long-timeout-click', 'page_click', {
          snapshotId: 'page-snap-1',
          index: 1,
        })
      );
      await vi.advanceTimersByTimeAsync(120_001);
      expect(events.some((event) => event.type === 'page_action_decision')).toBe(false);
      const confirmation = events.find((event) => event.type === 'page_action_confirmation');
      expect(orch.resolvePageActionDecision(runId, confirmation.confirmationId, true)).toBe(true);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats approval timeout as no answer rather than a user denial', async () => {
    vi.useFakeTimers();
    try {
      const events = [];
      const orch = new RunOrchestrator(createStubSkillManager(), {
        pageActionExecutor: async (...args) =>
          args[1] === 'page_get_state'
            ? { success: true, snapshot: makeSnapshot() }
            : { success: true, snapshot: makeSnapshot() },
      });
      orch._emitEvent = (_runId, event) => events.push(event);
      const runId = await orch.startRun({
        pageActions: true,
        sourceTabId: 7,
        tool_choice: 'auto',
        pageActionConfirmationTimeoutMs: 1_000,
      });
      await orch.executeTool(runId, makeCall('timeout-state', 'page_get_state', {}));
      const pending = orch.executeTool(
        runId,
        makeCall('timeout-click', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
      );
      await vi.advanceTimersByTimeAsync(1_001);
      const result = await pending;
      expect(result.result.error).toBe('PAGE_ACTION_DENIED');
      expect(orch.activeRuns.get(runId).pageActions.lastDeniedAction).toBeNull();
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'page_action_decision', timedOut: true }),
        ])
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('records a bounded denial, flags the card outcome, and nudges the planner', async () => {
    const events = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async () => ({
        success: true,
        snapshot: makeSnapshot(),
      }),
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const run = orch.activeRuns.get(runId);
    await orch.executeTool(runId, makeCall('deny-state', 'page_get_state', {}));

    const pending = orch.executeTool(
      runId,
      makeCall('deny-click', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirmation = events.find((event) => event.type === 'page_action_confirmation');
    expect(orch.resolvePageActionDecision(runId, confirmation.confirmationId, false)).toBe(true);
    const result = await pending;
    expect(result.result.error).toBe('PAGE_ACTION_DENIED');

    // The bounded denial marker drives both the card outcome and the nudge.
    expect(run.pageActions.lastDeniedAction).toMatchObject({ action: 'page_click' });
    const decision = events.find((event) => event.type === 'page_action_decision');
    expect(decision).toMatchObject({ approved: false, action: 'page_click' });
    expect(orch._buildPageTaskProgressEvent(run).outcome.declined).toBe(true);

    // The next planner prompt carries the "do not repeat it" directive.
    const nudgePrompt = orch._buildSystemPrompt(run, []);
    expect(nudgePrompt).toContain('DECLINED ACTION');
    expect(nudgePrompt).toContain('page_click');
    expect(nudgePrompt).toContain('Do NOT repeat it');
  });

  it('clears the denial marker on a fresh inspection and on the next approval', async () => {
    const events = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async () => ({ success: true, snapshot: makeSnapshot() }),
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const run = orch.activeRuns.get(runId);
    await orch.executeTool(runId, makeCall('clear-state', 'page_get_state', {}));

    const denyOne = orch.executeTool(
      runId,
      makeCall('clear-deny-1', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const first = events.find((event) => event.type === 'page_action_confirmation');
    expect(orch.resolvePageActionDecision(runId, first.confirmationId, false)).toBe(true);
    await denyOne;
    expect(run.pageActions.lastDeniedAction).toMatchObject({ action: 'page_click' });

    // A fresh inspection means the model moved on from the denied control.
    await orch.executeTool(runId, makeCall('clear-fresh', 'page_get_state', {}));
    expect(run.pageActions.lastDeniedAction).toBeNull();

    // A later deny followed by an approval also clears the marker.
    const denyTwo = orch.executeTool(
      runId,
      makeCall('clear-deny-2', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    // events.find() would return the already-resolved first confirmation, so
    // read the currently pending confirmation for this deny instead.
    const second = run.pageActions.pendingConfirmation;
    expect(second).toBeTruthy();
    expect(second.id).not.toBe(first.confirmationId);
    expect(orch.resolvePageActionDecision(runId, second.id, false)).toBe(true);
    await denyTwo;
    expect(run.pageActions.lastDeniedAction).toMatchObject({ action: 'page_click' });

    const approveOne = orch.executeTool(
      runId,
      makeCall('clear-approve', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const approveConf = run.pageActions.pendingConfirmation;
    expect(approveConf).toBeTruthy();
    expect(orch.resolvePageActionDecision(runId, approveConf.id, true)).toBe(true);
    await approveOne;
    expect(run.pageActions.lastDeniedAction).toBeNull();
  });

  it('advertises an optional bounded title on every page-action tool', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const run = orch.activeRuns.get(runId);
    run.pageActions.snapshot = makeSnapshot();
    const tools = await orch._buildTools(run);
    const names = [
      'page_get_state',
      'page_find_text',
      'page_wait',
      'page_batch',
      'page_click',
      'page_input',
      'page_select',
      'page_scroll',
    ];
    for (const name of names) {
      const tool = tools.find((entry) => entry.function.name === name);
      expect(tool, `tool ${name} is advertised`).toBeTruthy();
      expect(tool.function.parameters.properties.title).toMatchObject({
        type: 'string',
        maxLength: 80,
      });
    }
  });

  it('carries a bounded model-supplied title onto the progress card', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) =>
        actionName === 'page_get_state'
          ? { success: true, snapshot: makeSnapshot() }
          : { success: true, snapshot: makeSnapshot(), message: 'updated' },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const run = orch.activeRuns.get(runId);
    await orch.executeTool(runId, makeCall('title-state', 'page_get_state', {}));
    await orch.executeTool(
      runId,
      makeCall('title-scroll', 'page_scroll', {
        direction: 'down',
        pages: 1,
        title: 'Revealing the results list',
      })
    );
    expect(run.pageActions.currentActionTitle).toBe('Revealing the results list');

    const progress = orch._buildPageTaskProgressEvent(run);
    expect(progress.title).toBe('Revealing the results list');
    // The journal keeps only the bounded display title.
    expect(orch._journalEvent(progress).title).toBe('Revealing the results list');

    // An over-long title is still bounded to 80 chars on the card.
    run.pageActions.currentActionTitle = 'x'.repeat(120);
    expect(orch._buildPageTaskProgressEvent(run).title.length).toBe(80);

    // A fresh inspection clears the stale title so the card falls back to the
    // event-type label.
    await orch.executeTool(runId, makeCall('title-state-two', 'page_get_state', {}));
    expect(run.pageActions.currentActionTitle).toBeNull();
  });

  it('does not dispatch a repeated scroll from an unchanged position', async () => {
    let containerTop = 0;
    const snapshot = () => ({
      ...makeSnapshot(),
      fingerprint: 'stable-page',
      routeId: 'stable-route',
      scroll: { x: 0, y: 0 },
      scrollContainers: [{ index: 2, top: containerTop, left: 0 }],
    });
    let scrollDispatches = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') return { success: true, snapshot: snapshot() };
        scrollDispatches += 1;
        return { success: true, snapshot: snapshot() };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('scroll-loop-state', 'page_get_state', {}));

    const first = await orch.executeTool(
      runId,
      makeCall('scroll-loop-first', 'page_scroll', {
        containerIndex: 2,
        direction: 'down',
        pages: 1,
      })
    );
    const repeated = await orch.executeTool(
      runId,
      makeCall('scroll-loop-repeat', 'page_scroll', {
        containerIndex: 2,
        direction: 'down',
        pages: 4,
      })
    );
    const alternative = await orch.executeTool(
      runId,
      makeCall('scroll-loop-alternative', 'page_scroll', {
        direction: 'down',
        pages: 1,
      })
    );

    expect(first.result.actionReceipt.disposition).toBe('delivered_unverified');
    expect(repeated.result).toMatchObject({
      error: 'PAGE_SCROLL_NO_PROGRESS',
      actionReceipt: {
        disposition: 'not_delivered',
        evidence: { kind: 'repeated_no_progress_scroll' },
      },
    });
    expect(repeated.result.message).toMatch(/another observed scroll container/i);
    expect(alternative.result.error).toBeUndefined();
    expect(scrollDispatches).toBe(2);

    containerTop = 100;
    await orch.executeTool(
      runId,
      makeCall('scroll-loop-state-after-user-scroll', 'page_get_state', {})
    );
    const progressedPosition = await orch.executeTool(
      runId,
      makeCall('scroll-loop-new-position', 'page_scroll', {
        containerIndex: 2,
        direction: 'down',
        pages: 1,
      })
    );
    expect(progressedPosition.result.error).toBeUndefined();
    expect(scrollDispatches).toBe(3);
  });

  it('bounds distinct scroll attempts when the returned snapshot shows no movement', async () => {
    const snapshot = () => ({
      ...makeSnapshot(),
      fingerprint: 'stable-page',
      routeId: 'stable-route',
      scroll: { x: 0, y: 0 },
      scrollContainers: [0, 1, 2].map((index) => ({ index, top: 0, left: 0 })),
    });
    let scrollDispatches = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') return { success: true, snapshot: snapshot() };
        scrollDispatches += 1;
        return {
          success: true,
          snapshot: snapshot(),
          actionReceipt: {
            disposition: 'delivered_verified',
            evidence: { kind: 'scroll_position', changed: true },
          },
        };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('scroll-stall-state', 'page_get_state', {}));

    const attempts = [];
    for (const index of [0, 1, 2, 3]) {
      attempts.push(
        await orch.executeTool(
          runId,
          makeCall(`scroll-stall-${index}`, 'page_scroll', {
            ...(index < 3 ? { containerIndex: index } : {}),
            direction: 'down',
            pages: index + 1,
          })
        )
      );
    }

    expect(
      attempts
        .slice(0, 3)
        .every((attempt) => attempt.result.actionReceipt.disposition === 'delivered_unverified')
    ).toBe(true);
    expect(attempts[3].result.error).toBe('PAGE_SCROLL_STALLED');
    expect(scrollDispatches).toBe(3);
  });

  it('removes scrolling after revisiting a position and restores it after a match', async () => {
    let scrollY = 0;
    const snapshot = () => ({
      ...makeSnapshot(),
      fingerprint: 'scrolling-page',
      routeId: 'scrolling-route',
      scroll: { x: 0, y: scrollY },
    });
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName, args) => {
        if (actionName === 'page_get_state') return { success: true, snapshot: snapshot() };
        if (actionName === 'page_scroll') {
          scrollY += args.direction === 'up' ? -100 : 100;
          return { success: true, snapshot: snapshot() };
        }
        if (actionName === 'page_find_text')
          return { success: true, found: true, matches: ['requested text'], snapshot: snapshot() };
        return { success: true, snapshot: snapshot() };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const run = orch.activeRuns.get(runId);
    await orch.executeTool(runId, makeCall('scroll-evidence-state', 'page_get_state', {}));

    for (const [index, direction] of ['down', 'down', 'down', 'up'].entries()) {
      await orch.executeTool(
        runId,
        makeCall(`scroll-evidence-${index}`, 'page_scroll', { direction, pages: 1 })
      );
    }
    const stalledTools = await orch._buildTools(run);
    expect(stalledTools.some((tool) => tool.function?.name === 'page_scroll')).toBe(false);
    expect(stalledTools.some((tool) => tool.function?.name === 'page_find_text')).toBe(true);
    const rejectedScroll = await orch.executeTool(
      runId,
      makeCall('scroll-stalled-rejected', 'page_scroll', { direction: 'down', pages: 1 })
    );
    expect(rejectedScroll.result.error).toBe('PAGE_SCROLL_STALLED');
    expect(scrollY).toBe(200);

    await orch.executeTool(
      runId,
      makeCall('scroll-evidence-match', 'page_find_text', { query: 'requested text' })
    );
    const resumedTools = await orch._buildTools(run);
    expect(resumedTools.some((tool) => tool.function?.name === 'page_scroll')).toBe(true);
  });

  it('aborts a pending page-action approval and clears the pending decision', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) =>
        actionName === 'page_get_state'
          ? { success: true, snapshot: makeSnapshot() }
          : { success: true, snapshot: makeSnapshot() },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('state-abort', 'page_get_state', {}));
    const pending = orch.executeTool(
      runId,
      makeCall('click-abort', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    orch.abort(runId);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('allows trusted mode for ordinary controls but still blocks sensitive fields', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async () => ({ success: true, snapshot: makeSnapshot() }),
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('state-2', 'page_get_state', {}));
    const result = await orch.executeTool(
      runId,
      makeCall('input-1', 'page_input', { snapshotId: 'page-snap-1', index: 0, text: 'hello' })
    );
    expect(result.result.success).toBe(true);

    await orch.executeTool(runId, makeCall('state-2-after-input', 'page_get_state', {}));
    const run = orch.activeRuns.get(runId);
    run.pageActions.snapshot.elements[0].sensitive = true;
    const blocked = await orch.executeTool(
      runId,
      makeCall('input-2', 'page_input', { snapshotId: 'page-snap-1', index: 0, text: 'secret' })
    );
    expect(blocked.result.error).toBe('PAGE_ACTION_BLOCKED');
  });

  it('rejects stale snapshot targets and returns a fresh inspection in the same tool result', async () => {
    let actionCalls = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async () => {
        actionCalls += 1;
        return { success: true, snapshot: makeSnapshot() };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('state-3', 'page_get_state', {}));
    const run = orch.activeRuns.get(runId);
    run.pageActions.snapshot.snapshotId = 'different-snapshot';
    const result = await orch.executeTool(
      runId,
      makeCall('click-2', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );
    expect(result.result.error).toBe('PAGE_STATE_STALE');
    expect(result.result.snapshot.snapshotId).toBe('page-snap-1');
    expect(result.result.message).toContain('fresh page snapshot is included');
    expect(actionCalls).toBe(2);
  });

  it('counts only delivered mutations for the repeat guards', async () => {
    let failDispatch = true;
    let failureCode = 'PAGE_STATE_STALE';
    let mutationCalls = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') return { success: true, snapshot: makeSnapshot() };
        mutationCalls += 1;
        if (failDispatch) {
          const error = new Error('The target was replaced before dispatch.');
          error.code = failureCode;
          throw error;
        }
        return {
          success: true,
          snapshot: makeSnapshot(),
          actionReceipt: {
            disposition: 'delivered_verified',
            evidence: { kind: 'synthetic_no_change' },
          },
        };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('repeat-state-1', 'page_get_state', {}));

    for (const [attempt, code] of ['PAGE_STATE_STALE', 'PAGE_TARGET_OBSCURED'].entries()) {
      failureCode = code;
      await expect(
        orch.executeTool(
          runId,
          makeCall(`repeat-failed-input-${attempt}`, 'page_input', {
            snapshotId: 'page-snap-1',
            index: 0,
            text: 'same input',
          })
        )
      ).rejects.toMatchObject({ code });
    }
    expect(orch.activeRuns.get(runId).pageActions.repeatedActionCount).toBe(0);

    failDispatch = false;
    const first = await orch.executeTool(
      runId,
      makeCall('repeat-delivered-1', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'same input',
      })
    );
    const second = await orch.executeTool(
      runId,
      makeCall('repeat-delivered-2', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'same input',
      })
    );
    const third = await orch.executeTool(
      runId,
      makeCall('repeat-delivered-3', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'same input',
      })
    );

    expect(first.result.actionReceipt.disposition).toBe('delivered_verified');
    expect(second.result.actionReceipt.disposition).toBe('delivered_verified');
    // Identical inputs now hit the repeated-query guard first (type-then-Enter
    // loops share the same budget). Failed dispatches never incremented either
    // guard, so only the two delivered mutations count.
    expect(third.result.error).toBe('PAGE_ACTION_REPEATED_QUERY');
    expect(orch.activeRuns.get(runId).pageActions.repeatedActionCount).toBe(2);
    expect(mutationCalls).toBe(4);
  });

  it('redirects a third consecutive occluded click on the same target', async () => {
    let occlude = true;
    // 'Apply filter' classifies LOW so trusted mode skips confirmation cards.
    const occludedSnapshot = () => ({
      snapshotId: 'page-snap-occluded',
      url: 'https://example.test/form',
      title: 'Example form',
      header: 'Current page',
      content: '[1] <button label="Apply filter">',
      footer: 'End of page',
      elements: [
        { index: 1, tag: 'button', label: 'Apply filter', text: 'Apply filter', sensitive: false },
      ],
    });
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') return { success: true, snapshot: occludedSnapshot() };
        if (occlude) {
          const error = new Error('The target is covered.');
          error.code = 'PAGE_ACTION_TARGET_OCCLUDED';
          error.preDispatch = true;
          error.occluder = { tag: 'div', label: 'Search overlay' };
          throw error;
        }
        return {
          success: true,
          snapshot: occludedSnapshot(),
          actionReceipt: {
            disposition: 'delivered_verified',
            evidence: { kind: 'synthetic_no_change' },
          },
        };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('occluded-state-1', 'page_get_state', {}));
    const clickArgs = { snapshotId: 'page-snap-occluded', index: 1 };

    const first = await orch.executeTool(runId, makeCall('occluded-1', 'page_click', clickArgs));
    const second = await orch.executeTool(runId, makeCall('occluded-2', 'page_click', clickArgs));
    expect(first.result.error).toBe('PAGE_ACTION_TARGET_OCCLUDED');
    expect(second.result.error).toBe('PAGE_ACTION_TARGET_OCCLUDED');
    // Occluded attempts never reach the page, so the delivered-mutation guards
    // stay quiet while the occlusion streak redirects the third attempt.
    expect(orch.activeRuns.get(runId).pageActions.repeatedActionCount).toBe(0);
    expect(orch.activeRuns.get(runId).pageActions.noProgressMutationCount).toBe(0);

    const third = await orch.executeTool(runId, makeCall('occluded-3', 'page_click', clickArgs));
    expect(third.result.error).toBe('PAGE_ACTION_OCCLUDED_REPEATED');
    expect(third.result.actionReceipt.disposition).toBe('not_delivered');

    // A dispatched action restarts the streak, so the same target is usable again.
    occlude = false;
    const fourth = await orch.executeTool(runId, makeCall('occluded-4', 'page_click', clickArgs));
    expect(fourth.result.actionReceipt.disposition).toBe('delivered_verified');
    expect(orch.activeRuns.get(runId).pageActions.occludedRepeatCount).toBe(0);
  });

  it('always performs a live page inspection instead of reusing a cached snapshot', async () => {
    let inspections = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') {
          inspections += 1;
          return {
            success: true,
            snapshot: { ...makeSnapshot(), title: `Inspection ${inspections}` },
          };
        }
        return { success: true };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });

    const first = await orch.executeTool(runId, makeCall('live-state-1', 'page_get_state', {}));
    const second = await orch.executeTool(runId, makeCall('live-state-2', 'page_get_state', {}));

    expect(inspections).toBe(2);
    expect(first.result.snapshot.title).toBe('Inspection 1');
    expect(second.result.snapshot.title).toBe('Inspection 2');
    expect(second.result.cacheHit).toBeUndefined();
  });

  it('treats a verified mutation that changed no page state as progress, not a stall', async () => {
    let mutationCalls = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') return { success: true, snapshot: makeSnapshot() };
        mutationCalls += 1;
        // A fill that changes no observable page state still proves its own
        // effect by reading the value back, so it must not count as progress-free.
        return {
          success: true,
          snapshot: makeSnapshot(),
          actionReceipt: {
            disposition: 'delivered_verified',
            evidence: { kind: 'input_value_match', matched: true },
          },
        };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('filled-state-1', 'page_get_state', {}));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await orch.executeTool(
        runId,
        makeCall(`filled-input-${attempt}`, 'page_input', {
          snapshotId: 'page-snap-1',
          index: 0,
          text: `value ${attempt}`,
        })
      );
      expect(result.result?.error, JSON.stringify(result)).toBeUndefined();
      expect(result.result.actionReceipt.disposition).toBe('delivered_verified');
    }

    expect(orch.activeRuns.get(runId).pageActions.noProgressMutationCount).toBe(0);
    expect(mutationCalls).toBe(5);
  });

  it('treats a changed page fingerprint as progress after a mutation', async () => {
    let pageVersion = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state')
          return {
            success: true,
            snapshot: {
              ...makeSnapshot(),
              content: `Updated page ${pageVersion}`,
              fingerprint: `page-fingerprint-${pageVersion}`,
            },
          };
        pageVersion += 1;
        return {
          success: true,
          snapshot: {
            ...makeSnapshot(),
            content: `Updated page ${pageVersion}`,
            fingerprint: `page-fingerprint-${pageVersion}`,
          },
          pageChanged: false,
          actionReceipt: { disposition: 'delivered_unverified' },
        };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('fingerprint-state', 'page_get_state', {}));

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await orch.executeTool(
        runId,
        makeCall(`fingerprint-input-${attempt}`, 'page_input', {
          snapshotId: 'page-snap-1',
          index: 0,
          text: `value ${attempt}`,
        })
      );
      expect(result.result?.error, JSON.stringify(result)).toBeUndefined();
      if (attempt < 3)
        await orch.executeTool(
          runId,
          makeCall(`fingerprint-state-${attempt + 2}`, 'page_get_state', {})
        );
    }

    expect(orch.activeRuns.get(runId).pageActions.noProgressMutationCount).toBe(0);
    expect(pageVersion).toBe(4);
  });

  it('requires a fresh inspection before any mutation after an unverified delivery', async () => {
    let mutationCalls = 0;
    let tabActionCalls = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageTabExecutor: async () => {
        tabActionCalls += 1;
        return { success: true };
      },
      pageActionExecutor: async (_tabId, actionName) => {
        if (['page_get_state', 'page_find_text'].includes(actionName))
          return { success: true, snapshot: makeSnapshot() };
        mutationCalls += 1;
        return {
          success: true,
          pageChanged: false,
          actionReceipt: {
            disposition: 'delivered_unverified',
            evidence: { kind: 'click_dispatch_unconfirmed', pageEffectObserved: false },
          },
        };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('unverified-state-1', 'page_get_state', {}));

    const firstMutation = await orch.executeTool(
      runId,
      makeCall('unverified-input-a', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'alpha',
      })
    );
    expect(firstMutation.result.actionReceipt.disposition).toBe('delivered_unverified');
    expect(
      (await orch._buildTools(orch.activeRuns.get(runId))).map((tool) => tool.function.name)
    ).toEqual(['page_get_state']);

    const blockedSearch = await orch.executeTool(
      runId,
      makeCall('unverified-text-search', 'page_find_text', { query: 'Ada' })
    );
    expect(blockedSearch.result.error).toBe('PAGE_ACTION_INSPECTION_REQUIRED');

    const blindMutation = await orch.executeTool(
      runId,
      makeCall('unverified-input-b', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'beta',
      })
    );
    expect(blindMutation.result.error).toBe('PAGE_ACTION_INSPECTION_REQUIRED');
    expect(blindMutation.result.actionReceipt.disposition).toBe('not_delivered');
    expect(mutationCalls).toBe(1);

    const blindNavigation = await orch.executeTool(
      runId,
      makeCall('unverified-open-tab', 'page_open_tab', { url: 'https://example.test/next' })
    );
    expect(blindNavigation.result.error).toBe('PAGE_ACTION_INSPECTION_REQUIRED');
    expect(tabActionCalls).toBe(0);

    await orch.executeTool(runId, makeCall('unverified-state-2', 'page_get_state', {}));
    expect(orch.activeRuns.get(runId).pageActions.reverifiedAfterUnverified).toBe(true);
    const inspectedMutation = await orch.executeTool(
      runId,
      makeCall('unverified-input-c', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'alpha',
      })
    );
    expect(inspectedMutation.result.actionReceipt.disposition).toBe('delivered_unverified');
    expect(mutationCalls).toBe(2);
    expect(orch.activeRuns.get(runId).pageActions.repeatedActionCount).toBe(2);
  });

  it('reuses the fresh post-action snapshot after an unverified delivery', async () => {
    let mutationCalls = 0;
    let inspectionCalls = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') {
          inspectionCalls += 1;
          return {
            success: true,
            snapshot: {
              ...makeSnapshot(),
              snapshotId: 'observed-before-action',
              fingerprint: 'unchanged-page',
            },
          };
        }
        mutationCalls += 1;
        return {
          success: true,
          snapshot: {
            ...makeSnapshot(),
            snapshotId: `observed-after-action-${mutationCalls}`,
            fingerprint: 'unchanged-page',
          },
          pageChanged: false,
          actionReceipt: {
            disposition: 'delivered_unverified',
            evidence: { kind: 'click_dispatch_unconfirmed', pageEffectObserved: false },
          },
        };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('observed-state-1', 'page_get_state', {}));

    const firstMutation = await orch.executeTool(
      runId,
      makeCall('observed-input-1', 'page_input', {
        snapshotId: 'observed-before-action',
        index: 0,
        text: 'alpha',
      })
    );
    expect(firstMutation.result.actionReceipt.disposition).toBe('delivered_unverified');
    expect(firstMutation.result.snapshot.snapshotId).toBe('observed-after-action-1');
    expect(orch.activeRuns.get(runId).pageActions.reverifiedAfterUnverified).toBe(false);
    expect(orch.activeRuns.get(runId).pageActions.freshActionSnapshotAfterUnverified).toBe(true);

    const available = (await orch._buildTools(orch.activeRuns.get(runId))).map(
      (tool) => tool.function.name
    );
    expect(available).toContain('page_input');

    const secondMutation = await orch.executeTool(
      runId,
      makeCall('observed-input-2', 'page_input', {
        snapshotId: 'observed-after-action-1',
        index: 0,
        text: 'alpha',
      })
    );
    expect(secondMutation.result.actionReceipt.disposition).toBe('delivered_unverified');
    expect(mutationCalls).toBe(2);
    expect(inspectionCalls).toBe(1);
    expect(orch.activeRuns.get(runId).pageActions.repeatedActionCount).toBe(2);
  });

  it('blocks a mutation once three different mutations changed nothing', async () => {
    let mutationCalls = 0;
    let snapshotFingerprint = 'page-fingerprint-1';
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state')
          return {
            success: true,
            snapshot: { ...makeSnapshot(), fingerprint: snapshotFingerprint },
          };
        mutationCalls += 1;
        return {
          success: true,
          snapshot: { ...makeSnapshot(), fingerprint: snapshotFingerprint },
          pageChanged: false,
          actionReceipt: {
            disposition: 'delivered_unverified',
            evidence: { kind: 'click_dispatch_unconfirmed', pageEffectObserved: false },
          },
        };
      },
    });
    const events = [];
    orch._emitEvent = (_id, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('no-effect-state-1', 'page_get_state', {}));

    // Re-inspect between actions because unverified delivery requires fresh
    // state. The identical-action guard cannot see different arguments, so the
    // no-progress guard must stop the fourth mutation.
    const attempts = [
      ['no-effect-input-a', 'page_input', { snapshotId: 'page-snap-1', index: 0, text: 'alpha' }],
      ['no-effect-input-b', 'page_input', { snapshotId: 'page-snap-1', index: 0, text: 'beta' }],
      ['no-effect-input-c', 'page_input', { snapshotId: 'page-snap-1', index: 0, text: 'gamma' }],
    ];
    for (const [index, [id, name, args]] of attempts.entries()) {
      const result = await orch.executeTool(runId, makeCall(id, name, args));
      expect(result.result?.error, JSON.stringify(result)).toBeUndefined();
      await orch.executeTool(runId, makeCall(`no-effect-state-${index + 2}`, 'page_get_state', {}));
    }
    // The identical-action guard saw nothing, because every action differed.
    expect(orch.activeRuns.get(runId).pageActions.repeatedActionCount).toBe(1);
    expect(orch.activeRuns.get(runId).pageActions.noProgressMutationCount).toBe(3);

    const blocked = await orch.executeTool(
      runId,
      makeCall('no-effect-input-blocked', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'delta',
      })
    );
    expect(blocked.result.error).toBe('PAGE_ACTION_NO_PROGRESS');
    expect(events.some((event) => event.code === 'PAGE_ACTION_NO_PROGRESS')).toBe(true);
    expect(mutationCalls).toBe(3);

    // An unchanged inspection does not clear the streak and permit a loop.
    expect(orch.activeRuns.get(runId).pageActions.noProgressMutationCount).toBe(3);
    const stillBlocked = await orch.executeTool(
      runId,
      makeCall('no-effect-input-still-blocked', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'epsilon',
      })
    );
    expect(stillBlocked.result.error).toBe('PAGE_ACTION_NO_PROGRESS');

    // A new observed fingerprint is real progress and clears the streak.
    snapshotFingerprint = 'page-fingerprint-2';
    await orch.executeTool(runId, makeCall('no-effect-state-5', 'page_get_state', {}));
    expect(orch.activeRuns.get(runId).pageActions.noProgressMutationCount).toBe(0);

    const afterInspection = await orch.executeTool(
      runId,
      makeCall('no-effect-input-after-progress', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'zeta',
      })
    );
    expect(afterInspection.result?.error, JSON.stringify(afterInspection)).toBeUndefined();
    expect(mutationCalls).toBe(4);
  });

  it('blocks a third identical search query without verified progress', async () => {
    let findCalls = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') return { success: true, snapshot: makeSnapshot() };
        findCalls += 1;
        return { success: true, snapshot: makeSnapshot() };
      },
    });
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('query-state-1', 'page_get_state', {}));

    const query = '  On the Sentence Embeddings  FROM Pre-trained Language Models ';
    for (const id of ['query-find-1', 'query-find-2']) {
      const result = await orch.executeTool(runId, makeCall(id, 'page_find_text', { query }));
      expect(result.result?.error, JSON.stringify(result)).toBeUndefined();
    }
    expect(findCalls).toBe(2);

    const blocked = await orch.executeTool(
      runId,
      makeCall('query-find-3', 'page_find_text', { query: query.toLowerCase() })
    );
    expect(blocked.result.error).toBe('PAGE_ACTION_REPEATED_QUERY');
    expect(blocked.result.actionReceipt).toMatchObject({
      disposition: 'not_delivered',
      evidence: { kind: 'repeated_query_blocked' },
    });
    expect(events.some((event) => event.code === 'PAGE_ACTION_REPEATED_QUERY')).toBe(true);
    expect(findCalls).toBe(2);

    // A submitted input with the same normalized text shares the same budget.
    const inputBlocked = await orch.executeTool(
      runId,
      makeCall('query-input-3', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'on the sentence embeddings from pre-trained language models',
        submit: true,
      })
    );
    expect(inputBlocked.result.error).toBe('PAGE_ACTION_REPEATED_QUERY');

    // Typing the same query without submit shares the same budget, so
    // type-then-Enter loops cannot evade the guard.
    const typedBlocked = await orch.executeTool(
      runId,
      makeCall('query-input-typed-3', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: '  ON THE sentence embeddings from pre-trained LANGUAGE models ',
      })
    );
    expect(typedBlocked.result.error).toBe('PAGE_ACTION_REPEATED_QUERY');
  });

  it('blocks searches after six consecutive searches with no opened result', async () => {
    const linkSnapshot = () => ({
      ...makeSnapshot(),
      elements: [
        ...makeSnapshot().elements,
        {
          index: 2,
          tag: 'a',
          role: 'link',
          label: 'Open report',
          text: 'Open report',
          href: 'https://example.test/report',
        },
      ],
    });
    let findCalls = 0;
    let submitCalls = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') return { success: true, snapshot: linkSnapshot() };
        if (actionName === 'page_open_link')
          return {
            success: true,
            linkUrl: 'https://example.test/report',
            snapshot: makeSnapshot(),
          };
        if (actionName === 'page_find_text') {
          findCalls += 1;
          return { success: true, snapshot: makeSnapshot() };
        }
        if (actionName === 'page_input') {
          submitCalls += 1;
          return {
            success: true,
            snapshot: { ...makeSnapshot(), fingerprint: `fp-input-${submitCalls}` },
          };
        }
        findCalls += 1;
        return { success: true, snapshot: makeSnapshot() };
      },
      pageTabExecutor: async (_runId, _actionName, args) => ({
        targetTabId: args.tabId || 7,
        openedTabId: args.tabId || 7,
        ready: true,
        navigated: true,
      }),
    });
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({
      pageActions: true,
      pageActionsMultiTab: true,
      sourceTabId: 7,
      tool_choice: 'auto',
    });
    await orch.executeTool(runId, makeCall('streak-state-1', 'page_get_state', {}));

    // page_find_text is a read-only in-page observation, not a site search. A
    // long reading task must be able to look up many labels without the
    // search-without-open guard locking it out.
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const result = await orch.executeTool(
        runId,
        makeCall(`streak-find-${attempt}`, 'page_find_text', {
          query: `paper topic variant ${attempt}`,
        })
      );
      expect(result.result?.error, JSON.stringify(result)).toBeUndefined();
    }
    expect(findCalls).toBe(9);

    // Six submitted searches: the streak grows with no result opened.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await orch.executeTool(
        runId,
        makeCall(`streak-submit-${attempt}`, 'page_input', {
          snapshotId: 'page-snap-1',
          index: 0,
          text: `variant ${attempt}`,
          submit: true,
        })
      );
      expect(result.result?.error, JSON.stringify(result)).toBeUndefined();
    }
    expect(submitCalls).toBe(6);

    const blocked = await orch.executeTool(
      runId,
      makeCall('streak-submit-6', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'variant 6',
        submit: true,
      })
    );
    expect(blocked.result.error).toBe('PAGE_ACTION_SEARCH_WITHOUT_OPEN');
    expect(blocked.result.actionReceipt).toMatchObject({
      disposition: 'not_delivered',
      evidence: { kind: 'search_without_open_blocked' },
    });
    expect(events.some((event) => event.code === 'PAGE_ACTION_SEARCH_WITHOUT_OPEN')).toBe(true);
    expect(submitCalls).toBe(6);

    // Opening a result (verified navigation) resets the streak. The open
    // clears the run snapshot, so a fresh inspection grounds the next action.
    const opened = await orch.executeTool(
      runId,
      makeCall('streak-open-1', 'page_open_link', { snapshotId: 'page-snap-1', index: 2 })
    );
    expect(opened.result?.error, JSON.stringify(opened)).toBeUndefined();

    const reinspect = await orch.executeTool(
      runId,
      makeCall('streak-state-2', 'page_get_state', {})
    );
    expect(reinspect.result?.error, JSON.stringify(reinspect)).toBeUndefined();

    const afterOpen = await orch.executeTool(
      runId,
      makeCall('streak-submit-7', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'variant 7',
        submit: true,
      })
    );
    expect(afterOpen.result?.error, JSON.stringify(afterOpen)).toBeUndefined();
    expect(submitCalls).toBe(7);
    orch.abort(runId);
  });

  it('hints the model when page_get_state returns an empty page with no controls', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async () => ({
        success: true,
        snapshot: {
          snapshotId: 'empty-1',
          url: 'https://example.test/',
          title: 'New tab',
          header: '',
          content: '',
          footer: '',
          elements: [],
        },
      }),
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const result = await orch.executeTool(runId, makeCall('state-empty', 'page_get_state', {}));

    expect(result.result.snapshot.actionableHint).toMatch(/nothing to act on/i);
    expect(result.result.snapshot.actionableHint).toMatch(/ask the user to open the page/i);
  });

  it('hints the model to ask for the target page when a page has text but no controls', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async () => ({
        success: true,
        snapshot: {
          snapshotId: 'text-1',
          url: 'https://example.test/article',
          title: 'An article',
          header: 'Article body text',
          content: '',
          footer: '',
          elements: [],
        },
      }),
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const result = await orch.executeTool(runId, makeCall('state-text', 'page_get_state', {}));

    expect(result.result.snapshot.actionableHint).toMatch(/no interactive controls/i);
    expect(result.result.snapshot.actionableHint).toMatch(/ask the user to open the target page/i);
  });

  it('isolates a missing content-script bridge to the affected tab', async () => {
    const quarantine = vi.fn(() => ({ tabId: 7, nextTargetTabId: 12, available: true }));
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async () => {
        const error = new Error('Receiving end does not exist.');
        error.code = 'PAGE_ACTION_MESSAGE_FAILED';
        throw error;
      },
      pageActionTabFailureHandler: quarantine,
    });
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });

    const result = await orch.executeTool(runId, makeCall('state-dead', 'page_get_state', {}));
    expect(result.result).toMatchObject({
      error: 'PAGE_TAB_UNAVAILABLE',
      code: 'PAGE_ACTION_MESSAGE_FAILED',
      handled: true,
      scope: 'tab',
      nextTargetTabId: 12,
    });
    expect(quarantine).toHaveBeenCalledWith(
      runId,
      7,
      expect.objectContaining({ code: 'PAGE_ACTION_MESSAGE_FAILED' })
    );
    const errorEvent = events.find(
      (event) => event.type === 'page_action_state' && event.state === 'error'
    );
    expect(errorEvent).toBeTruthy();
    expect(errorEvent.error).toContain('Reload the tab and try again');
  });

  it('allows a fresh inspection to re-probe a reloaded source tab', async () => {
    let attempts = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('Receiving end does not exist.');
          error.code = 'PAGE_ACTION_MESSAGE_FAILED';
          throw error;
        }
        return { success: true, snapshot: makeSnapshot() };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const failed = await orch.executeTool(
      runId,
      makeCall('state-reload-failed', 'page_get_state', {})
    );
    expect(failed.result.error).toBe('PAGE_TAB_UNAVAILABLE');

    const recovered = await orch.executeTool(
      runId,
      makeCall('state-reload-recovered', 'page_get_state', {})
    );
    expect(recovered.result.snapshot).toBeTruthy();
    expect(orch.activeRuns.get(runId).pageActions.unavailableTabs.has(7)).toBe(false);
  });

  it('emits a terminal page-action error state for non-terminal executor failures', async () => {
    const events = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') return { success: true, snapshot: makeSnapshot() };
        throw new Error('Synthetic page action failure.');
      },
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    await orch.executeTool(runId, makeCall('state-error-state', 'page_get_state', {}));

    await expect(
      orch.executeTool(
        runId,
        makeCall('click-error-state', 'page_click', {
          snapshotId: 'page-snap-1',
          index: 0,
        })
      )
    ).rejects.toThrow('Synthetic page action failure.');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'page_action_state',
        state: 'error',
        action: 'page_click',
        error: 'Synthetic page action failure.',
      })
    );
  });

  it('returns a coded recoverable result for a disabled page_click target instead of throwing', async () => {
    const executorCalls = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) => {
        executorCalls.push(actionName);
        return { success: true };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const snapshot = makeSnapshot();
    snapshot.elements[1].disabled = true; // "Open details" button
    orch.activeRuns.get(runId).pageActions.snapshot = snapshot;

    const result = await orch.executeTool(
      runId,
      makeCall('click-disabled-target', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
    );

    expect(result.result.error).toBe('PAGE_ACTION_TARGET_DISABLED');
    expect(result.result.message).toContain('disabled');
    expect(executorCalls).not.toContain('page_click');
  });

  it('classifies handshake and bridge failures as recoverable tab errors', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    for (const code of [
      'PAGE_ACTION_NO_CONTENT_SCRIPT',
      'PAGE_ACTION_MESSAGE_FAILED',
      'PAGE_ACTION_TIMEOUT',
      'PAGE_ACTION_NAVIGATION_FAILED',
      'PAGE_ACTION_NAVIGATION_TIMEOUT',
    ]) {
      const error = new Error('bridge down');
      error.code = code;
      expect(orch._isPageActionTabFailure(error)).toBe(true);
    }
    const navigation = new Error('page changed');
    navigation.code = 'PAGE_ACTION_NAVIGATED';
    expect(orch._isPageActionTabFailure(navigation)).toBe(false);
  });

  it('propagates a run-start handshake failure as one actionable error', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionAvailabilityProvider: async () => {
        const error = new Error(
          'Page actions are on, but the Prompt Paul content script is not connected to this tab. Reload the tab and try again.'
        );
        error.code = 'PAGE_ACTION_NO_CONTENT_SCRIPT';
        throw error;
      },
    });
    await expect(
      orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' })
    ).rejects.toMatchObject({
      code: 'PAGE_ACTION_NO_CONTENT_SCRIPT',
    });
  });

  it('clears the content-script session on the terminal error path via _terminateRun', async () => {
    const clearCalls = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'clearPageActionSession') clearCalls.push(true);
        return { success: true, snapshot: makeSnapshot() };
      },
    });
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });

    orch._terminateRun(runId, { type: 'error', error: 'boom' });

    expect(clearCalls).toHaveLength(1);
    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(orch.activeRuns.has(runId)).toBe(false);
  });

  it('aborts the controller and clears the session when terminating an aborted run', async () => {
    const clearCalls = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'clearPageActionSession') clearCalls.push(true);
        return { success: true, snapshot: makeSnapshot() };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const run = orch.activeRuns.get(runId);

    orch._terminateRun(runId, { type: 'aborted' }, { abortSignal: true });

    expect(run.abortController.signal.aborted).toBe(true);
    expect(clearCalls).toHaveLength(1);
    expect(orch.activeRuns.has(runId)).toBe(false);
  });

  it('emits the terminal event and cleans up when finalizing a completed run', async () => {
    const clearCalls = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'clearPageActionSession') clearCalls.push(true);
        return { success: true, snapshot: makeSnapshot() };
      },
    });
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const run = orch.activeRuns.get(runId);
    run.accumulatedText = 'Done';

    await orch._finalizeTextResponse(run);

    expect(events.some((event) => event.type === 'complete' && event.content === 'Done')).toBe(
      true
    );
    expect(clearCalls).toHaveLength(1);
    expect(orch.activeRuns.has(runId)).toBe(false);
  });

  it('rebinds the run and skips a stale mutation after mid-run navigation', async () => {
    let currentUrl = 'https://example.test/form';
    const executorCalls = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionDocumentProvider: async () => ({ url: currentUrl }),
      pageActionExecutor: async (_tabId, actionName) => {
        executorCalls.push(actionName);
        return {
          success: true,
          snapshot: { ...makeSnapshot(), url: currentUrl },
        };
      },
    });
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });

    await orch.executeTool(runId, makeCall('state-nav', 'page_get_state', {}));
    expect(orch.activeRuns.get(runId).pageActions.documentUrl).toBe('https://example.test/form');

    // The tab navigates mid-run; the stale mutation must not be sent to the
    // new page. The live run adopts the new document and forces inspection.
    currentUrl = 'https://other.test/elsewhere';
    const changed = await orch.executeTool(
      runId,
      makeCall('input-nav', 'page_input', { snapshotId: 'page-snap-1', index: 0, text: 'hi' })
    );
    expect(changed.result.pageChanged).toBe(true);
    expect(changed.result.actionReceipt).toMatchObject({ disposition: 'not_delivered' });
    expect(executorCalls).toEqual(['page_get_state']);
    expect(orch.activeRuns.get(runId).pageActions.documentUrl).toBe('https://other.test/elsewhere');
    expect(orch.activeRuns.get(runId).pageActions.snapshot).toBeNull();
    expect(orch._getEffectiveToolChoice(orch.activeRuns.get(runId))).toBe('auto');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'page_action_warning', code: 'PAGE_ACTION_PAGE_CHANGED' })
    );

    const refreshed = await orch.executeTool(
      runId,
      makeCall('state-after-nav', 'page_get_state', {})
    );
    expect(refreshed.result.snapshot.url).toBe('https://other.test/elsewhere');
    expect(executorCalls).toEqual(['page_get_state', 'page_get_state']);
  });

  it('rebinds when a fresh snapshot reports a different document', async () => {
    let snapUrl = 'https://example.test/form';
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionDocumentProvider: async () => ({ url: snapUrl }),
      pageActionExecutor: async () => ({
        success: true,
        snapshot: { ...makeSnapshot(), url: snapUrl },
      }),
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });

    await orch.executeTool(runId, makeCall('state-a', 'page_get_state', {}));
    snapUrl = 'https://example.test/elsewhere';
    const refreshed = await orch.executeTool(runId, makeCall('state-b', 'page_get_state', {}));
    expect(refreshed.result.snapshot.url).toBe('https://example.test/elsewhere');
    expect(orch.activeRuns.get(runId).pageActions.documentUrl).toBe(
      'https://example.test/elsewhere'
    );
  });

  it('keeps an unexpected navigation unverified and forces a fresh snapshot', async () => {
    let currentUrl = 'https://example.test/form';
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionDocumentProvider: async () => ({ url: currentUrl }),
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') {
          return { success: true, snapshot: { ...makeSnapshot(), url: currentUrl } };
        }
        currentUrl = 'https://other.test/elsewhere';
        return { success: true, navigated: true, navigationUrl: currentUrl };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });

    await orch.executeTool(runId, makeCall('state-unexpected', 'page_get_state', {}));
    const result = await orch.executeTool(
      runId,
      makeCall('input-unexpected', 'page_input', {
        snapshotId: 'page-snap-1',
        index: 0,
        text: 'hi',
      })
    );
    expect(result.result.pageChanged).toBe(true);
    expect(result.result.actionReceipt).toMatchObject({ disposition: 'delivered_unverified' });
    expect(orch.activeRuns.get(runId).pageActions.snapshot).toBeNull();
    expect(orch._getEffectiveToolChoice(orch.activeRuns.get(runId))).toBe('auto');
  });

  it('runs a multi-step page flow beyond the old 3-turn cap when each step succeeds', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName, args) => {
        if (actionName === 'clearPageActionSession') return { success: true };
        return {
          success: true,
          message: `${actionName} done`,
          snapshot: {
            snapshotId: `snap-${actionName}-${args?.index ?? 'x'}`,
            url: 'https://example.test/mail',
            title: 'Mail',
            header: 'Mail app',
            content: '[0] <input label="To">\n[1] <input label="Subject">',
            footer: '',
            elements: [
              { index: 0, tag: 'input', label: 'To', type: 'text', sensitive: false },
              { index: 1, tag: 'input', label: 'Subject', type: 'text', sensitive: false },
            ],
          },
        };
      },
    });
    const events = [];
    orch._emitEvent = (_id, event) => events.push(event);
    global.chrome = { runtime: { sendMessage: async () => {} } };

    const toolCalls = [
      ['call-get-1', 'page_get_state', {}],
      ['call-click', 'page_click', { snapshotId: 'snap-page_get_state-x', index: 1 }],
      [
        'call-input-1',
        'page_input',
        { snapshotId: 'snap-page_click-1', index: 0, text: 'AI and me' },
      ],
      ['call-get-2', 'page_get_state', {}],
      [
        'call-input-2',
        'page_input',
        { snapshotId: 'snap-page_get_state-x', index: 0, text: 'haiku body' },
      ],
    ];
    let callCount = 0;
    global.fetch = async () => {
      callCount += 1;
      let delivered = false;
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              if (delivered) return { done: true, value: undefined };
              delivered = true;
              let delta;
              if (callCount <= toolCalls.length) {
                const [id, name, args] = toolCalls[callCount - 1];
                delta = {
                  tool_calls: [
                    { index: 0, id, function: { name, arguments: JSON.stringify(args) } },
                  ],
                };
              } else {
                delta = { content: 'Email composed.' };
              }
              const data = JSON.stringify({ choices: [{ delta }] });
              return { done: false, value: new TextEncoder().encode(`data: ${data}\n\n`) };
            },
          }),
        },
      };
    };

    try {
      const runId = await orch.startRun({
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test',
        modelName: 'gpt-4o',
        pageActions: true,
        sourceTabId: 7,
        tool_choice: 'auto',
        messages: [{ role: 'user', content: 'Compose an email' }],
      });
      await orch.execute(runId, {});

      const complete = events.find((event) => event.type === 'complete');
      expect(complete?.content).toContain('Email composed');
      expect(events.filter((event) => event.type === 'tool_complete')).toHaveLength(6);
      expect(events.some((event) => event.type === 'error')).toBe(false);
    } finally {
      delete global.chrome;
      delete global.fetch;
    }
  });

  it('serializes state-changing page calls from one provider turn', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7 });
    const run = orch.activeRuns.get(runId);
    const calls = [
      makeCall('first-mutation', 'page_input', { snapshotId: 'initial', index: 0, text: 'query' }),
      makeCall('second-mutation', 'page_select', {
        snapshotId: 'initial',
        index: 1,
        option: '4 stars and up',
      }),
    ];
    run.activeToolCalls = new Map(calls.map((call) => [call.id, call]));
    orch.execute = async () => {};
    let dispatched = 0;
    orch.executeTool = async () => {
      dispatched += 1;
      return {
        success: true,
        result: {
          actionReceipt: { disposition: 'delivered_verified' },
          snapshot: { snapshotId: 'refreshed' },
        },
      };
    };

    await orch._finalizeToolCall(run);

    expect(dispatched).toBe(1);
    const toolResults = run.conversationHistory.filter((message) => message.role === 'tool');
    expect(toolResults).toHaveLength(2);
    expect(toolResults[1].content).toContain('PAGE_ACTION_REFRESH_REQUIRED');
    expect(toolResults[1].content).toContain('current snapshot');
  });

  it('does not count Act denials or undelivered outcomes as failed tool turns', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7 });
    const run = orch.activeRuns.get(runId);
    run.toolCallIterations = 2;
    run.activeToolCall = makeCall('denied-call', 'page_click', {});
    orch.executeTool = async () => ({ success: true, result: { error: 'PAGE_ACTION_DENIED' } });
    orch.execute = async () => {};

    await orch._finalizeToolCall(run);
    expect(run.toolCallIterations).toBe(0);

    run.toolCallIterations = 2;
    run.activeToolCall = makeCall('undelivered-call', 'page_click', {});
    orch.executeTool = async () => ({
      success: true,
      result: {
        error: 'PAGE_STATE_STALE',
        actionReceipt: { disposition: 'not_delivered' },
      },
    });
    await orch._finalizeToolCall(run);
    expect(run.toolCallIterations).toBe(0);
  });

  it('switches an Act run to a no-tools wrap-up after repeated failures', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7 });
    const run = orch.activeRuns.get(runId);
    run.toolCallIterations = 3;
    run.activeToolCall = makeCall('retry-cap', 'page_get_state', {});
    let continuation;
    orch.execute = async (...args) => {
      continuation = args;
    };

    await orch._finalizeToolCall(run);

    expect(run.resilience.wrapUp).toBe(true);
    expect(run.conversationHistory.at(-1).content).toMatch(/Stop using tools/);
    expect(continuation).toEqual([runId, { continueConversation: true }, true]);
  });

  it('finishes an Act run with a final answer after repeated tool failures', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async () => ({ success: true, snapshot: makeSnapshot() }),
    });
    const events = [];
    orch._emitEvent = (_id, event) => events.push(event);
    global.chrome = { runtime: { sendMessage: async () => {} } };

    let callCount = 0;
    global.fetch = async () => {
      callCount += 1;
      let delivered = false;
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              if (delivered) return { done: true, value: undefined };
              delivered = true;
              let delta;
              if (callCount <= 4) {
                delta = {
                  tool_calls: [
                    {
                      index: 0,
                      id: `call-stale-${callCount}`,
                      function: {
                        name: 'unregistered_tool',
                        arguments: JSON.stringify({}),
                      },
                    },
                  ],
                };
              } else {
                delta = { content: 'done' };
              }
              const data = JSON.stringify({ choices: [{ delta }] });
              return { done: false, value: new TextEncoder().encode(`data: ${data}\n\n`) };
            },
          }),
        },
      };
    };

    try {
      const runId = await orch.startRun({
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test',
        modelName: 'gpt-4o',
        pageActions: true,
        sourceTabId: 7,
        tool_choice: 'auto',
        messages: [{ role: 'user', content: 'Fill the form' }],
      });
      await orch.execute(runId, {});
      expect(events.find((event) => event.type === 'complete')?.content).toContain('done');
      expect(events.some((event) => event.type === 'error')).toBe(false);
    } finally {
      delete global.chrome;
      delete global.fetch;
    }
  });

  it('adds a refreshed-snapshot notice to mutation results but not to inspections', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) =>
        actionName === 'page_get_state'
          ? { success: true, snapshot: makeSnapshot() }
          : { success: true, message: 'done', snapshot: makeSnapshot() },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const stateResult = await orch.executeTool(runId, makeCall('state-n', 'page_get_state', {}));
    expect(stateResult.result.notice).toBeUndefined();

    const clickResult = await orch.executeTool(
      runId,
      makeCall('click-n', 'page_input', { snapshotId: 'page-snap-1', index: 0, text: 'hello' })
    );
    expect(clickResult.result.notice).toMatch(/refreshed/);
    expect(clickResult.result.notice).toMatch(/snapshotId/);
  });

  it('keeps observation and mutation budgets independent for long tasks', async () => {
    let pageY = 0;
    const snapshotAtPosition = () => ({
      ...makeSnapshot(),
      fingerprint: `page-position-${pageY}`,
      scroll: { x: 0, y: pageY },
    });
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state')
          return { success: true, snapshot: snapshotAtPosition() };
        pageY += 1;
        return { success: true, snapshot: snapshotAtPosition() };
      },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    for (let index = 0; index < 256; index += 1) {
      const result = await orch.executeTool(
        runId,
        makeCall(`scroll-${index}`, 'page_scroll', { direction: 'down' })
      );
      expect(result.result.error).toBeUndefined();
    }
    const exhausted = await orch.executeTool(
      runId,
      makeCall('scroll-256', 'page_scroll', { direction: 'down' })
    );
    expect(exhausted.result).toMatchObject({ error: 'PAGE_ACTION_LIMIT', budget: 'observation' });
    expect(orch.activeRuns.get(runId).pageActions.budgets.mutation).toBe(0);
  });

  it('nudges the model after three consecutive identical page observations', async () => {
    const stable = {
      ...makeSnapshot(),
      snapshotId: 'page-stable',
      fingerprint: 'stable-fingerprint',
    };
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) =>
        actionName === 'page_get_state'
          ? { success: true, snapshot: stable }
          : { success: true, message: 'clicked' },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const first = await orch.executeTool(runId, makeCall('obs-1', 'page_get_state', {}));
    const second = await orch.executeTool(runId, makeCall('obs-2', 'page_get_state', {}));
    expect(first.result.notice).toBeUndefined();
    expect(second.result.notice).toBeUndefined();
    const third = await orch.executeTool(runId, makeCall('obs-3', 'page_get_state', {}));
    expect(third.result.notice).toMatch(/identical page state three times/);
    expect(third.result.message).toMatch(/identical page state three times/);
  });

  it('resets the identical-observation streak when an action dispatches', async () => {
    const stable = {
      ...makeSnapshot(),
      snapshotId: 'page-stable',
      fingerprint: 'stable-fingerprint',
    };
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) =>
        actionName === 'page_get_state'
          ? { success: true, snapshot: stable }
          : { success: true, message: 'clicked' },
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const run = orch.activeRuns.get(runId);
    run.pageActions.sessionApproval = true;
    await orch.executeTool(runId, makeCall('reset-1', 'page_get_state', {}));
    await orch.executeTool(runId, makeCall('reset-2', 'page_get_state', {}));
    await orch.executeTool(
      runId,
      makeCall('reset-click', 'page_click', { snapshotId: 'page-stable', index: 1 })
    );
    expect(run.pageActions.identicalObservationStreak).toBe(0);
    const afterOne = await orch.executeTool(runId, makeCall('reset-3', 'page_get_state', {}));
    const afterTwo = await orch.executeTool(runId, makeCall('reset-4', 'page_get_state', {}));
    expect(afterOne.result.notice).toBeUndefined();
    expect(afterTwo.result.notice).toBeUndefined();
  });

  it('advertises the planner nudge even when no checklist exists yet', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async () => ({ success: true, snapshot: makeSnapshot() }),
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const run = orch.activeRuns.get(runId);
    run.pageActions.planner = null;
    const prompt = orch._buildSystemPrompt(run, []);
    expect(prompt).toContain('PLAN: If this task takes more than a couple of steps');
    expect(prompt).not.toContain('ACT CHECKLIST');
  });

  it('nudges an inactive checklist toward page_update_plan in the system prompt', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: async () => ({ success: true, snapshot: makeSnapshot() }),
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7, tool_choice: 'auto' });
    const run = orch.activeRuns.get(runId);
    const inactivePrompt = orch._buildSystemPrompt(run, []);
    expect(inactivePrompt).toContain('PLAN: If this task takes more than a couple of steps');
    run.pageActions.planner = {
      ...run.pageActions.planner,
      active: true,
      subGoals: [{ description: 'Search the catalog', status: 'in_progress' }],
    };
    const activePrompt = orch._buildSystemPrompt(run, []);
    expect(activePrompt).not.toContain('PLAN: If this task takes more than a couple of steps');
    expect(activePrompt).toContain('ACT CHECKLIST');
  });
});
