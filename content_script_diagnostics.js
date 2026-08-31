/**
 * @fileoverview Development-only diagnostics bridge for page content scripts.
 *
 * The production build replaces this file with a no-op implementation. The
 * development implementation forwards browser-page errors and console output
 * to the extension service worker when the session trace is enabled.
 *
 * @module contentScriptDiagnostics
 */

(function installPromptPaulDevDiagnostics() {
  if (window.__PROMPT_PAUL_DEV_DIAGNOSTICS__) return;
  window.__PROMPT_PAUL_DEV_DIAGNOSTICS__ = true;

  let enabled = false;
  let expiresAt = 0;
  const configKey = 'promptPaulDevDiagnosticsConfigV1';
  const maxMessageChars = 96 * 1024;

  const boundEntry = (entry) => {
    const serialized = JSON.stringify(entry);
    if (serialized.length <= maxMessageChars) return entry;
    return {
      ...entry,
      data: {
        truncated: true,
        originalChars: serialized.length,
        summary: {
          type: typeof entry.data,
          keys:
            entry.data && typeof entry.data === 'object'
              ? Object.keys(entry.data).slice(0, 40)
              : [],
        },
      },
    };
  };

  const refresh = () => {
    const apply = (config) => {
      expiresAt = Number(config?.expiresAt || 0);
      enabled = config?.enabled === true && expiresAt > Date.now();
      window.dispatchEvent(
        new CustomEvent('promptPaulDevDiagnosticsConfig', {
          detail: { enabled, expiresAt },
        })
      );
    };
    try {
      chrome.storage.session.get(configKey, (result) => {
        if (!chrome.runtime.lastError && result?.[configKey]) {
          apply(result[configKey]);
          return;
        }
        chrome.runtime.sendMessage({ action: 'devDiagnosticsStatus' }, (response) => {
          if (!chrome.runtime.lastError) apply(response);
        });
      });
    } catch (_) {
      chrome.runtime.sendMessage({ action: 'devDiagnosticsStatus' }, (response) => {
        if (!chrome.runtime.lastError) apply(response);
      });
    }
  };

  const trace = (event, data = {}) => {
    if (!enabled || expiresAt <= Date.now()) {
      enabled = false;
      return;
    }
    try {
      const entry = boundEntry({
        schemaVersion: 1,
        timestamp: Date.now(),
        context: 'content-script',
        event,
        data,
      });
      chrome.runtime.sendMessage({ action: 'devDiagnostic', entry }).catch(() => {});
    } catch (_) {
      // The page may be unloading or the extension may have been reloaded.
    }
  };

  window.__PROMPT_PAUL_DEV_TRACE__ = trace;
  window.addEventListener('promptPaulDevPageConsole', (event) => {
    trace('page_console', event.detail || {});
  });
  refresh();
  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'session' && changes[configKey]) refresh();
  });

  window.addEventListener('error', (event) => {
    trace('uncaught_error', {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    trace('unhandled_rejection', { reason: event.reason });
  });

  for (const level of ['debug', 'info', 'log', 'warn', 'error']) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    console[level] = (...args) => {
      original.apply(console, args);
      trace('page_console', { level, args });
    };
  }
})();
