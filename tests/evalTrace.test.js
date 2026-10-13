/**
 * @fileoverview Evaluation trace contract tests.
 * @module evalTraceTest
 */

import { describe, expect, it, vi } from 'vitest';
import {
  beginEvalTrace,
  clearEvalTrace,
  finishEvalTrace,
  getEvalTrace,
  recordEvalTrace,
  setEvalTraceActionCallback,
} from '../src/utils/evalTrace.eval.js';

describe('evaluation trace', () => {
  it('measures full snapshot serialization before bounded trace truncation', () => {
    const runId = 'snapshot-metric';
    beginEvalTrace({ runId });
    const step = recordEvalTrace(runId, {
      kind: 'action',
      actionResult: {
        result: {
          snapshot: {
            snapshotId: 's',
            content: '[0] input Name',
            elements: [{ index: 0, label: 'Name' }],
            metrics: { buildMs: 4 },
            fingerprint: 'abcd',
          },
        },
      },
    });
    expect(step.snapshotBytes.after).toBeGreaterThan(0);
    expect(step.snapshotBytes.after).toBeLessThan(step.snapshotBytes.before);
    clearEvalTrace(runId);
  });
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

  it('captures only the first proposed mutation and calls the runtime callback after saving it', () => {
    const runId = 'eval-first-prediction';
    clearEvalTrace(runId);
    beginEvalTrace({ runId });
    const calls = [];
    let traceAtCallback = null;
    setEvalTraceActionCallback(runId, (details) => {
      calls.push(details);
      traceAtCallback = getEvalTrace(runId);
    });

    recordEvalTrace(runId, {
      kind: 'action',
      action: { function: { name: 'page_get_state', arguments: '{}' } },
    });
    recordEvalTrace(runId, {
      kind: 'action',
      action: { function: { name: 'page_click', arguments: '{invalid' } },
      actionResult: { success: false, error: 'invalid arguments' },
    });
    recordEvalTrace(runId, {
      kind: 'action',
      action: { function: { name: 'page_input', arguments: '{}' } },
    });

    expect(calls).toHaveLength(1);
    expect(traceAtCallback.steps[1].action_taken.function.name).toBe('page_click');
    expect(getEvalTrace(runId).measurement).toMatchObject({
      predictionCaptured: true,
      terminalReason: 'prediction_captured',
    });
    expect(getEvalTrace(runId).measurement.timeToFirstActionMs).toEqual(expect.any(Number));
    expect(JSON.stringify(getEvalTrace(runId))).not.toContain('onActionRecorded');
    expect(
      finishEvalTrace(runId, { type: 'prediction_captured' }).measurement.cleanupTimeMs
    ).toEqual(expect.any(Number));
    clearEvalTrace(runId);
  });

  it('separates first-action and post-action cleanup time and leaves cleanup null without a prediction', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T00:00:00.000Z'));
    const runId = 'eval-measurement-clock';
    beginEvalTrace({ runId });
    vi.advanceTimersByTime(50);
    setEvalTraceActionCallback(runId, () => {});
    recordEvalTrace(runId, {
      kind: 'action',
      action: { function: { name: 'page_click', arguments: '{}' } },
    });
    vi.advanceTimersByTime(20);
    expect(finishEvalTrace(runId).measurement).toMatchObject({
      predictionCaptured: true,
      timeToFirstActionMs: 50,
      cleanupTimeMs: 20,
      terminalReason: 'prediction_captured',
    });
    clearEvalTrace(runId);

    const noPredictionRunId = 'eval-measurement-no-action';
    beginEvalTrace({ runId: noPredictionRunId });
    vi.advanceTimersByTime(35);
    expect(finishEvalTrace(noPredictionRunId).measurement).toMatchObject({
      predictionCaptured: false,
      timeToFirstActionMs: null,
      cleanupTimeMs: null,
      terminalReason: null,
    });
    clearEvalTrace(noPredictionRunId);
    vi.useRealTimers();
  });

  it('releases action callbacks when a trace is cleared or terminated', () => {
    const firstRun = 'eval-callback-clear';
    beginEvalTrace({ runId: firstRun });
    const callback = () => {
      throw new Error('callback should have been released');
    };
    setEvalTraceActionCallback(firstRun, callback);
    clearEvalTrace(firstRun);

    const secondRun = 'eval-callback-terminal';
    beginEvalTrace({ runId: secondRun });
    setEvalTraceActionCallback(secondRun, callback);
    recordEvalTrace(secondRun, { kind: 'terminal', terminalType: 'aborted' });
    recordEvalTrace(secondRun, {
      kind: 'action',
      action: { function: { name: 'page_click', arguments: '{}' } },
    });
    expect(getEvalTrace(secondRun).measurement.predictionCaptured).toBe(true);
    expect(getEvalTrace(secondRun).measurement.terminalReason).toBeNull();
    clearEvalTrace(secondRun);
  });

  it('retains the initial inspection and first proposal and fires the callback at the step cap', () => {
    const runId = 'eval-first-action-at-cap';
    beginEvalTrace({ runId });
    recordEvalTrace(runId, {
      kind: 'action',
      action: { function: { name: 'page_get_state', arguments: '{}' } },
    });
    for (let index = 1; index < 256; index += 1) {
      recordEvalTrace(runId, { kind: 'event', eventType: `event-${index}` });
    }
    const callbacks = [];
    setEvalTraceActionCallback(runId, (details) => callbacks.push(details));

    recordEvalTrace(runId, {
      kind: 'action',
      action: { function: { name: 'page_click', arguments: '{invalid proposal' } },
      actionResult: { error: 'invalid arguments' },
    });

    const trace = getEvalTrace(runId);
    expect(trace.steps).toHaveLength(256);
    expect(trace.steps[0].action_taken.function.name).toBe('page_get_state');
    expect(trace.steps.at(-1).action_taken.function.name).toBe('page_click');
    expect(callbacks).toHaveLength(1);
    expect(trace.measurement).toMatchObject({
      predictionCaptured: true,
      terminalReason: 'prediction_captured',
    });
    clearEvalTrace(runId);
  });

  it('records provider-reported token usage without retaining credential fields', () => {
    const runId = 'eval-trace-usage';
    clearEvalTrace(runId);
    beginEvalTrace({ taskId: 'token-task', runId, task: 'Read the local page.' });
    recordEvalTrace(runId, {
      kind: 'usage',
      tokenUsage: { inputTokens: 23, outputTokens: 7, apiKey: 'not-recorded' },
    });

    const trace = getEvalTrace(runId);
    expect(trace.steps[0].tokenUsage).toEqual({
      inputTokens: 23,
      outputTokens: 7,
      apiKey: '[REDACTED]',
    });
    expect(JSON.stringify(trace)).not.toContain('not-recorded');
    clearEvalTrace(runId);
  });

  it('records a bounded, redacted view of the messages sent to the provider', () => {
    const runId = 'eval-provider-messages';
    clearEvalTrace(runId);
    beginEvalTrace({ runId });
    const step = recordEvalTrace(runId, {
      kind: 'provider_request',
      providerMessages: [
        { role: 'system', content: 'Use only the observed controls.' },
        { role: 'user', content: 'Find the requested item.' },
        { role: 'tool', content: JSON.stringify({ text: 'snapshot', apiKey: 'secret-key' }) },
        { role: 'tool', content: 'x'.repeat(20_000) },
      ],
    });

    expect(step.providerMessages).toHaveLength(4);
    expect(step.providerMessages[0].content).toContain('observed controls');
    expect(step.providerMessages[3].content).toHaveLength(20_000);
    expect(JSON.stringify(step.providerMessages)).not.toContain('secret-key');
    clearEvalTrace(runId);
  });

  it('records provider timing stages and bounded serving model identity', () => {
    const runId = 'eval-provider-timing';
    clearEvalTrace(runId);
    beginEvalTrace({ runId });
    const step = recordEvalTrace(runId, {
      kind: 'provider_timing',
      eventType: 'first_stream_chunk',
      providerCallIndex: 2,
      durationMs: 1_234,
      servedModelId: 'provider/model-name',
    });
    expect(step).toMatchObject({
      eventType: 'first_stream_chunk',
      providerCallIndex: 2,
      durationMs: 1_234,
      servedModelId: 'provider/model-name',
    });
    clearEvalTrace(runId);
  });

  it('retains bounded machine outcomes even after the step cap', () => {
    const runId = 'terminal-outcome-cap';
    beginEvalTrace({ runId });
    for (let index = 0; index < 256; index++) recordEvalTrace(runId, { kind: 'event' });
    recordEvalTrace(runId, {
      kind: 'terminal',
      terminalType: 'complete',
      llmResponse: 'Everything succeeded.',
      actOutcome: { status: 'blocked', reason: 'declined', pageText: 'must-not-enter-outcome' },
    });
    const trace = finishEvalTrace(runId);
    expect(trace.steps).toHaveLength(256);
    expect(trace.terminal.actOutcome).toEqual({ status: 'blocked', reason: 'declined' });
    expect(JSON.stringify(trace)).not.toContain('must-not-enter-outcome');
    clearEvalTrace(runId);
    beginEvalTrace({ runId });
    expect(
      finishEvalTrace(runId, {
        type: 'complete',
        actOutcome: { status: 'failed', reason: 'ambiguous' },
      }).terminal.actOutcome
    ).toEqual({ status: 'failed', reason: 'ambiguous' });
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
