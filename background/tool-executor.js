import { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync, handleChromeApiCall } from '../errorHandler.js';
import analytics from '../analytics.js';

/**
 * Tool Executor
 * Handles execution of different types of tools:
 * - HTTP endpoint tools
 * - Built-in tools (if any)
 * Legacy MCP tools (to be removed)
 */
export class ToolExecutor {
    constructor() {
        this.activeToolExecutions = new Set();
        this.requestTimeout = 30000; // 30 seconds
    }

    /**
     * Execute a tool based on its definition
     * @param {Object} toolCall - Tool call object with id, name, and arguments
     * @param {Function} sendResponse - Chrome runtime response function
     * @returns {Promise<void>}
     */
    async executeTool(toolCall, sendResponse) {
        const { id, name, arguments: argsString } = toolCall;
        console.log(`Background: Received request to execute tool '${name}' with id '${id}'`);

        // Prevent duplicate executions
        const executionKey = `${id}-${name}`;
        if (this.activeToolExecutions.has(executionKey)) {
            console.log(`Background: Tool execution '${executionKey}' already in progress, ignoring duplicate request`);
            return;
        }

        this.activeToolExecutions.add(executionKey);
        console.log(`Background: Added '${executionKey}' to active executions. Active count: ${this.activeToolExecutions.size}`);

        try {
            const allTools = await this.getAllToolDefinitions();
            const toolDefinition = allTools.find(t => t.name === name);

            if (!toolDefinition) {
                throw new Error(`Tool definition for '${name}' not found in storage.`);
            }

            let argsObject;
            try {
                argsObject = JSON.parse(argsString || '{}');
            } catch (parseError) {
                throw new Error(`Invalid arguments format for tool '${name}'. Expected JSON. Received: ${argsString}`);
            }

            let result;

            // Execute tool based on its type
            if (toolDefinition.endpointUrl) {
                result = await this.executeHttpTool(toolDefinition, argsObject);
            } else if (this.getBuiltInTool(name)) {
                result = await this.executeBuiltInTool(name, argsObject);
            } else {
                throw new Error(`Tool '${name}' is not properly configured: It has no endpointUrl and no built-in implementation.`);
            }

            // Track successful tool execution
            try {
                await analytics.trackInstructionUsed({
                    instruction: 'tool_invoke',
                    model: (await this.validateConfig().catch(()=>({})))?.modelName,
                    tools: [name]
                });
            } catch (_) {}

            sendResponse({ result: result });

        } catch (error) {
            console.error(`Background: Error processing tool '${name}' in executePromptPaulTool:`, error);

            // Track tool execution error
            try {
                await analytics.trackErrorEvent('tool_error', name);
            } catch (_) {}

            let errorMessage = error.message || 'Tool processing failed';
            if (error.details) {
                errorMessage += ` (Details: ${JSON.stringify(error.details)})`;
            }

            sendResponse({ error: errorMessage });
        } finally {
            // Always remove from active executions when done
            this.activeToolExecutions.delete(executionKey);
            console.log(`Background: Removed '${executionKey}' from active executions. Active count: ${this.activeToolExecutions.size}`);
        }
    }

    /**
     * Execute an HTTP endpoint tool
     * @param {Object} toolDefinition - Tool definition with endpoint URL
     * @param {Object} args - Tool arguments
     * @returns {Promise<any>} Tool execution result
     */
    async executeHttpTool(toolDefinition, args) {
        console.log(`Executing '${toolDefinition.name}' as a user-defined HTTP tool via ${toolDefinition.endpointUrl}`);

        const result = await this.callUserDefinedEndpoint(
            toolDefinition.endpointUrl,
            args,
            toolDefinition.httpMethod,
            toolDefinition.name
        );

        console.log(`Background: User-defined tool '${toolDefinition.name}' executed successfully via endpoint. Result:`, result);
        return result;
    }

    /**
     * Execute a built-in tool
     * @param {string} toolName - Name of the built-in tool
     * @param {Object} args - Tool arguments
     * @returns {Promise<any>} Tool execution result
     */
    async executeBuiltInTool(toolName, args) {
        const builtInFunction = this.getBuiltInTool(toolName);
        if (!builtInFunction) {
            throw new Error(`Built-in tool '${toolName}' not found`);
        }

        console.log(`Executing '${toolName}' as a built-in tool.`);
        const result = await builtInFunction(args);
        console.log(`Background: Built-in tool '${toolName}' executed successfully. Result:`, result);
        return result;
    }

