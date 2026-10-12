/**
 * @fileoverview Regression coverage for the pre-dispatch occlusion gate: a
 * covered target must be reported as not_delivered, must not consume a mutation
 * budget slot, and must never drive the no-progress mutation lockout.
 * @module pageActionOcclusion
 */

import { describe, expect, it } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';

function skillManager() {
  return {
    resolveSkill: () => null,
    getEligibleSnapshot: () => [],
    getSkillsList: () => [],
    getSlashCommands: () => [],
    hasSkill: () => false,
    getSkillNames: () => [],
    getSkillContent: () => null,
  };
}

const OCCLUDER = Object.freeze({
  index: 3,
  tag: 'div',
  role: 'dialog',
  label: 'Sign in to continue',
});

/** Build the failure the content script raises for a covered click target. */
function occlusionError() {
  const error = new Error(
    'The target is covered by another element, so the click was not delivered.'
  );
  error.code = 'PAGE_ACTION_TARGET_OCCLUDED';
  error.preDispatch = true;
  error.occluder = { ...OCCLUDER };
  return error;
}

function formSnapshot() {
  return {
    snapshotId: 'snap-1',
    url: 'https://example.test/form',
    title: 'Example form',
    header: 'Current page',
    content: '[0] <button> Save draft',
    footer: 'End of page.',
    fingerprint: 'fp-1',
    elements: [
      { index: 0, tag: 'button', label: 'Save draft', text: 'Save draft', sensitive: false },
    ],
    scroll: { x: 0, y: 0 },
  };
}

/**
 * Start a run with one indexed clickable control and an executor that reports
 * the target as covered. Session approval is granted so the test exercises the
 * delivery path rather than the confirmation card.
 * @returns {Promise<{orchestrator: object, runId: string, run: object, events: Array}>}
 */
async function startOccludedRun() {
  const events = [];
  const orchestrator = new RunOrchestrator(skillManager(), {
    pageActionPolicyProvider: async () => true,
    pageActionExecutor: async (_tabId, actionName) => {
      if (actionName === 'page_get_state') return { success: true, snapshot: formSnapshot() };
      throw occlusionError();
    },
  });
  orchestrator._emitEvent = (_runId, event) => events.push(event);
  const runId = await orchestrator.startRun({
    pageActions: true,
    sourceTabId: 7,
    profileId: 'default',
    provider: 'api',
    messages: [{ role: 'user', content: 'Click the save draft button.' }],
  });
  const run = orchestrator.getRun(runId);
  run.pageActions.sessionApproval = true;
  await orchestrator.executeTool(runId, {
    id: 'state-1',
    function: { name: 'page_get_state', arguments: '{}' },
  });
  return { orchestrator, runId, run, events };
}

/** Issue a click against the current snapshot's only indexed control. */
function clickTarget(orchestrator, runId, run, id) {
  return orchestrator.executeTool(runId, {
    id,
    function: {
      name: 'page_click',
      arguments: JSON.stringify({ snapshotId: run.pageActions.snapshot.snapshotId, index: 0 }),
    },
  });
}

