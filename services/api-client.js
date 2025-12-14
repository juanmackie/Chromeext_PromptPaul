import {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
  wrapAsync,
} from '../errorHandler.js';
import { storageService } from './storage-service.js';
import logger from '../utils/logger.js';
import { validateUrl } from '../utils/validation.js';

/**
 * API Error Types
 */
export const ApiErrorType = {
  NETWORK: 'network',
  AUTHENTICATION: 'authentication',
  CONFIGURATION: 'configuration',
  RATE_LIMIT: 'rate_limit',
  VALIDATION: 'validation',
  SERVER: 'server',
  UNKNOWN: 'unknown',
};

/**
 * API Provider Types
 */
export const ApiProvider = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  MISTRAL: 'mistral',
  CLAUDE_COMPATIBLE: 'claude_compatible',
  CUSTOM: 'custom',
};

/**
 * Authentication Manager
 * Handles API keys, tokens, and provider-specific authentication
 */
class AuthenticationManager {
  constructor() {
    this.tokenCache = new Map();
  }

  /**
   * Build authorization headers for API request
   * @param {Object} config - API configuration
   * @returns {Object} Authorization headers
   */
  buildAuthHeaders(config) {
    const headers = {};

    if (!config.apiKey) {
      throw createError('API key is required', {
        category: ErrorCategory.AUTHENTICATION,
        severity: ErrorSeverity.CRITICAL,
        userMessage: 'API key is missing. Please configure it in the options page.',
      });
    }

    // Standard Bearer token authentication (most providers)
    headers['Authorization'] = `Bearer ${config.apiKey}`;

    // Provider-specific headers
    switch (this.detectProvider(config)) {
      case ApiProvider.ANTHROPIC:
        headers['anthropic-version'] = config.anthropicVersion || '2023-06-01';
        break;
      case ApiProvider.OPENAI:
        headers['OpenAI-Organization'] = config.organizationId || '';
        break;
      case ApiProvider.MISTRAL:
        // Mistral uses standard Bearer token
        break;
      default:
        // Custom/Claude-compatible - use standard headers
        break;
    }

    return headers;
  }

  /**
   * Detect API provider based on configuration
   * @param {Object} config - API configuration
   * @returns {string} Provider type
   */
  detectProvider(config) {
    const endpoint = config.llmEndpoint?.toLowerCase() || '';

    if (endpoint.includes('api.openai.com')) {
      return ApiProvider.OPENAI;
    } else if (endpoint.includes('api.anthropic.com')) {
      return ApiProvider.ANTHROPIC;
    } else if (endpoint.includes('api.mistral.ai')) {
      return ApiProvider.MISTRAL;
    } else if (config.provider) {
      return config.provider;
    } else {
      return ApiProvider.CUSTOM;
    }
  }

  /**
   * Validate API key format
   * @param {string} apiKey - API key to validate
   * @param {string} provider - Provider type
   * @returns {boolean} True if valid format
   */
  validateApiKeyFormat(apiKey, provider) {
    if (!apiKey || typeof apiKey !== 'string') {
      return false;
    }

    switch (provider) {
      case ApiProvider.OPENAI:
        return apiKey.startsWith('sk-') && apiKey.length >= 20;
      case ApiProvider.ANTHROPIC:
        return apiKey.startsWith('sk-ant-') && apiKey.length >= 20;
      case ApiProvider.MISTRAL:
        return apiKey.length >= 32; // Mistral keys are typically 32+ chars
      default:
        return apiKey.length >= 10; // Minimum length for custom providers
    }
  }
}

/**
 * Request Builder
 * Constructs API request payloads and validates configurations
 */
class RequestBuilder {
  constructor(authManager) {
    this.authManager = authManager;
  }

