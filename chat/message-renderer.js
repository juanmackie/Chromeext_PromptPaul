import { errorHandler, ErrorSeverity, ErrorCategory, createError } from '../errorHandler.js';
import { renderMarkdown } from '../utils/markdown.js';

/**
 * Message Renderer
 * Handles message display, formatting, and copy functionality
 * Manages markdown processing, theme-aware styling, and user interactions
 */
export class MessageRenderer {
  constructor(chatArea, showToast, uiManager = null) {
    this.chatArea = chatArea;
    this.showToast = showToast;
    this.uiManager = uiManager;
    this.messageIcons = {
      copyRaw: {
        // Raw/markdown copy icon paths
        // Light theme: standard icon
        // Dark theme: high-contrast "light" icon
        light: 'icons/copy_markdown.png',
        dark: 'icons/light_copy_markdown.png',
      },
      copyFormatted: {
        // Formatted/HTML copy icon paths
        // Light theme: standard icon
        // Dark theme: high-contrast "light" icon
        light: 'icons/copy_formatted.png',
        dark: 'icons/light_copy_formatted.png',
      },
    };
  }

  /**
   * Add a message to the chat area
   * @param {string} sender - Message sender ('User', 'System', 'LLM')
   * @param {string} message - Message content
   * @param {Object} [options={}] - Additional options for message styling
   * @param {boolean} [options.isError=false] - Whether this is an error message
   * @param {boolean} [options.isHelp=false] - Whether this is a help message
   * @param {boolean} [options.isContext=false] - Whether this is a context-loaded notification
   * @param {string} [options.fullContent=''] - The actual content for context-loaded messages
   * @returns {Object} Message elements and unique ID
   */
  addMessage(sender, message, options = {}) {
    const { isError = false, isHelp = false, isContext = false, fullContent = '' } = options;
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    // Default content target is the message div itself, but can be switched
    // to a child element for complex system messages to avoid HierarchyRequestError
    let contentElement = messageDiv;
    let uniqueIdString = '';

    if (sender === 'User') {
      messageDiv.classList.add('user-message', 'hextaui-chat-message', 'hextaui-chat-message-user');
      messageDiv.textContent = 'You: ' + message;
    } else if (sender === 'System') {
      messageDiv.classList.add(
        'system-message',
        'hextaui-chat-message',
        'hextaui-chat-message-system'
      );

      // Add special styling for error and help messages
      if (isError) {
        messageDiv.classList.add('system-error');
        // Set custom styling for error messages
        messageDiv.style.cssText = `
                    background-color: #fef2f2;
                    border-left: 4px solid #dc2626;
                    color: #991b1b;
                    padding: 12px;
                    margin: 8px 0;
                    border-radius: 4px;
                    font-weight: 500;
                `;
        contentElement.innerHTML = renderMarkdown(message || '');
        messageDiv.innerHTML = ''; // Clear textContent
        messageDiv.appendChild(contentElement); // Add processed HTML
      } else if (isHelp) {
        messageDiv.classList.add('system-help');
        // Set custom styling for help messages
        messageDiv.style.cssText = `
                    background-color: #f0fdf4;
                    border-left: 4px solid #16a34a;
                    color: #15803d;
                    padding: 12px;
                    margin: 8px 0;
                    border-radius: 4px;
                    font-weight: 500;
                `;
        contentElement.innerHTML = renderMarkdown(message || '');
        messageDiv.innerHTML = ''; // Clear textContent
        messageDiv.appendChild(contentElement); // Add processed HTML
      } else if (isContext) {
        messageDiv.classList.add('system-context');
        // Set custom styling for context-loaded messages
        messageDiv.style.cssText = `
                  background-color: var(--card);
                  border: 1px solid var(--primary);
                  border-radius: var(--radius-lg);
                  color: var(--foreground);
                  padding: 1rem;
                  margin: 1rem 0;
                  display: flex;
                  flex-direction: column;
                  gap: 0.5rem;
                  box-shadow: var(--shadow-md);
                  animation: slideIn 0.3s ease-out;
              `;

        const header = document.createElement('div');
        header.style.cssText = `
                  display: flex;
                  align-items: center;
                  gap: 0.5rem;
                  color: var(--primary);
                  font-weight: 600;
                  font-size: 0.9rem;
              `;
        header.innerHTML = '<span class="material-icons" style="font-size: 1.2rem;">article</span> Tab Context Loaded';

        const body = document.createElement('div');
        body.style.cssText = `
                  font-size: 0.85rem;
                  color: var(--muted-foreground);
                  line-height: 1.4;
              `;
        body.textContent = message;

        messageDiv.innerHTML = ''; // Clear textContent
        messageDiv.appendChild(header);
        messageDiv.appendChild(body);

        // Add clickable content view if fullContent is provided
        if (fullContent) {
          messageDiv.style.cursor = 'pointer';
          messageDiv.title = 'Click to view loaded content';

          const contentOverlay = document.createElement('div');
          contentOverlay.style.cssText = `
                    display: none;
                    margin-top: 1rem;
                    padding-top: 1rem;
                    border-top: 1px dashed var(--border);
                    font-family: var(--font-mono);
                    font-size: 0.8rem;
                    max-height: 200px;
                    overflow-y: auto;
                    white-space: pre-wrap;
                    color: var(--muted-foreground);
                    background: rgba(0, 0, 0, 0.02);
                `;
          contentOverlay.textContent = fullContent;
          messageDiv.appendChild(contentOverlay);

          const footer = document.createElement('div');
          footer.style.cssText = `
                    margin-top: 0.5rem;
                    font-size: 0.75rem;
                    color: var(--primary);
                    display: flex;
                    align-items: center;
                    gap: 0.25rem;
                `;
          footer.innerHTML =
            '<span class="material-icons" style="font-size: 0.9rem;">expand_more</span> Click to show content';
          messageDiv.appendChild(footer);

          messageDiv.addEventListener('click', () => {
            const isVisible = contentOverlay.style.display === 'block';
            contentOverlay.style.display = isVisible ? 'none' : 'block';
            footer.innerHTML = isVisible
              ? '<span class="material-icons" style="font-size: 0.9rem;">expand_more</span> Click to show content'
              : '<span class="material-icons" style="font-size: 0.9rem;">expand_less</span> Click to hide content';
          });
        }
      } else {
        messageDiv.textContent = 'System: ' + message;
      }
    } else if (sender === 'LLM') {
      const llmResult = this.createLlmMessage(message);
      messageDiv.appendChild(llmResult.contentSpan);
      messageDiv.appendChild(llmResult.copyIcon);
      messageDiv.appendChild(llmResult.copyFormattedIcon);
      messageDiv.classList.add(
        'llm-message',
        'hextaui-chat-message',
        'hextaui-chat-message-assistant'
      );
      contentElement = llmResult.contentSpan;
      uniqueIdString = llmResult.uniqueId;

      if (message) {
        this.attachCopyListeners(
          message,
          contentElement,
          llmResult.copyIcon,
          llmResult.copyFormattedIcon
        );
      }
    } else {
      // Fallback for unknown sender types
      messageDiv.textContent = message;
    }

    this.chatArea.appendChild(messageDiv);

    // Ensure proper scrolling after message is added
    if (this.uiManager && this.uiManager.ensureScrollable) {
      this.uiManager.ensureScrollable();
    }
    this.scrollToBottom();

    return { messageDiv, contentElement, uniqueIdString };
  }

