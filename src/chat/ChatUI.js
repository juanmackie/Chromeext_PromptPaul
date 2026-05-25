/**
 * @fileoverview Chat UI Module - Handles all UI rendering and DOM manipulation
 *
 * Responsibilities:
 * - Message rendering and display
 * - Media preview rendering
 * - Chat area management
 * - DOM element references and manipulation
 *
 * @module ChatUI
 * @requires ../../loadingManager.js
 */

import { loadingManager } from '../../loadingManager.js';

/**
 * ChatUI class - Manages all UI operations for the chat interface
 */
class ChatUI {
  constructor() {
    this.chatArea = null;
    this.chatMainArea = null;
    this.oneoffInstructionArea = null;
    this.attachmentStrip = null;
    this.attachmentThumbnail = null;
    this.attachmentTitle = null;
    this.attachmentDetails = null;
    this.attachmentRemoveButton = null;
    this.userInput = null;
    this.sendButton = null;
    this.clearButton = null;
    this.currentStreamingMessageDiv = null;
    this.currentStreamingContentElement = null;
    this.currentStreamingUniqueId = null;
  }

  /**
   * Initialize UI references after DOM is loaded
   */
  initialize() {
    this.chatArea = document.getElementById('chat-area');
    this.chatMainArea = document.getElementById('chat-main-area');
    this.oneoffInstructionArea = document.getElementById('oneoff-instruction-area');
    this.attachmentStrip = document.getElementById('attachment-strip');
    this.attachmentThumbnail = document.getElementById('attachment-thumbnail');
    this.attachmentTitle = document.getElementById('attachment-title');
    this.attachmentDetails = document.getElementById('attachment-details');
    this.attachmentRemoveButton = document.getElementById('attachment-remove-button');
    this.userInput = document.getElementById('user-input');
    this.sendButton = document.getElementById('send-button');
    this.clearButton = document.getElementById('clear-button');
  }

  /**
   * Show chat area and hide one-off instruction area
   */
  showChatArea() {
    if (this.chatMainArea) this.chatMainArea.style.display = 'block';
    if (this.oneoffInstructionArea) this.oneoffInstructionArea.style.display = 'none';
  }

  /**
   * Show one-off instruction area and hide chat area
   */
  showOneOffArea() {
    if (this.chatMainArea) this.chatMainArea.style.display = 'none';
    if (this.oneoffInstructionArea) this.oneoffInstructionArea.style.display = 'block';
  }

  /**
   * Add a message to the chat area
   * @param {string} sender - 'User', 'Assistant', or 'System'
   * @param {string} message - Message content (can contain Markdown)
   * @returns {Object} - Message element references
   */
  addMessage(sender, message) {
    // Ensure chat area is initialized
    if (!this.chatArea) {
      this.chatArea = document.getElementById('chat-area');
    }
    if (!this.chatArea) {
      console.error('ChatUI: chat-area element not found');
      return { messageDiv: null, contentElement: null, uniqueIdString: '' };
    }

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    let contentElement = messageDiv;
    let uniqueIdString = '';

    if (sender === 'User') {
      messageDiv.classList.add('user-message');
      messageDiv.textContent = 'You: ' + message;
    } else if (sender === 'System') {
      messageDiv.classList.add('system-message');
      messageDiv.textContent = 'System: ' + message;
    } else if (sender === 'LLM') {
      messageDiv.classList.add('llm-message');
      const llmContentSpan = document.createElement('span');
      llmContentSpan.classList.add('llm-content-area');
      // Ensure marked.parse is available or handle potential errors
      if (typeof marked !== 'undefined') {
        llmContentSpan.innerHTML = marked.parse(message || '');
      } else {
        llmContentSpan.textContent = message || '';
      }
      messageDiv.appendChild(llmContentSpan);
      contentElement = llmContentSpan;
      uniqueIdString = Date.now() + '_' + Math.random().toString(36).substring(2, 9);

      // --- Icon for copying raw text ---
      const copyIcon = document.createElement('img');
      copyIcon.id = `copy-icon-${uniqueIdString}`;
      copyIcon.src = document.body.classList.contains('dark-theme')
        ? 'icons/light-copy-markdown.png'
        : 'icons/copy-markdown.png';
      copyIcon.alt = 'Copy Raw';
      copyIcon.style.cssText =
        'cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;';
      messageDiv.appendChild(copyIcon);

      // --- Icon for copying formatted text ---
      const copyFormattedIcon = document.createElement('img');
      copyFormattedIcon.id = `copy-formatted-icon-${uniqueIdString}`;
      const formattedIconSrc = document.body.classList.contains('dark-theme')
        ? 'icons/light-copy-formatted.png'
        : 'icons/copy-formatted.png';
      copyFormattedIcon.src = formattedIconSrc;
      copyFormattedIcon.alt = 'Copy Formatted';
      copyFormattedIcon.style.cssText =
        'cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;';
      messageDiv.appendChild(copyFormattedIcon);

      if (message) {
        this.attachCopyListeners(message, contentElement, copyIcon, copyFormattedIcon);
      }
    } else {
      messageDiv.textContent = message;
    }

    this.chatArea.appendChild(messageDiv);
    this.trimExcessMessages();

    setTimeout(() => {
      this.chatArea.scrollTop = this.chatArea.scrollHeight;
    }, 10);

    return { messageDiv, contentElement, uniqueIdString };
  }

