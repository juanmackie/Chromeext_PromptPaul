/**
 * @fileoverview Background message routing for the Top Notch capability.
 * @module notchMessages
 */

/** Route UI requests to the Top Notch capability. */
export function handleNotchMessage(request, sender, dependencies) {
  if (request?.action !== 'notchAction') return null;
  dependencies
    .handleNotchAction(request, sender)
    .then(dependencies.sendResponse)
    .catch((error) => dependencies.sendResponse({ success: false, error: error.message }));
  return true;
}
