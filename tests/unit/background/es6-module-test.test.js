/**
 * Test to verify ES6 module imports work correctly
 * Tests basic functionality of importing and using background modules
 */

describe('ES6 Module Integration Test', () => {
  // Mock modules at the top level
  const {
    errorHandler,
    ErrorSeverity,
    ErrorCategory,
  } = require('../../mocks/error-handler.mock.js');
  const analytics = require('../../mocks/analytics.mock.js');

  test('should import error handler mock correctly', () => {
    expect(errorHandler).toBeDefined();
    expect(ErrorSeverity).toBeDefined();
    expect(ErrorCategory).toBeDefined();
    expect(typeof errorHandler.handle).toBe('function');
  });

  test('should import analytics mock correctly', () => {
    expect(analytics).toBeDefined();
    expect(typeof analytics.track).toBe('function');
    expect(typeof analytics.trackContextMenuClick).toBe('function');
  });

  test('should import chrome APIs correctly', () => {
    expect(global.chrome).toBeDefined();
    expect(global.chrome.contextMenus).toBeDefined();
    expect(global.chrome.runtime).toBeDefined();
    expect(global.chrome.storage).toBeDefined();
  });

  test('should handle mock functionality', () => {
    const mockError = new Error('Test error');

    const result = errorHandler.handle(mockError, { test: 'context' });

    expect(errorHandler.handle).toHaveBeenCalledWith(mockError, { test: 'context' });
    expect(result).toBeDefined();
  });

  test('should track analytics events correctly', () => {
    analytics.trackContextMenuClick('test-menu', { test: 'data' });

    expect(analytics.trackContextMenuClick).toHaveBeenCalledWith('test-menu', { test: 'data' });
  });

  test('should verify chrome helpers are available', () => {
    expect(global.mockChromeHelpers).toBeDefined();
    expect(typeof global.mockChromeHelpers.resetMocks).toBe('function');
    expect(typeof global.mockChromeHelpers.simulateMessage).toBe('function');
  });

  test('should reset chrome mocks properly', () => {
    global.mockChromeHelpers.resetMocks();

    expect(chrome.runtime._messageListeners).toEqual([]);
    expect(chrome.storage._localData).toEqual({});
    expect(chrome.contextMenus._menus.size).toBe(0);
  });
});
