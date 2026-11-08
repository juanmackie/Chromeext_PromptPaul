import { describe, expect, it } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';
import { createStubSkillManager } from './helpers/runOrchestrator.js';

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
