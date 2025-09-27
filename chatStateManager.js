// ===== Chat State Management =====

class ChatStateManager {
  constructor() {
    this.conversationHistory = [];
    this.selectedText = null;
    this.tabId = null;
    this.currentStreamingMessageDiv = null;
    this.currentStreamingContentElement = null;
    this.currentStreamingUniqueId = null;
    this.accumulatedStreamedText = "";
    this.activeStreamingToolCall = null;
    this.currentAbortController = null;
    this.currentMediaData = null;
  }

  // Conversation management
  addToHistory(message) {
    this.conversationHistory.push(message);
  }

  getHistory() {
    return this.conversationHistory;
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  // Selected text management
  setSelectedText(text, tabId, fromStartChat = false) {
    this.selectedText = text;
    this.tabId = tabId;
    return { selectedText: text, tabId, fromStartChat };
  }

  getSelectedText() {
    return this.selectedText;
  }

  // Media data management
  setMediaData(mediaData) {
    this.currentMediaData = mediaData;
  }

  getMediaData() {
    return this.currentMediaData;
  }

  clearMediaData() {
    this.currentMediaData = null;
  }

  // Streaming state management
  initializeStreaming(messageDiv, contentElement, uniqueId) {
    this.currentStreamingMessageDiv = messageDiv;
    this.currentStreamingContentElement = contentElement;
    this.currentStreamingUniqueId = uniqueId;
    this.accumulatedStreamedText = "";
  }

  appendStreamedText(text) {
    this.accumulatedStreamedText += text;
  }

  getAccumulatedText() {
    return this.accumulatedStreamedText;
  }

  setActiveToolCall(toolCall) {
    this.activeStreamingToolCall = toolCall;
  }

  getActiveToolCall() {
    return this.activeStreamingToolCall;
  }

  clearActiveToolCall() {
    this.activeStreamingToolCall = null;
  }

  resetStreamingState() {
    this.currentStreamingMessageDiv = null;
    this.currentStreamingContentElement = null;
    this.currentStreamingUniqueId = null;
    this.accumulatedStreamedText = "";
    this.activeStreamingToolCall = null;
  }

  // Abort controller management
  setAbortController(controller) {
    this.currentAbortController = controller;
  }

  abortCurrentRequest() {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  // State queries
  isStreaming() {
    return this.currentStreamingMessageDiv !== null;
  }

  hasMediaData() {
    return this.currentMediaData !== null;
  }

  hasSelectedText() {
    return this.selectedText !== null;
  }

  // Get state snapshot for debugging
  getStateSnapshot() {
    return {
      historyLength: this.conversationHistory.length,
      hasSelectedText: this.hasSelectedText(),
      hasMediaData: this.hasMediaData(),
      isStreaming: this.isStreaming(),
      hasActiveToolCall: this.activeStreamingToolCall !== null,
      tabId: this.tabId
    };
  }
}

export { ChatStateManager };