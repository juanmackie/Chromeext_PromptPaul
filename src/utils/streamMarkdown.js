/**
 * @fileoverview Track safe block boundaries while streaming Markdown.
 * @module streamMarkdown
 */

export const STREAM_MARKDOWN_MAX_TAIL_CHARS = 2_000;

export function createStreamingMarkdownState() {
  return {
    tail: '',
    tailInFence: false,
    tailFenceChar: '',
    tailFenceLength: 0,
    inFence: false,
    fenceChar: '',
    fenceLength: 0,
    renderedElement: null,
    tailElement: null,
    needsFullRender: false,
  };
}

/**
 * Append text and commit complete Markdown blocks while retaining a small tail.
 * @param {{tail: string, inFence: boolean, fenceChar: string, fenceLength: number}} state
 * @param {unknown} text
 * @returns {{committed: string, tail: string, inFence: boolean, fenceClosed: boolean}}
 */
export function advanceStreamingMarkdown(state, text) {
  const input = `${state.tail || ''}${String(text ?? '')}`;
  let inFence = Boolean(state.tailInFence ?? state.inFence);
  let fenceChar = state.tailFenceChar ?? state.fenceChar ?? '';
  let fenceLength = Math.max(0, Number(state.tailFenceLength ?? state.fenceLength) || 0);
  let committedIndex = 0;
  let committedState = { inFence, fenceChar, fenceLength };
  let trimBoundaryPosition =
    input.lastIndexOf('\n', input.length - STREAM_MARKDOWN_MAX_TAIL_CHARS) + 1;
  let trimBoundaryState = null;
  let fenceClosed = false;
  let lineStart = 0;

  for (let newline = input.indexOf('\n'); newline >= 0; newline = input.indexOf('\n', lineStart)) {
    const line = input.slice(lineStart, newline).replace(/\r$/u, '');
    let closedFenceThisLine = false;
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceChar = marker[0];
        fenceLength = marker.length;
      } else if (
        marker[0] === fenceChar &&
        marker.length >= fenceLength &&
        /^\s*$/u.test(fence[2])
      ) {
        inFence = false;
        fenceChar = '';
        fenceLength = 0;
        fenceClosed = true;
        closedFenceThisLine = true;
      }
    }
    const boundaryState = { inFence, fenceChar, fenceLength };
    if (newline + 1 === trimBoundaryPosition) trimBoundaryState = boundaryState;
    const blankLine = !line.trim() && lineStart > 0;
    if ((!inFence && blankLine) || closedFenceThisLine) {
      committedIndex = newline + 1;
      committedState = boundaryState;
    }
    lineStart = newline + 1;
  }

  if (input.length - committedIndex > STREAM_MARKDOWN_MAX_TAIL_CHARS && !inFence) {
    const boundary = input.lastIndexOf('\n', input.length - STREAM_MARKDOWN_MAX_TAIL_CHARS);
    const boundaryPosition = boundary + 1;
    if (boundary >= committedIndex && boundaryPosition > committedIndex) {
      committedIndex = boundaryPosition;
      committedState =
        boundaryPosition === trimBoundaryPosition ? trimBoundaryState : committedState;
    }
  }
  const remainder = input.slice(committedIndex);
  state.tail = remainder;
  state.tailInFence = committedState.inFence;
  state.tailFenceChar = committedState.fenceChar;
  state.tailFenceLength = committedState.fenceLength;
  state.inFence = inFence;
  state.fenceChar = fenceChar;
  state.fenceLength = fenceLength;
  return {
    committed: input.slice(0, committedIndex),
    tail: remainder,
    inFence,
    fenceClosed,
  };
}

function rescanAccumulatedText(state, accumulatedText) {
  state.tail = '';
  state.tailInFence = false;
  state.tailFenceChar = '';
  state.tailFenceLength = 0;
  state.inFence = false;
  state.fenceChar = '';
  state.fenceLength = 0;
  return advanceStreamingMarkdown(state, accumulatedText);
}

