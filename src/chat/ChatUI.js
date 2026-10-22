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
import { renderMarkdown } from '../utils/domSanitizer.js';
import { attachCopyListeners, postProcessRenderedContent } from './ChatClipboard.js';
import { updateAnswerCards } from './ChatAnswerRenderer.js';

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
   * Replace a completed assistant bubble with bounded read-only cards while
   * retaining the complete readable Markdown answer behind a native details
   * disclosure. Copy controls remain bound to that fallback text.
   * @param {HTMLElement} messageDiv
   * @param {string} readableText
   * @param {*} answerCards
   * @param {Array} groundingSources
   * @returns {boolean} Whether cards were rendered.
   */
  renderCompletedAnswer(
    messageDiv,
    readableText,
    answerCards,
    groundingSources = [],
    options = {}
  ) {
    if (!messageDiv) return false;
    const contentElement = messageDiv.querySelector('.llm-content-area');
    if (!contentElement) return false;

    const previousFallback = messageDiv.querySelector(':scope > .answer-text-fallback');
    if (previousFallback?.contains(contentElement)) {
      previousFallback.parentNode.insertBefore(contentElement, previousFallback);
    }
    contentElement.innerHTML = this.renderMarkdown(readableText || '');
    postProcessRenderedContent(contentElement);
    const copyIcon = messageDiv.querySelector(':scope > .copy-action-button[id^="copy-icon-"]');
    const uid = copyIcon?.id.slice('copy-icon-'.length);
    const formattedButton = uid
      ? messageDiv.querySelector(`:scope > #copy-formatted-icon-${uid}`)
      : null;
    if (copyIcon && formattedButton) {
      attachCopyListeners(readableText || '', contentElement, copyIcon, formattedButton);
    }
    const previousCards = messageDiv.querySelector(':scope > .answer-cards');
    const cards = updateAnswerCards(previousCards, answerCards, groundingSources);
    if (!cards) previousCards?.remove();
    previousFallback?.remove();
    if (!cards) return false;

    const fallback = document.createElement('details');
    fallback.className = 'answer-text-fallback';
    const label = document.createElement('summary');
    label.textContent = 'Read as text';
    fallback.appendChild(label);
    fallback.appendChild(contentElement);

    const firstAction = messageDiv.querySelector(':scope > .copy-action-button');
    if (cards.parentNode !== messageDiv) messageDiv.insertBefore(cards, firstAction || null);
    messageDiv.insertBefore(fallback, firstAction || null);
    this.addAnswerFollowups(messageDiv, options);

    return true;
  }

  /**
   * Render a valid progressive prefix beside the still-visible readable text.
   * Existing blocks are reconciled in place so the user's open disclosures and
   * comparison controls survive subsequent prefixes.
   * @param {HTMLElement} messageDiv
   * @param {*} answerCards
   * @param {Array} groundingSources
   * @returns {boolean}
   */
  renderProgressiveAnswer(messageDiv, answerCards, groundingSources = []) {
    if (!messageDiv) return false;
    const previousCards = messageDiv.querySelector(':scope > .answer-cards');
    const cards = updateAnswerCards(previousCards, answerCards, groundingSources);
    if (!cards) {
      previousCards?.remove();
      return false;
    }
    const firstAction = messageDiv.querySelector(':scope > .copy-action-button');
    if (cards.parentNode !== messageDiv) messageDiv.insertBefore(cards, firstAction || null);
    return true;
  }

  /** Remove only provisional/terminal card UI, leaving readable Markdown. */
  clearProgressiveAnswer(messageDiv) {
    messageDiv?.querySelector(':scope > .answer-cards')?.remove();
    messageDiv?.querySelector(':scope > .answer-followups')?.remove();
    const fallback = messageDiv?.querySelector(':scope > .answer-text-fallback');
    const content = messageDiv?.querySelector('.llm-content-area');
    if (fallback?.contains(content)) fallback.parentNode.insertBefore(content, fallback);
    fallback?.remove();
  }

  addAnswerFollowups(messageDiv, options = {}) {
    if (!options.followupIdentity || typeof options.onAnswerFollowup !== 'function') return;
    let group = messageDiv.querySelector(':scope > .answer-followups');
    if (!group) {
      group = document.createElement('div');
      group.className = 'answer-followups';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Answer follow-ups');
      for (const followup of [
        { id: 'explain', label: 'Explain key findings' },
        { id: 'tradeoffs', label: 'Compare tradeoffs' },
      ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'answer-followup-button';
        button.dataset.answerFollowup = followup.id;
        button.textContent = followup.label;
        button.title = `${followup.label} using the original answer context`;
        button.addEventListener('click', () =>
          options.onAnswerFollowup(followup.id, options.followupIdentity)
        );
        group.appendChild(button);
      }
      const copyAction = messageDiv.querySelector(':scope > .copy-action-button');
      messageDiv.insertBefore(group, copyAction || null);
    }
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
   * @param {Object} [requestIdentity] - Originating prompt request / context
   *   identity for User messages, bound so Retry/Edit can replay the exact
   *   context the original response used.
   * @returns {Object} - Message element references
   */
  addMessage(sender, message, requestIdentity, presentation = null) {
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
      messageDiv.dataset.prompt = message || '';
      if (requestIdentity) messageDiv.requestIdentity = requestIdentity;
    } else if (sender === 'System') {
      messageDiv.classList.add('system-message');
      messageDiv.textContent = 'System: ' + message;
    } else if (sender === 'LLM') {
      messageDiv.classList.add('llm-message');
      const llmContentSpan = document.createElement('div');
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
        attachCopyListeners(message, contentElement, copyIcon, copyFormattedIcon);
      }
    } else {
      messageDiv.textContent = message;
    }

    this.chatArea.appendChild(messageDiv);
    if (sender === 'LLM' && presentation?.answerCards) {
      this.renderCompletedAnswer(
        messageDiv,
        message || '',
        presentation.answerCards,
        presentation.groundingSources || [],
        presentation
      );
    }
    this.trimExcessMessages();

    setTimeout(() => {
      this.chatArea.scrollTop = this.chatArea.scrollHeight;
    }, 10);

    return { messageDiv, contentElement, uniqueIdString };
  }

  /**
   * Move a rendered message to the end of the chat transcript.
   * This is used when a streaming assistant bubble was created before tool
   * activity but the final answer must appear after that activity.
   * @param {HTMLElement|null} messageDiv - Message container to move.
   * @returns {boolean} Whether the message was moved.
   */
  isNearBottom() {
    if (!this.chatArea) return false;
    return this.chatArea.scrollHeight - this.chatArea.scrollTop - this.chatArea.clientHeight <= 40;
  }

  moveMessageToEnd(messageDiv, { preserveViewport = false, wasNearBottom = null } = {}) {
    if (!this.chatArea || !messageDiv) return false;
    if (messageDiv.parentNode && messageDiv.parentNode !== this.chatArea) return false;
    const previousScrollTop = this.chatArea.scrollTop;
    const nearBottom = typeof wasNearBottom === 'boolean' ? wasNearBottom : this.isNearBottom();
    if (this.chatArea.lastElementChild === messageDiv) {
      if (nearBottom) this.chatArea.scrollTop = this.chatArea.scrollHeight;
      return false;
    }
    const activeElement = document.activeElement;
    const hadFocusedDescendant = messageDiv.contains(activeElement);
    this.chatArea.appendChild(messageDiv);
    if (!preserveViewport || nearBottom) this.chatArea.scrollTop = this.chatArea.scrollHeight;
    else this.chatArea.scrollTop = previousScrollTop;
    if (hadFocusedDescendant && document.activeElement !== activeElement) {
      activeElement.focus?.({ preventScroll: true });
    }
    return true;
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
   * Idempotent: safe to call multiple times.
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
    } else if (mediaData.type === 'text') {
      // Document attachment: bounded text chip with filename and size metadata.
      title.textContent = `Document attached: ${mediaData.name || 'document'}`;
      const detailParts = [];
      if (Number.isFinite(mediaData.lineCount)) {
        detailParts.push(`${mediaData.lineCount} line${mediaData.lineCount === 1 ? '' : 's'}`);
      }
      if (mediaData.truncated) detailParts.push('truncated to fit the context budget');
      detail.textContent = detailParts.length
        ? `${detailParts.join(', ')}: ready for analysis`
        : 'Ready for analysis';
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
  trimExcessMessages(protectedMessage = this.currentStreamingMessageDiv) {
    if (!this.chatArea) return;
    let index = 0;
    while (this.chatArea.children.length > ChatUI.MAX_VISIBLE) {
      const candidate = this.chatArea.children[index];
      if (!candidate) break;
      if (candidate === protectedMessage) {
        index += 1;
        continue;
      }
      this.chatArea.removeChild(candidate);
    }
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
      postProcessRenderedContent(this.currentStreamingContentElement);
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
      postProcessRenderedContent(this.currentStreamingContentElement);
    }
  }
}

// Export singleton instance
const chatUI = new ChatUI();
export { chatUI, ChatUI };
