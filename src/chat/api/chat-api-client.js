/**
 * Chat API Client
 * Handles API communication for chat functionality
 * Implements production-ready coding rules for API communication
 *
 * Core Principles:
 * - Input Validation: Validate all API parameters
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient API communication with proper timeouts
 */

import { logger } from '../../shared/index.js';

class ChatApiClient {
  constructor(dependencies) {
    this.logger = dependencies.Logger;
    this.storage = dependencies.Storage;
    this.defaultTimeout = 30000; // 30 seconds
  }

  /**
   * Gets API configuration from storage
   * @returns {Promise<Object>} API configuration
   */
  async getApiConfig() {
    this.logger.debug('Getting API configuration');

    try {
      const result = await this.storage.get(['profiles', 'lastSelectedProfileId']);
      const profiles = result.profiles || [];
      const lastSelectedProfileId = result.lastSelectedProfileId || 'default';

      // Find selected profile
      let selectedProfile = profiles.find(p => p.id === lastSelectedProfileId);
      
      // Fallback to default if selected not found
      if (!selectedProfile) {
        selectedProfile = profiles.find(p => p.id === 'default');
      }

      if (!selectedProfile) {
        throw new Error('No valid profile found');
      }

      this.logger.debug(`Using API configuration from profile: ${selectedProfile.name || selectedProfile.id}`);

      return {
        llmEndpoint: selectedProfile.llmEndpoint,
        apiKey: selectedProfile.apiKey,
        modelName: selectedProfile.modelName,
        maxTokens: selectedProfile.maxTokens || 2048,
        systemPrompt: selectedProfile.systemPrompt || ''
      };
    } catch (error) {
      this.logger.error('Failed to get API configuration', {}, error);
      throw error;
    }
  }

  /**
   * Validates API configuration
   * @param {Object} config - API configuration
   * @returns {boolean} True if valid
   */
  validateApiConfig(config) {
    if (!config || typeof config !== 'object') {
      return false;
    }

    if (!config.llmEndpoint || typeof config.llmEndpoint !== 'string') {
      return false;
    }

    if (!config.apiKey || typeof config.apiKey !== 'string') {
      return false;
    }

    if (!config.modelName || typeof config.modelName !== 'string') {
      return false;
    }

    return true;
  }

  /**
   * Creates an API request payload
   * @param {string} prompt - User prompt
   * @param {Array} messages - Conversation messages
   * @param {Object} options - Request options
   * @returns {Promise<Object>} Request payload
   */
  async createRequestPayload(prompt, messages = [], options = {}) {
    this.logger.debug('Creating API request payload');

    try {
      const config = await this.getApiConfig();

      if (!this.validateApiConfig(config)) {
        throw new Error('Invalid API configuration');
      }

      const {
        maxTokens = config.maxTokens,
        temperature = 0.7,
        toolChoice = 'none',
        tools = [],
        systemPrompt = config.systemPrompt
      } = options;

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

      // Process tool choice
      const toolChoicePayload = this.processToolChoice(tools, toolChoice);

      return {
        model: config.modelName,
        messages: requestMessages,
        max_tokens: parseInt(maxTokens) || 2048,
        temperature,
        ...toolChoicePayload
      };
    } catch (error) {
      this.logger.error('Failed to create request payload', {}, error);
      throw error;
    }
  }

  /**
   * Processes tool choice configuration
   * @param {Array} tools - Available tools
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
   * Makes an API request
   * @param {Object} payload - Request payload
   * @param {Object} options - Request options
   * @returns {Promise<Object>} API response
   */
  async makeRequest(payload, options = {}) {
    this.logger.debug('Making API request');

    try {
      const config = await this.getApiConfig();
      const {
        timeout = this.defaultTimeout,
        endpoint = config.llmEndpoint
      } = options;

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Make request
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch (_) { /* Ignore if body cannot be read */ }
        
        const errorMsg = `HTTP error ${response.status}: ${response.statusText}. ${errorBody}`.trim();
        throw new Error(errorMsg);
      }

      const responseData = await response.json();

      if (!responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
        throw new Error('Invalid response format from API');
      }

      this.logger.debug('API request successful');

      return responseData;
    } catch (error) {
      // Handle timeout
      if (error.name === 'AbortError') {
        throw new Error(`API request timed out after ${options.timeout || this.defaultTimeout}ms`);
      }

      this.logger.error('API request failed', {}, error);
      throw error;
    }
  }

  /**
   * Makes a streaming API request
   * @param {Object} payload - Request payload
   * @param {Object} options - Request options
   * @param {Function} onChunk - Callback for each chunk
   * @param {Function} onComplete - Callback when complete
   * @param {Function} onError - Callback on error
   * @returns {Promise<void>}
   */
  async makeStreamingRequest(payload, options = {}, onChunk, onComplete, onError) {
    this.logger.debug('Making streaming API request');

    try {
      const config = await this.getApiConfig();
      const {
        timeout = this.defaultTimeout,
        endpoint = config.llmEndpoint
      } = options;

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Add streaming to payload
      const streamingPayload = { ...payload, stream: true };

      // Make request
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(streamingPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch (_) { /* Ignore if body cannot be read */ }
        
        const errorMsg = `HTTP error ${response.status}: ${response.statusText}. ${errorBody}`.trim();
        throw new Error(errorMsg);
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          this.logger.debug('Streaming API request completed');
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
                data: data.substring(0, 100)
              }, parseError);
            }
          }
        }
      }
    } catch (error) {
      // Handle timeout
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Streaming API request timed out after ${options.timeout || this.defaultTimeout}ms`);
        if (onError) onError(timeoutError);
        throw timeoutError;
      }

      this.logger.error('Streaming API request failed', {}, error);
      if (onError) onError(error);
      throw error;
    }
  }

  /**
   * Gets available tools from storage
   * @returns {Promise<Array>} Array of tool definitions
   */
  async getTools() {
    this.logger.debug('Getting available tools');

    try {
      const result = await this.storage.get(['promptPaulTools']);
      return result.promptPaulTools || [];
    } catch (error) {
      this.logger.error('Failed to get tools', {}, error);
      throw error;
    }
  }

  /**
   * Executes a tool call
   * @param {Object} toolCall - Tool call object
   * @returns {Promise<Object>} Tool execution result
   */
  async executeTool(toolCall) {
    this.logger.debug(`Executing tool: ${toolCall.name}`);

    try {
      // Send tool execution request to background
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'executePromptPaulTool',
          toolCall
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      return response;
    } catch (error) {
      this.logger.error(`Tool execution failed: ${toolCall.name}`, {}, error);
      throw error;
    }
  }
}

export default ChatApiClient;