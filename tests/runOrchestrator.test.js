import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';
import { createThinkParser } from '../src/utils/inlineReasoning.js';
import { buildCodexInput } from '../src/orchestrator/CodexTransport.js';

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

describe('RunOrchestrator Hermes current-turn context', () => {
  function makeHermesRun(overrides = {}) {
    return {
      id: 'hermes-context-run',
      config: {
        provider: 'hermes',
        profileId: 'hermes-profile',
        conversationId: 'conversation-1',
        hermesEndpoint: 'http://127.0.0.1:8642',
        modelName: 'hermes-agent',
      },
      conversationHistory: [],
      accumulatedText: '',
      hasReasoning: false,
      pageActions: { enabled: false },
      hermes: { remoteRunId: null, sessionId: null, sessionKey: '', pendingApproval: null },
      abortController: new AbortController(),
      ...overrides,
    };
  }

  it('sends loaded page context and the question while excluding older transcript turns', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const input = orch._getHermesCurrentTurnInput([
      { role: 'user', content: 'Old conversation question' },
      { role: 'assistant', content: 'Old conversation answer' },
      { role: 'user', content: '--- Page content ---\nFresh page evidence' },
      { role: 'user', content: 'Was this hardware replaced?' },
    ]);

    expect(input).toEqual([
      { role: 'user', content: '--- Page content ---\nFresh page evidence' },
      { role: 'user', content: 'Was this hardware replaced?' },
    ]);
    expect(JSON.stringify(input)).not.toContain('Old conversation');
  });

  it('forwards core, saved, and explicitly requested skill instructions to Hermes', () => {
    const orch = new RunOrchestrator(
      createStubSkillManager({
        resolveSkill: () => ({
          name: 'humanizer',
          description: 'Natural writing',
          instructions: 'Use a natural voice.',
        }),
      })
    );
    const prompt = orch._buildHermesInstructions({
      config: {
        systemPrompt: 'Saved profile instruction.',
        requestedSkill: 'humanizer',
      },
    });

    expect(prompt).toContain('Saved profile instruction.');
    expect(prompt).toContain('Use a natural voice.');
    expect(prompt).toContain('SKILL: humanizer');
  });

  it('wraps a single multimodal message as a Hermes message object', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const input = orch._getHermesCurrentTurnInput([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        ],
      },
    ]);

    expect(input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        ],
      },
    ]);
  });

  it('uses the same context-bearing input when recovering a stale session', async () => {
    const submitted = [];
    let firstAttempt = true;
    const transport = {
      getSessionKey: async () => 'memory-key',
      getStoredSession: async () => 'stale-session',
      clearStoredSession: async () => {},
      ensureSession: async () => 'replacement-session',
      storeSession: async () => {},
      startRun: async (_profile, options) => {
        submitted.push({ input: options.input, history: options.conversationHistory });
        if (firstAttempt) {
          firstAttempt = false;
          const error = new Error('session missing');
          error.status = 404;
          error.code = 'session_not_found';
          throw error;
        }
        return { runId: 'hermes-run-1', sessionId: 'replacement-session' };
      },
      streamRun: async (_profile, _runId, options) => {
        await options.onEvent({ type: 'run.completed' });
      },
      getRunStatus: async () => ({ status: 'completed', output: 'Recovered answer' }),
    };
    const orch = new RunOrchestrator(createStubSkillManager(), { hermesTransport: transport });
    orch._emitEvent = () => {};
    orch._finalizeTextResponse = async () => {};
    const run = makeHermesRun({
      conversationHistory: [
        { role: 'assistant', content: 'Old answer' },
        { role: 'user', content: '--- Page content ---\nFresh page evidence' },
        { role: 'user', content: 'Was this hardware replaced?' },
      ],
    });
    orch.activeRuns.set(run.id, run);

    await orch._executeHermes(run);

    expect(submitted).toHaveLength(2);
    expect(submitted[0]).toEqual(submitted[1]);
    expect(submitted[1].input).toEqual([
      { role: 'user', content: '--- Page content ---\nFresh page evidence' },
      { role: 'user', content: 'Was this hardware replaced?' },
    ]);
    expect(submitted[1].history).toEqual([]);
  });

  it('executes a Hermes client-tool request through the existing page-action boundary', async () => {
    const submitted = [];
    let startedOptions;
    const events = [];
    const transport = {
      getSessionKey: async () => 'memory-key',
      getStoredSession: async () => 'session-1',
      startRun: async (_profile, options) => {
        startedOptions = options;
        return { runId: 'remote-run', sessionId: 'session-1' };
      },
      streamRun: async (_profile, _runId, options) => {
        await options.onEvent({
          type: 'client_tool.request',
          tool_call_id: 'call-1',
          name: 'page_get_state',
          arguments: {},
        });
        await options.onEvent({ type: 'run.completed', output: 'Found the page.' });
      },
      submitToolResult: async (_profile, _runId, toolCallId, result) => {
        submitted.push({ toolCallId, result });
      },
    };
    const orch = new RunOrchestrator(createStubSkillManager(), {
      hermesTransport: transport,
      pageActionExecutor: async () => ({
        snapshot: { url: 'https://mail.google.com', header: 'Gmail', elements: [] },
      }),
    });
    orch._emitEvent = (_runId, event) => events.push(event);
    orch._finalizeTextResponse = async () => {};
    const run = makeHermesRun({
      sourceTabId: 7,
      conversationHistory: [{ role: 'user', content: 'Inspect Gmail.' }],
      pageActions: {
        enabled: true,
        multiTabEnabled: false,
        trustedMode: false,
        budgets: { observation: 0, navigation: 0, mutation: 0 },
        budgetWarnings: new Set(),
        notes: [],
        unavailableTabs: new Set(),
        targetTabId: 7,
        allowedOrigins: new Set(),
      },
      hermes: {
        remoteRunId: null,
        sessionId: null,
        sessionKey: '',
        pendingApproval: null,
        clientToolsEnabled: true,
        clientToolResults: new Map(),
      },
    });
    orch.activeRuns.set(run.id, run);

    await orch._executeHermes(run);

    expect(startedOptions.clientTools.map((tool) => tool.function.name)).toContain(
      'page_get_state'
    );
    expect(submitted).toHaveLength(1);
    expect(submitted[0].toolCallId).toBe('call-1');
    expect(submitted[0].result.result.snapshot.url).toBe('https://mail.google.com/');
    expect(events.map((event) => event.type)).toContain('tool_start');
    expect(events.map((event) => event.type)).toContain('tool_complete');
  });

  it('reports a failed client tool to the gateway instead of abandoning the stream', async () => {
    const submitted = [];
    const transport = {
      getSessionKey: async () => 'memory-key',
      getStoredSession: async () => 'session-1',
      startRun: async () => ({ runId: 'remote-run', sessionId: 'session-1' }),
      streamRun: async (_profile, _runId, options) => {
        await options.onEvent({
          type: 'client_tool.request',
          tool_call_id: 'call-err',
          name: 'page_scroll',
          arguments: '{"direction":"down"}',
        });
        await options.onEvent({ type: 'run.completed', output: 'Recovered answer.' });
      },
      submitToolResult: async (_profile, _runId, toolCallId, result) => {
        submitted.push({ toolCallId, result });
      },
    };
    const orch = new RunOrchestrator(createStubSkillManager(), {
      hermesTransport: transport,
      pageActionExecutor: async () => {
        throw new Error('Synthetic page action failure.');
      },
    });
    orch._emitEvent = () => {};
    orch._finalizeTextResponse = async () => {};
    const run = makeHermesRun({
      conversationHistory: [{ role: 'user', content: 'Act on the page.' }],
      pageActions: {
        enabled: true,
        multiTabEnabled: false,
        trustedMode: false,
        budgets: { observation: 0, navigation: 0, mutation: 0 },
        budgetWarnings: new Set(),
        notes: [],
        unavailableTabs: new Set(),
        targetTabId: 7,
        allowedOrigins: new Set(),
      },
      hermes: {
        remoteRunId: null,
        sessionId: null,
        sessionKey: '',
        pendingApproval: null,
        clientToolsEnabled: true,
        clientToolResults: new Map(),
      },
    });
    orch.activeRuns.set(run.id, run);

    await orch._executeHermes(run);

    expect(submitted).toHaveLength(1);
    expect(submitted[0].toolCallId).toBe('call-err');
    expect(submitted[0].result).toEqual({
      success: false,
      result: {
        error: 'CLIENT_TOOL_FAILED',
        message: 'Synthetic page action failure.',
      },
    });
    expect(run.accumulatedText).toBe('Recovered answer.');
  });

  it('applies structured output recovered from run-status polling', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    const run = makeHermesRun();

    orch._applyHermesRecoveredOutput(run, {
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Recovered answer.' }] }],
    });

    expect(run.accumulatedText).toBe('Recovered answer.');
    expect(events).toEqual([{ type: 'content', data: 'Recovered answer.' }]);
  });

  it('keeps a Hermes run active while the remote stop is being processed', async () => {
    let stopCalls = 0;
    const transport = {
      stopRun: async () => {
        stopCalls += 1;
      },
    };
    const orch = new RunOrchestrator(createStubSkillManager(), { hermesTransport: transport });
    orch._emitEvent = () => {};
    const run = makeHermesRun({
      hermes: {
        remoteRunId: 'remote-run',
        sessionId: 'session-1',
        sessionKey: 'memory-key',
        pendingApproval: null,
      },
    });
    orch.activeRuns.set(run.id, run);

    await expect(orch.abort(run.id)).resolves.toBe(true);
    expect(stopCalls).toBe(1);
    expect(run.status).toBe('stopping');
    expect(orch.activeRuns.has(run.id)).toBe(true);

    orch._terminateRun(run.id, { type: 'aborted' }, { run });
    expect(orch.activeRuns.has(run.id)).toBe(false);
  });

  it('rejects stale approval decisions and accepts the matching approval', async () => {
    const decisions = [];
    const transport = {
      respondToApproval: async (_profile, _runId, choice) => {
        decisions.push(choice);
      },
    };
    const orch = new RunOrchestrator(createStubSkillManager(), { hermesTransport: transport });
    orch._emitEvent = () => {};
    const run = makeHermesRun({
      hermes: {
        remoteRunId: 'remote-run',
        sessionId: 'session-1',
        sessionKey: 'memory-key',
        pendingApproval: { approvalId: 'approval-1' },
      },
    });
    orch.activeRuns.set(run.id, run);

    await expect(orch.resolveHermesApproval(run.id, 'stale-approval', 'once')).resolves.toBe(false);
    expect(decisions).toEqual([]);
    expect(run.hermes.pendingApproval.approvalId).toBe('approval-1');

    await expect(orch.resolveHermesApproval(run.id, 'approval-1', 'once')).resolves.toBe(true);
    expect(decisions).toEqual(['once']);
    expect(run.hermes.pendingApproval).toBeNull();
  });

  it('replaces divergent streamed text with authoritative recovered output', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const run = makeHermesRun({ accumulatedText: 'Partial answer' });

    orch._applyHermesRecoveredOutput(run, 'Authoritative answer.');

    expect(run.accumulatedText).toBe('Authoritative answer.');
  });

  it('polls after an empty completed event before finalizing Hermes output', async () => {
    let statusCalls = 0;
    let finalText = '';
    const transport = {
      getSessionKey: async () => 'memory-key',
      getStoredSession: async () => 'session-1',
      startRun: async () => ({ runId: 'run-1', sessionId: 'session-1' }),
      streamRun: async (_profile, _runId, options) => {
        await options.onEvent({ type: 'run.completed' });
      },
      getRunStatus: async () => {
        statusCalls += 1;
        return { status: 'completed', output: 'Recovered after empty stream.' };
      },
    };
    const orch = new RunOrchestrator(createStubSkillManager(), { hermesTransport: transport });
    orch._emitEvent = () => {};
    orch._finalizeTextResponse = async (run) => {
      finalText = run.accumulatedText;
    };
    const run = makeHermesRun({
      conversationHistory: [{ role: 'user', content: 'Hello' }],
    });
    orch.activeRuns.set(run.id, run);

    await orch._executeHermes(run);

    expect(statusCalls).toBe(1);
    expect(finalText).toBe('Recovered after empty stream.');
  });

  it('uses output from a completed SSE event without polling', async () => {
    let statusCalls = 0;
    let finalText = '';
    const transport = {
      getSessionKey: async () => 'memory-key',
      getStoredSession: async () => 'session-1',
      startRun: async () => ({ runId: 'run-1', sessionId: 'session-1' }),
      streamRun: async (_profile, _runId, options) => {
        await options.onEvent({ type: 'run.completed', output: 'Direct answer.' });
      },
      getRunStatus: async () => {
        statusCalls += 1;
        return { status: 'completed', output: 'Should not be used.' };
      },
    };
    const orch = new RunOrchestrator(createStubSkillManager(), { hermesTransport: transport });
    orch._emitEvent = () => {};
    orch._finalizeTextResponse = async (run) => {
      finalText = run.accumulatedText;
    };
    const run = makeHermesRun({ conversationHistory: [{ role: 'user', content: 'Hello' }] });
    orch.activeRuns.set(run.id, run);

    await orch._executeHermes(run);

    expect(statusCalls).toBe(0);
    expect(finalText).toBe('Direct answer.');
  });

  it('does not replace a session for an unrelated 404 response', async () => {
    let cleared = false;
    let ensured = false;
    const transport = {
      getSessionKey: async () => 'memory-key',
      getStoredSession: async () => 'active-session',
      clearStoredSession: async () => {
        cleared = true;
      },
      ensureSession: async () => {
        ensured = true;
        return 'replacement-session';
      },
      storeSession: async () => {},
      startRun: async () => {
        const error = new Error('run route missing');
        error.status = 404;
        error.code = 'route_not_found';
        throw error;
      },
    };
    const orch = new RunOrchestrator(createStubSkillManager(), { hermesTransport: transport });
    const run = makeHermesRun({
      conversationHistory: [{ role: 'user', content: 'Hello' }],
    });
    orch.activeRuns.set(run.id, run);

    await expect(orch._executeHermes(run)).rejects.toMatchObject({
      status: 404,
      code: 'route_not_found',
    });
    expect(cleared).toBe(false);
    expect(ensured).toBe(false);
  });
});

