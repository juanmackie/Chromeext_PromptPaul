/**
 * @fileoverview Chat Grounding Module - Web search toggle state, Brave key status,
 * toggle element wiring, and source-safe formatting helpers.
 *
 * Keeps the global `webSearchEnabled` preference and Brave key status
 * coordination out of chat.js to respect the line-length guard.
 *
 * @module ChatGrounding
 */

/** Storage key for the global on/off preference. */
const WEB_SEARCH_ENABLED_KEY = 'webSearchEnabled';

/**
 * Read the persisted web-search toggle state and ask the background worker
 * whether a key is configured. The side panel never reads the key itself.
 * @returns {Promise<boolean>}
 */
export async function isWebSearchEnabled() {
  const preferenceEnabled = await new Promise((resolve) => {
    chrome.storage.local.get([WEB_SEARCH_ENABLED_KEY], (result) => {
      resolve(Boolean(result[WEB_SEARCH_ENABLED_KEY]));
    });
  });
  if (!preferenceEnabled) return false;

  const status = await getBraveKeyStatus();
  return status.configured;
}

/**
 * Persist the web-search toggle state.
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
function setWebSearchEnabled(enabled) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [WEB_SEARCH_ENABLED_KEY]: enabled }, resolve);
  });
}

/**
 * Check whether a Brave API key is configured (via background to avoid
 * credential exposure in the chat page).
 * @returns {Promise<{configured: boolean}>}
 */
function getBraveKeyStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getWebSearchStatus' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        resolve({ configured: false });
        return;
      }
      resolve({ configured: Boolean(response.configured) });
    });
  });
}

/**
 * Open the options page at the Web Search section.
 */
function openWebSearchOptions() {
  chrome.runtime.openOptionsPage
    ? chrome.runtime.openOptionsPage()
    : chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
}

/**
 * Update the toggle element's visual state and title.
 * @param {HTMLElement} el
 * @param {boolean} enabled
 */
function applyToggleState(el, enabled) {
  if (!el) return;
  el.setAttribute('aria-pressed', String(enabled));
  el.title = enabled
    ? 'Web search is on — click to disable grounding'
    : 'Web search is off — click to enable grounding';
}

/**
 * Wire up the web-search toggle button in the sidebar.
 * Must be called once from chat.js after DOMContentLoaded.
 *
 * @param {HTMLElement} toggleEl - The #web-search-toggle button element.
 * @param {object} loadingManagerRef - loadingManager for toast messages.
 */
export function initWebSearchToggle(toggleEl, loadingManagerRef) {
  if (!toggleEl) return;

  // Load initial state
  isWebSearchEnabled().then((enabled) => applyToggleState(toggleEl, enabled));

  // Click handler
  toggleEl.addEventListener('click', async () => {
    const currentlyEnabled = toggleEl.getAttribute('aria-pressed') === 'true';
    const newState = !currentlyEnabled;

    if (newState) {
      const status = await getBraveKeyStatus();
      if (!status.configured) {
        loadingManagerRef.showToast('Configure a Brave Search API key in Options first', 'warning');
        openWebSearchOptions();
        return;
      }
    }

    await setWebSearchEnabled(newState);
    applyToggleState(toggleEl, newState);
  });

  // React to preference changes. Key removal in Options also turns this
  // preference off, so the side panel does not need to observe key values.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes[WEB_SEARCH_ENABLED_KEY]) {
      applyToggleState(toggleEl, Boolean(changes[WEB_SEARCH_ENABLED_KEY].newValue));
    }
  });
}

/**
 * Format grounded sources from the complete event metadata into
 * a safe markdown Sources block. Returns empty string when there are
 * no valid sources.
 *
 * @param {Array<{id: string, title: string, url: string}>} sources
 * @returns {string} Markdown Sources section or empty string.
 */
