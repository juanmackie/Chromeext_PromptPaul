/**
 * @fileoverview Bounded schema and wire framing for read-only structured answers.
 * @module answerSchema
 */

export const ANSWER_FORMAT = 'cards';

const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_BLOCKS = 12;
const MAX_ROWS = 30;
const MAX_COLUMNS = 6;
const MAX_STRING_LENGTH = 2_000;
const MAX_TOTAL_TEXT = 20_000;
const MAX_SOURCE_IDS = 12;
const OPEN_TAG = '```promptpaul-cards';
const MISSING_READABLE_ANSWER = 'The response did not include a readable answer.';

export const ANSWER_CARD_INSTRUCTIONS = [
  'STRUCTURED ANSWER FORMAT: Return the complete, readable Markdown answer first. Then, only when useful, append one fenced block tagged promptpaul-cards containing a JSON object with exactly this shape: {"version":1,"blocks":[...]}. Do not put the readable answer inside the JSON.',
  'Allowed blocks are: {"type":"summary","title":"...","text":"...","points":["..."],"sourceIds":["src-1"]}; {"type":"key_values","title":"...","items":[{"label":"...","value":"..."}],"sourceIds":["src-1"]}; and {"type":"comparison","title":"...","columns":["..."],"rows":[["...","..."]],"sourceIds":["src-1"]}. sourceIds is optional. Use only source IDs supplied by this run; omit sourceIds when none are available.',
  'Use at most 12 blocks, 30 rows per comparison, and 6 columns. Keep each string concise. The structured block is passive display data: do not include URLs, HTML, styles, actions, tools, or other properties. The Markdown answer is authoritative and must contain the useful facts even when the structured block is omitted.',
  'Only append this block to the terminal answer after all requested tools and actions are finished. Never emit it in interim commentary or before a tool call.',
].join('\n');

function utf8ByteLength(value) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

function hasJsonDepthWithinLimit(text, maxDepth = 6) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') {
      depth += 1;
      if (depth > maxDepth) return false;
    } else if (char === '}' || char === ']') depth -= 1;
  }
  return depth === 0 && !inString;
}

function normalizedSources(sources) {
  const ids = new Set();
  for (const source of Array.isArray(sources) ? sources.slice(0, 100) : []) {
    const id = typeof source === 'string' ? source : source?.id;
    if (typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)) ids.add(id);
  }
  return ids;
}

function findClosingFence(text, start) {
  const closingFence = /^```[ \t]*\r?$/gm;
  closingFence.lastIndex = start;
  return closingFence.exec(text);
}

function stripTaggedSections(text) {
  const opener = /^```promptpaul-cards[ \t]*\r?$/gm;
  let cursor = 0;
  let output = '';
  let match;
  while ((match = opener.exec(text))) {
    if (match.index < cursor) continue;
    output += text.slice(cursor, match.index);
    let payloadStart = match.index + match[0].length;
    if (text[payloadStart] === '\n') payloadStart += 1;
    const close = findClosingFence(text, payloadStart);
    if (!close) {
      cursor = text.length;
      break;
    }
    cursor = close.index + close[0].length;
    if (text[cursor] === '\n') cursor += 1;
    opener.lastIndex = cursor;
  }
  return `${output}${text.slice(cursor)}`;
}

function boundedText(value, budget) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_STRING_LENGTH) return null;
  const next = budget.used + value.length;
  if (next > MAX_TOTAL_TEXT) return null;
  budget.used = next;
  return value;
}

