import { ErrorSeverity, ErrorCategory, createError } from '../errorHandler.js';
import logger from '../utils/logger.js';

/**
 * @typedef {Object} ApiRequestOptions
 * @property {string} [customInstructionToolChoice='none'] - Tool choice for custom instructions
 */

/**
 * API Client
 * Handles LLM API requests and responses
 * @class
 */
export class ApiClient {
  constructor() {
    /** @type {Object.<string, string>} Default headers for API requests */
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
  }

  /**
   * Main API request handler
   * @param {string} promptContent - The prompt content to send
   * @param {number|null} tabId - The tab ID associated with the request
   * @param {ApiRequestOptions} [options={}] - Additional request options
   * @returns {Promise<void>}
   */
  async makeApiRequest(promptContent, tabId, options = {}) {
    const { customInstructionToolChoice = 'none' } = options;

    // Defensive tab ID validation
    if (tabId !== null && (typeof tabId !== 'number' || tabId < 0)) {
      const errorMsg = `Invalid tabId: ${tabId} (type: ${typeof tabId})`;
      logger.error('BackgroundApiClient', errorMsg);

      // Show error badge
      chrome.action.setBadgeText({ text: 'ERR' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });

      setTimeout(() => {
        chrome.action.setBadgeText({ text: '' });
      }, 3000);

      // Send error response if tabId is valid
      if (typeof tabId === 'number' && tabId >= 0) {
        chrome.runtime
          .sendMessage({
            action: 'displayErrorInChat',
            errorMessage: `Invalid tab context: ${errorMsg}`,
            tabId: tabId,
            prompt: promptContent,
          })
          .catch(e => logger.error('BackgroundApiClient', 'Error sending tabId error message:', e));
      }

      return;
    }

    try {
      // Get configuration and tools
      const [config, tools, { enableStreaming }] = await Promise.all([
        this.validateConfig(),
        this.getAllToolDefinitions(),
        chrome.storage.sync.get({ enableStreaming: false }),
      ]);

      // Format tools for the API
      const formattedTools = tools
        .map(tool => {
          try {
            const parsedParameters = this.safeJsonParse(
              tool.parameters || '{}',
              `tool-definition-${tool.name}`,
              {}
            );
            const validatedParameters = this.validateToolParameters(parsedParameters, tool.name);

            return {
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: validatedParameters,
              },
            };
          } catch (e) {
            logger.error(
              'BackgroundApiClient',
              `Error parsing parameters for tool ${tool.name}:`,
              e
            );
            return null;
          }
        })
        .filter(tool => tool !== null);

      // Prepare messages
      const messages = [
        {
          role: 'system',
          content: this.buildSystemPrompt(config),
        },
        {
          role: 'user',
          content: promptContent,
        },
      ];

      // Prepare request body
      const requestBody = {
        model: config.modelName,
        messages: messages,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        stream: enableStreaming || false,
      };

      // Add tools if available
      if (formattedTools.length > 0) {
        requestBody.tools = formattedTools;

        // Add tool_choice based on customInstructionToolChoice
        if (customInstructionToolChoice === 'none') {
          requestBody.tool_choice = 'auto';
        } else if (customInstructionToolChoice === 'required') {
          requestBody.tool_choice = 'required';
        } else {
          requestBody.tool_choice = customInstructionToolChoice;
        }
      }

      // Make API request
      const response = await fetch(config.apiEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...this.defaultHeaders,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      // Handle streaming response
      if (enableStreaming) {
        await this.handleStreamingResponse(response, tabId);
      } else {
        await this.handleNonStreamingResponse(response, tabId);
      }
    } catch (error) {
      logger.error('BackgroundApiClient', 'Error making API request:', error);
      this.handleError(error, tabId, promptContent);
    }
  }

  // Build system prompt
  buildSystemPrompt(config) {
    const now = new Date();
    const dateTimeString = `Date: ${now.toLocaleDateString()} Time: ${now.toLocaleTimeString()}`;

    let systemPromptContent = dateTimeString;

    if (config.systemPrompt && config.systemPrompt.trim() !== '') {
      systemPromptContent += `\n\n${config.systemPrompt}`;
    }

    return systemPromptContent;
  }

  // Handle streaming response
  async handleStreamingResponse(response, tabId) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let isFirstChunk = true;

    // Send stream start message
    chrome.runtime.sendMessage({
      action: 'streamApiStart',
      tabId: tabId,
    }).catch(e => logger.error('Error sending stream start:', e));

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;

