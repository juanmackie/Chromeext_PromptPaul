/**
 * @fileoverview Reads the live browser-page selection for explicit chat actions.
 * @module ChatSelection
 */

function queryActiveTabId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
      resolve(tabs?.[0]?.id || null)
    );
  });
}

/**
 * Read the first non-empty selection from the source tab's frames.
 *
 * @param {number|null} sourceTabId - Preferred source tab ID.
 * @returns {Promise<string>} Trimmed selected text, or an empty string.
 */
export async function readCurrentPageSelection(sourceTabId = null) {
  const tabId = sourceTabId || (await queryActiveTabId());
  if (!tabId) return '';

  const results = await chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: () => String(window.getSelection?.()?.toString() || '').trim(),
    })
    .catch(() => []);

  return results.map((entry) => String(entry?.result || '').trim()).find(Boolean) || '';
}
