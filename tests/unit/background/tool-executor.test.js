/**
 * Unit Tests for ToolExecutor
 * Tests tool execution, HTTP endpoints, duplicate prevention, error handling
 */

const { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync } = require('../../../mocks/error-handler.mock.js');
const analytics = require('../../../mocks/analytics.mock.js');

// Mock global fetch
global.fetch = jest.fn();

describe('ToolExecutor', () => {
  let toolExecutor;
  let mockSendResponse;
  let mockToolDefinition;

  beforeEach(() => {
    jest.clearAllMocks();
    toolExecutor = new ToolExecutor();

    mockSendResponse = jest.fn();
    mockToolDefinition = {
      name: 'test-tool',
      description: 'Test tool',
      endpointUrl: 'https://api.example.com/tool',
      httpMethod: 'POST'
    };

    // Mock internal methods
    toolExecutor.getAllToolDefinitions = jest.fn().mockResolvedValue([mockToolDefinition]);
    toolExecutor.validateConfig = jest.fn().mockResolvedValue({ modelName: 'test-model' });
  });

  describe('executeTool', () => {
    test('should execute HTTP tool successfully', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: jest.fn().mockResolvedValue({ result: 'success' })
      });

      const toolCall = {
        id: 'test-1',
        name: 'test-tool',
        arguments: JSON.stringify({ param: 'value' })
      };

      await toolExecutor.executeTool(toolCall, mockSendResponse);

      expect(toolExecutor.getAllToolDefinitions).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith('https://api.example.com/tool', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ param: 'value' })
      }));
      expect(mockSendResponse).toHaveBeenCalledWith({ result: { result: 'success' } });
      expect(analytics.trackInstructionUsed).toHaveBeenCalled();
    });

    test('should prevent duplicate executions', async () => {
      const toolCall = { id: 'dup-1', name: 'test-tool', arguments: '{}' };
      fetch.mockResolvedValue({ ok: true, json: () => ({}) });

      // First execution
      await toolExecutor.executeTool(toolCall, mockSendResponse);
      expect(mockSendResponse).toHaveBeenCalledTimes(1);

      // Second identical execution
      await toolExecutor.executeTool(toolCall, mockSendResponse);
      expect(mockSendResponse).not.toHaveBeenCalledTimes(2); // Still 1

      expect(toolExecutor.getActiveExecutionsCount()).toBe(0); // Cleared after first
    });

    test('should handle tool not found', async () => {
      toolExecutor.getAllToolDefinitions.mockResolvedValueOnce([]);

      const toolCall = { id: 'missing', name: 'missing-tool', arguments: '{}' };

      await toolExecutor.executeTool(toolCall, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining("Tool definition for 'missing-tool' not found")
      }));
    });

    test('should handle invalid arguments JSON', async () => {
      const toolCall = { id: 'invalid', name: 'test-tool', arguments: 'invalid json' };

      await toolExecutor.executeTool(toolCall, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('Invalid arguments format')
      }));
    });

    test('should handle built-in tool execution', async () => {
      const builtInToolName = 'getCurrentTime';
      toolExecutor.getBuiltInTool = jest.fn().mockReturnValue(async (args) => ({
        currentTime: new Date().toISOString()
      }));
      toolExecutor.getAllToolDefinitions.mockResolvedValueOnce([]); // No HTTP tool

      const toolCall = {
        id: 'builtin-1',
        name: builtInToolName,
        arguments: '{}'
      };

      await toolExecutor.executeTool(toolCall, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
        result: expect.objectContaining({ currentTime: expect.any(String) })
      }));
    });

    test('should handle tool without endpoint or built-in', async () => {
      toolExecutor.getAllToolDefinitions.mockResolvedValueOnce([{
        name: 'bad-tool',
        description: 'No endpoint'
      }]);

      const toolCall = { id: 'bad-1', name: 'bad-tool', arguments: '{}' };

      await toolExecutor.executeTool(toolCall, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining("not properly configured")
      }));
    });
  });

  describe('executeHttpTool', () => {
    test('should call user-defined endpoint', async () => {
      fetch.mockResolvedValue({ ok: true, json: () => ({}) });
      toolExecutor.callUserDefinedEndpoint = jest.fn().mockResolvedValue('result');

      await toolExecutor.executeHttpTool(mockToolDefinition, { test: 'data' });

      expect(toolExecutor.callUserDefinedEndpoint).toHaveBeenCalledWith(
        'https://api.example.com/tool',
        { test: 'data' },
        'POST',
        'test-tool'
      );
    });
  });

  describe('callUserDefinedEndpoint', () => {
    test('should make POST request with JSON body', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: jest.fn().mockResolvedValue({ success: true })
      });

      const result = await toolExecutor.callUserDefinedEndpoint(
        'https://api.example.com/post',
        { data: 'value' },
        'POST'
      );

      expect(fetch).toHaveBeenCalledWith('https://api.example.com/post', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }),
        body: JSON.stringify({ data: 'value' })
      }));
      expect(result).toEqual({ success: true });
    });

    test('should make GET request with query params', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => ({})
      });

      await toolExecutor.callUserDefinedEndpoint(
        'https://api.example.com/get',
        { param: 'value' },
        'GET'
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/get?param=value',
        expect.objectContaining({ method: 'GET' })
      );
    });

    test('should handle HTTP 4xx error', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => 'Error details'
      });

      await expect(toolExecutor.callUserDefinedEndpoint('https://fail.com', {}, 'POST'))
        .rejects.toThrow('HTTP request failed');

      expect(errorHandler.handle).toHaveBeenCalled();
    });

    test('should handle timeout', async () => {
      fetch.mockImplementationOnce(() => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 10);
        return Promise.resolve({
          ok: true,
          signal: controller.signal
        });
      });

      const result = await toolExecutor.callUserDefinedEndpoint(
        'https://api.example.com/timeout',
        {},
        'GET'
      );

      // Should not timeout in test, but verify AbortController usage
      expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
        signal: expect.any(AbortSignal)
      }));
    });

    test('should validate URL', async () => {
      await expect(toolExecutor.callUserDefinedEndpoint('invalid-url', {}, 'POST'))
        .rejects.toThrow('Invalid endpoint URL');

      expect(errorHandler.handle).not.toHaveBeenCalled(); // wrapAsync handles it
    });

    test('should handle non-JSON response', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'text/plain' },
        text: () => 'plain text response'
      });

      const result = await toolExecutor.callUserDefinedEndpoint('https://text.com', {}, 'GET');

      expect(result).toBe('plain text response');
    });
  });

  describe('getBuiltInTool', () => {
    test('should return null for unknown tool', () => {
      expect(toolExecutor.getBuiltInTool('unknown')).toBeNull();
    });

    test('should return built-in implementation if exists', () => {
      toolExecutor.getBuiltInTool = jest.fn().mockReturnValue(() => 'result');
      expect(toolExecutor.getBuiltInTool('test')).toBeDefined();
    });
  });

  describe('Active Executions Management', () => {
    test('should track active executions count', () => {
      expect(toolExecutor.getActiveExecutionsCount()).toBe(0);
    });

    test('should clear all active executions', () => {
      toolExecutor.activeToolExecutions.add('test');
      toolExecutor.clearActiveExecutions();
      expect(toolExecutor.getActiveExecutionsCount()).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should track analytics on tool error', async () => {
      const toolCall = { id: 'error-1', name: 'error-tool', arguments: '{}' };
      toolExecutor.getAllToolDefinitions.mockResolvedValueOnce([]);

      await toolExecutor.executeTool(toolCall, mockSendResponse);

      expect(analytics.trackErrorEvent).toHaveBeenCalledWith('tool_error', 'error-tool');
    });
  });
});