function copySourceIds(value, sourceIds) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_SOURCE_IDS) return null;
  const result = [];
  for (const id of value) {
    if (typeof id !== 'string' || !sourceIds.has(id)) return null;
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

/**
 * Validate untrusted card data and return a fresh, bounded allowlisted projection.
 * @param {unknown} value
 * @param {{sources?: Array<object|string>}} [options]
 * @returns {{version: 1, blocks: Array<object>}|null}
 */
export function validateAnswerCards(value, { sources = [] } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !['version', 'blocks'].includes(key))) return null;
  if (value.version !== 1 || !Array.isArray(value.blocks) || value.blocks.length > MAX_BLOCKS) {
    return null;
  }

  const knownSources = normalizedSources(sources);
  const budget = { used: 0 };
  const blocks = [];
  for (const block of value.blocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
    const common = ['type', 'title', 'sourceIds'];
    if (typeof block.type !== 'string') return null;
    const allowed =
      block.type === 'summary'
        ? [...common, 'text', 'points']
        : block.type === 'key_values'
          ? [...common, 'items']
          : block.type === 'comparison'
            ? [...common, 'columns', 'rows']
            : null;
    if (!allowed || Object.keys(block).some((key) => !allowed.includes(key))) return null;
    const title = boundedText(block.title, budget);
    if (!title) return null;
    const sourceIds = copySourceIds(block.sourceIds, knownSources);
    if (sourceIds === null) return null;
    const projected = { type: block.type, title };
    if (sourceIds !== undefined && sourceIds.length) projected.sourceIds = sourceIds;

    if (block.type === 'summary') {
      const text = boundedText(block.text, budget);
      if (!text || !Array.isArray(block.points) || block.points.length > 12) return null;
      const points = block.points.map((point) => boundedText(point, budget));
      if (points.some((point) => !point)) return null;
      projected.text = text;
      projected.points = points;
    } else if (block.type === 'key_values') {
      if (!Array.isArray(block.items) || block.items.length > MAX_ROWS) return null;
      const items = [];
      for (const item of block.items) {
        if (
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          Object.keys(item).some((key) => !['label', 'value'].includes(key))
        ) {
          return null;
        }
        const label = boundedText(item.label, budget);
        const itemValue = boundedText(item.value, budget);
        if (!label || !itemValue) return null;
        items.push({ label, value: itemValue });
      }
      projected.items = items;
    } else {
      if (
        !Array.isArray(block.columns) ||
        block.columns.length < 2 ||
        block.columns.length > MAX_COLUMNS ||
        !Array.isArray(block.rows) ||
        block.rows.length > MAX_ROWS
      ) {
        return null;
      }
      const columns = block.columns.map((column) => boundedText(column, budget));
      if (columns.some((column) => !column)) return null;
      const rows = [];
      for (const row of block.rows) {
        if (!Array.isArray(row) || row.length !== columns.length) return null;
        const values = row.map((cell) => boundedText(cell, budget));
        if (values.some((cell) => !cell)) return null;
        rows.push(values);
      }
      projected.columns = columns;
      projected.rows = rows;
    }
    blocks.push(projected);
  }

  return { version: 1, blocks };
}

function locateEnvelope(wireText) {
  const marker = /^```promptpaul-cards[ \t]*\r?\n/m;
  const match = marker.exec(wireText);
  if (!match) {
    const partial = /^```promptpaul-card(?:s)?[ \t]*$/m.exec(wireText);
    if (partial) {
      const content = wireText.slice(0, partial.index).replace(/[\r\n]+$/, '');
      return { status: 'incomplete', content };
    }
    return { status: 'missing' };
  }
  const start = match.index;
  const lineStart = start === 0 || wireText[start - 1] === '\n';
  if (!lineStart) return { status: 'missing' };
  const payloadStart = start + match[0].length;
  const close = findClosingFence(wireText, payloadStart);
  const content = wireText.slice(0, start).replace(/[\r\n]+$/, '');
  if (!close) return { status: 'incomplete', content };
  const suffixStart = close.index + close[0].length;
  const suffix = stripTaggedSections(wireText.slice(suffixStart));
  if (suffix.trim()) return { status: 'invalid', content: `${content}${suffix}` };
  const payload = wireText.slice(payloadStart, close.index).trim();
  return { status: 'found', content, payload };
}

/**
 * Split the tagged wire response into readable Markdown and a safe card projection.
 * @param {string} wireText
 * @param {{sources?: Array<object|string>}} [options]
 * @returns {{content: string, answerCards: {version: 1, blocks: Array<object>}|null, status: string}}
 */
