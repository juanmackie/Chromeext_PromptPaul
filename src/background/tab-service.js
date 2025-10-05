/**
 * Tab Service
 * Handles all tab-related functionality
 * Implements production-ready coding rules for tab management
 *
 * Core Principles:
 * - Input Validation: Validate all tab operations
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient tab operations with proper timeouts
 */

import { errorHandler, logger } from '../shared/index.js';

class TabService {
  constructor(dependencies) {
    this.storage = dependencies.Storage;
    this.logger = dependencies.Logger;
    this.errorHandler = dependencies.ErrorHandler;
    
    // Tab service configuration
    this.contentScriptFile = 'content_script_unified.js';
    this.defaultTimeout = 30000; // 30 seconds
    this.pendingCallbacks = new Map();
  }

  /**
   * Gets the active tab
   * @returns {Promise<Object|null>} Active tab object or null if not found
   */
  async getActiveTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs.length > 0 ? tabs[0] : null;
    } catch (error) {
      this.logger.error('Failed to get active tab', {}, error);
      throw this.errorHandler.createError(
        'TAB_ERROR',
        'Failed to get active tab',
        error
      );
    }
  }

  /**
   * Validates tab ID
   * @param {number} tabId - Tab ID to validate
   * @returns {boolean} True if valid
   */
  isValidTabId(tabId) {
    return typeof tabId === 'number' && tabId > 0;
  }

  /**
   * Injects content script into a tab
   * @param {number} tabId - Tab ID
   * @param {string} file - Content script file
   * @param {number} timeout - Injection timeout
   * @returns {Promise<Object>} Injection result
   */
  async injectContentScript(tabId, file = this.contentScriptFile, timeout = this.defaultTimeout) {
    if (!this.isValidTabId(tabId)) {
      throw this.errorHandler.createError(
        'VALIDATION_ERROR',
        'Invalid tab ID provided'
      );
    }

    this.logger.debug('Injecting content script', { tabId, file });

    try {
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Content script injection timed out')), timeout);
      });

      // Create injection promise
      const injectionPromise = new Promise((resolve, reject) => {
        chrome.scripting.executeScript({
          target: { tabId },
          files: [file]
        }, (injectionResults) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(injectionResults);
          }
        });
      });

      // Race between injection and timeout
      const injectionResults = await Promise.race([injectionPromise, timeoutPromise]);

      this.logger.debug('Content script injected successfully', { tabId, file });
      return {
        success: true,
        results: injectionResults
      };
    } catch (error) {
      this.logger.error('Failed to inject content script', { tabId, file }, error);
      throw this.errorHandler.createError(
        'INJECTION_ERROR',
        `Failed to inject content script: ${error.message}`,
        error
      );
    }
  }

  /**
   * Fetches tab content using content script
   * @param {number} tabId - Tab ID
   * @param {string} action - Action to perform
   * @param {Object} data - Additional data
   * @param {number} timeout - Request timeout
   * @returns {Promise<Object>} Tab content
   */
  async fetchTabContent(tabId, action = 'getTabContent', data = {}, timeout = this.defaultTimeout) {
    if (!this.isValidTabId(tabId)) {
      throw this.errorHandler.createError(
        'VALIDATION_ERROR',
        'Invalid tab ID provided'
      );
    }

    this.logger.debug('Fetching tab content', { tabId, action });

    try {
      // Generate unique request ID
      const requestId = `${action}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // Create promise for response
      const responsePromise = new Promise((resolve, reject) => {
        // Store callback
        this.pendingCallbacks.set(requestId, { resolve, reject });

        // Set timeout
        setTimeout(() => {
          this.pendingCallbacks.delete(requestId);
          reject(new Error('Tab content request timed out'));
        }, timeout);

        // Set up message listener
        const messageListener = (message, sender) => {
          if (sender.tab && sender.tab.id === tabId && message.action === `${action}Response` && message.requestId === requestId) {
            chrome.runtime.onMessage.removeListener(messageListener);
            this.pendingCallbacks.delete(requestId);
            resolve(message);
          }
        };

        chrome.runtime.onMessage.addListener(messageListener);

        // Inject content script and send message
        this.injectContentScript(tabId)
          .then(() => {
            chrome.tabs.sendMessage(tabId, {
              action,
              requestId,
              ...data
            });
          })
          .catch(error => {
            chrome.runtime.onMessage.removeListener(messageListener);
            this.pendingCallbacks.delete(requestId);
            reject(error);
          });
      });

      // Wait for response
      const response = await responsePromise;

      if (response.success) {
        this.logger.debug('Tab content fetched successfully', { tabId, action });
        return {
          success: true,
          content: response.content || response.data,
          tabId
        };
      } else {
        throw new Error(response.error || 'Unknown error');
      }
    } catch (error) {
      this.logger.error('Failed to fetch tab content', { tabId, action }, error);
      throw this.errorHandler.createError(
        'CONTENT_ERROR',
        `Failed to fetch tab content: ${error.message}`,
        error
      );
    }
  }

  /**
   * Gets tab content for explanation
   * @param {number} tabId - Tab ID
   * @returns {Promise<Object>} Tab content
   */
  async getTabContentForExplanation(tabId) {
    return this.fetchTabContent(tabId, 'getExplainContent');
  }

  /**
   * Gets tab content for summary
   * @param {number} tabId - Tab ID
   * @returns {Promise<Object>} Tab content
   */
  async getTabContentForSummary(tabId) {
    return this.fetchTabContent(tabId, 'getTabContent');
  }

  /**
   * Gets tab content for pinned action
   * @param {number} tabId - Tab ID
   * @param {Object} instruction - Instruction object
   * @returns {Promise<Object>} Tab content
   */
  async getTabContentForPinnedAction(tabId, instruction) {
    return this.fetchTabContent(tabId, 'getPinnedActionTabContent', { instruction });
  }

  /**
   * Captures tab as image
   * @param {number} tabId - Tab ID
   * @param {Object} options - Capture options
   * @returns {Promise<string>} Data URL of captured image
   */
  async captureTab(tabId, options = {}) {
    if (!this.isValidTabId(tabId)) {
      throw this.errorHandler.createError(
        'VALIDATION_ERROR',
        'Invalid tab ID provided'
      );
    }

    this.logger.debug('Capturing tab as image', { tabId, options });

    try {
      const defaultOptions = {
        format: 'png',
        quality: 90
      };

      const captureOptions = { ...defaultOptions, ...options };
      const dataUrl = await chrome.tabs.captureVisibleTab(tabId, captureOptions);

      this.logger.debug('Tab captured successfully', { tabId, format: captureOptions.format });
      return dataUrl;
    } catch (error) {
      this.logger.error('Failed to capture tab', { tabId, options }, error);
      throw this.errorHandler.createError(
        'CAPTURE_ERROR',
        `Failed to capture tab: ${error.message}`,
        error
      );
    }
  }

  /**
   * Opens a new tab
   * @param {string} url - URL to open
   * @param {boolean} active - Whether tab should be active
   * @returns {Promise<Object>} New tab object
   */
  async openTab(url, active = true) {
    if (!url || typeof url !== 'string') {
      throw this.errorHandler.createError(
        'VALIDATION_ERROR',
        'URL is required and must be a string'
      );
    }

    this.logger.debug('Opening new tab', { url, active });

    try {
      const tab = await chrome.tabs.create({
        url,
        active
      });

      this.logger.debug('Tab opened successfully', { tabId: tab.id, url });
      return tab;
    } catch (error) {
      this.logger.error('Failed to open tab', { url, active }, error);
      throw this.errorHandler.createError(
        'TAB_ERROR',
        `Failed to open tab: ${error.message}`,
        error
      );
    }
  }

  /**
   * Updates a tab
   * @param {number} tabId - Tab ID
   * @param {Object} updateProperties - Properties to update
   * @returns {Promise<Object>} Updated tab object
   */
  async updateTab(tabId, updateProperties) {
    if (!this.isValidTabId(tabId)) {
      throw this.errorHandler.createError(
        'VALIDATION_ERROR',
        'Invalid tab ID provided'
      );
    }

    if (!updateProperties || typeof updateProperties !== 'object') {
      throw this.errorHandler.createError(
        'VALIDATION_ERROR',
        'Update properties are required and must be an object'
      );
    }

    this.logger.debug('Updating tab', { tabId, updateProperties });

    try {
      const tab = await chrome.tabs.update(tabId, updateProperties);

      this.logger.debug('Tab updated successfully', { tabId, updateProperties });
      return tab;
    } catch (error) {
      this.logger.error('Failed to update tab', { tabId, updateProperties }, error);
      throw this.errorHandler.createError(
        'TAB_ERROR',
        `Failed to update tab: ${error.message}`,
        error
      );
    }
  }

  /**
   * Closes a tab
   * @param {number} tabId - Tab ID
   * @returns {Promise<void>}
   */
  async closeTab(tabId) {
    if (!this.isValidTabId(tabId)) {
      throw this.errorHandler.createError(
        'VALIDATION_ERROR',
        'Invalid tab ID provided'
      );
    }

    this.logger.debug('Closing tab', { tabId });

    try {
      await chrome.tabs.remove(tabId);
      this.logger.debug('Tab closed successfully', { tabId });
    } catch (error) {
      this.logger.error('Failed to close tab', { tabId }, error);
      throw this.errorHandler.createError(
        'TAB_ERROR',
        `Failed to close tab: ${error.message}`,
        error
      );
    }
  }

  /**
   * Clears pending callbacks (for error recovery)
   */
  clearPendingCallbacks() {
    for (const [requestId, callback] of this.pendingCallbacks) {
      callback.reject(new Error('Pending callback cleared'));
    }
    this.pendingCallbacks.clear();
    this.logger.debug('Pending callbacks cleared');
  }
}

export default TabService;