import { describe, expect, it, vi } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';
import {
  buildPlannerPromptBlock,
  createPlannerState,
  extractQuotaTarget,
  recordPlannerQuotaItem,
} from '../src/orchestrator/ActPlanner.js';

const skills = {
  getSkillNames: () => [],
  hasSkill: () => false,
  resolveSkill: () => null,
  getEligibleSnapshot: () => [],
  getSkillsList: () => [],
  getSlashCommands: () => [],
};
const step = (description, status = 'pending') => ({ description, status });
async function setup(instruction = 'Read this page', observation = {}) {
  let version = 0;
  const orchestrator = new RunOrchestrator(skills, {
    pageActionExecutor: async () => ({
      snapshot: {
        snapshotId: `snapshot-${++version}`,
        url: 'https://example.test/form',
        elements: [],
        ...observation,
      },
      actionReceipt: { disposition: 'delivered_verified', evidence: { kind: 'snapshot_captured' } },
    }),
  });
  orchestrator._emitEvent = vi.fn();
  const runId = await orchestrator.startRun({
    pageActions: true,
    sourceTabId: 7,
    messages: [{ role: 'user', content: instruction }],
  });
  let callId = 0;
  const call = (name, args = {}) =>
    orchestrator.executeTool(runId, {
      id: `tool-${++callId}`,
      function: { name, arguments: JSON.stringify(args) },
    });
  return { orchestrator, run: orchestrator.getRun(runId), call };
}

