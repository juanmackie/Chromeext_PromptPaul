import { BaseManager } from '../../managers/BaseManager.js';

/**
 * Chat Message Handler for managing chat message formatting and processing
 * Handles message preparation for API requests
 */
export class ChatMessageHandler extends BaseManager {
  constructor() {
    super();
  }

  /**
   * Prepare messages for API request
   * @param {Array} conversationHistory - Current conversation history
   * @param {String} userMessage - New user message
   * @param {Object} mediaData - Media data for analysis (optional)
   * @param {Object} config - API configuration
   * @returns {Array} - Formatted messages for API
   */
  prepareMessages(conversationHistory, userMessage, mediaData, config) {
    const messages = [...conversationHistory];

    // Add system prompt if provided
    if (config.systemPrompt && config.systemPrompt.trim() !== '') {
      const hasSystemMessage = messages.some(msg => msg.role === 'system');
      if (!hasSystemMessage) {
        messages.unshift({
          role: 'system',
          content: config.systemPrompt
        });
      }
    }

    // Add user message
    if (userMessage) {
      const userMessageObj = {
        role: 'user',
        content: userMessage
      };

      // Handle image data for OpenAI-compatible APIs
      if (mediaData && mediaData.type === 'image') {
        userMessageObj.content = [
          {
            type: 'text',
            text: userMessage
          },
          {
            type: 'image_url',
            image_url: {
              url: mediaData.dataUrl
            }
          }
        ];
      }

      messages.push(userMessageObj);
    }

    return messages;
  }

  /**
   * Handle Anthropic-specific message formatting
   * @param {Array} messages - Messages array
   * @param {Object} mediaData - Media data
   * @returns {Array} - Anthropic-formatted messages
   */
  handleAnthropicImageFormatting(messages, mediaData) {
    if (!mediaData || mediaData.type !== 'image') {
      return messages;
    }

    const lastUserMessage = messages[messages.length - 1];
    if (lastUserMessage && lastUserMessage.role === 'user' && Array.isArray(lastUserMessage.content)) {
      // Convert OpenAI format to Anthropic format
      lastUserMessage.content = lastUserMessage.content.map(content => {
        if (content.type === 'image_url') {
          const base64Data = content.image_url.url.split(',')[1];
          const mimeType = content.image_url.url.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
          
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: base64Data
            }
          };
        }
        return content;
      });
    }

    return messages;
  }

  /**
   * Prepare request body for API call
   * @param {Array} messages - Formatted messages
   * @param {Array} formattedTools - Formatted tool definitions
   * @param {String} toolChoice - Tool choice option
   * @param {Object} config - API configuration
   * @param {Boolean} enableStreaming - Whether streaming is enabled
   * @returns {Object} - Request body for API
   */
  prepareRequestBody(messages, formattedTools, toolChoice, config, enableStreaming) {
    const requestBody = {
      model: config.modelName,
      messages: messages,
      max_tokens: config.maxTokens || 16000,
      stream: enableStreaming
    };

    // Add tools if available and not explicitly disabled
    if (toolChoice !== 'none' && formattedTools.length > 0) {
      requestBody.tools = formattedTools;
      
      if (toolChoice === 'auto') {
        requestBody.tool_choice = 'auto';
      } else if (toolChoice && toolChoice !== 'none') {
        requestBody.tool_choice = {
          type: 'function',
          function: { name: toolChoice }
        };
      }
    }

    return requestBody;
  }

  /**
   * Prepare headers for API request
   * @param {Object} config - API configuration
   * @returns {Object} - Request headers
   */
  prepareHeaders(config) {
    const isAnthropicEndpoint = config.llmEndpoint && config.llmEndpoint.includes('anthropic');
    
    const headers = {
      'Content-Type': 'application/json'
    };

    if (isAnthropicEndpoint) {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    return headers;
  }

  /**
   * Check if endpoint is Anthropic
   * @param {String} endpoint - API endpoint URL
   * @returns {Boolean} - True if Anthropic endpoint
   */
  isAnthropicEndpoint(endpoint) {
    return endpoint && endpoint.includes('anthropic');
  }

  /**
   * Add tool result to conversation
   * @param {Array} messages - Current messages
   * @param {Object} toolResult - Tool execution result
   * @returns {Array} - Updated messages
   */
  addToolResult(messages, toolResult) {
    return [...messages, toolResult];
  }

  /**
   * Add assistant message to conversation
   * @param {Array} messages - Current messages
   * @param {String} content - Assistant response content
   * @param {Array} toolCalls - Tool calls made by assistant (optional)
   * @returns {Array} - Updated messages
   */
  addAssistantMessage(messages, content, toolCalls = null) {
    const assistantMessage = {
      role: 'assistant',
      content: content
    };

    if (toolCalls && toolCalls.length > 0) {
      assistantMessage.tool_calls = toolCalls;
    }

    return [...messages, assistantMessage];
  }
}