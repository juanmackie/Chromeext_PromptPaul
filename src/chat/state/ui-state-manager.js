/**
 * UI State Manager
 * Manages UI state for the chat interface
 * Implements production-ready coding rules for state management
 *
 * Core Principles:
 * - Input Validation: Validate all state data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient state management with proper updates
 */

import { logger } from '../../shared/index.js';

class UIStateManager {
  constructor(dependencies) {
    this.logger = dependencies.Logger;
    this.state = {
      isLoading: false,
      isStreaming: false,
      selectedText: '',
      mediaData: null,
      currentInstruction: null,
      error: null,
      activeTabId: null
    };
    this.listeners = new Map();
  }

  /**
   * Initializes the UI state manager
   */
  initialize() {
    this.logger.debug('Initializing UI state manager');

    try {
      // Set up message listeners for state updates
      this.setupMessageListeners();

      this.logger.debug('UI state manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize UI state manager', {}, error);
      throw error;
    }
  }

  /**
   * Gets the current state
   * @returns {Object} Current state object
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Updates the state
   * @param {Object} updates - State updates
   */
  updateState(updates) {
    if (!updates || typeof updates !== 'object') {
      throw new Error('Valid updates object is required');
    }

    try {
      const previousState = { ...this.state };
      
      // Apply updates
      Object.assign(this.state, updates);

      // Notify listeners
      this.notifyListeners(previousState, this.state);

      this.logger.debug('State updated', { updates });
    } catch (error) {
      this.logger.error('Failed to update state', { updates }, error);
      throw error;
    }
  }

  /**
   * Sets the loading state
   * @param {boolean} isLoading - Loading state
   */
  setLoading(isLoading) {
    if (typeof isLoading !== 'boolean') {
      throw new Error('Loading state must be a boolean');
    }

    this.updateState({ isLoading });
  }

  /**
   * Sets the streaming state
   * @param {boolean} isStreaming - Streaming state
   */
  setStreaming(isStreaming) {
    if (typeof isStreaming !== 'boolean') {
      throw new Error('Streaming state must be a boolean');
    }

    this.updateState({ isStreaming });
  }

  /**
   * Sets the selected text
   * @param {string} selectedText - Selected text
   */
  setSelectedText(selectedText) {
    if (selectedText !== null && typeof selectedText !== 'string') {
      throw new Error('Selected text must be a string or null');
    }

    this.updateState({ selectedText: selectedText || '' });
  }

  /**
   * Sets the media data
   * @param {Object|null} mediaData - Media data object
   */
  setMediaData(mediaData) {
    if (mediaData !== null && typeof mediaData !== 'object') {
      throw new Error('Media data must be an object or null');
    }

    this.updateState({ mediaData });
  }

  /**
   * Sets the current instruction
   * @param {Object|null} currentInstruction - Current instruction object
   */
  setCurrentInstruction(currentInstruction) {
    if (currentInstruction !== null && typeof currentInstruction !== 'object') {
      throw new Error('Current instruction must be an object or null');
    }

    this.updateState({ currentInstruction });
  }

  /**
   * Sets the error state
   * @param {Error|string|null} error - Error object or message
   */
  setError(error) {
    if (error !== null && !(error instanceof Error) && typeof error !== 'string') {
      throw new Error('Error must be an Error object, string, or null');
    }

    const errorMessage = error instanceof Error ? error.message : (error || '');
    this.updateState({ error: errorMessage });
  }

  /**
   * Sets the active tab ID
   * @param {number|null} activeTabId - Active tab ID
   */
  setActiveTabId(activeTabId) {
    if (activeTabId !== null && (typeof activeTabId !== 'number' || activeTabId <= 0)) {
      throw new Error('Active tab ID must be a positive number or null');
    }

    this.updateState({ activeTabId });
  }

  /**
   * Clears the error state
   */
  clearError() {
    this.updateState({ error: null });
  }

  /**
   * Resets the state to initial values
   */
  resetState() {
    this.logger.debug('Resetting state to initial values');

    try {
      const previousState = { ...this.state };
      
      // Reset state
      this.state = {
        isLoading: false,
        isStreaming: false,
        selectedText: '',
        mediaData: null,
        currentInstruction: null,
        error: null,
        activeTabId: null
      };

      // Notify listeners
      this.notifyListeners(previousState, this.state);

      this.logger.debug('State reset to initial values');
    } catch (error) {
      this.logger.error('Failed to reset state', {}, error);
      throw error;
    }
  }

  /**
   * Adds a state change listener
   * @param {string} id - Listener ID
   * @param {Function} listener - Listener function
   */
  addListener(id, listener) {
    if (!id || typeof id !== 'string') {
      throw new Error('Valid listener ID is required and must be a string');
    }

    if (!listener || typeof listener !== 'function') {
      throw new Error('Valid listener function is required');
    }

    this.listeners.set(id, listener);
    this.logger.debug(`State listener added: ${id}`);
  }

  /**
   * Removes a state change listener
   * @param {string} id - Listener ID
   */
  removeListener(id) {
    if (!id || typeof id !== 'string') {
      throw new Error('Valid listener ID is required and must be a string');
    }

    const removed = this.listeners.delete(id);
    if (removed) {
      this.logger.debug(`State listener removed: ${id}`);
    }
  }

