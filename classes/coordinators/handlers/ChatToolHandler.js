import { BaseManager } from '../../managers/BaseManager.js';

/**
 * Chat Tool Handler for managing tool execution in chat context
 * Handles both regular tools and MCP tools
 */
export class ChatToolHandler extends BaseManager {
  constructor(toolManager, mcpManager) {
    super();
    this.toolManager = toolManager;
    this.mcpManager = mcpManager;
  }

  /**
   * Execute a tool call
   * @param {Object} toolCall - Tool call to execute
   * @returns {Object} - Tool execution result
   */
  async executeToolCall(toolCall) {
    try {
      console.log('Executing tool call:', toolCall);
      
      const toolDefinition = await this.toolManager.getToolByName(toolCall.function.name);
      if (!toolDefinition) {
        return {
          tool_call_id: toolCall.id,
          role: 'tool',
          content: `Error: Tool '${toolCall.function.name}' not found.`
        };
      }

      // Check if this is an MCP tool
      if (toolDefinition.mcpServerUrl && toolDefinition.mcpServerUrl.trim() !== "") {
        return await this.executeMcpTool(toolCall, toolDefinition);
      } else {
        // Handle regular tools (if any)
        return {
          tool_call_id: toolCall.id,
          role: 'tool',
          content: `Tool '${toolCall.function.name}' executed successfully.`
        };
      }
    } catch (error) {
      console.error('Tool execution failed:', error);
      return {
        tool_call_id: toolCall.id,
        role: 'tool',
        content: `Error executing tool: ${error.message}`
      };
    }
  }

  /**
   * Execute an MCP tool
   * @param {Object} toolCall - Tool call to execute
   * @param {Object} toolDefinition - Tool definition
   * @returns {Object} - Tool execution result
   */
  async executeMcpTool(toolCall, toolDefinition) {
    try {
      const session = await this.mcpManager.getSession(toolDefinition.mcpServerUrl);
      if (!session || !session.initialized) {
        throw new Error(`MCP session not available for ${toolDefinition.mcpServerUrl}`);
      }

      const serverTools = await this.mcpManager.getAvailableTools(toolDefinition.mcpServerUrl);
      if (!Array.isArray(serverTools) || !serverTools.some(t => t.name === toolCall.function.name)) {
        throw new Error(`Tool '${toolCall.function.name}' not available on MCP server`);
      }

      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const mcpPayload = this.createMcpToolCallPayload(
        toolCall.function.name,
        toolCall.function.arguments,
        requestId
      );

      const mcpResult = await this.mcpManager.callTool(toolDefinition.mcpServerUrl, mcpPayload);
      
      return {
        tool_call_id: toolCall.id,
        role: 'tool',
        content: typeof mcpResult.content === 'string' ? mcpResult.content : JSON.stringify(mcpResult.content)
      };
    } catch (mcpError) {
      console.error('MCP tool execution failed:', mcpError);
      let errorMessage = `MCP tool execution failed: ${mcpError.message}`;
      
      if (mcpError.details && mcpError.details.message) {
        errorMessage += ` - ${mcpError.details.message}`;
      }
      
      return {
        tool_call_id: toolCall.id,
        role: 'tool',
        content: errorMessage
      };
    }
  }

  /**
   * Create MCP tool call payload
   * @param {String} toolName - Name of the tool
   * @param {Object} toolArguments - Arguments for the tool
   * @param {String} requestId - Request ID
   * @returns {Object} - MCP tool call payload
   */
  createMcpToolCallPayload(toolName, toolArguments, requestId) {
    let parsedArguments = toolArguments;
    
    if (typeof toolArguments === 'string') {
      try {
        parsedArguments = JSON.parse(toolArguments);
      } catch (error) {
        console.warn('Failed to parse tool arguments as JSON:', toolArguments);
        parsedArguments = { input: toolArguments };
      }
    }

    return {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: parsedArguments || {}
      }
    };
  }

  /**
   * Get formatted tools for API requests
   * @returns {Array} - Array of formatted tool definitions
   */
  async getFormattedTools() {
    try {
      const tools = await this.toolManager.getAllTools();
      return tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.schema || {}
        }
      }));
    } catch (error) {
      console.error('Failed to get formatted tools:', error);
      return [];
    }
  }

  /**
   * Get MCP configured tools
   * @returns {Array} - Array of MCP tool names
   */
  async getMcpConfiguredTools() {
    try {
      const tools = await this.toolManager.getAllTools();
      return tools
        .filter(tool => tool.mcpServerUrl && tool.mcpServerUrl.trim() !== '')
        .map(tool => tool.name);
    } catch (error) {
      console.error('Failed to get MCP configured tools:', error);
      return [];
    }
  }
}