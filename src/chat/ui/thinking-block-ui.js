/**
 * Thinking Block UI
 * Handles rendering of thinking blocks in chat
 * Implements production-ready coding rules for UI rendering
 *
 * Core Principles:
 * - Input Validation: Validate all thinking block data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient rendering with proper DOM management
 */

import { logger } from '../../shared/index.js';

class ThinkingBlockUI {
  constructor(dependencies) {
    this.logger = dependencies.Logger;
    this.chatArea = null;
    this.currentThinkingBlock = null;
  }

  /**
   * Initializes the thinking block UI
   * @param {HTMLElement} chatArea - Chat area element
   */
  initialize(chatArea) {
    if (!chatArea || !(chatArea instanceof HTMLElement)) {
      throw new Error('Valid chat area element is required');
    }

    this.chatArea = chatArea;
    this.logger.debug('Thinking block UI initialized');
  }

  /**
   * Creates a thinking block
   * @param {Object} options - Thinking block options
   * @returns {HTMLElement} Thinking block element
   */
  createThinkingBlock(options = {}) {
    this.logger.debug('Creating thinking block');

    try {
      // Create thinking block container
      const thinkingBlock = document.createElement('enhanced-thinking-block');
      thinkingBlock.className = 'thinking-block';
      thinkingBlock.setAttribute('streaming', 'true');

      // Set initial content if provided
      if (options.content) {
        thinkingBlock.setAttribute('content', options.content);
      }

      // Set thinking content if provided
      if (options.thinking) {
        thinkingBlock.setAttribute('think', options.thinking);
      }

      // Set answer content if provided
      if (options.answer) {
        thinkingBlock.setAttribute('answer', options.answer);
      }

      // Set token count if provided
      if (options.tokens) {
        thinkingBlock.setAttribute('tokens', options.tokens);
      }

      // Add to chat area
      this.chatArea.appendChild(thinkingBlock);

      // Scroll to bottom
      this.chatArea.scrollTop = this.chatArea.scrollHeight;

      // Set as current thinking block
      this.currentThinkingBlock = thinkingBlock;

      this.logger.debug('Thinking block created successfully');

      return thinkingBlock;
    } catch (error) {
      this.logger.error('Failed to create thinking block', {}, error);
      throw error;
    }
  }

  /**
   * Updates a thinking block
   * @param {HTMLElement} thinkingBlock - Thinking block element
   * @param {Object} updates - Updates to apply
   */
  updateThinkingBlock(thinkingBlock, updates) {
    if (!thinkingBlock || !(thinkingBlock instanceof HTMLElement)) {
      throw new Error('Valid thinking block element is required');
    }

    this.logger.debug('Updating thinking block');

    try {
      // Update content if provided
      if (updates.content !== undefined) {
        thinkingBlock.setAttribute('content', updates.content);
      }

      // Update thinking content if provided
      if (updates.thinking !== undefined) {
        thinkingBlock.setAttribute('think', updates.thinking);
      }

      // Update answer content if provided
      if (updates.answer !== undefined) {
        thinkingBlock.setAttribute('answer', updates.answer);
      }

      // Update token count if provided
      if (updates.tokens !== undefined) {
        thinkingBlock.setAttribute('tokens', updates.tokens);
      }

      // Update streaming state if provided
      if (updates.streaming !== undefined) {
        thinkingBlock.setAttribute('streaming', updates.streaming ? 'true' : 'false');
      }

      // Scroll to bottom
      this.chatArea.scrollTop = this.chatArea.scrollHeight;

      this.logger.debug('Thinking block updated successfully');
    } catch (error) {
      this.logger.error('Failed to update thinking block', {}, error);
      throw error;
    }
  }

  /**
   * Updates the content of the current thinking block
   * @param {string} content - New content
   */
  updateCurrentThinkingBlockContent(content) {
    if (!this.currentThinkingBlock) {
      this.logger.warn('No current thinking block to update');
      return;
    }

    if (!content || typeof content !== 'string') {
      throw new Error('Valid content is required and must be a string');
    }

    try {
      this.currentThinkingBlock.setAttribute('content', content);
      this.chatArea.scrollTop = this.chatArea.scrollHeight;
      this.logger.debug('Current thinking block content updated');
    } catch (error) {
      this.logger.error('Failed to update current thinking block content', {}, error);
      throw error;
    }
  }

  /**
   * Updates the thinking content of the current thinking block
   * @param {string} thinking - New thinking content
   */
  updateCurrentThinkingBlockThinking(thinking) {
    if (!this.currentThinkingBlock) {
      this.logger.warn('No current thinking block to update');
      return;
    }

    if (!thinking || typeof thinking !== 'string') {
      throw new Error('Valid thinking content is required and must be a string');
    }

    try {
      this.currentThinkingBlock.setAttribute('think', thinking);
      this.chatArea.scrollTop = this.chatArea.scrollHeight;
      this.logger.debug('Current thinking block thinking content updated');
    } catch (error) {
      this.logger.error('Failed to update current thinking block thinking content', {}, error);
      throw error;
    }
  }

  /**
   * Updates the answer content of the current thinking block
   * @param {string} answer - New answer content
   */
  updateCurrentThinkingBlockAnswer(answer) {
    if (!this.currentThinkingBlock) {
      this.logger.warn('No current thinking block to update');
      return;
    }

    if (!answer || typeof answer !== 'string') {
      throw new Error('Valid answer content is required and must be a string');
    }

    try {
      this.currentThinkingBlock.setAttribute('answer', answer);
      this.chatArea.scrollTop = this.chatArea.scrollHeight;
      this.logger.debug('Current thinking block answer content updated');
    } catch (error) {
      this.logger.error('Failed to update current thinking block answer content', {}, error);
      throw error;
    }
  }

