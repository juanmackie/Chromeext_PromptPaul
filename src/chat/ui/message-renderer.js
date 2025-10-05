/**
 * Message Renderer
 * Handles rendering of chat messages
 * Implements production-ready coding rules for UI rendering
 *
 * Core Principles:
 * - Input Validation: Validate all message data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient rendering with proper DOM management
 */

import { logger } from '../../shared/index.js';

class MessageRenderer {
  constructor(dependencies) {
    this.logger = dependencies.Logger;
    this.chatArea = null;
    this.marked = null;
  }

  /**
   * Initializes the message renderer
   * @param {HTMLElement} chatArea - Chat area element
   */
  initialize(chatArea) {
    if (!chatArea || !(chatArea instanceof HTMLElement)) {
      throw new Error('Valid chat area element is required');
    }

    this.chatArea = chatArea;
    
    // Load marked.js for markdown parsing
    this.loadMarked().then(marked => {
      this.marked = marked;
    }).catch(error => {
      this.logger.error('Failed to load marked.js', {}, error);
    });

    this.logger.debug('Message renderer initialized');
  }

  /**
   * Loads marked.js for markdown parsing
   * @returns {Promise<Object>} Marked instance
   */
  async loadMarked() {
    return new Promise((resolve, reject) => {
      if (typeof marked !== 'undefined') {
        resolve(marked);
        return;
      }

      const script = document.createElement('script');
      script.src = 'marked.min.js';
      script.onload = () => {
        if (typeof marked !== 'undefined') {
          resolve(marked);
        } else {
          reject(new Error('marked.js loaded but not available globally'));
        }
      };
      script.onerror = () => reject(new Error('Failed to load marked.js'));
      document.head.appendChild(script);
    });
  }

  /**
   * Renders a message in the chat area
   * @param {string} sender - Message sender ('User', 'LLM', 'System')
   * @param {string} content - Message content
   * @param {Object} options - Rendering options
   * @returns {Object} Message elements
   */
  renderMessage(sender, content, options = {}) {
    if (!sender || typeof sender !== 'string') {
      throw new Error('Valid sender is required');
    }

    if (!content || typeof content !== 'string') {
      throw new Error('Valid content is required');
    }

    this.logger.debug(`Rendering message from ${sender}`, { contentLength: content.length });

    try {
      // Create message container
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message';
      
      // Add sender-specific class
      if (sender.toLowerCase() === 'user') {
        messageDiv.classList.add('user-message');
      } else if (sender.toLowerCase() === 'llm') {
        messageDiv.classList.add('llm-message');
      } else {
        messageDiv.classList.add('system-message');
      }

      // Create header with sender and timestamp
      const header = this.createMessageHeader(sender, options.timestamp);
      messageDiv.appendChild(header);

      // Create content container
      const contentContainer = this.createContentContainer(content, options);
      messageDiv.appendChild(contentContainer);

      // Add actions if applicable
      if (options.showActions && (sender.toLowerCase() === 'llm' || sender.toLowerCase() === 'system')) {
        const actionsContainer = this.createActionsContainer(options);
        messageDiv.appendChild(actionsContainer);
      }

      // Add to chat area
      this.chatArea.appendChild(messageDiv);

      // Scroll to bottom
      this.chatArea.scrollTop = this.chatArea.scrollHeight;

      this.logger.debug(`Message rendered successfully from ${sender}`);

      return {
        messageDiv,
        contentContainer,
        header,
        actions: options.showActions ? actionsContainer : null
      };
    } catch (error) {
      this.logger.error(`Failed to render message from ${sender}`, { sender, contentLength: content.length }, error);
      throw error;
    }
  }

  /**
   * Creates a message header
   * @param {string} sender - Message sender
   * @param {Date|string} timestamp - Message timestamp
   * @returns {HTMLElement} Header element
   */
  createMessageHeader(sender, timestamp) {
    const header = document.createElement('div');
    header.className = 'message-header';

    // Create sender element
    const senderElement = document.createElement('span');
    senderElement.className = 'message-sender';
    senderElement.textContent = sender;
    header.appendChild(senderElement);

    // Create timestamp element
    const timestampElement = document.createElement('span');
    timestampElement.className = 'message-timestamp';
    
    let timestampText;
    if (timestamp) {
      if (timestamp instanceof Date) {
        timestampText = timestamp.toLocaleTimeString();
      } else if (typeof timestamp === 'string') {
        timestampText = timestamp;
      } else {
        timestampText = new Date().toLocaleTimeString();
      }
    } else {
      timestampText = new Date().toLocaleTimeString();
    }
    
    timestampElement.textContent = timestampText;
    header.appendChild(timestampElement);

    return header;
  }

  /**
   * Creates a content container
   * @param {string} content - Message content
   * @param {Object} options - Content options
   * @returns {HTMLElement} Content container element
   */
  createContentContainer(content, options = {}) {
    const contentContainer = document.createElement('div');
    contentContainer.className = 'message-content';

    // Handle different content types
    if (options.isHtml) {
      contentContainer.innerHTML = content;
    } else if (options.isMarkdown && this.marked) {
      contentContainer.innerHTML = this.marked.parse(content);
    } else {
      contentContainer.textContent = content;
    }

    // Add unique ID if provided
    if (options.id) {
      contentContainer.id = options.id;
    }

    return contentContainer;
  }

