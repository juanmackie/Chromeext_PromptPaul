/**
 * Streaming Handler
 * Handles streaming API responses for chat functionality
 * Implements production-ready coding rules for streaming handling
 *
 * Core Principles:
 * - Input Validation: Validate all streaming data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient streaming with proper resource management
 */

import { logger } from '../../shared/index.js';

class StreamingHandler {
  constructor(dependencies) {
    this.logger = dependencies.Logger;
    this.activeStreamings = new Map();
    this.defaultTimeout = 30000; // 30 seconds
  }

  /**
   * Starts a streaming session
   * @param {string} requestId - Unique request ID
   * @param {Object} options - Streaming options
   * @returns {Object} Streaming session object
   */
  startStreaming(requestId, options = {}) {
    if (!requestId || typeof requestId !== 'string') {
      throw new Error('Valid request ID is required and must be a string');
    }

    this.logger.debug(`Starting streaming session: ${requestId}`);

    try {
      // Check if streaming already exists for this request
      if (this.activeStreamings.has(requestId)) {
        throw new Error(`Streaming session already exists for request: ${requestId}`);
      }

      // Create streaming session
      const session = {
        id: requestId,
        content: '',
        thinkingContent: '',
        answerContent: '',
        isStreaming: true,
        startTime: Date.now(),
        options: {
          timeout: options.timeout || this.defaultTimeout,
          onChunk: options.onChunk || (() => {}),
          onComplete: options.onComplete || (() => {}),
          onError: options.onError || (() => {}),
          onThinking: options.onThinking || (() => {}),
          onAnswer: options.onAnswer || (() => {}),
          ...options
        }
      };

      // Store session
      this.activeStreamings.set(requestId, session);

      // Set timeout
      session.timeoutId = setTimeout(() => {
        this.handleStreamingTimeout(requestId);
      }, session.options.timeout);

      this.logger.debug(`Streaming session started: ${requestId}`);

      return session;
    } catch (error) {
      this.logger.error(`Failed to start streaming session: ${requestId}`, {}, error);
      throw error;
    }
  }

  /**
   * Handles a streaming chunk
   * @param {string} requestId - Request ID
   * @param {Object} chunk - Streaming chunk
   */
  handleChunk(requestId, chunk) {
    if (!requestId || typeof requestId !== 'string') {
      throw new Error('Valid request ID is required and must be a string');
    }

    if (!chunk || typeof chunk !== 'object') {
      throw new Error('Valid chunk object is required');
    }

    const session = this.activeStreamings.get(requestId);
    if (!session) {
      this.logger.warn(`No active streaming session for request: ${requestId}`);
      return;
    }

    try {
      // Extract content from chunk
      const content = chunk.choices?.[0]?.delta?.content || '';
      
      if (!content) {
        return; // Skip empty chunks
      }

      // Add to content
      session.content += content;

      // Call chunk callback
      session.options.onChunk(content);

      // Check for thinking tags with improved parsing
      this.processThinkingTags(session);

      this.logger.debug(`Chunk processed for streaming session: ${requestId}`, {
        contentLength: content.length,
        totalLength: session.content.length
      });
    } catch (error) {
      this.logger.error(`Failed to handle chunk for streaming session: ${requestId}`, {}, error);
      this.handleStreamingError(requestId, error);
    }
  }

