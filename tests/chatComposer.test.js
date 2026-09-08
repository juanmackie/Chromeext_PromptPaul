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
  resolveDocumentDrop,
  buildDocumentPromptRequest,
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
    expect(state.hasDocument).toBe(false);
    expect(state.runState).toBe('idle');
  });

  it('detects a pending document attachment', () => {
    const tray = makeTray(
      makeElement('attachment-strip', true),
      makeElement('document-strip', false),
      makeElement('selected-text-strip', true),
      makeElement('page-context-strip', true)
    );
    const state = getContextState(tray, makeContainer('idle'));
    expect(state.hasDocument).toBe(true);
    expect(state.hasMedia).toBe(false);
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

  it('treats a pending document as attached context for starter actions', () => {
    const labels = getContextActions({
      hasSelectedText: false,
      hasPageContext: false,
      hasDocument: true,
    }).map((a) => a.label);
    expect(labels).not.toContain('Summarize page');
    expect(labels).not.toContain('Ask about page');
    expect(labels).not.toContain('Act on page');
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

describe('resolveDocumentDrop', () => {
  const docPlan = (name, text = 'content') => ({
    kind: 'document',
    preview: { type: 'text', name, truncated: false, lineCount: 2 },
    instruction: 'Analyze this attached document.',
    text,
  });

  it('returns no attachment and no message without document plans', () => {
    expect(resolveDocumentDrop([])).toEqual({ attach: null, limitMessage: null });
    expect(resolveDocumentDrop([{ kind: 'media' }, { kind: 'invalid', error: 'x' }])).toEqual({
      attach: null,
      limitMessage: null,
    });
    expect(resolveDocumentDrop(null)).toEqual({ attach: null, limitMessage: null });
  });

  it('attaches the first document without a limit message', () => {
    const { attach, limitMessage } = resolveDocumentDrop([docPlan('notes.txt')]);
    expect(attach).toMatchObject({ name: 'notes.txt', text: 'content', truncated: false });
    expect(limitMessage).toBeNull();
  });

  it('keeps only the first document and reports one single-document limit message', () => {
    const { attach, limitMessage } = resolveDocumentDrop([
      docPlan('a.txt'),
      docPlan('b.csv'),
      docPlan('c.json'),
    ]);
    expect(attach.name).toBe('a.txt');
    expect(limitMessage).toContain('Only one document can be attached at a time');
    expect(limitMessage).toContain('a.txt');
    expect(limitMessage).toContain('c.json');
    expect(limitMessage).toContain('b.csv');
  });

  it('ignores malformed document plans', () => {
    expect(resolveDocumentDrop([{ kind: 'document', preview: { name: '' }, text: '  ' }])).toEqual({
      attach: null,
      limitMessage: null,
    });
  });
});

describe('buildDocumentPromptRequest', () => {
  const doc = {
    name: 'notes.txt',
    text: 'line one\nline two',
    truncated: false,
    lineCount: 2,
    instruction: 'Analyze this attached document.',
  };

  it('builds the structured document context with bounded name metadata', () => {
    const request = buildDocumentPromptRequest('Who owns the migration?', doc);
    expect(request.instruction).toBe('Who owns the migration?');
    expect(request.context).toEqual({
      type: 'document',
      text: 'line one\nline two',
      metadata: { name: 'notes.txt' },
    });
    expect(JSON.stringify(request)).not.toContain('base64');
  });

  it('falls back to the document instruction when the typed prompt is empty', () => {
    const request = buildDocumentPromptRequest('   ', doc);
    expect(request.instruction).toBe('Analyze this attached document.');
    expect(request.context.type).toBe('document');
  });

  it('returns null without a usable document', () => {
    expect(buildDocumentPromptRequest('hi', null)).toBeNull();
    expect(buildDocumentPromptRequest('hi', { name: '', text: 'x' })).toBeNull();
  });
});

describe('initComposer pending document', () => {
  function makeDocumentButton(id) {
    return {
      id,
      hidden: false,
      listeners: {},
      addEventListener(type, fn) {
        (this.listeners[type] = this.listeners[type] || []).push(fn);
      },
      click() {
        (this.listeners.click || []).forEach((fn) => fn());
      },
    };
  }

  function makeDocumentStripFixture() {
    const els = {
      '#document-title': makeDocumentButton('document-title'),
      '#document-details': makeDocumentButton('document-details'),
      '#document-remove-button': makeDocumentButton('document-remove-button'),
      '#document-conflict-actions': makeDocumentButton('document-conflict-actions'),
      '#document-replace-button': makeDocumentButton('document-replace-button'),
      '#document-keep-button': makeDocumentButton('document-keep-button'),
    };
    const strip = {
      id: 'document-strip',
      hidden: true,
      querySelector: (sel) => els[sel] || null,
    };
    return { strip, els };
  }

  function buildDocumentFixtures() {
    const { strip, els } = makeDocumentStripFixture();
    const tray = makeTray(
      makeElement('attachment-strip', true),
      makeElement('selected-text-strip', true),
      makeElement('page-context-strip', true),
      strip
    );
    tray.hidden = true;
    const row = { innerHTML: '', hidden: true, children: [] };
    const controller = chatComposer.initComposer({
      container: makeContainer('idle'),
      tray,
      row,
      chatArea: { querySelectorAll: () => [] },
      inputField: null,
      handlers: {},
    });
    return { controller, tray, strip, els };
  }

  const doc = (name, text = 'a\nb', extra = {}) => ({
    name,
    text,
    lineCount: 2,
    ...extra,
  });

  it('attaches a pending document with filename, line count, and truncation status', () => {
    const { controller, tray, strip, els } = buildDocumentFixtures();
    controller.setPendingDocument(doc('notes.txt', 'a\nb', { truncated: true }));
    expect(strip.hidden).toBe(false);
    expect(tray.hidden).toBe(false);
    expect(els['#document-title'].textContent).toBe('notes.txt');
    expect(els['#document-details'].textContent).toContain('2 lines');
    expect(els['#document-details'].textContent).toContain('truncated to fit the context budget');
    expect(els['#document-conflict-actions'].hidden).toBe(true);
    expect(els['#document-remove-button'].hidden).toBe(false);
  });

  it('exposes and clears the pending document record', () => {
    const { controller, tray } = buildDocumentFixtures();
    expect(controller.getPendingDocument()).toBeNull();
    controller.setPendingDocument(doc('a.txt', 'hello'));
    expect(controller.getPendingDocument()).toMatchObject({ name: 'a.txt', text: 'hello' });
    controller.clearPendingDocument();
    expect(controller.getPendingDocument()).toBeNull();
    expect(tray.hidden).toBe(true);
  });

  it('ignores unusable pending documents', () => {
    const { controller, tray } = buildDocumentFixtures();
    controller.setPendingDocument(null);
    controller.setPendingDocument({ name: '', text: 'x' });
    controller.setPendingDocument({ name: 'a.txt', text: '   ' });
    expect(controller.getPendingDocument()).toBeNull();
    expect(tray.hidden).toBe(true);
  });

  it('offers an explicit Replace / Keep current choice for a second document', () => {
    const { controller, strip, els } = buildDocumentFixtures();
    controller.setPendingDocument(doc('first.txt', 'one'));
    controller.setPendingDocument(doc('second.txt', 'two'));

    expect(els['#document-title'].textContent).toBe('Replace attached document?');
    expect(els['#document-details'].textContent).toContain('"second.txt"');
    expect(els['#document-details'].textContent).toContain('"first.txt"');
    expect(els['#document-conflict-actions'].hidden).toBe(false);
    expect(els['#document-remove-button'].hidden).toBe(true);
    // The original document is still the pending attachment.
    expect(controller.getPendingDocument().name).toBe('first.txt');
    expect(strip.hidden).toBe(false);
  });

  it('replaces only after the explicit Replace choice', () => {
    const { controller, els } = buildDocumentFixtures();
    controller.setPendingDocument(doc('first.txt', 'one'));
    controller.setPendingDocument(doc('second.txt', 'two'));
    els['#document-replace-button'].click();
    expect(controller.getPendingDocument().name).toBe('second.txt');
    expect(els['#document-conflict-actions'].hidden).toBe(true);
    expect(els['#document-title'].textContent).toBe('second.txt');
  });

  it('keeps the original document after the Keep current choice', () => {
    const { controller, els } = buildDocumentFixtures();
    controller.setPendingDocument(doc('first.txt', 'one'));
    controller.setPendingDocument(doc('second.txt', 'two'));
    els['#document-keep-button'].click();
    expect(controller.getPendingDocument().name).toBe('first.txt');
    expect(els['#document-conflict-actions'].hidden).toBe(true);
    expect(els['#document-title'].textContent).toBe('first.txt');
  });

  it('removes the pending document via the Remove button', () => {
    const { controller, tray, els } = buildDocumentFixtures();
    controller.setPendingDocument(doc('a.txt', 'one'));
    els['#document-remove-button'].click();
    expect(controller.getPendingDocument()).toBeNull();
    expect(tray.hidden).toBe(true);
  });

  it('clears the chip only for a successful sent run and retains it on failure', () => {
    const { controller, tray } = buildDocumentFixtures();
    controller.setPendingDocument(doc('a.txt', 'hello'));
    controller.beginDocumentSend();
    controller.finishDocumentSend();
    expect(controller.getPendingDocument()).toBeNull();
    expect(tray.hidden).toBe(true);

    // Failed submission: begin then cancel retains the attachment.
    controller.setPendingDocument(doc('b.txt', 'kept'));
    controller.beginDocumentSend();
    controller.cancelDocumentSend();
    expect(controller.getPendingDocument()).toMatchObject({ name: 'b.txt' });

    // A successful non-document run never clears an unclaimed attachment.
    controller.beginDocumentSend();
    controller.cancelDocumentSend();
    controller.finishDocumentSend();
    expect(controller.getPendingDocument()).toMatchObject({ name: 'b.txt' });

    // finishDocumentSend without begin is a no-op.
    controller.finishDocumentSend();
    expect(controller.getPendingDocument()).toMatchObject({ name: 'b.txt' });
  });
});