describe('RunOrchestrator Hermes tool boundaries', () => {
  it('rejects Hermes Act before creating a run without client-tool support', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      hermesClientToolsProvider: async () => false,
    });

    await expect(
      orch.startRun({ provider: 'hermes', pageActions: true, sourceTabId: 7 })
    ).rejects.toThrow(/client-tool protocol/i);
    expect(orch.activeRuns.size).toBe(0);
  });

  it('enables Hermes Act only after the gateway capability contract passes', async () => {
    const orch = new RunOrchestrator(createStubSkillManager(), {
      hermesClientToolsProvider: async () => ({
        features: { run_client_tools: true },
        endpoints: {
          run_tool_result: { method: 'POST', path: '/v1/runs/{run_id}/tool-result' },
        },
      }),
      pageActionAvailabilityProvider: async () => true,
    });

    const runId = await orch.startRun({
      provider: 'hermes',
      pageActions: true,
      sourceTabId: 7,
    });
    expect(orch.getRun(runId).pageActions.enabled).toBe(true);
    expect(orch.getRun(runId).hermes.clientToolsEnabled).toBe(true);
    orch.activeRuns.delete(runId);
  });

  it('does not register Prompt Paul custom tools for Hermes runs', async () => {
    const tool = {
      name: 'lookup',
      endpointUrl: 'https://example.com/lookup',
      description: 'Lookup data',
      parameters: { type: 'object', properties: {} },
    };
    const orch = new RunOrchestrator(createStubSkillManager(), {
      userToolExecutor: async () => ({ ok: true }),
    });

    await orch.startRun({ provider: 'hermes', tools: [tool] });

    expect(orch.getToolImplementations()).not.toContain('lookup');
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

describe('Day 3: Act progress card page_task_progress events', () => {
  function makeProgressRun(overrides = {}) {
    return {
      id: 'run-progress-1',
      status: 'running',
      objective: 'Fill out the form and submit it.',
      eventSequence: 0,
      eventJournal: [],
      journalUpdatedAt: 0,
      pageActions: {
        enabled: true,
        currentActivityAction: 'page_click',
        currentTabTitle: 'Checkout',
        currentTabOrigin: 'https://shop.example.com:8443',
        lastActionReceipt: { disposition: 'delivered_verified' },
        planner: null,
        pendingConfirmation: null,
        pendingUserInput: null,
        pendingManualIntervention: null,
        ...overrides,
      },
    };
  }

  function boot(overrides = {}) {
    const run = makeProgressRun(overrides);
    const orch = new RunOrchestrator(createStubSkillManager());
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    orch.activeRuns.set(run.id, run);
    return { orch, run, events };
  }

  it('emits a bounded page_task_progress reflecting current action, target, and waiting', () => {
    const { orch, run, events } = boot({ pendingConfirmation: { id: 'conf-9' } });
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event).toBeTruthy();
    expect(event.status).toBe('running');
    expect(event.hasPlanner).toBe(false);
    expect(event.currentAction).toBe('page_click');
    expect(event.waiting).toBe('approval');
    expect(event.waitingRequestId).toBe('conf-9');
    expect(event.target.label).toBe('Checkout');
    expect(event.target).not.toHaveProperty('url');
    expect(event.receipt.disposition).toBe('delivered_verified');
  });

  it('renders precise-input state as a bounded progress field and persists only its enum', () => {
    const { orch, run, events } = boot({ preciseInputState: 'active' });
    orch._emitPageTaskProgress(run);
    const event = events.find((entry) => entry.type === 'page_task_progress');
    expect(event.preciseInputState).toBe('active');
    expect(
      orch._journalEvent({ ...event, preciseInputState: 'arbitrary-data' })
    ).not.toHaveProperty('preciseInputState');
    expect(orch._journalEvent(event).preciseInputState).toBe('active');
  });

  it('uses a bounded origin label as target when no tab title is available', () => {
    const { orch, run, events } = boot({ currentTabTitle: '' });
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event.target).toEqual({ label: 'https://shop.example.com:8443', origin: true });
  });

  it('maps planner sub-goal statuses to current/completed/blocked and reports task completion separately', () => {
    const planner = {
      active: true,
      completedAt: Date.now(),
      currentSubGoalIndex: 2,
      subGoals: [
        { description: 'Open the form', status: 'completed' },
        { description: 'Fill required fields', status: 'completed' },
        { description: 'Review summary', status: 'in_progress' },
        { description: 'Submit', status: 'pending' },
        { description: 'Confirm receipt', status: 'skipped' },
      ],
    };
    const { orch, run, events } = boot({ planner, currentActivityAction: null });
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event.hasPlanner).toBe(true);
    expect(event.taskComplete).toBe(true);
    expect(event.currentStep).toBe('Review summary');
    expect(event.steps.map((s) => s.status)).toEqual([
      'completed',
      'completed',
      'current',
      'pending',
      'blocked',
    ]);
    // A resolved planner is still distinct from any single verified receipt.
    expect(event.receipt).toBeNull();
  });

  it('maps waiting states from each pending interaction', () => {
    const { orch: o1, run: r1, events: e1 } = boot({ pendingUserInput: { id: 'input-1' } });
    o1._emitPageTaskProgress(r1);
    expect(e1.find((e) => e.type === 'page_task_progress').waiting).toBe('answer');

    const {
      orch: o2,
      run: r2,
      events: e2,
    } = boot({ pendingManualIntervention: { id: 'manual-1' } });
    o2._emitPageTaskProgress(r2);
    expect(e2.find((e) => e.type === 'page_task_progress').waiting).toBe('manual');
  });

  it('emits a terminal progress event with final status before completion', () => {
    const run = makeProgressRun({ planner: null });
    const orch = new RunOrchestrator(createStubSkillManager());
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    orch.activeRuns.set(run.id, run);
    run.status = 'complete';
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event.status).toBe('complete');
  });
});

