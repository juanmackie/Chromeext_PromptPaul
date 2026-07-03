import { describe, it, expect } from 'vitest';
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

    const promptEmpty = orch._buildSystemPrompt({ config: {}, loadedSkills: new Set() }, eligibleSkills);
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