    /**
     * Generic function to call a user-defined HTTP endpoint
     * @param {string} endpointUrl - Endpoint URL
     * @param {Object} args - Request arguments
     * @param {string} userDefinedMethod - HTTP method
     * @param {string} originalToolName - Original tool name for error reporting
     * @returns {Promise<any>} Response data
     */
    async callUserDefinedEndpoint(endpointUrl, args, userDefinedMethod, originalToolName = null) {
        return await wrapAsync(async () => {
            console.log(`Background: Calling user-defined endpoint: ${endpointUrl} with args:`, args);

            if (!endpointUrl) {
                throw createError('No endpoint URL provided', {
                    category: ErrorCategory.USER_INPUT,
                    severity: ErrorSeverity.HIGH,
                    context: { originalToolName, userDefinedMethod }
                });
            }

            if (!this.isValidURL(endpointUrl)) {
                throw createError(`Invalid endpoint URL: ${endpointUrl}`, {
                    category: ErrorCategory.VALIDATION,
                    severity: ErrorSeverity.HIGH,
                    context: { endpointUrl, originalToolName }
                });
            }

            let finalEndpointUrl = endpointUrl;
            let finalFetchOptions = {
                headers: {
                    'Accept': 'application/json'
                }
            };
            let finalArgs = args || {};

            // Determine HTTP method
            const isEmptyArgs = !Object.keys(finalArgs).length === 0;
            let method = userDefinedMethod || (isEmptyArgs ? 'GET' : 'POST');
            method = method.toUpperCase();
            finalFetchOptions.method = method;

            console.log(`Background: Using method ${method} (User defined: ${userDefinedMethod || 'Auto'}) for endpoint ${finalEndpointUrl}`);

            // Prepare request based on method
            if (method === 'GET' && !isEmptyArgs) {
                const queryParams = new URLSearchParams(finalArgs).toString();
                finalEndpointUrl = `${finalEndpointUrl}?${queryParams}`;
                console.log(`Background: Appended query params for GET request: ${queryParams}`);
            } else if (['POST', 'PUT', 'PATCH'].includes(method) && !isEmptyArgs) {
                finalFetchOptions.headers['Content-Type'] = 'application/json';
                finalFetchOptions.body = JSON.stringify(finalArgs);
            }

            console.log("Background: Webhook Fetch Details:", { endpointUrl: finalEndpointUrl, fetchOptions: finalFetchOptions });

            // Add timeout to fetch
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);
            finalFetchOptions.signal = controller.signal;

            const response = await fetch(finalEndpointUrl, finalFetchOptions);
            clearTimeout(timeoutId);

            console.log(`Background: Fetch response received. Status: ${response.status}, StatusText: ${response.statusText}`);

            if (!response.ok) {
                let errorBody = '';
                try {
                    errorBody = await response.text();
                } catch (_) { /* Ignore if body cannot be read */ }

                const errorMsg = `HTTP error ${response.status}: ${response.statusText}. ${errorBody}`.trim();
                console.error(`Background: HTTP error for ${finalEndpointUrl}:`, errorMsg);

                throw createError(`HTTP request failed: ${errorMsg}`, {
                    category: ErrorCategory.NETWORK,
                    severity: ErrorSeverity.HIGH,
                    retryable: [500, 502, 503, 504].includes(response.status),
                    context: {
                        endpointUrl: finalEndpointUrl,
                        status: response.status,
                        statusText: response.statusText,
                        errorBody: errorBody.substring(0, 500) // Limit error body size
                    }
                });
            }

            // Parse response
            const contentType = response.headers.get('content-type');
            console.log(`Background: Response content-type: ${contentType}`);

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
                    originalError: parseError
                });
            }

            console.log(`Background: Parsed response result:`, result);
            return result;

        }, {
            category: ErrorCategory.TOOL_EXECUTION,
            userMessage: `Failed to execute tool${originalToolName ? `: ${originalToolName}` : ''}`,
            retryable: true,
            context: { endpointUrl, originalToolName, userDefinedMethod }
        });
    }

    /**
     * Validate if URL is properly formatted
     * @param {string} url - URL to validate
     * @returns {boolean} True if valid URL
     */
    isValidURL(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get built-in tool implementation
     * @param {string} toolName - Name of the built-in tool
     * @returns {Function|null} Tool function or null if not found
     */
    getBuiltInTool(toolName) {
        const builtInTools = {
            // Add built-in tools here if needed
            /*
            'getCurrentTime': async (args) => {
                console.log("Executing built-in tool getCurrentTime");
                return { currentTime: new Date().toISOString() };
            }
            */
        };

        return builtInTools[toolName] || null;
    }

    /**
     * Set request timeout
     * @param {number} timeoutMs - Timeout in milliseconds
     */
    setRequestTimeout(timeoutMs) {
        this.requestTimeout = timeoutMs;
    }

    /**
     * Get current request timeout
     * @returns {number} Current timeout in milliseconds
     */
    getRequestTimeout() {
        return this.requestTimeout;
    }

    /**
     * Get active tool executions count
     * @returns {number} Number of active executions
     */
    getActiveExecutionsCount() {
        return this.activeToolExecutions.size;
    }

    /**
     * Clear all active executions (for reset scenarios)
     */
    clearActiveExecutions() {
        this.activeToolExecutions.clear();
        console.log('Background: Cleared all active tool executions');
    }

    // These methods should be implemented or injected
    async getAllToolDefinitions() {
        throw new Error('getAllToolDefinitions method must be implemented');
    }

    async validateConfig() {
        throw new Error('validateConfig method must be implemented');
    }
}

// Export singleton instance
export const toolExecutor = new ToolExecutor();