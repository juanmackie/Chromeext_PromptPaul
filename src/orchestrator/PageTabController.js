/**
 * @fileoverview Owned-tab registry for explicitly enabled page-action runs.
 * @module PageTabController
 */

import { sanitizePageActionUrl } from '../utils/pageDom.js';

const MAX_OWNED_TABS = 12;

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

/**
 * Normalized comparison key for tab destinations: origin + path, ignoring query
 * strings and fragments so changing mail/search filters still match the tab
 * that already shows the destination. Returns '' for non-HTTP(S) URLs.
 * @param {unknown} url
 * @returns {string}
 */
function destinationKey(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_) {
    return '';
  }
}

/**
 * HTTP(S) origin of a URL, or '' for unsafe/unparseable input.
 * @param {unknown} url
 * @returns {string}
 */
function destinationOrigin(url) {
  try {
    const parsed = new URL(String(url || ''));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : '';
  } catch (_) {
    return '';
  }
}

export class PageTabController {
  constructor(options = {}) {
    this.runs = new Map();
    this.ensureTabReady = options.ensureTabReady || null;
  }

  registerRun(runId, sourceTabId) {
    this.runs.set(String(runId), {
      sourceTabId: Number(sourceTabId),
      targetTabId: Number(sourceTabId),
      ownedTabIds: new Set([Number(sourceTabId)]),
      tabStates: new Map([[Number(sourceTabId), { status: 'unknown', failures: 0 }]]),
    });
  }

  disposeRun(runId) {
    this.runs.delete(String(runId));
  }

