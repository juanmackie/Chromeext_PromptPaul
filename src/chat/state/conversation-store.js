/**
 * Conversation Store
 * Manages conversation history and state
 * Implements production-ready coding rules for state management
 *
 * Core Principles:
 * - Input Validation: Validate all conversation data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient state management with proper persistence
 */

import { logger } from '../../shared/index.js';

class ConversationStore {
  constructor(dependencies) {
    this.logger = dependencies.Logger;
    this.storage = dependencies.Storage;
    this.conversations = new Map();
    this.currentConversationId = null;
    this.maxConversations = 50;
    this.maxMessagesPerConversation = 100;
  }

  /**
   * Initializes the conversation store
   */
  async initialize() {
    this.logger.debug('Initializing conversation store');

    try {
      // Load conversations from storage
      await this.loadConversations();

      this.logger.debug('Conversation store initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize conversation store', {}, error);
      throw error;
    }
  }

  /**
   * Loads conversations from storage
   */
  async loadConversations() {
    try {
      const result = await this.storage.get(['conversations', 'currentConversationId']);
      const conversations = result.conversations || [];
      const currentConversationId = result.currentConversationId || null;

      // Load conversations into memory
      this.conversations.clear();
      for (const conversation of conversations) {
        this.conversations.set(conversation.id, conversation);
      }

      // Set current conversation
      this.currentConversationId = currentConversationId;

      this.logger.debug(`Loaded ${conversations.length} conversations from storage`);
    } catch (error) {
      this.logger.error('Failed to load conversations from storage', {}, error);
      throw error;
    }
  }

  /**
   * Saves conversations to storage
   */
  async saveConversations() {
    try {
      const conversations = Array.from(this.conversations.values());
      
      await this.storage.set({
        conversations,
        currentConversationId: this.currentConversationId
      });

      this.logger.debug(`Saved ${conversations.length} conversations to storage`);
    } catch (error) {
      this.logger.error('Failed to save conversations to storage', {}, error);
      throw error;
    }
  }

  /**
   * Creates a new conversation
   * @param {Object} options - Conversation options
   * @returns {string} Conversation ID
   */
  createConversation(options = {}) {
    this.logger.debug('Creating new conversation');

    try {
      const conversationId = this.generateConversationId();
      const now = new Date().toISOString();

      const conversation = {
        id: conversationId,
        title: options.title || 'New Conversation',
        messages: [],
        createdAt: now,
        updatedAt: now,
        metadata: options.metadata || {}
      };

      // Add to conversations
      this.conversations.set(conversationId, conversation);

      // Set as current conversation
      this.currentConversationId = conversationId;

      // Save to storage
      this.saveConversations().catch(error => {
        this.logger.error('Failed to save new conversation to storage', {}, error);
      });

      this.logger.debug(`New conversation created: ${conversationId}`);

      return conversationId;
    } catch (error) {
      this.logger.error('Failed to create new conversation', {}, error);
      throw error;
    }
  }

  /**
   * Gets a conversation by ID
   * @param {string} conversationId - Conversation ID
   * @returns {Object|null} Conversation object or null if not found
   */
  getConversation(conversationId) {
    if (!conversationId || typeof conversationId !== 'string') {
      return null;
    }

    return this.conversations.get(conversationId) || null;
  }

  /**
   * Gets the current conversation
   * @returns {Object|null} Current conversation object or null if none
   */
  getCurrentConversation() {
    if (!this.currentConversationId) {
      return null;
    }

    return this.getConversation(this.currentConversationId);
  }

  /**
   * Gets all conversations
   * @returns {Array} Array of conversation objects
   */
  getAllConversations() {
    return Array.from(this.conversations.values());
  }

  /**
   * Updates a conversation
   * @param {string} conversationId - Conversation ID
   * @param {Object} updates - Updates to apply
   * @returns {boolean} True if updated, false if not found
   */
  updateConversation(conversationId, updates) {
    if (!conversationId || typeof conversationId !== 'string') {
      throw new Error('Valid conversation ID is required and must be a string');
    }

    if (!updates || typeof updates !== 'object') {
      throw new Error('Valid updates object is required');
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return false;
    }

    try {
      // Apply updates
      Object.assign(conversation, updates);
      conversation.updatedAt = new Date().toISOString();

      // Save to storage
      this.saveConversations().catch(error => {
        this.logger.error('Failed to save updated conversation to storage', {}, error);
      });

      this.logger.debug(`Conversation updated: ${conversationId}`);

      return true;
    } catch (error) {
      this.logger.error(`Failed to update conversation: ${conversationId}`, {}, error);
      throw error;
    }
  }

