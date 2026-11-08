/**
 * @fileoverview Background message routing for instruction improvement.
 * @module instructionMessages
 */

/** Route instruction-improvement requests from extension pages. */
export function handleImproveInstructionMessage(request, sender, dependencies) {
  if (request?.action !== 'improveInstruction') return null;
  const { extensionOrigin, isExtensionSender, rejectUnauthorizedMessage, sendResponse } =
    dependencies;
  if (!isExtensionSender(sender, extensionOrigin)) {
    return rejectUnauthorizedMessage(sendResponse);
  }
  dependencies
    .improveInstructionForProfile(String(request.prompt || ''))
    .then((content) => sendResponse({ success: true, content }))
    .catch((error) =>
      sendResponse({
        success: false,
        capability: error.capability === 'unsupported' ? 'unsupported' : undefined,
        error: error.message,
      })
    );
  return true;
}
