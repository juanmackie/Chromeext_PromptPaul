/**
 * @fileoverview Bounded Brave LLM Context API client for web-search grounding.
 * Only runs inside the service worker (background.js) to keep credentials
 * out of page-accessible modules.
 *
 * @module braveSearch
 */

import { readBoundedResponseText } from './streamSafety.js';
import { redactProviderErrorMessage } from './runResilience.js';

/**
 * Fixed endpoint: never accept a caller-supplied URL.
 * Brave recommends the LLM Context endpoint for agent grounding:
 * https://api-dashboard.search.brave.com/documentation/services/llm-context
 * @const {string}
 */
export const BRAVE_LLM_CONTEXT_ENDPOINT = 'https://api.search.brave.com/res/v1/llm/context';

/** Max search query length (Brave limit: 400 chars, 50 words). */
export const MAX_QUERY_LENGTH = 400;

/** Max words in the query. */
export const MAX_QUERY_WORDS = 50;

/** Max result URLs to consider (Brave default: 20, max 50). Use a conservative budget. */
export const DEFAULT_COUNT = 5;

/** Max context tokens (Brave range: 1024–32768). */
export const DEFAULT_MAX_TOKENS = 2048;

/** Max snippets across all URLs (Brave max: 100). */
export const DEFAULT_MAX_SNIPPETS = 15;

/** Max snippets per URL (Brave max: 100). */
export const DEFAULT_SNIPPETS_PER_URL = 5;

/** Max tokens per URL (Brave range: 512–8192). Keep modest. */
export const DEFAULT_TOKENS_PER_URL = 1024;

/** Max serialized result size in bytes (prevents blowing context). */
export const MAX_RESULT_BYTES = 50_000;

/** Max source URL entries in the normalized result. */
export const MAX_NORMALIZED_SOURCES = 10;

/** Request timeout in ms. */
export const BRAVE_TIMEOUT_MS = 30000;

/**
 * Allowed freshness values.
 * @enum {string}
 */
export const Freshness = Object.freeze({
  DAY: 'pd',
  WEEK: 'pw',
  MONTH: 'pm',
  YEAR: 'py',
});

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
 * Censor the last N characters of a key for safe logging.
 * @param {string} key
 * @param {number} [visible=4]
 * @returns {string}
 */
export function maskApiKey(key, visible = 4) {
  if (!key) return '';
  if (key.length <= visible + 4) return key.slice(0, 2) + '…' + key.slice(-2);
  return key.slice(0, visible) + '…' + key.slice(-visible);
}

/**
 * Pull a short, safe reason out of a Brave error response body so the user
 * sees why a 400 was rejected. Handles plain-text, flat JSON, and nested
 * `error.detail` / `error.code` bodies (Brave's structured plan errors).
 * Bounded and credential-redacted; never returns '[object Object]'.
 * @param {string} body
 * @returns {string}
 */
export function extractBraveErrorReason(body) {
  if (!body) return '';
  let raw = '';
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    if (parsed && typeof parsed === 'object') {
      const err = parsed.error && typeof parsed.error === 'object' ? parsed.error : null;
      const nestedDetail = err && typeof err.detail === 'string' ? err.detail : '';
      const nestedCode = err && typeof err.code === 'string' ? err.code : '';
      raw =
        parsed.reason ||
        parsed.message ||
        parsed.detail ||
        (typeof parsed.error === 'string' ? parsed.error : '') ||
        nestedDetail ||
        nestedCode ||
        (parsed.errors && Array.isArray(parsed.errors)
          ? parsed.errors
              .map((e) => (typeof e === 'string' ? e : e && e.detail ? e.detail : ''))
              .filter(Boolean)
              .join('; ')
          : '');
    }
  } catch {
    raw = body;
  }
  return redactProviderErrorMessage(raw, 300);
}

/**
 * Detect Brave's structured "LLM Context not included in this plan"
 * restriction from a (possibly nested) error body.
 * @param {string} body
 * @returns {boolean}
 */
