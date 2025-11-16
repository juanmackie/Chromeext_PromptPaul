/**
 * Chrome API Mocking for Chrome Extension Testing (CommonJS)
 * Provides comprehensive mocking for all Chrome extension APIs used in the application
 */

// Create enhanced Chrome API mock with full feature support
const createMockChrome = () => ({
  // Runtime API - Core extension messaging and lifecycle
  runtime: {
    // Message passing
    sendMessage: jest.fn().mockResolvedValue({}),
    onMessage: {
      addListener: jest.fn((callback) => {
        // Store callback for testing
        mockChrome.runtime._messageListeners.push(callback);
        return () => {
          const index = mockChrome.runtime._messageListeners.indexOf(callback);
          if (index > -1) {
            mockChrome.runtime._messageListeners.splice(index, 1);
          }
        };
      }),
      removeListener: jest.fn(),
      hasListener: jest.fn(),
      _messageListeners: []
    },

    // Extension information
    id: 'test-extension-id',
    getManifest: jest.fn(() => ({
      name: 'Test Extension',
      version: '1.0.0',
      manifest_version: 3
    })),

    // URL utilities
    getURL: jest.fn((path) => `chrome-extension://test-extension-id/${path}`),

    // Extension lifecycle
    onInstalled: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onStartup: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onSuspend: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },

    // Platform and environment
    getPlatformInfo: jest.fn().mockResolvedValue({
      os: 'win',
      arch: 'x86-64',
      nacl_arch: 'x86-64'
    }),

    // Error handling
    lastError: null,

    // Background context
    getBackgroundPage: jest.fn().mockImplementation(() => {
      return Promise.resolve({
        chrome: mockChrome
      });
    }),

    // Open extension URL
    openOptionsPage: jest.fn()
  },

  // Storage API - Data persistence
  storage: {
    // Local storage (per computer)
    local: {
      get: jest.fn((keys, callback) => {
        const result = mockChrome.storage._localData;
        if (callback) {
          callback(result);
        }
        return Promise.resolve(result);
      }),
      set: jest.fn((items, callback) => {
        Object.assign(mockChrome.storage._localData, items);
        if (callback) callback();
        // Trigger storage change event
        mockChrome.storage.onChanged._listeners.forEach(listener => {
          listener({ [Object.keys(items)[0]]: { newValue: items[Object.keys(items)[0]] } }, 'local');
        });
        return Promise.resolve();
      }),
      remove: jest.fn((keys, callback) => {
        if (Array.isArray(keys)) {
          keys.forEach(key => delete mockChrome.storage._localData[key]);
        } else {
          delete mockChrome.storage._localData[keys];
        }
        if (callback) callback();
        return Promise.resolve();
      }),
      clear: jest.fn((callback) => {
        mockChrome.storage._localData = {};
        if (callback) callback();
        return Promise.resolve();
      }),
      _localData: {}
    },

    // Sync storage (cross-device)
    sync: {
      get: jest.fn((keys, callback) => {
        const result = mockChrome.storage._syncData;
        if (callback) {
          callback(result);
        }
        return Promise.resolve(result);
      }),
      set: jest.fn((items, callback) => {
        Object.assign(mockChrome.storage._syncData, items);
        if (callback) callback();
        // Trigger storage change event
        mockChrome.storage.onChanged._listeners.forEach(listener => {
          listener({ [Object.keys(items)[0]]: { newValue: items[Object.keys(items)[0]] } }, 'sync');
        });
        return Promise.resolve();
      }),
      remove: jest.fn((keys, callback) => {
        if (Array.isArray(keys)) {
          keys.forEach(key => delete mockChrome.storage._syncData[key]);
        } else {
          delete mockChrome.storage._syncData[keys];
        }
        if (callback) callback();
        return Promise.resolve();
      }),
      clear: jest.fn((callback) => {
        mockChrome.storage._syncData = {};
        if (callback) callback();
        return Promise.resolve();
      }),
      _syncData: {}
    },

    // Storage change events
    onChanged: {
      addListener: jest.fn((callback) => {
        mockChrome.storage.onChanged._listeners.push(callback);
        return () => {
          const index = mockChrome.storage.onChanged._listeners.indexOf(callback);
          if (index > -1) {
            mockChrome.storage.onChanged._listeners.splice(index, 1);
          }
        };
      }),
      removeListener: jest.fn(),
      _listeners: []
    },

    // Storage quota and usage
    getBytesInUse: jest.fn().mockResolvedValue(1024),
    getQuotaBytes: jest.fn().mockResolvedValue(1048576) // 1MB
  },

  // Context Menus API - Right-click menu integration
  contextMenus: {
    create: jest.fn((createProperties, callback) => {
      const id = createProperties.id || `menu-${Date.now()}`;
      mockChrome.contextMenus._menus.set(id, createProperties);
      if (callback) callback();
      return Promise.resolve();
    }),
    update: jest.fn((id, updateProperties, callback) => {
      if (mockChrome.contextMenus._menus.has(id)) {
        Object.assign(mockChrome.contextMenus._menus.get(id), updateProperties);
      }
      if (callback) callback();
      return Promise.resolve();
    }),
    remove: jest.fn((menuItemId, callback) => {
      mockChrome.contextMenus._menus.delete(menuItemId);
      if (callback) callback();
      return Promise.resolve();
    }),
    removeAll: jest.fn((callback) => {
      mockChrome.contextMenus._menus.clear();
      if (callback) callback();
      return Promise.resolve();
    }),

    // Event handling
    onClicked: {
      addListener: jest.fn((callback) => {
        mockChrome.contextMenus._clickListeners.push(callback);
        return () => {
          const index = mockChrome.contextMenus._clickListeners.indexOf(callback);
          if (index > -1) {
            mockChrome.contextMenus._clickListeners.splice(index, 1);
          }
        };
      }),
      removeListener: jest.fn(),
      _clickListeners: []
    },

    // Internal state
    _menus: new Map()
  },

  // Tabs API - Browser tab management
  tabs: {
    query: jest.fn((queryInfo, callback) => {
      const tabs = mockChrome.tabs._tabs.filter(tab => {
        if (queryInfo.active) return tab.active;
        if (queryInfo.currentWindow) return tab.currentWindow;
        return true;
      });
      if (callback) callback(tabs);
      return Promise.resolve(tabs);
    }),
    get: jest.fn((tabId, callback) => {
      const tab = mockChrome.tabs._tabs.find(t => t.id === tabId);
      if (callback) callback(tab);
      return Promise.resolve(tab);
    }),
    create: jest.fn((createProperties, callback) => {
      const tab = {
        id: mockChrome.tabs._nextTabId++,
        url: createProperties.url || 'about:blank',
        active: createProperties.active !== false,
        currentWindow: true,
        windowId: 1,
        title: 'New Tab'
      };
      mockChrome.tabs._tabs.push(tab);
      if (callback) callback(tab);
      return Promise.resolve(tab);
    }),
    update: jest.fn((tabId, updateProperties, callback) => {
      const tab = mockChrome.tabs._tabs.find(t => t.id === tabId);
      if (tab) {
        Object.assign(tab, updateProperties);
      }
      if (callback) callback(tab);
      return Promise.resolve(tab);
    }),
    sendMessage: jest.fn((tabId, message, options, callback) => {
      const response = { success: true, data: null };
      if (callback) callback(response);
      return Promise.resolve(response);
    }),

    // Internal state
    _tabs: [
      {
        id: 1,
        url: 'http://localhost:3000',
        active: true,
        currentWindow: true,
        windowId: 1,
        title: 'Test Tab'
      }
    ],
    _nextTabId: 2
  },

  // Scripting API - Content script injection
  scripting: {
    executeScript: jest.fn((injection, callback) => {
      const result = [];
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
    insertCSS: jest.fn((injection, callback) => {
      if (callback) callback();
      return Promise.resolve();
    }),
    removeCSS: jest.fn((injection, callback) => {
      if (callback) callback();
      return Promise.resolve();
    })
  },

  // Windows API - Browser window management
  windows: {
    getCurrent: jest.fn((callback) => {
      const window = {
        id: 1,
        focused: true,
        top: 0,
        left: 0,
        width: 1920,
        height: 1080,
        tabs: mockChrome.tabs._tabs
      };
      if (callback) callback(window);
      return Promise.resolve(window);
    }),
    create: jest.fn((createData, callback) => {
      const window = {
        id: mockChrome.windows._nextWindowId++,
        focused: createData.focused !== false,
        top: 0,
        left: 0,
        width: createData.width || 1920,
        height: createData.height || 1080,
        tabs: []
      };
      if (callback) callback(window);
      return Promise.resolve(window);
    }),

    // Internal state
    _nextWindowId: 2
  },

  // Notifications API - Browser notifications
  notifications: {
    create: jest.fn((notificationId, options, callback) => {
      const id = notificationId || `notification-${Date.now()}`;
      mockChrome.notifications._notifications.set(id, options);
      if (callback) callback(id);
      return Promise.resolve(id);
    }),
    update: jest.fn((notificationId, options, callback) => {
      if (mockChrome.notifications._notifications.has(notificationId)) {
        Object.assign(mockChrome.notifications._notifications.get(notificationId), options);
      }
      if (callback) callback(true);
      return Promise.resolve(true);
    }),
    clear: jest.fn((notificationId, callback) => {
      const wasCleared = mockChrome.notifications._notifications.has(notificationId);
      mockChrome.notifications._notifications.delete(notificationId);
      if (callback) callback(wasCleared);
      return Promise.resolve(wasCleared);
    }),
    getAll: jest.fn((callback) => {
      const notifications = Array.from(mockChrome.notifications._notifications.entries())
        .map(([id, options]) => ({ id, ...options }));
      if (callback) callback(notifications);
      return Promise.resolve(notifications);
    }),

    // Internal state
    _notifications: new Map()
  }
});

// Global mock Chrome instance
const mockChrome = createMockChrome();

// Helper functions for testing
const mockChromeHelpers = {
  // Reset all mock state
  resetMocks: () => {
    jest.clearAllMocks();

    // Reset storage data
    mockChrome.storage._localData = {};
    mockChrome.storage._syncData = {};

    // Clear listeners
    mockChrome.runtime._messageListeners = [];
    mockChrome.storage.onChanged._listeners = [];
    mockChrome.contextMenus._clickListeners = [];

    // Reset other state
    mockChrome.contextMenus._menus.clear();
    mockChrome.notifications._notifications.clear();

    // Reset tabs
    mockChrome.tabs._tabs = [
      {
        id: 1,
        url: 'http://localhost:3000',
        active: true,
        currentWindow: true,
        windowId: 1,
        title: 'Test Tab'
      }
    ];
    mockChrome.tabs._nextTabId = 2;
    mockChrome.windows._nextWindowId = 2;
  },

  // Simulate receiving a Chrome message
  simulateMessage: (message, sender, sendResponse) => {
    const listeners = mockChrome.runtime._messageListeners;
    const respond = sendResponse || jest.fn();

    // Call each listener with the message
    listeners.forEach(listener => {
      try {
        const result = listener(message, sender, respond);
        // If listener returns true, it's handling asynchronously
        if (result !== true) {
          // Synchronous response
          respond();
        }
      } catch (error) {
        console.error('Mock message listener error:', error);
      }
    });
  },

  // Simulate context menu click
  simulateContextMenuClick: (info, tab) => {
    const listeners = mockChrome.contextMenus._clickListeners;
    listeners.forEach(listener => {
      try {
        listener(info, tab);
      } catch (error) {
        console.error('Mock context menu click error:', error);
      }
    });
  },

  // Set up storage data for testing
  setStorageData: (data, storageArea = 'local') => {
    Object.assign(mockChrome.storage[`${storageArea}Data`], data);
  },

  // Get storage data for testing
  getStorageData: (storageArea = 'local') => {
    return { ...mockChrome.storage[`${storageArea}Data`] };
  }
};

// Export for CommonJS
module.exports = {
  createMockChrome,
  mockChrome,
  mockChromeHelpers
};