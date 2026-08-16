/**
 * @fileoverview Sender and run ownership checks for background message handlers.
 * @module runtimeAuthorization
 */

/**
 * Check whether a message came from one of this extension's pages.
 * @param {object|null|undefined} sender - Chrome runtime message sender.
 * @param {string} extensionOrigin - The value returned by chrome.runtime.getURL('').
 * @returns {boolean} True for an extension-page sender.
 */
export function isExtensionSender(sender, extensionOrigin) {
  return (
    typeof extensionOrigin === 'string' &&
    extensionOrigin.length > 0 &&
    typeof sender?.url === 'string' &&
    sender.url.startsWith(extensionOrigin)
  );
}

/**
 * Check whether a message came from an injected content script.
 * @param {object|null|undefined} sender - Chrome runtime message sender.
 * @param {string} extensionOrigin - The value returned by chrome.runtime.getURL('').
 * @returns {boolean} True for a non-extension sender with a tab identity.
 */
export function isContentScriptSender(sender, extensionOrigin) {
  return !isExtensionSender(sender, extensionOrigin) && Number.isInteger(sender?.tab?.id);
}

/**
 * Check whether a content-script request identifies its own tab.
 * @param {object|null|undefined} sender - Chrome runtime message sender.
 * @param {unknown} requestedTabId - Tab ID supplied by the request.
 * @returns {boolean} True when the request is absent or matches the sender tab.
 */
export function requestMatchesSenderTab(sender, requestedTabId) {
  if (requestedTabId == null) return true;
  return Number.isInteger(sender?.tab?.id) && Number(requestedTabId) === sender.tab.id;
}

/**
 * Check extension-page and opaque run-token ownership for a run request.
 * @param {object|null|undefined} run - Active orchestrator run.
 * @param {object|null|undefined} request - Runtime request.
 * @param {object|null|undefined} sender - Chrome runtime message sender.
 * @param {string} extensionOrigin - The value returned by chrome.runtime.getURL('').
 * @returns {boolean} True when the sender owns the run.
 */
export function isRunOwner(run, request, sender, extensionOrigin) {
  if (!run || !isExtensionSender(sender, extensionOrigin)) return false;

  const ownerToken = typeof request?.ownerToken === 'string' ? request.ownerToken : '';
  if (!ownerToken || ownerToken !== run.ownerToken) return false;

  if (request?.sourceTabId != null && request.sourceTabId !== run.sourceTabId) {
    return false;
  }

  return true;
}
