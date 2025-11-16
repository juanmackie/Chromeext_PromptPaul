/**
 * Unit Tests for StreamingManager
 * Tests streaming response handling, chunk processing, and real-time updates
 */

import { StreamingManager } from '../../../chat/streaming-manager.js';
import { jest } from '@jest/globals';

// Mock DOM APIs and dependencies
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
    toggle: jest.fn()
  },
  appendChild: jest.fn(),
  removeChild: jest.fn(),
  querySelector: jest.fn(() => null),
  querySelectorAll: jest.fn(() => []),
  getAttribute: jest.fn(),
  setAttribute: jest.fn(),
  removeAttribute: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn()
};

const mockDocument = {
  getElementById: jest.fn((id) => {
    const element = { ...mockElement, id };
    return element;
  }),
  createElement: jest.fn(() => mockElement),
  querySelector: jest.fn(() => null),
  querySelectorAll: jest.fn(() => []),
  body: { appendChild: jest.fn() }
};

const mockWindow = {
  TextDecoder: class MockTextDecoder {
    constructor(encoding = 'utf-8') {
      this.encoding = encoding;
    }
    decode(buffer) {
      if (typeof buffer === 'string') return buffer;
      if (buffer instanceof Uint8Array) {
        return new TextDecoder().decode(buffer);
      }
      return '';
    }
  },
  ReadableStream: class MockReadableStream {
    constructor() {
      this.reader = {
        read: jest.fn().mockResolvedValue({ done: true }),
        releaseLock: jest.fn()
      };
    }
    getReader() {
      return this.reader;
    }
  }
};

// Mock fetch response
const createMockResponse = (chunks, options = {}) => {
  let chunkIndex = 0;

  const reader = {
    read: jest.fn().mockImplementation(async () => {
      if (chunkIndex >= chunks.length) {
        return { done: true };
      }
      return {
        done: false,
        value: new TextEncoder().encode(chunks[chunkIndex++])
      };
    }),
    releaseLock: jest.fn()
  };

  const response = {
    ok: true,
    status: 200,
    headers: new Map([
      ['content-type', 'text/event-stream'],
      ['cache-control', 'no-cache']
    ]),
    body: {
      getReader: () => reader
    },
    reader
  };

  return response;
};

