import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';
import { createThinkParser } from '../src/utils/inlineReasoning.js';

/** Feed an array of deltas through a parser and concatenate the results. */
function runParser(deltas) {
  const parser = createThinkParser();
  let content = '';
  let reasoning = '';
  for (const d of deltas) {
    const out = parser.push(d);
    content += out.content;
    reasoning += out.reasoning;
  }
  const tail = parser.flush();
  content += tail.content;
  reasoning += tail.reasoning;
  return { content, reasoning, parser };
}

function createStubSkillManager(overrides = {}) {
  return {
    resolveSkill(name) {
      if (overrides.resolveSkill) return overrides.resolveSkill(name);
      return null;
    },
    getEligibleSnapshot() {
      return overrides.eligibleSkills || [];
    },
    getSkillsList() {
      return overrides.eligibleSkills || [];
    },
    getSlashCommands() {
      return [];
    },
    hasSkill(name) {
      const names = (overrides.eligibleSkills || []).map((s) => s.name);
      return names.includes(name);
    },
    getSkillNames() {
      return (overrides.eligibleSkills || []).map((s) => s.name);
    },
    getSkillContent(name) {
      const skill = (overrides.eligibleSkills || []).find((s) => s.name === name);
      if (!skill) return null;
      return {
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions || `Instructions for ${skill.name}`,
        type: 'built-in',
        metadata: {},
      };
    },
  };
}

describe('RunOrchestrator._buildSystemPrompt', () => {
  it('includes requested-skill instructions when requestedSkill is set', () => {
    const skillManager = createStubSkillManager({
      resolveSkill(name) {
        if (name === 'humanizer') {
          return {
            name: 'humanizer',
            description: 'Makes text sound natural',
            instructions: 'Rewrite AI text to sound human.',
          };
        }
        return null;
      },
    });
    const orch = new RunOrchestrator(skillManager);
    const run = { config: { requestedSkill: 'humanizer' } };
    const prompt = orch._buildSystemPrompt(run, []);

    expect(prompt).toContain('SKILL: humanizer');
    expect(prompt).toContain('Makes text sound natural');
    expect(prompt).toContain('Rewrite AI text to sound human.');
    expect(prompt).toContain('Skill instructions loaded');
  });

  it('does not include skill catalog when requestedSkill is set', () => {
    const skillManager = createStubSkillManager({
      resolveSkill(name) {
        if (name === 'humanizer') {
          return { name: 'humanizer', description: 'test', instructions: 'do stuff' };
        }
        return null;
      },
      eligibleSkills: [{ name: 'other-skill', description: 'Other' }],
    });
    const orch = new RunOrchestrator(skillManager);
    const run = { config: { requestedSkill: 'humanizer' } };
    const prompt = orch._buildSystemPrompt(run, [{ name: 'other-skill', description: 'Other' }]);

    expect(prompt).toContain('SKILL: humanizer');
    expect(prompt).not.toContain('Available skills');
  });

  it('includes skill catalog when no requestedSkill is set', () => {
    const skillManager = createStubSkillManager();
    const orch = new RunOrchestrator(skillManager);
    const run = { config: {} };
    const eligibleSkills = [{ name: 'humanizer', description: 'Makes text natural' }];
    const prompt = orch._buildSystemPrompt(run, eligibleSkills);

    expect(prompt).toContain('Available skills');
    expect(prompt).toContain('humanizer');
    expect(prompt).not.toContain('SKILL:');
  });

  it('warns when requested skill is not found', () => {
    const skillManager = createStubSkillManager({
      resolveSkill() {
        return null;
      },
    });
    const orch = new RunOrchestrator(skillManager);
    const run = { config: { requestedSkill: 'nonexistent' } };
    const prompt = orch._buildSystemPrompt(run, []);

    expect(prompt).not.toContain('SKILL:');
    expect(prompt).not.toContain('Available skills');
  });

  it('includes CORE_INSTRUCTIONS in all cases', () => {
    const skillManager = createStubSkillManager();
    const orch = new RunOrchestrator(skillManager);

    const promptNoSkill = orch._buildSystemPrompt({ config: {} }, []);
    expect(promptNoSkill).toContain('OUTPUT FORMATTING');

    const promptWithSkill = orch._buildSystemPrompt(
      { config: { requestedSkill: 'humanizer' } },
      []
    );
    expect(promptWithSkill).toContain('OUTPUT FORMATTING');
  });

  it('injects loaded-skill instructions and a no-reload directive when loadedSkills is set', () => {
    const skillManager = createStubSkillManager({
      resolveSkill(name) {
        if (name === 'humanizer') {
          return {
            name: 'humanizer',
            description: 'Makes text sound natural',
            instructions: 'Rewrite AI text to sound human.',
          };
        }
        return null;
      },
      eligibleSkills: [{ name: 'humanizer', description: 'Makes text sound natural' }],
    });
    const orch = new RunOrchestrator(skillManager);
    const run = { config: {}, loadedSkills: new Set(['humanizer']) };
    const prompt = orch._buildSystemPrompt(run, [
      { name: 'humanizer', description: 'Makes text sound natural' },
    ]);

    expect(prompt).toContain('SKILL: humanizer');
    expect(prompt).toContain('Rewrite AI text to sound human.');
    expect(prompt).toContain('already loaded');
    // The discovery catalog must not be re-advertised once a skill is loaded.
    expect(prompt).not.toContain('Available skills');
  });

  it('still shows the catalog when loadedSkills is empty/undefined', () => {
    const skillManager = createStubSkillManager();
    const orch = new RunOrchestrator(skillManager);
    const eligibleSkills = [{ name: 'humanizer', description: 'Makes text natural' }];

    const promptEmpty = orch._buildSystemPrompt(
      { config: {}, loadedSkills: new Set() },
      eligibleSkills
    );
    expect(promptEmpty).toContain('Available skills');
    expect(promptEmpty).not.toContain('SKILL:');

    // Bare run object (no loadedSkills field) must not throw and keeps catalog.
    const promptBare = orch._buildSystemPrompt({ config: {} }, eligibleSkills);
    expect(promptBare).toContain('Available skills');
  });
});

