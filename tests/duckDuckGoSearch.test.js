/**
 * @fileoverview Unit tests for src/utils/duckDuckGoSearch.js
 *
 * @module duckDuckGoSearch.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  executeDuckDuckGoSearch,
  DDG_INSTANT_ANSWER_ENDPOINT,
  DuckDuckGoSearchError,
  isValidSourceUrl,
  MAX_QUERY_LENGTH,
  MAX_QUERY_WORDS,
} from '../src/utils/duckDuckGoSearch.js';

/** Build a minimal fake Response-like object. */
function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

/* ------------------------------------------------------------------ */
/*  Input validation                                                   */
/* ------------------------------------------------------------------ */

describe('executeDuckDuckGoSearch input validation', () => {
  it('rejects missing or empty query', async () => {
    await expect(executeDuckDuckGoSearch(null)).rejects.toThrow(DuckDuckGoSearchError);
    await expect(executeDuckDuckGoSearch(undefined)).rejects.toThrow(DuckDuckGoSearchError);
    await expect(executeDuckDuckGoSearch('')).rejects.toThrow(DuckDuckGoSearchError);
    await expect(executeDuckDuckGoSearch('   ')).rejects.toThrow(DuckDuckGoSearchError);
  });

  it('rejects query over MAX_QUERY_LENGTH', async () => {
    const long = 'a'.repeat(MAX_QUERY_LENGTH + 1);
    await expect(executeDuckDuckGoSearch(long)).rejects.toThrow(DuckDuckGoSearchError);
  });

  it('rejects query over MAX_QUERY_WORDS', async () => {
    const manyWords = Array.from({ length: MAX_QUERY_WORDS + 1 }, () => 'word').join(' ');
    await expect(executeDuckDuckGoSearch(manyWords)).rejects.toThrow(DuckDuckGoSearchError);
  });
});

/* ------------------------------------------------------------------ */
/*  Response handling                                                  */
/* ------------------------------------------------------------------ */

describe('executeDuckDuckGoSearch fetch handling', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // no-op; each test installs its own fetch stub
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('normalizes direct and nested RelatedTopics plus Abstract', async () => {
    const body = {
      Heading: 'Cats',
      AbstractText: 'A small domesticated carnivorous mammal.',
      AbstractURL: 'https://en.wikipedia.org/wiki/Cat',
      Results: [],
      // Real DDG Text uses a single space between the title and the
      // description, with no separate title field.
      RelatedTopics: [
        { FirstURL: 'https://duckduckgo.com/Cat', Text: 'Cat A pet.' },
        {
          Name: 'Entertainment',
          Topics: [
            { FirstURL: 'https://duckduckgo.com/Cats_(musical)', Text: 'Cats (musical) A show.' },
          ],
        },
      ],
    };
    global.fetch = async () => jsonResponse(body);
    const result = await executeDuckDuckGoSearch('cats');
    expect(result.query).toBe('cats');
    expect(result.retrievedAt).toBeTruthy();
    // Abstract first, then direct topic, then nested category topic.
    expect(result.sources[0].url).toBe('https://en.wikipedia.org/wiki/Cat');
    expect(result.sources[1].url).toBe('https://duckduckgo.com/Cat');
    expect(result.sources[2].url).toBe('https://duckduckgo.com/Cats_(musical)');
    expect(result.sources[0].snippets[0]).toContain('mammal');
    // Snippet retains the leading title token (single-space Text).
    expect(result.sources[1].snippets[0]).toBe('Cat A pet.');
  });

  it('dedupes repeated URLs', async () => {
    const body = {
      RelatedTopics: [
        { FirstURL: 'https://duckduckgo.com/X', Text: 'X First.' },
        { FirstURL: 'https://duckduckgo.com/X', Text: 'X Second.' },
      ],
    };
    global.fetch = async () => jsonResponse(body);
    const result = await executeDuckDuckGoSearch('x');
    const matches = result.sources.filter((s) => s.url === 'https://duckduckgo.com/X');
    expect(matches).toHaveLength(1);
  });

  it('throws NO_RESULTS when no usable sources', async () => {
    const body = {
      Heading: '',
      AbstractURL: '',
      Results: [],
      RelatedTopics: [{ Name: 'Empty', Topics: [] }],
    };
    global.fetch = async () => jsonResponse(body);
    await expect(executeDuckDuckGoSearch('nothing here')).rejects.toThrow(DuckDuckGoSearchError);
    await expect(executeDuckDuckGoSearch('nothing here')).rejects.toMatchObject({
      code: 'NO_RESULTS',
    });
  });

  it('throws PARSE on non-JSON body', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    });
    await expect(executeDuckDuckGoSearch('x')).rejects.toMatchObject({ code: 'PARSE' });
  });

  it('throws on non-200 response', async () => {
    global.fetch = async () => jsonResponse({ error: 'boom' }, false, 500);
    await expect(executeDuckDuckGoSearch('x')).rejects.toBeInstanceOf(DuckDuckGoSearchError);
  });

  it('uses the fixed Instant Answer endpoint', async () => {
    expect(DDG_INSTANT_ANSWER_ENDPOINT).toBe('https://api.duckduckgo.com/');
  });
});

/* ------------------------------------------------------------------ */
/*  URL validity helper                                                */
/* ------------------------------------------------------------------ */

describe('isValidSourceUrl', () => {
  it('accepts http and https', () => {
    expect(isValidSourceUrl('https://example.com/foo')).toBe(true);
    expect(isValidSourceUrl('http://example.com')).toBe(true);
  });

  it('rejects non-http schemes and garbage', () => {
    expect(isValidSourceUrl('ftp://example.com')).toBe(false);
    expect(isValidSourceUrl('javascript:alert(1)')).toBe(false);
    expect(isValidSourceUrl('not a url')).toBe(false);
    expect(isValidSourceUrl('')).toBe(false);
    expect(isValidSourceUrl(null)).toBe(false);
  });
});
