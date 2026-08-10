/**
 * @fileoverview Extension-page bridge used by the real-browser page-action tests.
 * @module browserExtensionHarness
 */

(() => {
  const sendRuntimeMessage = (message) =>
    new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            code: 'EXTENSION_MESSAGE_FAILED',
            error: chrome.runtime.lastError.message,
          });
          return;
        }
        resolve(response || { success: false, error: 'Empty extension response.' });
      });
    });

  const findTargetTab = (targetUrl) =>
    new Promise((resolve) => {
      chrome.tabs.query({ url: `${String(targetUrl)}*` }, (tabs) => {
        resolve(tabs.find((tab) => tab.url?.startsWith(String(targetUrl))) || null);
      });
    });

  const sendPageAction = (tabId, message) =>
    new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              code: 'PAGE_ACTION_NO_CONTENT_SCRIPT',
              error: chrome.runtime.lastError.message,
            });
            return;
          }
          resolve(response || { success: false, error: 'Empty page-action response.' });
        });
      } catch (error) {
        resolve({
          success: false,
          code: 'PAGE_ACTION_NO_CONTENT_SCRIPT',
          error: error.message,
        });
      }
    });

  const getTabId = async (targetUrl) => (await findTargetTab(targetUrl))?.id || null;
  const pendingConfirmations = new Map();
  const toolResults = new Map();
  const sourceTabs = new Map();

  chrome.runtime.onMessage.addListener((request) => {
    if (
      request.action === 'orchestratorEvent' &&
      request.event?.type === 'page_action_confirmation'
    ) {
      pendingConfirmations.set(request.runId, request.event);
    }
  });

  window.pageActionHarness = Object.freeze({
    async ping(targetUrl) {
      const tabId = await getTabId(targetUrl);
      if (!tabId) return { success: false, code: 'PAGE_ACTION_NO_CONTENT_SCRIPT' };
      return sendPageAction(tabId, { action: 'pageActionPing' });
    },

    async pingTabId(tabId) {
      return sendPageAction(Number(tabId), { action: 'pageActionPing' });
    },

    async directAction(targetUrl, runId, pageAction, args = {}) {
      const tabId = await getTabId(targetUrl);
      if (!tabId) return { success: false, code: 'PAGE_ACTION_NO_CONTENT_SCRIPT' };
      return sendPageAction(tabId, { action: 'pageAction', runId, pageAction, args });
    },

    async setTrustedMode(enabled) {
      await chrome.storage.local.set({ pageActionsTrustedMode: Boolean(enabled) });
      return { success: true };
    },

    async startRun(targetUrl, multiTab = false) {
      const sourceTabId = await getTabId(targetUrl);
      if (!sourceTabId) {
        return { success: false, code: 'PAGE_ACTION_NO_CONTENT_SCRIPT' };
      }
      const response = await sendRuntimeMessage({
        action: 'startRun',
        config: {
          pageActions: true,
          pageActionsMultiTab: Boolean(multiTab),
          sourceTabId,
          tool_choice: 'auto',
          messages: [],
        },
      });
      if (response?.runId) sourceTabs.set(String(response.runId), sourceTabId);
      return response;
    },

    getConfirmation(runId) {
      return pendingConfirmations.get(String(runId)) || null;
    },

    async resolveConfirmation(targetUrl, runId, approved = true, approveAll = false) {
      const confirmation = pendingConfirmations.get(String(runId));
      if (!confirmation) return { success: false, error: 'No pending confirmation.' };
      const response = await sendRuntimeMessage({
        action: 'pageActionDecision',
        runId,
        confirmationId: confirmation.confirmationId,
        approved: Boolean(approved),
        approveAll: Boolean(approveAll),
        sourceTabId: sourceTabs.get(String(runId)) || (await getTabId(targetUrl)),
      });
      if (response?.success) pendingConfirmations.delete(String(runId));
      return response;
    },

    executeTool(runId, id, name, args = {}) {
      const request = sendRuntimeMessage({
        action: 'executeTool',
        runId,
        toolCall: {
          id,
          function: { name, arguments: JSON.stringify(args) },
        },
      });
      request.then((result) => toolResults.set(`${runId}:${id}`, result));
      return request;
    },

    getToolResult(runId, id) {
      return toolResults.get(`${runId}:${id}`) || null;
    },

    abortRun(runId) {
      return sendRuntimeMessage({ action: 'abortRun', runId });
    },

    async findTab(targetUrl) {
      const tab = await findTargetTab(targetUrl);
      return tab ? { id: tab.id, url: tab.url } : null;
    },
  });
  document.getElementById('status').dataset.ready = 'true';
})();
