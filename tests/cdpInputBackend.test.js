import { describe, expect, it, vi } from 'vitest';
import { CdpInputBackend } from '../src/orchestrator/CdpInputBackend.js';

function createDebuggerApi() {
  const listeners = new Set();
  return {
    attach: vi.fn((_target, _version, callback) => callback()),
    sendCommand: vi.fn((_target, _method, _params, callback) => callback({})),
    detach: vi.fn((_target, callback) => callback()),
    onDetach: {
      addListener: vi.fn((listener) => listeners.add(listener)),
      removeListener: vi.fn((listener) => listeners.delete(listener)),
      emit(target, reason) {
        for (const listener of listeners) listener(target, reason);
      },
    },
  };
}

describe('CdpInputBackend', () => {
  it('bounds a debugger command that never replies without retrying it', async () => {
    vi.useFakeTimers();
    const debuggerApi = createDebuggerApi();
    debuggerApi.sendCommand.mockImplementation(() => {});
    const backend = new CdpInputBackend({ debuggerApi });
    const pending = backend.dispatch('run-timeout', 7, 'Input.insertText', { text: 'once' });
    const rejection = expect(pending).rejects.toMatchObject({ code: 'PAGE_ACTION_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    expect(debuggerApi.sendCommand).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it('detaches a debugger attachment that succeeds after its timeout', async () => {
    vi.useFakeTimers();
    const debuggerApi = createDebuggerApi();
    let completeAttach;
    debuggerApi.attach.mockImplementation((_target, _version, callback) => {
      completeAttach = callback;
    });
    const backend = new CdpInputBackend({ debuggerApi });
    const pending = backend.dispatch('late-attach', 7, 'Input.insertText', { text: 'once' });
    const rejection = expect(pending).rejects.toMatchObject({ code: 'CDP_ATTACH_TIMEOUT' });
    try {
      await vi.advanceTimersByTimeAsync(15_000);
      await rejection;
      expect(backend.isAttached('late-attach')).toBe(false);
      completeAttach();
      expect(debuggerApi.detach).toHaveBeenCalledTimes(1);
      expect(debuggerApi.detach).toHaveBeenCalledWith({ tabId: 7 }, expect.any(Function));
      expect(backend.isAttached('late-attach')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('attaches lazily and dispatches only allow-listed Input commands', async () => {
    const debuggerApi = createDebuggerApi();
    const backend = new CdpInputBackend({ debuggerApi });
    expect(debuggerApi.attach).not.toHaveBeenCalled();

    await backend.dispatch('run-1', 7, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: 30,
      y: 40,
      button: 'left',
      clickCount: 1,
    });
    await backend.dispatch('run-1', 7, 'Input.insertText', { text: 'hello' });

    expect(debuggerApi.attach).toHaveBeenCalledTimes(1);
    expect(debuggerApi.sendCommand).toHaveBeenCalledTimes(2);
    await expect(backend.dispatch('run-1', 7, 'Runtime.evaluate', {})).rejects.toMatchObject({
      code: 'CDP_METHOD_BLOCKED',
    });
    await expect(backend.dispatch('run-1', 7, 'Page.captureScreenshot', {})).rejects.toMatchObject({
      code: 'CDP_METHOD_BLOCKED',
    });
  });

  it('accepts only bounded keyboard keys and modifier masks', async () => {
    const debuggerApi = createDebuggerApi();
    const backend = new CdpInputBackend({ debuggerApi });
    await backend.dispatch('run-key', 12, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'a',
      code: 'KeyA',
      modifiers: 2,
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
    });
    await expect(
      backend.dispatch('run-key', 12, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        modifiers: 4,
      })
    ).rejects.toMatchObject({ code: 'CDP_INPUT_INVALID' });
    await expect(
      backend.dispatch('run-key', 12, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'x'.repeat(100),
      })
    ).rejects.toMatchObject({ code: 'CDP_INPUT_INVALID' });
    expect(debuggerApi.sendCommand).toHaveBeenCalledTimes(1);
    await backend.detachRun('run-key');
  });

  it('rejects malformed input before attaching', async () => {
    const debuggerApi = createDebuggerApi();
    const backend = new CdpInputBackend({ debuggerApi });

    await expect(
      backend.dispatch('run-1', 7, 'Input.insertText', { text: 'x'.repeat(2001) })
    ).rejects.toMatchObject({
      code: 'CDP_INPUT_INVALID',
    });
    await expect(
      backend.dispatch('run-1', 7, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: -1,
        y: 4,
        button: 'left',
        clickCount: 1,
      })
    ).rejects.toMatchObject({ code: 'CDP_INPUT_INVALID' });
    expect(debuggerApi.attach).not.toHaveBeenCalled();
  });

  it('releases the tab on explicit teardown and reports unexpected detach', async () => {
    const debuggerApi = createDebuggerApi();
    const onUnexpectedDetach = vi.fn();
    const backend = new CdpInputBackend({ debuggerApi, onUnexpectedDetach });
    await backend.dispatch('run-1', 7, 'Input.insertText', { text: 'hello' });
    debuggerApi.onDetach.emit({ tabId: 7 }, 'canceled_by_user');
    expect(onUnexpectedDetach).toHaveBeenCalledWith({
      runId: 'run-1',
      tabId: 7,
      reason: 'canceled_by_user',
    });
    await expect(
      backend.dispatch('run-1', 7, 'Input.insertText', { text: 'retry' })
    ).rejects.toMatchObject({ code: 'CDP_INPUT_DETACHED' });
    expect(debuggerApi.attach).toHaveBeenCalledTimes(1);

    await backend.dispatch('run-2', 8, 'Input.insertText', { text: 'world' });
    await backend.detachRun('run-2');
    expect(debuggerApi.detach).toHaveBeenCalledWith({ tabId: 8 }, expect.any(Function));
    backend.dispose();
  });
});
