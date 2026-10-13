/**
 * @fileoverview Evaluation message-hook contract tests.
 * @module evalHookTest
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerEvalRunHook } from '../src/utils/evalHook.eval.js';
import {
  beginEvalTrace,
  clearEvalTrace,
  getEvalTrace,
  recordEvalTrace,
} from '../src/utils/evalTrace.eval.js';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';

vi.mock('../src/utils/evalTrace.js', async () => import('../src/utils/evalTrace.eval.js'));

afterEach(() => {
  delete globalThis.chrome;
});

function skillManager() {
  return {
    resolveSkill: () => null,
    getEligibleSnapshot: () => [],
    getSkillsList: () => [],
    getSlashCommands: () => [],
    hasSkill: () => false,
    getSkillNames: () => [],
  };
}

describe('evaluation run hook', () => {
  it('returns structured acceptance and emits a terminal result', async () => {
    const listeners = [];
    const messages = [];
    const startedConfigs = [];
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: (listener) => listeners.push(listener) },
        sendMessage: async (message) => messages.push(message),
      },
    };
    const runOrchestrator = {
      startRun: async (config) => {
        startedConfigs.push(config);
        return 'run-1';
      },
      execute: async () => undefined,
    };

    registerEvalRunHook({
      getExtensionOrigin: () => 'chrome-extension://eval',
      isExtensionSender: () => true,
      resolveStoredRunConfig: async (config) => config,
      runOrchestrator,
      createOwnerToken: () => 'owner-1',
    });

    const response = await new Promise((resolve) => {
      listeners[0](
        {
          action: 'TEST_RUN_TASK',
          taskId: 'public-task',
          task: 'Complete the public fixture task.',
          profileId: 'eval-profile',
          sourceTabId: 7,
          taskMode: 'mind2web',
          temperature: 0,
          dryRun: true,
        },
        { url: 'chrome-extension://eval/bridge.html' },
        resolve
      );
    });
    expect(startedConfigs[0]).toMatchObject({
      evalTaskMode: 'mind2web',
      evalTemperature: 0,
      evalDryRun: true,
    });

    expect(response).toMatchObject({
      success: true,
      accepted: true,
      taskId: 'public-task',
      runId: 'run-1',
      sourceTabId: 7,
      dryRun: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(messages).toContainEqual(
      expect.objectContaining({
        action: 'TEST_RUN_TASK_RESULT',
        taskId: 'public-task',
        runId: 'run-1',
      })
    );
  });

  it('rejects non-extension senders and malformed tasks', async () => {
    const listeners = [];
    globalThis.chrome = {
      runtime: { onMessage: { addListener: (listener) => listeners.push(listener) } },
    };
    registerEvalRunHook({
      getExtensionOrigin: () => 'chrome-extension://eval',
      isExtensionSender: () => false,
      runOrchestrator: { startRun: async () => 'unused' },
      resolveStoredRunConfig: async () => ({}),
      createOwnerToken: () => 'unused',
    });

    const response = await new Promise((resolve) => {
      listeners[0]({ action: 'TEST_RUN_TASK', taskId: 'bad task' }, {}, resolve);
    });
    expect(response).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
  });

  it('returns a bounded in-progress trace only to authorized extension senders without starting a run', () => {
    const listeners = [];
    let starts = 0;
    let providerCalls = 0;
    globalThis.chrome = {
      runtime: { onMessage: { addListener: (listener) => listeners.push(listener) } },
    };
    beginEvalTrace({ runId: 'trace-read-only', taskId: 'trace-task', task: 'Inspect only.' });
    recordEvalTrace('trace-read-only', { kind: 'provider_request', providerCallIndex: 1 });
    registerEvalRunHook({
      getExtensionOrigin: () => 'chrome-extension://eval',
      isExtensionSender: (sender) => sender?.authorized === true,
      resolveStoredRunConfig: async () => ({}),
      runOrchestrator: {
        startRun: async () => (starts += 1),
        execute: async () => {
          providerCalls += 1;
        },
      },
      createOwnerToken: () => 'unused',
    });
    const send = (request, sender) =>
      new Promise((resolve) => listeners[0](request, sender, resolve));

    return Promise.all([
      send({ action: 'TEST_GET_TRACE', runId: 'trace-read-only' }, { authorized: false }),
      send({ action: 'TEST_GET_TRACE', runId: 'bad run id' }, { authorized: true }),
    ]).then(async ([unauthorized, malformed]) => {
      expect(unauthorized).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
      expect(malformed).toMatchObject({ success: false, code: 'EVAL_TASK_INVALID' });

      const valid = await send(
        { action: 'TEST_GET_TRACE', runId: 'trace-read-only' },
        { authorized: true }
      );
      expect(valid).toMatchObject({
        success: true,
        trace: { runId: 'trace-read-only', steps: [{ kind: 'provider_request' }] },
      });
      expect(starts).toBe(0);
      expect(providerCalls).toBe(0);
      clearEvalTrace('trace-read-only');
    });
  });

  it('aborts a Mind2Web dry run at the first proposed mutation before any follow-up provider call', async () => {
    const listeners = [];
    const messages = [];
    let providerCalls = 0;
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: (listener) => listeners.push(listener) },
        sendMessage: async (message) => messages.push(message),
      },
    };
    const runOrchestrator = new RunOrchestrator(skillManager(), {
      pageActionExecutor: async () => ({
        success: true,
        snapshot: {
          snapshotId: 'initial-page-state',
          url: 'https://fixture.test/task',
          title: 'Public fixture',
          elements: [],
        },
      }),
    });
    runOrchestrator._emitEvent = () => {};
    runOrchestrator.abort = async () => {
      throw new Error('stop was rejected');
    };
    runOrchestrator._executeOpenAI = async (run) => {
      providerCalls += 1;
      run.activeToolCall = {
        id: 'first-proposed-action',
        function: { name: 'page_click', arguments: '{malformed proposal' },
      };
      await runOrchestrator._finalizeToolCall(run);
    };
    registerEvalRunHook({
      getExtensionOrigin: () => 'chrome-extension://eval',
      isExtensionSender: () => true,
      resolveStoredRunConfig: async (config) => ({
        ...config,
        provider: 'api',
        llmEndpoint: 'https://fixture.test/v1/chat/completions',
        apiKey: 'local-test-credential',
        modelName: 'fixture-model',
      }),
      runOrchestrator,
      createOwnerToken: () => 'owner-mind2web',
    });

    const response = await new Promise((resolve) => {
      listeners[0](
        {
          action: 'TEST_RUN_TASK',
          taskId: 'first-action-task',
          task: 'Click the requested control.',
          profileId: 'eval-profile',
          sourceTabId: 7,
          taskMode: 'mind2web',
          dryRun: true,
        },
        { url: 'chrome-extension://eval/bridge.html' },
        resolve
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response).toMatchObject({ success: true, accepted: true });
    expect(providerCalls).toBe(1);
    expect(messages[0].result).toMatchObject({
      measurement: { predictionCaptured: true, terminalReason: 'prediction_captured' },
      terminal: { type: 'aborted' },
    });
    expect(messages[0].result.terminal.content).toBeUndefined();
    expect(messages[0].result.steps.some((step) => step.kind === 'abort_error')).toBe(true);
    expect(runOrchestrator.activeRuns.has(response.runId)).toBe(false);
    clearEvalTrace(response.runId);
  });

  it('keeps a regular fixture dry run on its existing multi-turn path', async () => {
    const listeners = [];
    let aborted = false;
    let providerCalls = 0;
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: (listener) => listeners.push(listener) },
        sendMessage: async () => undefined,
      },
    };
    registerEvalRunHook({
      getExtensionOrigin: () => 'chrome-extension://eval',
      isExtensionSender: () => true,
      resolveStoredRunConfig: async (config) => config,
      runOrchestrator: {
        startRun: async () => 'fixture-dry-run',
        abort: async () => {
          aborted = true;
        },
        execute: async (runId) => {
          providerCalls += 1;
          recordEvalTrace(runId, {
            kind: 'action',
            action: { function: { name: 'page_click', arguments: '{}' } },
            actionResult: { success: false, error: 'invalid proposal' },
          });
          providerCalls += 1;
        },
      },
      createOwnerToken: () => 'owner-fixture',
    });

    await new Promise((resolve) => {
      listeners[0](
        {
          action: 'TEST_RUN_TASK',
          taskId: 'fixture-task',
          task: 'Read the fixture.',
          profileId: 'eval-profile',
          sourceTabId: 7,
          dryRun: true,
        },
        { url: 'chrome-extension://eval/bridge.html' },
        resolve
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(providerCalls).toBe(2);
    expect(getEvalTrace('fixture-dry-run').measurement).toMatchObject({
      predictionCaptured: true,
      terminalReason: null,
      cleanupTimeMs: expect.any(Number),
    });
    expect(aborted).toBe(false);
    expect(getEvalTrace('fixture-dry-run').terminal.type).toBe('complete');
    clearEvalTrace('fixture-dry-run');
  });

  it('surfaces a rejected Mind2Web abort instead of reporting a captured prediction as stopped', async () => {
    const listeners = [];
    const messages = [];
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: (listener) => listeners.push(listener) },
        sendMessage: async (message) => messages.push(message),
      },
    };
    registerEvalRunHook({
      getExtensionOrigin: () => 'chrome-extension://eval',
      isExtensionSender: () => true,
      resolveStoredRunConfig: async (config) => config,
      runOrchestrator: {
        startRun: async () => 'abort-rejected-run',
        abort: async () => {
          throw new Error('stop was rejected');
        },
        execute: async (runId) => {
          recordEvalTrace(runId, {
            kind: 'action',
            action: { function: { name: 'page_click', arguments: '{invalid' } },
          });
        },
      },
      createOwnerToken: () => 'owner-abort-rejected',
    });

    await new Promise((resolve) => {
      listeners[0](
        {
          action: 'TEST_RUN_TASK',
          taskId: 'abort-rejected-task',
          task: 'Click the requested control.',
          profileId: 'eval-profile',
          sourceTabId: 7,
          taskMode: 'mind2web',
          dryRun: true,
        },
        { url: 'chrome-extension://eval/bridge.html' },
        resolve
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(messages[0].result.terminal).toMatchObject({
      type: 'abort_error',
      error: 'stop was rejected',
    });
    expect(messages[0].result.steps.some((step) => step.kind === 'abort_error')).toBe(true);
    clearEvalTrace('abort-rejected-run');
  });

  it('runs provider-free page inspection through the saved-profile Act path and always aborts', async () => {
    const listeners = [];
    const starts = [];
    const toolCalls = [];
    let providerCalls = 0;
    let abortCalls = 0;
    const messages = [];
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: (listener) => listeners.push(listener) },
        sendMessage: async (message) => messages.push(message),
      },
      storage: { local: { get: async () => ({ pageActionsPreciseInput: false }) } },
    };
    registerEvalRunHook({
      getExtensionOrigin: () => 'chrome-extension://eval',
      isExtensionSender: () => true,
      resolveStoredRunConfig: async (config) => {
        starts.push(config);
        return config;
      },
      runOrchestrator: {
        startRun: async (config) => {
          starts.push(config);
          return 'inspect-run';
        },
        execute: async () => {
          providerCalls += 1;
        },
        executeTool: async (runId, toolCall) => {
          toolCalls.push({ runId, toolCall });
          return { success: true, result: { snapshot: { content: 'Observed page' } } };
        },
        abort: async () => {
          abortCalls += 1;
        },
      },
      createOwnerToken: () => 'owner-inspect',
    });

    const response = await new Promise((resolve) => {
      listeners[0](
        {
          action: 'TEST_INSPECT_PAGE',
          taskId: 'inspect-task',
          task: 'Preflight the active page.',
          profileId: 'saved-inert-profile',
          sourceTabId: 11,
        },
        { url: 'chrome-extension://eval/bridge.html' },
        resolve
      );
    });

    expect(response.success).toBe(true);
    expect(response.trace.steps[0]).toMatchObject({
      kind: 'action',
      action_taken: { function: { name: 'page_get_state' } },
    });
    expect(starts[0]).toMatchObject({
      profileId: 'saved-inert-profile',
      sourceTabId: 11,
      pageActions: true,
      evalTaskMode: 'mind2web',
    });
    expect(toolCalls).toHaveLength(1);
    expect(abortCalls).toBe(1);
    expect(providerCalls).toBe(0);
    expect(messages).toEqual([]);
    clearEvalTrace('inspect-run');
  });

  it('returns an actionable failure when preflight inspection cannot produce a snapshot', async () => {
    const listeners = [];
    let abortCalls = 0;
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: (listener) => listeners.push(listener) },
      },
      storage: { local: { get: async () => ({}) } },
    };
    registerEvalRunHook({
      getExtensionOrigin: () => 'chrome-extension://eval',
      isExtensionSender: () => true,
      resolveStoredRunConfig: async (config) => config,
      runOrchestrator: {
        startRun: async () => 'inspect-failure-run',
        executeTool: async () => ({
          success: true,
          result: { error: 'PAGE_ACTION_SITE_BLOCKED', message: 'This site is blocked.' },
        }),
        abort: async () => {
          abortCalls += 1;
        },
      },
      createOwnerToken: () => 'owner-inspect-failure',
    });

    const response = await new Promise((resolve) => {
      listeners[0](
        {
          action: 'TEST_INSPECT_PAGE',
          taskId: 'inspect-failure-task',
          task: 'Preflight the active page.',
          profileId: 'saved-inert-profile',
          sourceTabId: 11,
        },
        { url: 'chrome-extension://eval/bridge.html' },
        resolve
      );
    });

    expect(response).toMatchObject({ success: false, error: 'This site is blocked.' });
    expect(abortCalls).toBe(1);
    expect(getEvalTrace('inspect-failure-run').terminal).toMatchObject({ type: 'error' });
    clearEvalTrace('inspect-failure-run');
  });
});
