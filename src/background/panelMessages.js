/**
 * @fileoverview Runtime message handling for panel navigation and handoff.
 * @module panelMessages
 */

/** Route panel navigation and selection handoff using injected browser APIs. */
export function handlePanelMessage(request, sender, dependencies) {
  const {
    chrome,
    extensionOrigin,
    extensionPageSender,
    isContentScriptSender,
    logger = console,
    openChatInTab,
    openChatWithContext,
    openPromptPaulForSelection,
    rejectUnauthorizedMessage,
    requestMatchesSenderTab,
    resolvePanelTabId,
    sendResponse,
  } = dependencies;

  if (request.action === 'openPromptPaulFromSelection') {
    if (
      !isContentScriptSender(sender, extensionOrigin) ||
      !requestMatchesSenderTab(sender, request.tabId)
    ) {
      return rejectUnauthorizedMessage(sendResponse, 'Selection handoff must come from its tab.');
    }

    const tabId = sender.tab.id;
    const selectedText = String(request.selectedText || '').trim();
    if (!selectedText) {
      sendResponse({ success: false, error: 'No selected text provided' });
      return false;
    }

    openPromptPaulForSelection(tabId, selectedText, sender.tab.windowId)
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('Background: Failed to open Prompt Paul from selection:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  // Deep link into the canonical chat from any extension surface.
  if (request.action === 'openChat') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse, 'Chat opening must come from Prompt Paul.');
    }
    const context =
      request.context && typeof request.context === 'object' && !Array.isArray(request.context)
        ? request.context
        : {};
    const requestedTabId = context.tabId || request.tabId || sender.tab?.id;
    resolvePanelTabId(requestedTabId)
      .then(async (tabId) => {
        if (!tabId) return openChatInTab();

        try {
          return await openChatWithContext({ ...context, tabId });
        } catch (error) {
          // Opening a side panel from an extension page can fail when the
          // resolved web tab is inactive or Chrome does not carry the user
          // gesture through the service-worker message. Always give Options a
          // visible fallback instead of making the button appear inert.
          logger.warn('Background: Side panel open failed; opening chat tab:', error.message);
          return openChatInTab();
        }
      })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'openOptionsPage') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse, 'Options must be opened by Prompt Paul.');
    }
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    sendResponse({ success: true });
    return true;
  }

  return null;
}

/** Route website deep links through the same panel context entry point. */
export function handleExternalPanelMessage(request, sender, dependencies) {
  const { openChatWithContext, sendResponse } = dependencies;
  if (!request || request.action !== 'openChat') {
    sendResponse({ success: false, error: 'Unsupported external action' });
    return undefined;
  }
  const context =
    request.context && typeof request.context === 'object' && !Array.isArray(request.context)
      ? request.context
      : {};
  const externalTabId =
    Number.isInteger(sender?.tab?.id) && sender.tab.id >= 0 ? sender.tab.id : null;
  if (externalTabId === null) {
    sendResponse({ success: false, error: 'External chat links must come from a browser tab.' });
    return false;
  }
  openChatWithContext({ ...context, tabId: externalTabId })
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true;
}
