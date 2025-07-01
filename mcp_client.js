// --- mcp_client.js ---
// JSDoc types based on the conceptual mcp_types.js
/**
 * @typedef {import('./background.js').JsonRpcRequest} JsonRpcRequest
 * @typedef {import('./background.js').JsonRpcError} JsonRpcError
 * @typedef {import('./background.js').JsonRpcResponse} JsonRpcResponse
 * @typedef {import('./background.js').McpClientInfo} McpClientInfo
 * @typedef {import('./background.js').McpClientCapabilities} McpClientCapabilities
 * @typedef {import('./background.js').McpToolDefinition} McpToolDefinition
 * @typedef {import('./background.js').McpServerCapabilities} McpServerCapabilities
 * @typedef {import('./background.js').McpToolResult} McpToolResult
 */

class McpError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = "McpError";
    }
}
class McpInitializationError extends McpError {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = "McpInitializationError";
    }
}
class McpToolCallError extends McpError {
    /**
     * @param {string} message
     * @param {JsonRpcError} [details]
     */
    constructor(message, details) {
        super(message);
        this.name = "McpToolCallError";
        if (details) this.details = details;
    }
}
class McpNetworkError extends McpError {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = "McpNetworkError";
    }
}
class McpResponseParseError extends McpError {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = "McpResponseParseError";
    }
}


class McpClient {
    /**
     * @param {string} serverUrl
     * @param {McpClientInfo} clientInfo
     * @param {McpClientCapabilities} clientCapabilities
     */
    constructor(serverUrl, clientInfo, clientCapabilities) {
        this.serverUrl = serverUrl;
        /** @type {string | null} */
        this.mcpSessionId = null;
        this.clientInfo = clientInfo;
        this.clientCapabilities = clientCapabilities;
        /** @type {McpServerCapabilities | null} */
        this.serverCapabilities = null;
        /** @type {string | null} */
        this.protocolVersion = "0.1.0"; // Default client protocol version
        /** @type {McpToolDefinition[] | null} */
        this.tools = null;
        this.isInitialized = false;
        console.log(`McpClient created for ${serverUrl}`);
    }

    /**
     * Initializes the MCP session with the server.
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.isInitialized) {
            console.log(`McpClient for ${this.serverUrl} is already initialized.`);
            return;
        }
        console.log(`McpClient: Initializing session for ${this.serverUrl}`);
        const requestId = `mcp-init-${Date.now()}`;
        const initializeParams = {
            protocolVersion: this.protocolVersion,
            capabilities: this.clientCapabilities,
            clientInfo: this.clientInfo
        };
        /** @type {JsonRpcRequest} */
        const requestPayload = {
            jsonrpc: "2.0",
            id: requestId,
            method: "initialize",
            params: initializeParams
        };

