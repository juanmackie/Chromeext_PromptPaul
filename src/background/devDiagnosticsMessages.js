/**
 * @fileoverview Authorization and dispatch for diagnostics runtime messages.
 * @module devDiagnosticsMessages
 */

/**
 * Handle diagnostics messages without coupling the capability to Chrome APIs.
 * Returns null when the action is not owned by this handler.
 */
export function handleDevDiagnosticsMessage(request, sender, dependencies) {
  const { extensionOrigin, isExtensionSender, isContentScriptSender, requestMatchesSenderTab } =
    dependencies;
  if (request?.action === 'devDiagnostic') {
    const authorized =
      isExtensionSender(sender, extensionOrigin) ||
      (isContentScriptSender(sender, extensionOrigin) &&
        (request.tabId == null || requestMatchesSenderTab(sender, request.tabId)));
    if (!authorized) return dependencies.rejectUnauthorizedMessage(dependencies.sendResponse);
    dependencies.sendResponse({ success: dependencies.recordRemoteDevDiagnostic(request.entry) });
    return false;
  }
  if (request?.action === 'devDiagnosticsStatus') {
    const authorized =
      isExtensionSender(sender, extensionOrigin) || isContentScriptSender(sender, extensionOrigin);
    if (!authorized) return dependencies.rejectUnauthorizedMessage(dependencies.sendResponse);
    dependencies.sendResponse(dependencies.getDevDiagnosticsStatus());
    return false;
  }
  return null;
}
