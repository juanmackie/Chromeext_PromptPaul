/**
 * @fileoverview Run-liveness decisions for stranded-response recovery.
 * @module chatRunRecovery.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectRunLiveness } from '../src/chat/ChatRunRecovery.js';

function stubChrome({ response, sendError } = {}) {
  const sendMessage = vi.fn(async () => {
    if (sendError) throw sendError;
    return response;
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  return { sendMessage };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('inspectRunLiveness', () => {
  it('returns unknown without a run id or extension runtime', async () => {
    expect(await inspectRunLiveness('')).toEqual({ state: 'unknown', journal: null });
    expect(await inspectRunLiveness(null)).toEqual({ state: 'unknown', journal: null });
  });

  it('returns active while the background still owns the run', async () => {
    const journal = { runId: 'run-1', events: [] };
    stubChrome({ response: { success: true, active: true, journal } });

    expect(await inspectRunLiveness('run-1')).toEqual({ state: 'active', journal });
  });

  it('returns inactive with the persisted journal after a worker restart', async () => {
    const journal = { runId: 'run-1', terminal: true, events: [{ type: 'complete' }] };
    stubChrome({ response: { success: true, active: false, journal } });

    expect(await inspectRunLiveness('run-1')).toEqual({ state: 'inactive', journal });
  });

  it('asks about the exact run id, never just the session pointer', async () => {
    const { sendMessage } = stubChrome({
      response: { success: true, active: false, journal: null },
    });

    expect(await inspectRunLiveness('older-run')).toEqual({ state: 'inactive', journal: null });
    expect(sendMessage).toHaveBeenCalledWith({ action: 'getRunJournal', runId: 'older-run' });
  });

  it('never clears state when messaging cannot answer', async () => {
    stubChrome({ sendError: new Error('worker unavailable') });
    expect(await inspectRunLiveness('run-1')).toEqual({ state: 'unknown', journal: null });

    stubChrome({ response: { success: false, error: 'not an extension page' } });
    expect(await inspectRunLiveness('run-1')).toEqual({ state: 'unknown', journal: null });
  });
});
