/**
 * Security Tests - Tool Execution Sandboxing
 * Tests tool executor security against malicious inputs, injection attacks
 */

const { ToolExecutor } = require('../../background/tool-executor.js');

describe('Tool Executor Security - Sandboxing', () => {
  let toolExecutor;
  const mockSendResponse = jest.fn();

  beforeEach(() => {
    toolExecutor = new ToolExecutor();
    toolExecutor.getAllToolDefinitions = jest.fn().mockResolvedValue([
      {
        name: 'test-tool',
        endpointUrl: 'https://safe.example.com/api',
        httpMethod: 'POST',
      },
    ]);
  });

  test('should reject malicious URL injection in endpoint', async () => {
    const maliciousToolCall = {
      id: 'mal1',
      name: 'test-tool',
      arguments: JSON.stringify({ payload: 'data' }),
    };

    // Mock tool definition with injected URL
    toolExecutor.getAllToolDefinitions.mockResolvedValueOnce([
      {
        name: 'test-tool',
        endpointUrl: 'javascript:alert(1)', // Malicious JS URL
        httpMethod: 'GET',
      },
    ]);

    await toolExecutor.executeTool(maliciousToolCall, mockSendResponse);

    expect(mockSendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Invalid endpoint URL'),
      })
    );
  });

  test('should sanitize arguments against JSON injection', async () => {
    const injectionArgs = `"}; alert('XSS'); //`;
    const toolCall = {
      id: 'inj1',
      name: 'test-tool',
      arguments: JSON.stringify({ param: injectionArgs }),
    };

    await toolExecutor.executeTool(toolCall, mockSendResponse);

    // Should parse safely
    expect(mockSendResponse).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid arguments format' })
    );
  });

  test('should limit payload size to prevent DoS', async () => {
    const largePayload = 'A'.repeat(1000000); // 1MB payload
    const toolCall = {
      id: 'dos1',
      name: 'test-tool',
      arguments: JSON.stringify({ large: largePayload }),
    };

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    await toolExecutor.executeTool(toolCall, mockSendResponse);

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
