/**
 * @fileoverview Unit tests for src/chat/ChatGrounding.js
 * @module chatGrounding.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isWebSearchEnabled,
  formatSourcesBlock,
  buildBodyWithSources,
  buildFinalResponseBody,
  normalizeSources,
  classifyToolExecutionResult,
} from '../src/chat/ChatGrounding.js';

/* ------------------------------------------------------------------ */
/*  isWebSearchEnabled                                                */
/* ------------------------------------------------------------------ */

describe('isWebSearchEnabled', () => {
  beforeEach(() => {
    global.chrome = {
      runtime: {
        lastError: null,
        sendMessage: (_request, callback) => callback({ configured: true }),
      },
    };
  });

  afterEach(() => {
    delete global.chrome;
  });

  it('returns true when the preference is stored and background reports a key', async () => {
    let requestedKeys;
    chrome.storage = {
      local: {
        get: (keys, cb) => {
          requestedKeys = keys;
          cb({ webSearchEnabled: true });
        },
      },
    };

    expect(await isWebSearchEnabled()).toBe(true);
    expect(requestedKeys).toEqual(['webSearchEnabled']);
    expect(requestedKeys).not.toContain('braveSearchApiKey');
  });

  it('returns false when no value is stored', async () => {
    chrome.storage = { local: { get: (keys, cb) => cb({}) } };
    expect(await isWebSearchEnabled()).toBe(false);
  });

  it('returns false when the preference is on but background reports no key', async () => {
    chrome.runtime.sendMessage = (_request, callback) => callback({ configured: false });
    chrome.storage = {
      local: { get: (keys, cb) => cb({ webSearchEnabled: true }) },
    };

    expect(await isWebSearchEnabled()).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  formatSourcesBlock                                                */
/* ------------------------------------------------------------------ */

describe('formatSourcesBlock', () => {
  it('returns empty string for an empty array', () => {
    expect(formatSourcesBlock([])).toBe('');
  });

  it('returns empty string for non-array input', () => {
    expect(formatSourcesBlock(null)).toBe('');
    expect(formatSourcesBlock(undefined)).toBe('');
  });

  it('renders a valid sources group with title and link', () => {
    const sources = [
      { id: 'src-1', title: 'Example', url: 'https://example.com', snippets: ['first snippet'] },
    ];
    const block = formatSourcesBlock(sources);
    expect(block).toContain('**Sources:**');
    expect(block).toContain('[Example](https://example.com/)');
  });

  it('escapes source-title Markdown injection', () => {
    const block = formatSourcesBlock([
      {
        id: 'src-1',
        title: 'Trusted](https://evil.example) - [Injected',
        url: 'https://trusted.example',
      },
    ]);
    expect(block).not.toContain('evil.example');
    expect(block).toContain('trusted.example');
  });

  it('strips non-http(s) URLs', () => {
    const sources = [
      { id: 's1', title: 'Bad', url: 'javascript:void(0)' },
      { id: 's2', title: 'Good', url: 'https://ok.com' },
    ];
    const block = formatSourcesBlock(sources);
    expect(block).not.toContain('javascript');
    expect(block).toContain('https://ok.com');
  });

  it('returns empty string when all entries have invalid URLs', () => {
    const sources = [
      { id: 's1', title: 'Bad', url: 'javascript:void(0)' },
      { id: 's2', title: 'Also bad', url: 'ftp://x.com' },
    ];
    expect(formatSourcesBlock(sources)).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/*  buildBodyWithSources                                               */
/* ------------------------------------------------------------------ */

describe('buildBodyWithSources', () => {
  it('returns content unchanged when there are no sources', () => {
    expect(buildBodyWithSources('Hello world', [])).toBe('Hello world');
  });

  it('returns content unchanged when sources is null/undefined', () => {
    expect(buildBodyWithSources('Hello world', null)).toBe('Hello world');
  });

  it('appends a Sources section after a blank separator', () => {
    const sources = [{ id: 'src-1', title: 'Page', url: 'https://example.com', snippets: ['a'] }];
    const body = buildBodyWithSources('Answer here', sources);
    expect(body).toContain('Answer here');
    expect(body).toContain('**Sources:**');
  });

  it('returns just content when content is empty and no sources', () => {
    expect(buildBodyWithSources('', [])).toBe('');
  });

  it('treats non-string content as empty string and appends sources', () => {
    const sources = [{ id: 's1', title: 'T', url: 'https://x.com', snippets: ['a'] }];
    const body = buildBodyWithSources(42, sources);
    expect(body).toContain('**Sources:**');
  });
});

describe('buildFinalResponseBody', () => {
  it('keeps a normal answer unchanged after reasoning', () => {
    expect(
      buildFinalResponseBody('Final answer', '', [], {
        hasReasoning: true,
        exhausted: false,
      })
    ).toBe('Final answer');
  });

  it('reports confirmed token exhaustion for a reasoning-only response', () => {
    expect(
      buildFinalResponseBody('', '', [], {
        hasReasoning: true,
        exhausted: true,
        reason: 'length',
      })
    ).toBe('⚠️ No final answer. The model used its token budget thinking.');
  });

  it('does not claim token exhaustion without confirmed completion metadata', () => {
    expect(
      buildFinalResponseBody('', '', [], {
        hasReasoning: true,
        exhausted: false,
        reason: 'stop',
      })
    ).toBe(
      '⚠️ The model returned reasoning but no final answer. Try again or choose a different model.'
    );
  });

  it('shows a neutral message for an empty non-reasoning completion with a stop reason', () => {
    expect(buildFinalResponseBody('', '', [], { hasReasoning: false, reason: 'stop' })).toBe(
      '⚠️ The model returned no final answer. Try again or choose a different model.'
    );
  });

  it('does not create a warning when no completion metadata exists', () => {
    expect(buildFinalResponseBody('', '', [])).toBe('');
  });
});

describe('classifyToolExecutionResult', () => {
  it('detects an error nested in the execution envelope', () => {
    expect(
      classifyToolExecutionResult({
        success: true,
        result: {
          error: 'WEB_SEARCH_ALREADY_USED',
          message: 'Continue without searching again.',
        },
      })
    ).toMatchObject({
      status: 'error',
      error: 'WEB_SEARCH_ALREADY_USED',
      message: 'Continue without searching again.',
    });
  });

  it('classifies a no-results search separately from execution failures', () => {
    expect(
      classifyToolExecutionResult({
        success: true,
        result: {
          error: 'WEB_SEARCH_NO_RESULTS',
          message: 'Web search returned no usable sources.',
        },
      })
    ).toMatchObject({ status: 'no_results', error: 'WEB_SEARCH_NO_RESULTS' });
  });

  it('recognizes successful search payloads', () => {
    expect(
      classifyToolExecutionResult({
        success: true,
        result: { query: 'weather', sources: [{ id: 'src-1' }] },
      }).status
    ).toBe('success');
  });
});

describe('normalizeSources', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeSources(null)).toEqual([]);
    expect(normalizeSources(undefined)).toEqual([]);
    expect(normalizeSources('not-array')).toEqual([]);
  });

  it('filters entries missing a url', () => {
    const raw = [
      { id: 's1', title: 'T', url: 'https://ok.com' },
      { id: 's2', title: 'No URL' },
      { url: 'https://also-ok.com' },
      {},
    ];
    const result = normalizeSources(raw);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toContain('s1');
    expect(result.map((r) => r.id)).toContain('https://also-ok.com');
  });

  it('strips non-http(s) URLs', () => {
    const raw = [
      { id: 's1', title: 'Good', url: 'https://example.com' },
      { id: 's2', title: 'Bad 1', url: 'javascript:void(0)' },
      { id: 's3', title: 'Bad 2', url: 'ftp://example.com' },
      { id: 's4', title: 'Bad 3', url: 'data:text/plain,hi' },
    ];
    const result = normalizeSources(raw);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com');
  });

  it('deduplicates by id (first wins)', () => {
    const raw = [
      { id: 's1', title: 'First', url: 'https://a.com' },
      { id: 's1', title: 'Second', url: 'https://b.com' },
    ];
    const result = normalizeSources(raw);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('First');
  });

  it('truncates long titles to 200 chars', () => {
    const longTitle = 'x'.repeat(300);
    const raw = [{ id: 's1', title: longTitle, url: 'https://x.com' }];
    const result = normalizeSources(raw);
    expect(result[0].title.length).toBe(200);
  });
});
