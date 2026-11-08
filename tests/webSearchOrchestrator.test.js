import { describe, expect, it } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';
import { createStubSkillManager } from './helpers/runOrchestrator.js';

/* ------------------------------------------------------------------ */
/*  Web Search Grounding                                              */
/* ------------------------------------------------------------------ */

describe('web search grounding', () => {
  it('does not include web_search tool when grounding is disabled', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const run = { config: {}, webSearch: { enabled: false, attempts: 0 } };
    const tools = await orch._buildTools(run);
    expect(tools.map((t) => t.function?.name)).not.toContain('web_search');
  });

  it('includes web_search tool when grounding is enabled and no attempt yet', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const run = { config: {}, webSearch: { enabled: true, attempts: 0 } };
    const tools = await orch._buildTools(run);
    expect(tools.map((t) => t.function?.name)).toContain('web_search');
  });

  it('returns WEB_SEARCH_ALREADY_USED marker for a second attempt', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    orch.activeRuns = new Map();
    const run = {
      id: 'r1',
      config: { apiKey: 'test-key' },
      webSearch: { enabled: true, attempts: 1, sources: [], failed: false },
      abortController: new AbortController(),
    };
    orch.activeRuns.set(run.id, run);
    const result = await orch.executeTool(run.id, {
      id: 'tc1',
      function: { name: 'web_search', arguments: JSON.stringify({ query: 'test' }) },
    });
    expect(result?.result?.error).toBe('WEB_SEARCH_ALREADY_USED');
  });

  it('returns WEB_SEARCH_DISABLED when run has webSearch disabled', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    orch.activeRuns = new Map();
    const run = {
      id: 'r1',
      config: { apiKey: 'test-key' },
      webSearch: { enabled: false, attempts: 0, sources: [], failed: false },
      abortController: new AbortController(),
    };
    orch.activeRuns.set(run.id, run);
    const result = await orch.executeTool(run.id, {
      id: 'tc1',
      function: { name: 'web_search', arguments: JSON.stringify({ query: 'test' }) },
    });
    expect(result?.result?.error).toBe('WEB_SEARCH_DISABLED');
  });

  it('marks run.webSearch.failed when Brave throws an error', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    orch.activeRuns = new Map();
    orch._emitEvent = () => {};
    const run = {
      id: 'r1',
      config: { apiKey: 'test-key' },
      webSearch: { enabled: true, attempts: 0, sources: [], failed: false },
      abortController: new AbortController(),
    };
    orch.activeRuns.set(run.id, run);
    const result = await orch.executeTool(run.id, {
      id: 'tc1',
      function: { name: 'web_search', arguments: JSON.stringify({ query: 'test' }) },
    });
    expect(result.result.error).toBe('WEB_SEARCH_ERROR');
    expect(run.webSearch.failed).toBe(true);
  });

  it('carries normalized source metadata through the complete event', async () => {
    const orb = new RunOrchestrator(createStubSkillManager());
    orb.activeRuns = new Map();
    orb._emitEvent = (_, evt) => (orb._lastEvent = evt);

    const run = {
      id: 'r1',
      config: {},
      accumulatedText: 'Answer.',
      conversationHistory: [],
      webSearch: {
        enabled: true,
        attempts: 1,
        sources: [{ id: 'src-1', title: 'Page', url: 'https://x.com', snippets: ['a snippet'] }],
      },
      abortController: new AbortController(),
    };
    orb.activeRuns.set(run.id, run);
    await orb._finalizeTextResponse(run);

    expect(orb._lastEvent?.type).toBe('complete');
    expect(orb._lastEvent?.grounding).toBeDefined();
    expect(orb._lastEvent?.grounding.sources).toHaveLength(1);
    expect(orb._lastEvent?.grounding.sources[0].title).toBe('Page');
  });

  it('carries no grounding metadata when grounding is off', async () => {
    const orb = new RunOrchestrator(createStubSkillManager());
    orb.activeRuns = new Map();
    orb._emitEvent = (_, evt) => (orb._lastEvent = evt);

    const run = {
      id: 'r1',
      config: {},
      accumulatedText: 'Answer.',
      conversationHistory: [],
      webSearch: { enabled: false, attempts: 0, sources: [] },
      abortController: new AbortController(),
    };
    orb.activeRuns.set(run.id, run);
    await orb._finalizeTextResponse(run);

    expect(orb._lastEvent?.type).toBe('complete');
    expect(orb._lastEvent?.grounding).toBeUndefined();
  });

  it('emits an error event when webSearch is enabled but no API key is configured', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      webSearchStatusProvider: async () => false,
    });
    orch.activeRuns = new Map();
    const events = [];
    orch._emitEvent = (_, evt) => events.push(evt);

    const run = {
      id: 'missing-key',
      config: { apiKey: undefined, llmEndpoint: 'https://example.com/v1/chat/completions' },
      webSearch: { enabled: true },
      conversationHistory: [],
    };
    orch.activeRuns.set(run.id, run);
    await orch.execute(run.id, { conversationHistory: [] });

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error).toContain('Brave Search API key');
  });
});

