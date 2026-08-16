import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCurrentPageSelection } from '../src/chat/ChatSelection.js';

afterEach(() => {
  delete globalThis.chrome;
});

describe('readCurrentPageSelection', () => {
  it('returns the first non-empty selection from the source tab frames', async () => {
    const executeScript = vi
      .fn()
      .mockResolvedValue([{ result: '' }, { result: '  Selected page text  ' }]);
    globalThis.chrome = { scripting: { executeScript } };

    await expect(readCurrentPageSelection(17)).resolves.toBe('Selected page text');
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 17, allFrames: true } })
    );
  });

  it('falls back to the active tab when the side panel has no source tab ID', async () => {
    globalThis.chrome = {
      tabs: { query: vi.fn((_query, resolve) => resolve([{ id: 23 }])) },
      scripting: { executeScript: vi.fn().mockResolvedValue([{ result: 'Live selection' }]) },
    };

    await expect(readCurrentPageSelection()).resolves.toBe('Live selection');
  });

  it('returns an empty selection when the page cannot be scripted', async () => {
    globalThis.chrome = {
      scripting: { executeScript: vi.fn().mockRejectedValue(new Error('Restricted page')) },
    };

    await expect(readCurrentPageSelection(17)).resolves.toBe('');
  });
});
