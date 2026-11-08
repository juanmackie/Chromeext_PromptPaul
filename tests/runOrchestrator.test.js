import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';
import { createThinkParser } from '../src/utils/inlineReasoning.js';
import { buildCodexInput } from '../src/orchestrator/CodexTransport.js';
import { createStubSkillManager } from './helpers/runOrchestrator.js';

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

describe('evaluation dry-run recovery', () => {
  it('allows one final inspection after an intercepted mutation, then removes all tools', async () => {
    const executor = vi.fn(async () => ({ success: true }));
    const orch = new RunOrchestrator(createStubSkillManager(), {
      pageActionExecutor: executor,
    });
    orch._emitEvent = () => {};
    const runId = await orch.startRun({
      pageActions: true,
      evalDryRun: true,
      sourceTabId: 7,
      tool_choice: 'auto',
    });
    const run = orch.activeRuns.get(runId);
    run.pageActions.evalDryRunMutationIntercepted = true;

    run.pageActions.evalDryRunFinalInspectionComplete = true;
    run.accumulatedText = '<tool_call><function=page_click></function></tool_call>';
    expect(orch._shouldRecoverEvalDryRunToolMarkup(run)).toBe(true);
    run.recoveryAttempted = true;
    expect(orch._shouldRecoverEvalDryRunToolMarkup(run)).toBe(false);
    run.recoveryAttempted = false;
    run.accumulatedText = '';
    run.pageActions.evalDryRunFinalInspectionComplete = false;

    expect((await orch._buildTools(run)).map((tool) => tool.function.name)).toEqual([
      'page_get_state',
    ]);
    expect(orch._getEffectiveToolChoice(run)).toBe('page_get_state');

    const blocked = await orch.executeTool(runId, {
      id: 'repeat-dry-run-mutation',
      function: { name: 'page_click', arguments: '{}' },
    });
    expect(blocked.result).toMatchObject({
      error: 'EVAL_DRY_RUN_ACTION_BLOCKED',
      actionReceipt: {
        disposition: 'not_delivered',
        evidence: { kind: 'dry_run_intercepted' },
      },
    });
    expect(executor).not.toHaveBeenCalled();

    run.pageActions.evalDryRunFinalInspectionComplete = true;
    expect(await orch._buildTools(run)).toEqual([]);
    expect(orch._getEffectiveToolChoice(run)).toBe('none');
    orch.abort(runId);
  });

  it('adds a factual dry-run status when the model omits the intercepted outcome', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    orch.activeRuns = new Map();
    orch._emitEvent = (_runId, event) => (orch.lastEvent = event);
    const run = {
      id: 'dry-run-final-answer',
      config: { evalDryRun: true },
      pageActions: {
        lastActionReceipt: {
          disposition: 'not_delivered',
          evidence: { kind: 'dry_run_intercepted' },
        },
      },
      accumulatedText: 'Shopping list for Pasta Primavera: pasta and garlic.',
      conversationHistory: [],
      abortController: new AbortController(),
    };
    orch.activeRuns.set(run.id, run);

    await orch._finalizeTextResponse(run);

    expect(orch.lastEvent.content).toContain(
      'Dry-run: the requested page change was not delivered or performed.'
    );
    expect(orch.lastEvent.content).toContain('Pasta Primavera');
  });

  it('recovers once when a live turn emits tool-call markup instead of a tool call', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const run = {
      accumulatedText: '<tool_call><function=page_record_note></function></tool_call>',
      recoveryAttempted: false,
      activeToolCall: null,
      activeToolCalls: new Map(),
    };
    expect(orch._shouldRecoverToolMarkup(run)).toBe(true);
    run.recoveryAttempted = true;
    expect(orch._shouldRecoverToolMarkup(run)).toBe(false);
    run.recoveryAttempted = false;
    run.accumulatedText = 'A plain final answer without markup.';
    expect(orch._shouldRecoverToolMarkup(run)).toBe(false);
    expect(orch._toolMarkupRecoveryPrompt()).toContain('Never emit tool calls as text');
  });
});

