/**
 * @fileoverview Chat Stream Module - Handles streaming state management
 *
 * Responsibilities:
 * - Streaming UI state management
 * - API call state tracking
 * - Conversation history management
 *
 * @module ChatStream
 */

/**
 * Stream state manager - tracks streaming and API call state
 */
export class StreamStateManager {
  constructor() {
    // Streaming UI state
    this.currentStreamingMessageDiv = null;
    this.currentStreamingContentElement = null;
    this.currentStreamingUniqueId = null;
    this.accumulatedStreamedText = '';
    this.activeStreamingToolCall = null;

    // API call state
    this.currentRunId = null;
    this.currentSourceTabId = null;
    this.currentMediaData = null;

    // Conversation history
    this.conversationHistory = [];
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
   * Reset all state
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
   * Set current media data
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
   * Clear current media data
   */
  clearMediaData() {
    this.currentMediaData = null;
  }

  /**
   * Add message to conversation history
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
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Set conversation history
   * @param {Array} history - Conversation history
   */
  setConversationHistory(history) {
    this.conversationHistory = history;
  }
}
