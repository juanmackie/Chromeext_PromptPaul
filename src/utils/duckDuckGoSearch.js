/**
 * @fileoverview Bounded DuckDuckGo Instant Answer API client for web-search
 * grounding. Requires no API key and never hits the anti-bot wall that the
 * DuckDuckGo HTML search endpoint triggers, at the cost of returning only
 * curated "Instant Answer" topics (frequently empty for general queries).
 *
 * Only runs inside the service worker (background.js).
 *
 * @module duckDuckGoSearch
 */

import { readBoundedResponseText } from './streamSafety.js';

/**
 * Fixed endpoint: never accept a caller-supplied URL.
 * Instant Answer API docs: https://duckduckgo.com/duckduckgo-help-pages/results/zero-click-info/
 * @const {string}
 */
export const DDG_INSTANT_ANSWER_ENDPOINT = 'https://api.duckduckgo.com/';

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
export const DDG_TIMEOUT_MS = 15000;

/**
 * Error class for DuckDuckGo API failures. The `userMessage` is safe to
 * surface in the UI; the internal `cause` is logged separately.
 */
export class DuckDuckGoSearchError extends Error {
  /**
   * @param {string} userMessage - User-safe error description.
   * @param {object} [options] - { cause, code?, status? }
   */
  constructor(userMessage, options = {}) {
    super(userMessage);
    this.name = 'DuckDuckGoSearchError';
    this.userMessage = userMessage;
    this.code = options.code || 'UNKNOWN';
    this.status = options.status || null;
    this.cause = options.cause;
  }
}

/**
 * Normalized DuckDuckGo search result. Mirrors the Brave client's shape so the
 * orchestrator and grounding UI treat both providers identically.
 * @typedef {Object} DuckDuckGoSearchResult
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
 * Add a candidate source to the normalized list when it passes validation and
 * the budgets still allow it. Returns true when added.
 * @param {Array} sources - The normalized sources array.
 * @param {object} state - { bytes, added } running budget counters.
 * @param {string} url
 * @param {string} title
 * @param {string} snippet
 * @returns {boolean}
 */
function addSource(sources, state, { url, title, snippet }) {
  if (!isValidSourceUrl(url)) return false;
  if (sources.some((s) => s.url === url)) return false; // dedupe

  const cleanTitle = String(title || '')
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  const cleanSnippet = String(snippet || '')
    .trim()
    .slice(0, MAX_SNIPPET_LENGTH);

  const entryBytes =
    cleanTitle.length + cleanSnippet.length + url.length + (sources.length + 1).toString().length;
  if (state.bytes + entryBytes > MAX_RESULT_BYTES) return false;

  const sourceEntry = {
    id: `src-${sources.length + 1}`,
    title: cleanTitle,
    url,
    snippets: cleanSnippet ? [cleanSnippet] : [],
  };

  sources.push(sourceEntry);
  state.bytes += entryBytes;
  return true;
}

/**
 * Flatten one Instant Answer topic entry (direct object or category group) into
 * the normalized sources list.
 * @param {Array} sources - Normalized sources array.
 * @param {object} state - { bytes, added } running budget counters.
 * @param {object} topic - A direct topic or a { Name, Topics } category group.
 */
function ingestTopic(sources, state, topic) {
  if (!topic || typeof topic !== 'object') return;
  if (Array.isArray(topic.Topics)) {
    for (const child of topic.Topics) ingestTopic(sources, state, child);
    return;
  }
  const url = String(topic.FirstURL || '').trim();
  const text = String(topic.Text || '').trim();
  if (!url) return;

  // FirstURL points at a duckduckgo.com/... redirect stub; the snippet text
  // embeds the title as its leading tokens. Split on the first whitespace run.
  let title = '';
  let snippet = text;
  const firstSpace = text.indexOf('  ');
  if (firstSpace > 0 && firstSpace <= MAX_TITLE_LENGTH) {
    title = text.slice(0, firstSpace).trim();
    snippet = text.slice(firstSpace).trim();
  } else {
    title = url.split('/').filter(Boolean).pop() || url;
  }
  addSource(sources, state, { url, title, snippet });
}