  /**
   * Processes thinking tags in content
   * @param {Object} session - Streaming session
   */
  processThinkingTags(session) {
    try {
      const content = session.content;
      
      // Check for thinking tags - support all formats
      const thinkingStartTag1 = '<thinking>';
      const thinkingEndTag1 = '</thinking>';
      const thinkingStartTag2 = '◁think▷';
      const thinkingEndTag2 = '◁/think▷';
      const thinkingEndTag3 = '◁/thinking▷';
      
      // Find the last occurrence of either start tag
      const thinkingStartIndex1 = content.lastIndexOf(thinkingStartTag1);
      const thinkingStartIndex2 = content.lastIndexOf(thinkingStartTag2);
      const thinkingStartIndex = Math.max(thinkingStartIndex1, thinkingStartIndex2);
      
      // Determine which tag format we're using
      const usingFormat1 = thinkingStartIndex === thinkingStartIndex1;
      const thinkingStartTag = usingFormat1 ? thinkingStartTag1 : thinkingStartTag2;
      
      // For end tags, we need to check all possible end tags
      let thinkingEndIndex = -1;
      let thinkingEndTag = '';
      
      if (usingFormat1) {
        // Using traditional format, look for traditional end tag
        thinkingEndIndex = content.lastIndexOf(thinkingEndTag1);
        thinkingEndTag = thinkingEndTag1;
      } else {
        // Using new format, look for either new end tag
        const endIndex2 = content.lastIndexOf(thinkingEndTag2);
        const endIndex3 = content.lastIndexOf(thinkingEndTag3);
        
        if (endIndex2 > endIndex3) {
          thinkingEndIndex = endIndex2;
          thinkingEndTag = thinkingEndTag2;
        } else {
          thinkingEndIndex = endIndex3;
          thinkingEndTag = thinkingEndTag3;
        }
      }
      
      // If we have a complete thinking block
      if (thinkingStartIndex !== -1 && thinkingEndIndex !== -1 && thinkingEndIndex > thinkingStartIndex) {
        const thinkingContent = content.substring(
          thinkingStartIndex + thinkingStartTag.length,
          thinkingEndIndex
        );
        
        const answerContent = content.substring(thinkingEndIndex + thinkingEndTag.length);
        
        // Update thinking and answer content
        session.thinkingContent = thinkingContent;
        session.answerContent = answerContent;
        
        // Call callbacks
        session.options.onThinking(thinkingContent);
        session.options.onAnswer(answerContent);
      }
      // If we have an incomplete thinking block (currently streaming thinking)
      else if (thinkingStartIndex !== -1) {
        const thinkingContent = content.substring(thinkingStartIndex + thinkingStartTag.length);
        
        // Update thinking content
        session.thinkingContent = thinkingContent;
        
        // Call thinking callback
        session.options.onThinking(thinkingContent);
      }
      // If we have content after a thinking block or no thinking tags
      else {
        // If we previously had thinking content, this is answer content
        if (session.thinkingContent) {
          // Extract content after the last thinking tag
          const lastThinkingEnd = content.lastIndexOf(thinkingEndTag);
          if (lastThinkingEnd !== -1) {
            const answerContent = content.substring(lastThinkingEnd + thinkingEndTag.length);
            session.answerContent = answerContent;
            session.options.onAnswer(answerContent);
          }
        } else {
          // No thinking content, treat everything as answer
          session.answerContent = content;
          session.options.onAnswer(content);
        }
      }
    } catch (error) {
      this.logger.error('Failed to process thinking tags', {}, error);
    }
  }

  /**
   * Completes a streaming session
   * @param {string} requestId - Request ID
   */
  completeStreaming(requestId) {
    if (!requestId || typeof requestId !== 'string') {
      throw new Error('Valid request ID is required and must be a string');
    }

    const session = this.activeStreamings.get(requestId);
    if (!session) {
      this.logger.warn(`No active streaming session for request: ${requestId}`);
      return;
    }

    try {
      // Clear timeout
      if (session.timeoutId) {
        clearTimeout(session.timeoutId);
      }

      // Update session
      session.isStreaming = false;
      session.endTime = Date.now();
      session.duration = session.endTime - session.startTime;

      // Call complete callback
      session.options.onComplete(session);

      // Remove from active sessions
      this.activeStreamings.delete(requestId);

      this.logger.debug(`Streaming session completed: ${requestId}`, {
        duration: session.duration,
        contentLength: session.content.length
      });
    } catch (error) {
      this.logger.error(`Failed to complete streaming session: ${requestId}`, {}, error);
      throw error;
    }
  }

  /**
   * Handles a streaming error
   * @param {string} requestId - Request ID
   * @param {Error} error - Error object
   */
  handleStreamingError(requestId, error) {
    if (!requestId || typeof requestId !== 'string') {
      throw new Error('Valid request ID is required and must be a string');
    }

    const session = this.activeStreamings.get(requestId);
    if (!session) {
      this.logger.warn(`No active streaming session for request: ${requestId}`);
      return;
    }

    try {
      // Clear timeout
      if (session.timeoutId) {
        clearTimeout(session.timeoutId);
      }

      // Update session
      session.isStreaming = false;
      session.endTime = Date.now();
      session.duration = session.endTime - session.startTime;
      session.error = error;

      // Call error callback
      session.options.onError(error);

      // Remove from active sessions
      this.activeStreamings.delete(requestId);

      this.logger.error(`Streaming session error: ${requestId}`, {
        duration: session.duration,
        error: error.message
      }, error);
    } catch (callbackError) {
      this.logger.error(`Error in streaming error callback: ${requestId}`, {}, callbackError);
    }
  }

  /**
   * Handles a streaming timeout
   * @param {string} requestId - Request ID
   */
  handleStreamingTimeout(requestId) {
    this.logger.warn(`Streaming session timeout: ${requestId}`);

    const timeoutError = new Error(`Streaming session timed out after ${this.defaultTimeout}ms`);
    this.handleStreamingError(requestId, timeoutError);
  }

