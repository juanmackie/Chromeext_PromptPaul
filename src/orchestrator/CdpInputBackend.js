/**
 * @fileoverview Restricted, run-scoped Chrome DevTools Protocol input backend.
 * @module CdpInputBackend
 */

const CDP_VERSION = '1.3';
const MAX_COORDINATE = 100_000;
const CDP_OPERATION_TIMEOUT_MS = 15_000;
const MAX_INSERT_TEXT_CHARS = 2_000;
const ALLOWED_MOUSE_TYPES = new Set(['mousePressed', 'mouseReleased', 'mouseMoved']);
const ALLOWED_KEY_TYPES = new Set(['rawKeyDown', 'keyDown', 'keyUp']);
const ALLOWED_KEYS = new Set([
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Control',
  ' ',
  'a',
]);

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateCommand(method, params) {
  if (method === 'Input.insertText') {
    const text = String(params?.text ?? '');
    if (!text || text.length > MAX_INSERT_TEXT_CHARS || text.includes(String.fromCharCode(0))) {
      throw createError('CDP_INPUT_INVALID', 'Input text is empty or outside the allowed size.');
    }
    return { text };
  }
  if (method === 'Input.dispatchMouseEvent') {
    const x = Number(params?.x);
    const y = Number(params?.y);
    const type = String(params?.type || '');
    const clickCount = Number(params?.clickCount ?? 1);
    if (
      !ALLOWED_MOUSE_TYPES.has(type) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x > MAX_COORDINATE ||
      y > MAX_COORDINATE ||
      ![1, 2].includes(clickCount) ||
      !['left', 'none'].includes(String(params?.button || 'left'))
    ) {
      throw createError('CDP_INPUT_INVALID', 'Mouse input is outside the allow-listed bounds.');
    }
    return {
      type,
      x,
      y,
      button: params?.button || 'left',
      clickCount,
    };
  }
  if (method === 'Input.dispatchKeyEvent') {
    const type = String(params?.type || '');
    const key = String(params?.key || '');
    const code = String(params?.code || '');
    const modifiers = Number(params?.modifiers || 0);
    const text = params?.text;
    const windowsVirtualKeyCode = params?.windowsVirtualKeyCode;
    const nativeVirtualKeyCode = params?.nativeVirtualKeyCode;
    if (
      !ALLOWED_KEY_TYPES.has(type) ||
      !ALLOWED_KEYS.has(key) ||
      code.length > 16 ||
      !Number.isInteger(modifiers) ||
      ![0, 2, 8].includes(modifiers) ||
      text !== undefined ||
      (windowsVirtualKeyCode !== undefined &&
        (!Number.isInteger(windowsVirtualKeyCode) ||
          windowsVirtualKeyCode < 0 ||
          windowsVirtualKeyCode > 255)) ||
      (nativeVirtualKeyCode !== undefined &&
        (!Number.isInteger(nativeVirtualKeyCode) ||
          nativeVirtualKeyCode < 0 ||
          nativeVirtualKeyCode > 255))
    ) {
      throw createError('CDP_INPUT_INVALID', 'Keyboard input is outside the allow-listed bounds.');
    }
    return {
      type,
      key,
      ...(code ? { code } : {}),
      modifiers,
      ...(windowsVirtualKeyCode === undefined ? {} : { windowsVirtualKeyCode }),
      ...(nativeVirtualKeyCode === undefined ? {} : { nativeVirtualKeyCode }),
    };
  }
  throw createError('CDP_METHOD_BLOCKED', 'Only allow-listed CDP Input methods are available.');
}

function callChromeApi(
  api,
  method,
  args,
  getLastError,
  onLateSuccess = null,
  timeoutCode = 'PAGE_ACTION_TIMEOUT'
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      const error = createError(timeoutCode, 'The debugger operation timed out.');
      reject(error);
    }, CDP_OPERATION_TIMEOUT_MS);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    try {
      api[method](...args, (result) => {
        const lastError = getLastError?.();
        if (settled) {
          if (!lastError && onLateSuccess) {
            try {
              Promise.resolve(onLateSuccess(result)).catch(() => {});
            } catch (_) {
              // A timed-out request must not create an unhandled late callback error.
            }
          }
          return;
        }
        if (lastError)
          finish(reject, new Error(lastError.message || 'Chrome debugger request failed.'));
        else finish(resolve, result);
      });
    } catch (error) {
      finish(reject, error);
    }
  });
}

