/**
 * @fileoverview Bounded keyless web-search client built on two fixed hosted
 * MCP endpoints: Exa (`web_search_exa`) as the primary leg and Parallel
 * Search (`web_search`) as the fallback leg. Neither endpoint requires an
 * API key; an optional Exa key is forwarded as `x-api-key` when configured.
 *
 * Only runs inside the service worker (background.js).
 *
 * @module keylessSearch
 */

import { readBoundedResponseText } from './streamSafety.js';

const textEncoder = new TextEncoder();

/**
 * Fixed endpoints: never accept a caller-supplied URL. Parallel is the
 * second leg because it is keyless and requires no configuration.
 * @const {string}
 */
export const EXA_MCP_ENDPOINT = 'https://mcp.exa.ai/mcp';

/** @const {string} */
export const PARALLEL_MCP_ENDPOINT = 'https://search.parallel.ai/mcp';

/** Exa MCP tool name. @const {string} */
export const EXA_TOOL_NAME = 'web_search_exa';

/** Parallel MCP tool name. @const {string} */
export const PARALLEL_TOOL_NAME = 'web_search';

/** Max search query length (kept aligned with the Brave client). */
export const MAX_QUERY_LENGTH = 400;

/** Max words in the query. */
export const MAX_QUERY_WORDS = 50;

/** Max source URL entries in the normalized result. */
export const MAX_NORMALIZED_SOURCES = 10;

/** Max serialized result size in bytes (prevents blowing context). */
export const MAX_RESULT_BYTES = 50_000;

/** Max title length on a normalized source. */
export const MAX_TITLE_LENGTH = 200;

/** Max snippet length on a normalized source. */
export const MAX_SNIPPET_LENGTH = 2000;

/** Request timeout in ms. */
export const TIMEOUT_MS = 15000;

/** Max response body bytes read from either endpoint. */
export const MAX_RESPONSE_BYTES = 262_144;

/** Requested result count for the Exa leg. */
export const NUM_RESULTS = 10;

/**
 * Error class for keyless search failures. The `userMessage` is safe to
 * surface in the UI; the internal `cause` is logged separately. Error codes
 * are exactly: INVALID_QUERY, TIMEOUT, NETWORK, RATE_LIMIT, HTTP_ERROR,
 * PARSE, NO_RESULTS.
 */
export class KeylessSearchError extends Error {
  /**
   * @param {string} userMessage - User-safe error description.
   * @param {object} [options] - { cause, code?, status? }
   */
  constructor(userMessage, options = {}) {
    super(userMessage);
    this.name = 'KeylessSearchError';
    this.userMessage = userMessage;
    this.code = options.code || 'UNKNOWN';
    this.status = options.status || null;
    this.cause = options.cause;
  }
}

/**
 * Normalized keyless search result. Mirrors the Brave client's shape so the
 * orchestrator and grounding UI treat all providers identically.
 * @typedef {Object} KeylessSearchResult
 * @property {string} query - The original search query.
 * @property {string} retrievedAt - ISO timestamp.
 * @property {Array<{id: string, title: string, url: string, snippets: string[]}>} sources
 */

/**
 * Validate a single source URL: only HTTP(S) allowed.
 * @param {string} url
 * @returns {boolean}
 */
export function isValidSourceUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Build the Parallel `objective` argument: a natural-language sentence
 * wrapping the user's query, capped at MAX_QUERY_LENGTH.
 * @param {string} query
 * @returns {string}
 */
export function buildSearchObjective(query) {
  return `Find authoritative sources that directly answer: ${query}`.slice(0, MAX_QUERY_LENGTH);
}

/**
 * Parse the Exa `web_search_exa` result text into raw result records.
 * Blocks are separated by a line of exactly three dashes; each block is
 * keyed by anchored `Title:` / `URL:` / `Highlights:` (or `Text:`) lines.
 * Highlight lines that are exactly the literal `...` separator are dropped.
 * @param {string} text - The MCP result content text.
 * @returns {Array<{title: string, url: string, snippets: string[]}>}
 */