  /**
   * Build complete API request configuration
   * @param {Object} config - API configuration
   * @param {Object} options - Request options
   * @returns {Object} Complete request configuration
   */
  buildRequest(config, options = {}) {
    const {
      messages = [],
      tools = [],
      toolChoice = 'none',
      stream = false,
      maxTokens = null,
      temperature = null,
      model = null,
    } = options;

    // Validate required fields
    this.validateConfiguration(config);

    // Build request payload
    const payload = {
      model: model || config.modelName,
      messages: this.formatMessages(messages, config),
      max_tokens: maxTokens || parseInt(config.maxTokens) || 2048,
    };

    // Add optional parameters
    if (temperature !== null) {
      payload.temperature = temperature;
    }

    // Add tools if specified
    const toolPayload = this.buildToolPayload(tools, toolChoice);
    Object.assign(payload, toolPayload);

    // Enable streaming if requested
    if (stream) {
      payload.stream = true;
    }

    // Build headers
    const headers = {
      'Content-Type': 'application/json',
      ...this.authManager.buildAuthHeaders(config),
    };

    return {
      url: config.llmEndpoint,
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    };
  }

  /**
   * Validate API configuration
   * @param {Object} config - Configuration to validate
   */
  validateConfiguration(config) {
    const errors = [];

    if (!config.llmEndpoint) {
      errors.push('API endpoint is required');
    } else if (!this.isValidUrl(config.llmEndpoint)) {
      errors.push('API endpoint must be a valid URL');
    }

    if (!config.apiKey) {
      errors.push('API key is required');
    }

    if (!config.modelName) {
      errors.push('Model name is required');
    }

    if (errors.length > 0) {
      throw createError(`Configuration validation failed: ${errors.join(', ')}`, {
        category: ErrorCategory.CONFIGURATION,
        severity: ErrorSeverity.CRITICAL,
        context: { errors, config: { ...config, apiKey: '***' } },
        userMessage:
          'API configuration is incomplete. Please check your settings in the options page.',
      });
    }

    // Validate API key format
    const provider = this.authManager.detectProvider(config);
    if (!this.authManager.validateApiKeyFormat(config.apiKey, provider)) {
      throw createError(`Invalid API key format for ${provider}`, {
        category: ErrorCategory.CONFIGURATION,
        severity: ErrorSeverity.CRITICAL,
        context: { provider, keyLength: config.apiKey?.length },
        userMessage: `The API key format appears invalid for ${provider}. Please check your API key.`,
      });
    }
  }

  /**
   * Format messages for API request
   * @param {Array} messages - Message array
   * @param {Object} config - Configuration
   * @returns {Array} Formatted messages
   */
  formatMessages(messages, config) {
    const formatted = [];

    // Add system prompt if configured
    if (config.systemPrompt && config.systemPrompt.trim()) {
      const now = new Date();
      const dateTimeString = `Date: ${now.toLocaleDateString()} Time: ${now.toLocaleTimeString()}`;

      formatted.push({
        role: 'system',
        content: `${dateTimeString}\n\n${config.systemPrompt.trim()}`,
      });
    }

    // Add user messages
    messages.forEach(msg => {
      if (msg.role && msg.content) {
        formatted.push({
          role: msg.role,
          content: msg.content,
        });
      }
    });

    return formatted;
  }

  /**
   * Build tool payload for API request
   * @param {Array} tools - Tool definitions
   * @param {string} toolChoice - Tool choice setting
   * @returns {Object} Tool payload
   */
  buildToolPayload(tools, toolChoice) {
    const formattedTools = tools
      .map(tool => {
        try {
          return {
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters:
                typeof tool.parameters === 'string'
                  ? JSON.parse(tool.parameters)
                  : tool.parameters || {},
            },
          };
        } catch (e) {
          logger.error('APIClient', `Error parsing parameters for tool ${tool.name}:`, e);
          return null;
        }
      })
      .filter(tool => tool !== null);

    const payload = {};

    if (toolChoice === 'none' || formattedTools.length === 0) {
      return payload;
    }

