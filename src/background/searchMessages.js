/**
 * @fileoverview Runtime message handling for web-search availability.
 * @module searchMessages
 */

/** Return configured web-search status without exposing stored credentials. */
export function handleSearchMessage(request, sender, dependencies) {
  const { chrome, extensionPageSender, rejectUnauthorizedMessage, sendResponse } = dependencies;

  if (request.action === 'getWebSearchStatus') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    // Read-only: resolve a legacy 'duckduckgo' value as 'exa' in memory only.
    chrome.storage.local.get(['searchProvider', 'braveSearchApiKey'], (result) => {
      const provider = result.searchProvider === 'brave' ? 'brave' : 'exa';
      const configured = provider === 'exa' || Boolean(result.braveSearchApiKey);
      sendResponse({ configured, provider });
    });
    return true;
  }

  return null;
}
