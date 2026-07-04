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
