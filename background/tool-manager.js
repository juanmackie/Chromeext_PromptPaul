import {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
  wrapAsync,
} from '../errorHandler.js';
import analytics from '../analytics.js';

import logger from '../utils/logger.js'; /**
 * Tool Manager
 * Handles tool execution and management
 */

export class ToolManager {
  constructor() {
    this.activeToolExecutions = new Set();
    this.requestTimeout = 30000; // 30 seconds

    // Registry for *built-in* tool implementations (developer adds specific functions here)
    // User-defined endpoints will be handled separately.
    this.toolImplementations = {
      // Add the generic caller function to the registry for potential direct use if needed,
      // but the main logic will check endpointUrl first.
      _callUserDefinedEndpoint: this.callUserDefinedEndpoint.bind(this),
    };
  }

  // Get all tool definitions from storage
  async getAllToolDefinitions() {
    return await wrapAsync(
      async () => {
        const localTools = await new Promise((resolve, reject) => {
          chrome.storage.local.get(['promptPaulTools'], result => {
            if (chrome.runtime.lastError) {
              reject(
                createError('Failed to access tool definitions from storage', {
                  category: ErrorCategory.STORAGE,
                  severity: ErrorSeverity.MEDIUM,
                  context: { error: chrome.runtime.lastError.message },
                })
              );
              return;
            }
            resolve(result.promptPaulTools || []);
          });
        });
        return localTools;
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to load tool definitions',
        severity: ErrorSeverity.MEDIUM,
      }
    ).catch(error => {
      logger.warn(
        'BackgroundToolManager',
        'Failed to load tool definitions, using empty array:',
        error
      );
      return [];
    });
  }

  // Get a single tool definition by name from storage
  async getToolDefinition(name) {
    return await wrapAsync(
      async () => {
        return await new Promise((resolve, reject) => {
          chrome.storage.local.get(['promptPaulTools'], result => {
            if (chrome.runtime.lastError) {
              reject(
                createError('Failed to access tool definition from storage', {
                  category: ErrorCategory.STORAGE,
                  severity: ErrorSeverity.MEDIUM,
                  context: { toolName: name, error: chrome.runtime.lastError.message },
                })
              );
              return;
            }
            const toolsArray = result.promptPaulTools || [];
            const tool = toolsArray.find(t => t.name === name);
            resolve(tool);
          });
        });
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to load tool definition',
        severity: ErrorSeverity.MEDIUM,
      }
    ).catch(error => {
      logger.warn('BackgroundToolManager', `Failed to load tool definition for '${name}':`, error);
      return null;
    });
  }

  // Generic function to call a user-defined endpoint
  async callUserDefinedEndpoint(endpointUrl, args, userDefinedMethod, originalToolName = null) {
    return await wrapAsync(
      async () => {
        logger.info(
          'BackgroundToolManager',
          `Background: Calling user-defined endpoint: ${endpointUrl} with args:`,
          args
        );

        if (!endpointUrl) {
          throw createError('No endpoint URL provided', {
            category: ErrorCategory.USER_INPUT,
            severity: ErrorSeverity.HIGH,
            context: { originalToolName, userDefinedMethod },
          });
        }

        if (!this.isValidURL(endpointUrl)) {
          throw createError(`Invalid endpoint URL: ${endpointUrl}`, {
            category: ErrorCategory.VALIDATION,
            severity: ErrorSeverity.HIGH,
            context: { endpointUrl, originalToolName },
          });
        }

        let finalEndpointUrl = endpointUrl;
        const finalFetchOptions = {
          headers: {
            Accept: 'application/json',
          },
        };
        const finalArgs = args || {};

        // Determine HTTP method
        const isEmptyArgs = !Object.keys(finalArgs).length === 0;
        let method = userDefinedMethod || (isEmptyArgs ? 'GET' : 'POST');
        method = method.toUpperCase();
        finalFetchOptions.method = method;

        logger.info(
          'BackgroundToolManager',
          `Background: Using method ${method} (User defined: ${userDefinedMethod || 'Auto'}) for endpoint ${finalEndpointUrl}`
        );

        // Prepare request based on method
        if (method === 'GET' && !isEmptyArgs) {
          const queryParams = new URLSearchParams(finalArgs).toString();
          finalEndpointUrl = `${finalEndpointUrl}?${queryParams}`;
          logger.info(
            'BackgroundToolManager',
            `Background: Appended query params for GET request: ${queryParams}`
          );
        } else if (['POST', 'PUT', 'PATCH'].includes(method) && !isEmptyArgs) {
          finalFetchOptions.headers['Content-Type'] = 'application/json';
          finalFetchOptions.body = JSON.stringify(finalArgs);
        }

        logger.info('BackgroundToolManager', 'Background: Webhook Fetch Details:', {
          endpointUrl: finalEndpointUrl,
          fetchOptions: finalFetchOptions,
        });

        // Add timeout to fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);
        finalFetchOptions.signal = controller.signal;

        const response = await fetch(finalEndpointUrl, finalFetchOptions);
        clearTimeout(timeoutId);

        logger.info(
          'BackgroundToolManager',
          `Background: Fetch response received. Status: ${response.status}, StatusText: ${response.statusText}`
        );

        if (!response.ok) {
          let errorBody = '';
          try {
            errorBody = await response.text();
          } catch (_) {
            /* Ignore if body cannot be read */
          }

          const errorMsg =
            `HTTP error ${response.status}: ${response.statusText}. ${errorBody}`.trim();
          logger.error(
            'BackgroundToolManager',
            `Background: HTTP error for ${finalEndpointUrl}:`,
            errorMsg
          );

          throw createError(`HTTP request failed: ${errorMsg}`, {
            category: ErrorCategory.NETWORK,
            severity: ErrorSeverity.HIGH,
            retryable: [500, 502, 503, 504].includes(response.status),
            context: {
              endpointUrl: finalEndpointUrl,
              status: response.status,
              statusText: response.statusText,
              errorBody: errorBody.substring(0, 500), // Limit error body size
            },
          });
        }

        // Parse response
        const contentType = response.headers.get('content-type');
        logger.info('BackgroundToolManager', `Background: Response content-type: ${contentType}`);

        let result;
        try {
          if (contentType && contentType.includes('application/json')) {
            result = await response.json();
          } else {
            result = await response.text();
          }
        } catch (parseError) {
          throw createError('Failed to parse response from endpoint', {
            category: ErrorCategory.NETWORK,
            severity: ErrorSeverity.MEDIUM,
            context: { endpointUrl: finalEndpointUrl, contentType },
            originalError: parseError,
          });
        }

        logger.info('BackgroundToolManager', `Background: Parsed response result:`, result);
        return result;
      },
      {
        category: ErrorCategory.TOOL_EXECUTION,
        userMessage: `Failed to execute tool${originalToolName ? `: ${originalToolName}` : ''}`,
        retryable: true,
        context: { endpointUrl, originalToolName, userDefinedMethod },
      }
    );
  }