export function normalizeAnswerCards(wireText, { sources = [] } = {}) {
  const raw = typeof wireText === 'string' ? wireText : '';
  const located = locateEnvelope(raw);
  if (located.status !== 'found') {
    const bareEnvelope = raw.trim();
    if (located.status === 'incomplete' && !located.content?.trim()) {
      return {
        content: MISSING_READABLE_ANSWER,
        answerCards: null,
        status: 'missing_fallback',
      };
    }
    if (
      located.status === 'missing' &&
      bareEnvelope.startsWith('{') &&
      /"(?:version|blocks)"\s*:/.test(bareEnvelope)
    ) {
      return {
        content: MISSING_READABLE_ANSWER,
        answerCards: null,
        status: 'missing_fallback',
      };
    }
    return {
      content: located.content ?? raw,
      answerCards: null,
      status: located.status,
    };
  }
  if (!located.content.trim()) {
    return {
      content: MISSING_READABLE_ANSWER,
      answerCards: null,
      status: 'missing_fallback',
    };
  }
  if (utf8ByteLength(located.payload) > MAX_PAYLOAD_BYTES) {
    return { content: located.content, answerCards: null, status: 'oversized' };
  }
  if (!hasJsonDepthWithinLimit(located.payload)) {
    return { content: located.content, answerCards: null, status: 'invalid' };
  }
  let parsed;
  try {
    parsed = JSON.parse(located.payload);
  } catch {
    return { content: located.content, answerCards: null, status: 'invalid' };
  }
  const answerCards = validateAnswerCards(parsed, { sources });
  return {
    content: located.content,
    answerCards,
    status: answerCards ? 'valid' : 'invalid',
  };
}

/**
 * Discover complete, independently validated blocks without reparsing prior deltas.
 * @param {{sources?: Array<object|string>}} [options]
 * @returns {{push(delta: string): object|null, reset(options?: {sources?: Array<object|string>}): void}}
 */
