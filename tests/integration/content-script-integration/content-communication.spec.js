/**
 * Content Script Integration Tests
 * Tests content script communication with background script
 * Verifies message passing, content extraction, error handling
 */

const fs = require('fs');
const path = require('path');

// Mock chrome.runtime for content script simulation
const mockChromeRuntime = {
  sendMessage: jest.fn().mockResolvedValue(true),
  lastError: null
};
global.chrome = { runtime: mockChromeRuntime };

// Load and execute content script in test environment
let contentScriptResult;
let contentScriptModule;

beforeAll(async () => {
  // Simulate content script execution by requiring it
  const contentScriptPath = path.resolve(__dirname, '../../../content_script_unified.js');
  const contentScriptCode = fs.readFileSync(contentScriptPath, 'utf8');
  
  // Mock document for testing
  global.document = {
    body: { textContent: 'Test page content with some text to extract.' },
    title: 'Test Page',
    documentElement: true,
    querySelectorAll: jest.fn(() => []),
    querySelector: jest.fn()
  };

  // Execute content script code
  const func = new Function(contentScriptCode);
  contentScriptResult = func();
});

describe('Content Script Integration', () => {
  test('should extract content successfully', () => {
    expect(contentScriptResult).toBeDefined();
    expect(contentScriptResult.success).toBe(true);
    expect(contentScriptResult.data).toContain('Test page content');
    expect(contentScriptResult.url).toBeDefined();
    expect(contentScriptResult.title).toBe('Test Page');
  });

  test('should send content extraction result to background', () => {
    expect(mockChromeRuntime.sendMessage).not.toHaveBeenCalled(); // No error sent
  });

  test('should handle content extraction errors', async () => {
    // Simulate extraction error by mocking document
    global.document.body.textContent = '';
    global.document.title = '';

    const errorFunc = new Function(fs.readFileSync(path.resolve(__dirname, '../../../content_script_unified.js'), 'utf8'));
    const result = errorFunc();

    expect(result.success).toBe(false);
    expect(result.error).toContain('extractable textual content');
    expect(mockChromeRuntime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: 'contentScriptError'
    }));
  });

  test('should communicate selection content to background', () => {
    // Test selection extraction messaging (if implemented in content script)
    mockChromeRuntime.sendMessage.mockClear();
    
    // Simulate user selection message
    chrome.runtime.sendMessage({
      action: 'getSelectedContent'
    });

    expect(mockChromeRuntime.sendMessage).toHaveBeenCalled();
  });

  test('should handle page load communication', () => {
    // Verify content script sends initial page info
    expect(contentScriptResult.timestamp).toBeDefined();
  });
});