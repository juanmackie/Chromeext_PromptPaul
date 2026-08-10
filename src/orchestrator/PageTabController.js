/**
 * @fileoverview Owned-tab registry for explicitly enabled page-action runs.
 * @module PageTabController
 */

import { sanitizePageActionUrl } from '../utils/pageDom.js';

const MAX_OWNED_TABS = 8;

/**
 * Keep tab metadata small and free of query strings or fragments.
 * @param {object|null} tab
 * @returns {object|null}
 */
function safeTab(tab) {
  if (!tab?.id) return null;
  return {
    tabId: tab.id,
    title: String(tab.title || '').slice(0, 160),
    url: sanitizePageActionUrl(tab.url || ''),
    active: Boolean(tab.active),
  };
}

export class PageTabController {
  constructor() {
    this.runs = new Map();
  }

  registerRun(runId, sourceTabId) {
    this.runs.set(String(runId), {
      sourceTabId: Number(sourceTabId),
      targetTabId: Number(sourceTabId),
      ownedTabIds: new Set([Number(sourceTabId)]),
    });
  }

  disposeRun(runId) {
    this.runs.delete(String(runId));
  }

  _get(runId) {
    const state = this.runs.get(String(runId));
    if (!state) {
      const error = new Error('The multi-tab page-action run is no longer active.');
      error.code = 'PAGE_TAB_RUN_NOT_FOUND';
      throw error;
    }
    return state;
  }

  _assertOwned(state, tabId) {
    if (!state.ownedTabIds.has(Number(tabId))) {
      const error = new Error('The requested tab is not owned by this run.');
      error.code = 'PAGE_TAB_NOT_OWNED';
      throw error;
    }
  }

  async execute(runId, actionName, args = {}) {
    const state = this._get(runId);
    if (actionName === 'page_list_tabs') {
      const tabs = [];
      for (const tabId of state.ownedTabIds) {
        try {
          const tab = await chrome.tabs.get(tabId);
          const metadata = safeTab(tab);
          if (metadata) tabs.push(metadata);
        } catch (_) {
          state.ownedTabIds.delete(tabId);
        }
      }
      return { tabs, targetTabId: state.targetTabId };
    }

    if (actionName === 'page_open_tab') {
      if (state.ownedTabIds.size >= MAX_OWNED_TABS) {
        const error = new Error(`A run may own at most ${MAX_OWNED_TABS} tabs.`);
        error.code = 'PAGE_TAB_LIMIT';
        throw error;
      }
      const tab = await chrome.tabs.create({ url: args.url, active: args.background !== true });
      if (!tab?.id) throw new Error('The browser did not return the new tab id.');
      state.ownedTabIds.add(tab.id);
      state.targetTabId = tab.id;
      return { tab: safeTab(tab), targetTabId: tab.id };
    }

    this._assertOwned(state, args.tabId);
    if (actionName === 'page_switch_tab') {
      state.targetTabId = Number(args.tabId);
      return { targetTabId: state.targetTabId };
    }
    if (actionName === 'page_close_tab') {
      if (Number(args.tabId) === state.sourceTabId) {
        const error = new Error('The source tab cannot be closed by a page-action run.');
        error.code = 'PAGE_TAB_SOURCE_CLOSE_BLOCKED';
        throw error;
      }
      await chrome.tabs.remove(Number(args.tabId));
      state.ownedTabIds.delete(Number(args.tabId));
      if (state.targetTabId === Number(args.tabId)) state.targetTabId = state.sourceTabId;
      return { closedTabId: Number(args.tabId), targetTabId: state.targetTabId };
    }
    throw new Error('Unsupported multi-tab action.');
  }

  getTargetTabId(runId) {
    return this._get(runId).targetTabId;
  }
}

export const pageTabController = { PageTabController };