export function isPlanRestricted(body) {
  if (!body) return false;
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    if (!parsed || typeof parsed !== 'object') return false;
    const err = parsed.error && typeof parsed.error === 'object' ? parsed.error : null;
    return Boolean(
      parsed.code === 'OPTION_NOT_IN_PLAN' ||
      (err && typeof err.code === 'string' && err.code === 'OPTION_NOT_IN_PLAN')
    );
  } catch {
    return false;
  }
}

/**
 * Error class for Brave API failures. The `userMessage` is safe to surface
 * in the UI; the internal `cause` is logged separately.
 */
export class BraveSearchError extends Error {
  /**
   * @param {string} userMessage - User-safe error description.
   * @param {object} [options] - { cause, code?, status? }
   */
  constructor(userMessage, options = {}) {
    super(userMessage);
    this.name = 'BraveSearchError';
    this.userMessage = userMessage;
    this.code = options.code || 'UNKNOWN';
    this.status = options.status || null;
    this.cause = options.cause;
  }
}

/**
 * Normalized Brave search result.
 * @typedef {Object} BraveSearchResult
 * @property {string} query - The original search query.
 * @property {string} retrievedAt - ISO timestamp.
 * @property {Array<{id: string, title: string, url: string, snippets: string[]}>} sources
 */

/**
 * Execute a bounded web search against Brave's LLM Context API.
 *
 * @param {string} query - Search query (1–400 chars, ≤50 words).
 * @param {string} apiKey - Brave Search API key.
 * @param {object} [options]
 * @param {string} [options.freshness] - One of Freshness enum values.
 * @param {AbortSignal} [options.signal] - Optional abort signal.
 * @returns {Promise<BraveSearchResult>}
 * @throws {BraveSearchError} On invalid input, API errors, timeout, etc.
 */