describe('Day 3: page_task_progress journal safety', () => {
  function newOrch() {
    return new RunOrchestrator(createStubSkillManager());
  }

  it('persists only bounded safe fields and never raw URL/DOM/screenshots/arguments', () => {
    const safe = newOrch()._journalEvent({
      type: 'page_task_progress',
      status: 'running',
      hasPlanner: true,
      taskComplete: false,
      currentStep: 'Review summary',
      currentAction: 'page_click',
      target: { label: 'Checkout', origin: false },
      waiting: 'approval',
      waitingRequestId: 'conf-9',
      receipt: { disposition: 'delivered_verified', actionName: 'page_click' },
      steps: [
        { index: 0, label: 'Open the form', status: 'completed' },
        { index: 1, label: 'Fill required fields', status: 'current' },
      ],
      // These would violate the journal contract if persisted unconditionally:
      dom: '<input name=password>',
      screenshot: 'data:image/png;base64,c2VjcmV0',
      argument: { value: 'secret' },
      sequence: 6,
      timestamp: 2000,
    });
    expect(safe.type).toBe('page_task_progress');
    expect(safe.status).toBe('running');
    expect(safe.hasPlanner).toBe(true);
    expect(safe.taskComplete).toBe(false);
    expect(safe.currentStep).toBe('Review summary');
    expect(safe.target).toEqual({ label: 'Checkout', origin: false });
    expect(safe.waiting).toBe('approval');
    expect(safe.waitingRequestId).toBe('conf-9');
    expect(safe.receipt).toEqual({ disposition: 'delivered_verified', actionName: 'page_click' });
    expect(safe.steps).toEqual([
      { index: 0, label: 'Open the form', status: 'completed' },
      { index: 1, label: 'Fill required fields', status: 'current' },
    ]);
    expect(safe.dom).toBeUndefined();
    expect(safe.screenshot).toBeUndefined();
    expect(safe.argument).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain('password');
    expect(JSON.stringify(safe)).not.toContain('secret');
  });

  it('caps step count and per-step label length, and falls back unknown statuses to pending', () => {
    const safe = newOrch()._journalEvent({
      type: 'page_task_progress',
      status: 'running',
      hasPlanner: true,
      steps: Array.from({ length: 20 }, (_, i) => ({
        index: i,
        label: 'x'.repeat(500),
        status: i % 3 === 0 ? 'done' : 'weird-status',
      })),
      sequence: 7,
      timestamp: 3000,
    });
    expect(safe.steps.length).toBe(12);
    expect(safe.steps[0].label.length).toBe(180);
    // 'done' is not a persisted status vocabulary value; it maps back to pending.
    expect(safe.steps[0].status).toBe('pending');
    expect(safe.steps[1].status).toBe('pending');
  });
});

