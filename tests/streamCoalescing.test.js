import { afterEach, describe, expect, it, vi } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';

describe('provider stream event coalescing', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.chrome;
  });

  it('bounds live event frequency and preserves stream ordering and text', async () => {
    vi.useFakeTimers();
    const sent = [];
    const session = { get: vi.fn(), set: vi.fn() };
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn(async (message) => sent.push(message.event)) },
      storage: { session },
    };
    const orchestrator = new RunOrchestrator({});
    const run = {
      id: 'coalesced-run',
      status: 'running',
      eventSequence: 0,
      eventJournal: [],
      startedAt: Date.now(),
      objective: 'stream a long result',
      terminal: false,
      resilience: null,
      pageActions: null,
    };
    orchestrator.activeRuns.set(run.id, run);

    for (let index = 0; index < 1_000; index += 1) {
      orchestrator._emitEvent(run.id, {
        type: index % 2 === 0 ? 'content' : 'reasoning',
        data: `${index},`,
      });
    }
    expect(sent).toHaveLength(0);
    expect(session.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('stream_batch');
    expect(sent[0].events.map((event) => event.data).join('')).toBe(
      Array.from({ length: 1_000 }, (_, index) => `${index},`).join('')
    );
    expect(sent[0].sequence).toBe(1);
    expect(run.eventJournal).toEqual([]);
    expect(session.set).not.toHaveBeenCalled();
  });

  it('flushes pending text before lifecycle and terminal events', async () => {
    vi.useFakeTimers();
    const sent = [];
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn(async (message) => sent.push(message.event)) },
      storage: {
        session: {
          get: vi.fn(async () => ({ promptPaulRunJournalsV1: {} })),
          set: vi.fn(async () => {}),
        },
      },
    };
    const orchestrator = new RunOrchestrator({});
    const run = {
      id: 'ordered-run',
      status: 'running',
      eventSequence: 0,
      eventJournal: [],
      startedAt: Date.now(),
      objective: 'preserve ordering',
      terminal: false,
      resilience: null,
      pageActions: null,
    };
    orchestrator.activeRuns.set(run.id, run);

    orchestrator._emitEvent(run.id, { type: 'content', data: 'answer' });
    orchestrator._emitEvent(run.id, {
      type: 'tool_start',
      toolCall: { function: { name: 'next' } },
    });
    orchestrator._terminateRun(run.id, { type: 'complete', content: 'answer' });
    await Promise.resolve();

    expect(sent.map((event) => event.type)).toEqual(['stream_batch', 'tool_start', 'complete']);
    expect(sent.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(run.eventJournal.map((event) => event.type)).toEqual(['tool_start', 'complete']);
    expect(orchestrator.streamEventBuffers.size).toBe(0);
  });

  it('flushes immediately at the bounded buffer size and drops expired runs', async () => {
    vi.useFakeTimers();
    const sent = [];
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn(async (message) => sent.push(message.event)) },
      storage: { session: { get: vi.fn(), set: vi.fn() } },
    };
    const orchestrator = new RunOrchestrator({});
    const run = {
      id: 'bounded-run',
      status: 'running',
      eventSequence: 0,
      eventJournal: [],
      startedAt: Date.now(),
      objective: 'bounded',
      terminal: false,
      resilience: null,
      pageActions: null,
    };
    orchestrator.activeRuns.set(run.id, run);
    orchestrator._emitEvent(run.id, { type: 'content', data: 'x'.repeat(8_000) });
    expect(sent).toHaveLength(1);
    orchestrator._emitEvent(run.id, { type: 'content', data: 'later' });
    orchestrator.activeRuns.delete(run.id);
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toHaveLength(1);
    expect(orchestrator.streamEventBuffers.size).toBe(0);
  });
});