describe('Model-maintained Act checklist', () => {
  it('never invents a checklist or changes consent from the instruction wording', async () => {
    for (const text of [
      'Read this page',
      'Find Guardians of the Galaxy Vol. 3',
      'Open the menu. Select Analytics.',
      'a'.repeat(300),
    ]) {
      const { run, orchestrator } = await setup(text);
      expect(run.pageActions.planner?.subGoals || []).toEqual([]);
      expect(run.pageActions.sessionApproval).toBe(false);
      expect(orchestrator._buildPageTaskProgressEvent(run).hasPlanner).toBe(false);
    }
  });

  it('records a model checklist, bounds it, and leaves note taking separate from progress', async () => {
    const { run, call, orchestrator } = await setup();
    await call('page_get_state');
    expect(
      (
        await call('page_update_plan', {
          steps: [step('Inspect', 'in_progress'), step('Read results')],
        })
      ).result.updated
    ).toBe(true);
    expect(run.pageActions.planner.subGoals).toHaveLength(2);
    expect(run.pageActions.planner.autoApproval).toBeUndefined();
    await call('page_record_note', { text: 'The inspection is now complete.' });
    expect(run.pageActions.planner.subGoals[0].status).toBe('in_progress');
    expect(orchestrator._buildPageTaskProgressEvent(run).steps[0]).toMatchObject({
      label: 'Inspect',
      status: 'current',
    });
    expect(buildPlannerPromptBlock(run.pageActions.planner)).toContain('page_update_plan');
  });

  it('requires new observed evidence for completion and never consumes it twice', async () => {
    const { run, call } = await setup();
    await call('page_get_state');
    await call('page_update_plan', {
      steps: [step('Inspect', 'in_progress'), step('Read results')],
    });
    const next = { steps: [step('Inspect', 'completed'), step('Read results', 'in_progress')] };
    expect((await call('page_update_plan', next)).result.error).toBe('PAGE_PLAN_EVIDENCE_REQUIRED');
    await call('page_get_state');
    expect((await call('page_update_plan', next)).result.updated).toBe(true);
    expect(run.pageActions.planner.currentSubGoalIndex).toBe(1);
    expect(
      (
        await call('page_update_plan', {
          steps: [step('Inspect', 'completed'), step('Read results', 'completed')],
        })
      ).result.error
    ).toBe('PAGE_PLAN_EVIDENCE_REQUIRED');
    await call('page_get_state');
    expect(
      (
        await call('page_update_plan', {
          steps: [step('Inspect', 'completed'), step('Read results', 'completed')],
        })
      ).result.updated
    ).toBe(true);
    expect(run.pageActions.planner.completedAt).toBeTruthy();
    expect(run.pageActions.finalVerificationCompleted).toBe(false);
    await call('page_get_state');
    expect(run.pageActions.finalVerificationCompleted).toBe(true);
  });

  it('rejects invalid checklist shapes, lengths, statuses, and ambiguous active steps atomically', async () => {
    const { run, call } = await setup();
    const invalid = [
      [],
      [step('Inspect')],
      [step('Inspect', 'in_progress'), step('Read', 'in_progress')],
      [step('Inspect', 'done')],
      [step('x'.repeat(201), 'in_progress')],
      [step('API key contents', 'in_progress')],
      Array.from({ length: 13 }, (_, index) =>
        step(`Step ${index}`, index === 0 ? 'in_progress' : 'pending')
      ),
    ];
    for (const steps of invalid) {
      expect((await call('page_update_plan', { steps })).result.error).toBe('PAGE_PLAN_INVALID');
      expect(run.pageActions.planner?.subGoals || []).toEqual([]);
    }
  });

  it('allows five bounded revisions before refusing another replacement', async () => {
    const { run, call } = await setup();
    await call('page_update_plan', { steps: [step('Inspect', 'in_progress')] });
    for (let index = 0; index < 5; index++) {
      expect(
        (await call('page_update_plan', { steps: [step(`Inspect ${index}`, 'in_progress')] }))
          .result.updated
      ).toBe(true);
    }
    expect(run.pageActions.planner.replanCount).toBe(5);
    expect(
      (await call('page_update_plan', { steps: [step('Another revision', 'in_progress')] })).result
        .error
    ).toBe('PAGE_PLAN_LIMIT');
  });

  it('finishes a simple observed read without an invented unfinished-steps warning', async () => {
    const { run, call, orchestrator } = await setup();
    await call('page_get_state');
    run.accumulatedText = 'The requested page was read.';
    await orchestrator._finalizeTextResponse(run);
    const event = orchestrator._emitEvent.mock.calls
      .map(([, event]) => event)
      .find((event) => event.type === 'complete');
    expect(event.content).not.toContain('Act task incomplete');
    expect(event.actOutcome).toEqual({ status: 'done', reason: null });
    expect(orchestrator._buildPageTaskProgressEvent(run).outcome.taskComplete).toBe(true);
  });

  it('does not invent counted work from durations or unquantified all requests', async () => {
    for (const instruction of [
      'Read this page in 2 seconds',
      'Read all paragraphs on this page',
      'Read the gpt-5 release notes',
      'Read one page of notes',
    ]) {
      const { orchestrator, run, call } = await setup(instruction);
      await call('page_get_state');
      run.accumulatedText = 'The page was read.';
      await orchestrator._finalizeTextResponse(run);
      expect(
        orchestrator._emitEvent.mock.calls
          .map(([, event]) => event)
          .find((event) => event.type === 'complete').actOutcome
      ).toEqual({ status: 'done', reason: null });
    }
  });

  it('continues unresolved explicit plans without interpreting keywords in notes', async () => {
    const { run, call, orchestrator } = await setup();
    await call('page_update_plan', { steps: [step('Inspect', 'in_progress')] });
    run.accumulatedText = 'Started.';
    orchestrator.execute = vi.fn(async () => {});
    await orchestrator._finalizeTextResponse(run);
    expect(orchestrator.execute).toHaveBeenCalledWith(run.id, { continueConversation: true }, true);
  });

  it('derives bounded terminal reasons from actual run state, never answer claims', async () => {
    for (const [state, expected] of [
      [
        { lastDeniedAction: { action: 'page_click', at: 1 } },
        { status: 'blocked', reason: 'declined' },
      ],
      [
        { lastDeniedAction: { action: 'page_click', at: 1 }, confirmationTimedOut: true },
        { status: 'blocked', reason: 'needs_confirmation' },
      ],
      [{ lastBlockReason: 'site_blocked' }, { status: 'blocked', reason: 'site_blocked' }],
      [{ lastBlockReason: 'loop_detected' }, { status: 'failed', reason: 'loop_detected' }],
      [
        {
          lastActionReceipt: { disposition: 'delivered_unverified' },
          reverifiedAfterUnverified: false,
        },
        { status: 'failed', reason: 'ambiguous' },
      ],
    ]) {
      const { orchestrator, run, call } = await setup();
      await call('page_get_state');
      Object.assign(run.pageActions, state);
      run.accumulatedText = 'Everything is done.';
      await orchestrator._finalizeTextResponse(run);
      expect(
        orchestrator._emitEvent.mock.calls
          .map(([, event]) => event)
          .find((event) => event.type === 'complete').actOutcome
      ).toEqual(expected);
    }
  });

  it('does not turn a declined mutation into success after reinspection', async () => {
    const { orchestrator, run, call } = await setup('Fill this field', {
      elements: [{ index: 0, tag: 'input', label: 'City', editable: true, visible: true }],
    });
    await call('page_get_state');
    const action = call('page_input', {
      snapshotId: run.pageActions.snapshot.snapshotId,
      index: 0,
      text: 'Public city',
    });
    await vi.waitFor(() => expect(run.pageActions.pendingConfirmation).toBeTruthy());
    orchestrator.resolvePageActionDecision(run.id, run.pageActions.pendingConfirmation.id, false);
    expect((await action).result.error).toBe('PAGE_ACTION_DENIED');
    await call('page_get_state');
    run.accumulatedText = 'All done.';
    await orchestrator._finalizeTextResponse(run);
    expect(
      orchestrator._emitEvent.mock.calls
        .map(([, event]) => event)
        .find((event) => event.type === 'complete').actOutcome
    ).toEqual({ status: 'blocked', reason: 'declined' });
  });

  it('reports skipped requirements as incomplete rather than done', async () => {
    const { orchestrator, run, call } = await setup();
    await call('page_get_state');
    await call('page_update_plan', { steps: [step('Cannot finish this requirement', 'skipped')] });
    await call('page_get_state');
    run.accumulatedText = 'All done.';
    await orchestrator._finalizeTextResponse(run);
    expect(
      orchestrator._emitEvent.mock.calls
        .map(([, event]) => event)
        .find((event) => event.type === 'complete').actOutcome
    ).toEqual({ status: 'failed', reason: 'ambiguous' });
  });

  it('classifies manual blockers from observed page signals instead of the question', async () => {
    for (const [observation, reason] of [
      [
        {
          elements: [
            { index: 0, tag: 'input', type: 'password', visible: true },
            { index: 1, tag: 'button', label: 'Sign in', visible: true },
          ],
        },
        'sign_in_required',
      ],
      [{ observationFormat: 'outline', content: 'CAPTCHA: Verify you are human' }, 'captcha'],
    ]) {
      const { orchestrator, run, call } = await setup('Read this page', observation);
      await call('page_get_state');
      const pending = call('page_pause_for_user', {
        question: 'Complete the safe manual step on the target page.',
      }).catch((error) => error);
      await vi.waitFor(() => expect(run.pageActions.pendingManualIntervention).toBeTruthy());
      orchestrator._terminateRun(run.id, { type: 'aborted' });
      expect((await pending).name).toBe('AbortError');
      expect(
        orchestrator._emitEvent.mock.calls
          .map(([, event]) => event)
          .find((event) => event.type === 'aborted').actOutcome
      ).toEqual({ status: 'blocked', reason });
    }
  });

  it('retains bounded counted-request quotas and deduplicated item records', () => {
    expect(extractQuotaTarget('Open 99 records')).toBe(12);
    expect(extractQuotaTarget('Use pagination to reach page 2 on this local page.')).toBeNull();
    const planner = createPlannerState('Open 2 of the newest emails');
    expect(planner.quota).toEqual({ target: 2, done: [] });
    expect(recordPlannerQuotaItem(planner, 'Subject A')).toMatchObject({ added: true, count: 1 });
    expect(recordPlannerQuotaItem(planner, ' subject   a ')).toMatchObject({
      added: false,
      count: 1,
    });
    expect(recordPlannerQuotaItem(planner, 'Subject B')).toMatchObject({ added: true, count: 2 });
    expect(recordPlannerQuotaItem(planner, 'Subject C')).toMatchObject({ added: false, count: 2 });
  });
});
