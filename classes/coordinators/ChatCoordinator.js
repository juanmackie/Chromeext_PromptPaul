import { BaseCoordinator } from '../coordinators/BaseCoordinator.js';
import { ChatViewModel } from '../viewmodels/ChatViewModel.js';
import { ConfigManager } from '../managers/ConfigManager.js';
import { ToolManager } from '../managers/ToolManager.js';
import { MCPManager } from '../managers/MCPManager.js';
import { ApiRequestHandler } from './handlers/ApiRequestHandler.js';
import { ChatToolHandler } from './handlers/ChatToolHandler.js';
import { ChatMessageHandler } from './handlers/ChatMessageHandler.js';
import { ChatActionHandler } from './handlers/ChatActionHandler.js';

/**
 * Chat Coordinator handling chat flow and coordination
 * Implements the Coordinator pattern for navigation and state flow management
 */
export class ChatCoordinator extends BaseCoordinator {
  constructor() {
    super();
    
    // Initialize managers
    this.configManager = new ConfigManager();
    this.toolManager = new ToolManager();
    this.mcpManager = new MCPManager();
    
    // Initialize view model
    this.viewModel = new ChatViewModel();
    
    // Initialize handlers
    this.apiHandler = new ApiRequestHandler();
    this.toolHandler = new ChatToolHandler(this.toolManager, this.mcpManager);
    this.messageHandler = new ChatMessageHandler();
    this.actionHandler = new ChatActionHandler(this);
    
    // Conversation state
    this.conversationHistory = [];
  }

  /**
   * Start the chat coordinator
   */
  async start() {
    console.log('ChatCoordinator: Starting...');
    await this.configManager.initialize();
    await this.toolManager.initialize();
    await this.actionHandler.checkPendingContextActions();
    this.actionHandler.startMonitoring();
  }

  /**
   * Stop the chat coordinator and clean up resources
   */
  async stop() {
    console.log('ChatCoordinator: Stopping...');
    this.apiHandler.abortRequest();
    this.actionHandler.stopMonitoring();
    await super.stop();
    await this.mcpManager.destroy();
    await this.toolManager.destroy();
  }

  /**
   * Send a message to the LLM
   * @param {String} userMessage - User's message
   * @param {Object} mediaData - Media data for analysis (optional)
   * @param {String} toolChoice - Tool choice option (optional)
   */
  async sendMessage(userMessage, mediaData = null, toolChoice = 'none') {
    console.log('💬 ChatCoordinator.sendMessage called:', {
      messageLength: userMessage?.length,
      hasMediaData: !!mediaData,
      toolChoice
    });

    try {
      // Abort any ongoing request
      this.apiHandler.abortRequest();

      // Add user message to view model
      this.viewModel.addMessage({
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString()
      });
      console.log('✅ User message added to viewModel');

      // Get configuration
      const config = await this.configManager.getConfig();
      if (!config.apiKey || !config.llmEndpoint) {
        throw new Error('Please configure your API settings first.');
      }
      console.log('✅ Configuration loaded successfully');

      // Get streaming preference
      const result = await new Promise((resolve) => {
        chrome.storage.sync.get(['enableStreaming'], resolve);
      });
      const enableStreaming = result.enableStreaming || false;

      // Prepare messages using message handler
      const messages = this.messageHandler.prepareMessages(
        this.conversationHistory, 
        userMessage, 
        mediaData, 
        config
      );

      // Get tools from tool handler
      const formattedTools = await this.toolHandler.getFormattedTools();
      
      // Handle Anthropic-specific formatting
      const isAnthropicEndpoint = this.messageHandler.isAnthropicEndpoint(config.llmEndpoint);
      if (isAnthropicEndpoint && mediaData) {
        this.messageHandler.handleAnthropicImageFormatting(messages, mediaData);
      }

      // Prepare request components
      const headers = this.messageHandler.prepareHeaders(config);
      const requestBody = this.messageHandler.prepareRequestBody(
        messages, 
        formattedTools, 
        toolChoice, 
        config, 
        enableStreaming
      );

      // Make API request
      if (enableStreaming) {
        await this.handleStreamingResponse(config, headers, requestBody);
      } else {
        await this.handleNonStreamingResponse(config, headers, requestBody);
      }

    } catch (error) {
      console.error('Error sending message:', error);
      this.viewModel.addMessage({
        role: 'assistant',
        content: `Error: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle streaming response
   * @param {Object} config - API configuration
   * @param {Object} headers - Request headers
   * @param {Object} requestBody - Request body
   */
  async handleStreamingResponse(config, headers, requestBody) {
    let currentContent = '';
    
    const onChunk = (content) => {
      currentContent += content;
      this.viewModel.updateStreamingMessage(currentContent);
    };

    await this.apiHandler.makeStreamingRequest(config, headers, requestBody, onChunk);
    
    // Finalize the streaming message
    if (currentContent) {
      this.conversationHistory = this.messageHandler.addAssistantMessage(
        this.conversationHistory, 
        currentContent
      );
      this.viewModel.finalizeStreamingMessage();
    }
  }

  /**
   * Handle non-streaming response
   * @param {Object} config - API configuration
   * @param {Object} headers - Request headers
   * @param {Object} requestBody - Request body
   */
  async handleNonStreamingResponse(config, headers, requestBody) {
    const responseData = await this.apiHandler.makeNonStreamingRequest(config, headers, requestBody);
    
    if (!responseData) return; // Request was aborted
    
    const responseMessage = responseData.choices[0].message;
    
    // Add assistant message to conversation
    this.conversationHistory = this.messageHandler.addAssistantMessage(
      this.conversationHistory,
      responseMessage.content,
      responseMessage.tool_calls
    );

    // Add to view model
    this.viewModel.addMessage({
      role: 'assistant',
      content: responseMessage.content,
      timestamp: new Date().toISOString(),
      tool_calls: responseMessage.tool_calls
    });

    // Handle tool calls if present
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      await this.handleToolCalls(responseMessage.tool_calls);
    }
  }

  /**
   * Handle tool calls from assistant response
   * @param {Array} toolCalls - Array of tool calls
   */
  async handleToolCalls(toolCalls) {
    for (const toolCall of toolCalls) {
      const toolResult = await this.toolHandler.executeToolCall(toolCall);
      
      // Add tool result to conversation
      this.conversationHistory = this.messageHandler.addToolResult(this.conversationHistory, toolResult);
      
      // Add to view model
      this.viewModel.addMessage({
        role: 'tool',
        content: toolResult.content,
        timestamp: new Date().toISOString(),
        tool_call_id: toolResult.tool_call_id
      });
    }
  }

  /**
   * Clear the chat
   */
  clearChat() {
    this.conversationHistory = [];
    this.viewModel.clearChat();
    this.apiHandler.abortRequest();
  }

  /**
   * Stop the current API request
   */
  stopRequest() {
    this.apiHandler.abortRequest();
  }

  /**
   * Check for pending context actions (delegated to action handler)
   */
  async checkPendingContextActions() {
    return this.actionHandler.checkPendingContextActions();
  }

  /**
   * Handle pending action (delegated to action handler)
   * @param {Object} action - The pending action to handle
   */
  async handlePendingAction(action) {
    return this.actionHandler.handlePendingAction(action);
  }
}