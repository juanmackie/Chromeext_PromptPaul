/**
 * @fileoverview Evaluation message-hook contract tests.
 * @module evalHookTest
 */

import { afterEach, describe, expect, it } from 'vitest';
import { registerEvalRunHook } from '../src/utils/evalHook.eval.js';

afterEach(() => {
  delete globalThis.chrome;
});

describe('evaluation run hook', () => {
  it('returns structured acceptance and emits a terminal result', async () => {
    const listeners = [];
    const messages = [];
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: (listener) => listeners.push(listener) },
        sendMessage: async (message) => messages.push(message),
      },
    };
    const runOrchestrator = {
      startRun: async () => 'run-1',
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
          dryRun: true,
        },
        { url: 'chrome-extension://eval/bridge.html' },
        resolve
      );
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
});
