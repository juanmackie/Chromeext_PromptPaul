import { describe, expect, it } from 'vitest';
import {
  buildPageTaskMemoryPrompt,
  compactPageTaskHistory,
  normalizePageTaskNote,
  recordPageTaskNote,
} from '../src/orchestrator/PageTaskMemory.js';

describe('PageTaskMemory', () => {
  it('bounds and records notes without persisting secrets or unbounded text', () => {
    expect(normalizePageTaskNote({ text: '' }).valid).toBe(false);
    expect(normalizePageTaskNote({ text: 'Use the API key from the page' })).toMatchObject({
      valid: false,
    });
    const run = { pageActions: { notes: [] } };
    for (let index = 0; index < 40; index += 1) {
      recordPageTaskNote(run, `${index} ${'x'.repeat(900)}`, 7);
    }
    expect(run.pageActions.notes).toHaveLength(32);
    expect(run.pageActions.notes.at(-1).text.length).toBeLessThanOrEqual(800);
    expect(buildPageTaskMemoryPrompt(run.pageActions.notes)).toContain('TASK MEMORY');
  });

  it('compacts old snapshots while retaining the active tab snapshot', () => {
    const snapshot = (id, tabId) =>
      JSON.stringify({
        success: true,
        result: {
          tabId,
          snapshot: {
            snapshotId: id,
            url: `https://example.test/${id}`,
            title: 'Page',
            fingerprint: 'fingerprint',
            content: 'very large page body',
          },
        },
      });
    const messages = [
      { role: 'user', content: 'research' },
      { role: 'tool', tool_call_id: 'a', name: 'page_get_state', content: snapshot('old', 2) },
      { role: 'tool', tool_call_id: 'b', name: 'page_get_state', content: snapshot('new', 2) },
    ];
    const compacted = compactPageTaskHistory(messages, { activeTabId: 2 });
    expect(compacted[1].content).toContain('compacted');
    expect(compacted[2].content).toContain('very large page body');
  });

  it('minimizes oversized historical messages before provider calls', () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `${index} ${'x'.repeat(12_000)}`,
    }));
    const compacted = compactPageTaskHistory(messages);
    expect(JSON.stringify(compacted).length).toBeLessThan(180_000);
    expect(compacted[0].content).toContain('Older task context omitted');
  });
});