describe('RunOrchestrator._buildTools', () => {
  it('advertises skill-loader tools on a fresh run with eligible skills', async () => {
    const skillManager = createStubSkillManager({
      eligibleSkills: [{ name: 'humanizer', description: 'Makes text natural' }],
    });
    const orch = new RunOrchestrator(skillManager);
    const tools = await orch._buildTools({ config: {}, loadedSkills: new Set() });
    const names = tools.map((t) => t.function.name);

    expect(names).toContain('skills_list');
    expect(names).toContain('skill_view');
    expect(names).toContain('load_skill');
  });

  it('stops advertising skill-loader tools once a skill has been loaded', async () => {
    const skillManager = createStubSkillManager({
      eligibleSkills: [{ name: 'humanizer', description: 'Makes text natural' }],
    });
    const orch = new RunOrchestrator(skillManager);
    const tools = await orch._buildTools({ config: {}, loadedSkills: new Set(['humanizer']) });
    const names = tools.map((t) => t.function.name);

    expect(names).not.toContain('skills_list');
    expect(names).not.toContain('skill_view');
    expect(names).not.toContain('load_skill');
  });
});

describe('RunOrchestrator._recordLoadedSkill', () => {
  function makeOrch() {
    return new RunOrchestrator(createStubSkillManager());
  }
  const skillViewCall = (name) => ({
    function: { name: 'skill_view', arguments: JSON.stringify({ name }) },
  });

  it('records a skill on a successful load (canonical name from payload)', () => {
    const orch = makeOrch();
    const run = { loadedSkills: new Set() };
    orch._recordLoadedSkill(run, skillViewCall('humanizer'), {
      success: true,
      result: { success: true, skill: { name: 'humanizer' } },
    });
    expect(run.loadedSkills.has('humanizer')).toBe(true);
  });

  it('does not record when the skill was not found', () => {
    const orch = makeOrch();
    const run = { loadedSkills: new Set() };
    orch._recordLoadedSkill(run, skillViewCall('nope'), {
      success: true,
      result: { success: false, error: "Skill 'nope' not found." },
    });
    expect(run.loadedSkills.size).toBe(0);
  });

  it('ignores non-skill tools', () => {
    const orch = makeOrch();
    const run = { loadedSkills: new Set() };
    orch._recordLoadedSkill(
      run,
      { function: { name: 'some_tool', arguments: '{}' } },
      { success: true, result: { ok: true } }
    );
    expect(run.loadedSkills.size).toBe(0);
  });
});

