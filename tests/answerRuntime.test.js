import { describe, expect, it } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';
import {
  createAnswerCardDecoder,
  createAnswerCardProgressiveParser,
} from '../src/utils/answerSchema.js';

const answerCards = {
  version: 1,
  blocks: [{ type: 'summary', title: 'Summary', text: 'Main point', points: ['Fact'] }],
};
const fence = '```';
const answer = 'Readable answer with all useful facts.';
const structuredWire = `${answer}\n\n${fence}promptpaul-cards\n${JSON.stringify(answerCards)}\n${fence}`;

function makeRun() {
  return {
    id: 'answer-run',
    config: { answerFormat: 'cards' },
    accumulatedText: '',
    answerWireText: '',
    answerCardDecoder: createAnswerCardDecoder(),
    answerProgressParser: createAnswerCardProgressiveParser(),
    answerTurn: 1,
    progressiveAnswerBlocks: 0,
    answerCards: null,
    outputSafetyCheckLength: 0,
    conversationHistory: [],
    webSearch: { enabled: false, sources: [] },
    pageActions: null,
    resilience: {},
    status: 'streaming',
    completionReason: null,
    completionUsage: null,
    completionProvider: 'fixture',
    hasReasoning: false,
    recoverySucceeded: false,
    tokenLimitReached: false,
    objective: 'Summarize this',
  };
}

function makeHarness(run = makeRun()) {
  const orch = new RunOrchestrator({
    resolveSkill: () => null,
    getEligibleSnapshot: () => [],
    getSkillsList: () => [],
    hasSkill: () => false,
  });
  const emitted = [];
  let terminal = null;
  orch._emitEvent = (_runId, event) => emitted.push(event);
  orch._terminateRun = (_runId, event) => {
    terminal = event;
    run.status = event.type;
  };
  orch.activeRuns.set(run.id, run);
  return { orch, run, emitted, terminal: () => terminal };
}