  /**
   * Create LLM-specific message elements
   * @param {string} message - Message content
   * @returns {Object} LLM message elements
   */
  createLlmMessage(message) {
    const llmContentSpan = document.createElement('span');
    llmContentSpan.classList.add('llm-content-area');

    // Process markdown
    llmContentSpan.innerHTML = renderMarkdown(message || '');

    const uniqueId = Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const isDarkTheme = document.body.classList.contains('dark-theme');

    // Create copy icons
    const copyIcon = this.createCopyIcon('copyRaw', uniqueId, isDarkTheme);
    const copyFormattedIcon = this.createCopyIcon('copyFormatted', uniqueId, isDarkTheme);

    return {
      contentSpan: llmContentSpan,
      copyIcon: copyIcon,
      copyFormattedIcon: copyFormattedIcon,
      uniqueId: uniqueId,
    };
  }

  /**
   * Create a copy icon element
   * @param {string} type - Icon type ('copyRaw' or 'copyFormatted')
   * @param {string} uniqueId - Unique identifier for the message
   * @param {boolean} isDarkTheme - Whether dark theme is active
   * @returns {HTMLImageElement} Copy icon element
   */
  createCopyIcon(type, uniqueId, isDarkTheme) {
    const iconConfig = this.messageIcons[type];
    const copyIcon = document.createElement('img');
    copyIcon.id = `${type.replace('copy', 'copy-')}-icon-${uniqueId}`;
    copyIcon.src = isDarkTheme ? iconConfig.dark : iconConfig.light;
    copyIcon.alt = type === 'copyRaw' ? 'Copy Raw' : 'Copy Formatted';
    copyIcon.style.cssText =
      'cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;';
    return copyIcon;
  }

