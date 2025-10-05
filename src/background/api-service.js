/**
 * API Service
 * Handles all API communication with LLM providers
 * Implements production-ready coding rules for API handling
 *
 * Core Principles:
 * - Input Validation: Validate all API parameters
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient API communication with proper timeouts
 */

import { errorHandler, logger } from '../shared/index.js';

class ApiService {
  constructor(dependencies) {
    this.storage = dependencies.Storage;
    this.logger = dependencies.Logger;
    this.errorHandler = dependencies.ErrorHandler;
    
    // API configuration
    this.defaultTimeout = 30000; // 30 seconds
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
  }

  /**
   * Validates API configuration
   * @returns {Promise<Object>} Validated configuration
   * @throws {Error} If configuration is invalid
   */
  async validateConfig() {
    this.logger.debug('Validating API configuration...');
    
    try {
      const result = await this.storage.get(['profiles', 'lastSelectedProfileId', 'defaultLlmEndpoint']);
      const profiles = result.profiles || [];
      const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
      const defaultLlmEndpoint = result.defaultLlmEndpoint || '';

      // Find profiles
      const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId);
      const defaultProfile = profiles.find(p => p.id === 'default');

      // Validate profile with optional endpoint override
      const validateProfile = (profile, endpointOverride = null) => {
        const endpoint = endpointOverride || profile?.llmEndpoint;
        return endpoint && this.isValidURL(endpoint) && profile?.apiKey && profile?.modelName;
      };

      // Check profiles in priority order
      let validProfile = null;
      if (validateProfile(selectedProfile)) {
        validProfile = selectedProfile;
      } else if (validateProfile(selectedProfile, defaultLlmEndpoint)) {
        validProfile = { ...selectedProfile, llmEndpoint: defaultLlmEndpoint };
      } else if (validateProfile(defaultProfile)) {
        validProfile = defaultProfile;
      } else if (validateProfile(defaultProfile, defaultLlmEndpoint)) {
        validProfile = { ...defaultProfile, llmEndpoint: defaultLlmEndpoint };
      }

      if (validProfile) {
        this.logger.debug(`Using configuration from profile: ${validProfile.name || validProfile.id}`);
        return validProfile;
      }

      // Handle errors
      const hasEndpoint = defaultLlmEndpoint && this.isValidURL(defaultLlmEndpoint);
      const hasValidProfile = selectedProfile || defaultProfile;
      
      if (!hasEndpoint) {
        throw this.errorHandler.createError(
          'CONFIG_ERROR',
          'LLM API endpoint is missing or invalid. Please configure it in the options page.'
        );
      } else if (!hasValidProfile) {
        throw this.errorHandler.createError(
          'CONFIG_ERROR',
          'No valid profiles found. Please create a profile in the options page.'
        );
      } else {
        throw this.errorHandler.createError(
          'CONFIG_ERROR',
          'Configuration is incomplete. Please set API key and model name in the options page.'
        );
      }
    } catch (error) {
      this.logger.error('API configuration validation failed', {}, error);
      throw error;
    }
  }

  /**
   * Checks if a URL is valid
   * @param {string} string - URL to check
   * @returns {boolean} True if valid URL
   */
  isValidURL(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Makes an API request with proper error handling and retries
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Request options
   * @returns {Promise<Object>} API response
   * @throws {Error} If request fails after retries
   */
  async makeRequest(endpoint, options = {}) {
    const {
      method = 'POST',
      headers = {},
      body = null,
      timeout = this.defaultTimeout,
      retries = 0
    } = options;

    this.logger.debug('Making API request', {
      endpoint,
      method,
      timeout,
      retries
    });

    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Set default headers
      const defaultHeaders = {
        'Content-Type': 'application/json'
      };
      
      const finalHeaders = { ...defaultHeaders, ...headers };

      // Make request
      const response = await fetch(endpoint, {
        method,
        headers: finalHeaders,
        body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await this.errorHandler.handleApiError(response, 'API request');
        throw error;
      }

      const responseData = await response.json();
      this.logger.debug('API request successful', {
        endpoint,
        status: response.status
      });

      return responseData;
    } catch (error) {
      // Handle timeout
      if (error.name === 'AbortError') {
        const timeoutError = this.errorHandler.createError(
          'TIMEOUT_ERROR',
          `API request timed out after ${timeout}ms`
        );
        this.logger.warn('API request timed out', { endpoint, timeout });
        throw timeoutError;
      }

      // Handle network errors with retry
      if (error.name === 'TypeError' && retries < this.maxRetries) {
        this.logger.warn(`API request failed, retrying (${retries + 1}/${this.maxRetries})`, {
          endpoint,
          error: error.message
        });

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * (retries + 1)));

        // Retry request
        return this.makeRequest(endpoint, {
          ...options,
          retries: retries + 1
        });
      }

      // Handle other errors
      if (error.name === 'ApiError') {
        throw error;
      }

      const networkError = this.errorHandler.handleNetworkError(error, 'API request');
      this.logger.error('API request failed', { endpoint }, error);
      throw networkError;
    }
  }

  /**
   * Makes a streaming API request
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Request options
   * @param {Function} onChunk - Callback for each chunk
   * @param {Function} onComplete - Callback when complete
   * @param {Function} onError - Callback on error
   * @returns {Promise<void>}
   */
  async makeStreamingRequest(endpoint, options = {}, onChunk, onComplete, onError) {
    const {
      method = 'POST',
      headers = {},
      body = null,
      timeout = this.defaultTimeout
    } = options;

    this.logger.debug('Making streaming API request', {
      endpoint,
      method,
      timeout
    });

    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Set default headers
      const defaultHeaders = {
        'Content-Type': 'application/json'
      };
      
      const finalHeaders = { ...defaultHeaders, ...headers };

      // Make request
      const response = await fetch(endpoint, {
        method,
        headers: finalHeaders,
        body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await this.errorHandler.handleApiError(response, 'Streaming API request');
        if (onError) onError(error);
        throw error;
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          this.logger.debug('Streaming API request completed', { endpoint });
          if (onComplete) onComplete();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        let lines = buffer.split('\n');
        buffer = lines.pop(); // Keep the last partial line in the buffer

        for (const line of lines) {
          if (line.startsWith('data:')) {
            let data = line.substring(5).trim();
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              if (onChunk) onChunk(parsed);
            } catch (parseError) {
              this.logger.warn('Failed to parse streaming chunk', {
                endpoint,
                data: data.substring(0, 100)
              }, parseError);
            }
          }
        }
      }
    } catch (error) {
      // Handle timeout
      if (error.name === 'AbortError') {
        const timeoutError = this.errorHandler.createError(
          'TIMEOUT_ERROR',
          `Streaming API request timed out after ${timeout}ms`
        );
        this.logger.warn('Streaming API request timed out', { endpoint, timeout });
        if (onError) onError(timeoutError);
        throw timeoutError;
      }

      // Handle other errors
      this.logger.error('Streaming API request failed', { endpoint }, error);
      if (onError) onError(error);
      throw error;
    }
  }

  /**
   * Processes tool choice configuration
   * @param {Object} tools - Available tools
   * @param {string|Array} toolChoice - Tool choice option
   * @returns {Object} Tool choice configuration
   */
  processToolChoice(tools, toolChoice = 'none') {
    // Format tools for API
    const formattedTools = tools.map(tool => {
      try {
        return {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: JSON.parse(tool.parameters || '{}')
          }
        };
      } catch (e) {
        this.logger.error(`Error parsing parameters for tool ${tool.name}`, {}, e);
        return null;
      }
    }).filter(tool => tool !== null);

    let toolChoicePayload = {};

    if (toolChoice === 'none' || formattedTools.length === 0) {
      toolChoicePayload = {};
    } else if (toolChoice === 'auto') {
      toolChoicePayload = { tools: formattedTools, tool_choice: "auto" };
    } else if (typeof toolChoice === 'string') {
      // Specific tool name
      const specificTool = formattedTools.find(t => t.function.name === toolChoice);
      if (specificTool) {
        toolChoicePayload = { 
          tools: [specificTool], 
          tool_choice: { type: "function", function: { name: toolChoice } } 
        };
      } else {
        this.logger.warn(`Specified tool "${toolChoice}" not found. No tools will be sent.`);
        toolChoicePayload = {};
      }
    } else if (Array.isArray(toolChoice) && toolChoice.length > 0) {
      // Array of tool names
      const selectedTools = formattedTools.filter(tool =>
        toolChoice.includes(tool.function.name)
      );
      if (selectedTools.length > 0) {
        const tcObject = selectedTools.length === 1
          ? { type: 'function', function: { name: selectedTools[0].function.name } }
          : "auto";

        toolChoicePayload = { tools: selectedTools, tool_choice: tcObject };
      } else {
        this.logger.warn(`Specified tools in array "${toolChoice}" not found. No tools will be sent.`);
        toolChoicePayload = {};
      }
    } else {
      this.logger.warn(`Invalid tool choice format: ${toolChoice}. Defaulting to no tools.`);
      toolChoicePayload = {};
    }

    return toolChoicePayload;
  }

  /**
   * Creates a request payload for the API
   * @param {string} prompt - User prompt
   * @param {Array} messages - Conversation messages
   * @param {Object} options - Request options
   * @returns {Promise<Object>} Request payload
   */
  async createRequestPayload(prompt, messages = [], options = {}) {
    const {
      maxTokens = 2048,
      temperature = 0.7,
      toolChoice = 'none',
      tools = [],
      systemPrompt = ''
    } = options;

    const config = await this.validateConfig();
    const toolChoicePayload = this.processToolChoice(tools, toolChoice);

    // Add date/time to system prompt
    const now = new Date();
    const dateTimeString = `Date: ${now.toLocaleDateString()} Time: ${now.toLocaleTimeString()}`;
    let systemPromptContent = dateTimeString;
    
    if (systemPrompt && systemPrompt.trim() !== '') {
      systemPromptContent += `\n\n${systemPrompt}`;
    }

    // Create message array
    const requestMessages = [
      { role: 'system', content: systemPromptContent }
    ];

    // Add existing messages
    if (messages.length > 0) {
      requestMessages.push(...messages);
    }

    // Add current prompt if provided
    if (prompt) {
      requestMessages.push({ role: 'user', content: prompt });
    }

    return {
      model: config.modelName,
      messages: requestMessages,
      max_tokens: parseInt(maxTokens) || 2048,
      temperature,
      ...toolChoicePayload
    };
  }
}

export default ApiService;