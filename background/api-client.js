import { ErrorSeverity, ErrorCategory, createError } from '../errorHandler.js';
import { sendMessageWithRetry } from '../utils/message-utils.js';
import logger from '../utils/logger.js';

/**
 * @typedef {Object} ApiRequestOptions
 * @property {string} [customInstructionToolChoice='none'] - Tool choice for custom instructions
 * @property {boolean} [isStartChat] - Whether this request is starting a new chat
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

    /** @type {Array<Function>} Queue for rate-limited requests */
    this.requestQueue = [];
    /** @type {boolean} Whether a request is currently being processed */
    this.isProcessingQueue = false;
    /** @type {number} Timestamp when next request can be made */
    this.nextRequestTime = 0;
  }

  /**
   * Queue a request for execution
   * @param {string} promptContent - The prompt content to send
   * @param {number|null} tabId - The tab ID associated with the request
   * @param {ApiRequestOptions} options - Additional request options
   */
  queueRequest(promptContent, tabId, options = {}) {
    this.requestQueue.push(() => this.executeRequest(promptContent, tabId, options));
    this.processQueue();
  }

  /**
   * Process the request queue
   */
  async processQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    // Wait if we're rate limited
    const now = Date.now();
    if (this.nextRequestTime > now) {
      const waitTime = this.nextRequestTime - now;
      logger.info('BackgroundApiClient', `Rate limited, waiting ${waitTime}ms before next request`);
      await this.sleep(waitTime);
    }

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      try {
        await request();
      } catch (error) {
        logger.error('BackgroundApiClient', 'Error executing queued request:', error);
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Make API request with retry logic
   * @param {string} url - API endpoint URL
   * @param {Object} options - Fetch options
   * @param {number} retryCount - Current retry attempt
   * @param {number} maxRetries - Maximum number of retries
   * @returns {Promise<Response>}
   */
  async fetchWithRetry(url, options, retryCount = 0, maxRetries = 5) {
    const response = await fetch(url, options);

    if (!response.ok) {
      // Handle rate limiting (429)
      if (response.status === 429) {
        // Check for quota issues which shouldn't be retried
        let isQuotaError = false;
        try {
          const responseClone = response.clone();
          const errorBody = await responseClone.text();
          if (errorBody && (
            errorBody.includes('insufficient_quota') || 
            errorBody.includes('billing') ||
            errorBody.includes('quota_exceeded')
          )) {
            isQuotaError = true;
            logger.error('BackgroundApiClient', 'Quota exceeded, not retrying:', errorBody);
          }
        } catch (e) {
          // Ignore body read errors
        }

        if (isQuotaError) {
           throw new Error(`API request failed: ${response.status} ${response.statusText} (Quota Exceeded)`);
        }

        if (retryCount >= maxRetries) {
          throw new Error(`API request failed: ${response.status} ${response.statusText} (max retries exceeded)`);
        }

        // Get retry delay from Retry-After header or use exponential backoff
        const retryAfter = response.headers.get('Retry-After');
        let delayMs;

        if (retryAfter) {
          // Retry-After can be seconds or a date
          const seconds = parseInt(retryAfter, 10);
          if (!isNaN(seconds)) {
            delayMs = seconds * 1000;
          } else {
            const date = new Date(retryAfter);
            delayMs = date.getTime() - Date.now();
          }
          logger.warn('BackgroundApiClient', `Server requested wait time: ${delayMs}ms`);
        } else {
          // Exponential backoff with jitter - increased base
          // 2^0 * 2000 = 2000ms
          // 2^1 * 2000 = 4000ms
          // 2^2 * 2000 = 8000ms
          const baseDelay = Math.pow(2, retryCount) * 2000; 
          const jitter = Math.random() * 1000; // Add up to 1s of randomness
          delayMs = baseDelay + jitter;
        }

        // Ensure minimum delay of 2 seconds
        delayMs = Math.max(delayMs, 2000);

        logger.warn('BackgroundApiClient', `Rate limited (429), retrying after ${Math.round(delayMs)}ms (attempt ${retryCount + 1}/${maxRetries})`);

        // Update next request time
        this.nextRequestTime = Date.now() + delayMs;

        await this.sleep(delayMs);

        // Retry the request
        return this.fetchWithRetry(url, options, retryCount + 1, maxRetries);
      }

      // For other errors, throw immediately
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /**
   * Main API request handler - queues request for execution with rate limit handling
   * @param {string} promptContent - The prompt content to send
   * @param {number|null} tabId - The tab ID associated with the request
   * @param {ApiRequestOptions} [options={}] - Additional request options
   * @returns {Promise<void>}
   */
  async makeApiRequest(promptContent, tabId, options = {}) {
    // Queue the request to handle rate limiting
    this.queueRequest(promptContent, tabId, options);
  }

  /**
   * Execute the actual API request
   * @param {string} promptContent - The prompt content to send
   * @param {number|null} tabId - The tab ID associated with the request
   * @param {ApiRequestOptions} [options={}] - Additional request options
   * @returns {Promise<void>}
   */
  async executeRequest(promptContent, tabId, options = {}) {
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
      logger.info('BackgroundApiClient', `Starting API request for tab ${tabId}`);

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

      // Make API request with retry logic for rate limiting
      logger.info('BackgroundApiClient', `Making API request to ${config.apiEndpoint}`);
      const response = await this.fetchWithRetry(config.apiEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...this.defaultHeaders,
        },
        body: JSON.stringify(requestBody),
      });

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
    sendMessageWithRetry({
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
                sendMessageWithRetry({
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
      sendMessageWithRetry({
        action: 'streamApiEnd',
        tabId: tabId,
      }).catch(e => logger.error('Error sending stream end:', e));

    } catch (error) {
      logger.error('BackgroundApiClient', 'Streaming error:', error);
      // Send stream end even on error
      sendMessageWithRetry({
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
    let errorMessage = error.message || 'An error occurred while processing your request';

    // Special handling for rate limit errors
    if (errorMessage.includes('429') || errorMessage.toLowerCase().includes('rate limit')) {
      if (errorMessage.includes('max retries exceeded')) {
        errorMessage = 'Rate limit exceeded. Please wait a moment before trying again.';
      } else {
        errorMessage = 'Too many requests. The request has been queued and will be retried automatically.';
      }
    }

    chrome.runtime
      .sendMessage({
        action: 'displayErrorInChat',
        errorMessage: errorMessage,
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