  /**
   * Updates the token count of the current thinking block
   * @param {number} tokens - New token count
   */
  updateCurrentThinkingBlockTokens(tokens) {
    if (!this.currentThinkingBlock) {
      this.logger.warn('No current thinking block to update');
      return;
    }

    if (typeof tokens !== 'number' || tokens < 0) {
      throw new Error('Valid token count is required and must be a non-negative number');
    }

    try {
      this.currentThinkingBlock.setAttribute('tokens', tokens.toString());
      this.logger.debug('Current thinking block token count updated');
    } catch (error) {
      this.logger.error('Failed to update current thinking block token count', {}, error);
      throw error;
    }
  }

  /**
   * Sets the streaming state of the current thinking block
   * @param {boolean} streaming - Streaming state
   */
  setCurrentThinkingBlockStreaming(streaming) {
    if (!this.currentThinkingBlock) {
      this.logger.warn('No current thinking block to update');
      return;
    }

    try {
      this.currentThinkingBlock.setAttribute('streaming', streaming ? 'true' : 'false');
      this.logger.debug(`Current thinking block streaming state set to: ${streaming}`);
    } catch (error) {
      this.logger.error('Failed to set current thinking block streaming state', {}, error);
      throw error;
    }
  }

  /**
   * Finalizes the current thinking block
   */
  finalizeCurrentThinkingBlock() {
    if (!this.currentThinkingBlock) {
      this.logger.warn('No current thinking block to finalize');
      return;
    }

    try {
      this.currentThinkingBlock.setAttribute('streaming', 'false');
      this.currentThinkingBlock = null;
      this.logger.debug('Current thinking block finalized');
    } catch (error) {
      this.logger.error('Failed to finalize current thinking block', {}, error);
      throw error;
    }
  }

  /**
   * Removes a thinking block
   * @param {HTMLElement} thinkingBlock - Thinking block element to remove
   */
  removeThinkingBlock(thinkingBlock) {
    if (!thinkingBlock || !(thinkingBlock instanceof HTMLElement)) {
      this.logger.warn('Invalid thinking block element provided for removal');
      return;
    }

    try {
      if (thinkingBlock.parentNode) {
        thinkingBlock.parentNode.removeChild(thinkingBlock);
        this.logger.debug('Thinking block removed successfully');
      }

      // Clear current thinking block if it's the one being removed
      if (this.currentThinkingBlock === thinkingBlock) {
        this.currentThinkingBlock = null;
      }
    } catch (error) {
      this.logger.error('Failed to remove thinking block', {}, error);
      throw error;
    }
  }

  /**
   * Removes the current thinking block
   */
  removeCurrentThinkingBlock() {
    if (!this.currentThinkingBlock) {
      this.logger.warn('No current thinking block to remove');
      return;
    }

    try {
      this.removeThinkingBlock(this.currentThinkingBlock);
      this.logger.debug('Current thinking block removed');
    } catch (error) {
      this.logger.error('Failed to remove current thinking block', {}, error);
      throw error;
    }
  }

  /**
   * Gets the current thinking block
   * @returns {HTMLElement|null} Current thinking block element or null if none
   */
  getCurrentThinkingBlock() {
    return this.currentThinkingBlock;
  }

  /**
   * Checks if there is a current thinking block
   * @returns {boolean} True if there is a current thinking block
   */
  hasCurrentThinkingBlock() {
    return this.currentThinkingBlock !== null;
  }

  /**
   * Creates a loading thinking block
   * @returns {HTMLElement} Loading thinking block element
   */
  createLoadingThinkingBlock() {
    this.logger.debug('Creating loading thinking block');

    try {
      const thinkingBlock = this.createThinkingBlock({
        content: 'Thinking...',
        streaming: true
      });

      this.logger.debug('Loading thinking block created successfully');
      return thinkingBlock;
    } catch (error) {
      this.logger.error('Failed to create loading thinking block', {}, error);
      throw error;
    }
  }

  /**
   * Creates an error thinking block
   * @param {string} error - Error message
   * @returns {HTMLElement} Error thinking block element
   */
  createErrorThinkingBlock(error) {
    if (!error || typeof error !== 'string') {
      throw new Error('Valid error message is required and must be a string');
    }

    this.logger.debug('Creating error thinking block');

    try {
      const thinkingBlock = this.createThinkingBlock({
        content: `Error: ${error}`,
        streaming: false
      });

      // Add error styling
      thinkingBlock.style.cssText = 'border-color: #f44336; background-color: #ffebee;';

      this.logger.debug('Error thinking block created successfully');
      return thinkingBlock;
    } catch (renderError) {
      this.logger.error('Failed to create error thinking block', {}, renderError);
      throw renderError;
    }
  }

  /**
   * Clears all thinking blocks
   */
  clearThinkingBlocks() {
    if (!this.chatArea) {
      this.logger.warn('Chat area not initialized');
      return;
    }

    try {
      const thinkingBlocks = this.chatArea.querySelectorAll('enhanced-thinking-block');
      thinkingBlocks.forEach(block => {
        if (block.parentNode) {
          block.parentNode.removeChild(block);
        }
      });

      this.currentThinkingBlock = null;
      this.logger.debug('All thinking blocks cleared');
    } catch (error) {
      this.logger.error('Failed to clear thinking blocks', {}, error);
      throw error;
    }
  }
}

export default ThinkingBlockUI;