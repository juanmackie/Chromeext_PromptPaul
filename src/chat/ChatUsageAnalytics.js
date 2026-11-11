/**
 * @fileoverview Fire-and-forget usage analytics for side-panel and notch
 * instruction launches. Only the instruction ID is sent; the background
 * resolves the bounded labels, so prompt text never leaves the panel.
 * @module chatUsageAnalytics
 */

/**
 * Tell the background that a stored instruction was launched.
 * @param {string} instructionId Stored instruction ID.
 * @param {'side_panel'|'notch'} [source] Surface that launched it.
 * @returns {void}
 */
export function trackInstructionUsage(instructionId, source = 'side_panel') {
  const id = typeof instructionId === 'string' ? instructionId.trim() : '';
  if (!id) return;
  try {
    chrome.runtime.sendMessage(
      {
        action: 'trackInstructionUsage',
        instructionId: id,
        source: source === 'notch' ? 'notch' : 'side_panel',
      },
      () => {
        // The background acknowledges immediately; ignore a closed port.
        void chrome.runtime.lastError;
      }
    );
  } catch (_) {
    // Telemetry never changes the user-visible action.
  }
}