  /**
   * Deletes a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {boolean} True if deleted, false if not found
   */
  deleteConversation(conversationId) {
    if (!conversationId || typeof conversationId !== 'string') {
      throw new Error('Valid conversation ID is required and must be a string');
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return false;
    }

    try {
      // Remove from conversations
      this.conversations.delete(conversationId);

      // Update current conversation if needed
      if (this.currentConversationId === conversationId) {
        const remainingConversations = Array.from(this.conversations.keys());
        this.currentConversationId = remainingConversations.length > 0 ? remainingConversations[0] : null;
      }

      // Save to storage
      this.saveConversations().catch(error => {
        this.logger.error('Failed to save conversations after deletion to storage', {}, error);
      });

      this.logger.debug(`Conversation deleted: ${conversationId}`);

      return true;
    } catch (error) {
      this.logger.error(`Failed to delete conversation: ${conversationId}`, {}, error);
      throw error;
    }
  }

  /**
   * Adds a message to a conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} role - Message role ('user', 'assistant', 'system')
   * @param {string} content - Message content
   * @param {Object} metadata - Message metadata
   * @returns {boolean} True if added, false if conversation not found
   */
  addMessage(conversationId, role, content, metadata = {}) {
    if (!conversationId || typeof conversationId !== 'string') {
      throw new Error('Valid conversation ID is required and must be a string');
    }

    if (!role || typeof role !== 'string') {
      throw new Error('Valid role is required and must be a string');
    }

    if (!content || typeof content !== 'string') {
      throw new Error('Valid content is required and must be a string');
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return false;
    }

    try {
      const message = {
        id: this.generateMessageId(),
        role,
        content,
        timestamp: new Date().toISOString(),
        metadata
      };

      // Add to conversation
      conversation.messages.push(message);

      // Limit messages per conversation
      if (conversation.messages.length > this.maxMessagesPerConversation) {
        conversation.messages = conversation.messages.slice(-this.maxMessagesPerConversation);
      }

      // Update conversation
      conversation.updatedAt = new Date().toISOString();

      // Update title if this is the first user message
      if (conversation.messages.length === 1 && role === 'user') {
        conversation.title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
      }

      // Save to storage
      this.saveConversations().catch(error => {
        this.logger.error('Failed to save conversation after adding message to storage', {}, error);
      });

      this.logger.debug(`Message added to conversation: ${conversationId}`, {
        role,
        contentLength: content.length
      });

      return true;
    } catch (error) {
      this.logger.error(`Failed to add message to conversation: ${conversationId}`, {}, error);
      throw error;
    }
  }

  /**
   * Adds a message to the current conversation
   * @param {string} role - Message role ('user', 'assistant', 'system')
   * @param {string} content - Message content
   * @param {Object} metadata - Message metadata
   * @returns {boolean} True if added, false if no current conversation
   */
  addMessageToCurrent(role, content, metadata = {}) {
    if (!this.currentConversationId) {
      return false;
    }

    return this.addMessage(this.currentConversationId, role, content, metadata);
  }

  /**
   * Gets messages from a conversation
   * @param {string} conversationId - Conversation ID
   * @param {number} limit - Maximum number of messages to return
   * @returns {Array} Array of message objects
   */
  getMessages(conversationId, limit) {
    if (!conversationId || typeof conversationId !== 'string') {
      return [];
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return [];
    }

    let messages = conversation.messages;

    // Apply limit if specified
    if (limit && typeof limit === 'number' && limit > 0) {
      messages = messages.slice(-limit);
    }

    return messages;
  }

  /**
   * Gets messages from the current conversation
   * @param {number} limit - Maximum number of messages to return
   * @returns {Array} Array of message objects
   */
  getCurrentMessages(limit) {
    if (!this.currentConversationId) {
      return [];
    }

    return this.getMessages(this.currentConversationId, limit);
  }

  /**
   * Clears all conversations
   */
  clearAllConversations() {
    this.logger.debug('Clearing all conversations');

    try {
      // Clear conversations
      this.conversations.clear();
      this.currentConversationId = null;

      // Save to storage
      this.saveConversations().catch(error => {
        this.logger.error('Failed to save cleared conversations to storage', {}, error);
      });

      this.logger.debug('All conversations cleared');
    } catch (error) {
      this.logger.error('Failed to clear all conversations', {}, error);
      throw error;
    }
  }

  /**
   * Generates a unique conversation ID
   * @returns {string} Conversation ID
   */
  generateConversationId() {
    return 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  /**
   * Generates a unique message ID
   * @returns {string} Message ID
   */
  generateMessageId() {
    return 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  /**
   * Gets conversation statistics
   * @returns {Object} Statistics object
   */
  getStatistics() {
    const conversations = Array.from(this.conversations.values());
    const totalMessages = conversations.reduce((sum, conv) => sum + conv.messages.length, 0);

    return {
      totalConversations: conversations.length,
      totalMessages,
      averageMessagesPerConversation: conversations.length > 0 ? totalMessages / conversations.length : 0,
      currentConversationId: this.currentConversationId
    };
  }
}

export default ConversationStore;