  getOwnedTabIds(runId) {
    return Array.from(this.runs.get(String(runId))?.ownedTabIds || []);
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

  /**
   * Select an owned tab (foreground unless background was requested), run the
   * readiness check, and return the reused-tab result shape.
   * @param {object} state
   * @param {number} tabId
   * @param {{background?: boolean, signal?: AbortSignal}} args
   * @param {boolean} [navigated]
   * @returns {Promise<object>}
   */
  async _adoptOwnedTab(state, tabId, args, navigated = false) {
    const foreground = args.background !== true;
    if (foreground) state.targetTabId = tabId;
    let ready = true;
    let readinessError = null;
    if (this.ensureTabReady) {
      try {
        await this.ensureTabReady(tabId, args.signal);
        state.tabStates.set(tabId, { status: 'ready', failures: 0 });
      } catch (error) {
        ready = false;
        readinessError = error;
        const current = state.tabStates.get(tabId) || { failures: 0 };
        state.tabStates.set(tabId, {
          status: 'unavailable',
          failures: Number(current.failures || 0) + 1,
          code: error?.code || 'PAGE_TAB_UNAVAILABLE',
        });
      }
    }
    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_) {
      tab = null;
    }
    return {
      tab: safeTab(tab),
      openedTabId: tabId,
      targetTabId: state.targetTabId,
      ready,
      reused: true,
      ...(navigated ? { navigated: true } : {}),
      ...(readinessError
        ? {
            tabError: {
              code: readinessError.code || 'PAGE_TAB_UNAVAILABLE',
              message: readinessError.message,
            },
          }
        : {}),
    };
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
          if (!state.tabStates.has(tabId))
            state.tabStates.set(tabId, { status: 'unknown', failures: 0 });
        } catch (_) {
          state.ownedTabIds.delete(tabId);
        }
      }
      return {
        tabs,
        targetTabId: state.targetTabId,
        unavailableTabIds: Array.from(state.tabStates.entries())
          .filter(([, tabState]) => tabState.status === 'unavailable')
          .map(([tabId]) => tabId),
      };
    }

    if (actionName === 'page_navigate_tab') {
      const tabId = Number(args.tabId ?? state.targetTabId);
      this._assertOwned(state, tabId);
      const url = String(args.url || '').trim();
      let parsed;
      try {
        parsed = new URL(url);
      } catch (_) {
        const error = new Error('A valid http(s) navigation URL is required.');
        error.code = 'PAGE_NAVIGATION_BLOCKED';
        throw error;
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        const error = new Error('Only http(s) navigation URLs are allowed.');
        error.code = 'PAGE_NAVIGATION_BLOCKED';
        throw error;
      }
      await chrome.tabs.update(tabId, { url: parsed.href });
      return this._adoptOwnedTab(state, tabId, args, true);
    }

    if (actionName === 'page_open_tab') {
      // One work tab per site: an exact destination is adopted idempotently,
      // and any other same-origin open navigates the run's existing non-source
      // tab in place instead of spawning another tab. Multi-page tasks (search
      // results, product pages, filters) stay on a single tab.
      const requestedKey = destinationKey(args.url);
      const requestedOrigin = destinationOrigin(args.url);
      if (requestedKey) {
        let sameOriginTabId = null;
        for (const tabId of state.ownedTabIds) {
          let existing;
          try {
            existing = await chrome.tabs.get(tabId);
          } catch (_) {
            state.ownedTabIds.delete(tabId);
            continue;
          }
          if (destinationKey(existing?.url) === requestedKey) {
            return this._adoptOwnedTab(state, tabId, args);
          }
          if (
            !sameOriginTabId &&
            requestedOrigin &&
            tabId !== state.sourceTabId &&
            state.tabStates.get(tabId)?.status !== 'unavailable' &&
            destinationOrigin(existing?.url) === requestedOrigin
          ) {
            sameOriginTabId = tabId;
          }
        }
        if (sameOriginTabId) {
          await chrome.tabs.update(sameOriginTabId, { url: args.url });
          return this._adoptOwnedTab(state, sameOriginTabId, args, true);
        }
      }
      if (state.ownedTabIds.size >= MAX_OWNED_TABS) {
        const error = new Error(`A run may own at most ${MAX_OWNED_TABS} tabs.`);
        error.code = 'PAGE_TAB_LIMIT';
        throw error;
      }
      const tab = await chrome.tabs.create({ url: args.url, active: args.background !== true });
      if (!tab?.id) throw new Error('The browser did not return the new tab id.');
      state.ownedTabIds.add(tab.id);
      state.tabStates.set(tab.id, { status: 'starting', failures: 0 });
      const foreground = args.background !== true;
      if (foreground) state.targetTabId = tab.id;
      let ready = true;
      let readinessError = null;
      if (this.ensureTabReady) {
        try {
          await this.ensureTabReady(tab.id, args.signal);
          state.tabStates.set(tab.id, { status: 'ready', failures: 0 });
        } catch (error) {
          ready = false;
          readinessError = error;
          const current = state.tabStates.get(tab.id) || { failures: 0 };
          state.tabStates.set(tab.id, {
            status: 'unavailable',
            failures: Number(current.failures || 0) + 1,
            code: error?.code || 'PAGE_TAB_UNAVAILABLE',
          });
        }
      }
      return {
        tab: safeTab(tab),
        openedTabId: tab.id,
        targetTabId: state.targetTabId,
        ready,
        ...(readinessError
          ? {
              tabError: {
                code: readinessError.code || 'PAGE_TAB_UNAVAILABLE',
                message: readinessError.message,
              },
            }
          : {}),
      };
    }

    this._assertOwned(state, args.tabId);
    if (actionName === 'page_switch_tab') {
      state.targetTabId = Number(args.tabId);
      let ready = true;
      let tabError = null;
      if (this.ensureTabReady) {
        try {
          await this.ensureTabReady(state.targetTabId, args.signal);
          state.tabStates.set(state.targetTabId, { status: 'ready', failures: 0 });
        } catch (error) {
          ready = false;
          tabError = { code: error?.code || 'PAGE_TAB_UNAVAILABLE', message: error?.message };
          const current = state.tabStates.get(state.targetTabId) || { failures: 0 };
          state.tabStates.set(state.targetTabId, {
            status: 'unavailable',
            failures: Number(current.failures || 0) + 1,
            code: tabError.code,
          });
        }
      }
      return { targetTabId: state.targetTabId, ready, ...(tabError ? { tabError } : {}) };
    }
    if (actionName === 'page_close_tab') {
      if (Number(args.tabId) === state.sourceTabId) {
        const error = new Error('The source tab cannot be closed by a page-action run.');
        error.code = 'PAGE_TAB_SOURCE_CLOSE_BLOCKED';
        throw error;
      }
      await chrome.tabs.remove(Number(args.tabId));
      state.ownedTabIds.delete(Number(args.tabId));
      state.tabStates.delete(Number(args.tabId));
      if (state.targetTabId === Number(args.tabId)) state.targetTabId = state.sourceTabId;
      return { closedTabId: Number(args.tabId), targetTabId: state.targetTabId };
    }
    throw new Error('Unsupported multi-tab action.');
  }

  getTargetTabId(runId) {
    return this._get(runId).targetTabId;
  }

  /**
   * Mark one owned tab unavailable and select the first remaining healthy tab.
   * A page-action failure is isolated to the tab that caused it; the run can
   * continue on another owned tab.
   * @param {string} runId
   * @param {number} tabId
   * @param {{code?: string, message?: string}} [failure]
   * @returns {{tabId: number, nextTargetTabId: number|null, available: boolean}}
   */
  quarantine(runId, tabId, failure = {}) {
    const state = this._get(runId);
    const normalizedTabId = Number(tabId);
    if (!state.ownedTabIds.has(normalizedTabId)) {
      return {
        tabId: normalizedTabId,
        nextTargetTabId: state.targetTabId || null,
        available: false,
      };
    }
    const previous = state.tabStates.get(normalizedTabId) || { failures: 0 };
    state.tabStates.set(normalizedTabId, {
      status: 'unavailable',
      failures: Number(previous.failures || 0) + 1,
      code: failure.code || 'PAGE_TAB_UNAVAILABLE',
    });
    const candidates = Array.from(state.ownedTabIds).filter((candidate) => {
      if (candidate === normalizedTabId) return false;
      return state.tabStates.get(candidate)?.status !== 'unavailable';
    });
    const nextTargetTabId = candidates[0] || null;
    if (nextTargetTabId) state.targetTabId = nextTargetTabId;
    return { tabId: normalizedTabId, nextTargetTabId, available: Boolean(nextTargetTabId) };
  }

  getTabStatus(runId, tabId) {
    const state = this._get(runId);
    return { ...(state.tabStates.get(Number(tabId)) || { status: 'unknown', failures: 0 }) };
  }
}