describe('structured answer runtime boundary', () => {
  it.each(['openai', 'anthropic', 'codex'])(
    'hides incomplete structured sections while %s content streams',
    async (provider) => {
      const { orch, run, emitted } = makeHarness();
      const first = structuredWire.slice(0, structuredWire.indexOf(`${fence}promptpaul-cards`) + 8);
      const second = structuredWire.slice(first.length);
      if (provider === 'openai') {
        await orch._processOpenAIChunk(run, { choices: [{ delta: { content: first } }] });
        await orch._processOpenAIChunk(run, { choices: [{ delta: { content: second } }] });
      } else if (provider === 'anthropic') {
        await orch._processAnthropicEvent(run, {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: first },
        });
        await orch._processAnthropicEvent(run, {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: second },
        });
      } else {
        orch._processCodexEvent(run, { type: 'response.output_text.delta', delta: first });
        orch._processCodexEvent(run, { type: 'response.output_text.delta', delta: second });
      }
      expect(
        emitted
          .filter((event) => event.type === 'content')
          .map((event) => event.data)
          .join('')
      ).toBe(`${answer}\n\n`);
      expect(run.answerWireText).toBe(structuredWire);
      expect(emitted.filter((event) => event.type === 'answer_cards')).toHaveLength(1);
      expect(emitted.filter((event) => event.type === 'answer_cards').at(-1).answerCards).toEqual(
        answerCards
      );
    }
  );

  it('applies the same filter to Hermes streamed and recovered output', () => {
    const { orch, run, emitted } = makeHarness();
    orch._appendAnswerWire(run, `${answer}\n\n${fence}promptpaul-cards\n{"version":`);
    expect(run.accumulatedText).toBe(`${answer}\n\n`);
    orch._applyHermesRecoveredOutput(run, structuredWire);
    expect(run.answerWireText).toBe(structuredWire);
    expect(run.accumulatedText).toBe(`${answer}\n\n`);
    expect(
      emitted
        .filter((event) => event.type === 'content')
        .map((event) => event.data)
        .join('')
    ).toBe(`${answer}\n\n`);
  });

  it('keeps readable text after a misplaced card envelope in a tool-turn history entry', () => {
    const { orch, run } = makeHarness();
    const earlyEnvelope = `${answer}\n\n${fence}promptpaul-cards\n{"version":1}\n${fence}\nThe tool still needs to run.`;
    orch._appendAnswerWire(run, earlyEnvelope);
    orch._finishAnswerWireTurn(run);
    orch._normalizeAnswerWireForHistory(run);
    expect(run.accumulatedText).toBe(`${answer}\nThe tool still needs to run.`);
    expect(run.accumulatedText).not.toContain('promptpaul-cards');
  });

  it('normalizes before assistant history and sends cards only in the live completion event', async () => {
    const { orch, run, terminal } = makeHarness();
    run.answerWireText = structuredWire;
    run.accumulatedText = answer;
    run.answerCardDecoder.finish();
    await orch._finalizeTextResponse(run);

    expect(run.conversationHistory.at(-1)).toEqual({ role: 'assistant', content: answer });
    expect(terminal()).toMatchObject({ type: 'complete', content: answer, answerCards });
    expect(orch._journalEvent(terminal())).toMatchObject({ type: 'complete', content: answer });
    expect(orch._journalEvent(terminal())).not.toHaveProperty('answerCards');
  });

  it('emits monotonic prefix snapshots and clears them if terminal validation later fails', async () => {
    const { orch, run, emitted, terminal } = makeHarness();
    const firstBlock = answerCards.blocks[0];
    const prefix = `${answer}\n\n${fence}promptpaul-cards\n{"version":1,"blocks":[${JSON.stringify(firstBlock)}`;
    orch._appendAnswerWire(run, prefix);
    expect(emitted.filter((event) => event.type === 'answer_cards').at(-1)).toMatchObject({
      answerTurn: 1,
      answerCards: { version: 1, blocks: [firstBlock] },
    });
    orch._appendAnswerWire(run, ',{"type":"unknown","title":"ignored"}]}\n```');
    expect(emitted.filter((event) => event.type === 'answer_cards').at(-1)).toMatchObject({
      answerTurn: 1,
      answerCards: null,
      invalid: true,
    });
    await orch._finalizeTextResponse(run);
    expect(terminal()).not.toHaveProperty('answerCards');
    expect(terminal().content).toBe(answer);
  });

  it('streams validated cards after a separate reasoning phase', () => {
    const { orch, run, emitted } = makeHarness();
    run.hasReasoning = true;
    orch._appendAnswerWire(run, structuredWire);

    expect(run.accumulatedText).toBe(`${answer}\n\n`);
    expect(emitted.filter((event) => event.type === 'answer_cards').at(-1)).toMatchObject({
      answerTurn: 1,
      answerCards,
    });
  });

  it('advances answerTurn once per provider turn and invalidates the previous projection', () => {
    const { orch, run, emitted } = makeHarness();
    orch._appendAnswerWire(
      run,
      `${answer}\n\n${fence}promptpaul-cards\n{"version":1,"blocks":[${JSON.stringify(answerCards.blocks[0])}`
    );
    orch._resetAnswerWire(run);
    expect(run.answerTurn).toBe(2);
    expect(emitted.filter((event) => event.type === 'answer_cards').at(-1)).toMatchObject({
      answerTurn: 1,
      answerCards: null,
      invalid: true,
    });
  });

  it('invalidates progressive cards before an error terminal event', () => {
    const { orch, run, emitted } = makeHarness();
    orch._appendAnswerWire(
      run,
      `${answer}\n\n${fence}promptpaul-cards\n{"version":1,"blocks":[${JSON.stringify(answerCards.blocks[0])}`
    );
    expect(run.progressiveAnswerBlocks).toBe(1);
    RunOrchestrator.prototype._terminateRun.call(
      orch,
      run.id,
      { type: 'error', error: 'failed' },
      { run }
    );
    expect(emitted.filter((event) => event.type === 'answer_cards').at(-1)).toMatchObject({
      answerTurn: 1,
      answerCards: null,
      invalid: true,
    });
    expect(emitted.at(-1).type).toBe('error');
  });

  it('keeps the runtime Act incompletion notice after answer normalization', async () => {
    const { orch, run, terminal } = makeHarness();
    run.answerWireText = structuredWire;
    run.accumulatedText = answer;
    run.pageActions = {
      planner: { active: true, subGoals: [], completedAt: null },
      finalVerificationCompleted: true,
    };
    run.resilience.wrapUp = true;
    await orch._finalizeTextResponse(run);
    expect(terminal().content).toContain('⚠️ Act task incomplete');
    expect(terminal().answerCards).toEqual(answerCards);
  });

  it('does not retry payload-only output and preserves ordinary Hermes replacement semantics', () => {
    const { orch, run, emitted } = makeHarness();
    run.answerWireText = '{"version":1,"blocks":[]}';
    run.accumulatedText = '';
    run.resilience = { emptyStreak: 0 };
    expect(orch._shouldRecoverEmptyResponse(run)).toBe(false);

    run.config.answerFormat = null;
    run.answerCardDecoder = null;
    run.accumulatedText = 'old partial';
    orch._applyHermesRecoveredOutput(run, 'authoritative replacement');
    expect(run.accumulatedText).toBe('authoritative replacement');
    expect(emitted).toHaveLength(0);
  });

  it('retains the explicit run-limit fallback when a structured response has no readable answer', async () => {
    const { orch, run, terminal } = makeHarness();
    orch._appendAnswerWire(run, '{"version":1,"blocks":[]}');
    await orch._finishAtRunLimit(run);
    expect(terminal().content).toBe(
      'The task reached its run limit before a final answer was available. Retry to continue.'
    );
  });

  it('never completes with empty content for a no-prefix incomplete or oversized card frame', async () => {
    const fallback = 'The response did not include a readable answer.';
    const frames = [
      `${fence}promptpaul-card`,
      `${fence}promptpaul-cards\n{"version":1,"blocks":[`,
      `${fence}promptpaul-cards\n{"version":1,"blocks":[],"extra":"${'x'.repeat(33 * 1024)}"}\n${fence}`,
    ];
    for (const frame of frames) {
      const { orch, run, terminal } = makeHarness();
      orch._appendAnswerWire(run, frame);
      expect(orch._shouldRecoverEmptyResponse(run)).toBe(false);
      await orch._finalizeTextResponse(run);
      expect(terminal()).toMatchObject({ type: 'complete', content: fallback });
    }
  });

  it('journals readable content before the existing 8,000 character truncation and ignores stop data', async () => {
    const longAnswer = Array.from(
      { length: 600 },
      (_, index) => `Readable detail number ${index}.`
    ).join(' ');
    const wire = `${longAnswer}\n\n${fence}promptpaul-cards\n${JSON.stringify(answerCards)}\n${fence}`;
    const { orch, run, terminal } = makeHarness();
    orch._checkOutputSafety = () => {};
    run.answerWireText = wire;
    run.accumulatedText = longAnswer;
    await orch._finalizeTextResponse(run);
    expect(terminal().content).toBe(longAnswer);
    const journal = orch._journalEvent(terminal());
    expect(journal.content).toBe(longAnswer.slice(0, 8_000));
    expect(journal.contentTruncated).toBe(true);
    expect(journal).not.toHaveProperty('answerCards');
    expect(JSON.stringify(journal)).not.toContain('promptpaul-cards');
  });

  it('does not turn interrupted structured syntax into assistant history or terminal events', async () => {
    const { orch, run, emitted, terminal } = makeHarness();
    orch._appendAnswerWire(run, `${answer}\n\n${fence}promptpaul-cards\n{"version":1`);
    orch._finishAnswerWireTurn(run);
    expect(run.accumulatedText).toBe(`${answer}\n\n`);
    expect(emitted.map((event) => event.data || '').join('')).not.toContain('promptpaul-cards');
    expect(terminal()).toBeNull();
  });

  it('adds the format instruction only to the explicitly requested run', () => {
    const { orch, run } = makeHarness();
    expect(orch._buildSystemPrompt(run, [])).toContain('STRUCTURED ANSWER FORMAT');
    run.config.answerFormat = 'other';
    expect(orch._buildSystemPrompt(run, [])).not.toContain('STRUCTURED ANSWER FORMAT');
  });
});
