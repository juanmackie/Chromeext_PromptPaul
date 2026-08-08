/**
 * @fileoverview Unit tests for src/utils/braveSearch.js
 *
 * @module braveSearch.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  executeBraveSearch,
  BRAVE_LLM_CONTEXT_ENDPOINT,
  isValidSourceUrl,
  maskApiKey,
  MAX_QUERY_LENGTH,
  MAX_QUERY_WORDS,
  Freshness,
  BraveSearchError,
  MAX_NORMALIZED_SOURCES,
} from '../src/utils/braveSearch.js';

/* ------------------------------------------------------------------ */
/*  Input validation                                                   */
/* ------------------------------------------------------------------ */

describe('executeBraveSearch input validation', () => {
  it('rejects missing query', async () => {
    await expect(executeBraveSearch(null, 'key')).rejects.toThrow(BraveSearchError);
    await expect(executeBraveSearch(undefined, 'key')).rejects.toThrow(BraveSearchError);
    await expect(executeBraveSearch('', 'key')).rejects.toThrow(BraveSearchError);
    await expect(executeBraveSearch('   ', 'key')).rejects.toThrow(BraveSearchError);
  });

  it('rejects query over MAX_QUERY_LENGTH', async () => {
    const long = 'a'.repeat(MAX_QUERY_LENGTH + 1);
    await expect(executeBraveSearch(long, 'key')).rejects.toThrow(BraveSearchError);
  });

  it('rejects query over MAX_QUERY_WORDS', async () => {
    const manyWords = Array.from({ length: MAX_QUERY_WORDS + 1 }, () => 'word').join(' ');
    await expect(executeBraveSearch(manyWords, 'key')).rejects.toThrow(BraveSearchError);
  });

  it('rejects missing apiKey', async () => {
    await expect(executeBraveSearch('test', '')).rejects.toThrow(BraveSearchError);
    await expect(executeBraveSearch('test', null)).rejects.toThrow(BraveSearchError);
  });

  it('rejects invalid freshness', async () => {
    await expect(executeBraveSearch('test', 'key', { freshness: 'invalid' })).rejects.toThrow(
      BraveSearchError
    );
  });

  it('accepts valid freshness values', () => {
    // Valid values should not throw validation (API call will be tested below)
    expect(Freshness.DAY).toBe('pd');
    expect(Freshness.WEEK).toBe('pw');
    expect(Freshness.MONTH).toBe('pm');
    expect(Freshness.YEAR).toBe('py');
  });
});

/* ------------------------------------------------------------------ */
/*  HTTP error mapping                                                 */
/* ------------------------------------------------------------------ */

