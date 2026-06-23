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
import { escapeHtml, renderMarkdown } from '../utils/domSanitizer.js';

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

  renderMarkdown(message) {
    return renderMarkdown(message);
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
      llmContentSpan.innerHTML = this.renderMarkdown(message || '');
      messageDiv.appendChild(llmContentSpan);
      contentElement = llmContentSpan;
      uniqueIdString = Date.now() + '_' + Math.random().toString(36).substring(2, 9);

      // --- Icon for copying raw text ---
      const copyIcon = document.createElement('button');
      copyIcon.id = `copy-icon-${uniqueIdString}`;
      copyIcon.type = 'button';
      copyIcon.className = 'copy-action-button';
      copyIcon.title = 'Copy As Raw text';
      copyIcon.setAttribute('aria-label', 'Copy As Raw text');
      copyIcon.textContent = 'Copy As Raw text';
      messageDiv.appendChild(copyIcon);

      // --- Icon for copying formatted text ---
      const copyFormattedIcon = document.createElement('button');
      copyFormattedIcon.id = `copy-formatted-icon-${uniqueIdString}`;
      copyFormattedIcon.type = 'button';
      copyFormattedIcon.className = 'copy-action-button';
      copyFormattedIcon.title = 'Copy As Formatted Text';
      copyFormattedIcon.setAttribute('aria-label', 'Copy As Formatted Text');
      copyFormattedIcon.textContent = 'Copy As Formatted Text';
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
   * Lazily create (or return) the collapsible reasoning panel for an LLM bubble.
   * The panel is prepended inside the bubble, above the `.llm-content-area`.
   * @param {HTMLElement} messageDiv - The LLM message container
   * @returns {HTMLElement|null} The `.reasoning-content` element to stream into
   */
  ensureReasoningPanel(messageDiv) {
    if (!messageDiv) return null;

    const existing = messageDiv.querySelector('.reasoning-content');
    if (existing) return existing;

    const details = document.createElement('details');
    details.className = 'reasoning-section';
    details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'reasoning-summary';
    summary.textContent = 'Thinking…';
    details.appendChild(summary);

    const content = document.createElement('div');
    content.className = 'reasoning-content';
    details.appendChild(content);

    // Insert above the answer content area (which is the first child for LLM bubbles).
    messageDiv.insertBefore(details, messageDiv.firstChild);
    return content;
  }

  /**
   * Collapse the reasoning panel and replace its summary with an elapsed-time label.
   * Idempotent — safe to call multiple times.
   * @param {HTMLElement} messageDiv
   * @param {number|null} elapsedMs
   */
  finalizeReasoningPanel(messageDiv, elapsedMs) {
    if (!messageDiv) return;
    const details = messageDiv.querySelector('.reasoning-section');
    if (!details || details.dataset.finalized === 'true') return;

    const summary = details.querySelector('.reasoning-summary');
    if (summary) {
      if (typeof elapsedMs === 'number' && elapsedMs >= 0) {
        const seconds = Math.max(1, Math.round(elapsedMs / 1000));
        summary.textContent = `Thought for ${seconds}s`;
      } else {
        summary.textContent = 'Thought process';
      }
    }
    details.open = false;
    details.dataset.finalized = 'true';
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
    const info = document.createElement('div');
    info.className = 'loaded-content-info';
    const strong = document.createElement('strong');
    strong.textContent = 'Content loaded from: ';
    info.appendChild(strong);
    info.appendChild(document.createTextNode(sourceInfo));
    header.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'loaded-content-actions';

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'loaded-content-body';
    bodyDiv.textContent = fullContent;

    container.appendChild(header);
    container.appendChild(bodyDiv);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-content-btn';
    copyBtn.title = 'Copy full content';
    copyBtn.textContent = 'Copy';
    actions.appendChild(copyBtn);

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'expand-toggle-btn';
    expandBtn.textContent = 'Expand';
    actions.appendChild(expandBtn);

    header.appendChild(actions);

    const expandLabel = expandBtn;

    let isExpanded = false;

    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isExpanded = !isExpanded;

      if (isExpanded) {
        bodyDiv.classList.add('expanded');
        expandBtn.textContent = 'Collapse';
      } else {
        bodyDiv.classList.remove('expanded');
        expandBtn.textContent = 'Expand';
      }

      setTimeout(() => {
        this.chatArea.scrollTop = this.chatArea.scrollHeight;
      }, 10);
    });

    const copyLabel = copyBtn;

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

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 10px;';

    const title = document.createElement('strong');
    const detail = document.createElement('small');

    if (mediaData.type === 'image') {
      const img = document.createElement('img');
      img.src = `data:${mediaData.mimeType};base64,${mediaData.base64}`;
      img.alt = 'Image for analysis';
      img.style.cssText = 'max-width: 200px; max-height: 150px; border-radius: 4px;';
      row.appendChild(img);
      title.textContent = 'Image Analysis';
      detail.textContent = 'Right-clicked image ready for analysis';
    } else if (mediaData.type === 'video') {
      const video = document.createElement('video');
      video.src = `data:${mediaData.mimeType};base64,${mediaData.base64}`;
      video.alt = 'Video for analysis';
      video.controls = true;
      video.style.cssText = 'max-width: 200px; max-height: 150px; border-radius: 4px;';
      row.appendChild(video);
      title.textContent = 'Video Analysis';
      detail.textContent = 'Right-clicked video ready for analysis';
    } else if (mediaData.type === 'audio') {
      const audio = document.createElement('audio');
      audio.src = `data:${mediaData.mimeType};base64,${mediaData.base64}`;
      audio.controls = true;
      audio.style.cssText = 'width: 200px;';
      row.appendChild(audio);
      title.textContent = 'Audio Analysis';
      detail.textContent = 'Right-clicked audio ready for analysis';
    }

    const copy = document.createElement('div');
    copy.appendChild(title);
    copy.appendChild(document.createElement('br'));
    copy.appendChild(detail);
    row.appendChild(copy);
    previewDiv.appendChild(row);

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
    // Briefly flash a confirmation label/state on the clicked button, then revert.
    const flashButtonState = (button, message, stateClass) => {
      const originalLabel = (button.dataset.copyLabel ||= button.textContent);
      if (button._copyResetTimer) clearTimeout(button._copyResetTimer);
      button.textContent = message;
      button.classList.add(stateClass);
      button._copyResetTimer = setTimeout(() => {
        button.textContent = originalLabel;
        button.classList.remove('copied', 'copy-error');
      }, 1500);
    };

    newCopyIcon.addEventListener('click', async function (event) {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(rawMessage);
        flashButtonState(newCopyIcon, 'Copied!', 'copied');
        loadingManager.showToast('Copied raw text to clipboard', 'success');
      } catch (err) {
        console.error('Failed to copy raw text: ', err);
        flashButtonState(newCopyIcon, 'Copy failed', 'copy-error');
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
        flashButtonState(newFormattedCopyIcon, 'Copied!', 'copied');
        loadingManager.showToast('Copied formatted text to clipboard', 'success');
      } catch (err) {
        console.error('Failed to copy formatted text: ', err);
        try {
          await navigator.clipboard.writeText(rawMessage);
          flashButtonState(newFormattedCopyIcon, 'Copied!', 'copied');
          loadingManager.showToast('Copied (plain text fallback) to clipboard', 'success');
        } catch (errFallback) {
          console.error('Failed to copy plain text fallback: ', errFallback);
          flashButtonState(newFormattedCopyIcon, 'Copy failed', 'copy-error');
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
      this.currentStreamingContentElement.innerHTML = this.renderMarkdown(content);
      this.postProcessRenderedContent(this.currentStreamingContentElement);
      this.chatArea.scrollTop = this.chatArea.scrollHeight;
    }
  }

  /** Get current streaming content element */
  getCurrentStreamingElement() {
    return this.currentStreamingContentElement;
  }

  /** Set current streaming element */
  setCurrentStreamingElement(element) {
    this.currentStreamingContentElement = element;
  }

  /** Get current streaming unique ID */
  getCurrentStreamingUniqueId() {
    return this.currentStreamingUniqueId;
  }

  /** Set current streaming unique ID */
  setCurrentStreamingUniqueId(id) {
    this.currentStreamingUniqueId = id;
  }

  /** Get accumulated streamed text */
  getAccumulatedText() {
    return this.currentStreamingContentElement?.innerHTML || '';
  }

  /** Set accumulated streamed text */
  setAccumulatedText(text) {
    if (this.currentStreamingContentElement) {
      this.currentStreamingContentElement.innerHTML = this.renderMarkdown(text);
      this.postProcessRenderedContent(this.currentStreamingContentElement);
    }
  }
}

// Export singleton instance
const chatUI = new ChatUI();
export { chatUI, ChatUI };