  /**
   * Creates an expandable message for loaded tab content
   * @param {string} sourceInfo - Formatted source information
   * @param {string} fullContent - The complete extracted content
   * @returns {HTMLElement} - The created container element
   */
  addLoadedContentMessage(sourceInfo, fullContent) {
    if (!this.chatArea) {
      this.chatArea = document.getElementById('chat-area');
    }
    if (!this.chatArea) return null;

    const container = document.createElement('div');
    container.className = 'message system-message loaded-content-container';

    const header = document.createElement('div');
    header.className = 'loaded-content-header';
    header.innerHTML = `
      <div class="loaded-content-info">
        📄 <strong>Content loaded from:</strong> ${sourceInfo}
      </div>
      <div class="loaded-content-actions">
        <button class="copy-content-btn" title="Copy full content">
          <span class="material-icons" style="font-size: 14px;">content_copy</span>
          <span class="copy-label">Copy</span>
        </button>
        <button class="expand-toggle-btn">
          <span class="material-icons" style="font-size: 16px;">expand_more</span>
          <span class="expand-label">Expand</span>
        </button>
      </div>
    `;

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'loaded-content-body';
    bodyDiv.textContent = fullContent;

    container.appendChild(header);
    container.appendChild(bodyDiv);

    const expandBtn = header.querySelector('.expand-toggle-btn');
    const expandLabel = expandBtn.querySelector('.expand-label');
    const expandIcon = expandBtn.querySelector('.material-icons');

    let isExpanded = false;

    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isExpanded = !isExpanded;

      if (isExpanded) {
        bodyDiv.classList.add('expanded');
        expandLabel.textContent = 'Collapse';
        expandIcon.textContent = 'expand_less';
      } else {
        bodyDiv.classList.remove('expanded');
        expandLabel.textContent = 'Expand';
        expandIcon.textContent = 'expand_more';
      }

      setTimeout(() => {
        this.chatArea.scrollTop = this.chatArea.scrollHeight;
      }, 10);
    });

    const copyBtn = header.querySelector('.copy-content-btn');
    const copyLabel = copyBtn.querySelector('.copy-label');

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard
        .writeText(fullContent)
        .then(() => {
          copyBtn.classList.add('copied');
          copyLabel.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyLabel.textContent = 'Copy';
          }, 2000);
        })
        .catch((err) => {
          console.error('Failed to copy:', err);
          copyLabel.textContent = 'Error';
          setTimeout(() => {
            copyLabel.textContent = 'Copy';
          }, 2000);
        });
    });

    header.addEventListener('click', () => {
      expandBtn.click();
    });

    this.chatArea.appendChild(container);
    this.trimExcessMessages();

    setTimeout(() => {
      this.chatArea.scrollTop = this.chatArea.scrollHeight;
    }, 10);

    return container;
  }

  /**
   * Add media preview to chat area
   * @param {Object} mediaData - Media data object
   */
  addMediaPreview(mediaData) {
    if (!this.chatArea) {
      this.chatArea = document.getElementById('chat-area');
    }
    if (!this.chatArea) return;

    const previewDiv = document.createElement('div');
    previewDiv.classList.add('message', 'system-message');
    previewDiv.style.cssText =
      'background: var(--ext-muted); border-left: 4px solid var(--ext-primary); margin-bottom: 10px; color: var(--ext-muted-foreground);';

    if (mediaData.type === 'image') {
      previewDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <img src="data:${mediaData.mimeType};base64,${mediaData.base64}"
               style="max-width: 200px; max-height: 150px; border-radius: 4px;"
               alt="Image for analysis">
          <div>
            <strong>📷 Image Analysis</strong><br>
            <small>Right-clicked image ready for analysis</small>
          </div>
        </div>
      `;
    } else if (mediaData.type === 'video') {
      previewDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <video src="data:${mediaData.mimeType};base64,${mediaData.base64}"
                 style="max-width: 200px; max-height: 150px; border-radius: 4px;"
                 controls>
          </video>
          <div>
            <strong>🎥 Video Analysis</strong><br>
            <small>Right-clicked video ready for analysis</small>
          </div>
        </div>
      `;
    } else if (mediaData.type === 'audio') {
      previewDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <audio src="data:${mediaData.mimeType};base64,${mediaData.base64}"
                 style="width: 200px;"
                 controls>
          </audio>
          <div>
            <strong>🎵 Audio Analysis</strong><br>
            <small>Right-clicked audio ready for analysis</small>
          </div>
        </div>
      `;
    }

    this.chatArea.appendChild(previewDiv);
    this.trimExcessMessages();
    this.chatArea.scrollTop = this.chatArea.scrollHeight;
  }

  /**
   * Show a pending attachment preview in the input area.
   * @param {Object} mediaData - Media data object
   * @param {Function} onRemove - Remove callback
   */
  setAttachmentPreview(mediaData, onRemove) {
    if (!this.attachmentStrip) {
      this.attachmentStrip = document.getElementById('attachment-strip');
      this.attachmentThumbnail = document.getElementById('attachment-thumbnail');
      this.attachmentTitle = document.getElementById('attachment-title');
      this.attachmentDetails = document.getElementById('attachment-details');
      this.attachmentRemoveButton = document.getElementById('attachment-remove-button');
    }

    if (!this.attachmentStrip) return;

    const label = mediaData?.name || 'Pasted image';
    const details = 'Add any prompt or question, then press Send';
    const previewUrl =
      mediaData?.previewUrl ||
      (mediaData?.base64 && mediaData?.mimeType
        ? `data:${mediaData.mimeType};base64,${mediaData.base64}`
        : '');

    if (this.attachmentThumbnail) {
      this.attachmentThumbnail.src = previewUrl;
      this.attachmentThumbnail.alt = label;
    }
    if (this.attachmentTitle) {
      this.attachmentTitle.textContent = label;
    }
    if (this.attachmentDetails) {
      this.attachmentDetails.textContent = details;
    }
    if (this.attachmentRemoveButton) {
      this.attachmentRemoveButton.onclick = typeof onRemove === 'function' ? onRemove : null;
    }

    this.attachmentStrip.hidden = false;
  }

  /**
   * Clear the pending attachment preview from the input area.
   */
  clearAttachmentPreview() {
    if (!this.attachmentStrip) {
      this.attachmentStrip = document.getElementById('attachment-strip');
      this.attachmentThumbnail = document.getElementById('attachment-thumbnail');
      this.attachmentTitle = document.getElementById('attachment-title');
      this.attachmentDetails = document.getElementById('attachment-details');
      this.attachmentRemoveButton = document.getElementById('attachment-remove-button');
    }

    if (!this.attachmentStrip) return;

    this.attachmentStrip.hidden = true;
    if (this.attachmentThumbnail) {
      this.attachmentThumbnail.src = '';
      this.attachmentThumbnail.alt = 'Pasted image preview';
    }
    if (this.attachmentTitle) {
      this.attachmentTitle.textContent = 'Image attached';
    }
    if (this.attachmentDetails) {
      this.attachmentDetails.textContent = 'Ready to send';
    }
    if (this.attachmentRemoveButton) {
      this.attachmentRemoveButton.onclick = null;
    }
  }

  /** Maximum messages kept in the DOM for performance */
  static MAX_VISIBLE = 100;

  /**
   * Clear the chat area
   */
  clearChat() {
    if (this.chatArea) {
      this.chatArea.innerHTML = '';
    }
    this._messageCount = 0;
    loadingManager.showToast('Chat history cleared', 'info');
  }

  /**
   * Trim oldest message elements from the DOM when count exceeds MAX_VISIBLE.
   * Does NOT affect streamState conversation history (only DOM nodes).
   */
  trimExcessMessages() {
    if (!this.chatArea) return;
    while (this.chatArea.children.length > ChatUI.MAX_VISIBLE) {
      const first = this.chatArea.firstChild;
      if (first) this.chatArea.removeChild(first);
    }
  }

  /**
   * Attach click event listeners to copy icons
   * @param {string} rawMessage - Raw text message to copy
   * @param {HTMLElement} contentElement - Element containing formatted content
   * @param {HTMLElement} copyIconElement - Copy icon for plain text
   * @param {HTMLElement} copyFormattedIconElement - Copy icon for formatted text
   */
  attachCopyListeners(rawMessage, contentElement, copyIconElement, copyFormattedIconElement) {
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
    newCopyIcon.addEventListener('click', async function (event) {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(rawMessage);
        loadingManager.showToast('Copied raw text to clipboard', 'success');
      } catch (err) {
        console.error('Failed to copy raw text: ', err);
        loadingManager.showToast('Error copying raw text.', 'error');
      }
    });
    newFormattedCopyIcon.addEventListener('click', async function (event) {
      event.stopPropagation();
      const htmlContent = contentElement.innerHTML;
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([htmlContent], { type: 'text/html' }),
            'text/plain': new Blob([rawMessage], { type: 'text/plain' }),
          }),
        ]);
        loadingManager.showToast('Copied formatted text to clipboard', 'success');
      } catch (err) {
        console.error('Failed to copy formatted text: ', err);
        try {
          await navigator.clipboard.writeText(rawMessage);
          loadingManager.showToast('Copied (plain text fallback) to clipboard', 'success');
        } catch (errFallback) {
          console.error('Failed to copy plain text fallback: ', errFallback);
          loadingManager.showToast('Error copying text.', 'error');
        }
      }
    });
  }

  /**
   * Post-process rendered HTML to add copy buttons to code blocks.
   * Called automatically after `marked.parse()` content is inserted.
   * @param {HTMLElement} container - Element containing rendered markdown
   */
  postProcessRenderedContent(container) {
    if (!container) return;

    const codeBlocks = container.querySelectorAll('pre code');
    codeBlocks.forEach((codeBlock) => {
      const pre = codeBlock.parentElement;
      // Avoid adding multiple wrappers
      if (pre.parentElement.classList.contains('code-block-wrapper')) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-code-btn';
      copyBtn.innerHTML = '<span class="copy-code-label">Copy</span>';
      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const text = codeBlock.textContent;
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.querySelector('.copy-code-label').textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.querySelector('.copy-code-label').textContent = 'Copy';
          }, 2000);
        } catch (err) {
          console.error('Failed to copy code block:', err);
          copyBtn.querySelector('.copy-code-label').textContent = 'Error';
          setTimeout(() => {
            copyBtn.querySelector('.copy-code-label').textContent = 'Copy';
          }, 2000);
        }
      });

      wrapper.appendChild(copyBtn);
    });
  }
  setStreamingState(isStreaming) {
    if (this.userInput) {
      this.userInput.disabled = isStreaming;
    }
    if (this.sendButton) {
      this.sendButton.disabled = isStreaming;
    }
    if (this.clearButton) {
      this.clearButton.textContent = isStreaming ? 'Stop' : 'Clear';
    }
  }

  /**
   * Reset streaming UI state
   */
  resetStreamingState() {
    this.currentStreamingMessageDiv = null;
    this.currentStreamingContentElement = null;
    this.currentStreamingUniqueId = null;
    this.setStreamingState(false);
    if (this.userInput) {
      this.userInput.focus();
    }
  }

  /**
   * Update streaming content
   * @param {string} content - New content to append
   */
  updateStreamingContent(content) {
    if (this.currentStreamingContentElement && content) {
      this.currentStreamingContentElement.innerHTML = marked.parse(content);
      this.postProcessRenderedContent(this.currentStreamingContentElement);
      this.chatArea.scrollTop = this.chatArea.scrollHeight;
    }
  }

  /**
   * Get current streaming content element
   * @returns {HTMLElement|null}
   */
  getCurrentStreamingElement() {
    return this.currentStreamingContentElement;
  }

  /**
   * Set current streaming element
   * @param {HTMLElement} element
   */
  setCurrentStreamingElement(element) {
    this.currentStreamingContentElement = element;
  }

  /**
   * Get current streaming unique ID
   * @returns {string}
   */
  getCurrentStreamingUniqueId() {
    return this.currentStreamingUniqueId;
  }

  /**
   * Set current streaming unique ID
   * @param {string} id
   */
  setCurrentStreamingUniqueId(id) {
    this.currentStreamingUniqueId = id;
  }

  /**
   * Get accumulated streamed text
   * @returns {string}
   */
  getAccumulatedText() {
    return this.currentStreamingContentElement?.innerHTML || '';
  }

  /**
   * Set accumulated streamed text
   * @param {string} text
   */
  setAccumulatedText(text) {
    if (this.currentStreamingContentElement) {
      this.currentStreamingContentElement.innerHTML = marked.parse(text);
      this.postProcessRenderedContent(this.currentStreamingContentElement);
    }
  }
}

// Export singleton instance
const chatUI = new ChatUI();
export { chatUI, ChatUI };
