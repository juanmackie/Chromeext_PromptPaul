/**
 * @fileoverview Background message routing for the Top Notch capability.
 * @module notchMessages
 */

/** Route UI requests to the Top Notch capability. */
export function handleNotchMessage(request, sender, dependencies) {
  if (request?.action !== 'notchAction') return null;
  dependencies
    .handleNotchAction(request, sender)
    .then(async (result) => {
      if (result?.success && dependencies.trackFeatureUsed) {
        try {
          await dependencies.trackFeatureUsed('notch');
        } catch (_) {
          // Capability telemetry is best-effort and cannot fail the Notch action.
        }
      }
      return dependencies.sendResponse(result);
    })
    .catch((error) => dependencies.sendResponse({ success: false, error: error.message }));
  return true;
}
