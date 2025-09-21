import { BaseManager } from '../../managers/BaseManager.js';

/**
 * Message Handler for Background Coordinator
 * Implements the Single Responsibility Principle for message handling
 */
export class MessageHandler extends BaseManager {
  constructor(coordinator) {
    super();
    this.coordinator = coordinator;
  }

  /**
   * Set up message listeners
   */
  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      // Handle different message types
      if (request.action === 'getTabContent') {
        this.handleGetTabContent(request, sender, sendResponse);
        return true; // Indicates async response
      } else if (request.action === 'getPinnedActionTabContent') {
        this.handleGetPinnedActionTabContent(request, sender, sendResponse);
        return true; // Indicates async response
      } else if (request.action === 'getExplainContent') {
        this.handleGetExplainContent(request, sender, sendResponse);
        return true; // Indicates async response
      } else if (request.action === 'executePromptPaulTool') {
        this.handleExecutePromptPaulTool(request, sender, sendResponse);
        return true; // Indicates async response
      } else if (request.action === 'executeLlmApiRequest') {
        this.handleExecuteLlmApiRequest(request, sender, sendResponse);
        return true; // Indicates async response
      } else if (request.action === 'fetchMcpToolDetailsFromServer') {
        this.handleFetchMcpToolDetailsFromServer(request, sender, sendResponse);
        return true; // Indicates async response
      }
      
