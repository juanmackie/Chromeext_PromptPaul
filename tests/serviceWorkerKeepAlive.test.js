import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';

describe('executing run worker lifetime', () => {
  let orch;
  let getPlatformInfo;

  beforeEach(() => {
    vi.useFakeTimers();
    getPlatformInfo = vi.fn().mockResolvedValue({ os: 'win' });
    vi.stubGlobal('chrome', { runtime: { getPlatformInfo, sendMessage: async () => {} } });
    orch = new RunOrchestrator({ getEligibleSnapshot: () => [], getSkillNames: () => [] });
    orch._buildTools = async () => [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function startWaitingRun(waiting = 'clarification', nested = false) {
    const runId = await orch.startRun({ pageActions: true, sourceTabId: 7 });
    let continued = false;
    orch._executeOpenAI = async (run) => {
      if (nested && !continued) {
        continued = true;
        return orch.execute(run.id, {}, true);
      }
      const toolCall = {
        function: { arguments: JSON.stringify({ question: 'Which greeting should I use?' }) },
      };
      if (waiting === 'approval') {
        await orch._requestPageActionConfirmation(
          run,
          'page_input',
          { text: 'Hello' },
          { label: 'Greeting', tag: 'input' },
          { risk: 'low', reason: 'Confirm the greeting.' }
        );
      } else if (waiting === 'manual') {
        run.pageActions.snapshot = { url: 'https://example.test/', title: 'Greeting fixture' };
        await orch._executePageManualIntervention(run.id, toolCall);
      } else {
        await orch._executePageUserInput(run.id, toolCall);
      }
      run.accumulatedText = 'Greeting selected.';
      await orch._finalizeTextResponse(run);
    };
    const execution = orch.execute(runId, { messages: [{ role: 'user', content: 'Greet me.' }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(orch.getRun(runId)?.pageActions).toBeTruthy();
    return { runId, execution };
  }

  function resolveWait(runId, waiting = 'clarification') {
    const state = orch.getRun(runId).pageActions;
    if (waiting === 'approval') {
      return orch.resolvePageActionDecision(runId, state.pendingConfirmation.id, true);
    }
    if (waiting === 'manual') {
      return orch.resolvePageManualIntervention(runId, state.pendingManualIntervention.id, true);
    }
    return orch.resolvePageUserInput(runId, state.pendingUserInput.id, 'Hello');
  }

  it.each(['clarification', 'approval', 'manual'])(
    'keeps a pending %s alive and releases the worker after the decision',
    async (waiting) => {
      const { runId, execution } = await startWaitingRun(waiting);
      await vi.advanceTimersByTimeAsync(40_000);
      expect(getPlatformInfo).toHaveBeenCalled();
      expect(resolveWait(runId, waiting)).toBe(true);
      await execution;
      const callsAtCompletion = getPlatformInfo.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getPlatformInfo).toHaveBeenCalledTimes(callsAtCompletion);
      expect(orch.getRun(runId)).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('keeps concurrent runs independent when one completes', async () => {
    const first = await startWaitingRun();
    const second = await startWaitingRun();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(2);
    resolveWait(first.runId);
    await first.execution;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(3);
    resolveWait(second.runId);
    await second.execution;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares one heartbeat across nested tool continuations', async () => {
    const { runId, execution } = await startWaitingRun('clarification', true);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(2);
    resolveWait(runId);
    await execution;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the user decision usable if a heartbeat API call fails', async () => {
    getPlatformInfo.mockRejectedValue(new Error('Runtime temporarily unavailable'));
    const { runId, execution } = await startWaitingRun();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(resolveWait(runId)).toBe(true);
    await execution;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the worker when Stop aborts a pending question', async () => {
    const { runId, execution } = await startWaitingRun();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getPlatformInfo).toHaveBeenCalled();
    await orch.abort(runId);
    await execution;
    const callsAtStop = getPlatformInfo.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(callsAtStop);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the worker after provider failure', async () => {
    orch._executeOpenAI = async () => {
      await new Promise((resolve) => setTimeout(resolve, 40_000));
      throw new Error('Invalid fixture request');
    };
    const runId = await orch.startRun({});
    const failure = expect(orch.execute(runId, {})).rejects.toThrow('Invalid fixture request');
    await vi.advanceTimersByTimeAsync(40_000);
    await failure;
    expect(getPlatformInfo).toHaveBeenCalled();
    const callsAtFailure = getPlatformInfo.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(callsAtFailure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not keep an unexecuted run or an idle worker alive', async () => {
    await orch.startRun({});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getPlatformInfo).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
