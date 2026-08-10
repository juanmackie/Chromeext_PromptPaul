/**
 * @fileoverview Unit tests for the session-scoped Act permission.
 * @module chatPageAutomation.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isPageActionsEnabled,
  setPageActionsEnabled,
  consumePageActionsEnabled,
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

  it('consumes Act after one run so the next run starts disabled', async () => {
    await setPageActionsEnabled(true);

    expect(await consumePageActionsEnabled()).toBe(true);
    expect(sessionState.pageActionsEnabled).toBeUndefined();
    expect(await consumePageActionsEnabled()).toBe(false);
  });
});
