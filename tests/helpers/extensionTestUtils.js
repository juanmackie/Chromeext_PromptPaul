/**
 * Generic, reusable helpers for testing Chrome extension messaging and runtime
 * behavior with jest-chrome.
 */

export function resetChrome() {
  if (chrome && typeof chrome.flush === 'function') {
    chrome.flush();
  }
  if (typeof jest !== 'undefined') {
    jest.clearAllMocks();
    jest.resetModules();
  }
}

/**
 * Register a runtime.onMessage listener via a handler function.
 * The handler gets (message, sender, sendResponse).
 */
export function mockRuntimeMessage(handler) {
  if (!chrome || !chrome.runtime || !chrome.runtime.onMessage) {
    throw new Error('chrome.runtime.onMessage is not available (jest-chrome not initialized?)');
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    return handler(message, sender, sendResponse);
  });
}

/**
 * Emit a runtime message to all registered listeners.
 * Mirrors the Chrome runtime messaging contract closely enough for unit tests.
 *
 * @param {any} message
 * @param {object} [sender={}]
 * @param {function} [sendResponse]
 * @returns {boolean} whether any listener returned true (async)
 */
export function emitRuntimeMessage(message, sender = {}, sendResponse = () => {}) {
  if (!chrome || !chrome.runtime || !chrome.runtime.onMessage) {
    throw new Error('chrome.runtime.onMessage is not available (jest-chrome not initialized?)');
  }

  let async = false;
  const listeners = chrome.runtime.onMessage.listeners ? chrome.runtime.onMessage.listeners() : [];

  listeners.forEach(listener => {
    const result = listener(message, sender, sendResponse);
    if (result === true) {
      async = true;
    }
  });

  return async;
}
