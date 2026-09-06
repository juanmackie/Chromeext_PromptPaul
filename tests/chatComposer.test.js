import { describe, it, expect, vi } from 'vitest';
import {
  chatComposer,
  getContextState,
  getQuickActions,
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

describe('getQuickActions', () => {
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

  it('combines both groups when both contexts are attached', () => {
    const actions = getQuickActions({ hasSelectedText: true, hasPageContext: true });
    expect(actions).toHaveLength(6);
  });

  it('returns no actions without context', () => {
    expect(getQuickActions({ hasSelectedText: false, hasPageContext: false })).toHaveLength(0);
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

  it('returns a refresh function', () => {
    const { controller } = buildControllerFixtures();
    expect(typeof controller.refresh).toBe('function');
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

      // Retry/Edit on the first answer use the first request.
      bubble1.children[0].children[0].listeners.click[0]();
      bubble1.children[0].children[1].listeners.click[0]();
      expect(handlers.onPrompt).toHaveBeenCalledWith('first', 'retry');
      expect(handlers.onEdit).toHaveBeenCalledWith('first');

      // The second answer's row binds to its own request.
      bubble2.children[0].children[0].listeners.click[0]();
      bubble2.children[0].children[1].listeners.click[0]();
      expect(handlers.onPrompt).toHaveBeenCalledWith('second', 'retry');
      expect(handlers.onEdit).toHaveBeenCalledWith('second');
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
