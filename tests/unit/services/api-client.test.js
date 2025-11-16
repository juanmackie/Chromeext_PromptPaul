/**
 * Unit Tests for API Client
 * Tests the centralized API client with authentication, streaming, and error handling
 */

import { ApiClient, ApiProvider, ApiErrorType, apiClient } from '../../../services/api-client.js';

// Mock fetch for testing
global.fetch = jest.fn();

describe('ApiClient', () => {
  let apiClient;

  beforeEach(() => {
    apiClient = new ApiClient();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Request Builder', () => {
    test('should build request with OpenAI configuration', () => {
      const config = {
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test123456789',
        modelName: 'gpt-4',
        maxTokens: 2048,
        systemPrompt: 'You are a helpful assistant.'
      };

      const options = {
        messages: [
          { role: 'user', content: 'Hello' }
        ],
        temperature: 0.7,
        stream: false
      };

      const request = apiClient.requestBuilder.buildRequest(config, options);

      expect(request.url).toBe('https://api.openai.com/v1/chat/completions');
      expect(request.method).toBe('POST');
      expect(request.headers['Content-Type']).toBe('application/json');
      expect(request.headers['Authorization']).toBe('Bearer sk-test123456789');
      expect(request.headers['OpenAI-Organization']).toBe('');

      const body = JSON.parse(request.body);
      expect(body.model).toBe('gpt-4');
      expect(body.max_tokens).toBe(2048);
      expect(body.temperature).toBe(0.7);
      expect(body.stream).toBe(false);
    });

    test('should build request with Anthropic configuration', () => {
      const config = {
        llmEndpoint: 'https://api.anthropic.com/v1/messages',
        apiKey: 'sk-ant-test123456789',
        modelName: 'claude-3-sonnet-20240229',
        maxTokens: 4096,
        anthropicVersion: '2023-06-01'
      };

      const options = {
        messages: [
          { role: 'user', content: 'Hello' }
        ]
      };

      const request = apiClient.requestBuilder.buildRequest(config, options);

      expect(request.url).toBe('https://api.anthropic.com/v1/messages');
      expect(request.headers['anthropic-version']).toBe('2023-06-01');
      expect(request.headers['Authorization']).toBe('Bearer sk-ant-test123456789');
    });

    test('should build request with tools', () => {
      const config = {
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test123456789',
        modelName: 'gpt-4',
        maxTokens: 2048
      };

      const tools = [
        {
          name: 'search',
          description: 'Search the web',
          parameters: '{"type": "object", "properties": {"query": {"type": "string"}}}'
        }
      ];

      const options = {
        messages: [{ role: 'user', content: 'Search for something' }],
        tools,
        toolChoice: 'auto'
      };

      const request = apiClient.requestBuilder.buildRequest(config, options);

      const body = JSON.parse(request.body);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].type).toBe('function');
      expect(body.tools[0].function.name).toBe('search');
      expect(body.tool_choice).toBe('auto');
    });

    test('should build streaming request', () => {
      const config = {
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test123456789',
        modelName: 'gpt-4',
        maxTokens: 2048
      };

      const options = {
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      };

      const request = apiClient.requestBuilder.buildRequest(config, options);

      const body = JSON.parse(request.body);
      expect(body.stream).toBe(true);
    });

    test('should validate configuration correctly', () => {
      const config = {
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test123456789',
        modelName: 'gpt-4',
        maxTokens: 2048
      };

      // Should not throw error for valid config
      expect(() => {
        apiClient.requestBuilder.buildRequest(config, {});
      }).not.toThrow();
    });

    test('should throw error for missing endpoint', () => {
      const config = {
        llmEndpoint: '',
        apiKey: 'sk-test123456789',
        modelName: 'gpt-4',
        maxTokens: 2048
      };

      expect(() => {
        apiClient.requestBuilder.buildRequest(config, {});
      }).toThrow('API endpoint is required');
    });

    test('should throw error for missing API key', () => {
      const config = {
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: '',
        modelName: 'gpt-4',
        maxTokens: 2048
      };

      expect(() => {
        apiClient.requestBuilder.buildRequest(config, {});
      }).toThrow('API key is required');
    });

    test('should throw error for missing model name', () => {
      const config = {
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test123456789',
        modelName: '',
        maxTokens: 2048
      };

      expect(() => {
        apiClient.requestBuilder.buildRequest(config, {});
      }).toThrow('Model name is required');
    });

    test('should validate API key format for OpenAI', () => {
      const config = {
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'invalid-key',
        modelName: 'gpt-4',
        maxTokens: 2048
      };

      expect(() => {
        apiClient.requestBuilder.buildRequest(config, {});
      }).toThrow('Invalid API key format for openai');
    });

    test('should validate API key format for Anthropic', () => {
      const config = {
        llmEndpoint: 'https://api.anthropic.com/v1/messages',
        apiKey: 'invalid-key',
        modelName: 'claude-3-sonnet-20240229',
        maxTokens: 4096
      };

      expect(() => {
        apiClient.requestBuilder.buildRequest(config, {});
      }).toThrow('Invalid API key format for anthropic');
    });

    test('should handle tool choice correctly', () => {
      const config = {
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test123456789',
        modelName: 'gpt-4',
        maxTokens: 2048
      };

      const tools = [
        { name: 'search', description: 'Search', parameters: '{}' },
        { name: 'translate', description: 'Translate', parameters: '{}' }
      ];

      // Test auto choice
      let request = apiClient.requestBuilder.buildRequest(config, {
        tools,
        toolChoice: 'auto'
      });
      let body = JSON.parse(request.body);
      expect(body.tool_choice).toBe('auto');
      expect(body.tools).toHaveLength(2);

      // Test none choice
      request = apiClient.requestBuilder.buildRequest(config, {
        tools,
        toolChoice: 'none'
      });
      body = JSON.parse(request.body);
      expect(body.tool_choice).toBeUndefined();
      expect(body.tools).toBeUndefined();

      // Test specific tool choice
      request = apiClient.requestBuilder.buildRequest(config, {
        tools,
        toolChoice: 'search'
      });
      body = JSON.parse(request.body);
      expect(body.tool_choice.type).toBe('function');
      expect(body.tool_choice.function.name).toBe('search');
      expect(body.tools).toHaveLength(1);
    });

    test('should format messages with system prompt', () => {
      const config = {
        llmEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test123456789',
        modelName: 'gpt-4',
        maxTokens: 2048,
        systemPrompt: 'You are a helpful assistant.'
      };

      const options = {
        messages: [{ role: 'user', content: 'Hello' }]
      };

      const request = apiClient.requestBuilder.buildRequest(config, options);
      const body = JSON.parse(request.body);

      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[0].content).toContain('You are a helpful assistant.');
      expect(body.messages[0].content).toContain('Date:');
      expect(body.messages[0].content).toContain('Time:');
      expect(body.messages[1].role).toBe('user');
      expect(body.messages[1].content).toBe('Hello');
    });
  });

  describe('Authentication Manager', () => {
    test('should detect OpenAI provider', () => {
      const config = {
        llmEndpoint: 'https://api.openai.com/v1/chat/completions'
      };

      const provider = apiClient.authManager.detectProvider(config);
      expect(provider).toBe(ApiProvider.OPENAI);
    });

    test('should detect Anthropic provider', () => {
      const config = {
        llmEndpoint: 'https://api.anthropic.com/v1/messages'
      };

      const provider = apiClient.authManager.detectProvider(config);
      expect(provider).toBe(ApiProvider.ANTHROPIC);
    });

    test('should detect Mistral provider', () => {
      const config = {
        llmEndpoint: 'https://api.mistral.ai/v1/chat/completions'
      };

      const provider = apiClient.authManager.detectProvider(config);
      expect(provider).toBe(ApiProvider.MISTRAL);
    });

    test('should detect custom provider', () => {
      const config = {
        llmEndpoint: 'https://custom-api.example.com/v1/chat',
        provider: 'custom'
      };

      const provider = apiClient.authManager.detectProvider(config);
      expect(provider).toBe(ApiProvider.CUSTOM);
    });

    test('should build headers for OpenAI', () => {
      const config = {
        apiKey: 'sk-test123456789',
        organizationId: 'org-test'
      };

      const headers = apiClient.authManager.buildAuthHeaders(config);

      expect(headers['Authorization']).toBe('Bearer sk-test123456789');
      expect(headers['OpenAI-Organization']).toBe('org-test');
    });

    test('should build headers for Anthropic', () => {
      const config = {
        apiKey: 'sk-ant-test123456789',
        anthropicVersion: '2023-06-01'
      };

      const headers = apiClient.authManager.buildAuthHeaders(config);

      expect(headers['Authorization']).toBe('Bearer sk-ant-test123456789');
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    test('should validate OpenAI API key format', () => {
      expect(apiClient.authManager.validateApiKeyFormat('sk-1234567890123456', ApiProvider.OPENAI)).toBe(true);
      expect(apiClient.authManager.validateApiKeyFormat('short', ApiProvider.OPENAI)).toBe(false);
      expect(apiClient.authManager.validateApiKeyFormat('', ApiProvider.OPENAI)).toBe(false);
    });

    test('should validate Anthropic API key format', () => {
      expect(apiClient.authManager.validateApiKeyFormat('sk-ant-1234567890123456', ApiProvider.ANTHROPIC)).toBe(true);
      expect(apiClient.authManager.validateApiKeyFormat('sk-123', ApiProvider.ANTHROPIC)).toBe(false);
      expect(apiClient.authManager.validateApiKeyFormat('', ApiProvider.ANTHROPIC)).toBe(false);
    });

    test('should validate Mistral API key format', () => {
      expect(apiClient.authManager.validateApiKeyFormat('abcdefghijklmnopqrstuvwxyz123456', ApiProvider.MISTRAL)).toBe(true);
      expect(apiClient.authManager.validateApiKeyFormat('short', ApiProvider.MISTRAL)).toBe(false);
      expect(apiClient.authManager.validateApiKeyFormat('', ApiProvider.MISTRAL)).toBe(false);
    });

    test('should validate custom API key format', () => {
      expect(apiClient.authManager.validateApiKeyFormat('custom-key-123456789', ApiProvider.CUSTOM)).toBe(true);
      expect(apiClient.authManager.validateApiKeyFormat('', ApiProvider.CUSTOM)).toBe(false);
    });
  });

  describe('Streaming Processor', () => {
    test('should process streaming chunks', async () => {
      const mockStream = {
        body: {
          getReader: jest.fn(() => ({
            read: jest.fn()
              .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}')\n') })
              .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":" world"}}]}\n') })
              .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: [DONE]\n') })
              .mockResolvedValueOnce({ done: true })
          }))
        }
      };

      const onChunk = jest.fn();
      const onComplete = jest.fn();
      const onError = jest.fn();

      await apiClient.streamingProcessor.processStream(mockStream, onChunk, onComplete, onError);

      expect(onChunk).toHaveBeenCalledWith({ type: 'content', content: 'Hello' });
      expect(onChunk).toHaveBeenCalledWith({ type: 'content', content: ' world' });
      expect(onComplete).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    test('should handle tool call chunks', async () => {
      const mockStream = {
        body: {
          getReader: jest.fn(() => ({
            read: jest.fn()
              .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"search","arguments":"{}"}}]}}]\n') })
              .mockResolvedValueOnce({ done: true })
          }))
        }
      };

      const onChunk = jest.fn();
      const onComplete = jest.fn();
      const onError = jest.fn();

      await apiClient.streamingProcessor.processStream(mockStream, onChunk, onComplete, onError);

      expect(onChunk).toHaveBeenCalledWith({
        type: 'tool_call',
        tool_calls: [{ id: 'call_1', function: { name: 'search', arguments: '{}' } }]
      });
      expect(onComplete).toHaveBeenCalled();
    });

    test('should handle malformed JSON gracefully', async () => {
      const mockStream = {
        body: {
          getReader: jest.fn(() => ({
            read: jest.fn()
              .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"invalid": json\n') })
              .mockResolvedValueOnce({ done: true })
          }))
        }
      };

      const onChunk = jest.fn();
      const onComplete = jest.fn();
      const onError = jest.fn();

      await apiClient.streamingProcessor.processStream(mockStream, onChunk, onComplete, onError);

      expect(onChunk).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled(); // Error is logged but not thrown
    });

    test('should handle stream errors', async () => {
      const mockError = new Error('Stream error');
      const mockStream = {
        body: {
          getReader: jest.fn(() => ({
            read: jest.fn().mockRejectedValue(mockError)
          }))
        }
      };

      const onChunk = jest.fn();
      const onComplete = jest.fn();
      const onError = jest.fn();

      await expect(apiClient.streamingProcessor.processStream(mockStream, onChunk, onComplete, onError))
        .rejects.toThrow('Stream error');
    });

    test('should cancel active streams', () => {
      const streamId = 'test-stream-1';
      const mockReader = {
        cancel: jest.fn()
      };
      const mockStream = {
        body: {
          getReader: jest.fn(() => mockReader)
        }
      };

      // Start a stream
      apiClient.streamingProcessor.activeStreams.set(streamId, {
        reader: mockReader,
        decoder: new TextDecoder()
      });

      apiClient.streamingProcessor.cancelStream(streamId);

      expect(mockReader.cancel).toHaveBeenCalled();
      expect(apiClient.streamingProcessor.activeStreams.has(streamId)).toBe(false);
    });

    test('should cancel all streams', () => {
      const mockReader1 = { cancel: jest.fn() };
      const mockReader2 = { cancel: jest.fn() };
      const mockStream1 = { body: { getReader: jest.fn(() => mockReader1) } };
      const mockStream2 = { body: { getReader: jest.fn(() => mockReader2) } };

      // Start streams
      apiClient.streamingProcessor.activeStreams.set('stream1', { reader: mockReader1 });
      apiClient.streamingProcessor.activeStreams.set('stream2', { reader: mockReader2 });

      apiClient.streamingProcessor.cancelAllStreams();

      expect(mockReader1.cancel).toHaveBeenCalled();
      expect(mockReader2.cancel).toHaveBeenCalled();
      expect(apiClient.streamingProcessor.activeStreams.size).toBe(0);
    });
  });

  describe('API Request Methods', () => {
    const validConfig = {
      llmEndpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'sk-test123456789',
      modelName: 'gpt-4',
      maxTokens: 2048
    };

    test('should make successful API request', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          choices: [{
            message: {
              content: 'Hello from AI!'
            }
          }]
        })
      };

      global.fetch.mockResolvedValue(mockResponse);

      const options = {
        messages: [{ role: 'user', content: 'Hello' }]
      };

      const result = await apiClient.makeRequest(validConfig, options);

      expect(result).toEqual({
        choices: [{
          message: {
            content: 'Hello from AI!'
          }
        }]
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer sk-test123456789'
          })
        })
      );
    });

    test('should handle HTTP errors', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: jest.fn().mockResolvedValue({
          error: {
            message: 'Invalid API key'
          }
        })
      };

      global.fetch.mockResolvedValue(mockResponse);

      const options = {
        messages: [{ role: 'user', content: 'Hello' }]
      };

      await expect(apiClient.makeRequest(validConfig, options)).rejects.toThrow();

      try {
        await apiClient.makeRequest(validConfig, options);
      } catch (error) {
        expect(error.message).toContain('API request failed: 401 Unauthorized');
      }
    });

    test('should handle request timeout', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'AbortError';

      global.fetch.mockRejectedValue(timeoutError);

      const options = {
        messages: [{ role: 'user', content: 'Hello' }]
      };

      await expect(apiClient.makeRequest(validConfig, options)).rejects.toThrow('Request timeout');
    });

    test('should make successful streaming request', async () => {
      const mockStream = {
        body: {
          getReader: jest.fn(() => ({
            read: jest.fn()
              .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n') })
              .mockResolvedValueOnce({ done: true })
          }))
        }
      };

      global.fetch.mockResolvedValue({ body: mockStream });

      const options = {
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      };

      const onChunk = jest.fn();

      await apiClient.makeStreamingRequest(validConfig, options, onChunk);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer sk-test123456789'
          })
        })
      );

      expect(onChunk).toHaveBeenCalledWith({ type: 'content', content: 'Hello' });
    });

    test('should make media request', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          choices: [{
            message: {
              content: 'I can see the image!'
            }
          }]
        })
      };

      global.fetch.mockResolvedValue(mockResponse);

      const mediaData = {
        type: 'image',
        mimeType: 'image/png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
      };

      const options = {
        prompt: 'What do you see?',
        mediaData
      };

      const result = await apiClient.makeMediaRequest(validConfig, mediaData, options);

      expect(result).toEqual({
        choices: [{
          message: {
            content: 'I can see the image!'
          }
        }]
      });
    });

    test('should validate media data before request', async () => {
      const options = {
        prompt: 'What do you see?',
        mediaData: null
      };

      await expect(apiClient.makeMediaRequest(validConfig, options, null)).rejects.toThrow('Media data is required');
    });
  });

  describe('Error Handling', () => {
    test('should categorize authentication errors correctly', () => {
      const errorType = apiClient.categorizeError(401, 'Invalid API key');
      expect(errorType).toBe(ApiErrorType.AUTHENTICATION);
    });

    test('should categorize rate limit errors correctly', () => {
      const errorType = apiClient.categorizeError(429, 'Rate limit exceeded');
      expect(errorType).toBe(ApiErrorType.RATE_LIMIT);
    });

    test('should categorize server errors correctly', () => {
      const errorType = apiClient.categorizeError(500, 'Internal server error');
      expect(errorType).toBe(ApiErrorType.SERVER);
    });

    test('should categorize validation errors correctly', () => {
      const errorType = apiClient.categorizeError(400, 'Bad request');
      expect(errorType).toBe(ApiErrorType.VALIDATION);
    });

    test('should categorize network errors correctly', () => {
      const errorType = apiClient.categorizeError(0, 'Network error');
      expect(errorType).toBe(ApiErrorType.NETWORK);
    });

    test('should get severity for authentication errors', () => {
      const severity = apiClient.getSeverityForStatus(401);
      expect(severity).toBe('CRITICAL');
    });

    test('should get severity for rate limit errors', () => {
      const severity = apiClient.getSeverityForStatus(429);
      expect(severity).toBe('HIGH');
    });

    test('should get severity for server errors', () => {
      const severity = apiClient.getSeverityForStatus(500);
      expect(severity).toBe('HIGH');
    });

    test('should get user-friendly messages for authentication errors', () => {
      const message = apiClient.getUserMessageForError(ApiErrorType.AUTHENTICATION, 401);
      expect(message).toBe('Authentication failed. Please check your API key in the options page.');
    });

    test('should get user-friendly messages for rate limit errors', () => {
      const message = apiClient.getUserMessageForError(ApiErrorType.RATE_LIMIT, 429);
      expect(message).toBe('Rate limit exceeded. Please wait before making another request.');
    });

    test('should get user-friendly messages for server errors', () => {
      const message = apiClient.getUserMessageForError(ApiErrorType.SERVER, 500);
      expect(message).toBe('The API server is experiencing issues. Please try again later.');
    });

    test('should get user-friendly messages for network errors', () => {
      const message = apiClient.getUserMessageForError(ApiErrorType.NETWORK, 0);
      expect(message).toBe('Network error. Please check your connection and try again.');
    });

    test('should get user-friendly messages for unknown errors', () => {
      const message = apiClient.getUserMessageForError(ApiErrorType.UNKNOWN, 418);
      expect(message).toBe('An unexpected error occurred. Please try again.');
    });
  });

  describe('Singleton Instance', () => {
    test('should export singleton API client instance', () => {
      expect(apiClient).toBeDefined();
      expect(apiClient).toBeInstanceOf(ApiClient);
    });

    test('should have default configuration', () => {
      expect(apiClient.defaultConfig.maxRetries).toBe(3);
      expect(apiClient.defaultConfig.retryDelay).toBe(1000);
      expect(apiClient.defaultConfig.timeout).toBe(30000);
    });
  });
});