    payload.tools = formattedTools;

    if (toolChoice === 'auto') {
      payload.tool_choice = 'auto';
    } else if (typeof toolChoice === 'string') {
      const specificTool = formattedTools.find(t => t.function.name === toolChoice);
      if (specificTool) {
        payload.tool_choice = {
          type: 'function',
          function: { name: toolChoice },
        };
      }
    } else if (Array.isArray(toolChoice) && toolChoice.length > 0) {
      const selectedTools = formattedTools.filter(tool => toolChoice.includes(tool.function.name));
      payload.tools = selectedTools;
      payload.tool_choice =
        selectedTools.length === 1
          ? { type: 'function', function: { name: selectedTools[0].function.name } }
          : 'auto';
    }

    return payload;
  }

  /**
   * Check if URL is valid
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid
   */
  isValidUrl(url) {
    const result = validateUrl(url);
    return result.isValid;
  }
}

/**
 * Streaming Processor
 * Handles Server-Sent Events (SSE) and streaming responses
 */
class StreamingProcessor {
  constructor() {
    this.activeStreams = new Map();
  }

  /**
   * Process streaming response
   * @param {Response} response - Fetch response
   * @param {Function} onChunk - Chunk callback
   * @param {Function} onComplete - Completion callback
   * @param {Function} onError - Error callback
   */
  async processStream(response, onChunk, onComplete, onError) {
    if (!response.body) {
      throw createError('Response body is missing for streaming', {
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.HIGH,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const streamId = this.generateStreamId();

    this.activeStreams.set(streamId, { reader, decoder });

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (onComplete) onComplete();
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep partial line

        for (const line of lines) {
          this.processStreamLine(line, onChunk, onError);
        }
      }
    } catch (error) {
      if (onError) onError(error);
      throw error;
    } finally {
      this.activeStreams.delete(streamId);
      reader.releaseLock();
    }
  }

  /**
   * Process a single streaming line
   * @param {string} line - Streaming line
   * @param {Function} onChunk - Chunk callback
   * @param {Function} onError - Error callback
   */
  processStreamLine(line, onChunk, onError) {
    if (!line.startsWith('data:')) {
      return;
    }

    let data = line.substring(5).trim();

    // Handle nested data prefixes
    while (data.startsWith('data:')) {
      data = data.substring(5).trim();
    }

    if (data === '[DONE]') {
      return;
    }

    if (!data || (!data.startsWith('{') && !data.startsWith('['))) {
      return;
    }

    try {
      const parsed = JSON.parse(data);

      if (parsed.choices && parsed.choices[0]) {
        const choice = parsed.choices[0];

        // Content chunk
        if (choice.delta?.content) {
          if (onChunk) {
            onChunk({
              type: 'content',
              content: choice.delta.content,
            });
          }
        }

        // Tool call chunk
        if (choice.delta?.tool_calls) {
          if (onChunk) {
            onChunk({
              type: 'tool_call',
              tool_calls: choice.delta.tool_calls,
            });
          }
        }
      }
    } catch (error) {
      logger.error('APIClient', 'Error parsing streaming chunk:', error, 'Data:', data);
      if (onError) {
        onError(
          createError('Failed to parse streaming chunk', {
            category: ErrorCategory.NETWORK,
            severity: ErrorSeverity.MEDIUM,
            originalError: error,
          })
        );
      }
    }
  }

  /**
   * Generate unique stream ID
   * @returns {string} Stream ID
   */
  generateStreamId() {
    return `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cancel active stream
   * @param {string} streamId - Stream ID to cancel
   */
  cancelStream(streamId) {
    const stream = this.activeStreams.get(streamId);
    if (stream && stream.reader) {
      stream.reader.cancel();
      this.activeStreams.delete(streamId);
    }
  }

  /**
   * Cancel all active streams
   */
  cancelAllStreams() {
    for (const [streamId, stream] of this.activeStreams) {
      if (stream.reader) {
        stream.reader.cancel();
      }
    }
    this.activeStreams.clear();
  }
}

/**
 * API Client
 * Centralized client for all API interactions
 */
export class ApiClient {
  constructor() {
    this.authManager = new AuthenticationManager();
    this.requestBuilder = new RequestBuilder(this.authManager);
    this.streamingProcessor = new StreamingProcessor();
    this.defaultConfig = {
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 30000,
    };
  }

  /**
   * Make API request (non-streaming)
   * @param {Object} config - API configuration
   * @param {Object} options - Request options
   * @returns {Promise<Object>} API response
   */
  async makeRequest(config, options = {}) {
    return await wrapAsync(
      async () => {
        logger.info('APIClient', '🚀 API Client: Starting non-streaming request');
        logger.info('APIClient', '📋 Request config:', {
          endpoint: config.llmEndpoint ? '✓ Set' : '✗ Missing',
          apiKey: config.apiKey ? '✓ Set (' + config.apiKey.substring(0, 7) + '...)' : '✗ Missing',
          model: config.modelName || '✗ Missing',
          streaming: false,
          messagesCount: options.messages?.length || 0,
          toolsCount: options.tools?.length || 0,
        });

        const request = this.requestBuilder.buildRequest(config, options);

        logger.info('APIClient', '🌐 Request details:', {
          url: request.url,
          method: request.method,
          headers: Object.keys(request.headers),
          bodyLength: request.body?.length || 0,
          hasAuth: !!request.headers.Authorization,
        });

        // Add timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.defaultConfig.timeout);

        logger.info('⏱️ Sending request with timeout:', this.defaultConfig.timeout + 'ms');

        try {
          const response = await fetch(request.url, {
            ...request,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          logger.info('📡 Response received:', {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            ok: response.ok,
          });

          if (!response.ok) {
            logger.error('❌ HTTP Error Response:', response.status, response.statusText);
            await this.handleHttpError(response);
          }

          const responseData = await response.json();
          logger.info('✅ Successful response parsed:', {
            hasChoices: !!responseData.choices,
            choicesCount: responseData.choices?.length || 0,
            hasUsage: !!responseData.usage,
            responseType: typeof responseData,
          });

          return responseData;
        } catch (error) {
          clearTimeout(timeoutId);

          logger.error('💥 Request failed:', {
            name: error.name,
            message: error.message,
            stack: error.stack?.substring(0, 500),
          });

          if (error.name === 'AbortError') {
            throw createError('Request timeout', {
              category: ErrorCategory.NETWORK,
              severity: ErrorSeverity.HIGH,
              userMessage: `Request timed out after ${this.defaultConfig.timeout}ms. Please try again.`,
            });
          }

          throw error;
        }
      },
      {
        category: ErrorCategory.NETWORK,
        userMessage: 'Failed to make API request',
        retryCount: options.retryCount || 0,
      }
    );
  }

  /**
   * Make streaming API request
   * @param {Object} config - API configuration
   * @param {Object} options - Request options
   * @param {Function} onChunk - Chunk callback
   * @param {Function} onComplete - Completion callback
   * @returns {Promise<void>}
   */
  async makeStreamingRequest(config, options = {}, onChunk, onComplete) {
    return await wrapAsync(
      async () => {
        logger.info('🌊 API Client: Starting streaming request');
        logger.info('📋 Stream config:', {
          endpoint: config.llmEndpoint ? '✓ Set' : '✗ Missing',
          apiKey: config.apiKey ? '✓ Set (' + config.apiKey.substring(0, 7) + '...)' : '✗ Missing',
          model: config.modelName || '✗ Missing',
          streaming: true,
          messagesCount: options.messages?.length || 0,
          toolsCount: options.tools?.length || 0,
          toolChoice: options.toolChoice || 'none',
        });

        const requestConfig = { ...options, stream: true };
        const request = this.requestBuilder.buildRequest(config, requestConfig);

        logger.info('🌐 Stream request details:', {
          url: request.url,
          method: request.method,
          headers: Object.keys(request.headers),
          bodyLength: request.body?.length || 0,
          hasAuth: !!request.headers.Authorization,
          hasStream: request.body?.includes('"stream":true') || false,
        });

        // Add timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.defaultConfig.timeout);

        logger.info(
          '⏱️ Sending streaming request with timeout:',
          this.defaultConfig.timeout + 'ms'
        );

        try {
          const response = await fetch(request.url, {
            ...request,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          logger.info('📡 Stream response received:', {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            ok: response.ok,
            contentType: response.headers.get('content-type'),
            hasBody: !!response.body,
          });

          if (!response.ok) {
            logger.error(
              '❌ HTTP Error Response for stream:',
              response.status,
              response.statusText
            );
            await this.handleHttpError(response);
          }

          logger.info('🔄 Starting stream processing...');
          let chunkCount = 0;
          let contentChunks = 0;
          let toolCallChunks = 0;

          const enhancedOnChunk = chunk => {
            chunkCount++;
            if (chunk.type === 'content') {
              contentChunks++;
              logger.info(
                `📝 Content chunk ${contentChunks}:`,
                chunk.content?.substring(0, 50) + (chunk.content?.length > 50 ? '...' : '')
              );
            } else if (chunk.type === 'tool_call') {
              toolCallChunks++;
              logger.info(`🔧 Tool call chunk ${toolCallChunks}:`, chunk.tool_calls);
            }

            // Call original callback
            if (onChunk) onChunk(chunk);
          };

          await this.streamingProcessor.processStream(
            response,
            enhancedOnChunk,
            () => {
              logger.info('✅ Streaming completed successfully');
              logger.info('📊 Stream summary:', {
                totalChunks: chunkCount,
                contentChunks,
                toolCallChunks,
              });
              // Call completion callback if provided
              if (onComplete) onComplete();
            },
            error => {
              logger.error('💥 Streaming error:', error);
              logger.info('📊 Stream summary before error:', {
                totalChunks: chunkCount,
                contentChunks,
                toolCallChunks,
              });
            }
          );
        } catch (error) {
          clearTimeout(timeoutId);

          logger.error('💥 Streaming request failed:', {
            name: error.name,
            message: error.message,
            stack: error.stack?.substring(0, 500),
          });

          if (error.name === 'AbortError') {
            throw createError('Request timeout', {
              category: ErrorCategory.NETWORK,
              severity: ErrorSeverity.HIGH,
              userMessage: `Streaming request timed out after ${this.defaultConfig.timeout}ms. Please try again.`,
            });
          }

          throw error;
        }
      },
      {
        category: ErrorCategory.NETWORK,
        userMessage: 'Failed to start streaming request',
      }
    );
  }

  /**
   * Make API request with media
   * @param {Object} config - API configuration
   * @param {Object} mediaData - Media data
   * @param {Object} options - Request options
   * @returns {Promise<Object>} API response
   */
  async makeMediaRequest(config, mediaData, options = {}) {
    return await wrapAsync(
      async () => {
        // Validate media data
        if (!mediaData || !mediaData.base64) {
          throw createError('Media data is required', {
            category: ErrorCategory.VALIDATION,
            severity: ErrorSeverity.HIGH,
          });
        }

        // Build messages array - handle case where options.messages might not exist
        const existingMessages = Array.isArray(options.messages) ? options.messages : [];

        // Add media to messages
        const messages = [
          ...existingMessages,
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: options.prompt || '',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mediaData.mimeType};base64,${mediaData.base64}`,
                },
              },
            ],
          },
        ];

        const requestConfig = {
          ...options,
          messages,
          tools: options.tools || [],
          toolChoice: options.toolChoice || 'none',
        };
        return await this.makeRequest(config, requestConfig);
      },
      {
        category: ErrorCategory.NETWORK,
        userMessage: 'Failed to make media request',
      }
    );
  }

  /**
   * Handle HTTP error responses
   * @param {Response} response - HTTP response
   */
  async handleHttpError(response) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = null;
    }

    const errorMessage = errorData?.error?.message || errorData?.message || response.statusText;
    const errorType = this.categorizeError(response.status, errorMessage);

    throw createError(`API request failed: ${response.status} ${errorMessage}`, {
      category: ErrorCategory.NETWORK,
      severity: this.getSeverityForStatus(response.status),
      context: {
        status: response.status,
        statusText: response.statusText,
        errorData,
      },
      userMessage: this.getUserMessageForErrorWithContext(errorType, response.status, errorMessage),
    });
  }

  /**
   * Categorize error based on status and message
   * @param {number} status - HTTP status
   * @param {string} message - Error message
   * @returns {string} Error type
   */
  categorizeError(status, message) {
    if (status === 401 || status === 403) {
      return ApiErrorType.AUTHENTICATION;
    } else if (status === 429) {
      return ApiErrorType.RATE_LIMIT;
    } else if (status >= 400 && status < 500) {
      return ApiErrorType.VALIDATION;
    } else if (status >= 500) {
      return ApiErrorType.SERVER;
    } else if (message?.toLowerCase().includes('network')) {
      return ApiErrorType.NETWORK;
    } else {
      return ApiErrorType.UNKNOWN;
    }
  }

  /**
   * Get severity for HTTP status
   * @param {number} status - HTTP status
   * @returns {string} Error severity
   */
  getSeverityForStatus(status) {
    if (status === 401 || status === 403) {
      return ErrorSeverity.CRITICAL;
    } else if (status === 429) {
      return ErrorSeverity.HIGH;
    } else if (status >= 500) {
      return ErrorSeverity.HIGH;
    } else if (status >= 400) {
      return ErrorSeverity.MEDIUM;
    } else {
      return ErrorSeverity.MEDIUM;
    }
  }

  /**
   * Get user-friendly message for error
   * @param {string} errorType - Error type
   * @param {number} status - HTTP status
   * @returns {string} User message
   */
  getUserMessageForError(errorType, status) {
    switch (errorType) {
      case ApiErrorType.AUTHENTICATION:
        return 'Authentication failed. Please check your API key in the options page.';
      case ApiErrorType.RATE_LIMIT:
        return 'Rate limit exceeded. Please wait before making another request.';
      case ApiErrorType.SERVER:
        return 'The API server is experiencing issues. Please try again later.';
      case ApiErrorType.VALIDATION:
        return 'Invalid request. Please check your input and try again.';
      case ApiErrorType.NETWORK:
        return 'Network error. Please check your connection and try again.';
      case ApiErrorType.CONFIGURATION:
        return 'Configuration error. Please check your settings.';
      default:
        return 'An unexpected error occurred. Please try again.';
    }
  }

  /**
   * Get user-friendly message for error, potentially using the specific error message
   * @param {string} errorType - Error type
   * @param {number} status - HTTP status
   * @param {string} errorMessage - Original error message
   * @returns {string} User message
   */
  getUserMessageForErrorWithContext(errorType, status, errorMessage) {
    // Special handling for OpenRouter free model policy
    if ((status === 404 || status === 403) &&
      (errorMessage?.includes('data policy') || errorMessage?.includes('Free model publication'))) {
      return 'OpenRouter Policy Error: Free models require "Allow model training" to be enabled in your OpenRouter settings (https://openrouter.ai/settings/privacy).';
    }

    return this.getUserMessageForError(errorType, status);
  }

  /**
   * Cancel all active streams
   */
  cancelAllStreams() {
    this.streamingProcessor.cancelAllStreams();
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