describe('createThinkParser', () => {
  it('splits inline <think> reasoning from the answer in one delta', () => {
    const { content, reasoning, parser } = runParser(['<think>a</think>b']);
    expect(reasoning).toBe('a');
    expect(content).toBe('b');
    expect(parser.sawThink).toBe(true);
    expect(parser.inThink).toBe(false);
  });

  it('handles <thinking> variant', () => {
    const { content, reasoning } = runParser(['<thinking>plan</thinking>answer']);
    expect(reasoning).toBe('plan');
    expect(content).toBe('answer');
  });

  it('handles tag boundaries split across deltas', () => {
    const { content, reasoning } = runParser(['<thi', 'nk>x</thi', 'nk>y']);
    expect(reasoning).toBe('x');
    expect(content).toBe('y');
  });

  it('passes HTML containing < through untouched as content', () => {
    const { content, reasoning, parser } = runParser(['<!DOCTYPE html>\n<div>hi</div>']);
    expect(content).toBe('<!DOCTYPE html>\n<div>hi</div>');
    expect(reasoning).toBe('');
    expect(parser.sawThink).toBe(false);
  });

  it('passes a lone trailing < held across deltas', () => {
    const { content } = runParser(['value <', ' 3 is true']);
    expect(content).toBe('value < 3 is true');
  });

  it('marks reasoning-only response with empty content', () => {
    const { content, reasoning, parser } = runParser(['<think>only thinking</think>']);
    expect(content).toBe('');
    expect(reasoning).toBe('only thinking');
    expect(parser.sawThink).toBe(true);
  });

  it('flushes an unclosed think block as reasoning', () => {
    const { content, reasoning, parser } = runParser(['<think>cut off mid thou']);
    expect(content).toBe('');
    expect(reasoning).toBe('cut off mid thou');
    expect(parser.inThink).toBe(true);
  });
});

describe('RunOrchestrator._processOpenAIChunk inline reasoning', () => {
  function setup() {
    const orch = new RunOrchestrator(createStubSkillManager());
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    const run = { id: 'r1', accumulatedText: '', thinkParser: createThinkParser() };
    return { orch, run, events };
  }

  const chunk = (content) => ({ choices: [{ delta: { content } }] });

  it('routes inline <think> to reasoning events and keeps answer-only accumulatedText', async () => {
    const { orch, run, events } = setup();
    await orch._processOpenAIChunk(run, chunk('<think>reason here</think>The answer.'));

    const reasoning = events
      .filter((e) => e.type === 'reasoning')
      .map((e) => e.data)
      .join('');
    const content = events
      .filter((e) => e.type === 'content')
      .map((e) => e.data)
      .join('');
    expect(reasoning).toBe('reason here');
    expect(content).toBe('The answer.');
    expect(run.accumulatedText).toBe('The answer.');
  });

  it('still emits structured reasoning_content separately', async () => {
    const { orch, run, events } = setup();
    await orch._processOpenAIChunk(run, {
      choices: [{ delta: { reasoning_content: 'structured', content: 'hello' } }],
    });
    expect(events.find((e) => e.type === 'reasoning')?.data).toBe('structured');
    expect(run.accumulatedText).toBe('hello');
  });
});

