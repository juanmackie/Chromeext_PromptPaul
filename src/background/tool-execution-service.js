/**
 * Tool Execution Service
 * Handles all tool execution functionality
 * Implements production-ready coding rules for tool execution
 *
 * Core Principles:
 * - Input Validation: Validate all tool inputs
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient tool execution with proper timeouts
 */

import { errorHandler, logger } from '../shared/index.js';

class ToolExecutionService {
  constructor(dependencies) {
    this.storage = dependencies.Storage;
    this.logger = dependencies.Logger;
    this.errorHandler = dependencies.ErrorHandler;
    
    // Tool execution configuration
    this.activeExecutions = new Set();
    this.defaultTimeout = 30000; // 30 seconds
  }

  /**
   * Gets all tool definitions from storage
   * @returns {Promise<Array>} Array of tool definitions
   */
  async getAllToolDefinitions() {
    try {
      const result = await this.storage.get(['promptPaulTools']);
      return result.promptPaulTools || [];
    } catch (error) {
      this.logger.error('Failed to get tool definitions', {}, error);
      throw this.errorHandler.createError(
        'STORAGE_ERROR',
        'Failed to retrieve tool definitions from storage',
        error
      );
    }
  }

  /**
   * Gets a single tool definition by name
   * @param {string} name - Tool name
   * @returns {Promise<Object|null>} Tool definition or null if not found
   */
  async getToolDefinition(name) {
    try {
      const tools = await this.getAllToolDefinitions();
      return tools.find(t => t.name === name) || null;
    } catch (error) {
      this.logger.error(`Failed to get tool definition for ${name}`, {}, error);
      throw this.errorHandler.createError(
        'STORAGE_ERROR',
        `Failed to retrieve tool definition for ${name}`,
        error
      );
    }
  }

