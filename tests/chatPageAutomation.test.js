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
  updatePageActionActivity,
  updatePageTaskProgress,
  renderPageActionConfirmation,
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

describe('ChatPageAutomation run-card reuse', () => {
  class CardElement {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.style = {};
      this.hidden = false;
      this.parentElement = null;
      this.scrollHeight = 0;
      this.scrollTop = 0;
      this.clientHeight = 0;
      this.textContent = '';
      this.querySelectorAllCalls = 0;
    }

    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    append(...children) {
      children.forEach((child) => this.appendChild(child));
    }

    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentElement = null;
      return child;
    }

    querySelectorAll(selector) {
      this.querySelectorAllCalls += 1;
      return this.children.filter((child) =>
        selector === '[data-page-action-activity]'
          ? child.dataset.pageActionActivity === 'true'
          : selector === '[data-page-task-progress]'
            ? child.dataset.pageTaskProgress === 'true'
            : false
      );
    }

    querySelector(selector) {
      const className = selector.startsWith('.') ? selector.slice(1) : '';
      for (const child of this.children) {
        if (child.className === className) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    }

    setAttribute(name, value) {
      this.attributes[name] = value;
    }

    get childElementCount() {
      return this.children.length;
    }

    get firstElementChild() {
      return this.children[0] || null;
    }
  }

  it('reuses progress and activity cards without rescanning the transcript', () => {
    const originalDocument = globalThis.document;
    globalThis.document = {
      createElement: (tag) => new CardElement(tag),
      createTextNode: (text) => ({ textContent: text, parentElement: null }),
    };
    const chatArea = new CardElement('main');
    try {
      const progress = { runId: 'run-cache', currentAction: 'page_get_state', sequence: 1 };
      updatePageTaskProgress(chatArea, progress);
      updatePageTaskProgress(chatArea, { ...progress, sequence: 2 });
      const activity = { runId: 'run-cache', action: 'page_click', state: 'complete', sequence: 1 };
      updatePageActionActivity(chatArea, activity);
      updatePageActionActivity(chatArea, { ...activity, sequence: 2 });

      expect(chatArea.querySelectorAllCalls).toBe(2);
      expect(chatArea.children).toHaveLength(2);
      expect(chatArea.children[0].dataset.pageTaskProgress).toBe('true');
      expect(chatArea.children[1].dataset.pageActionActivity).toBe('true');
    } finally {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    }
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
    querySelectorAll() {
      return [];
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
    focus() {
      globalThis.document.activeElement = this;
    }
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

  it('hides persistent and run-wide trust choices on a host-marked sensitive site', () => {
    const chatArea = new FakeElement('div');
    chatArea.scrollHeight = 0;
    chatArea.scrollTop = 0;
    chatArea.clientHeight = 0;
    const card = renderPageActionConfirmation(
      chatArea,
      {
        confirmationId: 'sensitive-confirm',
        action: 'Click Save',
        siteOrigin: 'https://accounts.google.com',
        siteTrustAllowed: false,
      },
      vi.fn()
    );
    const controls = card.children.find((child) => child.className.includes('controls'));
    expect(
      controls.children.find((child) => child.textContent.includes('Always allow')).hidden
    ).toBe(true);
    expect(
      controls.children.find((child) => child.textContent.includes('Approve similar')).hidden
    ).toBe(true);
    expect(
      card.children.some((child) =>
        child.textContent.includes(
          'Saved site trust and run-wide approvals are unavailable on this sensitive site.'
        )
      )
    ).toBe(true);
  });

  it('focuses the approval card rather than approving by default', () => {
    const chatArea = new FakeElement('div');
    chatArea.scrollHeight = 0;
    chatArea.scrollTop = 0;
    chatArea.clientHeight = 0;
    const card = renderPageActionConfirmation(
      chatArea,
      { confirmationId: 'confirm-1', action: 'Click Save', summary: 'Click Save' },
      vi.fn()
    );
    expect(globalThis.document.activeElement).toBe(card);
    expect(card.tabIndex).toBe(-1);
    expect(card.attributes['aria-label']).toContain('Click Save');
  });

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