function renderFullAccumulatedState({
  element,
  state,
  accumulatedText,
  renderMarkdown,
  documentRef,
  DOMParserCtor,
}) {
  const update = rescanAccumulatedText(state, accumulatedText);
  state.tailElement?.remove();
  state.tailElement = null;
  state.renderedTailText = '';

  if (typeof DOMParserCtor !== 'function' || !documentRef) {
    element.innerHTML = renderMarkdown(accumulatedText);
    state.needsFullRender = true;
  } else {
    element.innerHTML = renderMarkdown(update.committed);
    if (update.tail) {
      const tailElement = documentRef.createElement(update.inFence ? 'pre' : 'div');
      tailElement.className = 'stream-md-tail';
      if (update.inFence) {
        tailElement.textContent = update.tail;
        state.renderedTailText = update.tail;
      } else {
        tailElement.innerHTML = renderMarkdown(update.tail);
      }
      element.appendChild(tailElement);
      state.tailElement = tailElement;
    }
    state.needsFullRender = false;
  }
  state.renderedElement = element;
}

/**
 * Render only newly committed blocks and the bounded unfinished tail.
 * @param {{element: HTMLElement, delta: string, state: object, accumulatedText: string,
 *   renderMarkdown: (markdown: string) => string, documentRef: Document|null,
 *   DOMParserCtor: typeof DOMParser|null, hidden: boolean}} input
 */
export function renderStreamingMarkdownDelta({
  element,
  delta,
  state,
  accumulatedText,
  renderMarkdown,
  documentRef,
  DOMParserCtor,
  hidden = false,
}) {
  if (!documentRef || typeof DOMParserCtor !== 'function') {
    renderFullAccumulatedState({
      element,
      state,
      accumulatedText,
      renderMarkdown,
      documentRef,
      DOMParserCtor,
    });
    return;
  }
  if (hidden) {
    state.needsFullRender = true;
    return;
  }
  if (
    state.needsFullRender ||
    (state.renderedElement && state.renderedElement !== element) ||
    (state.tailElement?.parentElement && state.tailElement.parentElement !== element)
  ) {
    renderFullAccumulatedState({
      element,
      state,
      accumulatedText,
      renderMarkdown,
      documentRef,
      DOMParserCtor,
    });
    return;
  }

  const update = advanceStreamingMarkdown(state, delta);
  if (!state.renderedElement) {
    element.replaceChildren();
    state.renderedElement = element;
  }
  if (update.committed) {
    state.tailElement?.remove();
    state.tailElement = null;
    const parsed = new DOMParserCtor().parseFromString(
      renderMarkdown(update.committed),
      'text/html'
    );
    const fragment = documentRef.createDocumentFragment();
    for (const node of parsed.body.childNodes)
      fragment.appendChild(documentRef.importNode(node, true));
    element.appendChild(fragment);
  }
  if (!update.tail) return;
  if (update.inFence) {
    if (state.tailElement?.tagName !== 'PRE') {
      state.tailElement?.remove();
      state.tailElement = documentRef.createElement('pre');
      state.tailElement.className = 'stream-md-tail';
      state.renderedTailText = '';
      element.appendChild(state.tailElement);
    }
    const previousText = state.renderedTailText || '';
    if (update.tail.startsWith(previousText)) {
      state.tailElement.appendChild(
        documentRef.createTextNode(update.tail.slice(previousText.length))
      );
    } else {
      state.tailElement.textContent = update.tail;
    }
    state.renderedTailText = update.tail;
  } else {
    if (state.tailElement?.tagName === 'PRE') {
      state.tailElement.remove();
      state.tailElement = null;
    }
    if (!state.tailElement) {
      state.tailElement = documentRef.createElement('div');
      state.tailElement.className = 'stream-md-tail';
      element.appendChild(state.tailElement);
    }
    state.renderedTailText = '';
    state.tailElement.innerHTML = renderMarkdown(update.tail);
  }
}
