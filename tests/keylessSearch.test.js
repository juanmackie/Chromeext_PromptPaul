/**
 * @fileoverview Unit tests for src/utils/keylessSearch.js — the keyless Exa
 * hosted MCP search client with the Parallel hosted Search MCP fallback.
 *
 * global.fetch is always stubbed; no live network request can escape.
 *
 * @module keylessSearch.test
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  executeKeylessSearch,
  callMcpTool,
  parseParallelResultText,
  parseExaResultText,
  EXA_MCP_ENDPOINT,
  PARALLEL_MCP_ENDPOINT,
  EXA_TOOL_NAME,
  PARALLEL_TOOL_NAME,
  NUM_RESULTS,
  MAX_QUERY_LENGTH,
  MAX_QUERY_WORDS,
  MAX_NORMALIZED_SOURCES,
  KeylessSearchError,
} from '../src/utils/keylessSearch.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

/* ------------------------------------------------------------------ */
/*  Fake response + fetch stub helpers                                 */
/* ------------------------------------------------------------------ */

/** Build a minimal fake Response-like object consumable by the bounded reader. */
function textResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => body };
}

/** Wrap a JSON-RPC result payload in the SSE "event: message" frame Exa returns. */
function sseBody(text) {
  return `event: message\ndata: ${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text }] },
  })}\n\n`;
}

/** Build a one-block (or multi-block joined) Exa result text. */
function exaBlock({ title, url, kind = 'Highlights', lines }) {
  return [
    'Title: ' + title,
    'URL: ' + url,
    'Published: N/A',
    'Author: N/A',
    kind + ':',
    ...lines,
  ].join('\n');
}

/** Parallel's result.content[0].text is a JSON string of this shape. */
function parallelResultsText(results) {
  return JSON.stringify({ search_id: 'search-1', results });
}

/** Plain JSON-RPC body (Parallel returns application/json, not SSE). */
function jsonRpcBody(text) {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } });
}

/** Install a fetch stub returning the queued responses in order; record calls. */
function installFetchStub(responses) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    // Mirror real fetch: an already-aborted signal rejects before any response.
    if (init && init.signal && init.signal.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    const next = responses.shift();
    if (!next) throw new Error('fetch stub exhausted');
    return next;
  };
  return calls;
}

/** Read a request header value from a plain object or Headers instance. */
function headerValue(init, name) {
  const headers = init && init.headers;
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name);
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) return value;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  1. Happy path: Exa SSE normalization                                */
/* ------------------------------------------------------------------ */

describe('executeKeylessSearch happy path (Exa SSE)', () => {
  it('normalizes two blocks (Highlights and Text) with src-1/src-2 ids and drops "..." lines', async () => {
    const text = [
      exaBlock({
        title: 'First Result',
        url: 'https://example.com/first',
        lines: ['First highlight one.', '...', 'First highlight two.'],
      }),
      exaBlock({
        title: 'Second Result',
        url: 'https://example.com/second',
        kind: 'Text',
        lines: ['Some body text here.'],
      }),
    ].join('\n\n---\n\n');

    const calls = installFetchStub([textResponse(sseBody(text))]);
    const result = await executeKeylessSearch('quantum computing');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(EXA_MCP_ENDPOINT);
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].id).toBe('src-1');
    expect(result.sources[1].id).toBe('src-2');
    expect(result.sources[0].title).toBe('First Result');
    expect(result.sources[0].url).toBe('https://example.com/first');
    expect(result.sources[1].title).toBe('Second Result');
    expect(result.sources[1].url).toBe('https://example.com/second');

    expect(result.sources[0].snippets).toHaveLength(1);
    const snippet = result.sources[0].snippets[0];
    expect(snippet).toContain('First highlight one.');
    expect(snippet).toContain('First highlight two.');
    expect(snippet).not.toContain('...');
    expect(snippet).not.toContain('Highlights:');
    expect(result.sources[1].snippets[0]).toContain('Some body text here.');
  });
});

