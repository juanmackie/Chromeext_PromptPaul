/**
 * @fileoverview Settlement regressions against the classic content-script runtime.
 * @module pageActionSettleTests
 */

import fs from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Exercise the shipped function without loading unrelated extraction/UI code.
const source = fs.readFileSync(
  new URL('../content_script_page_actions.js', import.meta.url),
  'utf8'
);
const settleSource = source.slice(
  source.indexOf('  function waitForPageActionSettled('),
  source.indexOf('  function waitForPageActionCondition(')
);

function createRuntime(visibilityState = 'visible') {
  const document = new EventTarget();
  document.visibilityState = visibilityState;
  document.documentElement = {};
  const frames = new Map();
  let nextFrame = 0;
  const disconnect = vi.fn();
  let mutation;
  let resource;
  let busy = [];
  document.querySelectorAll = () => busy;
  const context = vm.createContext({
    document,
    setTimeout,
    clearTimeout,
    PAGE_ACTION_SETTLE_QUIET_MS: 100,
    PAGE_ACTION_SETTLE_MAX_MS: 1_000,
    PAGE_ACTION_SETTLE_BUSY_MAX_MS: 3_000,
    performance: { now: () => Date.now(), getEntriesByType: () => [] },
    MutationObserver: class {
      constructor(callback) {
        mutation = callback;
      }
      observe() {}
      disconnect() {
        disconnect();
      }
    },
    PerformanceObserver: class {
      constructor(callback) {
        resource = callback;
      }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame(callback) {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  });
  vm.runInContext(settleSource, context);
  return {
    document,
    disconnect,
    frames,
    settle: (options) => context.waitForPageActionSettled(options),
    busy(elements) {
      busy = elements;
      mutation?.();
    },
    resource() {
      resource?.({ getEntries: () => [{ entryType: 'resource' }] });
    },
    frame() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('page-action settlement', () => {
  it('waits for a newly raised busy signal and reports bounded timing', async () => {
    vi.useFakeTimers();
    const runtime = createRuntime('hidden');
    const completed = vi.fn();
    runtime.busy([{}]);
    runtime.settle({ busyBefore: new Set() }).then(completed);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(completed).not.toHaveBeenCalled();
    runtime.busy([]);
    await vi.advanceTimersByTimeAsync(110);
    expect(completed).toHaveBeenCalledWith({ waitedMs: 1_601, reason: 'busy' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a spinner that was already present before the action', async () => {
    vi.useFakeTimers();
    const runtime = createRuntime('hidden');
    const spinner = {};
    runtime.busy([spinner]);
    const completed = vi.fn();
    runtime.settle({ busyBefore: new Set([spinner]) }).then(completed);
    await vi.advanceTimersByTimeAsync(110);
    expect(completed).toHaveBeenCalledWith({ waitedMs: 101, reason: 'quiet' });
  });

  it('bounds action-triggered busy work at three seconds', async () => {
    vi.useFakeTimers();
    const runtime = createRuntime('hidden');
    runtime.busy([{}]);
    const completed = vi.fn();
    runtime.settle({ busyBefore: new Set() }).then(completed);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(completed).toHaveBeenCalledWith({ waitedMs: 3_000, reason: 'busy_deadline' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('extends only when a resource entry lands during the quiet window', async () => {
    vi.useFakeTimers();
    const runtime = createRuntime('hidden');
    const completed = vi.fn();
    runtime.settle().then(completed);
    await vi.advanceTimersByTimeAsync(90);
    runtime.resource();
    await vi.advanceTimersByTimeAsync(50);
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60);
    expect(completed).toHaveBeenCalledWith({ waitedMs: 191, reason: 'resource' });
  });

  it('finishes in a hidden document without animation frames', async () => {
    vi.useFakeTimers();
    const runtime = createRuntime('hidden');
    const completed = vi.fn();
    runtime.settle().then(completed);
    await vi.advanceTimersByTimeAsync(200);
    expect(completed).toHaveBeenCalledOnce();
    expect(runtime.disconnect).toHaveBeenCalledOnce();
    expect(runtime.frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    runtime.document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finishes if the document is hidden between the two animation frames', async () => {
    vi.useFakeTimers();
    const runtime = createRuntime();
    const completed = vi.fn();
    runtime.settle().then(completed);
    await vi.advanceTimersByTimeAsync(100);
    runtime.frame();
    runtime.document.visibilityState = 'hidden';
    runtime.document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10);
    expect(completed).toHaveBeenCalledOnce();
    expect(runtime.frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for both frames when visible and clears the deadline after completion', async () => {
    vi.useFakeTimers();
    const runtime = createRuntime();
    const completed = vi.fn();
    runtime.settle().then(completed);
    await vi.advanceTimersByTimeAsync(100);
    expect(completed).not.toHaveBeenCalled();
    runtime.frame();
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    runtime.frame();
    await Promise.resolve();
    expect(completed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds the wait if animation frames stop without a visibility event', async () => {
    vi.useFakeTimers();
    const runtime = createRuntime();
    const completed = vi.fn();
    runtime.settle().then(completed);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(completed).toHaveBeenCalledOnce();
    expect(runtime.frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
