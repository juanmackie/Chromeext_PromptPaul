/**
 * Unit Tests for MessageRenderer
 * Tests message rendering, markdown processing, and DOM manipulation
 */

import { MessageRenderer } from '../../../chat/message-renderer.js';
import { jest } from '@jest/globals';

// Mock DOM APIs
const mockElement = {
  id: '',
  className: '',
  innerHTML: '',
  textContent: '',
  scrollTop: 0,
  scrollHeight: 0,
  clientHeight: 0,
  style: {},
  dataset: {},
  classList: {
    add: jest.fn(),
    remove: jest.fn(),
    contains: jest.fn(() => false),
    toggle: jest.fn(),
  },
  appendChild: jest.fn(),
  removeChild: jest.fn(),
  querySelector: jest.fn(() => null),
  querySelectorAll: jest.fn(() => []),
  getAttribute: jest.fn(),
  setAttribute: jest.fn(),
  removeAttribute: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  click: jest.fn(),
  focus: jest.fn(),
  blur: jest.fn(),
};

const mockDocument = {
  getElementById: jest.fn(id => {
    const element = { ...mockElement, id };
    return element;
  }),
  createElement: jest.fn(() => mockElement),
  querySelector: jest.fn(() => null),
  querySelectorAll: jest.fn(() => []),
  body: {
    appendChild: jest.fn(),
  },
  createRange: jest.fn(() => ({
    selectNodeContents: jest.fn(),
    deleteContents: jest.fn(),
    insertNode: jest.fn(),
  })),
  createDocumentFragment: jest.fn(() => ({
    appendChild: jest.fn(),
    querySelector: jest.fn(() => null),
    querySelectorAll: jest.fn(() => []),
  })),
};

const mockWindow = {
  marked: {
    parse: jest.fn(text => `<p>${text}</p>`),
  },
  Prism: {
    highlight: jest.fn((code, lang) => `<code class="language-${lang}">${code}</code>`),
    highlightAll: jest.fn(),
  },
};

