import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const marked = createRequire(import.meta.url)('marked');

vi.mock('../loadingManager.js', () => ({
  loadingManager: { showToast: vi.fn() },
}));

import { ChatUI } from '../src/chat/ChatUI.js';
import { StreamStateManager } from '../src/chat/ChatStream.js';
import { renderMarkdown } from '../src/utils/domSanitizer.js';

describe('StreamStateManager orchestrator event ordering', () => {
  it('keeps a conversation identity until an explicit new chat', () => {
    const state = new StreamStateManager();
    const original = state.getConversationId();
    state.addMessageToHistory({ role: 'user', content: 'hello' });

    expect(state.getConversationId()).toBe(original);
    state.startNewConversation();
    expect(state.getConversationId()).not.toBe(original);
    expect(state.getConversationHistory()).toEqual([]);
  });

  it('buffers out-of-order events until the missing sequence arrives', () => {
    const state = new StreamStateManager();
    const second = { type: 'tool_complete', sequence: 2 };
    const first = { type: 'tool_ready', sequence: 1 };

    expect(state.queueOrchestratorEvent(second)).toEqual([]);
    expect(state.queueOrchestratorEvent(first)).toEqual([first, second]);
  });

  it('ignores duplicate and stale events', () => {
    const state = new StreamStateManager();
    const first = { type: 'content', sequence: 1 };

    expect(state.queueOrchestratorEvent(first)).toEqual([first]);
    expect(state.queueOrchestratorEvent(first)).toEqual([]);
    expect(state.queueOrchestratorEvent({ type: 'content', sequence: 0 })).toEqual([
      { type: 'content', sequence: 0 },
    ]);
  });

  it('flushes buffered events before a terminal event when a sequence is unavailable', () => {
    const state = new StreamStateManager();
    const second = { type: 'tool_complete', sequence: 2 };
    const terminal = { type: 'complete', sequence: 3 };

    expect(state.queueOrchestratorEvent(second)).toEqual([]);
    expect(state.queueOrchestratorEvent(terminal)).toEqual([second, terminal]);
  });

  it('starts after the last sequence represented by a reconnect journal', () => {
    const state = new StreamStateManager();
    state.setNextOrchestratorEventSequence(4);
    const event = { type: 'tool_ready', sequence: 5 };

    expect(state.queueOrchestratorEvent(event)).toEqual([event]);
  });

  it('expands coalesced stream batches in original segment order', () => {
    const state = new StreamStateManager();
    const batch = {
      type: 'stream_batch',
      sequence: 1,
      timestamp: 10,
      events: [
        { type: 'content', data: 'Hello ' },
        { type: 'reasoning', data: 'thinking' },
        { type: 'content', data: 'world' },
        { type: 'ignored', data: 'x' },
      ],
    };

    expect(state.queueOrchestratorEvent(batch)).toEqual([
      { type: 'content', data: 'Hello ', sequence: 1, timestamp: 10 },
      { type: 'reasoning', data: 'thinking', sequence: 1, timestamp: 10 },
      { type: 'content', data: 'world', sequence: 1, timestamp: 10 },
    ]);
  });

  it('includes queued deltas when reading streamed text before the next render frame', () => {
    vi.useFakeTimers();
    const state = new StreamStateManager();
    state.queueRenderChunk('queued tail');
    expect(state.getStreamedText()).toBe('queued tail');
    state.clearStreamedText();
    vi.useRealTimers();
  });

  it('flushes queued reasoning before starting the next model turn', () => {
    vi.useFakeTimers();
    try {
      const state = new StreamStateManager();
      const reasoningElement = { innerHTML: '' };
      state.setReasoningContentElement(reasoningElement);
      state.queueRenderReasoning('short reasoning tail');

      state.startNewTurn();

      expect(reasoningElement.innerHTML).toContain('short reasoning tail');
      expect(state._reasoningBuffer).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([false, true])(
    'renders all accumulated reasoning on finalization after hidden flush (visibility restored: %s)',
    (restoreVisibility) => {
      const previousDocument = globalThis.document;
      const previousDOMParser = globalThis.DOMParser;
      const createElement = (tagName) => ({
        tagName: tagName.toUpperCase(),
        children: [],
        _html: '',
        appendChild(child) {
          this.children.push(child);
          child.parentElement = this;
          return child;
        },
        replaceChildren() {
          this._html = '';
          this.children = [];
        },
        set innerHTML(value) {
          this._html = String(value);
          this.children = [];
        },
        get innerHTML() {
          return (
            this._html +
            this.children.map((child) => child.innerHTML || child.textContent || '').join('')
          );
        },
      });
      globalThis.document = {
        visibilityState: 'hidden',
        createElement,
        createDocumentFragment: () => createElement('fragment'),
        createTextNode: (textContent) => ({ textContent }),
        importNode: (node) => node,
      };
      globalThis.DOMParser = class {};

      try {
        const state = new StreamStateManager();
        const reasoningElement = createElement('div');
        state.setReasoningContentElement(reasoningElement);
        state.queueRenderReasoning('hidden reasoning stays complete');

        state.flushPendingReasoning();
        expect(state._reasoningBuffer).toBe('');
        expect(state._reasoningMarkdownState.needsFullRender).toBe(true);
        if (restoreVisibility) globalThis.document.visibilityState = 'visible';

        state.finalizeReasoning();

        expect(reasoningElement.innerHTML).toContain('hidden reasoning stays complete');
      } finally {
        globalThis.document = previousDocument;
        globalThis.DOMParser = previousDOMParser;
      }
    }
  );

  it.each([
    [
      'reference links across blocks',
      'See [docs][d].\n\n[d]: https://example.com',
      ['See [docs][d].\n\n', '[d]: https://example.com'],
    ],
    ['unfinished fenced blocks', '```\ncode', ['```\ncode']],
  ])(
    'renders canonical full Markdown for reasoning when finalizing (%s)',
    (_case, markdown, chunks) => {
      const previousDocument = globalThis.document;
      const previousDOMParser = globalThis.DOMParser;
      const previousMarked = globalThis.marked;
      const previousDOMPurify = globalThis.DOMPurify;
      const makeElement = (tagName = 'div') => ({
        tagName: tagName.toUpperCase(),
        children: [],
        parentElement: null,
        _html: '',
        appendChild(child) {
          this.children.push(child);
          child.parentElement = this;
          return child;
        },
        replaceChildren() {
          this._html = '';
          this.children = [];
        },
        remove() {
          if (!this.parentElement) return;
          this.parentElement.children = this.parentElement.children.filter(
            (child) => child !== this
          );
          this.parentElement = null;
        },
        set innerHTML(value) {
          this._html = String(value);
          this.children = [];
        },
        get innerHTML() {
          return (
            this._html +
            this.children.map((child) => child.innerHTML || child.textContent || '').join('')
          );
        },
      });
      globalThis.document = {
        visibilityState: 'visible',
        createElement: makeElement,
        createDocumentFragment: () => makeElement('fragment'),
        createTextNode: (textContent) => ({ textContent }),
        importNode: (node) => node,
      };
      globalThis.DOMParser = class {
        parseFromString(markdownHtml) {
          const node = makeElement('span');
          node.innerHTML = markdownHtml;
          return { body: { childNodes: [node] } };
        }
      };
      globalThis.marked = marked;
      delete globalThis.DOMPurify;
      const parseSpy = vi.spyOn(marked, 'parse');

      try {
        const state = new StreamStateManager();
        const reasoningElement = makeElement();
        state.setReasoningContentElement(reasoningElement);
        for (const chunk of chunks) {
          state.queueRenderReasoning(chunk);
          state.flushPendingReasoning();
        }

        state.finalizeReasoning();
        const canonicalHtml = reasoningElement.innerHTML;
        const parseCount = parseSpy.mock.calls.length;
        state.finalizeReasoning();

        expect(parseSpy).toHaveBeenCalledTimes(parseCount);
        expect(canonicalHtml).toBe(renderMarkdown(markdown));
        const continuation = `${markdown}\nMore.`;
        state.queueRenderReasoning('\nMore.');
        state.flushPendingReasoning();
        state.finalizeReasoning();

        expect(reasoningElement.innerHTML).toBe(renderMarkdown(continuation));
      } finally {
        parseSpy.mockRestore();
        globalThis.document = previousDocument;
        globalThis.DOMParser = previousDOMParser;
        if (previousMarked === undefined) delete globalThis.marked;
        else globalThis.marked = previousMarked;
        if (previousDOMPurify === undefined) delete globalThis.DOMPurify;
        else globalThis.DOMPurify = previousDOMPurify;
      }
    }
  );

  it('passes through events from legacy senders without sequence metadata', () => {
    const state = new StreamStateManager();
    const event = { type: 'content', data: 'Hello' };

    expect(state.queueOrchestratorEvent(event)).toEqual([event]);
  });
});

describe('ChatUI message placement', () => {
  it('protects the active response from transcript trimming', () => {
    const chatArea = {
      children: [],
      removeChild(node) {
        this.children.splice(this.children.indexOf(node), 1);
        node.parentNode = null;
      },
    };
    const response = { parentNode: chatArea };
    chatArea.children.push(response);
    for (let index = 0; index < 100; index += 1) {
      const trace = { parentNode: chatArea };
      chatArea.children.push(trace);
    }

    const ui = new ChatUI();
    ui.chatArea = chatArea;
    ui.currentStreamingMessageDiv = response;
    ui.trimExcessMessages();

    expect(chatArea.children).toHaveLength(100);
    expect(chatArea.children).toContain(response);
  });

  it('moves the completed response after tool activity', () => {
    const previousDocument = globalThis.document;
    globalThis.document = { activeElement: null };
    const chatArea = {
      children: [],
      scrollHeight: 100,
      scrollTop: 0,
      clientHeight: 40,
      get lastElementChild() {
        return this.children[this.children.length - 1] || null;
      },
      appendChild(node) {
        const existingIndex = this.children.indexOf(node);
        if (existingIndex >= 0) this.children.splice(existingIndex, 1);
        this.children.push(node);
        node.parentNode = this;
      },
    };
    const response = { parentNode: chatArea, contains: () => false };
    const toolTrace = { parentNode: chatArea };
    chatArea.children.push(response, toolTrace);

    const ui = new ChatUI();
    ui.chatArea = chatArea;

    try {
      expect(ui.moveMessageToEnd(response)).toBe(true);
      expect(chatArea.children).toEqual([toolTrace, response]);
      expect(chatArea.scrollTop).toBe(chatArea.scrollHeight);
    } finally {
      globalThis.document = previousDocument;
    }
  });

  it('preserves the reader scroll position and focus when a card response moves', () => {
    const focusedFilter = { focus: vi.fn() };
    const doc = {
      body: {},
      activeElement: focusedFilter,
    };
    focusedFilter.focus.mockImplementation(() => {
      doc.activeElement = focusedFilter;
    });
    const previousDocument = globalThis.document;
    globalThis.document = doc;
    const chatArea = {
      children: [],
      scrollHeight: 700,
      scrollTop: 220,
      clientHeight: 400,
      get lastElementChild() {
        return this.children[this.children.length - 1] || null;
      },
      appendChild(node) {
        if (node.contains?.(doc.activeElement)) doc.activeElement = doc.body;
        const existingIndex = this.children.indexOf(node);
        if (existingIndex >= 0) this.children.splice(existingIndex, 1);
        this.children.push(node);
        node.parentNode = this;
      },
    };
    const response = {
      parentNode: chatArea,
      contains: (node) => node === focusedFilter,
    };
    const toolTrace = { parentNode: chatArea };
    chatArea.children.push(response, toolTrace);

    const ui = new ChatUI();
    ui.chatArea = chatArea;

    try {
      expect(ui.moveMessageToEnd(response, { preserveViewport: true })).toBe(true);
      expect(chatArea.children).toEqual([toolTrace, response]);
      expect(chatArea.scrollTop).toBe(220);
      expect(doc.activeElement).toBe(focusedFilter);
      expect(focusedFilter.focus).toHaveBeenCalledWith({ preventScroll: true });
    } finally {
      globalThis.document = previousDocument;
    }
  });
});