export class CdpInputBackend {
  constructor(options = {}) {
    this.debuggerApi = options.debuggerApi || globalThis.chrome?.debugger;
    this.getLastError = options.getLastError || (() => globalThis.chrome?.runtime?.lastError);
    this.onUnexpectedDetach = options.onUnexpectedDetach || (() => {});
    this.sessions = new Map();
    this.runByTab = new Map();
    this.detachedRuns = new Set();
    this.onDetach = (target, reason) => {
      const tabId = Number(target?.tabId);
      const runId = this.runByTab.get(tabId);
      if (!runId) return;
      this.sessions.delete(runId);
      this.runByTab.delete(tabId);
      this.detachedRuns.add(runId);
      this.onUnexpectedDetach({ runId, tabId, reason: String(reason || 'detached').slice(0, 80) });
    };
    this.debuggerApi?.onDetach?.addListener(this.onDetach);
  }

  async _attach(runId, tabId) {
    if (this.detachedRuns.has(runId)) {
      throw createError(
        'CDP_INPUT_DETACHED',
        'The debugger detached; precise input is disabled for this run.'
      );
    }
    const currentTabId = this.sessions.get(runId);
    if (currentTabId === tabId) return;
    if (currentTabId != null) {
      throw createError('CDP_INPUT_TAB_MISMATCH', 'Precise input is bound to another tab.');
    }
    const owner = this.runByTab.get(tabId);
    if (owner && owner !== runId) {
      throw createError(
        'CDP_INPUT_TAB_BUSY',
        'Another Act run is using precise input on this tab.'
      );
    }
    if (!this.debuggerApi) throw new Error('Chrome debugger API is unavailable.');
    const detachLateAttachment = () =>
      callChromeApi(this.debuggerApi, 'detach', [{ tabId }], this.getLastError).catch(() => {});
    await callChromeApi(
      this.debuggerApi,
      'attach',
      [{ tabId }, CDP_VERSION],
      this.getLastError,
      detachLateAttachment,
      'CDP_ATTACH_TIMEOUT'
    );
    this.sessions.set(runId, tabId);
    this.runByTab.set(tabId, runId);
  }

  async attach(runId, tabId) {
    const id = String(runId || '').slice(0, 128);
    const targetTabId = Number(tabId);
    if (!id || !Number.isInteger(targetTabId) || targetTabId < 0) {
      throw createError('CDP_INPUT_INVALID', 'A valid run and tab are required.');
    }
    await this._attach(id, targetTabId);
  }

  async dispatch(runId, tabId, method, params = {}) {
    const id = String(runId || '').slice(0, 128);
    const targetTabId = Number(tabId);
    if (!id || !Number.isInteger(targetTabId) || targetTabId < 0) {
      throw createError('CDP_INPUT_INVALID', 'A valid run and tab are required.');
    }
    const safeParams = validateCommand(String(method || ''), params);
    await this._attach(id, targetTabId);
    const response = await callChromeApi(
      this.debuggerApi,
      'sendCommand',
      [{ tabId: targetTabId }, String(method), safeParams],
      this.getLastError
    );
    return response || {};
  }

  isAttached(runId) {
    return this.sessions.has(String(runId || ''));
  }

  async detachRun(runId) {
    const id = String(runId || '');
    const tabId = this.sessions.get(id);
    if (tabId == null) return;
    this.sessions.delete(id);
    this.runByTab.delete(tabId);
    try {
      await callChromeApi(this.debuggerApi, 'detach', [{ tabId }], this.getLastError);
    } catch (_) {
      // The browser may already have detached after tab closure or Stop.
    }
  }

  async detachTab(tabId) {
    const runId = this.runByTab.get(Number(tabId));
    if (runId) await this.detachRun(runId);
  }

  dispose() {
    this.debuggerApi?.onDetach?.removeListener(this.onDetach);
    for (const runId of [...this.sessions.keys()]) void this.detachRun(runId);
  }
}
