/**
 * @fileoverview Unit tests for the session-scoped Act permission.
 * @module chatPageAutomation.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isPageActionsEnabled,
  setPageActionsEnabled,
  setPageActionsRunActive,
  initPageActionsToggle,
  formatPlainLanguageDisposition,
  handlePageUserInputRequest,
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

describe('ChatPageAutomation plain-language delivery mapping', () => {
  it('maps each receipt disposition to plain language', () => {
    expect(formatPlainLanguageDisposition('delivered_verified')).toBe('Verified');
    expect(formatPlainLanguageDisposition('delivered_unverified')).toBe(
      'Performed - verification unavailable'
    );
    expect(formatPlainLanguageDisposition('not_delivered')).toBe('Not performed');
  });

  it('returns an empty string for unknown or missing dispositions', () => {
    expect(formatPlainLanguageDisposition(undefined)).toBe('');
    expect(formatPlainLanguageDisposition(null)).toBe('');
    expect(formatPlainLanguageDisposition('weird')).toBe('');
  });
});

describe('ChatPageAutomation clarification card', () => {
  class FakeElement {
    constructor(tag) {
      this.tag = tag;
      this.className = '';
      this.children = [];
      this.dataset = {};
      this.listeners = {};
      this.attributes = {};
      this.disabled = false;
      this.value = '';
      this.textContent = '';
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    append(...nodes) {
      nodes.forEach((node) => this.appendChild(node));
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    }
    querySelector(selector) {
      const cls = selector.replace('.', '');
      for (const child of this.children) {
        if (child.className === cls) return child;
        const nested = child.querySelector?.(selector);
        if (nested) return nested;
      }
      return null;
    }
    focus() {}
  }

  let sent;
  let response;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    response = { success: true };
    globalThis.document = { createElement: (tag) => new FakeElement(tag) };
    globalThis.chrome = {
      runtime: {
        sendMessage: async (message) => {
          sent.push(message);
          return response;
        },
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.document;
    delete globalThis.chrome;
  });

  const findSubmit = (card) => {
    const controls = card.children.find((child) => child.className.includes('controls'));
    return controls.children.find((child) => child.textContent === 'Send');
  };
  const findInput = (card) => {
    const controls = card.children.find((child) => child.className.includes('controls'));
    return controls.children.find((child) => child.tag === 'input');
  };

  const render = (resolveAuth) =>
    handlePageUserInputRequest(
      new FakeElement('div'),
      { type: 'page_user_input_request', requestId: 'input-1', question: 'Which one?' },
      'run-1',
      7,
      resolveAuth
    );

  it('sends the owner token resolved at click time', async () => {
    const card = render(async () => ({ ownerToken: 'fresh-token', sourceTabId: 7 }));
    findInput(card).value = 'first';
    await findSubmit(card).listeners.click();
    expect(sent[0]).toMatchObject({
      action: 'pageUserInputResponse',
      ownerToken: 'fresh-token',
      sourceTabId: 7,
      answer: 'first',
    });
    expect(card.dataset.decision).toBe('sent');
  });

  it('closes the card when the background reports the question expired', async () => {
    response = { success: false, expired: true, error: 'gone' };
    const card = render();
    await findSubmit(card).listeners.click();
    expect(card.dataset.decision).toBe('expired');
    expect(findSubmit(card).disabled).toBe(true);
    expect(card.querySelector('.page-action-inline-error').textContent).toBe('gone');
  });

  it('keeps the card retryable after a non-expiry failure', async () => {
    response = { success: false, error: 'boom' };
    const card = render();
    await findSubmit(card).listeners.click();
    expect(card.dataset.decision).toBeUndefined();
    expect(findSubmit(card).disabled).toBe(false);
  });

  it('expires on its own after the background wait window', () => {
    const card = render();
    vi.advanceTimersByTime(120_000);
    expect(card.dataset.decision).toBe('expired');
    expect(findInput(card).disabled).toBe(true);
  });
});