export function createAnswerCardProgressiveParser({ sources = [] } = {}) {
  let knownSources = normalizedSources(sources);
  let mode = 'readable';
  let line = '';
  let lineOverflow = false;
  let fallbackSeen = false;
  let payloadBuffer = '';
  let payloadBytes = 0;
  let globalDepth = 0;
  let globalInString = false;
  let globalEscaped = false;
  let payloadReady = false;
  let scanOffset = 0;
  let blockDepth = 0;
  let blockInString = false;
  let blockEscaped = false;
  let blockStart = -1;
  let blocksFinished = false;
  let blockListState = 'value_or_end';
  let rootClosed = false;
  let rootSuffix = '';
  let rawBlocks = [];
  let projection = { version: 1, blocks: [] };
  let invalid = false;

  const invalidate = () => {
    invalid = true;
    mode = 'invalid';
    return projection.blocks.length ? { invalid: true } : null;
  };

  const appendPayload = (text) => {
    if (mode === 'invalid' || !text) return null;
    payloadBytes += utf8ByteLength(text);
    if (payloadBytes > MAX_PAYLOAD_BYTES) return invalidate();
    payloadBuffer += text;
    if (payloadBuffer.length > MAX_PAYLOAD_BYTES) return invalidate();

    if (!payloadReady) {
      const rootMatch = /^\s*\{\s*"version"\s*:\s*1\s*,\s*"blocks"\s*:\s*\[/.exec(
        payloadBuffer.slice(0, 512)
      );
      if (!rootMatch) {
        if (payloadBuffer.length > 512) return invalidate();
        return null;
      }
      payloadReady = true;
      scanOffset = rootMatch[0].length;
      globalDepth = 2;
    }

    let emitted = null;
    for (let index = scanOffset; index < payloadBuffer.length; index += 1) {
      const char = payloadBuffer[index];

      if (globalInString) {
        if (globalEscaped) globalEscaped = false;
        else if (char === '\\') globalEscaped = true;
        else if (char === '"') globalInString = false;
      } else if (char === '"') globalInString = true;
      else if (char === '{' || char === '[') {
        globalDepth += 1;
        if (globalDepth > 6) return invalidate();
      } else if (char === '}' || char === ']') {
        globalDepth -= 1;
        if (globalDepth < 0) return invalidate();
      }

      if (rootClosed) {
        rootSuffix += char;
        if (rootSuffix.length > 256 || !/^\s*(?:`{0,3}[ \t]*\r?\n?)\s*$/.test(rootSuffix)) {
          return invalidate();
        }
        continue;
      }
      if (blocksFinished) {
        if (char === '}' && globalDepth === 0) rootClosed = true;
        else if (!/\s/.test(char)) return invalidate();
        continue;
      }
      if (blockDepth === 0) {
        if (blockListState === 'separator_or_end') {
          if (char === ',') blockListState = 'value_required';
          else if (char === ']') blocksFinished = true;
          else if (!/\s/.test(char)) return invalidate();
          continue;
        }
        if (char === '{') {
          if (blockListState !== 'value_or_end' && blockListState !== 'value_required') {
            return invalidate();
          }
          blockListState = 'in_value';
          blockStart = index;
          blockDepth = 1;
          blockInString = false;
          blockEscaped = false;
        } else if (char === ']' && blockListState === 'value_or_end') {
          blocksFinished = true;
        } else if (!/\s/.test(char)) {
          return invalidate();
        }
        continue;
      }

      if (blockInString) {
        if (blockEscaped) blockEscaped = false;
        else if (char === '\\') blockEscaped = true;
        else if (char === '"') blockInString = false;
      } else if (char === '"') blockInString = true;
      else if (char === '{' || char === '[') {
        blockDepth += 1;
        if (blockDepth + 2 > 6) return invalidate();
      } else if (char === '}' || char === ']') {
        blockDepth -= 1;
        if (blockDepth < 0) return invalidate();
        if (blockDepth === 0) {
          let block;
          try {
            block = JSON.parse(payloadBuffer.slice(blockStart, index + 1));
          } catch {
            return invalidate();
          }
          rawBlocks.push(block);
          const nextProjection = validateAnswerCards(
            { version: 1, blocks: rawBlocks },
            { sources: Array.from(knownSources) }
          );
          if (!nextProjection) return invalidate();
          projection = nextProjection;
          blockListState = 'separator_or_end';
          emitted = projection;
        }
      }
    }
    scanOffset = payloadBuffer.length;
    return emitted;
  };

  const consumeReadable = (text) => {
    if (mode === 'invalid' || mode === 'payload' || !text) return;
    for (const char of text) {
      if (char === '\n') {
        const isOpener = !lineOverflow && /^```promptpaul-cards[ \t]{0,64}\r?$/.test(line);
        if (isOpener) {
          mode = fallbackSeen ? 'payload' : 'disabled';
          payloadBuffer = '';
          payloadBytes = 0;
          line = '';
          lineOverflow = false;
          continue;
        }
        if (line.trim()) fallbackSeen = true;
        line = '';
        lineOverflow = false;
        continue;
      }
      if (line.length < 130) line += char;
      else lineOverflow = true;
    }
  };

  return {
    push(delta) {
      if (invalid || typeof delta !== 'string' || !delta) return null;
      if (mode === 'disabled') return null;
      if (mode === 'payload') return appendPayload(delta);

      let readableStart = 0;
      for (let index = 0; index < delta.length; index += 1) {
        if (delta[index] !== '\n') continue;
        consumeReadable(delta.slice(readableStart, index + 1));
        readableStart = index + 1;
        if (mode === 'payload') {
          return appendPayload(delta.slice(readableStart));
        }
      }
      if (readableStart < delta.length) {
        if (mode === 'payload') return appendPayload(delta.slice(readableStart));
        consumeReadable(delta.slice(readableStart));
      }
      return null;
    },
    reset(nextOptions = {}) {
      knownSources = normalizedSources(nextOptions.sources ?? sources);
      mode = 'readable';
      line = '';
      lineOverflow = false;
      fallbackSeen = false;
      payloadBuffer = '';
      payloadBytes = 0;
      globalDepth = 0;
      globalInString = false;
      globalEscaped = false;
      payloadReady = false;
      scanOffset = 0;
      blockDepth = 0;
      blockInString = false;
      blockEscaped = false;
      blockStart = -1;
      blocksFinished = false;
      blockListState = 'value_or_end';
      rootClosed = false;
      rootSuffix = '';
      rawBlocks = [];
      projection = { version: 1, blocks: [] };
      invalid = false;
    },
    disable() {
      mode = 'disabled';
    },
  };
}

/**
 * Create a bounded stream decoder that withholds a tagged payload from text events.
 * @returns {{push(delta: string): string, finish(): string, reset(): void}}
 */
export function createAnswerCardDecoder() {
  let buffer = '';
  let hidden = false;
  let hiddenLine = '';
  let separatorPending = false;
  let atLineStart = true;
  let initial = true;
  let bareJsonCandidate = false;

  const recordReadable = (readable) => {
    if (readable) atLineStart = readable.endsWith('\n');
    return readable;
  };

  const findOpenTag = () => {
    let index = buffer.indexOf(OPEN_TAG);
    while (index >= 0) {
      if ((index === 0 && atLineStart) || (index > 0 && buffer[index - 1] === '\n')) {
        const after = index + OPEN_TAG.length;
        let cursor = after;
        while (buffer[cursor] === ' ' || buffer[cursor] === '\t') cursor += 1;
        if (cursor === buffer.length) {
          return cursor - after > 64 ? { index, end: buffer.length } : { index, incomplete: true };
        }
        if (buffer[cursor] === '\n') return { index, end: cursor + 1 };
        if (buffer[cursor] === '\r' && cursor + 1 === buffer.length) {
          return { index, incomplete: true };
        }
        if (buffer.slice(cursor, cursor + 2) === '\r\n') return { index, end: cursor + 2 };
      }
      index = buffer.indexOf(OPEN_TAG, index + 1);
    }
    return null;
  };

  const possiblePartialTag = () => {
    for (let index = 0; index < buffer.length; index += 1) {
      if ((index !== 0 || !atLineStart) && buffer[index - 1] !== '\n') continue;
      const suffix = buffer.slice(index);
      if (OPEN_TAG.startsWith(suffix)) return index;
    }
    return -1;
  };

  return {
    push(delta) {
      if (typeof delta !== 'string' || !delta) return '';
      if (hidden) {
        let suffix = '';
        for (let index = 0; index < delta.length; index += 1) {
          const char = delta[index];
          if (char === '\n') {
            if (/^```[ \t]*\r?$/.test(hiddenLine)) {
              hidden = false;
              hiddenLine = '';
              const remainder = delta.slice(index + 1);
              if (remainder) suffix = `\n${remainder}`;
              else separatorPending = true;
              break;
            }
            hiddenLine = '';
          } else if (hiddenLine.length < 8) hiddenLine += char;
          else hiddenLine = '\u0000';
        }
        if (hidden) return '';
        delta = suffix;
        if (!delta) return '';
      }
      if (hidden) return '';
      if (separatorPending) {
        delta = `\n${delta}`;
        separatorPending = false;
      }
      if (bareJsonCandidate) {
        buffer += delta;
        return '';
      }
      buffer += delta;
      if (initial) {
        const leading = buffer.trimStart();
        if (!leading && buffer.length <= 64) return '';
        if (leading.startsWith('{')) {
          initial = false;
          bareJsonCandidate = true;
          return '';
        }
        initial = false;
      }
      const tag = findOpenTag();
      if (tag?.end !== undefined) {
        const readable = buffer.slice(0, tag.index);
        buffer = '';
        hidden = true;
        hiddenLine = '';
        return recordReadable(readable);
      }
      if (tag?.incomplete) {
        const readable = buffer.slice(0, tag.index);
        buffer = buffer.slice(tag.index);
        return recordReadable(readable);
      }
      const partialStart = possiblePartialTag();
      if (partialStart >= 0) {
        const readable = buffer.slice(0, partialStart);
        buffer = buffer.slice(partialStart);
        return recordReadable(readable);
      }
      const readable = buffer;
      buffer = '';
      return recordReadable(readable);
    },
    finish() {
      if (hidden && /^```[ \t]*\r?$/.test(hiddenLine)) {
        hidden = false;
        hiddenLine = '';
      }
      const bareEnvelope =
        bareJsonCandidate && /^\s*\{/.test(buffer) && /"(?:version|blocks)"\s*:/.test(buffer);
      const partial =
        !hidden &&
        ((buffer.length > 3 && OPEN_TAG.startsWith(buffer)) || buffer.startsWith(OPEN_TAG));
      const tail = hidden || partial || bareEnvelope ? '' : buffer;
      buffer = '';
      if (tail) recordReadable(tail);
      bareJsonCandidate = false;
      separatorPending = false;
      return tail;
    },
    reset() {
      buffer = '';
      hidden = false;
      hiddenLine = '';
      separatorPending = false;
      atLineStart = true;
      initial = true;
      bareJsonCandidate = false;
    },
  };
}