describe('completion metadata and empty reasoning recovery', () => {
  it('captures an OpenAI finish reason from a terminal chunk without a delta', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    orch._emitEvent = () => {};
    const run = {
      id: 'completion-r1',
      accumulatedText: '',
      thinkParser: createThinkParser(),
    };

    await orch._processOpenAIChunk(run, {
      choices: [{ delta: { reasoning_content: 'thinking' }, finish_reason: null }],
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    });
    await orch._processOpenAIChunk(run, {
      choices: [{ finish_reason: 'length' }],
    });

    expect(run.completionReason).toBe('length');
    expect(orch._getCompletionMetadata(run)).toMatchObject({
      hasReasoning: true,
      exhausted: true,
      reason: 'length',
      usage: { inputTokens: 12, outputTokens: 34 },
    });
  });

  it('captures Anthropic stop reasons', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    orch._emitEvent = () => {};
    const run = { id: 'completion-r2', accumulatedText: '' };

    await orch._processAnthropicEvent(run, {
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'thinking' },
    });
    await orch._processAnthropicEvent(run, {
      type: 'message_delta',
      delta: { stop_reason: 'max_tokens' },
      usage: { input_tokens: 9, output_tokens: 22 },
    });

    expect(run.completionReason).toBe('max_tokens');
    expect(orch._getCompletionMetadata(run)).toMatchObject({
      hasReasoning: true,
      exhausted: true,
      reason: 'max_tokens',
      usage: { inputTokens: 9, outputTokens: 22 },
    });
  });

  it('reserves explicit output capacity for reasoning models', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const openAiBody = {};
    const legacyBody = {};
    const standardBody = {};

    orch._applyOpenAIOutputBudget(openAiBody, 'o1-mini');
    orch._applyOpenAIOutputBudget(legacyBody, 'deepseek-reasoner');
    orch._applyOpenAIOutputBudget(standardBody, 'gpt-4o');

    expect(openAiBody.max_completion_tokens).toBe(8192);
    expect(legacyBody.max_tokens).toBe(8192);
    expect(standardBody).toEqual({});
  });

  it('retries one reasoning-only OpenAI response without tools', async () => {
    const originalFetch = global.fetch;
    const requests = [];
    const events = [];
    const orch = new RunOrchestrator(createStubSkillManager());
    orch._emitEvent = (_runId, event) => events.push(event);

    global.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      const responseText =
        requests.length === 1
          ? [
              `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking' } }] })}`,
              `data: ${JSON.stringify({ choices: [{ finish_reason: 'length' }] })}`,
              'data: [DONE]',
              '',
            ].join('\n')
          : [
              `data: ${JSON.stringify({ choices: [{ delta: { content: 'Recovered answer.' }, finish_reason: 'stop' }] })}`,
              'data: [DONE]',
              '',
            ].join('\n');
      let delivered = false;
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              if (delivered) return { done: true, value: undefined };
              delivered = true;
              return { done: false, value: new TextEncoder().encode(responseText) };
            },
          }),
        },
      };
    };

    try {
      await orch._executeOpenAI(
        {
          id: 'recovery-r1',
          config: {
            llmEndpoint: 'https://provider.example/v1/chat/completions',
            apiKey: 'test-key',
            modelName: 'deepseek-reasoner',
          },
          conversationHistory: [{ role: 'user', content: 'Answer the question.' }],
          accumulatedText: '',
          webSearch: { enabled: false, attempts: 0, sources: [] },
          abortController: new AbortController(),
        },
        []
      );
    } finally {
      global.fetch = originalFetch;
    }

    const complete = events.find((event) => event.type === 'complete');
    expect(requests).toHaveLength(2);
    expect(requests[0].max_tokens).toBe(8192);
    expect(requests[1].tools).toBeUndefined();
    expect(requests[1].messages.at(-1).content).toContain('previous response');
    expect(complete?.content).toBe('Recovered answer.');
    expect(complete?.completion).toMatchObject({
      hasReasoning: true,
      recovered: true,
      exhausted: false,
    });
  });
});

