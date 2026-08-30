/**
 * @fileoverview Renders the current chat mode and reasoning level in the sidebar.
 * @module ChatModelStatus
 */

function formatMode(provider) {
  const normalizedProvider = String(provider || '')
    .trim()
    .toLowerCase();
  if (normalizedProvider === 'codex') return 'Codex';
  if (normalizedProvider === 'hermes') return 'Hermes';
  if (normalizedProvider === 'api') return 'API';
  return normalizedProvider ? normalizedProvider.toUpperCase() : 'API';
}

function formatReasoning(level) {
  const normalizedLevel = String(level || '')
    .trim()
    .toLowerCase();
  return normalizedLevel || 'Auto';
}

function refreshStatus(statusElement, modeElement, reasoningElement) {
  chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
    if (chrome.runtime.lastError) return;

    const profiles = Array.isArray(result.profiles) ? result.profiles : [];
    const selectedProfile = profiles.find((profile) => profile.id === result.lastSelectedProfileId);
    const profile = selectedProfile || profiles.find((candidate) => candidate.id === 'default');
    const mode = profile ? formatMode(profile.provider) : ' - ';
    const reasoning = formatReasoning(profile?.reasoningLevel);

    modeElement.textContent = mode;
    reasoningElement.textContent = reasoning;
    statusElement.title = `Current mode: ${mode}. Reasoning level: ${reasoning}.`;
  });
}

/**
 * Bind the sidebar model status to the selected profile in Chrome storage.
 * @param {Object} elements - Status DOM elements.
 * @param {HTMLElement} elements.statusElement - Status wrapper.
 * @param {HTMLElement} elements.modeElement - Mode value element.
 * @param {HTMLElement} elements.reasoningElement - Reasoning value element.
 */
export function initChatModelStatus({ statusElement, modeElement, reasoningElement }) {
  if (!statusElement || !modeElement || !reasoningElement) return;

  const refresh = () => refreshStatus(statusElement, modeElement, reasoningElement);
  refresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.profiles || changes.lastSelectedProfileId)) {
      refresh();
    }
  });
}
