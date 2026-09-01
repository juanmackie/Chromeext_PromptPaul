/**
 * @fileoverview Unit tests for the session-scoped Act permission.
 * @module chatPageAutomation.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isPageActionsEnabled,
  setPageActionsEnabled,
  setPageActionsRunActive,
  initPageActionsToggle,
} from '../src/chat/ChatPageAutomation.js';

describe('ChatPageAutomation Act permission', () => {
  let sessionState;
  let localState;
  let requestedStorage;

  beforeEach(() => {
    sessionState = {};
    localState = { pageActionsEnabled: true };
    requestedStorage = [];
    const makeStorage = (state, area) => ({
      get: (keys, callback) => {
        requestedStorage.push({ area, operation: 'get', keys });
        callback(
          Object.fromEntries(
            keys.map((key) => [key, state[key]]).filter(([, value]) => value !== undefined)
          )
        );
      },
      set: (updates, callback) => {
        requestedStorage.push({ area, operation: 'set', updates });
        Object.assign(state, updates);
        callback?.();
      },
      remove: (keys, callback) => {
        requestedStorage.push({ area, operation: 'remove', keys });
        keys.forEach((key) => delete state[key]);
        callback?.();
      },
    });
    global.chrome = {
      storage: {
        session: makeStorage(sessionState, 'session'),
        local: makeStorage(localState, 'local'),
      },
    };
  });

  afterEach(() => {
    delete global.chrome;
  });

  it('uses session storage instead of a local value left by an older version', async () => {
    expect(await isPageActionsEnabled()).toBe(false);
    expect(requestedStorage[0]).toMatchObject({ area: 'session', operation: 'get' });
    expect(requestedStorage).not.toContainEqual(expect.objectContaining({ area: 'local' }));
  });

  it('reports Act storage failures instead of claiming success', async () => {
    global.chrome.runtime = { lastError: { message: 'quota exceeded' } };

    await expect(setPageActionsEnabled(true)).rejects.toThrow('quota exceeded');
  });

  it('keeps Act enabled across runs until explicitly disabled', async () => {
    await setPageActionsEnabled(true);

    expect(await isPageActionsEnabled()).toBe(true);
    expect(await isPageActionsEnabled()).toBe(true);
    expect(sessionState.pageActionsEnabled).toBe(true);

    await setPageActionsEnabled(false);
    expect(await isPageActionsEnabled()).toBe(false);
  });

  it('keeps the sidebar Act shading through the active run', async () => {
    const attributes = {};
    const toggle = {
      dataset: {},
      disabled: false,
      setAttribute(name, value) {
        attributes[name] = value;
      },
      getAttribute(name) {
        return attributes[name];
      },
      addEventListener() {},
    };
    global.chrome.storage.onChanged = { addListener() {} };

    initPageActionsToggle(toggle);
    await setPageActionsEnabled(true);
    expect(attributes['aria-pressed']).toBe('true');

    setPageActionsRunActive(true);
    expect(attributes['aria-pressed']).toBe('true');
    expect(toggle.dataset.runActive).toBe('true');
    expect(toggle.disabled).toBe(true);

    setPageActionsRunActive(false);
    expect(attributes['aria-pressed']).toBe('true');
    expect(toggle.dataset.runActive).toBe('false');
    expect(toggle.disabled).toBe(false);

    await setPageActionsEnabled(false);
    expect(attributes['aria-pressed']).toBe('false');
  });
});
