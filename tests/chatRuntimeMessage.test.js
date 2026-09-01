/**
 * @fileoverview Regression coverage for long-running execution acknowledgements.
 * @module chatRuntimeMessage
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../loadingManager.js', () => ({
  loadingManager: {
    showToast: vi.fn(),
  },
}));

const {
  startRun,
  executeRun,
  getRunAuth,
  refreshRunOwnerToken,
  setRunOwnerToken,
  clearRunOwnerToken,
} = await import('../src/chat/ChatAPI.js');
const { friendlyRuntimeErrorMessage } = await import('../src/utils/runtimeErrors.js');

describe('chat runtime execution bridge', () => {
  beforeEach(() => {
    clearRunOwnerToken('run-1');
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(),
      },
      storage: {
        session: {
          set: vi.fn(() => Promise.resolve()),
          remove: vi.fn(() => Promise.resolve()),
        },
      },
    };
  });

  it('keeps the run owner token after the background accepts execution', async () => {
    chrome.runtime.sendMessage
      .mockResolvedValueOnce({ runId: 'run-1', ownerToken: 'owner-1', sourceTabId: 7 })
      .mockResolvedValueOnce({ success: true, accepted: true });

    await startRun({ sourceTabId: 7 });
    await executeRun('run-1', [{ role: 'user', content: 'long task' }]);

    expect(getRunAuth('run-1', 7)).toEqual({ ownerToken: 'owner-1', sourceTabId: 7 });
  });

  it('adopts an owner token for a run recovered by a fresh panel', () => {
    expect(setRunOwnerToken('run-1', 'owner-reconnected')).toBe(true);
    expect(getRunAuth('run-1', 7)).toEqual({
      ownerToken: 'owner-reconnected',
      sourceTabId: 7,
    });
    expect(setRunOwnerToken('', 'owner-reconnected')).toBe(false);
    expect(setRunOwnerToken('run-2', '')).toBe(false);
  });

  it('refreshes a missing owner token before a live approval decision', async () => {
    chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      active: true,
      ownerToken: 'owner-recovered',
    });

    await expect(refreshRunOwnerToken('run-1')).resolves.toBe(true);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'getRunJournal',
      runId: 'run-1',
    });
    expect(getRunAuth('run-1', 7)).toEqual({
      ownerToken: 'owner-recovered',
      sourceTabId: 7,
    });
  });

  it('translates Chrome transient channel closures into a recoverable message', () => {
    expect(
      friendlyRuntimeErrorMessage(
        new Error(
          'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'
        )
      )
    ).toBe('The page connection was interrupted. Reload the tab and try again.');
  });
});