describe('MessageRenderer', () => {
  let messageRenderer;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set up global DOM mocks
    global.document = mockDocument;
    global.window = mockWindow;

    // Create renderer instance
    messageRenderer = new MessageRenderer();
  });

  describe('Initialization', () => {
    test('should instantiate MessageRenderer successfully', () => {
      expect(messageRenderer).toBeDefined();
    });

    test('should initialize with default configuration', () => {
      expect(messageRenderer.config).toBeDefined();
      expect(messageRenderer.config.enableMarkdown).toBe(true);
      expect(messageRenderer.config.enableSyntaxHighlighting).toBe(true);
      expect(messageRenderer.config.enableCodeBlocks).toBe(true);
      expect(messageRenderer.config.autoScroll).toBe(true);
      expect(messageRenderer.config.animationDuration).toBe(300);
    });

    test('should update configuration when provided', () => {
      const customConfig = {
        enableMarkdown: false,
        animationDuration: 500,
      };

      messageRenderer.updateConfig(customConfig);

      expect(messageRenderer.config.enableMarkdown).toBe(false);
      expect(messageRenderer.config.animationDuration).toBe(500);
    });
  });

  describe('DOM Element Management', () => {
    test('should find chat area element', () => {
      const chatArea = messageRenderer.getChatArea();
      expect(mockDocument.getElementById).toHaveBeenCalledWith('chat-area');
      expect(chatArea).toBeDefined();
    });

    test('should create message element with correct structure', () => {
      const message = {
        id: 'test-message-1',
        role: 'user',
        content: 'Hello world',
      };

      const messageElement = messageRenderer.createMessageElement(message);

      expect(messageElement.className).toContain('message');
      expect(messageElement.className).toContain('user');
      expect(messageElement.id).toBe('test-message-1');
      expect(messageElement.dataset.messageId).toBe('test-message-1');
      expect(messageElement.dataset.role).toBe('user');
    });

    test('should create assistant message element with correct styling', () => {
      const message = {
        id: 'test-message-2',
        role: 'assistant',
        content: 'Hi there!',
      };

      const messageElement = messageRenderer.createMessageElement(message);

      expect(messageElement.className).toContain('message');
      expect(messageElement.className).toContain('assistant');
      expect(messageElement.dataset.role).toBe('assistant');
    });

    test('should create message header with metadata', () => {
      const message = {
        id: 'test-message-3',
        role: 'user',
        content: 'Test message',
        timestamp: new Date('2024-01-01T12:00:00Z').toISOString(),
        model: 'claude-3-sonnet',
      };

      const headerElement = messageRenderer.createMessageHeader(message);

      expect(headerElement.className).toBe('message-header');
      expect(headerElement.textContent).toContain('User');
      expect(headerElement.textContent).toContain('2024-01-01');
      expect(headerElement.textContent).toContain('claude-3-sonnet');
    });

    test('should create message content element', () => {
      const content = 'This is test content';
      const contentElement = messageRenderer.createMessageContent(content);

      expect(contentElement.className).toBe('message-content');
      expect(contentElement.innerHTML).toBe(content);
    });
  });

  describe('Markdown Processing', () => {
    test('should process markdown when enabled', () => {
      const markdownText = '**Bold text** and *italic text*';
      const processedContent = messageRenderer.processContent(markdownText);

      expect(mockWindow.marked.parse).toHaveBeenCalledWith(markdownText);
      expect(processedContent).toBe('<p><strong>Bold text</strong> and <em>italic text</em></p>');
    });

    test('should return plain text when markdown disabled', () => {
      messageRenderer.updateConfig({ enableMarkdown: false });

      const plainText = 'Just plain text';
      const processedContent = messageRenderer.processContent(plainText);

      expect(mockWindow.marked.parse).not.toHaveBeenCalled();
      expect(processedContent).toBe(plainText);
    });

    test('should handle code blocks when syntax highlighting enabled', () => {
      const codeBlock = '```javascript\nconsole.log("Hello");\n```';

      messageRenderer.processContent(codeBlock);

      expect(mockWindow.Prism.highlight).toHaveBeenCalled();
    });

    test('should escape HTML in content when markdown disabled', () => {
      messageRenderer.updateConfig({ enableMarkdown: false });

      const contentWithHtml = '<script>alert("xss")</script>';
      const processedContent = messageRenderer.processContent(contentWithHtml);

      expect(processedContent).not.toContain('<script>');
      expect(processedContent).toContain('&lt;script&gt;');
    });
  });

  describe('Message Display', () => {
    test('should add message to chat area', () => {
      const message = {
        id: 'test-message-1',
        role: 'user',
        content: 'Hello world',
      };

      const chatArea = mockElement;
      mockDocument.getElementById.mockReturnValue(chatArea);

      const messageElement = messageRenderer.addMessage(message);

      expect(chatArea.appendChild).toHaveBeenCalledWith(messageElement);
      expect(messageElement.id).toBe('test-message-1');
    });

    test('should scroll to bottom after adding message when auto-scroll enabled', () => {
      const message = {
        id: 'test-message-1',
        role: 'user',
        content: 'Hello world',
      };

      const chatArea = {
        ...mockElement,
        scrollHeight: 1000,
        clientHeight: 500,
      };
      mockDocument.getElementById.mockReturnValue(chatArea);

      messageRenderer.addMessage(message);

      expect(chatArea.scrollTop).toBe(1000);
    });

    test('should not scroll to bottom when auto-scroll disabled', () => {
      messageRenderer.updateConfig({ autoScroll: false });

      const message = {
        id: 'test-message-1',
        role: 'user',
        content: 'Hello world',
      };

      const chatArea = mockElement;
      mockDocument.getElementById.mockReturnValue(chatArea);

      messageRenderer.addMessage(message);

      expect(chatArea.scrollTop).toBe(0);
    });

    test('should remove message from chat area', () => {
      const messageId = 'test-message-1';
      const messageElement = { ...mockElement, id: messageId };

      const chatArea = {
        ...mockElement,
        querySelector: jest.fn(() => messageElement),
        removeChild: jest.fn(),
      };
      mockDocument.getElementById.mockReturnValue(chatArea);

      messageRenderer.removeMessage(messageId);

      expect(chatArea.querySelector).toHaveBeenCalledWith(`#test-message-1`);
      expect(chatArea.removeChild).toHaveBeenCalledWith(messageElement);
    });

    test('should update message content', () => {
      const messageId = 'test-message-1';
      const newContent = 'Updated content';
      const messageElement = {
        ...mockElement,
        id: messageId,
        querySelector: jest.fn(() => ({ ...mockElement, innerHTML: '' })),
      };

      const chatArea = {
        ...mockElement,
        querySelector: jest.fn(() => messageElement),
      };
      mockDocument.getElementById.mockReturnValue(chatArea);

      messageRenderer.updateMessage(messageId, newContent);

      expect(chatArea.querySelector).toHaveBeenCalledWith(`#test-message-1`);
    });

    describe('addMessage with sender and options', () => {
      test('should add system message with isContext option', () => {
        const chatArea = { ...mockElement, appendChild: jest.fn() };
        mockDocument.getElementById.mockReturnValue(chatArea);
        mockDocument.createElement.mockReturnValue({ 
          ...mockElement, 
          classList: { add: jest.fn() },
          innerHTML: '',
          textContent: '',
          appendChild: jest.fn(),
          addEventListener: jest.fn(),
        });

        const result = messageRenderer.addMessage(
          'System',
          'Ready to chat about test tab. Content length: 100 characters.',
          { isContext: true, fullContent: 'Full tab content here' }
        );

        expect(chatArea.appendChild).toHaveBeenCalled();
        expect(result.messageDiv.className).toContain('message');
      });

      test('should add system message with isError option', () => {
        const chatArea = { ...mockElement, appendChild: jest.fn() };
        mockDocument.getElementById.mockReturnValue(chatArea);
        mockDocument.createElement.mockReturnValue({ 
          ...mockElement, 
          classList: { add: jest.fn() },
          innerHTML: '',
          textContent: '',
          appendChild: jest.fn(),
        });

        const result = messageRenderer.addMessage(
          'System',
          'Something went wrong',
          { isError: true }
        );

        expect(chatArea.appendChild).toHaveBeenCalled();
        expect(result.messageDiv.className).toContain('system-error');
      });

      test('should add system message with isHelp option', () => {
        const chatArea = { ...mockElement, appendChild: jest.fn() };
        mockDocument.getElementById.mockReturnValue(chatArea);
        mockDocument.createElement.mockReturnValue({ 
          ...mockElement, 
          classList: { add: jest.fn() },
          innerHTML: '',
          textContent: '',
          appendChild: jest.fn(),
        });

        const result = messageRenderer.addMessage(
          'System',
          'Here is some help information',
          { isHelp: true }
        );

        expect(chatArea.appendChild).toHaveBeenCalled();
        expect(result.messageDiv.className).toContain('system-help');
      });

      test('should add user message correctly', () => {
        const chatArea = { ...mockElement, appendChild: jest.fn() };
        mockDocument.getElementById.mockReturnValue(chatArea);

        const result = messageRenderer.addMessage('User', 'Hello world');

        expect(chatArea.appendChild).toHaveBeenCalled();
        expect(result.messageDiv.textContent).toContain('You: Hello world');
      });

      test('should add LLM message correctly', () => {
        const chatArea = { ...mockElement, appendChild: jest.fn() };
        mockDocument.getElementById.mockReturnValue(chatArea);
        mockDocument.createElement.mockReturnValue({ 
          ...mockElement, 
          classList: { add: jest.fn() },
          innerHTML: '',
          appendChild: jest.fn(),
        });

        const result = messageRenderer.addMessage('LLM', 'Here is your response');

        expect(chatArea.appendChild).toHaveBeenCalled();
        expect(result.messageDiv.className).toContain('llm-message');
      });
    });
  });

  describe('Streaming Support', () => {
    test('should create streaming message element', () => {
      const message = {
        id: 'streaming-message',
        role: 'assistant',
        content: '',
        streaming: true,
      };

      const messageElement = messageRenderer.createMessageElement(message);

      expect(messageElement.className).toContain('streaming');
      expect(messageElement.dataset.streaming).toBe('true');
    });

    test('should update streaming message content', () => {
      const messageId = 'streaming-message';
      const newChunk = 'New chunk of text';

      const contentElement = { ...mockElement, innerHTML: '' };
      const messageElement = {
        ...mockElement,
        id: messageId,
        querySelector: jest.fn(() => contentElement),
      };

      const chatArea = {
        ...mockElement,
        querySelector: jest.fn(() => messageElement),
      };
      mockDocument.getElementById.mockReturnValue(chatArea);

      messageRenderer.updateStreamingMessage(messageId, newChunk);

      expect(contentElement.innerHTML).toContain(newChunk);
    });

    test('should finalize streaming message', () => {
      const messageId = 'streaming-message';
      const messageElement = {
        ...mockElement,
        id: messageId,
        classList: {
          ...mockElement.classList,
          remove: jest.fn(),
        },
        dataset: { streaming: 'true' },
      };

      const chatArea = {
        ...mockElement,
        querySelector: jest.fn(() => messageElement),
      };
      mockDocument.getElementById.mockReturnValue(chatArea);

      messageRenderer.finalizeStreamingMessage(messageId);

      expect(messageElement.classList.remove).toHaveBeenCalledWith('streaming');
      expect(messageElement.dataset.streaming).toBe('false');
    });
  });

  describe('Error Message Rendering', () => {
    test('should render error message with proper styling', () => {
      const error = {
        message: 'Something went wrong',
        category: 'API_ERROR',
        severity: 'error',
      };

      const errorElement = messageRenderer.createErrorMessage(error);

      expect(errorElement.className).toContain('error-message');
      expect(errorElement.className).toContain('error');
      expect(errorElement.textContent).toContain('Something went wrong');
    });

    test('should add error message to chat', () => {
      const error = {
        message: 'Network error',
        category: 'NETWORK_ERROR',
      };

      const chatArea = mockElement;
      mockDocument.getElementById.mockReturnValue(chatArea);

      const errorElement = messageRenderer.addErrorMessage(error);

      expect(chatArea.appendChild).toHaveBeenCalledWith(errorElement);
      expect(errorElement.className).toContain('error-message');
    });
  });

  describe('Message Actions', () => {
    test('should create action buttons for assistant messages', () => {
      const message = {
        id: 'test-message-1',
        role: 'assistant',
        content: 'Here is some information',
      };

      const actionsElement = messageRenderer.createMessageActions(message);

      expect(actionsElement.className).toBe('message-actions');
      expect(actionsElement.querySelector).toHaveBeenCalledWith('.copy-button');
      expect(actionsElement.querySelector).toHaveBeenCalledWith('.regenerate-button');
    });

    test('should not create action buttons for user messages', () => {
      const message = {
        id: 'test-message-1',
        role: 'user',
        content: 'My question',
      };

      const actionsElement = messageRenderer.createMessageActions(message);

      expect(actionsElement).toBeNull();
    });

    test('should add copy functionality to message', () => {
      const message = {
        id: 'test-message-1',
        role: 'assistant',
        content: 'Copyable content',
      };

      const messageElement = messageRenderer.createMessageElement(message);
      const actionsElement = messageRenderer.createMessageActions(message);

      expect(actionsElement).toBeTruthy();
    });
  });

  describe('Code Highlighting', () => {
    test('should highlight code blocks when syntax highlighting enabled', () => {
      const codeContent = 'console.log("Hello");';
      const language = 'javascript';

      const highlightedCode = messageRenderer.highlightCode(codeContent, language);

      expect(mockWindow.Prism.highlight).toHaveBeenCalledWith(codeContent, language);
      expect(highlightedCode).toContain('language-javascript');
    });

    test('should return plain code when syntax highlighting disabled', () => {
      messageRenderer.updateConfig({ enableSyntaxHighlighting: false });

      const codeContent = 'console.log("Hello");';
      const highlightedCode = messageRenderer.highlightCode(codeContent, 'javascript');

      expect(mockWindow.Prism.highlight).not.toHaveBeenCalled();
      expect(highlightedCode).toBe(codeContent);
    });

    test('should detect code language from class name', () => {
      const codeBlock = '<pre><code class="language-python">print("Hello")</code></pre>';
      const language = messageRenderer.detectCodeLanguage(codeBlock);

      expect(language).toBe('python');
    });
  });

  describe('Performance and Optimization', () => {
    test('should debounce scroll events', () => {
      const scrollCallback = jest.fn();
      const debouncedCallback = messageRenderer.debounce(scrollCallback, 100);

      // Call multiple times quickly
      debouncedCallback();
      debouncedCallback();
      debouncedCallback();

      expect(scrollCallback).not.toHaveBeenCalled();

      // Fast forward time
      jest.advanceTimersByTime(100);

      expect(scrollCallback).toHaveBeenCalledTimes(1);
    });

    test('should throttle content updates during streaming', () => {
      const updateCallback = jest.fn();
      const throttledCallback = messageRenderer.throttle(updateCallback, 50);

      // Call multiple times quickly
      throttledCallback();
      throttledCallback();
      throttledCallback();

      expect(updateCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility', () => {
    test('should add ARIA labels to message elements', () => {
      const message = {
        id: 'test-message-1',
        role: 'assistant',
        content: 'Response message',
      };

      const messageElement = messageRenderer.createMessageElement(message);

      expect(messageElement.setAttribute).toHaveBeenCalledWith('role', 'article');
      expect(messageElement.setAttribute).toHaveBeenCalledWith(
        'aria-label',
        expect.stringContaining('assistant')
      );
    });

    test('should add ARIA live region for streaming messages', () => {
      const message = {
        id: 'streaming-message',
        role: 'assistant',
        content: '',
        streaming: true,
      };

      const messageElement = messageRenderer.createMessageElement(message);

      expect(messageElement.setAttribute).toHaveBeenCalledWith('aria-live', 'polite');
    });
  });

  describe('Theme Support', () => {
    test('should apply theme classes to message elements', () => {
      const message = {
        id: 'test-message-1',
        role: 'assistant',
        content: 'Message content',
      };

      // Mock dark theme
      global.document.documentElement.classList.add('dark-theme');

      const messageElement = messageRenderer.createMessageElement(message);

      expect(messageElement.className).toContain('dark-theme');
    });
  });

  describe('Cleanup and Memory Management', () => {
    test('should cleanup message elements when removed', () => {
      const messageId = 'test-message-1';
      const messageElement = {
        ...mockElement,
        id: messageId,
        querySelector: jest.fn(() => mockElement),
        removeEventListener: jest.fn(),
      };

      const chatArea = {
        ...mockElement,
        querySelector: jest.fn(() => messageElement),
        removeChild: jest.fn(),
      };
      mockDocument.getElementById.mockReturnValue(chatArea);

      messageRenderer.removeMessage(messageId);

      expect(messageElement.removeEventListener).toHaveBeenCalled();
    });

    test('should clear all messages', () => {
      const chatArea = {
        ...mockElement,
        innerHTML: '<div class="message">Old message</div>',
        querySelectorAll: jest.fn(() => [
          { ...mockElement, id: 'message-1' },
          { ...mockElement, id: 'message-2' },
        ]),
      };
      mockDocument.getElementById.mockReturnValue(chatArea);

      messageRenderer.clearAllMessages();

      expect(chatArea.innerHTML).toBe('');
    });
  });
});