describe('pre-dispatch occlusion gate', () => {
  it('reports the occluder and records not_delivered without charging the mutation budget', async () => {
    const { orchestrator, runId, run, events } = await startOccludedRun();
    const mutationBudgetBefore = run.pageActions.budgets.mutation;
    const actionsBefore = run.pageActions.actions;
    const noProgressBefore = run.pageActions.noProgressMutationCount;

    const outcome = await clickTarget(orchestrator, runId, run, 'click-1');
    const result = outcome.result;

    expect(result.error).toBe('PAGE_ACTION_TARGET_OCCLUDED');
    expect(result.actionReceipt).toMatchObject({
      disposition: 'not_delivered',
      evidence: { kind: 'pre_dispatch_blocked', code: 'PAGE_ACTION_TARGET_OCCLUDED' },
    });
    expect(result.occluder).toMatchObject({
      index: OCCLUDER.index,
      role: OCCLUDER.role,
      label: OCCLUDER.label,
    });
    // The message names the covering control and the suggestion says waiting
    // alone will not help, so the model can clear the cover instead of retrying.
    expect(result.message).toContain('Sign in to continue');
    expect(result.suggestion).toMatch(/dismiss/i);

    // Nothing reached the page, so the run is not charged for the attempt.
    expect(run.pageActions.budgets.mutation).toBe(mutationBudgetBefore);
    expect(run.pageActions.actions).toBe(actionsBefore);
    expect(run.pageActions.noProgressMutationCount).toBe(noProgressBefore);

    const warning = events.find(
      (event) =>
        event.type === 'page_action_warning' && event.code === 'PAGE_ACTION_TARGET_OCCLUDED'
    );
    expect(warning).toBeTruthy();
    expect(warning.occluder).toMatchObject({ index: OCCLUDER.index });
  });

  it('does not trip the no-progress mutation lockout after three occluded clicks', async () => {
    const { orchestrator, runId, run, events } = await startOccludedRun();

    for (const id of ['click-1', 'click-2']) {
      const outcome = await clickTarget(orchestrator, runId, run, id);
      expect(outcome.result.error).toBe('PAGE_ACTION_TARGET_OCCLUDED');
      expect(outcome.result.actionReceipt.disposition).toBe('not_delivered');
    }
    // A third consecutive occlusion of the same covered target redirects the
    // model to another strategy instead of allowing an unbounded retry loop.
    // The redirect is still not_delivered and stays outside the lockout guards.
    const redirected = await clickTarget(orchestrator, runId, run, 'click-3');
    expect(redirected.result.error).toBe('PAGE_ACTION_OCCLUDED_REPEATED');
    expect(redirected.result.actionReceipt).toMatchObject({
      disposition: 'not_delivered',
      evidence: { kind: 'occluded_target_repeated' },
    });

    expect(run.pageActions.noProgressMutationCount).toBe(0);
    expect(run.pageActions.budgets.mutation).toBe(0);
    expect(
      events.some(
        (event) => event.type === 'page_action_warning' && event.code === 'PAGE_ACTION_NO_PROGRESS'
      )
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'page_action_warning' && event.code === 'PAGE_ACTION_LOOP_DETECTED'
      )
    ).toBe(false);
  });

  it('charges a delivered mutation but resets the no-progress streak when the page changes', async () => {
    // Only pre-dispatch failures refund a slot; a delivered mutation stays charged.
    // A changed fingerprint counts as progress even when delivery is unverified.
    const orchestrator = new RunOrchestrator(skillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionExecutor: async (_tabId, actionName) => {
        if (actionName === 'page_get_state') return { success: true, snapshot: formSnapshot() };
        return {
          success: true,
          snapshot: { ...formSnapshot(), snapshotId: 'snap-2', fingerprint: 'fp-2' },
          actionReceipt: {
            disposition: 'delivered_unverified',
            evidence: { kind: 'action_dispatched' },
          },
        };
      },
    });
    orchestrator._emitEvent = () => {};
    const runId = await orchestrator.startRun({
      pageActions: true,
      sourceTabId: 7,
      profileId: 'default',
      provider: 'api',
      messages: [{ role: 'user', content: 'Click the save draft button.' }],
    });
    const run = orchestrator.getRun(runId);
    run.pageActions.sessionApproval = true;
    await orchestrator.executeTool(runId, {
      id: 'state-1',
      function: { name: 'page_get_state', arguments: '{}' },
    });

    const outcome = await clickTarget(orchestrator, runId, run, 'click-1');

    expect(outcome.result.actionReceipt.disposition).toBe('delivered_unverified');
    expect(run.pageActions.budgets.mutation).toBe(1);
    expect(run.pageActions.noProgressMutationCount).toBe(0);
  });
});