        try {
            const response = await fetch(this.serverUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream'
                },
                body: JSON.stringify(requestPayload)
            });

            if (!response.ok) {
                let errorBody = "";
                try { errorBody = await response.text(); } catch(e) {/*ignore*/}
                throw new McpNetworkError(`HTTP error ${response.status}: ${response.statusText}. Body: ${errorBody}`);
            }

            const mcpSessionIdHeader = response.headers.get('mcp-session-id');
            if (!mcpSessionIdHeader) {
                throw new McpInitializationError('mcp-session-id header not found in initialize response.');
            }
            this.mcpSessionId = mcpSessionIdHeader;
            console.log(`McpClient: Received mcp-session-id: ${this.mcpSessionId}`);

            const responseText = await response.text();
            const initializeResult = await this._parseResponseFromStream(responseText, requestId, "initialize");

            if (!initializeResult.result || !initializeResult.result.capabilities || !initializeResult.result.protocolVersion) {
                console.error('McpClient: Invalid initialize result structure:', initializeResult);
                throw new McpInitializationError('Invalid result structure from server for initialize request.');
            }

            this.serverCapabilities = initializeResult.result.capabilities;
            this.protocolVersion = initializeResult.result.protocolVersion; // Update with server's version if needed, or compare
            console.log(`McpClient: Session initialized. Server capabilities:`, this.serverCapabilities, `Protocol: ${this.protocolVersion}`);

            this.isInitialized = true;

            // Send "initialized" notification
            await this._sendNotification("initialized", {});
            console.log(`McpClient: Sent 'initialized' notification to ${this.serverUrl}`);

            // List tools
            await this._listTools();

        } catch (error) {
            this.isInitialized = false; // Ensure state is correct on failure
            console.error(`McpClient: Error during session initialization for ${this.serverUrl}:`, error);
            if (error instanceof McpError) throw error;
            throw new McpInitializationError(`Session initialization failed: ${error.message}`);
        }
    }

    /**
     * @private
     * Fetches and stores the list of tools from the server.
     * @returns {Promise<void>}
     */
    async _listTools() {
        if (!this.isInitialized) throw new McpError("Client not initialized. Cannot list tools.");
        console.log(`McpClient: Listing tools from ${this.serverUrl}`);
        const requestId = `mcp-listtools-${Date.now()}`;
        /** @type {JsonRpcRequest} */
        const requestPayload = {
            jsonrpc: "2.0",
            id: requestId,
            method: "tools/list",
            params: {}
        };

        try {
            const response = await this._sendRequest(requestPayload);
            if (response.result && Array.isArray(response.result.tools)) {
                this.tools = response.result.tools;
                console.log(`McpClient: Discovered ${this.tools.length} tools from ${this.serverUrl}:`, this.tools);
            } else {
                this.tools = [];
                console.warn(`McpClient: No tools found or unexpected format from tools/list for ${this.serverUrl}. Response:`, response);
            }
        } catch (error) {
            this.tools = [];
            console.error(`McpClient: Error listing tools from ${this.serverUrl}:`, error);
            // Decide if this should be a fatal error for initialization or just a warning
        }
    }

    /**
     * Calls a tool on the MCP server.
     * @param {string} toolName
     * @param {object} toolArguments
     * @returns {Promise<McpToolResult>}
     */
    async callTool(toolName, toolArguments) {
        if (!this.isInitialized) {
            await this.initialize(); // Auto-initialize if not done yet
        }
        if (!this.isToolAvailable(toolName)) {
            throw new McpToolCallError(`Tool '${toolName}' not available or not advertised by the server ${this.serverUrl}.`);
        }

        console.log(`McpClient: Calling tool '${toolName}' on ${this.serverUrl} with args:`, toolArguments);
        const requestId = `mcp-toolcall-${Date.now()}`;
        /** @type {JsonRpcRequest} */
        const requestPayload = {
            jsonrpc: "2.0",
            id: requestId,
            method: "tools/call",
            params: {
                name: toolName,
                arguments: toolArguments
            }
        };

        try {
            const response = await this._sendRequest(requestPayload);
            // MCP spec for tools/call result: { content: "...", isError: false/true, errorDetails?: ... }
            // So, response.result IS the McpToolResult
            if (response.result && typeof response.result.content !== 'undefined' && typeof response.result.isError !== 'undefined') {
                 /** @type {McpToolResult} */
                const toolResult = response.result;
                if (toolResult.isError) {
                    console.warn(`McpClient: Tool '${toolName}' execution resulted in an error on server:`, toolResult.errorDetails || toolResult.content);
                }
                return toolResult;
            } else {
                console.error(`McpClient: Invalid tool call response structure from server for '${toolName}':`, response);
                throw new McpToolCallError(`Invalid response structure from tool '${toolName}'.`, { code: -32001, message: "Invalid tool response structure" });
            }
        } catch (error) {
            console.error(`McpClient: Error calling tool '${toolName}' on ${this.serverUrl}:`, error);
            if (error instanceof McpToolCallError) throw error;
            if (error instanceof McpError) throw new McpToolCallError(`Failed to call tool '${toolName}': ${error.message}`);
            throw new McpToolCallError(`Failed to call tool '${toolName}': ${error.message}`);
        }
    }

    /**
     * @private
     * Sends a JSON-RPC request and handles the response.
     * @param {JsonRpcRequest} requestPayload
     * @returns {Promise<JsonRpcResponse>}
     */
    async _sendRequest(requestPayload) {
        if (!this.mcpSessionId && requestPayload.method !== "initialize") { // Initialize is special, doesn't need prior session ID
            throw new McpError("MCP session ID is not available. Initialize session first.");
        }
        console.debug(`McpClient._sendRequest to ${this.serverUrl}:`, requestPayload);

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream' // Prefer SSE for streaming potential
        };
        if (this.mcpSessionId) {
            headers['mcp-session-id'] = this.mcpSessionId;
        }

        try {
            const response = await fetch(this.serverUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestPayload)
            });

            if (!response.ok) {
                let errorBody = "";
                try { errorBody = await response.text(); } catch(e) {/*ignore*/}
                throw new McpNetworkError(`HTTP error ${response.status} for method ${requestPayload.method}. Body: ${errorBody}`);
            }

            const responseText = await response.text();
            return this._parseResponseFromStream(responseText, requestPayload.id, requestPayload.method);

        } catch (error) {
            console.error(`McpClient: Network or fetch error for method ${requestPayload.method} to ${this.serverUrl}:`, error);
            if (error instanceof McpError) throw error;
            throw new McpNetworkError(`Request failed for ${requestPayload.method}: ${error.message}`);
        }
    }

    /**
     * @private
     * Parses a JSON-RPC response from a string that might be an SSE stream or direct JSON.
     * @param {string} responseText The full response text.
     * @param {string|number|undefined} targetId The ID of the JSON-RPC request we are looking for.
     * @param {string} methodName For logging purposes.
     * @returns {Promise<JsonRpcResponse>}
     * @throws {McpResponseParseError} If parsing fails or the target response isn't found.
     */
    async _parseResponseFromStream(responseText, targetId, methodName = "unknown") {
        // Attempt to parse as direct JSON first
        try {
            const directJson = JSON.parse(responseText);
            if (directJson.id === targetId && (directJson.result !== undefined || directJson.error !== undefined)) {
                console.log(`McpClient: Parsed direct JSON response for ${methodName} (ID: ${targetId})`);
                if (directJson.error) {
                     console.warn(`McpClient: JSON-RPC error in direct response for ${methodName} (ID: ${targetId}):`, directJson.error);
                }
                return directJson;
            }
        } catch (e) {
            // Not direct JSON or not the response we're looking for, proceed to SSE parsing
            console.log(`McpClient: Not a direct JSON response for ${methodName} (ID: ${targetId}) or parse error, trying SSE. Error: ${e.message}`);
        }

        // Proceed with SSE parsing logic
        console.log(`McpClient: Attempting to parse SSE stream for ${methodName} (ID: ${targetId})`);
        const lines = responseText.trim().split('\n');
        for (const line of lines) {
            if (line.startsWith('data:')) {
                const jsonData = line.substring(5).trim();
                if (jsonData) {
                    try {
                        const parsedEventData = JSON.parse(jsonData);
                        if (parsedEventData.id === targetId && (parsedEventData.result !== undefined || parsedEventData.error !== undefined)) {
                            console.log(`McpClient: Found JSON-RPC response for ${methodName} (ID: ${targetId}) in SSE data:`, parsedEventData);
                             if (parsedEventData.error) {
                                console.warn(`McpClient: JSON-RPC error in SSE response for ${methodName} (ID: ${targetId}):`, parsedEventData.error);
                            }
                            return parsedEventData;
                        }
                    } catch (e) {
                        console.warn(`McpClient: Could not parse SSE data line as JSON or not the target response: "${jsonData}" for ${methodName} (ID: ${targetId})`, e);
                    }
                }
            }
        }
        console.error(`McpClient: Response for ${methodName} (ID: ${targetId}) not found in response text. Full text:`, responseText.substring(0, 500) + "...");
        throw new McpResponseParseError(`Response for ${methodName} (ID: ${targetId}) not found in stream.`);
    }


    /**
     * @private
     * Sends a JSON-RPC notification.
     * @param {string} method
     * @param {object} params
     * @returns {Promise<void>}
     */
    async _sendNotification(method, params) {
        if (!this.mcpSessionId) {
            // Allow 'initialized' to proceed without session ID if it's the very first post-init message.
            // However, our current flow sets mcpSessionId *before* sending 'initialized'.
             console.warn(`McpClient: mcpSessionId not set when sending notification '${method}'. This might be an issue.`);
        }
        console.log(`McpClient: Sending notification '${method}' to ${this.serverUrl} with params:`, params);
        /** @type {JsonRpcRequest} */
        const notificationPayload = {
            jsonrpc: "2.0",
            method: method,
            params: params || {}
        };
        const headers = { 'Content-Type': 'application/json' };
        if (this.mcpSessionId) {
            headers['mcp-session-id'] = this.mcpSessionId;
        }

        try {
            const response = await fetch(this.serverUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(notificationPayload)
            });

            if (!response.ok) {
                let errorBody = "";
                try {errorBody = await response.text(); } catch(e) {/*ignore*/}
                console.warn(`McpClient: Notification '${method}' to ${this.serverUrl} failed with HTTP status ${response.status}. Body: ${errorBody}`);
                // Optionally, throw McpNetworkError or a specific McpNotificationError
            }
        } catch (error) {
            console.error(`McpClient: Error sending notification '${method}' to ${this.serverUrl}:`, error);
            // Optionally, throw
        }
    }

    /**
     * Checks if a tool is available on the server.
     * @param {string} toolName
     * @returns {boolean}
     */
    isToolAvailable(toolName) {
        return !!(this.tools && this.tools.some(t => t.name === toolName));
    }

    /**
     * Gets the schema for a specific tool.
     * @param {string} toolName
     * @returns {McpToolDefinition | null}
     */
    getToolSchema(toolName) {
        if (!this.tools) return null;
        return this.tools.find(t => t.name === toolName) || null;
    }
}

// End of mcp_client.js
console.log("McpClient class definition loaded.");
