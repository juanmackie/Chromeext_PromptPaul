import { describe, it, expect, vi } from 'vitest';
import {
  chatComposer,
  getContextState,
  getContextActions,
  getQuickActions,
  getOverflowActions,
  getLastUserPrompt,
  getLastAssistantBubble,
  isTrayVisible,
  ensureStopButton,
  ensureRecoveryRow,
} from '../src/chat/ChatComposer.js';

function makeElement(id, hidden = true) {
  return {
    id,
    hidden,
    children: [],
  };
}

function makeTray(...items) {
  const tray = { children: items };
  return tray;
}

function makeContainer(runState) {
  return { dataset: { runState } };
}

describe('getContextState', () => {
  it('handles HTMLCollection-like children (not just arrays)', () => {
    const item = makeElement('selected-text-strip', false);
    const collectionLike = {
      length: 1,
      0: item,
    };
    const tray = { children: collectionLike };
    const state = getContextState(tray, makeContainer('idle'));
    expect(state.hasSelectedText).toBe(true);
  });

  it('detects attached context from tray item visibility', () => {
    const tray = makeTray(
      makeElement('attachment-strip', true),
      makeElement('selected-text-strip', false),
      makeElement('page-context-strip', true)
    );
    const state = getContextState(tray, makeContainer('idle'));
    expect(state.hasSelectedText).toBe(true);
    expect(state.hasPageContext).toBe(false);
    expect(state.hasMedia).toBe(false);
    expect(state.isActive).toBe(false);
  });

  it('detects page context', () => {
    const tray = makeTray(
      makeElement('attachment-strip', true),
      makeElement('selected-text-strip', true),
      makeElement('page-context-strip', false)
    );
    expect(getContextState(tray, makeContainer('idle')).hasPageContext).toBe(true);
  });

  it('reads the run state and active flag', () => {
    const tray = makeTray();
    expect(getContextState(tray, makeContainer('streaming')).runState).toBe('streaming');
    expect(getContextState(tray, makeContainer('streaming')).isActive).toBe(true);
    expect(getContextState(tray, makeContainer('complete')).isActive).toBe(false);
    expect(getContextState(tray, makeContainer('bogus')).runState).toBe('idle');
  });

  it('tolerates missing tray and container', () => {
    const state = getContextState(null, null);
    expect(state.hasSelectedText).toBe(false);
    expect(state.hasPageContext).toBe(false);
    expect(state.hasMedia).toBe(false);
    expect(state.runState).toBe('idle');
  });
});