  /**
   * Notifies all listeners of state changes
   * @param {Object} previousState - Previous state
   * @param {Object} currentState - Current state
   */
  notifyListeners(previousState, currentState) {
    try {
      for (const [id, listener] of this.listeners) {
        try {
          listener(currentState, previousState);
        } catch (error) {
          this.logger.error(`Error in state listener: ${id}`, {}, error);
        }
      }
    } catch (error) {
      this.logger.error('Failed to notify state listeners', {}, error);
    }
  }

  /**
   * Sets up message listeners for state updates
   */
  setupMessageListeners() {
    // Listen for selected text
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'setSelectedText') {
        this.handleSetSelectedTextMessage(message);
        return false; // No response needed
      }
    });

    // Listen for media data
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'setMediaForAnalysis') {
        this.handleSetMediaForAnalysisMessage(message);
        return false; // No response needed
      }
    });

    // Listen for loading state
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'setLoading') {
        this.handleSetLoadingMessage(message);
        return false; // No response needed
      }
    });

    // Listen for streaming state
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'setStreaming') {
        this.handleSetStreamingMessage(message);
        return false; // No response needed
      }
    });

    // Listen for errors
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'setError') {
        this.handleSetErrorMessage(message);
        return false; // No response needed
      }
    });

    this.logger.debug('State message listeners set up');
  }

  /**
   * Handles set selected text message
   * @param {Object} message - Message object
   */
  handleSetSelectedTextMessage(message) {
    this.logger.debug('Handling set selected text message');

    try {
      this.setSelectedText(message.selectedText);
      this.setActiveTabId(message.tabId);
    } catch (error) {
      this.logger.error('Failed to handle set selected text message', {}, error);
    }
  }

  /**
   * Handles set media for analysis message
   * @param {Object} message - Message object
   */
  handleSetMediaForAnalysisMessage(message) {
    this.logger.debug('Handling set media for analysis message');

    try {
      this.setMediaData(message.mediaData);
      this.setActiveTabId(message.tabId);
    } catch (error) {
      this.logger.error('Failed to handle set media for analysis message', {}, error);
    }
  }

  /**
   * Handles set loading message
   * @param {Object} message - Message object
   */
  handleSetLoadingMessage(message) {
    this.logger.debug('Handling set loading message');

    try {
      this.setLoading(message.isLoading);
    } catch (error) {
      this.logger.error('Failed to handle set loading message', {}, error);
    }
  }

  /**
   * Handles set streaming message
   * @param {Object} message - Message object
   */
  handleSetStreamingMessage(message) {
    this.logger.debug('Handling set streaming message');

    try {
      this.setStreaming(message.isStreaming);
    } catch (error) {
      this.logger.error('Failed to handle set streaming message', {}, error);
    }
  }

  /**
   * Handles set error message
   * @param {Object} message - Message object
   */
  handleSetErrorMessage(message) {
    this.logger.debug('Handling set error message');

    try {
      this.setError(message.error);
    } catch (error) {
      this.logger.error('Failed to handle set error message', {}, error);
    }
  }

  /**
   * Gets state for UI rendering
   * @returns {Object} UI state object
   */
  getUIState() {
    return {
      isLoading: this.state.isLoading,
      isStreaming: this.state.isStreaming,
      hasSelectedText: !!this.state.selectedText,
      hasMediaData: !!this.state.mediaData,
      hasError: !!this.state.error,
      errorMessage: this.state.error,
      mediaType: this.state.mediaData?.type || null,
      mediaLoading: this.state.mediaData?.loading || false,
      mediaError: this.state.mediaData?.error || null
    };
  }

  /**
   * Checks if the UI is in a loading state
   * @returns {boolean} True if loading
   */
  isLoading() {
    return this.state.isLoading;
  }

  /**
   * Checks if the UI is in a streaming state
   * @returns {boolean} True if streaming
   */
  isStreaming() {
    return this.state.isStreaming;
  }

  /**
   * Checks if there is selected text
   * @returns {boolean} True if there is selected text
   */
  hasSelectedText() {
    return !!this.state.selectedText;
  }

  /**
   * Checks if there is media data
   * @returns {boolean} True if there is media data
   */
  hasMediaData() {
    return !!this.state.mediaData;
  }

  /**
   * Checks if there is an error
   * @returns {boolean} True if there is an error
   */
  hasError() {
    return !!this.state.error;
  }

  /**
   * Gets the selected text
   * @returns {string} Selected text
   */
  getSelectedText() {
    return this.state.selectedText;
  }

  /**
   * Gets the media data
   * @returns {Object|null} Media data object
   */
  getMediaData() {
    return this.state.mediaData;
  }

  /**
   * Gets the current instruction
   * @returns {Object|null} Current instruction object
   */
  getCurrentInstruction() {
    return this.state.currentInstruction;
  }

  /**
   * Gets the error message
   * @returns {string|null} Error message
   */
  getError() {
    return this.state.error;
  }

  /**
   * Gets the active tab ID
   * @returns {number|null} Active tab ID
   */
  getActiveTabId() {
    return this.state.activeTabId;
  }
}

export default UIStateManager;