describe('deterministic initial Act observation', () => {
  it.each(['openai', 'anthropic', 'codex'])(
    'includes a valid tool pair before the first %s request without named tool choice',
    async (provider) => {
      const executor = vi.fn(async () => ({
        success: true,
        snapshot: {
          snapshotId: 'initial-state',
          url: 'https://example.test/',
          title: 'Form',
          elements: [{ index: 0, tag: 'button', label: 'Inspect' }],
        },
      }));
      const orch = new RunOrchestrator(createStubSkillManager(), { pageActionExecutor: executor });
      orch._emitEvent = () => {};
      let observed = false;
      const inspect = async (run) => {
        expect(executor).toHaveBeenCalledOnce();
        expect(orch._getEffectiveToolChoice(run)).toBe('auto');
        const [call, result] = run.conversationHistory.slice(-2);
        expect(call.tool_calls[0].function.name).toBe('page_get_state');
        expect(result.tool_call_id).toBe(call.tool_calls[0].id);
        expect(JSON.parse(result.content).result.snapshot.snapshotId).toBe('initial-state');
        if (provider === 'anthropic') {
          const messages = orch._buildAnthropicMessages(run);
          expect(messages.at(-2).content[0]).toMatchObject({
            type: 'tool_use',
            id: result.tool_call_id,
            name: 'page_get_state',
          });
          expect(messages.at(-1).content[0]).toMatchObject({
            type: 'tool_result',
            tool_use_id: result.tool_call_id,
          });
        } else if (provider === 'codex') {
          const input = buildCodexInput(run.conversationHistory);
          expect(input.at(-2)).toMatchObject({
            type: 'function_call',
            call_id: result.tool_call_id,
          });
          expect(input.at(-1)).toMatchObject({
            type: 'function_call_output',
            call_id: result.tool_call_id,
          });
        }
        observed = true;
        run.accumulatedText = 'Inspection completed.';
      };
      orch._executeOpenAI = inspect;
      orch._executeAnthropic = inspect;
      orch._executeCodex = inspect;
      const id = await orch.startRun({
        pageActions: true,
        sourceTabId: 7,
        provider: provider === 'codex' ? 'codex' : 'api',
        llmEndpoint:
          provider === 'anthropic'
            ? 'https://api.anthropic.com/v1/messages'
            : 'https://provider.test/v1/chat/completions',
        tool_choice: 'auto',
      });
      await orch.execute(id, { messages: [{ role: 'user', content: 'Read this page.' }] });
      expect(observed).toBe(true);
    }
  );
});

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

  it('directs pageActions runs to perform page-achievable tasks instead of describing steps', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const prompt = orch._buildSystemPrompt({ config: {}, pageActions: { enabled: true } }, []);

    expect(prompt).toContain('ACT MODE: Page tools are enabled and callable for this run.');
    expect(prompt).toContain('The tool list in this request is authoritative');
    expect(prompt).toContain('do not claim that you lack browser or page tools');
    expect(prompt).toContain('Available page tools: page_get_state, page_find_text, page_click');
    expect(prompt).toContain('PERFORM it with the tools');
    expect(prompt).toContain('directly advances the user’s next requested step');
    expect(prompt).toContain('page_input directly on the observed editable control');
    expect(prompt).toContain('it focuses and types in one action');
    expect(prompt).not.toContain('SELECTION ORDER: First choose a visible entry point');
    expect(prompt).toContain('after it returns, use its refreshed snapshot and current indices');
    expect(prompt).toContain('when the result has no snapshot');
    expect(prompt).toContain('page_wait for expected text');
    expect(prompt).toContain(
      'compare the bounded resultContext beside each link with the requested name or criteria'
    );
    expect(prompt).toContain(
      'narrow the search with the most relevant available field (such as title, name, or ID)'
    );
    expect(prompt).toContain(
      'inspect its resultLinks and open a listed URL only when its resultContext matches'
    );
    expect(prompt).toContain(
      'Prefer individual tool calls when one result should guide the next action'
    );
    expect(prompt).toContain('use page_batch with flat fields on each action item');
    expect(prompt).toContain('For a required search or filter with no visible submit button');
    expect(prompt).toContain('After PAGE_ACTION_TOGGLE_LOOP or PAGE_ACTION_LOOP_DETECTED');
    expect(prompt).toContain('After a page-changing click, inspect the destination');
    expect(prompt).toContain('set optional expect to an observed, non-sensitive');
    expect(prompt).toContain('leaving no pending or in_progress steps');
    expect(prompt).toContain('If you receive PAGE_STATE_STALE, the action was not delivered');
    expect(prompt).toContain(
      'Make at most one state-changing page action per assistant tool-call turn'
    );
    expect(prompt).toContain('If the current tab changes documents during the run');
    expect(prompt).toContain('continue the same request');
    expect(prompt).toContain('do not give a partial next-step menu as completion');
    expect(prompt).toContain('ask whether to continue');
    expect(prompt).toContain('an interim progress report or next-steps menu is not completion');
    expect(prompt).toContain('summarize what you actually did on the page');

    // Fake-success anti-patterns: each must reach the emitted instruction.
    expect(prompt).toContain('a filled field is not an applied search');
    expect(prompt).toContain('a typed query still needs its matching suggestion selected');
    expect(prompt).toContain('a matching result does not prove a requested filter was set');
    expect(prompt).toContain('A not_delivered receipt means no change occurred');
    expect(prompt).toContain('the requested action was not performed');
    expect(prompt).toContain(
      'Do not toggle a checkbox, switch, or radio that already reports the requested state'
    );
    expect(prompt).toContain(
      'Recent page_wait calls are not evidence that content is still loading'
    );
    expect(prompt).toContain('finding a matching link is not enough');

    expect(prompt).toContain('already holds the requested value');
    expect(prompt).toContain('already contains the requested value');
  });

  it('uses a compact exact-action prompt for Mind2Web evaluation runs', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const prompt = orch._buildSystemPrompt(
      {
        config: { evalTaskMode: 'mind2web' },
        pageActions: { enabled: true, snapshot: { snapshotId: 'observed' } },
      },
      []
    );

    expect(prompt).toContain('MIND2WEB EVALUATION: Predict exactly one annotated next action');
    expect(prompt).toContain('operation, target, and value');
    expect(prompt).toContain(
      'When previous actions are None, infer the first step from the task and initial page'
    );
    expect(prompt).toContain('page_input directly on the observed editable control');
    expect(prompt).toContain(
      'A clearly matching current-page section, link, or menu takes precedence over a generic search field'
    );
    expect(prompt).toContain('Open a collapsed parent indicated by haspopup or expanded=false');
    expect(prompt).toContain(
      'smaller depth numbers are outer page items; prefer a relevant parent section/menu before a deeper child link'
    );
    expect(prompt).toContain('use only the entity head noun');
    expect(prompt).toContain('include the city and two-letter state abbreviation');
    expect(prompt).toContain(
      'explicitly asking for a city or point of interest, enter the city only'
    );
    expect(prompt).toContain(
      'check privately that the control performs the first unfinished task step'
    );
    expect(prompt).toContain('Available page tools: page_click, page_input, page_select.');
    expect(prompt).not.toContain('TAB SCOPE:');
    expect(prompt).not.toContain('For multi-step work, write a concise checklist');
    expect(prompt).not.toContain('Before the final answer, call page_get_state');
  });

  it('retries once when a Mind2Web model returns text instead of a page action', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    orch._emitEvent = () => {};
    orch.execute = vi.fn(async () => {});
    const runId = await orch.startRun({
      pageActions: true,
      sourceTabId: 7,
      evalTaskMode: 'mind2web',
      tool_choice: 'auto',
    });
    const run = orch.activeRuns.get(runId);
    run.pageActions.snapshot = {
      snapshotId: 'observed',
      elements: [],
      scroll: { x: 0, y: 0 },
      scrollContainers: [],
    };
    run.accumulatedText = 'I can help with that.';

    await orch._finalizeTextResponse(run);

    expect(orch.execute).toHaveBeenCalledWith(runId, { continueConversation: true }, true);
    expect(run.pageActions.mind2webActionRetryUsed).toBe(true);
    expect(run.conversationHistory.at(-2)).toEqual({
      role: 'assistant',
      content: 'I can help with that.',
    });
    expect(run.conversationHistory.at(-1).content).toContain(
      'call exactly one available page action'
    );
  });

  it('limits post-inspection Mind2Web tool availability to scored action types', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const tools = await orch._buildTools({
      config: {
        evalTaskMode: 'mind2web',
        tool_choice: 'auto',
        tools: [
          {
            type: 'function',
            function: {
              name: 'custom_eval_tool',
              description: 'Must not be available during a one-action benchmark.',
              parameters: { type: 'object', properties: {}, required: [] },
            },
          },
        ],
      },
      pageActions: {
        enabled: true,
        snapshot: {
          snapshotId: 'mind2web-snapshot',
          elements: [],
          scroll: { x: 0, y: 0 },
          scrollContainers: [],
        },
      },
      webSearch: { enabled: true, attempted: false, failed: false },
      toolChoiceState: { original: 'auto', forcedUserTool: null, forcedUserToolSatisfied: true },
    });

    expect(tools.map((tool) => tool.function.name).sort()).toEqual(
      ['page_click', 'page_input', 'page_select'].sort()
    );
    const descriptions = Object.fromEntries(
      tools.map((tool) => [tool.function.name, tool.function.description])
    );
    expect(descriptions.page_click).not.toContain('page_open_link');
    expect(descriptions.page_input).not.toContain('page_keypress');
  });

  it('keeps initial and dry-run follow-up inspection available in Mind2Web mode', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const run = {
      config: { evalTaskMode: 'mind2web', tool_choice: 'auto' },
      pageActions: { enabled: true, snapshot: null },
      webSearch: { enabled: false, attempted: false, failed: false },
      toolChoiceState: { original: 'auto', forcedUserTool: null, forcedUserToolSatisfied: true },
    };

    expect((await orch._buildTools(run)).map((tool) => tool.function.name)).toEqual([
      'page_get_state',
    ]);
    run.pageActions.snapshot = { snapshotId: 'observed', elements: [] };
    run.pageActions.evalDryRunMutationIntercepted = true;
    expect((await orch._buildTools(run)).map((tool) => tool.function.name)).toEqual([
      'page_get_state',
    ]);
  });

  it('requires a scored Mind2Web action after the initial snapshot', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const baseRun = {
      config: { evalTaskMode: 'mind2web', provider: 'api', tool_choice: 'auto' },
      pageActions: { enabled: true },
      webSearch: { enabled: false, attempted: false, failed: false },
    };

    expect(orch._getEffectiveToolChoice(baseRun)).toBe('auto');
    expect(
      orch._getEffectiveToolChoice({
        ...baseRun,
        pageActions: { ...baseRun.pageActions, snapshot: { snapshotId: 'observed' } },
      })
    ).toBe('required');
  });

  it('does not salvage an inner object from malformed structured tool arguments', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const malformed =
      '{"snapshotId":"snap-1","index":14,"expect":{"type":"url_changes","text":"/archive/econ"}';

    expect(() => orch._parseToolArguments(malformed)).toThrow(/Invalid tool arguments format/u);
    expect(orch._parseToolArguments('arguments: {"query":"Economics"}')).toEqual({
      query: 'Economics',
    });
  });

  it('never enumerates tool limitations and tells the model to answer normally', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const prompt = orch._buildSystemPrompt({ config: {}, pageActions: { enabled: true } }, []);

    // Directs tool use for page-achievable tasks...
    expect(prompt).toContain('ACT MODE:');
    expect(prompt).toContain('PERFORM it with the tools');
    expect(prompt).toContain('directly advances the user’s next requested step');
    // ...but never lists capabilities the tools lack. Enumerating them made
    // models lead with "I can't" refusals for ordinary chat requests, so the
    // block only instructs answering normally instead.
    expect(prompt).not.toContain('terminal or OS');
    expect(prompt).not.toContain('git clone');
    expect(prompt).not.toContain('OUT OF SCOPE');
    expect(prompt).not.toContain('JavaScript');
    expect(prompt).toContain('answer normally; never fake an action');
    expect(prompt).toContain('tools remain available');
    expect(prompt).toContain('never fake an action');
  });

  it('keeps owned-tab tools inside the Act lease even for a legacy disabled flag', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const prompt = orch._buildSystemPrompt(
      { config: {}, pageActions: { enabled: true, multiTabEnabled: false } },
      []
    );
    expect(prompt).toContain('page_request_user_input');
    expect(prompt).toContain('page_open_link');
    expect(prompt).toContain('page_switch_tab');
  });

  it('omits the PAGE ACTIONS block when page actions are disabled', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const prompt = orch._buildSystemPrompt({ config: {} }, []);

    expect(prompt).not.toContain('PAGE ACTIONS:');
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
  });

  it('advertises owned-tab tools only for an explicitly enabled run', async () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const disabled = await orch._buildTools({
      config: {},
      loadedSkills: new Set(),
      pageActions: { enabled: true, multiTabEnabled: false },
    });
    expect(disabled.map((tool) => tool.function.name)).not.toContain('page_open_tab');

    const enabled = await orch._buildTools({
      config: {},
      loadedSkills: new Set(),
      pageActions: { enabled: true, multiTabEnabled: true, snapshot: {} },
    });
    expect(enabled.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining([
        'page_list_tabs',
        'page_open_tab',
        'page_open_link',
        'page_switch_tab',
        'page_close_tab',
      ])
    );
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

  it('execute() preserves loaded page content across tool-call continuations', async () => {
    const skillManager = createStubSkillManager();
    const orch = new RunOrchestrator(skillManager);
    const captured = [];

    orch._executeOpenAI = async (run) => {
      captured.push(run.conversationHistory.map((m) => ({ ...m })));
    };

    const runId = await orch.startRun({
      llmEndpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'sk-test',
      modelName: 'gpt-4o',
    });

    // A loaded page is budget-fitted to ~40k tokens, far above the 12k-char
    // historical clamp that used to silently discard most of the content.
    const pageBody = 'p'.repeat(40_000);
    await orch.execute(runId, {
      messages: [
        {
          role: 'user',
          content: `--- Page content ---\n${pageBody}\n--- End Page content ---`,
          _promptPaulContext: { type: 'page_content' },
        },
        { role: 'user', content: 'Summarise it' },
      ],
    });

    // A continuation is not re-sent by the client, so the marker has to stay on
    // run.conversationHistory for the next compaction pass to keep protecting it.
    const run = orch.getRun(runId);
    run.conversationHistory.push(
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 't1', type: 'function', function: { name: 'web_search', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 't1', name: 'web_search', content: '{"query":"q"}' }
    );
    await orch.execute(runId, { continueConversation: true }, true);

    expect(captured).toHaveLength(2);
    for (const history of captured) {
      const persisted = history.find((m) => m.content?.includes('--- Page content ---'));
      expect(persisted).toBeTruthy();
      expect(persisted.content).toContain(pageBody);
    }

    // The marker has to stay on local history — that is what keeps protecting
    // the content — and must be dropped only when a provider payload is built.
    const live = orch
      .getRun(runId)
      .conversationHistory.find((m) => m.content?.includes('--- Page content ---'));
    expect(live._promptPaulContext).toEqual({ type: 'page_content' });
    const payload = orch._stripInternalContextMarkers([live]);
    expect(payload[0].content).toContain(pageBody);
    expect(payload[0]._promptPaulContext).toBeUndefined();
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
    global.fetch = async (_url, opts) => {
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

  it('attributes OpenRouter requests to the Prompt Paul app', async () => {
    const originalFetch = global.fetch;
    let headers;
    global.fetch = async (_url, options) => {
      headers = options.headers;
      return streamingResponse({ choices: [{ delta: { content: 'answer' } }] });
    };
    try {
      const orch = new RunOrchestrator(createStubSkillManager());
      orch._emitEvent = () => {};
      await orch._executeOpenAI(
        {
          id: 'openrouter-attribution',
          config: {
            llmEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
            apiKey: 'llm-key',
            modelName: 'openrouter/free',
          },
          conversationHistory: [{ role: 'user', content: 'question' }],
          accumulatedText: '',
          webSearch: { enabled: false, attempted: false, attempts: 0, failed: false, sources: [] },
          toolChoiceState: {
            original: 'auto',
            forcedUserTool: null,
            forcedUserToolSatisfied: true,
          },
          abortController: new AbortController(),
          loadedSkills: new Set(),
        },
        []
      );
    } finally {
      global.fetch = originalFetch;
    }

    expect(headers['HTTP-Referer']).toBe('https://promptpaul.juanmackie.com');
    expect(headers['X-OpenRouter-Title']).toBe('Prompt Paul');
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

describe('P1-05 pending-interaction journal replay fields', () => {
  function newOrch() {
    return new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionAvailabilityProvider: async () => true,
    });
  }

  it('preserves requestId/question/options for page_user_input_request', () => {
    const safe = newOrch()._journalEvent({
      type: 'page_user_input_request',
      requestId: 'input-abc-1',
      question: 'Pick an option',
      options: ['One', 'Two', 'Secret'],
      sequence: 3,
      timestamp: 1000,
    });
    expect(safe.requestId).toBe('input-abc-1');
    expect(safe.question).toBe('Pick an option');
    expect(safe.options).toEqual(['One', 'Two', 'Secret']);
  });

  it('preserves requestId/question/activeTab for page_manual_intervention_request', () => {
    const safe = newOrch()._journalEvent({
      type: 'page_manual_intervention_request',
      requestId: 'manual-xyz-9',
      question: 'Click Save draft in the visible tab',
      activeTab: { tabId: 7, title: 'Example form', origin: 'https://example.test:8443' },
      state: 'paused',
      sequence: 4,
      timestamp: 2000,
    });
    expect(safe.requestId).toBe('manual-xyz-9');
    expect(safe.question).toContain('Save draft');
    expect(safe.activeTab).toEqual({
      tabId: 7,
      title: 'Example form',
      origin: 'https://example.test:8443',
    });
  });

  it('preserves approvalId for hermes_approval_required', () => {
    const safe = newOrch()._journalEvent({
      type: 'hermes_approval_required',
      approvalId: 'approval-42',
      title: 'Action approval',
      reason: 'Run client tool',
      sequence: 5,
      timestamp: 3000,
    });
    expect(safe.approvalId).toBe('approval-42');
    expect(safe.type).toBe('hermes_approval_required');
  });

  it('does not leak extra request fields into ordinary events', () => {
    const safe = newOrch()._journalEvent({
      type: 'tool_start',
      toolCall: { function: { name: 'page_get_state', arguments: '{}' } },
      sequence: 2,
      timestamp: 500,
    });
    expect(safe.requestId).toBeUndefined();
    expect(safe.approvalId).toBeUndefined();
    expect(safe.question).toBeUndefined();
  });
});

describe('P2-08 visible terminal recovery truncation', () => {
  function newOrch() {
    return new RunOrchestrator(createStubSkillManager(), {
      pageActionPolicyProvider: async () => true,
      pageActionAvailabilityProvider: async () => true,
    });
  }

  it('records contentTruncated and originalLength when a complete answer is capped', () => {
    const safe = newOrch()._journalEvent({
      type: 'complete',
      content: 'x'.repeat(8_500),
      grounding: { enabled: true, attempts: 1, sources: [{ title: 'A', url: 'https://a.test' }] },
      sequence: 9,
      timestamp: 9000,
    });
    expect(safe.content.length).toBe(8_000);
    expect(safe.contentTruncated).toBe(true);
    expect(safe.originalLength).toBe(8_500);
  });

  it('preserves grounding sources and completion on a complete event with no truncation flag', () => {
    const safe = newOrch()._journalEvent({
      type: 'complete',
      content: 'short answer',
      grounding: { enabled: true, attempts: 1, sources: [{ title: 'A', url: 'https://a.test' }] },
      completion: { hasReasoning: true },
      sequence: 10,
      timestamp: 10000,
    });
    expect(safe.content).toBe('short answer');
    expect(safe.contentTruncated).toBeUndefined();
    expect(safe.grounding.sources[0].title).toBe('A');
    expect(safe.completion.hasReasoning).toBe(true);
  });

  it('does not mark content under the cap as truncated (backward compatible)', () => {
    const safe = newOrch()._journalEvent({
      type: 'complete',
      content: 'y'.repeat(4_000),
      sequence: 11,
      timestamp: 11000,
    });
    expect(safe.content.length).toBe(4_000);
    expect(safe.contentTruncated).toBeUndefined();
    expect(safe.originalLength).toBeUndefined();
  });
});