export function parseExaResultText(text) {
  if (!text || typeof text !== 'string') return [];
  const results = [];
  // Normalize line endings first: a CRLF body would otherwise never match the
  // three-dash separator and silently collapse every block into one.
  for (const block of text.replace(/\r\n?/g, '\n').split('\n\n---\n\n')) {
    const lines = block.split('\n').map((line) => line.trim());
    let title = '';
    let url = '';
    let snippetLines = [];
    let inSnippet = false;
    for (const line of lines) {
      if (!title && line.startsWith('Title:')) {
        title = line.slice('Title:'.length).trim();
      } else if (!url && line.startsWith('URL:')) {
        url = line.slice('URL:'.length).trim();
      } else if (!inSnippet && (line.startsWith('Highlights:') || line.startsWith('Text:'))) {
        inSnippet = true;
      } else if (inSnippet) {
        if (line === '...') continue; // literal separator line, not content
        if (line) snippetLines.push(line);
      }
    }
    if (!isValidSourceUrl(url)) continue;
    results.push({
      title,
      url,
      snippets: snippetLines.length ? [snippetLines.join(' ')] : [],
    });
  }
  return results;
}

/**
 * Parse the Parallel `web_search` result text (a JSON string with a
 * `results` array) into raw result records.
 * @param {string} text - The MCP result content text.
 * @returns {Array<{title: string, url: string, snippets: string[]}>}
 * @throws {KeylessSearchError} PARSE when the text is not the expected shape.
 */
export function parseParallelResultText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new KeylessSearchError('Web search returned an unreadable response.', {
      code: 'PARSE',
      cause: err,
    });
  }
  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray(data.results) ||
    data.results.length === 0
  ) {
    throw new KeylessSearchError('Web search returned an unexpected response format.', {
      code: 'PARSE',
    });
  }
  return data.results.map((r) => ({
    title: String(r?.title || '').trim(),
    url: String(r?.url || '').trim(),
    snippets: Array.isArray(r?.excerpts)
      ? r.excerpts
          .map((s) => String(s).trim().slice(0, MAX_SNIPPET_LENGTH))
          .filter((s) => s.length > 0)
      : [],
  }));
}

/**
 * Call a tool on a fixed hosted MCP endpoint via JSON-RPC and resolve with
 * the unwrapped result content text. Handles both plain-JSON and SSE
 * (`event: message` / `data:` line) response encodings.
 *
 * @param {object} options
 * @param {string} options.endpoint - Fixed MCP endpoint URL.
 * @param {string} options.tool - Tool name to call.
 * @param {object} options.args - Tool arguments.
 * @param {string} [options.apiKey] - Optional key forwarded as `x-api-key`.
 * @param {AbortSignal} [options.signal] - Optional caller abort signal.
 * @param {number} [options.timeoutMs] - Per-request timeout (default TIMEOUT_MS).
 * @returns {Promise<string>} The result content text.
 * @throws {KeylessSearchError} TIMEOUT, NETWORK, RATE_LIMIT, HTTP_ERROR, PARSE.
 * @throws {DOMException} AbortError when the caller signal is aborted.
 */