  /**
   * Attach copy event listeners to message elements
   * @param {string} rawMessage - Raw message text
   * @param {HTMLElement} contentElement - Content element for formatted copy
   * @param {HTMLElement} copyIconElement - Copy raw icon element
   * @param {HTMLElement} copyFormattedIconElement - Copy formatted icon element
   */
  async attachCopyListeners(rawMessage, contentElement, copyIconElement, copyFormattedIconElement) {
    // Clone and replace icons to remove existing listeners
    const newCopyIcon = copyIconElement.cloneNode(true);
    if (copyIconElement.parentNode) {
      copyIconElement.parentNode.replaceChild(newCopyIcon, copyIconElement);
    }

    const newFormattedCopyIcon = copyFormattedIconElement.cloneNode(true);
    if (copyFormattedIconElement.parentNode) {
      copyFormattedIconElement.parentNode.replaceChild(
        newFormattedCopyIcon,
        copyFormattedIconElement
      );
    }

    // Raw text copy listener
    newCopyIcon.addEventListener('click', async event => {
      event.stopPropagation();
      await this.copyRawText(rawMessage);
    });

    // Formatted text copy listener
    newFormattedCopyIcon.addEventListener('click', async event => {
      event.stopPropagation();
      await this.copyFormattedText(rawMessage, contentElement);
    });
  }

