/**
 * @fileoverview Runtime message handling for active-page content extraction.
 * @module pageContentMessages
 */

/** Route page extraction and screenshot messages using injected browser APIs. */
export function handlePageContentMessage(request, sender, dependencies) {
  const {
    chrome,
    extensionOrigin,
    extensionPageSender,
    executeTabContentExtraction,
    friendlyRuntimeErrorMessage,
    isContentScriptSender,
    rejectUnauthorizedMessage,
    sendResponse,
  } = dependencies;

  if (request.action === 'captureScreenshot') {
    if (!isContentScriptSender(sender, extensionOrigin) || !Number.isInteger(sender.tab.windowId)) {
      return rejectUnauthorizedMessage(
        sendResponse,
        'Screenshot capture must come from a page content script.'
      );
    }
    chrome.tabs.query({ active: true, windowId: sender.tab.windowId }, (tabs) => {
      if (chrome.runtime.lastError || tabs[0]?.id !== sender.tab.id) {
        sendResponse({
          dataUrl: null,
          error: 'Screenshot capture requires the source page to be active.',
        });
        return;
      }
      chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ dataUrl: null, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ dataUrl });
        }
      });
    });
    return true;
  }

  if (request.action === 'getLoadContent') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse, 'Page extraction must come from Prompt Paul.');
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        executeTabContentExtraction(tabs[0].id)
          .then((result) => {
            sendResponse({
              action: 'loadContentResponse',
              success: result.success,
              sourceTabId: tabs[0].id,
              isPdf: result.isPdf || false,
              pdfUrl: result.pdfUrl || null,
              content: result.content || result.data,
              title: result.title,
              siteName: result.siteName,
              byline: result.byline,
              excerpt: result.excerpt,
              lang: result.lang,
              url: result.url,
              platform: result.platform || null,
              platformInfo: result.platformInfo || null,
              readStrategy: result.readStrategy || 'auto',
              screenshot: result.screenshot || null,
              error: result.error,
            });
          })
          .catch((error) => {
            console.error('Background: Failed to load tab content:', error.message);
            sendResponse({
              action: 'loadContentResponse',
              success: false,
              error: friendlyRuntimeErrorMessage(error),
              readStrategy: 'auto',
            });
          });
      } else {
        sendResponse({
          action: 'loadContentResponse',
          success: false,
          error: 'No active tab found',
        });
      }
    });
    return true;
  }

  if (request.action === 'getTabContent') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse, 'Page extraction must come from Prompt Paul.');
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        executeTabContentExtraction(tabs[0].id)
          .then((result) => {
            sendResponse({
              action: 'tabContentResponse',
              success: result.success,
              isPdf: result.isPdf || false,
              pdfUrl: result.pdfUrl || null,
              content: result.content || result.data,
              title: result.title,
              siteName: result.siteName,
              byline: result.byline,
              excerpt: result.excerpt,
              lang: result.lang,
              url: result.url,
              platform: result.platform || null,
              platformInfo: result.platformInfo || null,
              readStrategy: result.readStrategy || 'auto',
              screenshot: result.screenshot || null,
              error: result.error,
            });
          })
          .catch((error) => {
            console.error('Background: Failed to read tab content:', error.message);
            sendResponse({
              action: 'tabContentResponse',
              success: false,
              error: friendlyRuntimeErrorMessage(error),
              readStrategy: 'auto',
            });
          });
      } else {
        sendResponse({ action: 'tabContentResponse', success: false, error: 'No tab context' });
      }
    });
    return true;
  }

  return null;
}
