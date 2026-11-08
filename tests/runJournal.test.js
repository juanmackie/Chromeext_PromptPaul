import { afterEach, describe, expect, it, vi } from 'vitest';
import RunOrchestrator from '../src/orchestrator/RunOrchestrator.js';
import { RUN_JOURNAL_CAPS } from '../src/orchestrator/RunJournal.js';

const RUN_JOURNAL_STORAGE_KEY = 'promptPaulRunJournalsV1';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createStorageMock() {
  const storageData = {};
  const session = {
    get: vi.fn(async (keys) => {
      const key = Array.isArray(keys) ? keys[0] : keys;
      return { [key]: structuredClone(storageData[key] || {}) };
    }),
    set: vi.fn(async (value) => Object.assign(storageData, structuredClone(value))),
  };
  return { storageData, session };
}

function journalReadCount(session) {
  return session.get.mock.calls.filter(([keys]) =>
    (Array.isArray(keys) ? keys : [keys]).includes(RUN_JOURNAL_STORAGE_KEY)
  ).length;
}

function journalWriteCount(session) {
  return session.set.mock.calls.filter(([value]) => Object.hasOwn(value, RUN_JOURNAL_STORAGE_KEY))
    .length;
}

function createRun(id) {
  return {
    id,
    status: 'running',
    objective: 'Explain the page.',
    startedAt: 1,
    eventSequence: 0,
    journalUpdatedAt: 0,
    eventJournal: [],
    resilience: null,
    pageActions: null,
    terminal: false,
  };
}