describe('getQuickActions / getContextActions / getOverflowActions', () => {
  it('offers text actions when text is attached', () => {
    const actions = getQuickActions({ hasSelectedText: true, hasPageContext: false });
    const labels = actions.map((a) => a.label);
    expect(labels).toContain('Analyze');
    expect(labels).toContain('Proofread');
    expect(labels).toContain('Explain');
    expect(labels).not.toContain('TL;DR');
  });

  it('offers page actions when page content is attached', () => {
    const actions = getQuickActions({ hasSelectedText: false, hasPageContext: true });
    const labels = actions.map((a) => a.label);
    expect(labels).toContain('Summary');
    expect(labels).toContain('TL;DR');
    expect(labels).toContain('Technical');
  });

  it('caps the combined row at four actions and keeps the rest in overflow', () => {
    const state = { hasSelectedText: true, hasPageContext: true };
    const visible = getQuickActions(state);
    const overflow = getOverflowActions(state);
    expect(visible).toHaveLength(4);
    expect(overflow).toHaveLength(2);
    const all = [...visible, ...overflow];
    expect(all).toHaveLength(6);
  });

  it('shows starter actions when no context is attached', () => {
    const state = { hasSelectedText: false, hasPageContext: false, hasMedia: false };
    const labels = getContextActions(state).map((a) => a.label);
    expect(labels).toContain('Summarize page');
    expect(labels).toContain('Ask about page');
    expect(labels).toContain('Act on page');
    expect(getQuickActions(state)).toHaveLength(3);
  });

  it('does not show starters once any context is attached', () => {
    const labels = getContextActions({ hasSelectedText: false, hasPageContext: true }).map(
      (a) => a.label
    );
    expect(labels).not.toContain('Summarize page');
    expect(labels).not.toContain('Ask about page');
  });

  it('includes site suggestions only while page context is attached', () => {
    const site = [
      { id: 'site:YouTube', label: 'YouTube', type: 'site', run: () => {} },
      { id: 'site:Transcript', label: 'Transcript', type: 'site', run: () => {} },
    ];
    const withPage = getContextActions({ hasPageContext: true }, site);
    expect(withPage.map((a) => a.label)).toContain('YouTube');
    const withoutPage = getContextActions({ hasSelectedText: true, hasPageContext: false }, site);
    expect(withoutPage.map((a) => a.label)).not.toContain('YouTube');
  });

  it('retains overflow actions in the overflow menu beyond the cap', () => {
    const state = { hasSelectedText: true, hasPageContext: true };
    const site = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`,
      label: `Site ${i}`,
      type: 'site',
      run: () => {},
    }));
    const total = getContextActions(state, site);
    const visible = getQuickActions(state, site);
    const overflow = getOverflowActions(state, site);
    expect(visible).toHaveLength(4);
    expect(overflow).toHaveLength(total.length - 4);
    expect([...visible, ...overflow]).toEqual(total);
  });
});

describe('isTrayVisible', () => {
  it('is false when every item is hidden', () => {
    const tray = makeTray(
      makeElement('attachment-strip', true),
      makeElement('selected-text-strip', true)
    );
    expect(isTrayVisible(tray)).toBe(false);
  });

  it('is true when any item is visible', () => {
    const tray = makeTray(
      makeElement('attachment-strip', true),
      makeElement('page-context-strip', false)
    );
    expect(isTrayVisible(tray)).toBe(true);
  });

  it('tolerates null', () => {
    expect(isTrayVisible(null)).toBe(false);
  });
});

describe('getLastUserPrompt', () => {
  function chatAreaWith(messages) {
    return {
      querySelectorAll(selector) {
        if (selector === '.user-message') return messages;
        if (selector === '.message.llm-message') return [];
        return [];
      },
    };
  }

  it('reads the dataset.prompt of the last user message', () => {
    const area = chatAreaWith([
      { dataset: { prompt: 'first' }, textContent: 'You: first' },
      { dataset: { prompt: 'second' }, textContent: 'You: second' },
    ]);
    expect(getLastUserPrompt(area)).toBe('second');
  });

  it('falls back to stripping the You: prefix', () => {
    const area = chatAreaWith([{ dataset: {}, textContent: 'You: fallback prompt' }]);
    expect(getLastUserPrompt(area)).toBe('fallback prompt');
  });

  it('returns null when there are no user messages', () => {
    expect(getLastUserPrompt(chatAreaWith([]))).toBeNull();
    expect(getLastUserPrompt(null)).toBeNull();
  });
});

describe('getLastAssistantBubble', () => {
  it('returns the last llm message', () => {
    const bubbles = [{ id: 1 }, { id: 2 }];
    const area = {
      querySelectorAll(selector) {
        return selector === '.message.llm-message' ? bubbles : [];
      },
    };
    expect(getLastAssistantBubble(area)).toBe(bubbles[1]);
  });

  it('returns null when empty', () => {
    const area = { querySelectorAll: () => [] };
    expect(getLastAssistantBubble(area)).toBeNull();
    expect(getLastAssistantBubble(null)).toBeNull();
  });
});

describe('initComposer controller', () => {
  function buildControllerFixtures() {
    const tray = makeTray(
      makeElement('attachment-strip', true),
      makeElement('selected-text-strip', true),
      makeElement('page-context-strip', true)
    );
    const container = makeContainer('idle');
    const row = { innerHTML: '', hidden: true, children: [] };
    const controller = chatComposer.initComposer({
      container,
      tray,
      row,
      chatArea: { querySelectorAll: () => [] },
      inputField: null,
      handlers: {},
    });
    return { controller, tray, container, row };
  }

  it('setPageContext toggles the tray and page strip', () => {
    const { controller, tray } = buildControllerFixtures();
    expect(tray.hidden).toBe(true); // no context initially
    controller.setPageContext({ details: 'https://example.com/article' });
    const pageStrip = tray.children.find((c) => c.id === 'page-context-strip');
    expect(pageStrip.hidden).toBe(false);
    expect(tray.hidden).toBe(false);
    controller.setPageContext(null);
    expect(pageStrip.hidden).toBe(true);
    expect(tray.hidden).toBe(true);
  });

  it('refresh picks up tray context changes', () => {
    const { controller, tray } = buildControllerFixtures();
    const textStrip = tray.children.find((c) => c.id === 'selected-text-strip');
    textStrip.hidden = false;
    controller.refresh();
    expect(tray.hidden).toBe(false);
  });

  it('refresh does not append a null Act indicator when Act is disabled', () => {
    // A DOM-like appendChild rejects non-Node children, mirroring the real
    // TypeError a fresh profile (Act disabled) would hit on every refresh.
    const realDocument = globalThis.document;
    globalThis.document = {
      createElement: (tag) => ({
        tagName: tag,
        children: [],
        addEventListener() {},
        setAttribute() {},
      }),
    };
    try {
      const row = {
        innerHTML: '',
        hidden: true,
        children: [],
        appendChild(child) {
          if (child == null) {
            throw new TypeError('appendChild: parameter 1 is not of type Node');
          }
          this.children.push(child);
          return child;
        },
      };
      const controller = chatComposer.initComposer({
        container: makeContainer('idle'),
        tray: makeTray(
          makeElement('attachment-strip', true),
          makeElement('selected-text-strip', true),
          makeElement('page-context-strip', true)
        ),
        row,
        chatArea: { querySelectorAll: () => [] },
        inputField: null,
        handlers: {},
      });
      expect(() => controller.refresh()).not.toThrow();
      expect(row.hidden).toBe(false); // starter actions remain visible
      expect(row.children.some((c) => c.className === 'ext-chip ext-chip--act')).toBe(false); // no Act indicator chip when Act is disabled
    } finally {
      globalThis.document = realDocument;
    }
  });

  it('returns a refresh function', () => {
    const { controller } = buildControllerFixtures();
    expect(typeof controller.refresh).toBe('function');
  });

  it('exposes site-action and Act-permission setters', () => {
    const { controller } = buildControllerFixtures();
    expect(typeof controller.setSiteActions).toBe('function');
    expect(typeof controller.setActEnabled).toBe('function');
  });

  it('enriches the page-context tray with source title, type, and truncation', () => {
    const titleEl = { textContent: '' };
    const detailsEl = { textContent: '' };
    const strip = makeElement('page-context-strip', true);
    strip.querySelector = (sel) => {
      if (sel === '#page-context-details') return detailsEl;
      if (sel === '.attachment-title') return titleEl;
      return null;
    };
    const tray = makeTray(strip);
    const row = { innerHTML: '', hidden: true, children: [] };
    const controller = chatComposer.initComposer({
      container: makeContainer('idle'),
      tray,
      row,
      chatArea: { querySelectorAll: () => [] },
      inputField: null,
      handlers: {},
    });
    controller.setPageContext({
      title: 'My Article (Medium)',
      details: 'https://example.com/a (trimmed)',
      truncated: true,
    });
    expect(titleEl.textContent).toBe('My Article (Medium)');
    expect(detailsEl.textContent).toContain('https://example.com/a');
    expect(detailsEl.textContent).toContain('trimmed to fit context budget');
    expect(strip.hidden).toBe(false);
  });
});

describe('ensureRecoveryRow prompt binding', () => {
  function makeFakeDocument() {
    function makeEl() {
      return {
        dataset: {},
        children: [],
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        setAttribute() {},
        addEventListener(type, fn) {
          this.listeners = this.listeners || {};
          (this.listeners[type] = this.listeners[type] || []).push(fn);
        },
      };
    }
    return { createElement: (tag) => Object.assign(makeEl(), { tagName: tag }) };
  }

  it('binds each recovery row to its originating prompt, not the newest', () => {
    const realDocument = globalThis.document;
    globalThis.document = makeFakeDocument();
    try {
      const messages = [{ dataset: { prompt: 'first' }, textContent: '' }];
      const chatArea = {
        querySelectorAll(selector) {
          return selector === '.user-message' ? messages : [];
        },
      };
      const handlers = { onPrompt: vi.fn(), onEdit: vi.fn() };
      const bubble1 = {
        querySelector: () => null,
        children: [],
        appendChild(child) {
          this.children.push(child);
        },
      };
      // First response row is created while 'first' is the latest prompt.
      ensureRecoveryRow(bubble1, { retry: true, edit: true }, handlers, chatArea);

      // Second turn: transcript grows and a second response gets its own row.
      messages.push({ dataset: { prompt: 'second' }, textContent: '' });
      const bubble2 = {
        querySelector: () => null,
        children: [],
        appendChild(child) {
          this.children.push(child);
        },
      };
      ensureRecoveryRow(bubble2, { retry: true, edit: true }, handlers, chatArea);

      // Retry/Edit on the first answer use the first request (no structured
      // identity captured yet, so the plain prompt is passed through).
      bubble1.children[0].children[0].listeners.click[0]();
      bubble1.children[0].children[1].listeners.click[0]();
      expect(handlers.onPrompt).toHaveBeenCalledWith('first', 'retry');
      expect(handlers.onEdit).toHaveBeenCalledWith('first', undefined);

      // The second answer's row binds to its own request.
      bubble2.children[0].children[0].listeners.click[0]();
      bubble2.children[0].children[1].listeners.click[0]();
      expect(handlers.onPrompt).toHaveBeenCalledWith('second', 'retry');
      expect(handlers.onEdit).toHaveBeenCalledWith('second', undefined);
    } finally {
      globalThis.document = realDocument;
    }
  });

  it('binds the originating request/context identity and replays OLD context after it changes', () => {
    const realDocument = globalThis.document;
    globalThis.document = makeFakeDocument();
    try {
      const oldRequest = {
        instruction: 'summarize this',
        context: { type: 'selected_text', text: 'OLD SELECTION TEXT' },
      };
      const messages = [{ dataset: { prompt: 'summarize this' }, textContent: '' }];
      messages[0].requestIdentity = oldRequest;
      const chatArea = {
        querySelectorAll(selector) {
          return selector === '.user-message' ? messages : [];
        },
      };
      const handlers = { onPrompt: vi.fn(), onEdit: vi.fn() };
      const bubble1 = {
        querySelector: () => null,
        children: [],
        appendChild(child) {
          this.children.push(child);
        },
      };
      // First response row captures the OLD context identity at creation time.
      ensureRecoveryRow(bubble1, { retry: true, edit: true }, handlers, chatArea);

      // Second turn: the selection/context changes.
      const newRequest = {
        instruction: 'summarize this',
        context: { type: 'selected_text', text: 'NEW SELECTION TEXT' },
      };
      const msg2 = { dataset: { prompt: 'summarize this' }, textContent: '' };
      msg2.requestIdentity = newRequest;
      messages.push(msg2);

      // Retry on the FIRST response still replays the OLD identity, not the
      // currently-attached NEW context.
      bubble1.children[0].children[0].listeners.click[0]();
      expect(handlers.onPrompt).toHaveBeenCalledTimes(1);
      const retryPayload = handlers.onPrompt.mock.calls[0][0];
      expect(retryPayload).toEqual({ instruction: 'summarize this', request: oldRequest });
      expect(retryPayload.request.context.text).toBe('OLD SELECTION TEXT');

      // Edit hands back the OLD request identity alongside the prompt.
      bubble1.children[0].children[1].listeners.click[0]();
      expect(handlers.onEdit).toHaveBeenCalledWith('summarize this', oldRequest);
    } finally {
      globalThis.document = realDocument;
    }
  });

  it('gates Retry for an unverified Act run, routing through fresh inspection', () => {
    const realDocument = globalThis.document;
    globalThis.document = makeFakeDocument();
    try {
      const messages = [{ dataset: { prompt: 'quit the tab' }, textContent: '' }];
      const chatArea = {
        querySelectorAll(selector) {
          return selector === '.user-message' ? messages : [];
        },
      };
      const handlers = { onPrompt: vi.fn(), onActFreshInspection: vi.fn() };
      const bubble = {
        querySelector: () => null,
        children: [],
        appendChild(child) {
          this.children.push(child);
        },
      };

      const gatedOutcome = { status: 'complete', unverified: true };
      ensureRecoveryRow(bubble, { retry: true, edit: false }, handlers, chatArea, gatedOutcome);

      const row = bubble.children[0];
      const gate = row.children[0];
      // The unverified mutation must NOT be blindly replayed through onPrompt.
      expect(gate.textContent).toBe('Re-inspect first');
      gate.listeners.click[0]();
      expect(handlers.onPrompt).not.toHaveBeenCalled();
      expect(handlers.onActFreshInspection).toHaveBeenCalledWith(gatedOutcome);
    } finally {
      globalThis.document = realDocument;
    }
  });

  it('keeps the plain Retry button when the Act outcome is verified or absent', () => {
    const realDocument = globalThis.document;
    globalThis.document = makeFakeDocument();
    try {
      const messages = [{ dataset: { prompt: 'summarize' }, textContent: '' }];
      const chatArea = {
        querySelectorAll(selector) {
          return selector === '.user-message' ? messages : [];
        },
      };
      const handlers = { onPrompt: vi.fn(), onActFreshInspection: vi.fn() };
      const bubble = {
        querySelector: () => null,
        children: [],
        appendChild(child) {
          this.children.push(child);
        },
      };
      ensureRecoveryRow(bubble, { retry: true, edit: false }, handlers, chatArea, {
        status: 'complete',
        verified: true,
      });
      expect(bubble.children[0].children[0].textContent).toBe('Retry');
      bubble.children[0].children[0].listeners.click[0]();
      expect(handlers.onPrompt).toHaveBeenCalledTimes(1);
      expect(handlers.onActFreshInspection).not.toHaveBeenCalled();
    } finally {
      globalThis.document = realDocument;
    }
  });
});

describe('DOM-building helpers', () => {
  it('are no-ops in a non-DOM environment', () => {
    expect(ensureStopButton({}, () => {})).toBeUndefined();
    expect(ensureRecoveryRow({}, {}, {}, {})).toBeUndefined();
  });

  it('expose the controller', () => {
    expect(typeof chatComposer.initComposer).toBe('function');
    expect(typeof chatComposer.getQuickActions).toBe('function');
  });
});