describe('executeBraveSearch HTTP error mapping', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(status, body = '') {
    global.fetch = async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
      json: async () => JSON.parse(body),
    });
  }

  it('throws AUTH error for 401', async () => {
    mockFetch(401);
    await expect(executeBraveSearch('test', 'bad-key')).rejects.toThrow(/invalid or expired/);
  });

  it('throws AUTH error for 403', async () => {
    mockFetch(403);
    await expect(executeBraveSearch('test', 'bad-key')).rejects.toThrow(/invalid or expired/);
  });

  it('throws RATE_LIMIT error for 429', async () => {
    mockFetch(429);
    await expect(executeBraveSearch('test', 'key')).rejects.toThrow(/rate limit/);
  });

  it('classifies 400 as a safe bad-request error', async () => {
    mockFetch(400, '{"error":"unsupported parameter"}');
    await expect(executeBraveSearch('test', 'key')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
      userMessage:
        'Brave Search rejected the request. Try a shorter query or check the search settings.',
      cause: '{"error":"unsupported parameter"}',
    });
  });

  it('throws generic error for 5xx', async () => {
    mockFetch(500);
    await expect(executeBraveSearch('test', 'key')).rejects.toThrow(/HTTP 500/);
  });

  it('throws NETWORK error on fetch rejection', async () => {
    global.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(executeBraveSearch('test', 'key')).rejects.toThrow(/request failed/);
  });

  it('throws TIMEOUT error on abort', async () => {
    const controller = new AbortController();
    controller.abort();
    global.fetch = async () => {
      // Simulate abort
      throw new DOMException('The operation was aborted', 'AbortError');
    };
    await expect(executeBraveSearch('test', 'key', { signal: controller.signal })).rejects.toThrow(
      /cancelled/
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Request contract                                                   */
/* ------------------------------------------------------------------ */

describe('executeBraveSearch request contract', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uses only documented LLM Context query parameters', async () => {
    let request;
    global.fetch = async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          grounding: {
            generic: [
              {
                url: 'https://example.com',
                title: 'Example',
                snippets: ['A result'],
              },
            ],
          },
        }),
      };
    };

    await executeBraveSearch('test query', 'redacted-key', { freshness: Freshness.WEEK });

    const parsedUrl = new URL(request.url);
    expect(`${parsedUrl.origin}${parsedUrl.pathname}`).toBe(BRAVE_LLM_CONTEXT_ENDPOINT);
    expect([...parsedUrl.searchParams.keys()].sort()).toEqual([
      'count',
      'freshness',
      'maximum_number_of_snippets',
      'maximum_number_of_snippets_per_url',
      'maximum_number_of_tokens',
      'maximum_number_of_tokens_per_url',
      'maximum_number_of_urls',
      'q',
    ]);
    expect(parsedUrl.searchParams.get('q')).toBe('test query');
    expect(parsedUrl.searchParams.get('count')).toBe('5');
    expect(parsedUrl.searchParams.get('maximum_number_of_urls')).toBe('5');
    expect(parsedUrl.searchParams.get('maximum_number_of_tokens')).toBe('2048');
    expect(parsedUrl.searchParams.get('maximum_number_of_snippets')).toBe('15');
    expect(parsedUrl.searchParams.get('maximum_number_of_snippets_per_url')).toBe('5');
    expect(parsedUrl.searchParams.get('maximum_number_of_tokens_per_url')).toBe('1024');
    expect(parsedUrl.searchParams.get('freshness')).toBe(Freshness.WEEK);
    expect(parsedUrl.searchParams.has('extra_snippets')).toBe(false);
    expect(request.init.method).toBe('GET');
    expect(request.init.headers['X-Subscription-Token']).toBe('redacted-key');
  });

  it('omits optional freshness when it is not supplied', async () => {
    let requestedUrl;
    global.fetch = async (url) => {
      requestedUrl = new URL(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          grounding: {
            generic: [{ url: 'https://example.com', title: 'Example', snippets: [] }],
          },
        }),
      };
    };

    await executeBraveSearch('test query', 'redacted-key');

    expect(requestedUrl.searchParams.has('freshness')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Response parsing                                                   */
/* ------------------------------------------------------------------ */

describe('executeBraveSearch response parsing', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchWithData(data) {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
      json: async () => data,
    });
  }

  it('normalizes a valid response', async () => {
    mockFetchWithData({
      grounding: {
        generic: [
          {
            url: 'https://example.com/page-1',
            title: 'Example Page 1',
            snippets: ['First snippet.', 'Second snippet.'],
          },
          {
            url: 'https://example.com/page-2',
            title: 'Example Page 2',
            snippets: ['Another snippet.'],
          },
        ],
      },
      sources: {
        'https://example.com/page-1': { title: 'Example Page 1', hostname: 'example.com' },
        'https://example.com/page-2': { title: 'Example Page 2', hostname: 'example.com' },
      },
    });

    const result = await executeBraveSearch('test query', 'valid-key');
    expect(result.query).toBe('test query');
    expect(result.retrievedAt).toBeTruthy();
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toEqual({
      id: 'src-1',
      title: 'Example Page 1',
      url: 'https://example.com/page-1',
      snippets: ['First snippet.', 'Second snippet.'],
    });
    expect(result.sources[1]).toEqual({
      id: 'src-2',
      title: 'Example Page 2',
      url: 'https://example.com/page-2',
      snippets: ['Another snippet.'],
    });
  });

  it('filters out non-http(s) URLs', async () => {
    mockFetchWithData({
      grounding: {
        generic: [
          { url: 'javascript:void(0)', title: 'Bad', snippets: ['bad'] },
          { url: 'ftp://example.com', title: 'FTP', snippets: ['bad'] },
          { url: 'https://good.com', title: 'Good', snippets: ['good'] },
        ],
      },
      sources: {},
    });

    const result = await executeBraveSearch('test', 'key');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].url).toBe('https://good.com');
  });

  it('caps snippets per URL', async () => {
    const manySnippets = Array.from({ length: 10 }, (_, i) => `snippet ${i}`);
    mockFetchWithData({
      grounding: {
        generic: [{ url: 'https://example.com', title: 'E', snippets: manySnippets }],
      },
      sources: {},
    });

    const result = await executeBraveSearch('test', 'key');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].snippets.length).toBeLessThanOrEqual(5);
  });

  it('caps total source entries', async () => {
    const manyEntries = Array.from({ length: 20 }, (_, i) => ({
      url: `https://example.com/page-${i}`,
      title: `Page ${i}`,
      snippets: [`snippet ${i}`],
    }));
    mockFetchWithData({
      grounding: { generic: manyEntries },
      sources: {},
    });

    const result = await executeBraveSearch('test', 'key');
    expect(result.sources.length).toBeLessThanOrEqual(MAX_NORMALIZED_SOURCES);
  });

  it('respects MAX_RESULT_BYTES budget', async () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      url: `https://example.com/${index}`,
      title: `Page ${index}`,
      snippets: ['x'.repeat(6000)],
    }));
    mockFetchWithData({ grounding: { generic: entries }, sources: {} });

    const result = await executeBraveSearch('test', 'key');
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources.length).toBeLessThan(10);
  });

  it('throws on missing grounding field', async () => {
    mockFetchWithData({});
    await expect(executeBraveSearch('test', 'key')).rejects.toThrow(/unexpected/);
  });

  it('throws on null grounding', async () => {
    mockFetchWithData({ grounding: null });
    await expect(executeBraveSearch('test', 'key')).rejects.toThrow(/unexpected/);
  });

  it('returns a safe NO_RESULTS error when no usable sources are found', async () => {
    mockFetchWithData({ grounding: { generic: [] }, sources: {} });

    await expect(executeBraveSearch('test', 'key')).rejects.toMatchObject({
      code: 'NO_RESULTS',
      userMessage: 'Web search returned no usable sources.',
    });
  });

  it('handles missing snippets array', async () => {
    mockFetchWithData({
      grounding: { generic: [{ url: 'https://example.com', title: 'No snippets' }] },
      sources: {},
    });
    const result = await executeBraveSearch('test', 'key');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].snippets).toEqual([]);
  });

  it('strips empty-string snippets', async () => {
    mockFetchWithData({
      grounding: {
        generic: [
          {
            url: 'https://example.com',
            title: 'Mixed',
            snippets: ['good', '', '  ', 'also good'],
          },
        ],
      },
      sources: {},
    });
    const result = await executeBraveSearch('test', 'key');
    expect(result.sources[0].snippets).toEqual(['good', 'also good']);
  });
});