      // Handle MCP management actions
      if (request.action && request.action.startsWith('mcp.')) {
        this.handleMcpAction(request, sender, sendResponse);
        return true; // Indicates async response
      }
    });
  }

  /**
   * Handle getTabContent message
   * @param {Object} request - Request object
   * @param {Object} sender - Sender object
   * @param {Function} sendResponse - Response function
   */
  handleGetTabContent(request, sender, sendResponse) {
    (async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) {
          sendResponse({ action: 'tabContentResponse', success: false, message: 'No active tab found' });
          return;
        }

        const results = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          function: () => {
            function extractPageContent() {
              // Get selected text if any
              const selection = window.getSelection().toString().trim();
              if (selection) {
                return selection;
              }

              // Fall back to page content
              const content = document.body.innerText || document.body.textContent || '';
              return content.slice(0, 10000); // Limit to 10KB
            }

            return extractPageContent();
          }
        });

        if (results && results[0]) {
          sendResponse({
            action: 'tabContentResponse',
            success: true,
            content: results[0].result,
            url: activeTab.url,
            title: activeTab.title
          });
        } else {
          sendResponse({ action: 'tabContentResponse', success: false, message: 'Failed to extract content' });
        }
      } catch (error) {
        console.error('Error getting tab content:', error);
        sendResponse({ action: 'tabContentResponse', success: false, message: error.message || String(error) });
      }
    })();
    return true;
  }

  /**
   * Handle getPinnedActionTabContent message
   * @param {Object} request - Request object
   * @param {Object} sender - Sender object
   * @param {Function} sendResponse - Response function
   */
  handleGetPinnedActionTabContent(request, sender, sendResponse) {
    (async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) {
          sendResponse({ action: 'pinnedActionTabContentResponse', success: false, content: 'No active tab found', instruction: request.instruction });
          return;
        }

        const results = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          function: () => {
            function extractPageContent() {
              // Get selected text if any
              const selection = window.getSelection().toString().trim();
              if (selection) {
                return selection;
              }

              // Fall back to page content
              const content = document.body.innerText || document.body.textContent || '';
              return content.slice(0, 10000); // Limit to 10KB
            }

            return extractPageContent();
          }
        });

        if (results && results[0]) {
          sendResponse({
            action: 'pinnedActionTabContentResponse',
            success: true,
            content: results[0].result,
            url: activeTab.url,
            title: activeTab.title,
            instruction: request.instruction
          });
        } else {
          sendResponse({ action: 'pinnedActionTabContentResponse', success: false, content: 'Failed to extract content', instruction: request.instruction });
        }
      } catch (error) {
        console.error('Error getting pinned action tab content:', error);
        sendResponse({ action: 'pinnedActionTabContentResponse', success: false, content: error.message || String(error), instruction: request.instruction });
      }
    })();
    return true;
  }

  /**
   * Handle getExplainContent message
   * @param {Object} request - Request object
   * @param {Object} sender - Sender object
   * @param {Function} sendResponse - Response function
   */
  async handleGetExplainContent(request, sender, sendResponse) {
    console.log('Background: Received getExplainContent request', request);
    
    try {
      // Get the active tab
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!activeTab) {
        sendResponse({ error: 'No active tab found' });
        return;
      }
      
      // Extract content from the active tab
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        function: () => {
          function extractPageContent() {
            // Get selected text if any
            const selection = window.getSelection().toString().trim();
            if (selection) {
              return selection;
            }

            // Fall back to page content
            const content = document.body.innerText || document.body.textContent || '';
            return content.slice(0, 10000); // Limit to 10KB
          }

          return extractPageContent();
        }
      });
      
      if (results && results[0]) {
        sendResponse({ 
          action: 'explainContentResponse',
          success: true,
          content: results[0].result,
          url: activeTab.url,
          title: activeTab.title
        });
      } else {
        sendResponse({ action: 'explainContentResponse', success: false, error: 'Failed to extract content' });
      }
    } catch (error) {
      console.error('Error getting explain content:', error);
      sendResponse({ action: 'explainContentResponse', success: false, error: error.message });
    }
  }

  /**
   * Handle executeLlmApiRequest message
   * @param {Object} request - Request object
   * @param {Object} sender - Sender object
   * @param {Function} sendResponse - Response function
   */
  async handleExecuteLlmApiRequest(request, sender, sendResponse) {
    console.log('Background: Received executeLlmApiRequest', request);
    
    try {
      const config = await this.coordinator.configManager.getConfig();
      
      if (!config.llmEndpoint || !config.apiKey) {
        sendResponse({ 
          error: 'LLM configuration not found. Please configure your LLM settings in the options page.' 
        });
        return;
      }
      
      const response = await this.makeApiRequest(config, request.messages);
      sendResponse({ response });
      
    } catch (error) {
      console.error('Error executing LLM API request:', error);
      sendResponse({ error: error.message });
    }
  }

  /**
   * Handle fetchMcpToolDetailsFromServer message
   * @param {Object} request - Request object
   * @param {Object} sender - Sender object
   * @param {Function} sendResponse - Response function
   */
  async handleFetchMcpToolDetailsFromServer(request, sender, sendResponse) {
    console.log('Background: Received fetchMcpToolDetailsFromServer request', request);
    
    try {
      const { mcpServerUrl } = request;
      
      if (!mcpServerUrl) {
        sendResponse({ error: 'MCP server URL is required' });
        return;
      }
      
      const tools = await this.coordinator.mcpManager.listMcpTools(mcpServerUrl);
      sendResponse({ tools });
      
    } catch (error) {
      console.error('Error fetching MCP tool details:', error);
      sendResponse({ error: error.message });
    }
  }


  /**
   * Handle MCP action messages
   * @param {Object} request - Request object
   * @param {Object} sender - Sender object
   * @param {Function} sendResponse - Response function
   */
  async handleMcpAction(request, sender, sendResponse) {
    console.log('Background: Received MCP action', request);
    
    try {
      const action = request.action.replace('mcp.', '');
      
      switch (action) {
        case 'initialize':
          await this.coordinator.mcpManager.initializeMcpSession(request.serverUrl);
          sendResponse({ success: true });
          break;
          
        case 'cleanup':
          this.coordinator.mcpManager.cleanupMcpSessions();
          sendResponse({ success: true });
          break;
          
        default:
          sendResponse({ error: `Unknown MCP action: ${action}` });
      }
      
    } catch (error) {
      console.error('Error handling MCP action:', error);
      sendResponse({ error: error.message });
    }
  }

  /**
   * Extract page content (standalone function for injection)
   */
  extractPageContent() {
    // Get selected text if any
    const selection = window.getSelection().toString().trim();
    if (selection) {
      return selection;
    }

    // Fall back to page content
    const content = document.body.innerText || document.body.textContent || '';
    return content.slice(0, 10000); // Limit to 10KB
  }

  /**
   * Get the standalone extractPageContent function as a string for injection
   */
  getExtractPageContentFunction() {
    return `
      function extractPageContent() {
        // Get selected text if any
        const selection = window.getSelection().toString().trim();
        if (selection) {
          return selection;
        }

        // Fall back to page content
        const content = document.body.innerText || document.body.textContent || '';
        return content.slice(0, 10000); // Limit to 10KB
      }

      return extractPageContent();
    `;
  }

  /**
   * Make API request to LLM
   * @param {Object} config - Configuration object
   * @param {Array} messages - Messages array
   * @returns {Promise<Object>} - API response
   */
  async makeApiRequest(config, messages) {
    const response = await fetch(config.llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.modelName,
        messages: messages,
        temperature: 0.7,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  }
}