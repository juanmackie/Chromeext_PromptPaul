/**
 * Simple Jest Setup without ES6 imports
 * Sets up basic testing environment for Chrome extension
 */

// Create simple Chrome mock without ES6 imports
const mockChrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      _listeners: [],
    },
    id: 'test-extension-id',
    getManifest: jest.fn(() => ({ name: 'Test Extension', version: '1.0.0' })),
    getURL: jest.fn(path => `chrome-extension://test-extension-id/${path}`),
    lastError: null,
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn(),
      _localData: {},
    },
    sync: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn(),
      _syncData: {},
    },
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      _listeners: [],
    },
  },
  contextMenus: {
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    removeAll: jest.fn(),
    onClicked: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      _clickListeners: [],
    },
    _menus: new Map(),
  },
  tabs: {
    query: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    sendMessage: jest.fn(),
    _tabs: [{ id: 1, url: 'http://localhost:3000', active: true }],
    _nextTabId: 2,
  },
  scripting: {
    executeScript: jest.fn(),
    insertCSS: jest.fn(),
    removeCSS: jest.fn(),
  },
  windows: {
    getCurrent: jest.fn(),
    create: jest.fn(),
    _nextWindowId: 2,
  },
  notifications: {
    create: jest.fn(),
    update: jest.fn(),
    clear: jest.fn(),
    _notifications: new Map(),
  },
};

// Helper functions
const mockChromeHelpers = {
  resetMocks: () => {
    jest.clearAllMocks();
    mockChrome.storage.local._localData = {};
    mockChrome.storage.sync._syncData = {};
    mockChrome.runtime._messageListeners = [];
    mockChrome.contextMenus._clickListeners = [];
    mockChrome.contextMenus._menus.clear();
    mockChrome.notifications._notifications.clear();
  },

  simulateMessage: (message, sender, sendResponse) => {
    const listeners = mockChrome.runtime.onMessage._listeners;
    const respond = sendResponse || jest.fn();

    listeners.forEach(listener => {
      try {
        listener(message, sender, respond);
      } catch (error) {
        console.error('Mock message listener error:', error);
      }
    });
  },

  simulateStorageChange: (changes, areaName) => {
    const listeners = mockChrome.storage.onChanged._listeners;
    listeners.forEach(listener => {
      try {
        listener(changes, areaName);
      } catch (error) {
        console.error('Mock storage change listener error:', error);
      }
    });
  },

  simulateContextMenuClick: (info, tab) => {
    const listeners = mockChrome.contextMenus.onClicked._clickListeners;
    listeners.forEach(listener => {
      try {
        listener(info, tab);
      } catch (error) {
        console.error('Mock context menu click error:', error);
      }
    });
  },
};

// Global setup
global.chrome = mockChrome;
global.mockChrome = mockChrome;
global.mockChromeHelpers = mockChromeHelpers;

// Reset mocks before each test
beforeEach(() => {
  mockChromeHelpers.resetMocks();
});

// Global test utilities
global.testUtils = {
  waitFor: (ms = 0) => new Promise(resolve => setTimeout(resolve, ms)),
  nextTick: () => new Promise(resolve => setImmediate(resolve)),

  createMockElement: (tag = 'div', attributes = {}) => {
    const element = {
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      innerHTML: '',
      style: {},
      dataset: {},
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      click: jest.fn(),
      focus: jest.fn(),
      blur: jest.fn(),
      querySelector: jest.fn(() => null),
      querySelectorAll: jest.fn(() => []),
      getAttribute: jest.fn(),
      setAttribute: jest.fn(),
      removeAttribute: jest.fn(),
      appendChild: jest.fn(),
      removeChild: jest.fn(),
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        contains: jest.fn(() => false),
        toggle: jest.fn(),
      },
      ...attributes,
    };

    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'id') element.id = value;
      else if (key === 'className') element.className = value;
      else if (key === 'textContent') element.textContent = value;
      else if (key === 'innerHTML') element.innerHTML = value;
      else element[key] = value;
    });

    return element;
  },

  createMockEvent: (type, properties = {}) => {
    return {
      type,
      bubbles: false,
      cancelable: false,
      defaultPrevented: false,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      ...properties,
    };
  },
};

// Mock console methods to reduce noise
const originalConsole = { ...console };
global.console = {
  ...originalConsole,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: originalConsole.error, // Keep errors for debugging
  group: jest.fn(),
  groupEnd: jest.fn(),
};

// Mock timers
jest.useFakeTimers();

// Increase timeout for async operations
jest.setTimeout(10000);
