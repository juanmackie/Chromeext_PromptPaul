import { BaseViewModel } from '../viewmodels/BaseViewModel.js';

/**
 * Chat ViewModel handling chat UI logic
 * Implements the ViewModel pattern for UI logic separation
 */
export class ChatViewModel extends BaseViewModel {
  constructor() {
    super();
    
    // Chat state
    this.state = {
      conversationHistory: [],
      currentStreamingMessage: null,
      currentStreamingContent: null,
      currentStreamingId: null,
      accumulatedStreamedText: "",
      activeStreamingToolCall: null,
      userInputDisabled: false,
      sendButtonDisabled: false,
      currentMediaData: null
    };
  }

  /**
   * Update the view model state
   * @param {Object} newState - New state to apply
   */
  updateState(newState) {
    this.state = { ...this.state, ...newState };
    this.notify(this.state);
  }

  /**
   * Get current view model state
   * @returns {Object} - Current state
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Add a message to the conversation
   * @param {String|Object} sender - Sender of the message (User, System, LLM) or message object
   * @param {String} message - Message content (optional if sender is an object)
   */
  addMessage(sender, message) {
    let newMessage;
    
    // Handle both calling patterns: addMessage(sender, message) and addMessage(messageObject)
    if (typeof sender === 'object' && sender !== null) {
      // Object format from ChatCoordinator
      newMessage = {
        id: this.generateId(),
        sender: String(sender.role || 'unknown'),
        content: this._normalizeContent(sender.content),
        timestamp: sender.timestamp || new Date().toISOString(),
        tool_calls: sender.tool_calls,
        tool_call_id: sender.tool_call_id
      };
    } else {
      // Legacy format (sender, message)
      newMessage = {
        id: this.generateId(),
        sender: String(sender || 'unknown'),
        content: String(message || ''),
        timestamp: new Date().toISOString()
      };
    }
    
    this.state.conversationHistory = [...this.state.conversationHistory, newMessage];
    this.updateState({ conversationHistory: this.state.conversationHistory });
  }

 /**
  * Normalize various content shapes (string | array of parts | object) to a string
  * @param {any} content
  * @returns {string}
  */
 _normalizeContent(content) {
   try {
     if (typeof content === 'string') return content;
     if (Array.isArray(content)) {
       // OpenAI or Anthropic style content blocks
       return content
         .map((c) => {
           if (!c) return '';
           if (typeof c === 'string') return c;
           if (typeof c.text === 'string') return c.text;
           if (c.type === 'text' && typeof c.text === 'string') return c.text;
           if (c.type === 'tool_result' && typeof c.content === 'string') return c.content;
           return '';
         })
         .join('');
     }
     if (content && typeof content === 'object') {
       if (typeof content.text === 'string') return content.text;
       if (typeof content.content === 'string') return content.content;
       return JSON.stringify(content);
     }
     return '';
   } catch (e) {
     console.warn('Failed to normalize content:', e);
     return String(content ?? '');
   }
 }

 /**
   * Clear the chat history
   */
  clearChat() {
    this.state.conversationHistory = [];
    this.state.currentMediaData = null;
    this.updateState({ 
      conversationHistory: this.state.conversationHistory,
      currentMediaData: this.state.currentMediaData
    });
  }

  /**
   * Set media data for analysis
   * @param {Object} mediaData - Media data to analyze
   */
  setMediaData(mediaData) {
    this.state.currentMediaData = mediaData;
    this.updateState({ currentMediaData: this.state.currentMediaData });
  }

  /**
   * Start streaming a response
   */
  startStreaming() {
    this.state.currentStreamingMessage = {
      id: this.generateId(),
      sender: 'LLM',
      content: '',
      timestamp: new Date().toISOString()
    };
    this.state.accumulatedStreamedText = "";
    this.state.userInputDisabled = true;
    this.state.sendButtonDisabled = true;
    
    this.updateState({
      currentStreamingMessage: this.state.currentStreamingMessage,
      accumulatedStreamedText: this.state.accumulatedStreamedText,
      userInputDisabled: this.state.userInputDisabled,
      sendButtonDisabled: this.state.sendButtonDisabled
    });
  }

  /**
   * Add a chunk to the streaming response
   * @param {String} chunk - Text chunk to add
   */
  addStreamingChunk(chunk) {
    this.state.accumulatedStreamedText += chunk;
    this.updateState({ accumulatedStreamedText: this.state.accumulatedStreamedText });
  }

  /**
   * End streaming response
   */
  endStreaming() {
    // Add the final message to conversation history
    if (this.state.currentStreamingMessage && this.state.accumulatedStreamedText) {
      const finalMessage = {
        ...this.state.currentStreamingMessage,
        content: this.state.accumulatedStreamedText
      };
      
      this.state.conversationHistory = [...this.state.conversationHistory, finalMessage];
    }
    
    // Reset streaming state
    this.state.currentStreamingMessage = null;
    this.state.currentStreamingContent = null;
    this.state.currentStreamingId = null;
    this.state.accumulatedStreamedText = "";
    this.state.userInputDisabled = false;
    this.state.sendButtonDisabled = false;
    
    this.updateState({
      conversationHistory: this.state.conversationHistory,
      currentStreamingMessage: this.state.currentStreamingMessage,
      currentStreamingContent: this.state.currentStreamingContent,
      currentStreamingId: this.state.currentStreamingId,
      accumulatedStreamedText: this.state.accumulatedStreamedText,
      userInputDisabled: this.state.userInputDisabled,
      sendButtonDisabled: this.state.sendButtonDisabled
    });
  }

  /**
   * Set user input disabled state
   * @param {Boolean} disabled - Whether input should be disabled
   */
  setUserInputDisabled(disabled) {
    this.state.userInputDisabled = disabled;
    this.updateState({ userInputDisabled: this.state.userInputDisabled });
  }

  /**
   * Set send button disabled state
   * @param {Boolean} disabled - Whether button should be disabled
   */
  setSendButtonDisabled(disabled) {
    this.state.sendButtonDisabled = disabled;
    this.updateState({ sendButtonDisabled: this.state.sendButtonDisabled });
  }

  /**
   * Update streaming message content (called by ChatCoordinator)
   * @param {String} content - Current accumulated content
   */
  updateStreamingMessage(content) {
    if (!this.state.currentStreamingMessage) {
      this.startStreaming();
    }
    this.state.accumulatedStreamedText = content;
    this.updateState({ accumulatedStreamedText: this.state.accumulatedStreamedText });
  }

  /**
   * Finalize streaming message (called by ChatCoordinator)
   */
  finalizeStreamingMessage() {
    this.endStreaming();
  }

  /**
   * Generate a unique ID
   * @returns {String} - Unique ID
   */
  generateId() {
    return 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }
}