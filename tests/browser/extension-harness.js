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
        chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, (response) => {
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
  const pendingManualInterventions = new Map();
  const toolResults = new Map();
  const sourceTabs = new Map();
  const runTokens = new Map();
  const pageSnapshots = new Map();
  const runMetrics = new Map();
  const evaluationResults = new Map();

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'orchestratorEvent' && request.runId) {
      const metrics = runMetrics.get(String(request.runId)) || {
        confirmationCards: 0,
        progressCards: 0,
        manualInterventions: 0,
      };
      if (request.event?.type === 'page_action_confirmation') metrics.confirmationCards += 1;
      if (request.event?.type === 'page_task_progress') metrics.progressCards += 1;
      if (request.event?.type === 'page_manual_intervention_request') {
        metrics.manualInterventions += 1;
      }
      runMetrics.set(String(request.runId), metrics);
    }
    if (
      request.action === 'orchestratorEvent' &&
      request.event?.type === 'page_action_confirmation'
    ) {
      pendingConfirmations.set(request.runId, request.event);
    }
    if (
      request.action === 'orchestratorEvent' &&
      request.event?.type === 'page_manual_intervention_request'
    ) {
      pendingManualInterventions.set(request.runId, request.event);
    }
    if (request.action === 'TEST_RUN_TASK_RESULT' && request.taskId) {
      evaluationResults.set(String(request.taskId), request);
    }
  });

  async function ensurePageActionRuntime(tabId) {
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.PROMPT_PAUL_PAGE_ACTIONS_LOADED),
    });
    if (probe?.result) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content_script_page_actions.js'],
    });
  }

  window.pageActionHarness = Object.freeze({
    async attachSelectionSource(targetUrl, selectedText = 'Previous selection') {
      const tabId = await getTabId(targetUrl);
      if (!tabId) return { success: false, code: 'PAGE_ACTION_NO_CONTENT_SCRIPT' };
      await chrome.storage.session.set({
        pendingPanelAction: {
          action: 'setSelectedText',
          actionId: `browser-selection-${Date.now()}`,
          selectedText,
          tabId,
          fromStartChat: true,
          queuedAt: Date.now(),
        },
      });
      return { success: true, tabId };
    },

    async ping(targetUrl) {
      const tabId = await getTabId(targetUrl);
      if (!tabId) return { success: false, code: 'PAGE_ACTION_NO_CONTENT_SCRIPT' };
      await ensurePageActionRuntime(tabId);
      return sendPageAction(tabId, { action: 'pageActionPing' });
    },

    async pingTabId(tabId) {
      const id = Number(tabId);
      const tab = await chrome.tabs.get(id);
      if (/^https?:/u.test(String(tab.url || ''))) await ensurePageActionRuntime(id);
      return sendPageAction(id, { action: 'pageActionPing' });
    },

    async sendFromContentScript(tabId, message) {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: Number(tabId) },
        func: (payload) =>
          new Promise((resolve) => {
            chrome.runtime.sendMessage(payload, (response) => {
              resolve(
                chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : response
              );
            });
          }),
        args: [message],
      });
      return result?.result || { success: false, error: 'Empty content-script response.' };
    },

    async directAction(targetUrl, runId, pageAction, args = {}) {
      const tabId = await getTabId(targetUrl);
      if (!tabId) return { success: false, code: 'PAGE_ACTION_NO_CONTENT_SCRIPT' };
      await ensurePageActionRuntime(tabId);
      const currentArgs = { ...args };
      if (pageAction === 'page_get_state') {
        const result = await sendPageAction(tabId, {
          action: 'pageAction',
          runId,
          pageAction,
          args: currentArgs,
        });
        if (result?.snapshot) pageSnapshots.set(runId, result.snapshot);
        return result;
      }
      if (!currentArgs.elementKey && Number.isInteger(Number(currentArgs.index))) {
        const element = pageSnapshots
          .get(runId)
          ?.elements?.find((candidate) => candidate.index === Number(currentArgs.index));
        if (element?.elementKey) currentArgs.elementKey = element.elementKey;
      }
      const result = await sendPageAction(tabId, {
        action: 'pageAction',
        runId,
        pageAction,
        args: currentArgs,
      });
      if (result?.snapshot) pageSnapshots.set(runId, result.snapshot);
      return result;
    },

    async measureScopeDiff(before, after) {
      const module = await import(chrome.runtime.getURL('src/utils/pageActionScopeDiff.js'));
      const diff = module.diffPageActionSnapshots(before, after);
      return {
        regions: module.buildIndexedPageRegions(after),
        diff,
        metrics: module.measurePageActionScopeDiff(after, diff),
      };
    },

    async setTrustedMode(enabled) {
      await chrome.storage.local.set({ pageActionsTrustedMode: Boolean(enabled) });
      return { success: true };
    },

    async startEvaluationTask(targetUrl, taskId, task, profileId, options = {}) {
      const sourceTabId = await getTabId(targetUrl);
      if (!sourceTabId) {
        return { success: false, code: 'PAGE_ACTION_NO_CONTENT_SCRIPT' };
      }
      const response = await sendRuntimeMessage({
        action: 'TEST_RUN_TASK',
        taskId,
        task,
        profileId,
        ...(options.taskMode ? { taskMode: options.taskMode } : {}),
        ...(Number.isFinite(options.temperature) ? { temperature: options.temperature } : {}),
        sourceTabId,
        dryRun: false,
      });
      if (response?.runId) {
        sourceTabs.set(String(response.runId), sourceTabId);
        runTokens.set(String(response.runId), response.ownerToken || '');
      }
      return response;
    },

    getEvaluationResult(taskId) {
      return evaluationResults.get(String(taskId)) || null;
    },

    getRunMetrics(runId) {
      return { ...(runMetrics.get(String(runId)) || {}) };
    },

    async startRun(targetUrl, multiTab = false, extraConfig = {}) {
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
          ...extraConfig,
        },
      });
      if (response?.runId) {
        sourceTabs.set(String(response.runId), sourceTabId);
        runTokens.set(String(response.runId), response.ownerToken || '');
      }
      return response;
    },

    async startRunWithoutSource(extraConfig = {}) {
      const response = await sendRuntimeMessage({
        action: 'startRun',
        config: {
          pageActions: true,
          tool_choice: 'auto',
          messages: [],
          ...extraConfig,
        },
      });
      if (response?.runId) {
        runTokens.set(String(response.runId), response.ownerToken || '');
        sourceTabs.set(String(response.runId), response.sourceTabId ?? null);
      }
      return response;
    },

    getConfirmation(runId) {
      return pendingConfirmations.get(String(runId)) || null;
    },

    getManualIntervention(runId) {
      return pendingManualInterventions.get(String(runId)) || null;
    },

    async resumeManualIntervention(runId, resume = true) {
      const request = pendingManualInterventions.get(String(runId));
      if (!request) return { success: false, error: 'No pending manual intervention.' };
      const response = await sendRuntimeMessage({
        action: 'pageManualInterventionResume',
        runId,
        requestId: request.requestId,
        ownerToken: runTokens.get(String(runId)) || '',
        resume: Boolean(resume),
        sourceTabId: sourceTabs.has(String(runId)) ? sourceTabs.get(String(runId)) : null,
      });
      if (response?.success) pendingManualInterventions.delete(String(runId));
      return response;
    },

    async resolveConfirmation(
      targetUrl,
      runId,
      approved = true,
      approveAll = false,
      overrides = {}
    ) {
      const confirmation = pendingConfirmations.get(String(runId));
      if (!confirmation) return { success: false, error: 'No pending confirmation.' };
      const response = await sendRuntimeMessage({
        action: 'pageActionDecision',
        runId,
        confirmationId: confirmation.confirmationId,
        ownerToken: runTokens.get(String(runId)) || '',
        approved: Boolean(approved),
        approveAll: Boolean(approveAll),
        sourceTabId: sourceTabs.has(String(runId))
          ? sourceTabs.get(String(runId))
          : await getTabId(targetUrl),
        ...overrides,
      });
      if (response?.success) pendingConfirmations.delete(String(runId));
      return response;
    },

    async getJournal(runId) {
      return sendRuntimeMessage({ action: 'getRunJournal', runId });
    },

    executeRun(runId, messages) {
      return sendRuntimeMessage({
        action: 'executeRun',
        runId,
        ownerToken: runTokens.get(String(runId)) || '',
        requestConfig: { messages },
      });
    },

    executeTool(runId, id, name, args = {}) {
      const request = sendRuntimeMessage({
        action: 'executeTool',
        runId,
        ownerToken: runTokens.get(String(runId)) || '',
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
      return sendRuntimeMessage({
        action: 'abortRun',
        runId,
        ownerToken: runTokens.get(String(runId)) || '',
      });
    },

    async findTab(targetUrl) {
      const tab = await findTargetTab(targetUrl);
      return tab ? { id: tab.id, url: tab.url } : null;
    },
  });
  document.getElementById('status').dataset.ready = 'true';
})();