function escapeMarkdownLabel(value) {
  return String(value || '')
    .replace(/([\\`*_[\]{}()+#.!|>~])/g, '\\$1')
    .trim();
}

function safeMarkdownUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return encodeURI(parsed.href)
      .replace(/[()]/g, (character) => (character === '(' ? '%28' : '%29'))
      .replace(/[<>"']/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    return '';
  }
}

export function formatSourcesBlock(sources) {
  const normalized = normalizeSources(sources).slice(0, 10);
  if (normalized.length === 0) return '';

  const lines = ['---', '**Sources:**', ''];
  for (const source of normalized) {
    const title = escapeMarkdownLabel(source.title || source.url);
    const url = safeMarkdownUrl(source.url);
    if (url) lines.push(`- [${title}](${url})`);
  }

  return lines.length === 3 ? '' : lines.concat('').join('\n');
}

/**
 * Build the full assistant message body by appending a Sources
 * section (when present) to the answer content.
 *
 * @param {string} content - The assistant's rendered answer text.
 * @param {Array} sources - Raw grounding source metadata.
 * @returns {string} Body text suitable for rendering and persistence.
 */
export function buildBodyWithSources(content, sources) {
  const sourcesMd = formatSourcesBlock(sources);
  const trimmedContent = typeof content === 'string' ? content : '';
  return sourcesMd ? trimmedContent + '\n\n' + sourcesMd : trimmedContent;
}

export function buildFinalResponseBody(eventContent, streamedText, sources, completion = null) {
  const content = eventContent || streamedText || '';
  const reasoningObserved = completion?.hasReasoning === true;
  let displayContent = content;

  if (!content.trim()) {
    if (reasoningObserved) {
      displayContent = completion?.exhausted
        ? '⚠️ No final answer — the model used its token budget thinking.'
        : '⚠️ The model returned reasoning but no final answer. Try again or choose a different model.';
    } else if (completion?.reason) {
      displayContent =
        '⚠️ The model returned no final answer. Try again or choose a different model.';
    }
  }

  return buildBodyWithSources(displayContent, sources);
}

/**
 * Classify an orchestrator tool result, including errors nested inside the
 * standard `{ success, result }` execution envelope.
 * @param {*} executionResult
 * @returns {{status: 'success'|'error'|'no_results', error: string, message: string, payload: *}}
 */
export function classifyToolExecutionResult(executionResult) {
  const outer = executionResult && typeof executionResult === 'object' ? executionResult : {};
  const payload = Object.prototype.hasOwnProperty.call(outer, 'result') ? outer.result : outer;
  const payloadObject = payload && typeof payload === 'object' ? payload : {};
  const error = String(payloadObject.error || (outer.success === false ? outer.error || '' : ''));
  const message = String(payloadObject.message || outer.message || error);

  if (error === 'WEB_SEARCH_NO_RESULTS') {
    return { status: 'no_results', error, message, payload };
  }
  if (error || outer.success === false) {
    return { status: 'error', error: error || 'TOOL_ERROR', message, payload };
  }
  if (
    Object.prototype.hasOwnProperty.call(payloadObject, 'query') &&
    Array.isArray(payloadObject.sources) &&
    payloadObject.sources.length === 0
  ) {
    return {
      status: 'no_results',
      error: 'WEB_SEARCH_NO_RESULTS',
      message: 'Web search returned no usable sources.',
      payload,
    };
  }
  return { status: 'success', error: '', message: '', payload };
}

/**
 * Validate and deduplicate source metadata.
 * @param {Array} rawSources
 * @returns {Array<{id: string, title: string, url: string}>}
 */
export function normalizeSources(rawSources) {
  if (!Array.isArray(rawSources)) return [];

  const seen = new Set();
  const out = [];
  for (const s of rawSources) {
    if (!s || typeof s !== 'object') continue;
    const url = String(s.url || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const id = String(s.id || url).trim();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id: id.slice(0, 80),
      title: String(s.title || '')
        .trim()
        .slice(0, 200),
      url: url.slice(0, 2048),
    });
  }
  return out;
}
