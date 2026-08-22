/**
 * @fileoverview Measurements for bounded indexed page scopes and state diffs.
 * @module pageActionScopeDiff
 */

import { describe, expect, it } from 'vitest';
import {
  PAGE_SCOPE_DIFF_CAPS,
  buildIndexedPageRegions,
  diffPageActionSnapshots,
  measurePageActionScopeDiff,
} from '../src/utils/pageActionScopeDiff.js';

function snapshot(elements, fingerprint = 'a') {
  return {
    snapshotId: `snapshot-${fingerprint}`,
    fingerprint,
    elements,
  };
}

describe('pageActionScopeDiff', () => {
  it('creates bounded indexed regions without selectors', () => {
    const regions = buildIndexedPageRegions(
      snapshot(
        Array.from({ length: 60 }, (_, index) => ({
          index,
          tag: 'button',
          label: `Control ${index}`,
          region: index < 4 ? 'toolbar' : 'content',
        }))
      ),
      { maxRegions: 2, maxElementsPerRegion: 3 }
    );

    expect(regions).toHaveLength(2);
    expect(regions.every((region) => region.indices.length <= 3)).toBe(true);
    expect(JSON.stringify(regions)).not.toContain('selector');
    expect(JSON.stringify(regions)).not.toContain('querySelector');
    expect(JSON.stringify(regions)).not.toContain('toolbar');
    expect(JSON.stringify(regions)).not.toContain('Control');
  });

  it('returns bounded changed indices and masks sensitive values', () => {
    const before = snapshot([
      { index: 0, tag: 'input', label: 'Name', valuePresent: false },
      { index: 1, tag: 'input', label: 'Password', sensitive: true, valuePresent: false },
    ]);
    const after = snapshot(
      [
        { index: 0, tag: 'input', label: 'Name', valuePresent: true },
        { index: 1, tag: 'input', label: 'Password', sensitive: true, valuePresent: true },
        { index: 2, tag: 'button', label: 'Continue' },
      ],
      'b'
    );
    const diff = diffPageActionSnapshots(before, after, { maxChanges: 2 });

    expect(diff).toMatchObject({
      beforeSnapshotId: 'snapshot-a',
      afterSnapshotId: 'snapshot-b',
      requiresFreshSnapshot: true,
      fingerprintChanged: true,
      changedCount: 3,
      truncated: true,
    });
    expect(diff.changes).toHaveLength(2);
    expect(diff.changes.find((change) => change.index === 1)?.sensitive).toBe(true);
    expect(JSON.stringify(diff)).not.toContain('Password');
    expect(JSON.stringify(diff)).not.toContain('valuePresent');
  });

  it('measures full, region, and diff payloads within configured caps', () => {
    const page = snapshot(
      Array.from({ length: PAGE_SCOPE_DIFF_CAPS.maxElementsPerRegion * 2 }, (_, index) => ({
        index,
        tag: 'button',
        label: `Control ${index}`,
      }))
    );
    const diff = diffPageActionSnapshots(page, { ...page, fingerprint: 'b' });
    const metrics = measurePageActionScopeDiff(page, diff);

    expect(metrics.fullSnapshotBytes).toBeGreaterThan(metrics.regionBytes);
    expect(metrics.diffBytes).toBeGreaterThan(0);
    expect(Number.isSafeInteger(metrics.fullSnapshotBytes)).toBe(true);
  });
});