  /**
   * Creates an actions container
   * @param {Object} options - Actions options
   * @returns {HTMLElement} Actions container element
   */
  createActionsContainer(options = {}) {
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'message-actions';

    // Create copy button
    if (options.showCopy !== false) {
      const copyButton = this.createCopyButton(options.content, options.id);
      actionsContainer.appendChild(copyButton);
    }

    // Create copy formatted button
    if (options.showCopyFormatted !== false) {
      const copyFormattedButton = this.createCopyFormattedButton(options.content, options.id);
      actionsContainer.appendChild(copyFormattedButton);
    }

    return actionsContainer;
  }

  /**
   * Creates a copy button
   * @param {string} content - Content to copy
   * @param {string} id - Message ID
   * @returns {HTMLElement} Copy button element
   */
  createCopyButton(content, id) {
    const button = document.createElement('button');
    button.className = 'copy-button';
    button.textContent = '📋 Copy';
    button.title = 'Copy message';

    const buttonId = id ? `copy-icon-${id}` : `copy-icon-${Date.now()}`;
    button.id = buttonId;

    button.addEventListener('click', () => {
      this.copyToClipboard(content, button);
    });

    return button;
  }

  /**
   * Creates a copy formatted button
   * @param {string} content - Content to copy
   * @param {string} id - Message ID
   * @returns {HTMLElement} Copy formatted button element
   */
  createCopyFormattedButton(content, id) {
    const button = document.createElement('button');
    button.className = 'copy-formatted-button';
    button.textContent = '✨ Copy Formatted';
    button.title = 'Copy formatted message';

    const buttonId = id ? `copy-formatted-icon-${id}` : `copy-formatted-icon-${Date.now()}`;
    button.id = buttonId;

    button.addEventListener('click', () => {
      this.copyFormattedToClipboard(content, button);
    });

    return button;
  }

  /**
   * Copies text to clipboard
   * @param {string} text - Text to copy
   * @param {HTMLElement} button - Button element
   */
  async copyToClipboard(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      this.showCopySuccess(button);
    } catch (error) {
      this.logger.error('Failed to copy to clipboard', {}, error);
      this.showCopyError(button);
    }
  }

  /**
   * Copies formatted text to clipboard
   * @param {string} text - Text to copy
   * @param {HTMLElement} button - Button element
   */
  async copyFormattedToClipboard(text, button) {
    try {
      // Create temporary element to get HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = this.marked ? this.marked.parse(text) : text;
      
      // Get both HTML and plain text
      const htmlContent = tempDiv.innerHTML;
      const plainText = tempDiv.textContent || text;

      // Use ClipboardItem if available
      if (window.ClipboardItem) {
        const clipboardItem = new ClipboardItem({
          'text/html': new Blob([htmlContent], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' })
        });
        
        await navigator.clipboard.write([clipboardItem]);
      } else {
        // Fallback to plain text
        await navigator.clipboard.writeText(plainText);
      }
      
      this.showCopySuccess(button);
    } catch (error) {
      this.logger.error('Failed to copy formatted to clipboard', {}, error);
      this.showCopyError(button);
    }
  }

  /**
   * Shows copy success feedback
   * @param {HTMLElement} button - Button element
   */
  showCopySuccess(button) {
    const originalText = button.textContent;
    button.textContent = '✓ Copied';
    button.classList.add('success');
    
    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('success');
    }, 2000);
  }

  /**
   * Shows copy error feedback
   * @param {HTMLElement} button - Button element
   */
  showCopyError(button) {
    const originalText = button.textContent;
    button.textContent = '✗ Failed';
    button.classList.add('error');
    
    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('error');
    }, 2000);
  }

  /**
   * Updates a message content
   * @param {HTMLElement} contentContainer - Content container element
   * @param {string} content - New content
   * @param {Object} options - Update options
   */
  updateMessage(contentContainer, content, options = {}) {
    if (!contentContainer || !(contentContainer instanceof HTMLElement)) {
      throw new Error('Valid content container element is required');
    }

    if (!content || typeof content !== 'string') {
      throw new Error('Valid content is required');
    }

    try {
      if (options.isHtml) {
        contentContainer.innerHTML = content;
      } else if (options.isMarkdown && this.marked) {
        contentContainer.innerHTML = this.marked.parse(content);
      } else {
        contentContainer.textContent = content;
      }

      // Scroll to bottom if requested
      if (options.scrollToBottom !== false) {
        this.chatArea.scrollTop = this.chatArea.scrollHeight;
      }

      this.logger.debug('Message updated successfully');
    } catch (error) {
      this.logger.error('Failed to update message', {}, error);
      throw error;
    }
  }

  /**
   * Clears all messages
   */
  clearMessages() {
    if (!this.chatArea) {
      this.logger.warn('Chat area not initialized');
      return;
    }

    try {
      this.chatArea.innerHTML = '';
      this.logger.debug('All messages cleared');
    } catch (error) {
      this.logger.error('Failed to clear messages', {}, error);
      throw error;
    }
  }

  /**
   * Attaches copy listeners to existing message elements
   * @param {string} content - Message content
   * @param {HTMLElement} contentElement - Content element
   * @param {HTMLElement} copyIcon - Copy icon element
   * @param {HTMLElement} copyFormattedIcon - Copy formatted icon element
   */
  attachCopyListeners(content, contentElement, copyIcon, copyFormattedIcon) {
    if (copyIcon) {
      copyIcon.addEventListener('click', () => {
        this.copyToClipboard(content, copyIcon);
      });
    }

    if (copyFormattedIcon) {
      copyFormattedIcon.addEventListener('click', () => {
        this.copyFormattedToClipboard(content, copyFormattedIcon);
      });
    }
  }
}

export default MessageRenderer;