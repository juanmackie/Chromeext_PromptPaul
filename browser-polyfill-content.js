// Browser polyfill for content scripts
// This file needs to be loaded before any other content script that uses browser APIs
(function () {
  // Since content scripts can't use ES modules directly,
  // we'll load the polyfill using a dynamic import if supported
  if (typeof importScripts !== 'undefined') {
    // Service worker context
    try {
      importScripts('browser-polyfill.js');
    } catch (e) {
      console.warn('Failed to load browser polyfill:', e);
    }
  } else if (typeof window !== 'undefined' && typeof window.importShim !== 'undefined') {
    // Modern browser with dynamic import support
    import('webextension-polyfill').catch(e => {
      console.warn('Failed to load browser polyfill:', e);
    });
  }
  // Note: For regular content scripts, the polyfill will need to be bundled
  // or included via a separate script tag in the extension
})();
