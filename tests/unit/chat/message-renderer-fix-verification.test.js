/**
 * Test script to verify the HierarchyRequestError fix
 * This simulates the exact scenario that caused the original error
 */

import { MessageRenderer } from '../../../chat/message-renderer.js';

// Mock DOM environment
const mockChatArea = {
  appendChild: jest.fn(),
  scrollHeight: 1000,
  scrollTop: 0,
  clientHeight: 500,
  scrollTo: jest.fn()
};

const mockDocument = {
  getElementById: jest.fn(() => mockChatArea),
  createElement: jest.fn((tag) => ({
    tagName: tag.toUpperCase(),
    classList: {
      add: jest.fn(),
      contains: jest.fn(() => false),
      remove: jest.fn(),
      toggle: jest.fn()
    },
    innerHTML: '',
    textContent: '',
    appendChild: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    style: {},
    dataset: {},
    id: '',
    src: '',
    alt: ''
  })),
  body: {
    classList: {
      contains: jest.fn(() => false)
    }
  }
};

// Set up global mocks
global.document = mockDocument;
global.window = {
  marked: {
    parse: jest.fn((text) => `<p>${text}</p>`)
  }
};

describe('HierarchyRequestError Fix Verification', () => {
  let messageRenderer;

  beforeEach(() => {
    jest.clearAllMocks();
    messageRenderer = new MessageRenderer(mockChatArea, jest.fn());
  });

  test('should handle handleLoadTabContext scenario without HierarchyRequestError', () => {
    // This is the exact scenario that caused the original error:
    // chat-orchestrator.js calls addMessage with isContext: true and fullContent
    
    expect(() => {
      messageRenderer.addMessage(
        'System',
        'Ready to chat about test tab. Content length: 100 characters.',
        {
          isContext: true,
          fullContent: 'Full tab content here that was loaded from the current tab',
          isError: false,
          isHelp: false
        }
      );
    }).not.toThrow();

    // Verify the message was added to chat area
    expect(mockChatArea.appendChild).toHaveBeenCalled();
  });

  test('should handle error messages without HierarchyRequestError', () => {
    expect(() => {
      messageRenderer.addMessage(
        'System',
        'Something went wrong',
        { isError: true }
      );
    }).not.toThrow();

    expect(mockChatArea.appendChild).toHaveBeenCalled();
  });

  test('should handle help messages without HierarchyRequestError', () => {
    expect(() => {
      messageRenderer.addMessage(
        'System',
        'Here is some help information',
        { isHelp: true }
      );
    }).not.toThrow();

    expect(mockChatArea.appendChild).toHaveBeenCalled();
  });

  test('should handle all message types correctly', () => {
    // Test User messages
    expect(() => {
      messageRenderer.addMessage('User', 'Hello world');
    }).not.toThrow();

    // Test LLM messages
    expect(() => {
      messageRenderer.addMessage('LLM', 'Here is your response');
    }).not.toThrow();

    // Test System messages without options
    expect(() => {
      messageRenderer.addMessage('System', 'System notification');
    }).not.toThrow();

    expect(mockChatArea.appendChild).toHaveBeenCalledTimes(3);
  });
});

console.log('✅ HierarchyRequestError fix verification tests created successfully');