/**
 * @fileoverview Development-only main-world console diagnostics bridge.
 *
 * This script observes page JavaScript errors and console output. The
 * production build replaces it with a no-op file. It cannot access extension
 * APIs; events are relayed by the isolated-world diagnostics bridge.
 *
 * @module pageDiagnostics
 */

(function installPromptPaulPageDiagnostics() {
  if (window.__PROMPT_PAUL_PAGE_DIAGNOSTICS__) return;
  window.__PROMPT_PAUL_PAGE_DIAGNOSTICS__ = true;

  let enabled = false;
  let expiresAt = 0;
  let originals = null;

  const active = () => {
    if (!enabled || expiresAt <= Date.now()) {
      enabled = false;
      return false;
    }
    return true;
  };

  const emit = (event, data) => {
    if (!active()) return;
    window.dispatchEvent(
      new CustomEvent('promptPaulDevPageConsole', {
        detail: { event, data },
      })
    );
  };

  const restoreConsole = () => {
    if (!originals) return;
    for (const [level, original] of Object.entries(originals)) console[level] = original;
    originals = null;
  };

  const installConsole = () => {
    if (originals) return;
    originals = {};
    for (const level of ['debug', 'info', 'log', 'warn', 'error']) {
      const original = console[level];
      if (typeof original !== 'function') continue;
      originals[level] = original;
      console[level] = (...args) => {
        original.apply(console, args);
        emit('page_console', { level, args });
      };
    }
  };

  window.addEventListener('promptPaulDevDiagnosticsConfig', (event) => {
    const config = event.detail || {};
    expiresAt = Number(config.expiresAt || 0);
    enabled = config.enabled === true && expiresAt > Date.now();
    if (enabled) installConsole();
    else restoreConsole();
  });
  window.addEventListener('error', (event) => {
    emit('page_uncaught_error', {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    emit('page_unhandled_rejection', { reason: event.reason });
  });
})();
