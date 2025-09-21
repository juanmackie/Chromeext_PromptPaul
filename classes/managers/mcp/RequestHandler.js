import { BaseManager } from '../BaseManager.js';

/**
 * MCP Request Handler for handling MCP requests and responses
 * Implements the Single Responsibility Principle for request handling
 */
export class RequestHandler extends BaseManager {
  constructor(mcpManager) {
    super();
    this.mcpManager = mcpManager;
    
    // Constants
    this.REQUEST_TIMEOUT = 30000; // 30 seconds
  }

  /**
   * Send an MCP request
   * @param {String} mcpServerUrl - URL of the MCP server
   * @param {Object} requestPayload - Request payload
   * @param {String} sessionId - Optional session ID
   * @returns {Promise<Object>} - Response from the server
   */
  async sendRequest(mcpServerUrl, requestPayload, sessionId = null) {
    console.log(`Sending MCP request to ${mcpServerUrl}:`, JSON.stringify(requestPayload, null, 2));
    
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    };

    if (sessionId) {
      headers['mcp-session-id'] = sessionId;
      console.log(`Including mcp-session-id: ${sessionId} in request '${requestPayload.method}'`);
    } else if (requestPayload.method !== 'initialize') {
      console.warn(`No mcpSessionId for ${mcpServerUrl} when sending '${requestPayload.method}'`);
    }

    try {
      const response = await this.fetchWithTimeout(mcpServerUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseText = await response.text();
      
      if (!responseText.trim()) {
        console.warn(`Empty response from ${mcpServerUrl} for method ${requestPayload.method}`);
        return null;
      }

      try {
        const jsonResponse = JSON.parse(responseText);
        
        if (jsonResponse.error) {
          throw new Error(`MCP Error: ${JSON.stringify(jsonResponse.error)}`);
        }

        console.log(`Received MCP response from ${mcpServerUrl}:`, jsonResponse);
        return jsonResponse;
        
      } catch (parseError) {
        console.error(`Failed to parse JSON response from ${mcpServerUrl}:`, responseText);
        throw new Error(`Invalid JSON response: ${parseError.message}`);
      }

    } catch (error) {
      console.error(`MCP request failed for ${mcpServerUrl}:`, error);
      throw error;
    }
  }

  /**
   * Send an MCP notification
   * @param {String} mcpServerUrl - URL of the MCP server
   * @param {String} method - Method name
   * @param {Object} params - Parameters for the notification
   * @param {String} sessionId - Optional session ID
   */
  async sendNotification(mcpServerUrl, method, params = {}, sessionId = null) {
    console.log(`Sending MCP notification '${method}' to ${mcpServerUrl}:`, params);
    
    const notificationPayload = {
      jsonrpc: "2.0",
      method: method,
      params: params
    };

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    };

    if (sessionId) {
      headers['mcp-session-id'] = sessionId;
      console.log(`Including mcp-session-id: ${sessionId} in notification '${method}'`);
    } else if (method === "initialized") {
      console.warn(`Sending '${method}' notification WITHOUT mcpSessionId`);
    }

    try {
      const response = await this.fetchWithTimeout(mcpServerUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(notificationPayload)
      });

      if (!response.ok) {
        console.warn(`MCP Notification HTTP error! Status: ${response.status} for method ${method}`);
        try {
          const errorBody = await response.text();
          console.warn(`MCP Notification error body: ${errorBody}`);
        } catch(e) { /* ignore */ }
      }
    } catch (error) {
      console.error(`Error sending MCP notification '${method}' to ${mcpServerUrl}:`, error);
    }
  }

  /**
   * Call an MCP tool
   * @param {String} mcpServerUrl - URL of the MCP server
   * @param {String} toolName - Name of the tool
   * @param {Object} args - Tool arguments
   * @param {String} sessionId - Session ID
   * @returns {Promise<Object>} - Tool execution result
   */
  async callTool(mcpServerUrl, toolName, args, sessionId) {
    console.log(`Calling MCP tool '${toolName}' on ${mcpServerUrl} with args:`, args);
    
    const requestId = `mcp-tool-${toolName}-${Date.now()}`;
    const requestPayload = {
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args || {}
      }
    };

    try {
      const response = await this.sendRequest(mcpServerUrl, requestPayload, sessionId);
      
      if (response && response.result) {
        console.log(`MCP tool '${toolName}' executed successfully`);
        return response.result;
      } else {
        throw new Error(`Invalid tool call response: ${JSON.stringify(response)}`);
      }
      
    } catch (error) {
      console.error(`MCP tool '${toolName}' execution failed:`, error);
      throw error;
    }
  }

  /**
   * List tools from an MCP server
   * @param {String} mcpServerUrl - URL of the MCP server
   * @param {String} sessionId - Session ID
   * @returns {Promise<Array>} - Array of tools
   */
  async listTools(mcpServerUrl, sessionId) {
    console.log(`Listing tools from MCP server: ${mcpServerUrl}`);
    
    const requestId = `mcp-listtools-${Date.now()}`;
    const requestPayload = {
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/list",
      params: {}
    };

    try {
      const response = await this.sendRequest(mcpServerUrl, requestPayload, sessionId);

      if (response && response.result && Array.isArray(response.result.tools)) {
        console.log(`Received ${response.result.tools.length} tools from ${mcpServerUrl}`);
        return response.result.tools;
      } else {
        console.error(`Unexpected response format from ${mcpServerUrl}:`, response);
        return [];
      }
    } catch (error) {
      console.error(`Error listing tools from ${mcpServerUrl}: ${error.message}`);
      return [];
    }
  }

  /**
   * Timeout wrapper for fetch requests
   * @param {String} url - URL to fetch
   * @param {Object} options - Fetch options
   * @param {Number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<Response>} - Fetch response
   */
  async fetchWithTimeout(url, options, timeoutMs = this.REQUEST_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  }

  /**
   * Test connectivity to an MCP server
   * @param {String} mcpServerUrl - URL of the MCP server
   * @returns {Promise<Object>} - Test result
   */
  async testConnectivity(mcpServerUrl) {
    console.log(`Testing connectivity to MCP server: ${mcpServerUrl}`);
    
    try {
      const testPayload = {
        jsonrpc: "2.0",
        id: `test-${Date.now()}`,
        method: "ping",
        params: {}
      };

      const startTime = Date.now();
      const response = await this.fetchWithTimeout(mcpServerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(testPayload)
      }, 5000); // 5 second timeout for connectivity test

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      return {
        success: true,
        status: response.status,
        responseTime: responseTime,
        reachable: response.ok
      };

    } catch (error) {
      console.error(`Connectivity test failed for ${mcpServerUrl}:`, error);
      return {
        success: false,
        error: error.message,
        reachable: false
      };
    }
  }
}