export async function executeBraveSearch(query, apiKey, options = {}) {
  // --- Input validation ---
  if (!query || typeof query !== 'string') {
    throw new BraveSearchError('Search query is required.', { code: 'INVALID_QUERY' });
  }
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new BraveSearchError('Search query is empty.', { code: 'INVALID_QUERY' });
  }
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new BraveSearchError(`Search query exceeds ${MAX_QUERY_LENGTH} characters.`, {
      code: 'INVALID_QUERY',
    });
  }
  if (trimmed.split(/\s+/).length > MAX_QUERY_WORDS) {
    throw new BraveSearchError(`Search query exceeds ${MAX_QUERY_WORDS} words.`, {
      code: 'INVALID_QUERY',
    });
  }

  if (!apiKey || typeof apiKey !== 'string') {
    throw new BraveSearchError('Brave Search API key is not configured.', { code: 'NO_KEY' });
  }

  const freshness = options.freshness;
  if (freshness && !Object.values(Freshness).includes(freshness)) {
    throw new BraveSearchError(`Invalid freshness value "${freshness}".`, {
      code: 'INVALID_FRESHNESS',
    });
  }

  // --- Build request ---
  const params = new URLSearchParams({
    q: trimmed,
    count: String(DEFAULT_COUNT),
    maximum_number_of_urls: String(DEFAULT_COUNT),
    maximum_number_of_tokens: String(DEFAULT_MAX_TOKENS),
    maximum_number_of_snippets: String(DEFAULT_MAX_SNIPPETS),
    maximum_number_of_snippets_per_url: String(DEFAULT_SNIPPETS_PER_URL),
    maximum_number_of_tokens_per_url: String(DEFAULT_TOKENS_PER_URL),
  });

  if (freshness) {
    params.set('freshness', freshness);
  }

  const url = `${BRAVE_LLM_CONTEXT_ENDPOINT}?${params.toString()}`;

  // --- Execute with timeout ---
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BRAVE_TIMEOUT_MS);

  // Combine our timeout with the caller's signal
  const combinedSignal = options.signal
    ? combineAbortSignals(options.signal, controller.signal)
    : controller.signal;

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: combinedSignal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError' && options.signal?.aborted) {
      throw new DOMException('Web search was cancelled.', 'AbortError');
    }
    if (err.name === 'AbortError') {
      throw new BraveSearchError('Web search timed out.', {
        code: 'TIMEOUT',
        cause: err,
      });
    }
    throw new BraveSearchError('Web search request failed.', {
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

    if (response.status === 400) {
      if (isPlanRestricted(body)) {
        throw new BraveSearchError(
          'Your Brave Search API plan does not include LLM Context. Use a Brave API key with LLM Context access in Options.',
          { code: 'PLAN_RESTRICTED', status: response.status, cause: body.slice(0, 1000) }
        );
      }
      const reason = extractBraveErrorReason(body);
      const suffix = reason ? ` Reason: ${reason}` : '';
      throw new BraveSearchError(
        'Brave Search rejected the request. Try a shorter query or check the search settings.' +
          suffix,
        {
          code: 'BAD_REQUEST',
          status: response.status,
          cause: body.slice(0, 1000),
        }
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new BraveSearchError(
        'Brave Search API key is invalid or expired. Update it in Options.',
        { code: 'AUTH', status: response.status }
      );
    }
    if (response.status === 429) {
      throw new BraveSearchError(
        'Brave Search API rate limit or monthly quota exceeded. Check your plan or try again later.',
        { code: 'RATE_LIMIT', status: response.status }
      );
    }
    throw new BraveSearchError(`Brave Search API error (HTTP ${response.status}).`, {
      code: 'HTTP_ERROR',
      status: response.status,
      cause: body,
    });
  }

  // --- Parse and normalize response ---
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new BraveSearchError('Web search returned an unreadable response.', {
      code: 'PARSE',
      cause: err,
    });
  }

  // --- Validate structure ---
  const grounding = data && typeof data === 'object' ? data.grounding : null;
  if (!grounding || typeof grounding !== 'object') {
    throw new BraveSearchError('Web search returned an unexpected response format.', {
      code: 'PARSE',
    });
  }

  const generic = Array.isArray(grounding.generic) ? grounding.generic : [];
  // --- Normalize ---
  const normalized = {
    query: trimmed,
    retrievedAt: new Date().toISOString(),
    sources: [],
  };

  let totalBytes = 0;

  for (const entry of generic) {
    if (normalized.sources.length >= MAX_NORMALIZED_SOURCES) break;

    const url = String(entry.url || '').trim();
    if (!isValidSourceUrl(url)) continue;

    const title = String(entry.title || '').trim();
    const rawSnippets = Array.isArray(entry.snippets) ? entry.snippets : [];
    const snippets = rawSnippets
      .map((s) => String(s).trim().slice(0, 6000))
      .filter((s) => s.length > 0)
      .slice(0, DEFAULT_SNIPPETS_PER_URL);

    const id = `src-${normalized.sources.length + 1}`;

    const sourceEntry = { id, title: title.slice(0, 200), url, snippets };

    // Check total serialized size budget
    const entryJson = JSON.stringify(sourceEntry);
    const entryBytes = new TextEncoder().encode(entryJson).byteLength;
    if (totalBytes + entryBytes > MAX_RESULT_BYTES) break;
    totalBytes += entryBytes;

    normalized.sources.push(sourceEntry);
  }

  if (normalized.sources.length === 0) {
    throw new BraveSearchError('Web search returned no usable sources.', {
      code: 'NO_RESULTS',
    });
  }

  return normalized;
}

/**
 * Combine two AbortSignals into one. If either signal aborts, the combined
 * signal aborts with the same reason.
 * @param {AbortSignal} s1
 * @param {AbortSignal} s2
 * @returns {AbortSignal}
 */
function combineAbortSignals(s1, s2) {
  const controller = new AbortController();

  const onAbort = () => {
    controller.abort(s1.reason || s2.reason);
  };

  if (s1.aborted || s2.aborted) {
    onAbort();
  } else {
    s1.addEventListener('abort', onAbort, { once: true });
    s2.addEventListener('abort', onAbort, { once: true });
  }

  return controller.signal;
}