describe('Fix 1: execute() persists messages into conversationHistory', () => {
  beforeEach(() => {
    global.chrome = {
      runtime: { sendMessage: async () => {} },
    };
  });

  afterEach(() => {
    delete global.chrome;
  });

  it('execute() absorbs requestConfig.messages into run.conversationHistory and clears requestConfig', async () => {
    const skillManager = createStubSkillManager();
    const orch = new RunOrchestrator(skillManager);
    let capturedHistory = null;

    orch._executeOpenAI = async (run) => {
      capturedHistory = run.conversationHistory.map((m) => ({ ...m }));
    };

    const runId = await orch.startRun({
      llmEndpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'sk-test',
      modelName: 'gpt-4o',
    });
    const run = orch.getRun(runId);

    const requestConfig = {
      messages: [
        { role: 'system', content: 'do not persist' },
        { role: 'user', content: 'Turn this page into a research brief' },
      ],
    };

    await orch.execute(runId, requestConfig);

    expect(
      capturedHistory.some(
        (m) => m.role === 'user' && m.content === 'Turn this page into a research brief'
      )
    ).toBe(true);
    expect(capturedHistory.some((m) => m.role === 'system')).toBe(false);
    expect(
      run.conversationHistory.some(
        (m) => m.role === 'user' && m.content === 'Turn this page into a research brief'
      )
    ).toBe(true);
    expect(requestConfig.messages.length).toBe(0);
  });

  it('continuation after tool call carries the original user message in the second request', async () => {
    const skills = [
      {
        name: 'humanizer',
        description: 'Makes text natural',
        instructions: 'Rewrite to sound human.',
      },
    ];
    const skillManager = createStubSkillManager({ eligibleSkills: skills });
    const orch = new RunOrchestrator(skillManager);
    const seenBodies = [];
    let callCount = 0;

    // Return a tool call on the first invocation, then empty text on subsequent
    // (so the orchestrator completes without looping forever).
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      seenBodies.push(body);
      callCount++;
      return {
        ok: true,
        body: {
          getReader: () => {
            let readerDone = false;
            return {
              read: async () => {
                if (readerDone) return { done: true, value: undefined };
                readerDone = true;
                if (callCount === 1) {
                  // First call: emit a tool call so the orchestrator does a continuation
                  const data = JSON.stringify({
                    choices: [
                      {
                        delta: {
                          tool_calls: [
                            {
                              index: 0,
                              id: 'call_1',
                              function: { name: 'humanizer', arguments: '{}' },
                            },
                          ],
                        },
                        finish_reason: null,
                      },
                    ],
                  });
                  return {
                    done: false,
                    value: new TextEncoder().encode(`data: ${data}\n\ndata: [DONE]\n\n`),
                  };
                }
                // Subsequent calls: return text so the flow completes
                const data = JSON.stringify({
                  choices: [{ delta: { content: 'Final answer.' }, finish_reason: 'stop' }],
                });
                return {
                  done: false,
                  value: new TextEncoder().encode(`data: ${data}\n\ndata: [DONE]\n\n`),
                };
              },
            };
          },
        },
      };
    };

    const runId = await orch.startRun({
      llmEndpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'sk-test',
      modelName: 'gpt-4o',
    });

    await orch.execute(runId, {
      messages: [{ role: 'user', content: 'Rewrite this using humanizer' }],
    });

    // We should have gotten at least 2 LLM requests (initial + continuation)
    expect(seenBodies.length).toBeGreaterThanOrEqual(2);

    // First request body should include the user message
    const firstBody = seenBodies[0];
    const userFirst = firstBody.messages.find((m) => m.role === 'user');
    expect(userFirst).toBeTruthy();
    expect(userFirst.content).toBe('Rewrite this using humanizer');

    // The continuation request should also carry the user message
    // (absorbed into conversationHistory by execute(), so it's there even
    // though requestConfig was { continueConversation: true } with no messages.)
    for (let i = 1; i < seenBodies.length; i++) {
      const body = seenBodies[i];
      const userMsg = body.messages.find((m) => m.role === 'user');
      expect(userMsg).toBeTruthy();
      expect(userMsg.content).toBe('Rewrite this using humanizer');
    }
  });
});

describe('Fix 2: executeTool auto-loads skill on direct name', () => {
  it('returns loaded skill content for a known skill name', async () => {
    const skills = [
      {
        name: 'humanizer',
        description: 'Makes text natural',
        instructions: 'Rewrite to sound human.',
      },
    ];
    const skillManager = createStubSkillManager({ eligibleSkills: skills });
    const orch = new RunOrchestrator(skillManager);

    const result = await orch.executeTool('run-1', {
      id: 'tc_1',
      function: { name: 'humanizer', arguments: '{}' },
    });

    expect(result.success).toBe(true);
    expect(result.skill).toBeTruthy();
    expect(result.skill.name).toBe('humanizer');
  });

  it('records auto-loaded skill via _recordLoadedSkill', async () => {
    const skills = [
      {
        name: 'humanizer',
        description: 'Makes text natural',
        instructions: 'Rewrite to sound human.',
      },
    ];
    const skillManager = createStubSkillManager({ eligibleSkills: skills });
    const orch = new RunOrchestrator(skillManager);
    const run = { loadedSkills: new Set() };

    const result = await orch.executeTool('run-2', {
      id: 'tc_2',
      function: { name: 'humanizer', arguments: '{}' },
    });

    orch._recordLoadedSkill(
      run,
      {
        id: 'tc_2',
        function: { name: 'humanizer', arguments: '{}' },
      },
      result
    );

    expect(run.loadedSkills.has('humanizer')).toBe(true);
  });
});

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
});

