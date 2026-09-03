/**
 * @fileoverview Evaluation trace contract tests.
 * @module evalTraceTest
 */

import { describe, expect, it } from 'vitest';
import {
  beginEvalTrace,
  clearEvalTrace,
  finishEvalTrace,
  getEvalTrace,
  recordEvalTrace,
} from '../src/utils/evalTrace.eval.js';

describe('evaluation trace', () => {
  it('records bounded redacted provider and action steps', () => {
    const runId = 'eval-trace-test';
    clearEvalTrace(runId);
    beginEvalTrace({
      taskId: 'public-task',
      runId,
      task: 'Complete the public fixture task.',
      dryRun: true,
    });
    recordEvalTrace(runId, {
      kind: 'action',
      prompt: 'Complete the public fixture task.',
      llmResponse: 'I will update the public fixture.',
      action: {
        function: {
          name: 'page_input',
          arguments: JSON.stringify({ index: 1, text: 'public value', token: 'secret-token' }),
        },
      },
      actionResult: { success: true },
    });
    finishEvalTrace(runId, { type: 'complete', content: 'Done.' });

    const trace = getEvalTrace(runId);
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0].action_taken.function.name).toBe('page_input');
    expect(JSON.stringify(trace)).not.toContain('secret-token');
    expect(trace.terminal.type).toBe('complete');
    clearEvalTrace(runId);
  });

  it('caps trace growth', () => {
    const runId = 'eval-trace-cap';
    clearEvalTrace(runId);
    beginEvalTrace({ taskId: 'cap', runId, task: 'Cap output.' });
    for (let index = 0; index < 400; index += 1) {
      recordEvalTrace(runId, {
        kind: 'event',
        prompt: 'x'.repeat(20_000),
        llmResponse: 'y'.repeat(20_000),
        actionResult: { index, value: 'z'.repeat(20_000) },
      });
    }
    expect(JSON.stringify(getEvalTrace(runId)).length).toBeLessThanOrEqual(512 * 1024);
    clearEvalTrace(runId);
  });
});