export async function callMcpTool({ endpoint, tool, args, apiKey, signal, timeoutMs }) {
  const headers = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  };
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    headers['x-api-key'] = apiKey;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs ?? TIMEOUT_MS);
  const combinedSignal = signal
    ? combineAbortSignals(signal, controller.signal)
    : controller.signal;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }),
      signal: combinedSignal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      if (signal?.aborted) {
        throw new DOMException('Web search was cancelled.', 'AbortError');
      }
      throw new KeylessSearchError('Web search timed out.', {
        code: 'TIMEOUT',
        cause: err,
      });
    }
    throw new KeylessSearchError('Web search request failed.', { code: 'NETWORK', cause: err });
  }

  // The request budget must cover the body read, not just the headers: a host
  // that sends headers and then stalls the body would otherwise hang the leg
  // until the caller's own abort. Race the bounded read against the same
  // signal so the deadline holds for a stalling body too.
  const readBody = async () => {
    try {
      return await Promise.race([
        readBoundedResponseText(response, MAX_RESPONSE_BYTES),
        rejectOnAbort(combinedSignal, signal),
      ]);
    } catch (err) {
      if (err instanceof KeylessSearchError) throw err;
      if (signal?.aborted) {
        throw new DOMException('Web search was cancelled.', 'AbortError');
      }
      if (controller.signal.aborted) {
        throw new KeylessSearchError('Web search timed out.', { code: 'TIMEOUT', cause: err });
      }
      throw new KeylessSearchError('Web search request failed.', { code: 'NETWORK', cause: err });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  if (!response.ok) {
    let body = '';
    try {
      body = await readBody();
    } catch {
      // ignore read errors
    }
    if (response.status === 429) {
      throw new KeylessSearchError('Web search rate limit exceeded. Try again later.', {
        code: 'RATE_LIMIT',
        status: response.status,
        cause: body.slice(0, 1000),
      });
    }
    throw new KeylessSearchError(`Web search failed (HTTP ${response.status}).`, {
      code: 'HTTP_ERROR',
      status: response.status,
      cause: body.slice(0, 1000),
    });
  }

  const body = await readBody();

  // Plain-JSON bodies start with '{'; SSE bodies carry the JSON-RPC result
  // on `data:` lines (one `event: message` frame per response).
  let payload;
  try {
    if (body.trim().startsWith('{')) {
      payload = JSON.parse(body);
    } else {
      const dataLines = body
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart());
      payload = JSON.parse(dataLines.join('\n'));
    }
  } catch {
    throw new KeylessSearchError('Web search returned an unreadable response.', {
      code: 'PARSE',
    });
  }

  // JSON-RPC transport-level error: maps to RATE_LIMIT when the message
  // mentions 429, otherwise HTTP_ERROR (endpoints usually return HTTP 200,
  // so the JSON-RPC layer is the only place transport errors surface).
  if (payload && typeof payload === 'object' && payload.error) {
    const message =
      typeof payload.error === 'string' ? payload.error : String(payload.error.message || '');
    if (message.includes('429')) {
      throw new KeylessSearchError('Web search rate limit exceeded. Try again later.', {
        code: 'RATE_LIMIT',
        cause: message.slice(0, 1000),
      });
    }
    throw new KeylessSearchError('Web search request failed.', {
      code: 'HTTP_ERROR',
      cause: message.slice(0, 1000),
    });
  }

  const result = payload && typeof payload === 'object' ? payload.result : null;
  if (!result || !Array.isArray(result.content)) {
    throw new KeylessSearchError('Web search returned an unexpected response format.', {
      code: 'PARSE',
    });
  }

  const contentText = result.content
    .filter((entry) => entry && entry.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text)
    .join('');
  if (contentText.length === 0) {
    throw new KeylessSearchError('Web search returned an unreadable response.', {
      code: 'PARSE',
    });
  }

  // Tool-level failures arrive as HTTP 200 with result.isError === true and
  // a message like "web_search_exa error (401): ..." — scrape the 429 out of
  // the text to decide between RATE_LIMIT and HTTP_ERROR.
  if (result.isError === true) {
    if (contentText.includes('429')) {
      throw new KeylessSearchError('Web search rate limit exceeded. Try again later.', {
        code: 'RATE_LIMIT',
        cause: contentText.slice(0, 1000),
      });
    }
    throw new KeylessSearchError('Web search request failed.', {
      code: 'HTTP_ERROR',
      cause: contentText.slice(0, 1000),
    });
  }

  return contentText;
}

/**
 * Add a candidate source to the normalized list when it passes validation
 * and the budgets still allow it. Returns true when added.
 * @param {Array} sources - The normalized sources array.
 * @param {object} state - { bytes } running budget counter.
 * @param {{url: string, title: string, snippets: string[]}} candidate
 * @returns {boolean}
 */
function addSource(sources, state, { url, title, snippets }) {
  if (sources.length >= MAX_NORMALIZED_SOURCES) return false;
  if (!isValidSourceUrl(url)) return false;
  if (sources.some((s) => s.url === url)) return false; // dedupe

  const cleanTitle = String(title || '')
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  const cleanSnippet = (Array.isArray(snippets) ? snippets.join(' ') : String(snippets || ''))
    .trim()
    .slice(0, MAX_SNIPPET_LENGTH);

  // Budget the entry in real UTF-8 bytes so non-ASCII snippets cannot blow past
  // MAX_RESULT_BYTES by a factor of three.
  const entryBytes = textEncoder.encode(
    `${cleanTitle}${cleanSnippet}${url}${sources.length + 1}`
  ).byteLength;
  if (state.bytes + entryBytes > MAX_RESULT_BYTES) return false;

  sources.push({
    id: `src-${sources.length + 1}`,
    title: cleanTitle,
    url,
    snippets: cleanSnippet ? [cleanSnippet] : [],
  });
  state.bytes += entryBytes;
  return true;
}

