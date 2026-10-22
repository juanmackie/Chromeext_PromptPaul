/**
 * @fileoverview Real-browser coverage for coalesced run-journal persistence.
 * A held session-storage read creates backpressure while live content and
 * reasoning events arrive; the latest terminal journal must remain recoverable.
 * @module runJournalBrowserSpec
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect, test } = require('@playwright/test');
const { launchTestBrowser, openHarness, removeUserDataDir } = require('./browserTestSupport.js');

test('coalesces a journal burst and persists the latest terminal event', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-journal-'));
  const { context } = await launchTestBrowser(userDataDir);

  try {
    const source = await openHarness(context);
    const extensionId = new URL(source.url()).hostname;
    const receiver = await context.newPage();
    await receiver.goto(`chrome-extension://${extensionId}/tests/browser/extension-harness.html`);
    await receiver.waitForFunction(() => window.pageActionHarness);
    await receiver.evaluate(() => {
      window.journalEvents = [];
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.action === 'orchestratorEvent' && message.runId === 'journal-burst-test') {
          window.journalEvents.push(message.event);
        }
      });
    });

    const emitted = await source.evaluate(async () => {
      const { default: RunOrchestrator } = await import(
        chrome.runtime.getURL('src/orchestrator/RunOrchestrator.js')
      );
      const storage = chrome.storage.session;
      const originalGet = storage.get.bind(storage);
      const originalSet = storage.set.bind(storage);
      const storageKey = RunOrchestrator.getRunJournalStorageKey();
      const existingJournal = {
        version: 1,
        runId: 'journal-existing-test',
        status: 'complete',
        updatedAt: 1,
        eventSequence: 1,
        objective: 'preserve this existing journal',
        events: [{ sequence: 1, timestamp: 1, type: 'complete', content: 'Existing result.' }],
        terminal: true,
      };
      await originalSet({ [storageKey]: { 'journal-existing-test': existingJournal } });

      let getCount = 0;
      let setCount = 0;
      let releaseFirstGet;
      let firstGetStarted;
      const firstGetEntered = new Promise((resolve) => {
        firstGetStarted = resolve;
      });
      const firstGetGate = new Promise((resolve) => {
        releaseFirstGet = resolve;
      });
      let held = false;
      storage.get = function (...args) {
        getCount += 1;
        if (!held) {
          held = true;
          firstGetStarted();
          return firstGetGate.then(() => originalGet(...args));
        }
        return originalGet(...args);
      };
      storage.set = function (...args) {
        setCount += 1;
        return originalSet(...args);
      };

      const orchestrator = new RunOrchestrator();
      const runId = 'journal-burst-test';
      orchestrator.activeRuns.set(runId, {
        id: runId,
        status: 'running',
        terminal: false,
        eventSequence: 0,
        eventJournal: [],
        startedAt: Date.now(),
        objective: 'Persist the latest completion after a live event burst.',
        resilience: null,
        pageActions: null,
      });

      orchestrator._emitEvent(runId, {
        type: 'tool_start',
        toolCall: { function: { name: 'probe' } },
      });
      await firstGetEntered;
      const burstCount = 240;
      for (let index = 0; index < burstCount; index += 1) {
        orchestrator._emitEvent(runId, {
          type: index % 2 === 0 ? 'content' : 'reasoning',
          data: `live chunk ${index}`,
        });
      }
      const fullContent = 'Recovered completion. '.repeat(500);
      orchestrator._emitEvent(runId, {
        type: 'complete',
        content: fullContent,
        completion: { finishReason: 'stop' },
      });
      releaseFirstGet();
      await orchestrator.journalWrite;

      const writes = { getCount, setCount, burstCount, fullContentLength: fullContent.length };
      storage.get = originalGet;
      storage.set = originalSet;
      return writes;
    });
    // The journal writer may need one follow-up read/modify/write pass after
    // the held first read. A burst must not turn into one storage pair per event.
    expect(emitted.getCount).toBeLessThanOrEqual(2);
    expect(emitted.setCount).toBeLessThanOrEqual(2);

    await receiver.waitForFunction(() => window.journalEvents.length === 3);
    const liveEvents = await receiver.evaluate(() => window.journalEvents);
    expect(liveEvents).toHaveLength(3);
    expect(liveEvents.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(liveEvents[0].type).toBe('tool_start');
    expect(liveEvents[1].type).toBe('stream_batch');
    expect(liveEvents[1].events.map((event) => event.data).join('')).toBe(
      Array.from({ length: emitted.burstCount }, (_, index) => `live chunk ${index}`).join('')
    );
    expect(liveEvents.at(-1)).toMatchObject({ type: 'complete', sequence: 3 });

    const runId = 'journal-burst-test';
    const journalResponse = await receiver.evaluate(
      (id) => window.pageActionHarness.getJournal(id),
      runId
    );
    expect(journalResponse.success).toBe(true);
    expect(journalResponse.active).toBe(false);
    expect(journalResponse.journal).toMatchObject({
      runId,
      status: 'complete',
      terminal: true,
      eventSequence: 3,
    });
    const terminalEvent = journalResponse.journal.events.at(-1);
    expect(terminalEvent).toMatchObject({
      type: 'complete',
      content: 'Recovered completion. '.repeat(500).slice(0, 8_000),
      contentTruncated: true,
      originalLength: emitted.fullContentLength,
      completion: { finishReason: 'stop' },
    });

    const stored = await receiver.evaluate(async () => {
      const { default: RunOrchestrator } = await import(
        chrome.runtime.getURL('src/orchestrator/RunOrchestrator.js')
      );
      const key = RunOrchestrator.getRunJournalStorageKey();
      return (await chrome.storage.session.get([key]))[key];
    });
    expect(stored['journal-existing-test']).toEqual({
      version: 1,
      runId: 'journal-existing-test',
      status: 'complete',
      updatedAt: 1,
      eventSequence: 1,
      objective: 'preserve this existing journal',
      events: [{ sequence: 1, timestamp: 1, type: 'complete', content: 'Existing result.' }],
      terminal: true,
    });
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});
