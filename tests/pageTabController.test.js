import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageTabController } from '../src/orchestrator/PageTabController.js';

describe('PageTabController', () => {
  let tabs;
  let controller;

  beforeEach(() => {
    tabs = new Map([
      [1, { id: 1, title: 'Source', url: 'https://example.com/start?secret=1', active: true }],
    ]);
    let nextTabId = 2;
    globalThis.chrome = {
      tabs: {
        get: vi.fn(async (tabId) => {
          const tab = tabs.get(tabId);
          if (!tab) throw new Error('missing tab');
          return tab;
        }),
        create: vi.fn(async ({ url, active }) => {
          const tab = { id: nextTabId++, title: 'Opened', url, active };
          tabs.set(tab.id, tab);
          return tab;
        }),
        remove: vi.fn(async (tabId) => tabs.delete(tabId)),
      },
    };
    controller = new PageTabController();
    controller.registerRun('run-1', 1);
  });

  it('lists bounded metadata and owns only registered tabs', async () => {
    const result = await controller.execute('run-1', 'page_list_tabs');
    expect(result.tabs).toEqual([
      { tabId: 1, title: 'Source', url: 'https://example.com/start', active: true },
    ]);
  });

  it('opens, switches, and closes only owned non-source tabs', async () => {
    const opened = await controller.execute('run-1', 'page_open_tab', {
      url: 'https://other.example/path',
      background: true,
    });
    expect(opened.openedTabId).toBe(2);
    expect(opened.targetTabId).toBe(1);
    await controller.execute('run-1', 'page_switch_tab', { tabId: 1 });
    await expect(controller.execute('run-1', 'page_close_tab', { tabId: 1 })).rejects.toMatchObject(
      { code: 'PAGE_TAB_SOURCE_CLOSE_BLOCKED' }
    );
    await controller.execute('run-1', 'page_close_tab', { tabId: 2 });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(2);
  });

  it('waits for a new tab bridge before reporting it ready', async () => {
    const readiness = vi.fn(async () => undefined);
    const readyController = new PageTabController({ ensureTabReady: readiness });
    readyController.registerRun('run-ready', 1);
    const opened = await readyController.execute('run-ready', 'page_open_tab', {
      url: 'https://other.example/path',
    });
    expect(readiness).toHaveBeenCalledWith(2, undefined);
    expect(opened).toMatchObject({ openedTabId: 2, targetTabId: 2, ready: true });
  });

  it('reuses an owned tab for the same destination instead of duplicating it', async () => {
    const first = await controller.execute('run-1', 'page_open_tab', {
      url: 'https://mail.example/inbox?filter=goodreads',
      background: true,
    });
    expect(first.reused).toBeUndefined();
    const second = await controller.execute('run-1', 'page_open_tab', {
      url: 'https://mail.example/inbox?filter=newest',
    });
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({
      openedTabId: 2,
      targetTabId: 2,
      ready: true,
      reused: true,
    });
    expect(controller.getOwnedTabIds('run-1')).toEqual([1, 2]);
  });

  it('reuses the source tab when the destination matches its current page', async () => {
    const reused = await controller.execute('run-1', 'page_open_tab', {
      url: 'https://example.com/start#section',
    });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(reused).toMatchObject({ openedTabId: 1, targetTabId: 1, reused: true });
  });

  it('opens a new tab when the destination path differs', async () => {
    await controller.execute('run-1', 'page_open_tab', {
      url: 'https://mail.example/inbox',
      background: true,
    });
    const other = await controller.execute('run-1', 'page_open_tab', {
      url: 'https://mail.example/message/1',
      background: true,
    });
    expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
    expect(other.reused).toBeUndefined();
    expect(other.openedTabId).toBe(3);
  });

  it('keeps the ready/tabError contract when a reused tab fails readiness', async () => {
    const failing = new PageTabController({
      ensureTabReady: vi.fn(async (tabId) => {
        const error = new Error('bridge not ready');
        error.code = 'PAGE_ACTION_TIMEOUT';
        throw error;
      }),
    });
    failing.registerRun('run-2', 1);
    await failing.execute('run-2', 'page_open_tab', {
      url: 'https://mail.example/inbox',
      background: true,
    });
    const reused = await failing.execute('run-2', 'page_open_tab', {
      url: 'https://mail.example/inbox?label=books',
    });
    expect(reused).toMatchObject({
      openedTabId: 2,
      targetTabId: 2,
      ready: false,
      reused: true,
      tabError: { code: 'PAGE_ACTION_TIMEOUT', message: 'bridge not ready' },
    });
  });

  it('returns owned tab IDs for run cleanup', async () => {
    await controller.execute('run-1', 'page_open_tab', {
      url: 'https://other.example/path',
      background: true,
    });

    expect(controller.getOwnedTabIds('run-1')).toEqual([1, 2]);
    controller.disposeRun('run-1');
    expect(controller.getOwnedTabIds('run-1')).toEqual([]);
  });

  it('quarantines a failed tab and selects another owned tab', async () => {
    await controller.execute('run-1', 'page_open_tab', {
      url: 'https://other.example/path',
      background: true,
    });
    const recovery = controller.quarantine('run-1', 1, { code: 'PAGE_ACTION_TIMEOUT' });
    expect(recovery).toMatchObject({ tabId: 1, nextTargetTabId: 2, available: true });
    expect(controller.getTargetTabId('run-1')).toBe(2);
    expect(controller.getTabStatus('run-1', 1)).toMatchObject({
      status: 'unavailable',
      code: 'PAGE_ACTION_TIMEOUT',
    });
  });
});
