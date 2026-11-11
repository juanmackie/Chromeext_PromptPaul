/**
 * @fileoverview Runtime message routing for usage analytics initiated by
 * extension pages. Only an instruction ID and a fixed source are accepted;
 * the background resolves the bounded labels from stored instructions.
 * @module analyticsMessages
 */

/** Route an analytics message, or return null when another capability owns it. */
export function handleAnalyticsMessage(request, sender, dependencies) {
  if (request?.action !== 'trackInstructionUsage') return null;

  const {
    extensionPageSender,
    rejectUnauthorizedMessage,
    sendResponse,
    trackInstructionUsageById,
  } = dependencies;

  if (!extensionPageSender) {
    return rejectUnauthorizedMessage(sendResponse, 'Usage analytics must come from Prompt Paul.');
  }

  const instructionId =
    typeof request.instructionId === 'string' ? request.instructionId.trim().slice(0, 256) : '';
  if (!instructionId) {
    sendResponse({ success: false });
    return false;
  }

  const source = request.source === 'notch' ? 'notch' : 'side_panel';
  sendResponse({ success: true });
  Promise.resolve(trackInstructionUsageById(instructionId, source)).catch(() => {});
  return false;
}