describe('StreamingManager', () => {
  let streamingManager;
  let mockMessageRenderer;
  let mockConversationManager;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set up global mocks
    global.document = mockDocument;
    global.window = mockWindow;
    global.TextEncoder = class MockTextEncoder {
      encode(text) {
        return new Uint8Array(Array.from(text).map(char => char.charCodeAt(0)));
      }
    };

    // Mock dependencies
    mockMessageRenderer = {
      createMessageElement: jest.fn(() => mockElement),
      addMessage: jest.fn(() => mockElement),
      updateStreamingMessage: jest.fn(),
      finalizeStreamingMessage: jest.fn(),
      processContent: jest.fn((content) => content)
    };

    mockConversationManager = {
      addMessage: jest.fn(),
      updateMessage: jest.fn(),
      getCurrentConversation: jest.fn(() => ({ id: 'test-conversation' }))
    };

    // Create streaming manager instance
    streamingManager = new StreamingManager(mockMessageRenderer, mockConversationManager);
  });

  describe('Initialization', () => {
    test('should instantiate StreamingManager successfully', () => {
      expect(streamingManager).toBeDefined();
      expect(streamingManager.messageRenderer).toBe(mockMessageRenderer);
      expect(streamingManager.conversationManager).toBe(mockConversationManager);
    });

    test('should initialize with default configuration', () => {
      expect(streamingManager.config.chunkTimeout).toBe(5000);
      expect(streamingManager.config.maxRetries).toBe(3);
      expect(streamingManager.config.retryDelay).toBe(1000);
      expect(streamingManager.config.enableMarkdown).toBe(true);
      expect(streamingManager.config.autoScroll).toBe(true);
    });

    test('should update configuration when provided', () => {
      const customConfig = {
        chunkTimeout: 10000,
        maxRetries: 5,
        enableMarkdown: false
      };

      streamingManager.updateConfig(customConfig);

      expect(streamingManager.config.chunkTimeout).toBe(10000);
      expect(streamingManager.config.maxRetries).toBe(5);
      expect(streamingManager.config.enableMarkdown).toBe(false);
    });
  });

  describe('Stream Processing', () => {
    test('should start streaming with initial message', async () => {
      const messageId = 'test-message-1';
      const response = createMockResponse(['Hello', ' world']);

      const result = await streamingManager.startStreaming(messageId, response);

      expect(mockMessageRenderer.createMessageElement).toHaveBeenCalledWith({
        id: messageId,
        role: 'assistant',
        content: '',
        streaming: true
      });
      expect(mockMessageRenderer.addMessage).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    test('should process text chunks correctly', async () => {
      const messageId = 'test-message-1';
      const chunks = ['Hello', ' ', 'world', '!'];
      const response = createMockResponse(chunks);

      await streamingManager.startStreaming(messageId, response);

      expect(mockMessageRenderer.updateStreamingMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringContaining('Hello')
      );
      expect(mockMessageRenderer.finalizeStreamingMessage).toHaveBeenCalledWith(messageId);
    });

    test('should handle SSE formatted chunks', async () => {
      const sseChunks = [
        'data: Hello\n\n',
        'data: world\n\n',
        'data: [DONE]\n\n'
      ];
      const response = createMockResponse(sseChunks);

      await streamingManager.startStreaming('test-message-1', response);

      expect(mockMessageRenderer.updateStreamingMessage).toHaveBeenCalledWith(
        'test-message-1',
        expect.stringContaining('Hello')
      );
    });

    test('should process JSON formatted chunks', async () => {
      const jsonChunks = [
        '{"content": "Hello"}',
        '{"content": " world"}'
      ];
      const response = createMockResponse(jsonChunks);

      streamingManager.updateConfig({ format: 'json' });

      await streamingManager.startStreaming('test-message-1', response);

      expect(mockMessageRenderer.updateStreamingMessage).toHaveBeenCalledWith(
        'test-message-1',
        expect.stringContaining('Hello')
      );
    });

    test('should handle empty chunks gracefully', async () => {
      const response = createMockResponse(['', 'Hello', '', 'world']);

      await streamingManager.startStreaming('test-message-1', response);

      expect(mockMessageRenderer.updateStreamingMessage).toHaveBeenCalledWith(
        'test-message-1',
        expect.stringContaining('Hello')
      );
    });

    test('should stop on [DONE] marker', async () => {
      const chunks = [
        'Hello',
        'world',
        '[DONE]',
        'This should not appear'
      ];
      const response = createMockResponse(chunks);

      await streamingManager.startStreaming('test-message-1', response);

      expect(mockMessageRenderer.finalizeStreamingMessage).toHaveBeenCalledWith('test-message-1');
      expect(mockMessageRenderer.updateStreamingMessage).not.toHaveBeenCalledWith(
        'test-message-1',
        expect.stringContaining('This should not appear')
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle network errors during streaming', async () => {
      const response = {
        ok: false,
        status: 500,
        body: null
      };

      await expect(
        streamingManager.startStreaming('test-message-1', response)
      ).rejects.toThrow();

      expect(mockMessageRenderer.finalizeStreamingMessage).toHaveBeenCalledWith('test-message-1');
    });

    test('should handle timeout errors', async () => {
      streamingManager.updateConfig({ chunkTimeout: 100 });

      const reader = {
        read: jest.fn().mockImplementation(async () => {
          // Simulate long delay
          await new Promise(resolve => setTimeout(resolve, 200));
          return { done: false, value: new Uint8Array([72]) }; // 'H'
        }),
        releaseLock: jest.fn()
      };

      const response = {
        ok: true,
        body: { getReader: () => reader }
      };

      await expect(
        streamingManager.startStreaming('test-message-1', response)
      ).rejects.toThrow('Stream timeout');
    });

    test('should handle malformed JSON chunks', async () => {
      const malformedJson = '{"invalid": json}';
      const response = createMockResponse([malformedJson]);

      streamingManager.updateConfig({ format: 'json' });

      // Should not throw, but handle gracefully
      await expect(
        streamingManager.startStreaming('test-message-1', response)
      ).resolves.toBeDefined();
    });

    test('should retry on stream errors when configured', async () => {
      streamingManager.updateConfig({ maxRetries: 2 });

      const reader = {
        read: jest.fn()
          .mockRejectedValueOnce(new Error('Stream error'))
          .mockResolvedValueOnce({ done: true }),
        releaseLock: jest.fn()
      };

      const response = {
        ok: true,
        body: { getReader: () => reader }
      };

      await expect(
        streamingManager.startStreaming('test-message-1', response)
      ).resolves.toBeDefined();

      expect(reader.read).toHaveBeenCalledTimes(2); // Initial + retry
    });
  });

  describe('Stream State Management', () => {
    test('should track active streams', () => {
      const messageId = 'test-message-1';
      const response = createMockResponse(['Hello']);

      streamingManager.startStreaming(messageId, response);

      expect(streamingManager.activeStreams.has(messageId)).toBe(true);
    });

    test('should remove completed streams from active tracking', async () => {
      const messageId = 'test-message-1';
      const response = createMockResponse(['Hello', '[DONE]']);

      await streamingManager.startStreaming(messageId, response);

      expect(streamingManager.activeStreams.has(messageId)).toBe(false);
    });

    test('should stop active stream', () => {
      const messageId = 'test-message-1';
      const response = createMockResponse(['Hello']);
      const reader = response.reader;

      // Start streaming
      streamingManager.startStreaming(messageId, response);
      expect(streamingManager.activeStreams.has(messageId)).toBe(true);

      // Stop streaming
      streamingManager.stopStreaming(messageId);
      expect(streamingManager.activeStreams.has(messageId)).toBe(false);
      expect(reader.releaseLock).toHaveBeenCalled();
    });

    test('should stop all active streams', () => {
      const response1 = createMockResponse(['Hello']);
      const response2 = createMockResponse(['World']);

      streamingManager.startStreaming('message-1', response1);
      streamingManager.startStreaming('message-2', response2);

      expect(streamingManager.activeStreams.size).toBe(2);

      streamingManager.stopAllStreams();

      expect(streamingManager.activeStreams.size).toBe(0);
    });
  });

  describe('Content Processing', () => {
    test('should accumulate content correctly', async () => {
      const messageId = 'test-message-1';
      const chunks = ['Hello', ' ', 'world', '!'];
      const response = createMockResponse(chunks);

      await streamingManager.startStreaming(messageId, response);

      expect(mockMessageRenderer.updateStreamingMessage).toHaveBeenCalledWith(
        messageId,
        'Hello'
      );
      expect(mockMessageRenderer.updateStreamingMessage).toHaveBeenCalledWith(
        messageId,
        'Hello '
      );
      expect(mockMessageRenderer.updateStreamingMessage).toHaveBeenCalledWith(
        messageId,
        'Hello world'
      );
      expect(mockMessageRenderer.updateStreamingMessage).toHaveBeenCalledWith(
        messageId,
        'Hello world!'
      );
    });

    test('should process markdown when enabled', async () => {
      const messageId = 'test-message-1';
      const markdownChunks = ['**Hello**', ' *world*!'];
      const response = createMockResponse(markdownChunks);

      await streamingManager.startStreaming(messageId, response);

      expect(mockMessageRenderer.processContent).toHaveBeenCalledWith('**Hello**');
    });

    test('should skip markdown processing when disabled', async () => {
      streamingManager.updateConfig({ enableMarkdown: false });

      const messageId = 'test-message-1';
      const markdownChunks = ['**Hello**', ' *world*!'];
      const response = createMockResponse(markdownChunks);

      await streamingManager.startStreaming(messageId, response);

      expect(mockMessageRenderer.updateStreamingMessage).toHaveBeenCalledWith(
        messageId,
        '**Hello**'
      );
    });

    test('should handle code block boundaries', async () => {
      const codeChunks = [
        'Here is some code:',
        '```javascript',
        'console.log("Hello");',
        '```'
      ];
      const response = createMockResponse(codeChunks);

      await streamingManager.startStreaming('test-message-1', response);

      // Should accumulate all chunks correctly
      expect(mockMessageRenderer.updateStreamingMessage).toHaveBeenCalledTimes(4);
    });
  });

  describe('Performance and Optimization', () => {
    test('should throttle UI updates for better performance', async () => {
      const messageId = 'test-message-1';
      const manyChunks = Array(100).fill('a');
      const response = createMockResponse(manyChunks);

      const startTime = Date.now();
      await streamingManager.startStreaming(messageId, response);
      const endTime = Date.now();

      // Should complete quickly despite many chunks
      expect(endTime - startTime).toBeLessThan(1000);
    });

    test('should batch small chunks together', async () => {
      const messageId = 'test-message-1';
      const smallChunks = ['H', 'e', 'l', 'l', 'o'];
      const response = createMockResponse(smallChunks);

      streamingManager.updateConfig({ batchSize: 3 });

      await streamingManager.startStreaming(messageId, response);

      // Should have fewer updates than chunks due to batching
      expect(mockMessageRenderer.updateStreamingMessage).toHaveBeenCalledTimes(2);
    });

    test('should limit maximum content length', async () => {
      const messageId = 'test-message-1';
      const longChunk = 'a'.repeat(10000);
      const response = createMockResponse([longChunk]);

      streamingManager.updateConfig({ maxContentLength: 1000 });

      await streamingManager.startStreaming(messageId, response);

      const lastCall = mockMessageRenderer.updateStreamingMessage.mock.calls.pop();
      expect(lastCall[1].length).toBeLessThanOrEqual(1000);
    });
  });

  describe('Integration with Other Managers', () => {
    test('should update conversation manager with final message', async () => {
      const messageId = 'test-message-1';
      const chunks = ['Hello', ' world'];
      const response = createMockResponse(chunks);

      await streamingManager.startStreaming(messageId, response);

      expect(mockConversationManager.addMessage).toHaveBeenCalledWith({
        id: messageId,
        role: 'assistant',
        content: 'Hello world'
      });
    });

    test('should handle conversation manager errors gracefully', async () => {
      mockConversationManager.addMessage.mockRejectedValue(new Error('Storage error'));

      const messageId = 'test-message-1';
      const response = createMockResponse(['Hello']);

      // Should not throw, but handle gracefully
      await expect(
        streamingManager.startStreaming(messageId, response)
      ).resolves.toBeDefined();
    });
  });

  describe('Event Emission', () => {
    test('should emit stream start event', async () => {
      const onStreamStart = jest.fn();
      streamingManager.on('streamStart', onStreamStart);

      const messageId = 'test-message-1';
      const response = createMockResponse(['Hello']);

      await streamingManager.startStreaming(messageId, response);

      expect(onStreamStart).toHaveBeenCalledWith({ messageId });
    });

    test('should emit stream progress event', async () => {
      const onStreamProgress = jest.fn();
      streamingManager.on('streamProgress', onStreamProgress);

      const messageId = 'test-message-1';
      const chunks = ['Hello', ' world'];
      const response = createMockResponse(chunks);

      await streamingManager.startStreaming(messageId, response);

      expect(onStreamProgress).toHaveBeenCalledWith({
        messageId,
        content: expect.stringContaining('Hello')
      });
    });

    test('should emit stream complete event', async () => {
      const onStreamComplete = jest.fn();
      streamingManager.on('streamComplete', onStreamComplete);

      const messageId = 'test-message-1';
      const response = createMockResponse(['Hello', '[DONE]']);

      await streamingManager.startStreaming(messageId, response);

      expect(onStreamComplete).toHaveBeenCalledWith({
        messageId,
        content: 'Hello'
      });
    });

    test('should emit stream error event', async () => {
      const onStreamError = jest.fn();
      streamingManager.on('streamError', onStreamError);

      const response = { ok: false, status: 500 };

      await expect(
        streamingManager.startStreaming('test-message-1', response)
      ).rejects.toThrow();

      expect(onStreamError).toHaveBeenCalledWith({
        messageId: 'test-message-1',
        error: expect.any(Error)
      });
    });
  });

  describe('Utility Functions', () => {
    test('should parse SSE data correctly', () => {
      const sseData = 'data: Hello world\n\ndata: Second line\n\n';
      const parsed = streamingManager.parseSSEData(sseData);

      expect(parsed).toEqual(['Hello world', 'Second line']);
    });

    test('should handle mixed SSE content', () => {
      const sseData = 'event: message\ndata: Hello\n\nid: 1\ndata: World\n\n';
      const parsed = streamingManager.parseSSEData(sseData);

      expect(parsed).toEqual(['Hello', 'World']);
    });

    test('should extract JSON content from chunks', () => {
      const jsonChunk = '{"content": "Hello world", "done": false}';
      const parsed = streamingManager.parseJSONChunk(jsonChunk);

      expect(parsed).toEqual({ content: 'Hello world', done: false });
    });

    test('should handle incomplete JSON gracefully', () => {
      const incompleteJson = '{"content": "Hello world"';
      const parsed = streamingManager.parseJSONChunk(incompleteJson);

      expect(parsed).toBeNull();
    });

    test('should detect stream format from headers', () => {
      const headers = new Map([
        ['content-type', 'application/json'],
        ['x-stream-format', 'json-stream']
      ]);

      const format = streamingManager.detectStreamFormat(headers);

      expect(format).toBe('json');
    });
  });

  describe('Cleanup and Memory Management', () => {
    test('should cleanup resources on stream completion', async () => {
      const messageId = 'test-message-1';
      const response = createMockResponse(['Hello', '[DONE]']);

      await streamingManager.startStreaming(messageId, response);

      expect(streamingManager.activeStreams.has(messageId)).toBe(false);
    });

    test('should cleanup all resources on destroy', () => {
      const response1 = createMockResponse(['Hello']);
      const response2 = createMockResponse(['World']);

      streamingManager.startStreaming('message-1', response1);
      streamingManager.startStreaming('message-2', response2);

      streamingManager.destroy();

      expect(streamingManager.activeStreams.size).toBe(0);
      expect(response1.reader.releaseLock).toHaveBeenCalled();
      expect(response2.reader.releaseLock).toHaveBeenCalled();
    });
  });
});