describe('run journal persistence', () => {
  afterEach(() => {
    delete globalThis.chrome;
  });

  it('coalesces a synchronous lifecycle-event burst into one storage batch', async () => {
    const { storageData, session } = createStorageMock();
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn(async () => {}) },
      storage: { session },
    };
    const orch = new RunOrchestrator({});
    const run = createRun('burst-run');
    orch.activeRuns.set(run.id, run);

    for (let index = 0; index < 20; index += 1) {
      orch._emitEvent(run.id, {
        type: 'tool_start',
        toolCall: { function: { name: `tool-${index}` } },
      });
    }
    await orch.runJournal.writePromise;

    expect(journalReadCount(session)).toBe(1);
    expect(journalWriteCount(session)).toBe(1);
    expect(storageData[RUN_JOURNAL_STORAGE_KEY][run.id].eventSequence).toBe(20);
  });

  it('coalesces stream events while storage is blocked and persists the terminal snapshot', async () => {
    const firstGet = deferred();
    const { storageData, session } = createStorageMock();
    session.get.mockImplementationOnce(async () => {
      await firstGet.promise;
      return {
        [RUN_JOURNAL_STORAGE_KEY]: structuredClone(storageData[RUN_JOURNAL_STORAGE_KEY] || {}),
      };
    });
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn(async () => {}) },
      storage: { session },
    };

    const orch = new RunOrchestrator({});
    const run = createRun('streamed-run');
    orch.activeRuns.set(run.id, run);

    orch._emitEvent(run.id, { type: 'tool_start', toolCall: { function: { name: 'probe' } } });
    await vi.waitFor(() => expect(journalReadCount(session)).toBe(1));
    for (let index = 0; index < 250; index += 1) {
      orch._emitEvent(run.id, { type: index % 2 ? 'content' : 'reasoning', data: 'x' });
    }
    orch._terminateRun(run.id, { type: 'complete', content: 'Finished.' });

    firstGet.resolve();
    await orch.runJournal.writePromise;

    expect(journalReadCount(session)).toBeLessThanOrEqual(2);
    expect(journalWriteCount(session)).toBeLessThanOrEqual(2);
    const journal = storageData[RUN_JOURNAL_STORAGE_KEY][run.id];
    expect(journal).toMatchObject({ status: 'complete', terminal: true });
    expect(journal.eventSequence).toBe(run.eventSequence);
    expect(journal.events.at(-1)).toMatchObject({ type: 'complete' });
  });

  it('coalesces events that arrive while storage is writing', async () => {
    const firstSet = deferred();
    const { storageData, session } = createStorageMock();
    session.set.mockImplementationOnce(async (value) => {
      await firstSet.promise;
      Object.assign(storageData, structuredClone(value));
    });
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn(async () => {}) },
      storage: { session },
    };

    const orch = new RunOrchestrator({});
    const run = createRun('set-burst-run');
    orch.activeRuns.set(run.id, run);
    orch._emitEvent(run.id, { type: 'tool_start', toolCall: { function: { name: 'probe' } } });
    await vi.waitFor(() => expect(journalWriteCount(session)).toBe(1));
    for (let index = 0; index < 250; index += 1) {
      orch._emitEvent(run.id, { type: index % 2 ? 'content' : 'reasoning', data: 'x' });
    }
    orch._terminateRun(run.id, { type: 'complete', content: 'Finished.' });

    firstSet.resolve();
    await orch.runJournal.writePromise;

    expect(journalReadCount(session)).toBeLessThanOrEqual(2);
    expect(journalWriteCount(session)).toBeLessThanOrEqual(2);
    expect(storageData[RUN_JOURNAL_STORAGE_KEY][run.id]).toMatchObject({
      status: 'complete',
      terminal: true,
      eventSequence: run.eventSequence,
    });
  });

  it('flushes a snapshot emitted in the microtask after a write completes', async () => {
    const firstSet = deferred();
    const { storageData, session } = createStorageMock();
    session.set.mockImplementationOnce(async (value) => {
      await firstSet.promise;
      Object.assign(storageData, structuredClone(value));
    });
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn(async () => {}) },
      storage: { session },
    };

    const orch = new RunOrchestrator({});
    const run = createRun('microtask-run');
    orch.activeRuns.set(run.id, run);
    orch._emitEvent(run.id, { type: 'tool_start', toolCall: { function: { name: 'probe' } } });
    await vi.waitFor(() => expect(journalWriteCount(session)).toBe(1));

    firstSet.resolve();
    await new Promise((resolve) => {
      queueMicrotask(() => {
        orch._emitEvent(run.id, { type: 'tool_ready', toolCall: { function: { name: 'probe' } } });
        resolve();
      });
    });
    await orch.runJournal.writePromise;

    expect(storageData[RUN_JOURNAL_STORAGE_KEY][run.id].eventSequence).toBe(run.eventSequence);
    expect(journalReadCount(session)).toBe(2);
  });

  it('preserves existing and concurrent run journals in a storage batch', async () => {
    const { storageData, session } = createStorageMock();
    storageData[RUN_JOURNAL_STORAGE_KEY] = {
      existing: { runId: 'existing', status: 'complete', updatedAt: Date.now() },
    };
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn(async () => {}) },
      storage: { session },
    };

    const orch = new RunOrchestrator({});
    const first = createRun('first-run');
    const second = createRun('second-run');
    orch.activeRuns.set(first.id, first);
    orch.activeRuns.set(second.id, second);
    orch._emitEvent(first.id, { type: 'content', data: 'private first text' });
    orch._emitEvent(second.id, { type: 'content', data: 'private second text' });
    orch._terminateRun(first.id, { type: 'complete', content: 'First answer.' });
    orch._terminateRun(second.id, { type: 'complete', content: 'Second answer.' });
    await orch.runJournal.writePromise;

    const journals = storageData[RUN_JOURNAL_STORAGE_KEY];
    expect(journals.existing.runId).toBe('existing');
    expect(journals[first.id]).toMatchObject({ status: 'complete', terminal: true });
    expect(journals[second.id]).toMatchObject({ status: 'complete', terminal: true });
    expect(JSON.stringify(journals)).not.toContain('private first text');
    expect(JSON.stringify(journals)).not.toContain('private second text');
  });

  it('bounds pending snapshots during a sustained storage failure', async () => {
    const { session } = createStorageMock();
    session.get.mockRejectedValue(new Error('storage unavailable'));
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn(async () => {}) },
      storage: { session },
    };

    const orch = new RunOrchestrator({});
    for (let index = 0; index < 30; index += 1) {
      const run = createRun(`pending-run-${index}`);
      orch.activeRuns.set(run.id, run);
      orch._emitEvent(run.id, { type: 'tool_start', toolCall: { function: { name: 'probe' } } });
    }
    await orch.runJournal.writePromise;

    expect(orch.runJournal.pendingSnapshots.size).toBeLessThanOrEqual(RUN_JOURNAL_CAPS.maxRuns);
    expect([...orch.runJournal.pendingSnapshots.keys()]).toContain('pending-run-29');
    expect(
      [...orch.runJournal.pendingSnapshots.values()].every(
        (snapshot) =>
          snapshot.runId && !('config' in snapshot) && !('conversationHistory' in snapshot)
      )
    ).toBe(true);
  });

  it.each(['get', 'set'])(
    'preserves events arriving during a failed %s and retries on a later event',
    async (method) => {
      const blockedOperation = deferred();
      const { storageData, session } = createStorageMock();
      session[method].mockImplementationOnce(async () => {
        await blockedOperation.promise;
        throw new Error('storage unavailable');
      });
      globalThis.chrome = {
        runtime: { sendMessage: vi.fn(async () => {}) },
        storage: { session },
      };

      const orch = new RunOrchestrator({});
      const run = createRun(`${method}-failure-run`);
      orch.activeRuns.set(run.id, run);
      orch._emitEvent(run.id, { type: 'tool_start', toolCall: { function: { name: 'probe' } } });
      await vi.waitFor(() => {
        expect(method === 'get' ? journalReadCount(session) : journalWriteCount(session)).toBe(1);
      });
      orch._terminateRun(run.id, { type: 'complete', content: 'Recovered.' });
      blockedOperation.reject(new Error('storage unavailable'));
      await orch.runJournal.writePromise;

      expect(storageData[RUN_JOURNAL_STORAGE_KEY][run.id]).toMatchObject({
        status: 'complete',
        terminal: true,
      });
      expect(
        method === 'get' ? journalReadCount(session) : journalWriteCount(session)
      ).toBeLessThanOrEqual(2);
    }
  );

  it.each(['get', 'set'])(
    'does not loop on an unchanged %s failure and recovers on a later event',
    async (method) => {
      const { storageData, session } = createStorageMock();
      session[method].mockRejectedValueOnce(new Error('storage unavailable'));
      globalThis.chrome = {
        runtime: { sendMessage: vi.fn(async () => {}) },
        storage: { session },
      };

      const orch = new RunOrchestrator({});
      const run = createRun(`${method}-later-retry-run`);
      orch.activeRuns.set(run.id, run);
      orch._emitEvent(run.id, { type: 'tool_start', toolCall: { function: { name: 'probe' } } });
      await orch.runJournal.writePromise;
      expect(method === 'get' ? journalReadCount(session) : journalWriteCount(session)).toBe(1);

      orch._terminateRun(run.id, { type: 'complete', content: 'Recovered later.' });
      await orch.runJournal.writePromise;

      expect(
        method === 'get' ? journalReadCount(session) : journalWriteCount(session)
      ).toBeLessThanOrEqual(2);
      expect(storageData[RUN_JOURNAL_STORAGE_KEY][run.id]).toMatchObject({
        status: 'complete',
        terminal: true,
      });
    }
  );

  it('does not require browser storage and keeps the event and answer caps', async () => {
    delete globalThis.chrome;
    const orch = new RunOrchestrator({});
    const run = createRun('bounded-run');
    orch.activeRuns.set(run.id, run);
    expect(() => orch._persistRunJournal(run)).not.toThrow();

    const { storageData, session } = createStorageMock();
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn(async () => {}) },
      storage: { session },
    };
    const boundedOrch = new RunOrchestrator({});
    const boundedRun = createRun('bounded-run-with-storage');
    boundedOrch.activeRuns.set(boundedRun.id, boundedRun);
    for (let index = 0; index < 140; index += 1) {
      boundedOrch._emitEvent(boundedRun.id, {
        type: 'content',
        data: `private stream value ${index}`,
      });
    }
    boundedOrch._terminateRun(boundedRun.id, { type: 'complete', content: 'x'.repeat(10_000) });
    await boundedOrch.runJournal.writePromise;

    const journal = storageData[RUN_JOURNAL_STORAGE_KEY][boundedRun.id];
    expect(journal.events).toHaveLength(1);
    expect(journal.events.at(-1).type).toBe('complete');
    expect(journal.events.at(-1).content).toHaveLength(8_000);
    expect(JSON.stringify(journal)).not.toContain('private stream value');
  });
});