/**
 * Normalize raw parsed results into the shared { id, title, url, snippets }
 * shape with dedupe, source-count, and byte budgets.
 * @param {Array<{title: string, url: string, snippets: string[]}>} parsed
 * @returns {Array<{id: string, title: string, url: string, snippets: string[]}>}
 */
function normalizeSources(parsed) {
  const sources = [];
  const state = { bytes: 0 };
  for (const candidate of parsed || []) {
    if (!candidate || typeof candidate !== 'object') continue;
    addSource(sources, state, candidate);
  }
  return sources;
}

/**
 * Execute a bounded keyless web search: the Exa MCP leg first, falling back
 * to the Parallel MCP leg when the first returns no usable sources or fails
 * with a non-abort error.
 *
 * @param {string} query - Search query (1–400 chars, ≤50 words).
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - Optional abort signal.
 * @param {string} [options.exaApiKey] - Optional Exa API key (keyless when unset).
 * @returns {Promise<KeylessSearchResult>}
 * @throws {KeylessSearchError} On invalid input, failures, or NO_RESULTS.
 * @throws {DOMException} AbortError when the caller signal is aborted.
 */
export async function executeKeylessSearch(query, options = {}) {
  const { signal, exaApiKey } = options;

  // --- Input validation ---
  if (!query || typeof query !== 'string') {
    throw new KeylessSearchError('Search query is required.', { code: 'INVALID_QUERY' });
  }
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new KeylessSearchError('Search query is empty.', { code: 'INVALID_QUERY' });
  }
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new KeylessSearchError(`Search query exceeds ${MAX_QUERY_LENGTH} characters.`, {
      code: 'INVALID_QUERY',
    });
  }
  if (trimmed.split(/\s+/).length > MAX_QUERY_WORDS) {
    throw new KeylessSearchError(`Search query exceeds ${MAX_QUERY_WORDS} words.`, {
      code: 'INVALID_QUERY',
    });
  }

  const legs = [
    async () => {
      const text = await callMcpTool({
        endpoint: EXA_MCP_ENDPOINT,
        tool: EXA_TOOL_NAME,
        args: { query: trimmed, numResults: NUM_RESULTS },
        apiKey: exaApiKey,
        signal,
      });
      return normalizeSources(parseExaResultText(text));
    },
    async () => {
      const text = await callMcpTool({
        endpoint: PARALLEL_MCP_ENDPOINT,
        tool: PARALLEL_TOOL_NAME,
        args: { objective: buildSearchObjective(trimmed), search_queries: [trimmed] },
        signal,
      });
      return normalizeSources(parseParallelResultText(text));
    },
  ];

  for (const leg of legs) {
    let sources;
    try {
      sources = await leg();
    } catch (err) {
      // Abort is user-driven: propagate immediately, never fall through.
      if (signal?.aborted || (err && err.name === 'AbortError')) {
        throw new DOMException('Web search was cancelled.', 'AbortError');
      }
      continue; // swallow this leg, try the next
    }
    if (sources && sources.length > 0) {
      return {
        query: trimmed,
        retrievedAt: new Date().toISOString(),
        sources,
      };
    }
  }

  throw new KeylessSearchError('Web search returned no usable sources.', { code: 'NO_RESULTS' });
}

/**
 * Combine two AbortSignals; aborts when either fires.
 * @param {AbortSignal} s1
 * @param {AbortSignal} s2
 * @returns {AbortSignal}
 */
function combineAbortSignals(s1, s2) {
  const controller = new AbortController();
  const onAbort = () => {
    if (controller.signal.aborted) return;
    controller.abort();
  };
  const listen = (signal) => {
    if (!signal) return;
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  };
  listen(s1);
  listen(s2);
  return controller.signal;
}

/**
 * Reject as soon as `signal` aborts, classifying caller cancellation from a
 * budget timeout so the leg loop can tell them apart.
 * @param {AbortSignal} signal - The combined (caller + timeout) signal.
 * @param {AbortSignal} [callerSignal] - The caller's own signal, if any.
 * @returns {Promise<never>}
 */
function rejectOnAbort(signal, callerSignal) {
  return new Promise((_, reject) => {
    const onAbort = () => {
      if (callerSignal?.aborted) {
        reject(new DOMException('Web search was cancelled.', 'AbortError'));
        return;
      }
      reject(new KeylessSearchError('Web search timed out.', { code: 'TIMEOUT' }));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}