  /**
   * Copy raw text to clipboard
   * @param {string} text - Text to copy
   */
  async copyRawText(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.showToast('Copied raw text to clipboard');
    } catch (error) {
      await this.handleCopyError('Failed to copy raw text to clipboard', error, {
        messageLength: text?.length,
      });
    }
  }

  /**
   * Copy formatted text to clipboard
   * @param {string} rawMessage - Raw message text
   * @param {HTMLElement} contentElement - Content element with HTML
   */
  async copyFormattedText(rawMessage, contentElement) {
    try {
      const htmlContent = contentElement.innerHTML;
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([htmlContent], { type: 'text/html' }),
          'text/plain': new Blob([rawMessage], { type: 'text/plain' }),
        }),
      ]);
      this.showToast('Copied formatted text to clipboard');
    } catch (error) {
      await this.handleCopyError(
        'Failed to copy formatted text, trying plain text fallback',
        error
      );

      // Fallback to plain text
      try {
        await navigator.clipboard.writeText(rawMessage);
        this.showToast('Copied (plain text fallback) to clipboard');
      } catch (fallbackError) {
        await this.handleCopyError('Failed to copy text in any format', fallbackError, {
          userMessage: 'Clipboard access denied or unavailable',
        });
        this.showToast('Failed to copy text', 'error');
      }
    }
  }

  /**
   * Handle copy errors with consistent error reporting
   * @param {string} message - Error message
   * @param {Error} error - Original error
   * @param {Object} context - Additional context
   */
  async handleCopyError(message, error, context = {}) {
    await errorHandler.handleError(
      createError(message, {
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.LOW,
        originalError: error,
        context,
      })
    );
  }

  /**
   * Update message content (useful for streaming updates)
   * @param {HTMLElement} contentElement - Content element to update
   * @param {string} content - New content
   */
  updateMessageContent(contentElement, content) {
    if (!contentElement) return;

    contentElement.innerHTML = renderMarkdown(content || '');
  }

  /**
   * Scroll chat area to bottom
   * @param {number} delay - Delay before scrolling (default: 10ms)
   */
  scrollToBottom(delay = 10) {
    setTimeout(() => {
      if (this.chatArea) {
        // Ensure smooth scrolling to bottom
        this.chatArea.scrollTo({
          top: this.chatArea.scrollHeight,
          behavior: 'smooth',
        });
      }
    }, delay);
  }

  /**
   * Update icon themes when theme changes
   * @param {boolean} isDarkTheme - Whether dark theme is active
   */
  updateIconThemes(isDarkTheme) {
    // Target copy icons by their known ID prefixes
    const copyIcons = this.chatArea.querySelectorAll(
      'img[id^="copy-Raw-icon-"], img[id^="copy-Formatted-icon-"]'
    );

    copyIcons.forEach(icon => {
      const isFormatted = icon.id.startsWith('copy-Formatted-icon-');
      const iconType = isFormatted ? 'copyFormatted' : 'copyRaw';
      const iconConfig = this.messageIcons[iconType];

      icon.src = isDarkTheme ? iconConfig.dark : iconConfig.light;
    });
  }

  /**
   * Sanitize message content to prevent XSS
   * @param {string} content - Content to sanitize
   * @returns {string} Sanitized content
   */
  sanitizeContent(content) {
    if (!content || typeof content !== 'string') {
      return '';
    }

    // Basic sanitization - remove script tags and dangerous attributes
    return content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  }

  /**
   * Get message statistics
   * @returns {Object} Statistics about rendered messages
   */
  getMessageStats() {
    const messages = this.chatArea.querySelectorAll('.message');
    const userMessages = this.chatArea.querySelectorAll('.user-message');
    const llmMessages = this.chatArea.querySelectorAll('.llm-message');
    const systemMessages = this.chatArea.querySelectorAll('.system-message');

    return {
      total: messages.length,
      user: userMessages.length,
      llm: llmMessages.length,
      system: systemMessages.length,
      hasContent: Array.from(messages).filter(msg => msg.textContent.trim().length > 0).length,
    };
  }

  /**
   * Clear all messages from the chat area
   */
  clearMessages() {
    this.chatArea.innerHTML = '';
  }

  /**
   * Get all message elements
   * @returns {NodeList} All message elements
   */
  getAllMessages() {
    return this.chatArea.querySelectorAll('.message');
  }

  /**
   * Get the last message element
   * @returns {HTMLElement|null} Last message element or null
   */
  getLastMessage() {
    const messages = this.getAllMessages();
    return messages.length > 0 ? messages[messages.length - 1] : null;
  }

  /**
   * Check if chat area is scrolled to bottom
   * @returns {boolean} True if scrolled to bottom
   */
  isScrolledToBottom() {
    const threshold = 50; // pixels from bottom
    return (
      this.chatArea.scrollHeight - this.chatArea.scrollTop <= this.chatArea.clientHeight + threshold
    );
  }

  /**
   * Add CSS class to message for styling
   * @param {HTMLElement} messageElement - Message element
   * @param {string} className - CSS class to add
   */
  addMessageClass(messageElement, className) {
    if (messageElement && className) {
      messageElement.classList.add(className);
    }
  }

  /**
   * Remove CSS class from message
   * @param {HTMLElement} messageElement - Message element
   * @param {string} className - CSS class to remove
   */
  removeMessageClass(messageElement, className) {
    if (messageElement && className) {
      messageElement.classList.remove(className);
    }
  }
}