/* ------------------------------------------------------------------ */
/*  2-4. Fallback behavior                                             */
/* ------------------------------------------------------------------ */

describe('executeKeylessSearch fallback', () => {
  const parallelOk = () =>
    textResponse(
      jsonRpcBody(
        parallelResultsText([
          {
            url: 'https://p.example.com/a',
            title: 'Parallel One',
            publish_date: null,
            excerpts: ['parallel excerpt'],
          },
        ])
      )
    );

  it('falls back to Parallel when Exa returns HTTP 429', async () => {
    const calls = installFetchStub([
      textResponse('rate limited', { ok: false, status: 429 }),
      parallelOk(),
    ]);
    const result = await executeKeylessSearch('quantum computing');

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(EXA_MCP_ENDPOINT);
    expect(calls[1].url).toBe(PARALLEL_MCP_ENDPOINT);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].url).toBe('https://p.example.com/a');
    expect(result.sources[0].title).toBe('Parallel One');
  });

  const exaToolErrorBody = () =>
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        isError: true,
        content: [{ type: 'text', text: 'web_search_exa error (429): rate limit exceeded' }],
      },
    });

  it('maps an Exa tool-level 429 isError body to RATE_LIMIT on the leg', async () => {
    installFetchStub([textResponse(`event: message\ndata: ${exaToolErrorBody()}\n\n`)]);
    await expect(
      callMcpTool({
        endpoint: EXA_MCP_ENDPOINT,
        tool: EXA_TOOL_NAME,
        args: { query: 'quantum computing', numResults: NUM_RESULTS },
      })
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  });

  it('falls back to Parallel after a tool-level Exa failure and returns Parallel sources', async () => {
    const calls = installFetchStub([
      textResponse(`event: message\ndata: ${exaToolErrorBody()}\n\n`),
      parallelOk(),
    ]);
    const result = await executeKeylessSearch('quantum computing');

    expect(calls).toHaveLength(2);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].url).toBe('https://p.example.com/a');
  });

  it('rejects NO_RESULTS when both legs are empty or failing', async () => {
    const calls = installFetchStub([
      textResponse(sseBody('No search results found. Please try a different query.')),
      textResponse('boom', { ok: false, status: 500 }),
      textResponse(sseBody('No search results found. Please try a different query.')),
      textResponse('boom', { ok: false, status: 500 }),
    ]);
    const attempt = () =>
      expect(executeKeylessSearch('quantum computing')).rejects.toThrow(KeylessSearchError);
    await attempt();
    await expect(executeKeylessSearch('quantum computing')).rejects.toMatchObject({
      code: 'NO_RESULTS',
    });
    // The first leg's empty result must still trigger the Parallel attempt.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.some((c) => c.url === PARALLEL_MCP_ENDPOINT)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  5. callMcpTool parse failures                                       */
/* ------------------------------------------------------------------ */

describe('callMcpTool', () => {
  it('rejects PARSE for an SSE body with no data: line', async () => {
    installFetchStub([textResponse('event: message\nno data line here\n\n')]);
    await expect(
      callMcpTool({
        endpoint: EXA_MCP_ENDPOINT,
        tool: EXA_TOOL_NAME,
        args: { query: 'quantum computing', numResults: NUM_RESULTS },
      })
    ).rejects.toMatchObject({ code: 'PARSE' });
  });

  it('rejects PARSE for a payload without result.content', async () => {
    installFetchStub([textResponse(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }))]);
    await expect(
      callMcpTool({
        endpoint: PARALLEL_MCP_ENDPOINT,
        tool: PARALLEL_TOOL_NAME,
        args: { objective: 'objective', search_queries: ['quantum computing'] },
      })
    ).rejects.toMatchObject({ code: 'PARSE' });
  });
});

/* ------------------------------------------------------------------ */
/*  6. parseParallelResultText                                          */
/* ------------------------------------------------------------------ */