  // Execute a tool based on its definition
  async executeTool(toolCall, config) {
    const { id, name, arguments: args } = toolCall;

    // Check for duplicate executions
    if (this.activeToolExecutions.has(id)) {
      logger.info('BackgroundToolManager', `Tool execution ${id} already in progress, skipping`);
      return;
    }

    this.activeToolExecutions.add(id);

    try {
      // Track tool usage
      try {
        await analytics.trackInstructionUsed({
          instruction: 'tool_invoke',
          model: config?.modelName,
          tools: [name],
        });
      } catch (_) {}

      // Get tool definition
      const toolDefinition = await this.getToolDefinition(name);
      if (!toolDefinition) {
        throw new Error(`Tool '${name}' not found in definitions`);
      }

      // Parse arguments
      let argsObject;
      const argsString = JSON.stringify(args);
      try {
        argsObject = typeof args === 'string' ? JSON.parse(args) : args;
        if (argsObject === null) {
          argsObject = {};
        }
      } catch (parseError) {
        throw new Error(
          `Invalid arguments format for tool '${name}'. Expected JSON. Received: ${argsString}`
        );
      }

      if (toolDefinition.endpointUrl) {
        // User-defined HTTP tool logic
        logger.info(
          'BackgroundToolManager',
          `Executing '${name}' as a user-defined HTTP tool via ${toolDefinition.endpointUrl}`
        );
        const result = await this.callUserDefinedEndpoint(
          toolDefinition.endpointUrl,
          argsObject,
          toolDefinition.httpMethod
        );
        logger.info(
          'BackgroundToolManager',
          `Background: User-defined tool '${name}' executed successfully via endpoint. Result:`,
          result
        );
        return { success: true, result, toolName: name, toolId: id };
      } else if (this.toolImplementations[name]) {
        // Built-in tool logic
        logger.info('BackgroundToolManager', `Executing '${name}' as a built-in tool`);
        const result = await this.toolImplementations[name](argsObject);
        logger.info(
          'BackgroundToolManager',
          `Background: Built-in tool '${name}' executed successfully. Result:`,
          result
        );
        return { success: true, result, toolName: name, toolId: id };
      } else {
        throw new Error(
          `No implementation found for tool '${name}'. Ensure it has an endpointUrl or is a built-in tool.`
        );
      }
    } finally {
      this.activeToolExecutions.delete(id);
    }
  }

  // Validate URL format
  isValidURL(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  // Get comprehensive tool execution report
  getReport() {
    return {
      activeExecutions: this.activeToolExecutions.size,
      availableBuiltInTools: Object.keys(this.toolImplementations).filter(
        name => name !== '_callUserDefinedEndpoint'
      ),
      requestTimeout: this.requestTimeout,
    };
  }
}

// Export singleton instance
export const toolManager = new ToolManager();