  /**
   * Gets an active streaming session
   * @param {string} requestId - Request ID
   * @returns {Object|null} Streaming session or null if not found
   */
  getStreamingSession(requestId) {
    if (!requestId || typeof requestId !== 'string') {
      return null;
    }

    return this.activeStreamings.get(requestId) || null;
  }

  /**
   * Gets all active streaming sessions
   * @returns {Array} Array of active streaming sessions
   */
  getActiveStreamingSessions() {
    return Array.from(this.activeStreamings.values());
  }

  /**
   * Cancels a streaming session
   * @param {string} requestId - Request ID
   * @returns {boolean} True if cancelled, false if not found
   */
  cancelStreaming(requestId) {
    if (!requestId || typeof requestId !== 'string') {
      throw new Error('Valid request ID is required and must be a string');
    }

    const session = this.activeStreamings.get(requestId);
    if (!session) {
      this.logger.warn(`No active streaming session to cancel: ${requestId}`);
      return false;
    }

    try {
      // Clear timeout
      if (session.timeoutId) {
        clearTimeout(session.timeoutId);
      }

      // Update session
      session.isStreaming = false;
      session.endTime = Date.now();
      session.duration = session.endTime - session.startTime;
      session.cancelled = true;

      // Call complete callback with cancelled flag
      session.options.onComplete({ ...session, cancelled: true });

      // Remove from active sessions
      this.activeStreamings.delete(requestId);

      this.logger.debug(`Streaming session cancelled: ${requestId}`, {
        duration: session.duration,
        contentLength: session.content.length
      });

      return true;
    } catch (error) {
      this.logger.error(`Failed to cancel streaming session: ${requestId}`, {}, error);
      throw error;
    }
  }

  /**
   * Cancels all active streaming sessions
   */
  cancelAllStreaming() {
    this.logger.debug('Cancelling all active streaming sessions');

    const requestIds = Array.from(this.activeStreamings.keys());
    let cancelledCount = 0;

    for (const requestId of requestIds) {
      try {
        if (this.cancelStreaming(requestId)) {
          cancelledCount++;
        }
      } catch (error) {
        this.logger.error(`Failed to cancel streaming session: ${requestId}`, {}, error);
      }
    }

    this.logger.debug(`Cancelled ${cancelledCount} streaming sessions`);
    return cancelledCount;
  }

  /**
   * Sets up message listeners for streaming
   */
  setupMessageListeners() {
    // Listen for streaming start
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'streamApiStart') {
        this.handleStreamStartMessage(message, sendResponse);
        return true; // Keep message channel open for async response
      }
    });

    // Listen for streaming response chunks
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'streamApiResponseChunk') {
        this.handleStreamChunkMessage(message);
        return false; // No response needed
      }
    });

    // Listen for streaming end
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'streamApiEnd') {
        this.handleStreamEndMessage(message);
        return false; // No response needed
      }
    });

    // Listen for streaming errors
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'streamApiError') {
        this.handleStreamErrorMessage(message);
        return false; // No response needed
      }
    });

    this.logger.debug('Streaming message listeners set up');
  }

  /**
   * Handles stream start message
   * @param {Object} message - Message object
   * @param {Function} sendResponse - Response function
   */
  handleStreamStartMessage(message, sendResponse) {
    this.logger.debug(`Handling stream start message: ${message.requestId}`);

    try {
      // Start streaming session
      this.startStreaming(message.requestId, {
        onChunk: (content) => {
          // Send to UI for display
          chrome.runtime.sendMessage({
            action: 'streamChunkToUI',
            requestId: message.requestId,
            content
          }).catch(() => {
            // Ignore if no one is listening
          });
        },
        onComplete: (session) => {
          // Send completion to UI
          chrome.runtime.sendMessage({
            action: 'streamCompleteToUI',
            requestId: message.requestId,
            session
          }).catch(() => {
            // Ignore if no one is listening
          });
        },
        onError: (error) => {
          // Send error to UI
          chrome.runtime.sendMessage({
            action: 'streamErrorToUI',
            requestId: message.requestId,
            error: error.message
          }).catch(() => {
            // Ignore if no one is listening
          });
        }
      });

      sendResponse({ success: true });
    } catch (error) {
      this.logger.error(`Failed to handle stream start message: ${message.requestId}`, {}, error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handles stream chunk message
   * @param {Object} message - Message object
   */
  handleStreamChunkMessage(message) {
    this.handleChunk(message.requestId, { choices: [{ delta: { content: message.chunk } }] });
  }

  /**
   * Handles stream end message
   * @param {Object} message - Message object
   */
  handleStreamEndMessage(message) {
    this.completeStreaming(message.requestId);
  }

  /**
   * Handles stream error message
   * @param {Object} message - Message object
   */
  handleStreamErrorMessage(message) {
    this.handleStreamingError(message.requestId, new Error(message.error));
  }
}

export default StreamingHandler;