describe('parseParallelResultText', () => {
  it('rejects PARSE for malformed JSON text', async () => {
    // Wraps a sync throw or an async rejection into a rejected promise.
    await expect(
      Promise.resolve().then(() => parseParallelResultText('this is not json'))
    ).rejects.toMatchObject({
      code: 'PARSE',
    });
  });

  it('maps a valid payload to {title, url, snippets}', async () => {
    const parsed = await Promise.resolve().then(() =>
      parseParallelResultText(
        parallelResultsText([
          {
            url: 'https://a.example/one',
            title: 'One',
            publish_date: null,
            excerpts: ['excerpts one', 'excerpts two'],
          },
        ])
      )
    );
    expect(parsed).toEqual([
      { title: 'One', url: 'https://a.example/one', snippets: ['excerpts one', 'excerpts two'] },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  7. Dedupe and cap                                                   */
/* ------------------------------------------------------------------ */

describe('executeKeylessSearch dedupe and cap', () => {
  it('caps 12 Exa blocks with duplicate URLs to exactly MAX_NORMALIZED_SOURCES unique sources', async () => {
    const blocks = [];
    for (let i = 1; i <= 10; i += 1) {
      blocks.push(
        exaBlock({
          title: `Result ${i}`,
          url: `https://unique.example.com/${i}`,
          lines: [`snippet ${i}`],
        })
      );
    }
    // Two duplicate URLs plus one non-URL-free filler to reach 12 blocks.
    blocks.push(
      exaBlock({ title: 'Dup A', url: 'https://unique.example.com/1', lines: ['dup a'] }),
      exaBlock({ title: 'Dup B', url: 'https://unique.example.com/2', lines: ['dup b'] })
    );

    installFetchStub([textResponse(sseBody(blocks.join('\n\n---\n\n')))]);
    const result = await executeKeylessSearch('quantum computing');

    expect(result.sources).toHaveLength(MAX_NORMALIZED_SOURCES);
    const urls = result.sources.map((s) => s.url);
    expect(new Set(urls).size).toBe(MAX_NORMALIZED_SOURCES);
    result.sources.forEach((s, i) => {
      expect(s.id).toBe(`src-${i + 1}`);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  8. Request shape                                                    */
/* ------------------------------------------------------------------ */

describe('request shape', () => {
  it('sends JSON-RPC tools/call to the fixed endpoints with x-api-key only when supplied', async () => {
    const calls = installFetchStub([
      textResponse('boom', { ok: false, status: 500 }),
      textResponse(
        jsonRpcBody(
          parallelResultsText([
            { url: 'https://p.example.com/a', title: 'P', publish_date: null, excerpts: ['e'] },
          ])
        )
      ),
    ]);
    await executeKeylessSearch('  quantum computing  ', { exaApiKey: 'exa-key-123' });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(EXA_MCP_ENDPOINT);
    const exaBody = JSON.parse(calls[0].init.body);
    expect(exaBody.jsonrpc).toBe('2.0');
    expect(exaBody.method).toBe('tools/call');
    expect(exaBody.params.name).toBe(EXA_TOOL_NAME);
    expect(exaBody.params.arguments.query).toBe('quantum computing');
    expect(exaBody.params.arguments.numResults).toBe(NUM_RESULTS);
    expect(headerValue(calls[0].init, 'content-type')).toContain('application/json');
    expect(headerValue(calls[0].init, 'x-api-key')).toBe('exa-key-123');

    expect(calls[1].url).toBe(PARALLEL_MCP_ENDPOINT);
    const parBody = JSON.parse(calls[1].init.body);
    expect(parBody.method).toBe('tools/call');
    expect(parBody.params.name).toBe(PARALLEL_TOOL_NAME);
    expect(parBody.params.arguments.search_queries).toEqual(['quantum computing']);
    expect(parBody.params.arguments.objective).toContain('quantum computing');
    expect(headerValue(calls[1].init, 'x-api-key')).toBeUndefined();
  });

  it('never sends x-api-key on either leg when no exaApiKey is supplied', async () => {
    const calls = installFetchStub([
      textResponse('boom', { ok: false, status: 500 }),
      textResponse(
        jsonRpcBody(
          parallelResultsText([
            { url: 'https://p.example.com/a', title: 'P', publish_date: null, excerpts: ['e'] },
          ])
        )
      ),
    ]);
    await executeKeylessSearch('quantum computing');

    expect(calls).toHaveLength(2);
    expect(headerValue(calls[0].init, 'x-api-key')).toBeUndefined();
    expect(headerValue(calls[1].init, 'x-api-key')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  9. Abort                                                            */
/* ------------------------------------------------------------------ */

describe('executeKeylessSearch abort', () => {
  it('rejects with an AbortError DOMException and never calls the Parallel leg when already aborted', async () => {
    const calls = installFetchStub([
      textResponse(jsonRpcBody(parallelResultsText([]))),
      textResponse(jsonRpcBody(parallelResultsText([]))),
    ]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      executeKeylessSearch('quantum computing', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    // At most the first (Exa) leg may have attempted a fetch; Parallel must never run.
    expect(calls.length).toBeLessThanOrEqual(1);
    expect(calls.every((c) => c.url !== PARALLEL_MCP_ENDPOINT)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  10. Query validation                                                 */
/* ------------------------------------------------------------------ */

describe('executeKeylessSearch query validation', () => {
  it.each([
    ['missing', null],
    ['blank', '   '],
    ['too long', 'a'.repeat(MAX_QUERY_LENGTH + 1)],
    ['too many words', Array.from({ length: MAX_QUERY_WORDS + 1 }, () => 'word').join(' ')],
  ])('rejects INVALID_QUERY with no fetch for: %s', async (_label, query) => {
    const calls = installFetchStub([]);
    await expect(executeKeylessSearch(query)).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  11. Return shape                                                    */
/* ------------------------------------------------------------------ */

describe('executeKeylessSearch return shape', () => {
  it('resolves {query, retrievedAt ISO, sources[]} like the previous provider', async () => {
    installFetchStub([
      textResponse(
        sseBody(
          exaBlock({
            title: 'Only Result',
            url: 'https://only.example.com/x',
            lines: ['only snippet'],
          })
        )
      ),
    ]);
    const result = await executeKeylessSearch('  cats and dogs  ');

    expect(result.query).toBe('cats and dogs');
    expect(result.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    expect(Array.isArray(result.sources)).toBe(true);
    expect(result.sources).toEqual([
      {
        id: 'src-1',
        title: 'Only Result',
        url: 'https://only.example.com/x',
        snippets: ['only snippet'],
      },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  Request budget: a stalled body must time out, not hang              */
/* ------------------------------------------------------------------ */

describe('callMcpTool request budget covers a stalled body read', () => {
  it('rejects with TIMEOUT when headers arrive but the body never settles', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      // Headers are back; the body never resolves. Before the budget covered
      // the read this hung until the caller aborted.
      text: () => new Promise(() => {}),
    });

    const started = Date.now();
    await expect(
      callMcpTool({
        endpoint: EXA_MCP_ENDPOINT,
        tool: EXA_TOOL_NAME,
        args: { query: 'stalled', numResults: NUM_RESULTS },
        timeoutMs: 30,
      })
    ).rejects.toMatchObject({ name: 'KeylessSearchError', code: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('reports caller cancellation as AbortError, not TIMEOUT, when the caller aborts mid-read', async () => {
    const controller = new AbortController();
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: () => new Promise(() => {}),
    });

    const promise = callMcpTool({
      endpoint: EXA_MCP_ENDPOINT,
      tool: EXA_TOOL_NAME,
      args: { query: 'cancelled' },
      signal: controller.signal,
      timeoutMs: 60_000,
    });
    setTimeout(() => controller.abort(), 10);

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

/* ------------------------------------------------------------------ */
/*  Protocol edges: JSON-RPC error member and multi-line SSE frames     */
/* ------------------------------------------------------------------ */

describe('callMcpTool protocol edges', () => {
  const ssePayload = (payload) => `event: message\ndata: ${JSON.stringify(payload)}\n\n`;

  it('maps a JSON-RPC error member mentioning 429 to RATE_LIMIT', async () => {
    installFetchStub([
      textResponse(
        ssePayload({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: '429 Too Many Requests' },
        })
      ),
    ]);

    await expect(
      callMcpTool({ endpoint: EXA_MCP_ENDPOINT, tool: EXA_TOOL_NAME, args: {} })
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  });

  it('maps a non-429 JSON-RPC error member to HTTP_ERROR', async () => {
    installFetchStub([
      textResponse(
        ssePayload({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid params' } })
      ),
    ]);

    await expect(
      callMcpTool({ endpoint: EXA_MCP_ENDPOINT, tool: EXA_TOOL_NAME, args: {} })
    ).rejects.toMatchObject({ code: 'HTTP_ERROR' });
  });

  it('reassembles a payload split across several data: lines', async () => {
    const json = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: 'split payload' }] },
    });
    // Split at a token boundary so the SSE newline join still yields valid JSON.
    const cut = json.indexOf('"result"');
    const body = `event: message\ndata: ${json.slice(0, cut)}\ndata: ${json.slice(cut)}\n\n`;

    installFetchStub([textResponse(body)]);
    await expect(
      callMcpTool({ endpoint: EXA_MCP_ENDPOINT, tool: EXA_TOOL_NAME, args: {} })
    ).resolves.toBe('split payload');
  });
});

/* ------------------------------------------------------------------ */
/*  Parser robustness and the byte budget                               */
/* ------------------------------------------------------------------ */

describe('parseExaResultText robustness', () => {
  it('keeps CRLF-separated blocks as separate sources instead of collapsing them', () => {
    const text = [
      exaBlock({ title: 'Alpha', url: 'https://example.com/a', lines: ['alpha snippet'] }),
      exaBlock({
        title: 'Beta',
        url: 'https://example.com/b',
        kind: 'Text',
        lines: ['beta snippet'],
      }),
    ]
      .join('\n\n---\n\n')
      .replace(/\n/g, '\r\n');

    const results = parseExaResultText(text);

    expect(results.map((r) => r.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(results[0].snippets).toEqual(['alpha snippet']);
  });
});

describe('executeKeylessSearch source byte budget', () => {
  it('counts snippet size in UTF-8 bytes, not characters', async () => {
    // 2000 CJK chars per snippet is ~6KB of UTF-8 each. Counting characters
    // (~2.2KB each) would fit all ten; counting bytes must stop short.
    const cjkSnippet = '漢'.repeat(2000);
    const text = Array.from({ length: MAX_NORMALIZED_SOURCES }, (_, i) =>
      exaBlock({
        title: `Result ${i + 1}`,
        url: `https://example.com/${i + 1}`,
        lines: [cjkSnippet],
      })
    ).join('\n\n---\n\n');

    installFetchStub([textResponse(sseBody(text))]);
    const result = await executeKeylessSearch('multi-byte budget');

    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources.length).toBeLessThan(MAX_NORMALIZED_SOURCES);
  });
});

/* ------------------------------------------------------------------ */
/*  Abort that fires during a leg never reaches the fallback leg        */
/* ------------------------------------------------------------------ */

describe('executeKeylessSearch in-flight abort', () => {
  it('propagates AbortError and never calls the Parallel leg', async () => {
    const controller = new AbortController();
    const calledUrls = [];
    global.fetch = async (url) => {
      calledUrls.push(String(url));
      controller.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    };

    await expect(
      executeKeylessSearch('aborted mid-flight', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(calledUrls).toEqual([EXA_MCP_ENDPOINT]);
  });
});