/* ------------------------------------------------------------------ */
/*  Utility helpers                                                    */
/* ------------------------------------------------------------------ */

describe('isValidSourceUrl', () => {
  it('accepts http and https', () => {
    expect(isValidSourceUrl('http://example.com')).toBe(true);
    expect(isValidSourceUrl('https://example.com')).toBe(true);
  });

  it('rejects non-http protocols', () => {
    expect(isValidSourceUrl('ftp://example.com')).toBe(false);
    expect(isValidSourceUrl('javascript:void(0)')).toBe(false);
    expect(isValidSourceUrl('data:text/plain,hi')).toBe(false);
  });

  it('rejects empty, null, and non-string', () => {
    expect(isValidSourceUrl('')).toBe(false);
    expect(isValidSourceUrl(null)).toBe(false);
    expect(isValidSourceUrl(undefined)).toBe(false);
    expect(isValidSourceUrl(42)).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isValidSourceUrl('not a url')).toBe(false);
    expect(isValidSourceUrl('')).toBe(false);
  });
});

describe('maskApiKey', () => {
  it('masks long keys', () => {
    const masked = maskApiKey('abcdef1234567890');
    expect(masked).toContain('…');
    expect(masked).not.toContain('123456');
  });

  it('shows first and last few chars', () => {
    const masked = maskApiKey('abcdef1234567890', 3);
    expect(masked.startsWith('abc')).toBe(true);
    expect(masked.endsWith('890')).toBe(true);
  });

  it('handles empty input', () => {
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey(null)).toBe('');
  });

  it('handles very short keys', () => {
    const masked = maskApiKey('short');
    expect(masked).toBeTruthy();
    expect(masked.length).toBeLessThanOrEqual(6);
  });
});

/* ------------------------------------------------------------------ */
/*  BraveSearchError                                                    */
/* ------------------------------------------------------------------ */

describe('BraveSearchError', () => {
  it('sets userMessage and code', () => {
    const err = new BraveSearchError('Something went wrong', { code: 'TEST', status: 500 });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BraveSearchError');
    expect(err.userMessage).toBe('Something went wrong');
    expect(err.code).toBe('TEST');
    expect(err.status).toBe(500);
  });

  it('defaults code to UNKNOWN', () => {
    const err = new BraveSearchError('msg');
    expect(err.code).toBe('UNKNOWN');
    expect(err.status).toBeNull();
  });
});