  /**
   * Validates tool call parameters
   * @param {Object} toolCall - Tool call object
   * @returns {Object} Validation result
   */
  validateToolCall(toolCall) {
    const errors = {};

    if (!toolCall.id || typeof toolCall.id !== 'string') {
      errors.id = 'Tool call ID is required and must be a string';
    }

    if (!toolCall.name || typeof toolCall.name !== 'string') {
      errors.name = 'Tool name is required and must be a string';
    }

    if (!toolCall.arguments || typeof toolCall.arguments !== 'string') {
      errors.arguments = 'Tool arguments are required and must be a string';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  /**
   * Calls a user-defined endpoint
   * @param {string} endpointUrl - Endpoint URL
   * @param {Object} args - Arguments object
   * @param {string} httpMethod - HTTP method
   * @param {number} timeout - Request timeout
   * @returns {Promise<any>} Response data
   * @throws {Error} If request fails
   */
  async callUserDefinedEndpoint(endpointUrl, args, httpMethod = 'POST', timeout = this.defaultTimeout) {
    this.logger.debug('Calling user-defined endpoint', {
      endpointUrl,
      httpMethod,
      argsCount: Object.keys(args).length
    });

    try {
      // Validate URL
      if (!endpointUrl || typeof endpointUrl !== 'string') {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          'Endpoint URL is required and must be a string'
        );
      }

      // Validate HTTP method
      const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      const method = httpMethod.toUpperCase();
      if (!validMethods.includes(method)) {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          `HTTP method must be one of: ${validMethods.join(', ')}`
        );
      }

      // Prepare request
      let finalEndpointUrl = endpointUrl;
      let finalFetchOptions = {
        method,
        headers: {
          'Accept': 'application/json'
        }
      };

      // Handle request body and query parameters
      const isEmptyArgs = !args || Object.keys(args).length === 0;
      
      if (method === 'GET' && !isEmptyArgs) {
        // Add query parameters for GET requests
        const queryParams = new URLSearchParams(args).toString();
        finalEndpointUrl = `${endpointUrl}?${queryParams}`;
      } else if (['POST', 'PUT', 'PATCH'].includes(method) && !isEmptyArgs) {
        // Add request body for POST/PUT/PATCH requests
        finalFetchOptions.headers['Content-Type'] = 'application/json';
        finalFetchOptions.body = JSON.stringify(args);
      }

      // Set up timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Make request
      this.logger.debug('Making tool endpoint request', {
        method,
        url: finalEndpointUrl,
        hasBody: !!finalFetchOptions.body
      });

      const response = await fetch(finalEndpointUrl, {
        ...finalFetchOptions,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch (_) { /* Ignore if body cannot be read */ }
        
        const errorMsg = `HTTP error ${response.status}: ${response.statusText}. ${errorBody}`.trim();
        throw this.errorHandler.createError(
          'API_ERROR',
          errorMsg,
          null,
          { status: response.status, url: finalEndpointUrl }
        );
      }

      // Parse response
      const contentType = response.headers.get('content-type');
      let result;

      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        result = await response.text();
      }

      this.logger.debug('Tool endpoint request successful', {
        method,
        url: finalEndpointUrl,
        status: response.status,
        responseType: contentType
      });

      return result;
    } catch (error) {
      // Handle timeout
      if (error.name === 'AbortError') {
        throw this.errorHandler.createError(
          'TIMEOUT_ERROR',
          `Tool execution timed out after ${timeout}ms`
        );
      }

      // Handle network errors
      if (error.name === 'TypeError') {
        throw this.errorHandler.handleNetworkError(error, 'Tool execution');
      }

      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Executes a tool call
   * @param {Object} toolCall - Tool call object
   * @returns {Promise<Object>} Execution result
   */
  async executeTool(toolCall) {
    const { id, name, arguments: argsString } = toolCall;
    const executionKey = `${id}-${name}`;

    this.logger.debug(`Executing tool: ${name}`, { id });

    try {
      // Prevent duplicate executions
      if (this.activeExecutions.has(executionKey)) {
        this.logger.warn(`Tool execution already in progress: ${executionKey}`);
        throw this.errorHandler.createError(
          'DUPLICATE_EXECUTION',
          `Tool execution already in progress: ${name}`
        );
      }

      // Add to active executions
      this.activeExecutions.add(executionKey);

      // Validate tool call
      const validation = this.validateToolCall(toolCall);
      if (!validation.isValid) {
        throw this.errorHandler.createError(
          'VALIDATION_ERROR',
          `Invalid tool call: ${Object.values(validation.errors).join(', ')}`
        );
      }

      // Get tool definition
      const toolDefinition = await this.getToolDefinition(name);
      if (!toolDefinition) {
        throw this.errorHandler.createError(
          'TOOL_NOT_FOUND',
          `Tool definition for '${name}' not found in storage`
        );
      }

      // Parse arguments
      let argsObject;
      try {
        argsObject = JSON.parse(argsString || '{}');
      } catch (parseError) {
        throw this.errorHandler.createError(
          'INVALID_ARGUMENTS',
          `Invalid arguments format for tool '${name}'. Expected JSON. Received: ${argsString}`,
          parseError
        );
      }

      // Execute tool based on type
      let result;
      if (toolDefinition.endpointUrl) {
        // User-defined HTTP tool
        this.logger.debug(`Executing HTTP tool: ${name}`, {
          endpoint: toolDefinition.endpointUrl,
          method: toolDefinition.httpMethod
        });

        result = await this.callUserDefinedEndpoint(
          toolDefinition.endpointUrl,
          argsObject,
          toolDefinition.httpMethod || 'POST'
        );
      } else {
        // Built-in tool (if any)
        throw this.errorHandler.createError(
          'UNSUPPORTED_TOOL',
          `Tool '${name}' is not properly configured: It has no endpointUrl and no built-in implementation`
        );
      }

      this.logger.info(`Tool executed successfully: ${name}`, {
        id,
        resultType: typeof result
      });

      return {
        success: true,
        result
      };
    } catch (error) {
      this.logger.error(`Tool execution failed: ${name}`, { id }, error);
      return {
        success: false,
        error: error.message || 'Unknown error'
      };
    } finally {
      // Remove from active executions
      this.activeExecutions.delete(executionKey);
    }
  }

  /**
   * Gets active tool executions
   * @returns {Array} Array of active execution keys
   */
  getActiveExecutions() {
    return Array.from(this.activeExecutions);
  }

  /**
   * Clears active executions (for testing or error recovery)
   */
  clearActiveExecutions() {
    this.activeExecutions.clear();
    this.logger.debug('Active tool executions cleared');
  }
}

export default ToolExecutionService;