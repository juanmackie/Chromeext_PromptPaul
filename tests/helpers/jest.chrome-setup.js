const jestChrome = require("jest-chrome");

// Expose chrome globally for all tests using jest-chrome.
if (typeof global !== "undefined") {
  global.chrome = global.chrome || jestChrome;
}

// Polyfill chrome.flush if not provided by the installed jest-chrome version.
if (typeof chrome.flush !== "function") {
  chrome.flush = () => {
    // Minimal safe reset: clear common mocks if present.
    Object.keys(chrome).forEach((key) => {
      const api = chrome[key];
      if (api && typeof api === "object") {
        Object.keys(api).forEach((prop) => {
          const val = api[prop];
          if (val && typeof val.mockClear === "function") {
            val.mockClear();
          }
        });
      }
    });
  };
}

// Ensure we start from a clean mocked Chrome API state before each test.
beforeEach(() => {
  jest.clearAllMocks();
  // Avoid jest.resetModules() here; it interferes with dynamic imports in tests.
  chrome.flush();
});

// Also clean up after each test to avoid cross-test pollution.
afterEach(() => {
  chrome.flush();
});