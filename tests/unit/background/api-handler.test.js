/**
 * Unit Tests for ApiHandler
 * Tests API request handling, streaming, tool choices, error handling
 */

const { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync } = require('../../../mocks/error-handler.mock.js');
const analytics = require('../../../mocks/analytics.mock.js');

// Mock apiClient
jest.mock('../../../../services/api-client.js', () => ({
  apiClient: {
    makeStreamingRequest: jest.fn(),
    makeRequest: jest.fn()
  }
}));

// Mock chrome APIs
const mockChrome = {
  runtime: {
    sendMessage: jest.fn().mockResolvedValue(true),
    lastError: null
  },
  storage: {
    sync: {
      get: jest.fn()
    }
  }
};
global.chrome = mockChrome;

const { ApiHandler } = require('../../../../background/api-handler.js');
const { apiClient } = require('../../../../services/api-client.js');

describe('ApiHandler', () => {
  let apiHandler;
  let mockConfig;
  let mockTools;

  beforeEach(() => {
    jest.clearAllMocks();
    apiHandler = new ApiHandler();

    mockConfig = {
      modelName: 'test-model',
      apiKey: 'test-key',
      llmEndpoint: 'https://api.example.com/v1/chat',
      maxTokens: '2048',
      systemPrompt: 'Test system prompt'
    };

    mockTools = [
      {
        name: 'test-tool',
        description: 'Test tool',
        parameters: JSON.stringify({ type: 'object', properties: {} })
      }
    ];

    // Mock internal methods
    apiHandler.validateConfig = jest.fn().mockResolvedValue(mockConfig);
    apiHandler.getAllToolDefinitions = jest.fn().mockResolvedValue(mockTools);
    apiHandler.getStreamingSettings = jest.fn().mockResolvedValue(true);
  });

  describe('makeLlmApiRequest', () => {
    test('should handle streaming request successfully', async () => {
      apiClient.makeStreamingRequest.mockImplementation(() => Promise.resolve());

      await apiHandler.makeLlmApiRequest('test prompt', '123', { isStartChat: false });

      expect(apiHandler.validateConfig).toHaveBeenCalled();
      expect(apiHandler.getAllToolDefinitions).toHaveBeenCalled();
      expect(apiHandler.getStreamingSettings).toHaveBeenCalled();
      expect(apiClient.makeStreamingRequest).toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'streamApiEnd'
      }));
    });

    test('should handle non-streaming request successfully', async () => {
      apiHandler.getStreamingSettings.mockResolvedValueOnce(false);
      apiClient.makeRequest.mockResolvedValue({
        choices: [{ message: { content: 'response' } }]
      });

      await apiHandler.makeLlmApiRequest('test prompt', '123');

      expect(apiClient.makeRequest).toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'setApiResponse'
      }));
    });

    test('should send configuration error on validateConfig failure', async () => {
      const configError = new Error('LLM API endpoint is missing');
      apiHandler.validateConfig.mockRejectedValueOnce(configError);

      await apiHandler.makeLlmApiRequest('test prompt', '123');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'displayErrorInChat',
        errorMessage: expect.stringContaining('LLM API endpoint')
      }));
    });

    test('should handle general API errors', async () => {
      apiClient.makeStreamingRequest.mockRejectedValueOnce(new Error('API Error'));

      await apiHandler.makeLlmApiRequest('test prompt', '123');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'setApiResponse',
        apiResponse: expect.stringContaining('Error: API Error')
      }));
    });
  });

  describe('prepareToolChoices', () => {
    test('should prepare no tools when choice is none', () => {
      const result = apiHandler.prepareToolChoices(mockTools, 'none');
      expect(result.formattedTools).toEqual([]);
      expect(result.toolChoicePayload).toEqual({});
    });

    test('should prepare all tools for auto choice', () => {
      const result = apiHandler.prepareToolChoices(mockTools, 'auto');
      expect(result.formattedTools).toHaveLength(1);
      expect(result.toolChoicePayload).toEqual({
        tools: expect.any(Array),
        tool_choice: 'auto'
      });
    });

    test('should prepare specific tool', () => {
      const result = apiHandler.prepareToolChoices(mockTools, 'test-tool');
      expect(result.toolChoicePayload.tools[0].function.name).toBe('test-tool');
    });

    test('should handle invalid tool gracefully', () => {
      const result = apiHandler.prepareToolChoices(mockTools, 'missing-tool');
      expect(result.toolChoicePayload).toEqual({});
    });

    test('should handle tool with invalid parameters', () => {
      const invalidTools = [{ name: 'invalid', parameters: 'invalid json' }];
      const result = apiHandler.prepareToolChoices(invalidTools, 'auto');
      expect(result.formattedTools).toHaveLength(0);
    });
  });

  describe('buildMessages', () => {
    test('should build messages with system prompt', () => {
      const messages = apiHandler.buildMessages(mockConfig, 'user prompt');
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('Date:');
      expect(messages[0].content).toContain(mockConfig.systemPrompt);
      expect(messages[1].content).toBe('user prompt');
    });

    test('should handle empty system prompt', () => {
      const emptyConfig = { ...mockConfig, systemPrompt: '' };
      const messages = apiHandler.buildMessages(emptyConfig, 'user prompt');
      expect(messages[0].content).toMatch(/^Date:/);
    });
  });

  describe('processStreamingLine', () => {
    test('should process content chunk', () => {
      const mockTabId = '123';
      const mockPrompt = 'test';
      chrome.runtime.sendMessage.mockClear();

      apiHandler.processStreamingLine('data: {"choices":[{"delta":{"content":"chunk"}}]}', mockPrompt, mockTabId);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'streamApiResponseChunk',
        chunk: 'chunk',
        tabId: mockTabId,
        prompt: mockPrompt
      });
    });

    test('should process tool call chunk', () => {
      const mockTabId = '123';
      const mockPrompt = 'test';

      apiHandler.processStreamingLine('data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"test"}}]}}]}', mockPrompt, mockTabId);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'streamApiToolCallChunk'
      }));
    });

    test('should ignore [DONE] and invalid lines', () => {
      apiHandler.processStreamingLine('data: [DONE]', 'test', '123');
      apiHandler.processStreamingLine('data: invalid', 'test', '123');

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('handleApiError', () => {
    test('should send error response after delay', async () => {
      jest.useFakeTimers();
      const mockError = new Error('Test error');
      const mockTabId = '123';
      const mockPrompt = 'test';

      await apiHandler.handleApiError(mockError, mockPrompt, mockTabId, false);

      expect(analytics.trackErrorEvent).toHaveBeenCalled();
      jest.advanceTimersByTime(200);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'setApiResponse',
        apiResponse: 'Error: Test error'
      }));
      jest.useRealTimers();
    });

    test('should use startChat delay for new chats', async () => {
      jest.useFakeTimers();
      await apiHandler.handleApiError(new Error('error'), 'prompt', '123', true);
      jest.advanceTimersByTime(300);
      jest.useRealTimers();
    });
  });

  describe('getStreamingSettings', () => {
    test('should get streaming setting from chrome.storage.sync', async () => {
      mockChrome.storage.sync.get.mockImplementation((keys, callback) => {
        callback({ enableStreaming: true });
      });

      const result = await apiHandler.getStreamingSettings();
      expect(result).toBe(true);
      expect(mockChrome.storage.sync.get).toHaveBeenCalledWith({ enableStreaming: false }, expect.any(Function));
    });
  });

  describe('Error Paths', () => {
    test('should handle invalid response format', async () => {
      apiHandler.getStreamingSettings.mockResolvedValueOnce(false);
      apiClient.makeRequest.mockResolvedValue({ choices: [] });

      await expect(apiHandler.makeLlmApiRequest('prompt', '123')).rejects.toThrow('Invalid response format');
    });
  });
});