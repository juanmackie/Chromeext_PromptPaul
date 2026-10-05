import { describe, expect, it } from 'vitest';
import { serializePageActionResult } from '../src/utils/pageActionResult.js';
import { compactPageTaskHistory } from '../src/orchestrator/PageTaskMemory.js';

describe('compact Act results', () => {
  it('keeps one readable control list and receipts without modifying internal evidence', () => {
    const snapshot = {
      snapshotId: 'state-1',
      url: 'https://example.test/',
      title: 'Form',
      header: 'Untrusted page',
      content: '[0] input Name',
      readableContent: 'Contact form',
      elements: [{ index: 0, label: 'Name' }],
      regions: [{ id: 'region-0', indices: [0], elementCount: 1 }],
      fingerprint: 'abcd',
      metrics: { buildMs: 5 },
    };
    const original = {
      success: true,
      result: {
        snapshot,
        notice: 'Fresh indexes',
        actionReceipt: { disposition: 'delivered_verified' },
      },
    };
    const encoded = serializePageActionResult(original);
    const decoded = JSON.parse(encoded);
    expect(decoded.result.snapshot).toMatchObject({
      snapshotId: 'state-1',
      content: '[0] input Name',
      readableContent: 'Contact form',
    });
    expect(decoded.result.snapshot.elements).toBeUndefined();
    expect(decoded.result.snapshot.regions).toEqual([{ id: 'region-0', elementCount: 1 }]);
    expect(decoded.result.snapshot.fingerprint).toBeUndefined();
    expect(decoded.result.snapshot.metrics).toBeUndefined();
    expect(decoded.result.notice).toBe('Fresh indexes');
    expect(decoded.result.actionReceipt.disposition).toBe('delivered_verified');
    expect(snapshot.elements).toHaveLength(1);
    expect(encoded.length).toBeLessThan(JSON.stringify(original).length);
    const history = ['state-1', 'state-2'].map((snapshotId) => ({
      role: 'tool',
      name: 'page_get_state',
      content: serializePageActionResult({
        success: true,
        result: { snapshot: { ...snapshot, snapshotId } },
      }),
    }));
    const compacted = compactPageTaskHistory(history);
    expect(JSON.parse(compacted[0].content).result.snapshot.compacted).toBe(true);
    expect(JSON.parse(compacted[1].content).result.snapshot.content).toBe(snapshot.content);
  });
});
