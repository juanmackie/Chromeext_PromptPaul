import { describe, expect, it, vi } from 'vitest';
import {
  classifyProviderError,
  compactConversationHistory,
  detectRepeatedOutput,
  getProviderTimeoutMs,
  redactProviderErrorMessage,
} from '../src/utils/runResilience.js';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';

const skillManager = {
  resolveSkill: () => null,
  getEligibleSnapshot: () => [],
  getSkillsList: () => [],
  getSkillNames: () => [],
  hasSkill: () => false,
};

function streamResponse(content) {
  let delivered = false;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (delivered) return { done: true };
          delivered = true;
          return {
            done: false,
            value: new TextEncoder().encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content, finish_reason: 'stop' } }] })}\n\n`
            ),
          };
        },
      }),
    },
  };
}

describe('run resilience helpers', () => {
  it('keeps reasoning models above the normal request timeout floor', () => {
    expect(getProviderTimeoutMs('o3-mini', 120_000)).toBe(300_000);
    expect(getProviderTimeoutMs('claude-sonnet-4-5', 120_000)).toBe(180_000);
    expect(getProviderTimeoutMs('gpt-4o', 120_000)).toBe(120_000);
  });

  it('classifies provider failures before selecting recovery', () => {
    expect(classifyProviderError({ status: 429, message: 'upstream rate limit' })).toBe(
      'upstream_rate_limit'
    );
    expect(classifyProviderError({ status: 413, message: 'payload too large' })).toBe(
      'context_overflow'
    );
    expect(classifyProviderError({ status: 402, message: 'billing exhausted' })).toBe('billing');
    expect(classifyProviderError({ status: 503, message: 'server busy' })).toBe('overloaded');
  });

  it('compacts the middle while retaining the first and recent turns', () => {
    const result = compactConversationHistory(
      [
        { role: 'user', content: 'Original objective' },
        ...Array.from({ length: 20 }, (_, index) => ({
          role: index % 2 ? 'assistant' : 'user',
          content: `Older turn ${index} ${'x'.repeat(400)}`,
        })),
        { role: 'user', content: 'Latest question' },
      ],
      500
    );

    expect(result.compacted).toBe(true);
    expect(result.messages[0].content).toContain('Original objective');
    expect(result.messages[0].content).toContain('Earlier conversation context');
    expect(result.messages.at(-1).content).toBe('Latest question');
  });

  it('detects long exact repetition but ignores short repetition', () => {
    const fragment = 'This is a repeated provider fragment that is long enough to detect. ';
    expect(detectRepeatedOutput(fragment.repeat(8))).toMatchObject({ repetitions: 8 });
    expect(detectRepeatedOutput('repeat '.repeat(200))).toBeNull();
  });

  it('redacts credential-shaped provider details', () => {
    expect(redactProviderErrorMessage('Invalid api_key=secret-value')).toBe(
      'Invalid api_key=[redacted]'
    );
  });
});

function makePageSnapshot() {
  return {
    snapshotId: 'page-snap-1',
    url: 'https://example.test/form',
    title: 'Example form',
    header: 'Current page',
    content: '[0] <input label="Search">\\n[1] <button label="Open details">',
    footer: 'End of page',
    elements: [
      { index: 0, tag: 'input', label: 'Search', type: 'text', sensitive: false },
      { index: 1, tag: 'button', label: 'Open details', text: 'Open details', sensitive: false },
    ],
  };
}

function makePageCall(id, name, args) {
  return { id, function: { name, arguments: JSON.stringify(args) } };
}

describe('RunOrchestrator approval-wait deadline pause', () => {
  it('extends the run deadline by the time an approval card waits', async () => {
    vi.useFakeTimers();
    try {
      const orch = new RunOrchestrator(skillManager, {
        runBudgetMs: 120_000,
        pageActionExecutor: async (_tabId, actionName) => ({
          success: true,
          snapshot: makePageSnapshot(),
        }),
      });
      orch._emitEvent = () => {};
      const runId = await orch.startRun({
        pageActions: true,
        sourceTabId: 7,
        tool_choice: 'auto',
      });
      const run = orch.activeRuns.get(runId);
      expect(run.resilience.approvalWaitStartedAt).toBeUndefined();

      await orch.executeTool(runId, makePageCall('wait-state', 'page_get_state', {}));
      const pending = orch.executeTool(
        runId,
        makePageCall('wait-click', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
      );
      await vi.advanceTimersByTimeAsync(0); // let the confirmation register
      expect(run.resilience.approvalWaitStartedAt).toBeTypeOf('number');

      const deadlineBefore = run.resilience.deadlineAt;
      expect(run.resilience.approvalWaitStartedAt).not.toBeNull();
      await vi.advanceTimersByTimeAsync(30_000);
      const confirmationId = run.pageActions.pendingConfirmation.id;
      expect(orch.resolvePageActionDecision(runId, confirmationId, true)).toBe(true);
      const result = await pending;
      expect(result.result.success).toBe(true);

      // The deadline absorbed the full wait, so the run does not burn budget
      // while a user stares at a confirmation card.
      expect(run.resilience.deadlineAt - deadlineBefore).toBe(30_000);
      expect(run.resilience.approvalWaitStartedAt).toBeNull();
      expect(run.resilience.approvalWaitExtensions).toBe(1);
      expect(run.pageActions.lastDeniedAction).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps the approval-wait deadline extension at ten minutes', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const orch = new RunOrchestrator(skillManager);
      // A card left open for twelve minutes can only extend the budget by ten.
      const run = {
        resilience: {
          deadlineAt: 500_000,
          approvalWaitStartedAt: 1_000_000 - 720_000,
        },
      };
      orch._extendDeadlineForApprovalWait(run);
      expect(run.resilience.deadlineAt).toBe(500_000 + 10 * 60 * 1_000);
      expect(run.resilience.approvalWaitStartedAt).toBeNull();
      expect(run.resilience.approvalWaitExtensions).toBe(1);

      // A missing marker (e.g. non-Act run) is a no-op.
      const plain = { resilience: { deadlineAt: 500_000 } };
      orch._extendDeadlineForApprovalWait(plain);
      expect(plain.resilience.deadlineAt).toBe(500_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('extends the deadline and records the denial when an approval times out', async () => {
    vi.useFakeTimers();
    try {
      const orch = new RunOrchestrator(skillManager, {
        runBudgetMs: 300_000,
        pageActionExecutor: async (_tabId, actionName) => ({
          success: true,
          snapshot: makePageSnapshot(),
        }),
      });
      orch._emitEvent = () => {};
      const runId = await orch.startRun({
        pageActions: true,
        sourceTabId: 7,
        tool_choice: 'auto',
      });
      const run = orch.activeRuns.get(runId);
      await orch.executeTool(runId, makePageCall('timeout-state', 'page_get_state', {}));
      const pending = orch.executeTool(
        runId,
        makePageCall('timeout-click', 'page_click', { snapshotId: 'page-snap-1', index: 1 })
      );
      await vi.advanceTimersByTimeAsync(0);
      const deadlineBefore = run.resilience.deadlineAt;

      await vi.advanceTimersByTimeAsync(60_001);
      const result = await pending;
      expect(result.result.error).toBe('PAGE_ACTION_DENIED');
      expect(run.pageActions.lastDeniedAction).toMatchObject({ action: 'page_click' });
      expect(run.resilience.deadlineAt - deadlineBefore).toBeGreaterThanOrEqual(60_000);
      expect(run.resilience.approvalWaitStartedAt).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves non-Act run deadlines untouched', async () => {
    vi.useFakeTimers();
    try {
      const orch = new RunOrchestrator(skillManager, { runBudgetMs: 120_000 });
      const runId = await orch.startRun({ provider: 'api', messages: [] });
      const run = orch.activeRuns.get(runId);
      const deadlineBefore = run.resilience.deadlineAt;
      expect(run.resilience.approvalWaitStartedAt).toBeUndefined();
      await vi.advanceTimersByTimeAsync(300_000);
      orch._extendDeadlineForApprovalWait(run);
      expect(run.resilience.deadlineAt).toBe(deadlineBefore);
      expect(run.resilience.approvalWaitStartedAt).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RunOrchestrator long-run controls', () => {
  it('allows one toolless grace call after the iteration budget', async () => {
    const orch = new RunOrchestrator(skillManager, { maxIterations: 1 });
    const run = await orch.startRun({ provider: 'api', messages: [] });
    const state = orch.getRun(run);

    expect(orch._claimProviderCall(state)).toBe(true);
    expect(orch._claimProviderCall(state)).toBe(true);
    expect(state.resilience.wrapUp).toBe(true);
    expect(orch._getEffectiveToolChoice(state)).toBe('none');
    expect(orch._claimProviderCall(state)).toBe(false);
  });

  it('ignores duplicate public execution while a run is active', async () => {
    const orch = new RunOrchestrator(skillManager);
    let calls = 0;
    orch._executeOpenAI = async () => {
      calls += 1;
    };
    const runId = await orch.startRun({ provider: 'api', messages: [] });
    const first = orch.execute(runId, { messages: [{ role: 'user', content: 'Do this' }] });
    const second = orch.execute(runId, { messages: [{ role: 'user', content: 'Do this twice' }] });

    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  it('retries one transient provider failure with bounded recovery', async () => {
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('network connection reset');
      return streamResponse('Recovered answer.');
    };
    const events = [];
    const orch = new RunOrchestrator(skillManager, { maxProviderRetries: 1 });
    orch._emitEvent = (_runId, event) => events.push(event);

    try {
      const runId = await orch.startRun({
        provider: 'api',
        llmEndpoint: 'https://provider.example/v1/chat/completions',
        apiKey: 'test-key',
        modelName: 'gpt-4o',
        messages: [{ role: 'user', content: 'Answer' }],
      });
      await orch.execute(runId, {});
    } finally {
      global.fetch = originalFetch;
    }

    expect(calls).toBe(2);
    expect(events.find((event) => event.type === 'complete')?.content).toBe('Recovered answer.');
  });
});
