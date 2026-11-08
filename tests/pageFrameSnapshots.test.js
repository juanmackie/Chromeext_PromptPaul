import { describe, expect, it, vi } from 'vitest';
import { createPageFrameSnapshots } from '../src/act/PageFrameSnapshots.js';
import { createPageFrameCoordinator } from '../src/act/PageFrameCoordinator.js';

const snapshot = (snapshotId, elements, content, extras = {}) => ({
  snapshotId,
  elements,
  content,
  regions: [],
  ...extras,
});

const element = (index, value = '') => ({
  index,
  elementKey: `local:${index}`,
  value,
  label: `control ${index}`,
});

describe('page frame snapshots', () => {
  it('merges frame indices and remaps outline markers, regions, and routes', () => {
    const frames = createPageFrameSnapshots();
    const merged = frames.merge('run-1', [
      {
        frameId: 0,
        origin: 'https://main.example',
        isTop: true,
        snapshot: snapshot('main-snapshot', [element(2), element(8)], '[2] <button>\n[8] <input>', {
          regions: [{ name: 'main', indices: [2, 8, 99] }],
        }),
      },
      {
        frameId: 7,
        origin: 'https://child.example',
        isTop: false,
        snapshot: snapshot('child-snapshot', [element(4)], '[4] <button>'),
      },
    ]);

    expect(merged.elements.map(({ index }) => index)).toEqual([0, 1, 2]);
    expect(merged.content).toContain('[0] <button>\n[1] <input>');
    expect(merged.content).toContain('[2] <button>');
    expect(merged.regions).toEqual([{ name: 'main', indices: [0, 1] }]);
    expect(frames.resolveRoute('run-1', { snapshotId: merged.snapshotId, index: 2 })).toEqual({
      isCurrentSnapshot: true,
      route: {
        frameId: 7,
        snapshotId: 'child-snapshot',
        index: 4,
        elementKey: 'local:4',
      },
    });
  });

  it('remaps find-text indices and binds focused targets to their frame', () => {
    const frames = createPageFrameSnapshots();
    const merged = frames.merge('run-2', [
      {
        frameId: 0,
        origin: 'https://main.example',
        isTop: true,
        snapshot: snapshot('top', [element(5)], '[5] <button>'),
      },
      {
        frameId: 3,
        origin: 'https://child.example',
        isTop: false,
        snapshot: snapshot('child', [element(1)], '[1] <input>', {
          focusedElement: { index: 1, elementKey: 'child:focus' },
        }),
      },
    ]);

    expect(
      frames.resolveRoute('run-2', { snapshotId: merged.snapshotId, focused: true }).route
    ).toMatchObject({ frameId: 3, snapshotId: 'child', index: 1 });
    expect(
      frames.mapFindTextIndices('run-2', {
        snapshotId: 'top',
        elementIndices: [5, 100],
        message: 'Matching control indices: 5, 100',
      })
    ).toEqual({
      elementIndices: [0],
      message: 'Matching control indices: 0',
      snapshotId: merged.snapshotId,
    });
    expect(frames.mapFindTextIndices('run-2', { snapshotId: 'child' }).snapshotId).toBe(
      merged.snapshotId
    );
  });

  it('keeps merged values and outline within the canonical Act caps', () => {
    const frames = createPageFrameSnapshots();
    const oversized = 'x'.repeat(14_000);
    const merged = frames.merge('run-3', [
      {
        frameId: 0,
        origin: 'https://main.example',
        isTop: true,
        snapshot: snapshot('top', [element(0, oversized), element(1, oversized)], oversized),
      },
      {
        frameId: 1,
        origin: 'https://child.example',
        isTop: false,
        snapshot: snapshot('child', [element(0, oversized)], oversized),
      },
    ]);

    expect(merged.elements.reduce((total, item) => total + item.value.length, 0)).toBe(8_000);
    expect(merged.content.length).toBeLessThanOrEqual(24_000);
    expect(merged.truncated).toBe(true);
  });

  it('clears routes at run teardown and rejects stale snapshot identities', () => {
    const frames = createPageFrameSnapshots();
    const merged = frames.merge('run-4', [
      {
        frameId: 0,
        origin: 'https://main.example',
        isTop: true,
        snapshot: snapshot('top', [element(0)], '[0] <button>'),
      },
    ]);

    expect(frames.resolveRoute('run-4', { snapshotId: 'old', index: 0 })).toEqual({
      isCurrentSnapshot: false,
      route: null,
    });
    expect(frames.deleteRun('run-4')).toBe(true);
    expect(frames.resolveRoute('run-4', { snapshotId: merged.snapshotId, index: 0 })).toEqual({
      isCurrentSnapshot: false,
      route: null,
    });
  });

  it('collects only allowed frames and records omitted unsafe frames', async () => {
    const sendPageActionMessage = vi.fn(async (_tabId, _message, _signal, _timeout, frameId) => ({
      snapshot: snapshot(`frame-${frameId}`, [element(0)], `[0] <button>`, {
        url: 'https://child.example/path',
      }),
    }));
    const coordinator = createPageFrameCoordinator({
      chrome: {
        scripting: {
          executeScript: async () => [
            { frameId: 0, result: { origin: 'https://main.example' } },
            { frameId: 4, result: { origin: 'https://child.example' } },
            { frameId: 7, result: { origin: 'https://pay.example', title: 'Checkout payment' } },
          ],
        },
      },
      getCurrentPageSupport: () => ({ available: true }),
      getPageActionSiteOrigin: (url) => new URL(url).origin,
      sendPageActionMessage,
      injectPageActionFrameScriptsInFrames: async () => new Set(),
      messageTimeoutMs: 100,
    });
    const topResponse = {
      snapshot: snapshot('top', [element(5)], '[5] <button>', { url: 'https://main.example/' }),
    };

    const merged = await coordinator.collectSnapshots({
      tabId: 1,
      runId: 'run-5',
      blockedOrigins: [],
      topResponse,
    });

    expect(merged.elements).toHaveLength(2);
    expect(merged.content).toContain('1 embedded frame omitted by safety policy.');
    expect(sendPageActionMessage).toHaveBeenCalledTimes(1);
    expect(sendPageActionMessage.mock.calls[0][4]).toBe(4);
    expect(
      coordinator.resolveRoute('run-5', { snapshotId: merged.snapshotId, index: 1 }).route
    ).toMatchObject({ frameId: 4, snapshotId: 'frame-4' });
  });
});
