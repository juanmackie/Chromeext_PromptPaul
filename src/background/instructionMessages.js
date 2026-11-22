/**
 * @fileoverview Background message routing for instruction improvement.
 * @module instructionMessages
 */

import { MAX_PROMPT_INSTRUCTION_CHARS } from '../prompts.js';

/** Route instruction-improvement requests from extension pages. */
export function handleImproveInstructionMessage(request, sender, dependencies) {
  if (request?.action !== 'improveInstruction') return null;
  const { extensionOrigin, isExtensionSender, rejectUnauthorizedMessage, sendResponse } =
    dependencies;
  if (!isExtensionSender(sender, extensionOrigin)) {
    return rejectUnauthorizedMessage(sendResponse);
  }
  const prompt = String(request.prompt || '');
  if (prompt.length > MAX_PROMPT_INSTRUCTION_CHARS) {
    sendResponse({
      success: false,
      error: `Prompt must be ${MAX_PROMPT_INSTRUCTION_CHARS} characters or fewer.`,
    });
    return true;
  }
  dependencies
    .improveInstructionForProfile(prompt)
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
