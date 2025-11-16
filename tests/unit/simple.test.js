/**
 * Simple test to verify Jest is working correctly
 * Tests basic functionality without ES6 module complications
 */

describe('Basic Test Infrastructure', () => {
  test('should run a simple test', () => {
    expect(1 + 1).toBe(2);
  });

  test('should have mock Chrome APIs available', () => {
    expect(global.chrome).toBeDefined();
    expect(global.chrome.runtime).toBeDefined();
    expect(global.chrome.storage).toBeDefined();
  });

  test('should have DOM APIs available', () => {
    expect(document).toBeDefined();
    expect(window).toBeDefined();
    expect(document.createElement).toBeDefined();
  });

  test('should be able to mock functions', () => {
    const mockFunction = jest.fn(() => 'mocked result');
    const result = mockFunction();

    expect(mockFunction).toHaveBeenCalled();
    expect(result).toBe('mocked result');
  });

  test('should handle async/await', async () => {
    const asyncFunction = jest.fn().mockResolvedValue('async result');
    const result = await asyncFunction();

    expect(asyncFunction).toHaveBeenCalled();
    expect(result).toBe('async result');
  });

  test('should handle DOM manipulation', () => {
    const element = document.createElement('div');
    element.id = 'test-element';
    element.textContent = 'Test Content';

    expect(element.id).toBe('test-element');
    expect(element.textContent).toBe('Test Content');
  });

  test('should handle Chrome API mocks', () => {
    const mockCallback = jest.fn();

    // Test runtime.sendMessage
    chrome.runtime.sendMessage({ action: 'test' }, mockCallback);
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();

    // Test storage.local.get
    chrome.storage.local.get(['test-key'], mockCallback);
    expect(chrome.storage.local.get).toHaveBeenCalledWith(['test-key'], mockCallback);
  });

  test('should support timer mocking', () => {
    jest.useFakeTimers();

    const callback = jest.fn();
    setTimeout(callback, 1000);

    expect(callback).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalled();

    jest.useRealTimers();
  });

  test('should handle error scenarios', () => {
    const errorFunction = jest.fn(() => {
      throw new Error('Test error');
    });

    expect(() => errorFunction()).toThrow('Test error');
  });

  test('should support object mocking', () => {
    const mockObject = {
      method1: jest.fn().mockReturnValue('result1'),
      method2: jest.fn().mockReturnValue('result2')
    };

    expect(mockObject.method1()).toBe('result1');
    expect(mockObject.method2()).toBe('result2');
    expect(mockObject.method1).toHaveBeenCalled();
    expect(mockObject.method2).toHaveBeenCalled();
  });
});

describe('Chrome Extension Specific Tests', () => {
  test('should mock Chrome extension APIs correctly', () => {
    // Test context menu API
    chrome.contextMenus.create({ id: 'test-menu', title: 'Test Menu' });
    expect(chrome.contextMenus.create).toHaveBeenCalled();

    // Test tabs API
    chrome.tabs.query({ active: true }, jest.fn());
    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true }, expect.any(Function));

    // Test storage API
    chrome.storage.local.set({ testKey: 'testValue' }, jest.fn());
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ testKey: 'testValue' }, expect.any(Function));
  });

  test('should handle Chrome extension message passing', () => {
    const mockListener = jest.fn();

    // Add a message listener
    chrome.runtime.onMessage.addListener(mockListener);
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledWith(mockListener);

    // Simulate receiving a message
    mockChromeHelpers.simulateMessage(
      { action: 'test', data: 'test-data' },
      { tab: { id: 1 } },
      jest.fn()
    );
  });

  test('should handle Chrome storage events', () => {
    const mockStorageListener = jest.fn();

    // Add storage change listener
    chrome.storage.onChanged.addListener(mockStorageListener);
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalledWith(mockStorageListener);

    // Simulate storage change
    mockChromeHelpers.simulateStorageChange({ testKey: { newValue: 'newValue' } }, 'local');
  });
});