describe('provider tool-choice payloads', () => {
  const searchTool = {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  };

  function streamingResponse(data) {
    let delivered = false;
    const value = new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (delivered) return { done: true };
            delivered = true;
            return { done: false, value };
          },
        }),
      },
    };
  }

  it('offers web_search with auto selection in OpenAI-compatible payloads', async () => {
    const originalFetch = global.fetch;
    let body;
    global.fetch = async (_url, options) => {
      body = JSON.parse(options.body);
      return streamingResponse({ choices: [{ delta: { content: 'answer' } }] });
    };
    try {
      const orch = new RunOrchestrator(createStubSkillManager());
      orch._emitEvent = () => {};
      const run = {
        id: 'openai-sequence',
        config: {
          llmEndpoint: 'https://provider.example/v1/chat/completions',
          apiKey: 'llm-key',
          modelName: 'model',
          tool_choice: 'auto',
        },
        conversationHistory: [{ role: 'user', content: 'question' }],
        accumulatedText: '',
        webSearch: { enabled: true, attempted: false, attempts: 0, failed: false, sources: [] },
        toolChoiceState: {
          original: 'auto',
          forcedUserTool: null,
          forcedUserToolSatisfied: true,
        },
        abortController: new AbortController(),
        loadedSkills: new Set(),
      };
      await orch._executeOpenAI(run, [searchTool]);
      // Web enabled = permission, not mandate: web_search is offered with auto
      // selection so the model may answer directly without searching.
      expect(body.tool_choice).toBe('auto');
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].function.name).toBe('web_search');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('offers web_search with auto selection and keeps thinking on Anthropic turns', async () => {
    const originalFetch = global.fetch;
    let body;
    global.fetch = async (_url, options) => {
      body = JSON.parse(options.body);
      return streamingResponse({ type: 'message_stop' });
    };
    try {
      const orch = new RunOrchestrator(createStubSkillManager());
      orch._emitEvent = () => {};
      const run = {
        id: 'anthropic-sequence',
        config: {
          llmEndpoint: 'https://api.anthropic.com/v1/messages',
          apiKey: 'llm-key',
          modelName: 'anthropic:claude-sonnet-4-5',
          tool_choice: 'auto',
        },
        conversationHistory: [{ role: 'user', content: 'question' }],
        accumulatedText: '',
        webSearch: { enabled: true, attempted: false, attempts: 0, failed: false, sources: [] },
        toolChoiceState: {
          original: 'auto',
          forcedUserTool: null,
          forcedUserToolSatisfied: true,
        },
        abortController: new AbortController(),
        loadedSkills: new Set(),
      };
      await orch._executeAnthropic(run, [searchTool]);
      expect(body.tool_choice).toEqual({ type: 'auto' });
      expect(body.tools[0].name).toBe('web_search');
      // No forced tool on this turn, so extended thinking stays enabled.
      expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('forces a specific user tool once and suppresses thinking on that Anthropic turn', async () => {
    const originalFetch = global.fetch;
    let body;
    global.fetch = async (_url, options) => {
      body = JSON.parse(options.body);
      return streamingResponse({ type: 'message_stop' });
    };
    try {
      const orch = new RunOrchestrator(createStubSkillManager());
      orch._emitEvent = () => {};
      const run = {
        id: 'anthropic-forced-user-tool',
        config: {
          llmEndpoint: 'https://api.anthropic.com/v1/messages',
          apiKey: 'llm-key',
          modelName: 'anthropic:claude-sonnet-4-5',
          tool_choice: 'lookup',
        },
        conversationHistory: [{ role: 'user', content: 'question' }],
        accumulatedText: '',
        webSearch: { enabled: true, attempted: false, attempts: 0, failed: false, sources: [] },
        toolChoiceState: {
          original: 'lookup',
          forcedUserTool: 'lookup',
          forcedUserToolSatisfied: false,
        },
        abortController: new AbortController(),
        loadedSkills: new Set(),
      };
      await orch._executeAnthropic(run, [
        {
          type: 'function',
          function: {
            name: 'lookup',
            description: 'Lookup',
            parameters: { type: 'object', properties: {} },
          },
        },
      ]);
      // The forced user tool runs first, exactly once; web_search is not forced.
      expect(body.tool_choice).toEqual({ type: 'tool', name: 'lookup' });
      expect(body.thinking).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
