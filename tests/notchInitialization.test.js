import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const notchScript = readFileSync(new URL('../content_script_notch.js', import.meta.url), 'utf8');

describe('optional notch initialization', () => {
  it('does not register duplicate listeners while storage hydration is pending', () => {
    const pendingStorageReads = [];
    const storageListeners = [];
    const runtimeListeners = [];
    const window = { matchMedia: () => null };
    window.top = window;
    const chrome = {
      storage: {
        local: {
          get: vi.fn((_keys, callback) => pendingStorageReads.push(callback)),
        },
        onChanged: {
          addListener: (listener) => storageListeners.push(listener),
        },
      },
      runtime: {
        onMessage: {
          addListener: (listener) => runtimeListeners.push(listener),
        },
      },
    };
    const sandbox = {
      window,
      document: { querySelector: () => null },
      chrome,
      setTimeout,
      clearTimeout,
    };

    vm.runInNewContext(notchScript, sandbox);
    expect(window.__promptPaulNotchRuntimeInstalled).toBe(true);
    expect(pendingStorageReads).toHaveLength(1);
    expect(storageListeners).toHaveLength(1);
    expect(runtimeListeners).toHaveLength(1);

    // Dynamic registration and immediate injection can both evaluate the same
    // script before the first storage callback mounts or declines the notch.
    vm.runInNewContext(notchScript, sandbox);

    expect(pendingStorageReads).toHaveLength(1);
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    expect(storageListeners).toHaveLength(1);
    expect(runtimeListeners).toHaveLength(1);
  });
});
