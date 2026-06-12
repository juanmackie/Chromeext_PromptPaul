/**
 * @fileoverview Chat Stream Module - Handles streaming state management
 *
 * Responsibilities:
 * - Streaming UI state management
 * - API call state tracking
 * - Conversation history management (in-memory, per side-panel instance)
 *
 * @module ChatStream
 */

import { renderMarkdown } from '../utils/domSanitizer.js';

/**
 * Stream state manager - tracks streaming and API call state.
 * Each side panel instance owns its own in-memory state; Chrome destroys
 * the panel page on tab switch, so no cross-tab persistence is needed.
 */
export class StreamStateManager {
  constructor() {
    // Streaming UI state
    this.currentStreamingMessageDiv = null;
    this.currentStreamingContentElement = null;
    this.currentStreamingUniqueId = null;
    this.accumulatedStreamedText = '';
    this.activeStreamingToolCall = null;

    // Streaming render buffer — accumulates deltas and flushes at 60fps
    this._renderBuffer = '';
    this._renderQueued = false;
    this._lastScrollTop = 0;
    this._chatAreaRef = null;

    // API call state
    this.currentRunId = null;
    this.currentSourceTabId = null;
    this.currentMediaData = null;

    this.conversationHistory = [];
  }

  /**
   * Set a reference to the chat area element for scroll handling.
   * @param {HTMLElement} element
   */
  setChatAreaRef(element) {
    this._chatAreaRef = element;
  }

  /**
   * Queue a content delta for batched rendering via requestAnimationFrame.
   * Multiple deltas within a 16ms frame are coalesced into a single DOM write.
   * @param {string} delta
   */
  queueRenderChunk(delta) {
    this._renderBuffer += delta;
    if (!this._renderQueued) {
      this._renderQueued = true;
      requestAnimationFrame(() => this._flushRender());
    }
  }

  _flushRender() {
    this._renderQueued = false;
    const el = this.currentStreamingContentElement;
    if (!el || !this._renderBuffer) return;

    this.accumulatedStreamedText += this._renderBuffer;
    this._renderBuffer = '';
    el.innerHTML = renderMarkdown(this.accumulatedStreamedText);
    if (this._chatAreaRef) {
      this._chatAreaRef.scrollTop = this._chatAreaRef.scrollHeight;
    }
  }

  /**
   * Reset all streaming state
   */
  resetStreamingState() {
    this.currentStreamingMessageDiv = null;
    this.currentStreamingContentElement = null;
    this.currentStreamingUniqueId = null;
    this.accumulatedStreamedText = '';
    this.activeStreamingToolCall = null;
    this._renderBuffer = '';
    this._renderQueued = false;
  }

  /**
   * Reset all API call state
   */
  resetApiState() {
    this.currentRunId = null;
    this.currentSourceTabId = null;
    this.currentMediaData = null;
  }

  /**
   * Reset all state.
   */
  resetAll() {
    this.resetStreamingState();
    this.resetApiState();
    this.conversationHistory = [];
  }

  /**
   * Set current streaming message elements
   * @param {HTMLElement} messageDiv - Message container element
   * @param {HTMLElement} contentElement - Content element
   * @param {string} uniqueId - Unique message ID
   */
  setStreamingElements(messageDiv, contentElement, uniqueId) {
    this.currentStreamingMessageDiv = messageDiv;
    this.currentStreamingContentElement = contentElement;
    this.currentStreamingUniqueId = uniqueId;
  }

  /**
   * Create streaming elements and set them in one call.
   * @param {HTMLElement} messageDiv
   * @param {HTMLElement} contentElement
   * @param {string} uniqueId
   */
  initStreamingElements(messageDiv, contentElement, uniqueId) {
    this.setStreamingElements(messageDiv, contentElement, uniqueId);
    this.clearStreamedText();
    this.appendStreamedText('');
  }

  clearStreamingElements() {
    this.setStreamingElements(null, null, null);
  }

  /**
   * Get current streaming message div
   * @returns {HTMLElement|null}
   */
  getCurrentStreamingMessageDiv() {
    return this.currentStreamingMessageDiv;
  }

  /**
   * Get current streaming content element
   * @returns {HTMLElement|null}
   */
  getCurrentStreamingContentElement() {
    return this.currentStreamingContentElement;
  }

  /**
   * Get current streaming unique ID
   * @returns {string|null}
   */
  getCurrentStreamingUniqueId() {
    return this.currentStreamingUniqueId;
  }

  /**
   * Append text to accumulated stream
   * @param {string} text - Text to append
   */
  appendStreamedText(text) {
    this.accumulatedStreamedText += text;
  }

  /**
   * Get accumulated streamed text
   * @returns {string} - Accumulated text
   */
  getStreamedText() {
    return this.accumulatedStreamedText;
  }

  /**
   * Clear accumulated streamed text
   */
  clearStreamedText() {
    this.accumulatedStreamedText = '';
  }

  /**
   * Set active streaming tool call
   * @param {Object} toolCall - Tool call object
   */
  setActiveToolCall(toolCall) {
    this.activeStreamingToolCall = toolCall;
  }

  /**
   * Get active streaming tool call
   * @returns {Object|null} - Active tool call or null
   */
  getActiveToolCall() {
    return this.activeStreamingToolCall;
  }

  /**
   * Clear active tool call
   */
  clearActiveToolCall() {
    this.activeStreamingToolCall = null;
  }

  /**
   * Set current run ID
   * @param {string} runId - Run ID
   */
  setRunId(runId) {
    this.currentRunId = runId;
  }

  /**
   * Get current run ID
   * @returns {string|null} - Current run ID
   */
  getRunId() {
    return this.currentRunId;
  }

  /**
   * Set current source tab ID
   * @param {number} tabId - Tab ID
   */
  setSourceTabId(tabId) {
    this.currentSourceTabId = tabId;
  }

  /**
   * Get current source tab ID
   * @returns {number|null} - Current source tab ID
   */
  getSourceTabId() {
    return this.currentSourceTabId;
  }

  /**
   * Set current media data.
   * @param {Object} mediaData - Media data object
   */
  setMediaData(mediaData) {
    this.currentMediaData = mediaData;
  }

  /**
   * Get current media data
   * @returns {Object|null} - Current media data
   */
  getMediaData() {
    return this.currentMediaData;
  }

  /**
   * Clear current media data.
   */
  clearMediaData() {
    this.currentMediaData = null;
  }

  /**
   * Add message to conversation history.
   * @param {Object} message - Message object { role, content }
   */
  addMessageToHistory(message) {
    this.conversationHistory.push(message);
  }

  /**
   * Get conversation history
   * @returns {Array} - Conversation history
   */
  getConversationHistory() {
    return this.conversationHistory;
  }

  /**
   * Clear conversation history.
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Set conversation history.
   * @param {Array} history - Conversation history
   */
  setConversationHistory(history) {
    this.conversationHistory = history;
  }
}