describe('Day 4: page_task_progress deterministic outcome facts', () => {
  function makeProgressRun(overrides = {}) {
    return {
      id: 'run-outcome-1',
      status: 'running',
      objective: 'Fill out the form and submit it.',
      eventSequence: 0,
      eventJournal: [],
      journalUpdatedAt: 0,
      pageActions: {
        enabled: true,
        currentActivityAction: 'page_click',
        currentTabTitle: 'Checkout',
        currentTabOrigin: 'https://shop.example.com',
        lastActionReceipt: { disposition: 'delivered_verified' },
        planner: null,
        pendingConfirmation: null,
        pendingUserInput: null,
        pendingManualIntervention: null,
        ...overrides,
      },
    };
  }

  function boot(overrides = {}) {
    const run = makeProgressRun(overrides);
    const orch = new RunOrchestrator(createStubSkillManager());
    const events = [];
    orch._emitEvent = (_runId, event) => events.push(event);
    orch.activeRuns.set(run.id, run);
    return { orch, run, events };
  }

  it('flags unverified when the last receipt was delivered_unverified', () => {
    const { orch, run, events } = boot({
      lastActionReceipt: { disposition: 'delivered_unverified' },
    });
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event.outcome).toBeTruthy();
    expect(event.outcome.unverified).toBe(true);
    expect(event.outcome.notDelivered).toBe(false);
    expect(event.outcome.verified).toBe(false);
    expect(event.outcome.status).toBe('running');
    expect(event.outcome.taskComplete).toBe(false);
  });

  it('flags notDelivered and verified independently of unverified', () => {
    const {
      orch: o1,
      run: r1,
      events: e1,
    } = boot({
      lastActionReceipt: { disposition: 'not_delivered' },
    });
    o1._emitPageTaskProgress(r1);
    const ev1 = e1.find((e) => e.type === 'page_task_progress');
    expect(ev1.outcome.notDelivered).toBe(true);
    expect(ev1.outcome.unverified).toBe(false);

    const {
      orch: o2,
      run: r2,
      events: e2,
    } = boot({
      lastActionReceipt: { disposition: 'delivered_verified' },
    });
    o2._emitPageTaskProgress(r2);
    const ev2 = e2.find((e) => e.type === 'page_task_progress');
    expect(ev2.outcome.verified).toBe(true);
    expect(ev2.outcome.unverified).toBe(false);
  });

  it('derives completed/blocked/remaining steps from planner sub-goal statuses', () => {
    const planner = {
      active: true,
      completedAt: null,
      currentSubGoalIndex: 2,
      subGoals: [
        { description: 'Open the form', status: 'completed' },
        { description: 'Fill required fields', status: 'completed' },
        { description: 'Review summary', status: 'in_progress' },
        { description: 'Submit', status: 'pending' },
        { description: 'Confirm receipt', status: 'skipped' },
      ],
    };
    const { orch, run, events } = boot({ planner, currentActivityAction: null });
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event.outcome.completedSteps).toBe(2);
    expect(event.outcome.blockedSteps).toBe(1);
    expect(event.outcome.remainingSteps).toBe(2);
    expect(event.outcome.taskComplete).toBe(false);
  });

  it('reflects the final terminal status and resolved planner', () => {
    const { orch, run, events } = boot({ planner: null });
    run.status = 'complete';
    orch._emitPageTaskProgress(run);
    const event = events.find((e) => e.type === 'page_task_progress');
    expect(event.outcome.status).toBe('complete');
  });

  it('journal-persists only bounded safe outcome booleans and counts, never arguments', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const safe = orch._journalEvent({
      type: 'page_task_progress',
      status: 'complete',
      outcome: {
        status: 'complete',
        waiting: 'approval',
        taskComplete: true,
        unverified: true,
        notDelivered: false,
        verified: false,
        completedSteps: 3,
        blockedSteps: 1,
        remainingSteps: 0,
        // Intentionally hostile values that must be dropped/coerced, never persisted raw.
        argument: { value: 'secret' },
        screenshot: 'data:image/png;base64,secret',
      },
      sequence: 9,
      timestamp: 5000,
    });
    expect(safe.outcome).toBeTruthy();
    expect(safe.outcome.unverified).toBe(true);
    expect(safe.outcome.waiting).toBe('approval');
    expect(safe.outcome.taskComplete).toBe(true);
    expect(safe.outcome.completedSteps).toBe(3);
    expect(safe.outcome.blockedSteps).toBe(1);
    expect(safe.outcome.remainingSteps).toBe(0);
    expect(safe.outcome.argument).toBeUndefined();
    expect(safe.outcome.screenshot).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain('secret');
  });

  it('does not persist an arbitrary unrelated outcome block from another event type', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    const safe = orch._journalEvent({
      type: 'tool_execution',
      outcome: { bad: true, data: 'secret' },
    });
    expect(safe.outcome).toBeUndefined();
  });
});

describe('Act planning and consent are independent', () => {
  it('never enables auto-approval or emits an approval-scope notice from long prose', () => {
    const orch = new RunOrchestrator(createStubSkillManager());
    orch._emitEvent = vi.fn();
    const run = {
      pageActions: { enabled: true, sessionApproval: false },
      conversationHistory: [
        {
          role: 'user',
          content: 'Open the menu, then review the entries and select the requested entry.',
        },
      ],
    };
    orch._initializeActPlanner(run);
    expect(run.pageActions.planner.subGoals).toEqual([]);
    expect(run.pageActions.planner.autoApproval).toBeUndefined();
    expect(run.pageActions.sessionApproval).toBe(false);
    expect(orch._emitEvent).not.toHaveBeenCalled();
  });
});
