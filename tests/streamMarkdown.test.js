import { describe, expect, it } from 'vitest';
import {
  advanceStreamingMarkdown,
  createStreamingMarkdownState,
  renderStreamingMarkdownDelta,
  STREAM_MARKDOWN_MAX_TAIL_CHARS,
} from '../src/utils/streamMarkdown.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.style = {};
    this.parentElement = null;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  replaceChildren() {
    this.children = [];
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
}

function fakeDocument() {
  return {
    createElement: (tagName) => new FakeElement(tagName),
    createDocumentFragment: () => new FakeElement('fragment'),
    createTextNode: (textContent) => ({ textContent, parentElement: null }),
    importNode: (node) => node,
  };
}

describe('streaming Markdown block scanner', () => {
  it('commits complete paragraphs and retains an incomplete tail', () => {
    const state = createStreamingMarkdownState();
    expect(advanceStreamingMarkdown(state, 'First paragraph.\n\nSecond')).toMatchObject({
      committed: 'First paragraph.\n\n',
      tail: 'Second',
      inFence: false,
    });
  });

  it.each([
    ['```js\nconst x = 1;\n```\n\nnext', '```js\nconst x = 1;\n```\n\n', 'next'],
    ['~~~\ncode\n~~~\nrest', '~~~\ncode\n~~~\n', 'rest'],
    ['```js\r\ncode\r\n```\r\nnext', '```js\r\ncode\r\n```\r\n', 'next'],
  ])('does not commit code before the fence closes', (input, expectedCommitted, expectedTail) => {
    const state = createStreamingMarkdownState();
    expect(advanceStreamingMarkdown(state, input)).toMatchObject({
      committed: expectedCommitted,
      tail: expectedTail,
      inFence: false,
      fenceClosed: true,
    });
  });

  it('does not rescan the retained opening fence from the post-fence state', () => {
    const state = createStreamingMarkdownState();
    expect(advanceStreamingMarkdown(state, '```\ncode').inFence).toBe(true);

    const result = advanceStreamingMarkdown(state, '\nmore');

    expect(result).toMatchObject({ committed: '', tail: '```\ncode\nmore', inFence: true });
  });

  it('does not duplicate the unfinished tail after a hidden-render recovery', () => {
    const state = createStreamingMarkdownState();
    const element = new FakeElement();
    const input = {
      element,
      state,
      renderMarkdown: (markdown) => (markdown ? `<p>${markdown}</p>` : ''),
      documentRef: fakeDocument(),
      DOMParserCtor: class {
        parseFromString() {
          return { body: { childNodes: [] } };
        }
      },
    };

    renderStreamingMarkdownDelta({ ...input, delta: 'abc', accumulatedText: 'abc', hidden: true });
    renderStreamingMarkdownDelta({ ...input, delta: '', accumulatedText: 'abc' });
    renderStreamingMarkdownDelta({ ...input, delta: 'd', accumulatedText: 'abcd' });

    expect(element.children).toHaveLength(1);
    expect(element.children[0].innerHTML).toBe('<p>abcd</p>');
  });

  it('keeps text after a closed fence in the unfinished tail', () => {
    const state = createStreamingMarkdownState();
    expect(advanceStreamingMarkdown(state, '```\ncode\n```\nnext\nmore')).toMatchObject({
      committed: '```\ncode\n```\n',
      tail: 'next\nmore',
      inFence: false,
      fenceClosed: true,
    });
  });

  it('does not treat a different fence marker as a close', () => {
    const state = createStreamingMarkdownState();
    const result = advanceStreamingMarkdown(state, '```\ncode\n~~~\nmore');
    expect(result.inFence).toBe(true);
    expect(result.committed).toBe('');
  });

  it('bounds long newline-delimited tails without cutting a line', () => {
    const state = createStreamingMarkdownState();
    const result = advanceStreamingMarkdown(state, `${'line\n'.repeat(800)}tail`);
    expect(result.committed.length).toBeGreaterThan(0);
    expect(result.tail.length).toBeLessThanOrEqual(STREAM_MARKDOWN_MAX_TAIL_CHARS);
    expect(result.committed.endsWith('\n')).toBe(true);
  });

  it('keeps an open code fence literal instead of splitting it at the tail limit', () => {
    const state = createStreamingMarkdownState();
    const result = advanceStreamingMarkdown(state, '```js\n' + 'code line\n'.repeat(300));
    expect(result.inFence).toBe(true);
    expect(result.committed).toBe('');
    expect(result.tail.length).toBeGreaterThan(STREAM_MARKDOWN_MAX_TAIL_CHARS);
  });

  it('bounds cumulative parse work for a long paragraph stream', () => {
    const state = createStreamingMarkdownState();
    const element = new FakeElement();
    const documentRef = fakeDocument();
    const DOMParserCtor = class {
      parseFromString() {
        return { body: { childNodes: [] } };
      }
    };
    const answer = Array.from(
      { length: 400 },
      (_, index) => `Paragraph ${index}: ${'x'.repeat(72)}\n\n`
    ).join('');
    let accumulatedText = '';
    let parsedChars = 0;
    for (let offset = 0; offset < answer.length; offset += 128) {
      const delta = answer.slice(offset, offset + 128);
      accumulatedText += delta;
      renderStreamingMarkdownDelta({
        element,
        delta,
        state,
        accumulatedText,
        renderMarkdown: (text) => {
          parsedChars += text.length;
          return text;
        },
        documentRef,
        DOMParserCtor,
      });
    }
    expect(parsedChars).toBeLessThan(answer.length * 3);
    expect(state.tail.length).toBeLessThanOrEqual(STREAM_MARKDOWN_MAX_TAIL_CHARS);
  });

  it('does not parse an open code fence while it streams', () => {
    const state = createStreamingMarkdownState();
    const element = new FakeElement();
    let parsedChars = 0;
    const text = '```js\n' + 'const value = 1;\n'.repeat(200);
    renderStreamingMarkdownDelta({
      element,
      delta: text,
      state,
      accumulatedText: text,
      renderMarkdown: (markdown) => {
        parsedChars += markdown.length;
        return markdown;
      },
      documentRef: fakeDocument(),
      DOMParserCtor: class {
        parseFromString() {
          return { body: { childNodes: [] } };
        }
      },
    });
    expect(parsedChars).toBe(0);
    expect(state.inFence).toBe(true);
  });

  it('supports empty input without changing state', () => {
    const state = createStreamingMarkdownState();
    expect(advanceStreamingMarkdown(state, '')).toEqual({
      committed: '',
      tail: '',
      inFence: false,
      fenceClosed: false,
    });
  });
});