describe('web search credential and sequencing contracts', () => {
  it('uses the injected Brave executor without exposing the LLM key', async () => {
    let capturedOptions;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      braveSearchExecutor: async (query, options) => {
        capturedOptions = { query, ...options };
        return {
          query,
          retrievedAt: new Date().toISOString(),
          sources: [{ id: 'src-1', title: 'Weather', url: 'https://example.com', snippets: ['s'] }],
        };
      },
    });
    const run = await orch.startRun({
      apiKey: 'llm-provider-secret',
      webSearch: true,
      tool_choice: 'auto',
      messages: [],
    });
    const state = orch.activeRuns.get(run);
    const result = await orch.executeTool(run, {
      id: 'search-1',
      function: { name: 'web_search', arguments: JSON.stringify({ query: 'weather' }) },
    });

    expect(result.success).toBe(true);
    expect(capturedOptions.query).toBe('weather');
    expect(capturedOptions.apiKey).toBeUndefined();
    expect(state.config.apiKey).toBe('llm-provider-secret');
  });

  it('reads bounded page content before returning a successful search result', async () => {
    const readUrls = [];
    const orch = new RunOrchestrator(createStubSkillManager(), {
      braveSearchExecutor: async (query) => ({
        query,
        retrievedAt: new Date().toISOString(),
        sources: [{ id: 'src-1', title: 'Weather', url: 'https://example.com', snippets: ['s'] }],
      }),
      webSearchPageReader: async (url) => {
        readUrls.push(url);
        return { content: 'The page says it is sunny.', title: 'Weather page', url };
      },
    });
    const runId = await orch.startRun({ webSearch: true, messages: [] });
    const result = await orch.executeTool(runId, {
      id: 'search-with-page',
      function: { name: 'web_search', arguments: JSON.stringify({ query: 'weather' }) },
    });

    expect(readUrls).toEqual(['https://example.com']);
    expect(result.result.extractedPages).toMatchObject([
      { title: 'Weather page', markdown: 'The page says it is sunny.' },
    ]);
    expect(orch.activeRuns.get(runId).webSearch.extractedPages).toHaveLength(1);
  });

  it('stores extraction outcomes on the run and in the tool result', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      braveSearchExecutor: async (query) => ({
        query,
        retrievedAt: new Date().toISOString(),
        sources: [
          { id: 'src-1', title: 'Page A', url: 'https://a.example/' },
          { id: 'src-2', title: 'Page B', url: 'https://b.example/' },
        ],
      }),
      webSearchPageReader: async (url) => {
        if (url === 'https://a.example/') return { content: 'Content A', title: 'Page A', url };
        return null;
      },
    });
    const runId = await orch.startRun({ webSearch: true, messages: [] });
    const result = await orch.executeTool(runId, {
      id: 'search-outcomes',
      function: { name: 'web_search', arguments: JSON.stringify({ query: 'test' }) },
    });

    const run = orch.activeRuns.get(runId);
    expect(run.webSearch.extractionOutcomes).toMatchObject([
      { url: 'https://a.example/', status: 'success' },
      { url: 'https://b.example/', status: 'empty' },
    ]);
    expect(result.result.extractionOutcomes).toEqual(run.webSearch.extractionOutcomes);
  });

  it('distinguishes partial extraction when some pages fail', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      braveSearchExecutor: async (query) => ({
        query,
        retrievedAt: new Date().toISOString(),
        sources: [
          { id: 'src-1', url: 'https://ok.example/' },
          { id: 'src-2', url: 'https://fail.example/' },
        ],
      }),
      webSearchPageReader: async (url) => {
        if (url.includes('ok')) return { content: 'readable', url };
        throw new Error('unavailable');
      },
    });
    const runId = await orch.startRun({ webSearch: true, messages: [] });
    await orch.executeTool(runId, {
      id: 'search-partial',
      function: { name: 'web_search', arguments: JSON.stringify({ query: 'test' }) },
    });

    const run = orch.activeRuns.get(runId);
    expect(run.webSearch.extractedPages).toHaveLength(1);
    expect(run.webSearch.extractionOutcomes[0].status).toBe('success');
    expect(run.webSearch.extractionOutcomes[1].status).toBe('failed');
  });

  it('discloses unreadable pages when search succeeds but no pages are readable', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      braveSearchExecutor: async (query) => ({
        query,
        retrievedAt: new Date().toISOString(),
        sources: [{ id: 'src-1', url: 'https://empty.example/' }],
      }),
      webSearchPageReader: async () => null,
    });
    const runId = await orch.startRun({ webSearch: true, messages: [] });
    const result = await orch.executeTool(runId, {
      id: 'search-unreadable',
      function: { name: 'web_search', arguments: JSON.stringify({ query: 'test' }) },
    });

    const run = orch.activeRuns.get(runId);
    expect(run.webSearch.extractedPages).toHaveLength(0);
    expect(run.webSearch.extractionOutcomes[0].status).toBe('empty');
    // The result still includes sources so the model can use excerpts.
    expect(result.result.sources).toHaveLength(1);
  });

  it('consumes the search slot even when the Brave request fails', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      braveSearchExecutor: async () => {
        throw new Error('network failure');
      },
    });
    const run = await orch.startRun({ webSearch: true, messages: [] });
    const toolCall = (id) => ({
      id,
      function: { name: 'web_search', arguments: JSON.stringify({ query: 'test' }) },
    });

    const first = await orch.executeTool(run, toolCall('search-1'));
    const second = await orch.executeTool(run, toolCall('search-2'));

    expect(first.result.error).toBe('WEB_SEARCH_ERROR');
    expect(second.result.error).toBe('WEB_SEARCH_ALREADY_USED');
  });

  it('returns WEB_SEARCH_NO_RESULTS and consumes the slot when no sources are usable', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      braveSearchExecutor: async (query) => ({
        query,
        retrievedAt: new Date().toISOString(),
        sources: [],
      }),
    });
    const runId = await orch.startRun({ webSearch: true, messages: [] });
    const run = orch.activeRuns.get(runId);
    const result = await orch.executeTool(runId, {
      id: 'search-empty',
      function: { name: 'web_search', arguments: JSON.stringify({ query: 'weather' }) },
    });

    expect(result.result.error).toBe('WEB_SEARCH_NO_RESULTS');
    expect(run.webSearch).toMatchObject({
      attempted: true,
      attempts: 1,
      failed: true,
      outcome: 'no_results',
    });
    expect(orch._getEffectiveToolChoice(run)).toBe('none');
  });

  it('executes only one Brave request for parallel web_search calls and marks the duplicate', async () => {
    let braveCalls = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      braveSearchExecutor: async (query) => {
        braveCalls += 1;
        return {
          query,
          retrievedAt: new Date().toISOString(),
          sources: [{ id: 'src-1', title: 'Weather', url: 'https://example.com', snippets: ['s'] }],
        };
      },
    });
    const events = [];
    orch._emitEvent = (_id, event) => events.push(event);
    orch.execute = async () => {};
    const runId = await orch.startRun({ webSearch: true, messages: [] });
    const run = orch.activeRuns.get(runId);
    run.activeToolCalls = new Map([
      [
        0,
        {
          id: 'parallel-1',
          function: {
            name: 'web_search',
            arguments: JSON.stringify({ query: 'Gold Coast weather' }),
          },
        },
      ],
      [
        1,
        {
          id: 'parallel-2',
          function: {
            name: 'web_search',
            arguments: JSON.stringify({ query: 'Gold Coast forecast' }),
          },
        },
      ],
    ]);

    await orch._finalizeToolCall(run);

    expect(braveCalls).toBe(1);
    expect(events.filter((event) => event.type === 'tool_ready')).toHaveLength(1);
    const completions = events.filter((event) => event.type === 'tool_complete');
    expect(completions).toHaveLength(2);
    expect(completions[0].result.result.sources).toHaveLength(1);
    expect(completions[1].result.result.error).toBe('WEB_SEARCH_ALREADY_USED');
  });

  it('offers web_search as optional alongside tools across auto, none, and specific user-tool choices', async () => {
    const tool = {
      name: 'lookup',
      endpointUrl: 'https://example.com/lookup',
      description: 'Lookup data',
      parameters: { type: 'object', properties: {} },
    };
    const orch = new RunOrchestrator(createStubSkillManager());

    // auto: web_search is offered alongside the user tool, never forced.
    const autoId = await orch.startRun({ webSearch: true, tool_choice: 'auto', tools: [tool] });
    const autoRun = orch.activeRuns.get(autoId);
    expect((await orch._buildTools(autoRun)).map((t) => t.function.name)).toEqual([
      'lookup',
      'web_search',
    ]);
    expect(orch._getEffectiveToolChoice(autoRun)).toBe('auto');

    // none: user tools suppressed, but web_search still offered with auto selection.
    const noneId = await orch.startRun({ webSearch: true, tool_choice: 'none', tools: [tool] });
    const noneRun = orch.activeRuns.get(noneId);
    expect((await orch._buildTools(noneRun)).map((t) => t.function.name)).toEqual(['web_search']);
    expect(orch._getEffectiveToolChoice(noneRun)).toBe('auto');
    noneRun.webSearch.attempted = true;
    expect(await orch._buildTools(noneRun)).toEqual([]);
    expect(orch._getEffectiveToolChoice(noneRun)).toBe('none');

    // Specific user tool: forced once, then only web_search with auto selection.
    const forcedId = await orch.startRun({ webSearch: true, tool_choice: 'lookup', tools: [tool] });
    const forcedRun = orch.activeRuns.get(forcedId);
    expect((await orch._buildTools(forcedRun)).map((t) => t.function.name)).toEqual(['lookup']);
    expect(orch._getEffectiveToolChoice(forcedRun)).toBe('lookup');
    forcedRun.toolChoiceState.forcedUserToolSatisfied = true;
    expect((await orch._buildTools(forcedRun)).map((t) => t.function.name)).toEqual(['web_search']);
    expect(orch._getEffectiveToolChoice(forcedRun)).toBe('auto');
    forcedRun.webSearch.attempted = true;
    expect((await orch._buildTools(forcedRun)).map((t) => t.function.name)).toEqual(['lookup']);
    expect(orch._getEffectiveToolChoice(forcedRun)).toBe('none');
  });

  it('answers directly with zero Brave requests when the model skips web_search', async () => {
    let braveCalls = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      braveSearchExecutor: async () => {
        braveCalls += 1;
        return { query: 'x', retrievedAt: new Date().toISOString(), sources: [] };
      },
    });
    const events = [];
    orch._emitEvent = (_id, event) => events.push(event);
    global.chrome = { runtime: { sendMessage: async () => {} } };

    let delivered = false;
    global.fetch = async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (delivered) return { done: true, value: undefined };
            delivered = true;
            const data = JSON.stringify({
              choices: [{ delta: { content: 'Direct answer.', finish_reason: 'stop' } }],
            });
            return { done: false, value: new TextEncoder().encode(`data: ${data}\n\n`) };
          },
        }),
      },
    });

    try {
      const runId = await orch.startRun({
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test',
        modelName: 'gpt-4o',
        webSearch: true,
        tool_choice: 'auto',
        messages: [{ role: 'user', content: 'Explain photosynthesis' }],
      });
      await orch.execute(runId, {});

      expect(braveCalls).toBe(0);
      const complete = events.find((e) => e.type === 'complete');
      expect(complete).toBeDefined();
      expect(complete.completion).toBeUndefined();
      // No search happened → no grounding metadata → no Sources section.
      expect(complete.grounding).toBeUndefined();
    } finally {
      delete global.chrome;
      delete global.fetch;
    }
  });

  it('performs exactly one Brave request when the model chooses web_search', async () => {
    let braveCalls = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      braveSearchExecutor: async (query) => {
        braveCalls += 1;
        return {
          query,
          retrievedAt: new Date().toISOString(),
          sources: [{ id: 'src-1', title: 'Page', url: 'https://example.com', snippets: ['s'] }],
        };
      },
    });
    const events = [];
    orch._emitEvent = (_id, event) => events.push(event);
    global.chrome = { runtime: { sendMessage: async () => {} } };

    let callCount = 0;
    const seenBodies = [];
    global.fetch = async (_url, opts) => {
      callCount += 1;
      seenBodies.push(JSON.parse(opts.body));
      let delivered = false;
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              if (delivered) return { done: true, value: undefined };
              delivered = true;
              let data;
              if (callCount === 1) {
                data = JSON.stringify({
                  choices: [
                    {
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: 'call_ws',
                            function: {
                              name: 'web_search',
                              arguments: JSON.stringify({ query: 'latest AI news' }),
                            },
                          },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                });
              } else {
                data = JSON.stringify({
                  choices: [{ delta: { content: 'Grounded answer.', finish_reason: 'stop' } }],
                });
              }
              return { done: false, value: new TextEncoder().encode(`data: ${data}\n\n`) };
            },
          }),
        },
      };
    };

    try {
      const runId = await orch.startRun({
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test',
        modelName: 'gpt-4o',
        webSearch: true,
        tool_choice: 'auto',
        messages: [{ role: 'user', content: 'What is the latest AI news?' }],
      });
      await orch.execute(runId, {});

      expect(braveCalls).toBe(1);
      const complete = events.find((e) => e.type === 'complete');
      expect(complete.grounding).toBeDefined();
      expect(complete.grounding.sources).toHaveLength(1);
      // After the attempt, the follow-up request must not re-offer web_search.
      const followUp = seenBodies[1];
      expect(followUp.tools).toBeUndefined();
    } finally {
      delete global.chrome;
      delete global.fetch;
    }
  });

  it('uses one Brave request and a text-only grounded continuation when a model repeats web_search', async () => {
    let braveCalls = 0;
    const orch = new RunOrchestrator(createStubSkillManager(), {
      braveSearchExecutor: async (query) => {
        braveCalls += 1;
        return {
          query,
          retrievedAt: new Date().toISOString(),
          sources: [
            {
              id: 'src-1',
              title: 'Gold Coast forecast',
              url: 'https://example.com/gold-coast-weather',
              snippets: ['Gold Coast: 27°C with showers.'],
            },
          ],
        };
      },
    });
    const events = [];
    orch._emitEvent = (_id, event) => events.push(event);
    global.chrome = { runtime: { sendMessage: async () => {} } };

    let callCount = 0;
    const seenBodies = [];
    global.fetch = async (_url, opts) => {
      callCount += 1;
      seenBodies.push(JSON.parse(opts.body));
      let delivered = false;
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              if (delivered) return { done: true, value: undefined };
              delivered = true;
              const delta =
                callCount === 1
                  ? {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'call_ws_1',
                          function: {
                            name: 'web_search',
                            arguments: JSON.stringify({ query: 'weather Gold Coast Australia' }),
                          },
                        },
                      ],
                    }
                  : callCount === 2
                    ? {
                        tool_calls: [
                          {
                            index: 0,
                            id: 'call_ws_2',
                            function: {
                              name: 'web_search',
                              arguments: JSON.stringify({ query: 'Gold Coast weather today' }),
                            },
                          },
                        ],
                      }
                    : { content: 'Gold Coast is 27°C with showers.' };
              const data = JSON.stringify({ choices: [{ delta }] });
              return { done: false, value: new TextEncoder().encode(`data: ${data}\n\n`) };
            },
          }),
        },
      };
    };

    try {
      const runId = await orch.startRun({
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test',
        modelName: 'gpt-4o',
        webSearch: true,
        tool_choice: 'auto',
        messages: [{ role: 'user', content: 'weeath in the gold coast' }],
      });
      await orch.execute(runId, {});

      expect(braveCalls).toBe(1);
      expect(callCount).toBe(3);
      expect(seenBodies[1].tools).toBeUndefined();
      expect(seenBodies[1].tool_choice).toBeUndefined();
      expect(seenBodies[1].messages[0].content).toContain('already completed');
      expect(events.filter((event) => event.type === 'tool_ready')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'tool_complete')).toHaveLength(2);
      const complete = events.find((event) => event.type === 'complete');
      expect(complete?.content).toContain('27°C');
      expect(complete?.grounding?.sources).toHaveLength(1);
    } finally {
      delete global.chrome;
      delete global.fetch;
    }
  });

  it('does not force web_search for rewriting-style prompts when grounding is on', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const run = await orch.startRun({
      webSearch: true,
      tool_choice: 'auto',
      messages: [{ role: 'user', content: 'Rewrite this paragraph' }],
    });
    const state = orch.activeRuns.get(run);

    // Grounding on does NOT change the effective choice to web_search.
    expect(orch._getEffectiveToolChoice(state)).toBe('auto');
    // The model may answer directly; web_search is merely offered.
    const names = (await orch._buildTools(state)).map((t) => t.function.name);
    expect(names).toContain('web_search');
    // System prompt documents both when to search and when not to.
    const prompt = orch._buildSystemPrompt(state, []);
    expect(prompt).toContain('AVAILABLE but OPTIONAL');
    expect(prompt).toContain('Do NOT call web_search for rewriting');
  });

  it('tells Hermes runs that retrieval is gateway-owned instead of offering web_search', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const runId = await orch.startRun({
      webSearch: true,
      tool_choice: 'auto',
      provider: 'hermes',
      hermesEndpoint: 'https://hermes.test',
      messages: [{ role: 'user', content: 'What is the latest pricing?' }],
    });
    const state = orch.activeRuns.get(runId);

    const prompt = orch._buildSystemPrompt(state, []);
    expect(prompt).toContain('owned by the Hermes gateway');
    // `web_search` is not a Hermes client tool, so the model must not be told
    // to call it.
    expect(prompt).not.toContain('Do NOT call web_search for rewriting');
  });
});