/**
 * Parse a DuckDuckGo Instant Answer JSON body into normalized sources.
 * @param {object} data - Parsed JSON body.
 * @returns {Array} Normalized sources.
 */
function normalizeSources(data) {
  const sources = [];
  const state = { bytes: 0 };

  // Abstract entity result (best single answer) first.
  const abstractUrl = String(data.AbstractURL || '').trim();
  if (abstractUrl) {
    addSource(sources, state, {
      url: abstractUrl,
      title: String(data.Heading || 'Abstract').trim(),
      snippet: String(data.AbstractText || '').trim(),
    });
  }

  if (data.Results && Array.isArray(data.Results)) {
    for (const r of data.Results) ingestTopic(sources, state, r);
  }

  if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics) ingestTopic(sources, state, topic);
  }

  return sources;
}

/**
 * Execute a bounded web search against DuckDuckGo's Instant Answer API.
 *
 * @param {string} query - Search query (1–400 chars, ≤50 words).
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - Optional abort signal.
 * @returns {Promise<DuckDuckGoSearchResult>}
 * @throws {DuckDuckGoSearchError} On invalid input, API errors, timeout, etc.
 */
export async function executeDuckDuckGoSearch(query, options = {}) {
  // --- Input validation ---
  if (!query || typeof query !== 'string') {
    throw new DuckDuckGoSearchError('Search query is required.', { code: 'INVALID_QUERY' });
  }
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new DuckDuckGoSearchError('Search query is empty.', { code: 'INVALID_QUERY' });
  }
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new DuckDuckGoSearchError(`Search query exceeds ${MAX_QUERY_LENGTH} characters.`, {
      code: 'INVALID_QUERY',
    });
  }
  if (trimmed.split(/\s+/).length > MAX_QUERY_WORDS) {
    throw new DuckDuckGoSearchError(`Search query exceeds ${MAX_QUERY_WORDS} words.`, {
      code: 'INVALID_QUERY',
    });
  }

  // --- Build request ---
  const params = new URLSearchParams({
    q: trimmed,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  });
  const url = `${DDG_INSTANT_ANSWER_ENDPOINT}?${params.toString()}`;

  // --- Execute with timeout ---
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DDG_TIMEOUT_MS);
  const signal = options.signal
    ? combineAbortSignals(options.signal, controller.signal)
    : controller.signal;

  let response;
  try {
    response = await fetch(url, { method: 'GET', signal });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError' && options.signal?.aborted) {
      throw new DOMException('Web search was cancelled.', 'AbortError');
    }
    if (err.name === 'AbortError') {
      throw new DuckDuckGoSearchError('Web search timed out.', {
        code: 'TIMEOUT',
        cause: err,
      });
    }
    throw new DuckDuckGoSearchError('Web search request failed.', {
      code: 'NETWORK',
      cause: err,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  // --- Handle HTTP errors ---
  if (!response.ok) {
    let body = '';
    try {
      body = await readBoundedResponseText(response);
    } catch {
      // ignore read errors
    }
    if (response.status === 429) {
      throw new DuckDuckGoSearchError('DuckDuckGo is rate limiting requests. Try again later.', {
        code: 'RATE_LIMIT',
        status: response.status,
        cause: body.slice(0, 1000),
      });
    }
    throw new DuckDuckGoSearchError(`DuckDuckGo search failed (HTTP ${response.status}).`, {
      code: 'HTTP_ERROR',
      status: response.status,
      cause: body.slice(0, 1000),
    });
  }

  // --- Parse and validate ---
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new DuckDuckGoSearchError('Web search returned an unreadable response.', {
      code: 'PARSE',
      cause: err,
    });
  }

  if (!data || typeof data !== 'object') {
    throw new DuckDuckGoSearchError('Web search returned an unexpected response format.', {
      code: 'PARSE',
    });
  }

  const sources = normalizeSources(data);
  if (sources.length === 0) {
    throw new DuckDuckGoSearchError('Web search returned no usable sources.', {
      code: 'NO_RESULTS',
    });
  }

  return {
    query: trimmed,
    retrievedAt: new Date().toISOString(),
    sources,
  };
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