              if (content) {
                // Send streaming chunk to chat
                chrome.runtime.sendMessage({
                  action: 'streamApiResponseChunk',
                  chunk: content,
                  tabId: tabId,
                }).catch(e => logger.error('Error sending streaming chunk:', e));
              }
            } catch {
              // Ignore JSON parse errors for streaming data
            }
          }
        }
      }

      // Send stream end message
      chrome.runtime.sendMessage({
        action: 'streamApiEnd',
        tabId: tabId,
      }).catch(e => logger.error('Error sending stream end:', e));

    } catch (error) {
      logger.error('BackgroundApiClient', 'Streaming error:', error);
      // Send stream end even on error
      chrome.runtime.sendMessage({
        action: 'streamApiEnd',
        tabId: tabId,
        error: error.message,
      }).catch(e => logger.error('Error sending stream end:', e));
    }
  }

  // Handle non-streaming response
  async handleNonStreamingResponse(response, tabId) {
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (content) {
      chrome.runtime
        .sendMessage({
          action: 'setApiResponse',
          apiResponse: content,
          tabId: tabId,
        })
        .catch(e => logger.error('Error sending API response:', e));
    }
  }

  // Handle errors
  handleError(error, tabId, promptContent) {
    chrome.runtime
      .sendMessage({
        action: 'displayErrorInChat',
        errorMessage: error.message || 'An error occurred while processing your request',
        tabId: tabId,
        prompt: promptContent,
      })
      .catch(e => logger.error('Error sending error message:', e));
  }

  // Validate configuration
  async validateConfig() {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(
        ['apiKey', 'apiEndpoint', 'modelName', 'maxTokens', 'temperature', 'systemPrompt'],
        result => {
          if (chrome.runtime.lastError) {
            reject(
              createError('Failed to retrieve configuration', {
                category: ErrorCategory.STORAGE,
                severity: ErrorSeverity.HIGH,
              })
            );
            return;
          }

          if (!result.apiKey || !result.apiEndpoint) {
            reject(
              createError(
                'LLM API endpoint is missing or invalid. Please configure it in the options page.',
                {
                  category: ErrorCategory.CONFIGURATION,
                  severity: ErrorSeverity.HIGH,
                }
              )
            );
            return;
          }

          resolve({
            apiKey: result.apiKey,
            apiEndpoint: result.apiEndpoint,
            modelName: result.modelName || 'gpt-3.5-turbo',
            maxTokens: parseInt(result.maxTokens) || 1000,
            temperature: parseFloat(result.temperature) || 0.7,
            systemPrompt: result.systemPrompt || '',
          });
        }
      );
    });
  }

  // Get all tool definitions (delegated to tool manager)
  async getAllToolDefinitions() {
    // This will be injected during initialization
    if (this.toolManager) {
      return await this.toolManager.getAllToolDefinitions();
    }
    return [];
  }

  // Safe JSON parsing utility
  safeJsonParse(jsonString, context = 'unknown', defaultValue = null) {
    if (typeof jsonString !== 'string') {
      logger.warn(
        `JSON Parse Warning [${context}]: Input is not a string, got ${typeof jsonString}`
      );
      return defaultValue;
    }

    if (!jsonString.trim()) {
      logger.warn(`JSON Parse Warning [${context}]: Empty string provided`);
      return defaultValue;
    }

    try {
      const result = JSON.parse(jsonString);

      if (result === null || result === undefined) {
        logger.warn(`JSON Parse Warning [${context}]: Parse resulted in null/undefined`);
        return defaultValue;
      }

      return result;
    } catch (error) {
      logger.error(`JSON Parse Error [${context}]:`, {
        error: error.message,
        input: jsonString.substring(0, 200) + (jsonString.length > 200 ? '...' : ''),
        stack: error.stack,
      });
      return defaultValue;
    }
  }

  // Validate tool parameters
  validateToolParameters(parameters, toolName) {
    if (!parameters || typeof parameters !== 'object') {
      logger.warn(`Invalid parameters for tool ${toolName}:`, parameters);
      return {};
    }

    // Basic validation - ensure it's a valid JSON schema object
    if (parameters.type !== 'object') {
      logger.warn(`Invalid parameters type for tool ${toolName}:`, parameters.type);
      return { type: 'object', properties: {} };
    }

    return parameters;
  }

  // Set tool manager reference
  setToolManager(toolManager) {
    this.toolManager = toolManager;
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
