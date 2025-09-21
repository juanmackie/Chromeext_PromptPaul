import { BaseManager } from '../../managers/BaseManager.js';

/**
 * Tool Execution Handler for Background Coordinator
 * Implements the Single Responsibility Principle for tool execution logic
 */
export class ToolExecutionHandler extends BaseManager {
  constructor(coordinator) {
    super();
    this.coordinator = coordinator;
  }

  /**
   * Handle executePromptPaulTool message
   * @param {Object} request - Request object
   * @param {Object} sender - Sender object
   * @param {Function} sendResponse - Response function
   */
  async handleExecutePromptPaulTool(request, sender, sendResponse) {
    const { id, name, arguments: argsString } = request.toolCall;
    console.log(`Background: Received request to execute tool '${name}' with id '${id}' (executePromptPaulTool entry)`);

    // Prevent duplicate executions
    const executionKey = `${id}-${name}`;
    if (this.coordinator.activeToolExecutions.has(executionKey)) {
      console.log(`Background: Tool execution '${executionKey}' already in progress, ignoring duplicate request`);
      return;
    }
    
    this.coordinator.activeToolExecutions.add(executionKey);
    console.log(`Background: Added '${executionKey}' to active executions. Active count: ${this.coordinator.activeToolExecutions.size}`);

    try {
      const allTools = await this.coordinator.toolManager.getAllTools();
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

      // Handle MCP tools
      if (toolDefinition.mcpServerUrl && toolDefinition.mcpServerUrl.trim() !== "") {
        result = await this.executeMcpTool(toolDefinition, name, argsObject);
      } else {
        // Handle custom tools
        result = await this.executeCustomTool(toolDefinition, argsObject);
      }

      // Send success response
      sendResponse({
        success: true,
        result: result,
        toolCall: { id, name, arguments: argsString }
      });

    } catch (error) {
      console.error(`Background: Error executing tool '${name}':`, error);
      
      // Send error response
      sendResponse({
        success: false,
        error: error.message,
        toolCall: { id, name, arguments: argsString }
      });
    } finally {
      // Always remove from active executions
      this.coordinator.activeToolExecutions.delete(executionKey);
      console.log(`Background: Removed '${executionKey}' from active executions. Active count: ${this.coordinator.activeToolExecutions.size}`);
    }
  }

  /**
   * Execute MCP tool
   * @param {Object} toolDefinition - Tool definition
   * @param {String} name - Tool name
   * @param {Object} argsObject - Arguments object
   * @returns {Promise<Object>} - Execution result
   */
  async executeMcpTool(toolDefinition, name, argsObject) {
    console.log(`Executing '${name}' as an MCP tool via ${toolDefinition.mcpServerUrl}`);
    
    const session = await this.coordinator.mcpManager.getMcpSession(toolDefinition.mcpServerUrl);
    if (!session || !session.initialized) {
      throw new Error("MCP session could not be initialized.");
    }
    
    // Update session last used timestamp
    session.lastUsed = Date.now();
    
    // Validate that the server supports this tool
    const serverTools = session.tools;
    if (!Array.isArray(serverTools) || !serverTools.some(t => t.name === name)) {
      console.warn(`Tool '${name}' not found in server capabilities or serverCapabilities.tools is not an array. Server tools:`, serverTools);
      throw new Error(`MCP server at ${toolDefinition.mcpServerUrl} does not list tool '${name}' among its capabilities.`);
    }

    // Execute the MCP tool
    const mcpResult = await this.coordinator.mcpManager.callMcpTool(
      toolDefinition.mcpServerUrl, 
      name, 
      argsObject
    );

    console.log(`Background: MCP tool '${name}' executed successfully. Result:`, mcpResult);
    return mcpResult;
  }

  /**
   * Execute custom tool
   * @param {Object} toolDefinition - Tool definition
   * @param {Object} argsObject - Arguments object
   * @returns {Promise<Object>} - Execution result
   */
  async executeCustomTool(toolDefinition, argsObject) {
    console.log(`Executing '${toolDefinition.name}' as a custom tool`);

    // Validate required parameters
    const schema = JSON.parse(toolDefinition.schema || '{}');
    const required = schema.required || [];
    
    for (const param of required) {
      if (!(param in argsObject)) {
        throw new Error(`Missing required parameter: ${param}`);
      }
    }

    // Execute the custom tool logic based on tool type
    switch (toolDefinition.name) {
      case 'get_page_content':
        return await this.getPageContent(argsObject);
        
      case 'search_web':
        return await this.searchWeb(argsObject);
        
      case 'extract_text':
        return await this.extractText(argsObject);
        
      default:
        throw new Error(`Unknown custom tool: ${toolDefinition.name}`);
    }
  }

  /**
   * Get page content tool implementation
   * @param {Object} args - Tool arguments
   * @returns {Promise<Object>} - Page content
   */
  async getPageContent(args) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!activeTab) {
      throw new Error('No active tab found');
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      function: () => {
        return {
          url: window.location.href,
          title: document.title,
          content: document.body.innerText || document.body.textContent || '',
          selectedText: window.getSelection().toString().trim()
        };
      }
    });

    if (!results || !results[0]) {
      throw new Error('Failed to extract page content');
    }

    return results[0].result;
  }

  /**
   * Search web tool implementation
   * @param {Object} args - Tool arguments
   * @returns {Promise<Object>} - Search results
   */
  async searchWeb(args) {
    const { query, limit = 10 } = args;
    
    // This is a placeholder implementation
    // In a real scenario, you'd integrate with a search API
    return {
      query: query,
      results: [
        {
          title: `Search results for: ${query}`,
          url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          snippet: `This would contain search results for the query: ${query}`
        }
      ],
      total: 1
    };
  }

  /**
   * Extract text tool implementation
   * @param {Object} args - Tool arguments
   * @returns {Promise<Object>} - Extracted text
   */
  async extractText(args) {
    const { selector } = args;
    
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!activeTab) {
      throw new Error('No active tab found');
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      function: (sel) => {
        const elements = document.querySelectorAll(sel);
        return Array.from(elements).map(el => el.textContent || el.innerText).join('\n');
      },
      args: [selector]
    });

    if (!results || !results[0]) {
      throw new Error('Failed to extract text');
    }

    return {
      selector: selector,
      text: results[0].result,
      elementCount: results[0].result.split('\n').filter(line => line.trim()).length
    };
  }
}