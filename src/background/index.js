/**
 * @fileoverview Public message handlers for background capabilities.
 * @module backgroundCapabilities
 */

export { handleDevDiagnosticsMessage } from './devDiagnosticsMessages.js';
export { handleImproveInstructionMessage } from './instructionMessages.js';
export { handleNotchMessage } from './notchMessages.js';
export { handlePageActionMessage } from './pageActionMessages.js';
export { handleRunMessage } from './runMessages.js';
export { handleProviderMessage } from './providerMessages.js';
export { handlePageContentMessage } from './pageContentMessages.js';
export { handleSkillMessage } from './skillMessages.js';
export { handleExternalPanelMessage, handlePanelMessage } from './panelMessages.js';
export { handleSearchMessage } from './searchMessages.js';
/**
 * Requests the debugger permission for precise input.
 * Must be called after the user enables precise input in Act settings.
 * @param {boolean} enabled - Whether precise input is being enabled
 * @returns {Promise<boolean>} Whether the permission was granted
 */
export async function requestDebuggerPermission(enabled) {
  if (!enabled) return true;
  try {
    const granted = await chrome.permissions.request({
      permissions: ['debugger'],
    });
    return granted.includes('debugger');
  } catch (error) {
    console.warn('Failed to request debugger permission:', error);
    return false;
  }
}