// errorHandler.js - Unified Error Handling System
// Integrates with analytics.js and loadingManager.js for comprehensive error management

import analytics from './analytics.js';
import logger from './utils/logger.js';

/**
 * Error severity levels
 */
export const ErrorSeverity = {
  CRITICAL: 'critical', // System-breaking errors
  HIGH: 'high', // Major functionality issues
  MEDIUM: 'medium', // Moderate issues
  LOW: 'low', // Minor issues
  INFO: 'info', // Informational messages
};

/**
 * Error categories for classification and analytics
 */
export const ErrorCategory = {
  NETWORK: 'network',
  CHROME_API: 'chrome_api',
  USER_INPUT: 'user_input',
  SYSTEM: 'system',
  CONFIGURATION: 'configuration',
  TOOL_EXECUTION: 'tool_execution',
  STORAGE: 'storage',
  PERMISSION: 'permission',
  VALIDATION: 'validation',
  UNKNOWN: 'unknown',
};

/**
 * Standardized Error object
 */
export class ExtensionError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ExtensionError';
    this.severity = options.severity || ErrorSeverity.MEDIUM;
    this.category = options.category || ErrorCategory.UNKNOWN;
    this.code = options.code || 'UNKNOWN_ERROR';
    this.context = options.context || {};
    this.timestamp = Date.now();
    this.userMessage = options.userMessage || message;
    this.retryable = options.retryable || false;
    this.critical = options.critical || false;
    this.component = options.component || 'unknown';
    this.originalError = options.originalError || null;
  }

  /**
   * Convert to plain object for serialization
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      severity: this.severity,
      category: this.category,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
      userMessage: this.userMessage,
      retryable: this.retryable,
      critical: this.critical,
      component: this.component,
      stack: this.stack,
      originalError: this.originalError
        ? {
            message: this.originalError.message,
            name: this.originalError.name,
            stack: this.originalError.stack,
          }
        : null,
    };
  }
}

/**
 * Unified Error Handler
 */
export class ErrorHandler {
  constructor() {
    this.retryAttempts = new Map();
    this.errorListeners = [];
    this.maxRetryAttempts = 3;
    this.retryDelay = 1000; // Base delay in ms
    this.initialized = false;
  }

  /**
   * Initialize the error handler
   */
  async initialize() {
    if (this.initialized) return;

    // Set up global error handlers
    this.setupGlobalErrorHandlers();

    // Set up Chrome extension specific error handlers
    this.setupChromeErrorHandlers();

    this.initialized = true;
    logger.info('ErrorHandler', 'Error handler initialized');
  }

  /**
   * Setup global error handlers
   */
  setupGlobalErrorHandlers() {
    // Handle unhandled promise rejections
    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', event => {
        this.handleGlobalError(event.reason, 'unhandledrejection');
      });

      // Handle uncaught errors
      window.addEventListener('error', event => {
        this.handleGlobalError(event.error || new Error(event.message), 'uncaught', {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        });
      });
    }
  }

  /**
   * Setup Chrome extension specific error handlers
   */
  setupChromeErrorHandlers() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      // Handle runtime errors
      if (chrome.runtime.onError) {
        chrome.runtime.onError.addListener(error => {
          this.handleChromeError(error, 'runtime');
        });
      }

      // Handle storage errors
      if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          // Monitor for storage-related issues
          Object.keys(changes).forEach(key => {
            if (changes[key].error) {
              this.handleError(
                new ExtensionError('Storage operation failed', {
                  category: ErrorCategory.STORAGE,
                  context: { key, areaName, error: changes[key].error },
                })
              );
            }
          });
        });
      }
    }
  }

  /**
   * Handle global errors (uncaught/rejected)
   */
  handleGlobalError(error, type = 'global', context = {}) {
    const extensionError = new ExtensionError(
      `Global ${type} error: ${error?.message || 'Unknown error'}`,
      {
        severity: ErrorSeverity.HIGH,
        category: ErrorCategory.SYSTEM,
        code: `GLOBAL_${type.toUpperCase()}_ERROR`,
        context: { type, ...context },
        originalError: error,
      }
    );

    this.handleError(extensionError);
  }

  /**
   * Handle Chrome extension specific errors
   */
  handleChromeError(error, source = 'chrome') {
    const extensionError = new ExtensionError(
      `Chrome ${source} error: ${error.message || 'Unknown Chrome error'}`,
      {
        severity: ErrorSeverity.MEDIUM,
        category: ErrorCategory.CHROME_API,
        code: `CHROME_${source.toUpperCase()}_ERROR`,
        context: { source, chromeError: error },
        originalError: error,
      }
    );

    this.handleError(extensionError);
  }

  /**
   * Main error handling method
   */
  async handleError(error, options = {}) {
    try {
      // Normalize error to ExtensionError
      const extensionError = this.normalizeError(error, options);

      // Skip if error should be ignored
      if (this.shouldIgnoreError(extensionError)) {
        return;
      }

      // Log to console
      this.logError(extensionError);

      // Track in analytics
      await this.trackError(extensionError);

      // Show user feedback
      this.showUserFeedback(extensionError);

      // Notify listeners
      this.notifyListeners(extensionError);

      // Handle recovery if retryable
      if (extensionError.retryable && options.retryCallback) {
        await this.handleRetry(extensionError, options.retryCallback);
      }
    } catch (handlingError) {
      logger.error('ErrorHandler', 'Error in error handler:', handlingError);
      // Fallback to basic console logging
      logger.error('ErrorHandler', 'Original error:', error);
    }
  }

  /**
   * Normalize any error to ExtensionError
   */
  normalizeError(error, options = {}) {
    if (error instanceof ExtensionError) {
      return error;
    }

    // Handle Chrome runtime lastError pattern
    if (chrome?.runtime?.lastError) {
      return new ExtensionError(chrome.runtime.lastError.message || 'Chrome runtime error', {
        severity: ErrorSeverity.MEDIUM,
        category: ErrorCategory.CHROME_API,
        code: 'CHROME_RUNTIME_ERROR',
        context: { lastError: chrome.runtime.lastError },
        ...options,
      });
    }

    // Handle network errors with specific user messages
    if (error instanceof TypeError && error.message.includes('fetch')) {
      const userMessage = this.getNetworkErrorMessage(error.message);
      return new ExtensionError('Network request failed', {
        severity: ErrorSeverity.HIGH,
        category: ErrorCategory.NETWORK,
        code: 'NETWORK_ERROR',
        userMessage,
        context: { originalMessage: error.message },
        retryable: true,
        originalError: error,
        ...options,
      });
    }

    // Handle API response errors
    if (error.message && error.message.includes('API')) {
      const userMessage = this.getApiErrorMessage(error.message);
      return new ExtensionError(error.message, {
        severity: ErrorSeverity.HIGH,
        category: ErrorCategory.NETWORK,
        code: 'API_ERROR',
        userMessage,
        originalError: error,
        ...options,
      });
    }

    // Handle configuration errors with helpful guidance
    if (
      error.message &&
      (error.message.includes('Configuration') ||
        error.message.includes('API key') ||
        error.message.includes('endpoint') ||
        error.message.includes('model name'))
    ) {
      const userMessage = this.getConfigurationErrorMessage(error.message);
      return new ExtensionError(error.message, {
        severity: ErrorSeverity.CRITICAL,
        category: ErrorCategory.CONFIGURATION,
        code: 'CONFIGURATION_ERROR',
        userMessage,
        originalError: error,
        ...options,
      });
    }

    // Handle authentication errors
    if (
      error.message &&
      (error.message.includes('401') ||
        error.message.includes('403') ||
        error.message.includes('Unauthorized') ||
        error.message.includes('Forbidden') ||
        error.message.includes('authentication'))
    ) {
      const userMessage =
        'Authentication failed. Please check your API key is valid and has the correct permissions.';
      return new ExtensionError(error.message, {
        severity: ErrorSeverity.HIGH,
        category: ErrorCategory.CONFIGURATION,
        code: 'AUTHENTICATION_ERROR',
        userMessage,
        originalError: error,
        ...options,
      });
    }

    // Handle rate limiting errors
    if (
      error.message &&
      (error.message.includes('429') ||
        error.message.includes('rate limit') ||
        error.message.includes('too many requests'))
    ) {
      const userMessage =
        'Rate limit exceeded. Please wait a moment before sending another message.';
      return new ExtensionError(error.message, {
        severity: ErrorSeverity.MEDIUM,
        category: ErrorCategory.NETWORK,
        code: 'RATE_LIMIT_ERROR',
        userMessage,
        retryable: true,
        originalError: error,
        ...options,
      });
    }

    // Handle general errors
    return new ExtensionError(error?.message || 'Unknown error', {
      severity: ErrorSeverity.MEDIUM,
      code: 'GENERAL_ERROR',
      originalError: error,
      ...options,
    });
  }

  /**
   * Get user-friendly network error message
   */
  getNetworkErrorMessage(originalMessage) {
    if (originalMessage.includes('Failed to fetch')) {
      return 'Unable to connect to the API endpoint. Please check your internet connection and verify the endpoint URL is correct.';
    } else if (originalMessage.includes('CORS')) {
      return 'Cross-origin request blocked. The API endpoint may not allow requests from this extension.';
    } else if (
      originalMessage.includes('ERR_NAME_NOT_RESOLVED') ||
      originalMessage.includes('ERR_INTERNET_DISCONNECTED')
    ) {
      return 'Network connection issue. Please check your internet connection and try again.';
    } else if (originalMessage.includes('timeout')) {
      return 'Request timed out. The API endpoint may be experiencing delays. Please try again.';
    }
    return 'Network request failed. Please check your connection and try again.';
  }

  /**
   * Get user-friendly API error message
   */
  getApiErrorMessage(originalMessage) {
    if (originalMessage.includes('500')) {
      return 'The API server encountered an internal error. Please try again in a few moments.';
    } else if (
      originalMessage.includes('502') ||
      originalMessage.includes('503') ||
      originalMessage.includes('504')
    ) {
      return 'The API server is temporarily unavailable. Please try again later.';
    } else if (originalMessage.includes('400')) {
      return 'Invalid request format. Please check your API configuration.';
    } else if (originalMessage.includes('404')) {
      return 'API endpoint not found. Please verify the endpoint URL in your configuration.';
    }
    return 'API request failed. Please check your configuration and try again.';
  }

  /**
   * Get user-friendly configuration error message
   */
  getConfigurationErrorMessage(originalMessage) {
    if (originalMessage.includes('API key') || originalMessage.includes('apiKey')) {
      return 'API key is missing or invalid. Please set a valid API key in the extension options.';
    } else if (originalMessage.includes('endpoint') || originalMessage.includes('URL')) {
      return 'API endpoint is missing or invalid. Please set a valid endpoint URL in the extension options.';
    } else if (originalMessage.includes('model') || originalMessage.includes('modelName')) {
      return 'Model name is missing or invalid. Please select a valid model in the extension options.';
    } else if (originalMessage.includes('profile')) {
      return 'No configuration profile found. Please create a configuration profile in the extension options.';
    }
    return 'Configuration error. Please check your extension settings and ensure all required fields are filled in.';
  }

  /**
   * Determine if error should be ignored
   */
  shouldIgnoreError(error) {
    const ignorePatterns = [
      /Script error/i,
      /Non-Error promise rejection/i,
      /ResizeObserver loop limit exceeded/i,
      /Network request failed/i, // Only ignore if it's a background request that can be retried
    ];

    return ignorePatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Log error to console with appropriate level
   */
  logError(error) {
    const logMethod = this.getLogMethod(error.severity);
    const logMessage = `[${error.severity.toUpperCase()}] ${error.category}: ${error.message}`;

    logMethod.call(console, logMessage, {
      code: error.code,
      component: error.component,
      context: error.context,
      timestamp: new Date(error.timestamp).toISOString(),
      retryable: error.retryable,
      stack: error.stack,
    });
  }

  /**
   * Get appropriate console logging method based on severity
   */
  getLogMethod(severity) {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return logger.error;
      case ErrorSeverity.HIGH:
        return logger.error;
      case ErrorSeverity.MEDIUM:
        return logger.warn;
      case ErrorSeverity.LOW:
        return logger.info;
      case ErrorSeverity.INFO:
        return logger.info;
      default:
        return logger.warn;
    }
  }

  /**
   * Track error in analytics
   */
  async trackError(error) {
    try {
      if (typeof analytics !== 'undefined' && analytics.trackErrorEvent) {
        await analytics.trackErrorEvent(error.category, error.code);
      }
    } catch (analyticsError) {
      logger.warn('ErrorHandler', 'Failed to track error in analytics:', analyticsError);
    }
  }

  /**
   * Show user feedback via loadingManager or console
   */
  showUserFeedback(error) {
    // Only show user feedback for errors that affect user experience
    if (error.severity === ErrorSeverity.INFO || error.category === ErrorCategory.SYSTEM) {
      return;
    }

    // Try to use loadingManager if available
    if (typeof window !== 'undefined' && window.loadingManager) {
      const toastType =
        error.severity === ErrorSeverity.CRITICAL
          ? 'error'
          : error.severity === ErrorSeverity.HIGH
            ? 'error'
            : 'warning';

      window.loadingManager.showToast(error.userMessage, toastType);
    } else {
      // Fallback to console for background scripts
      logger.warn('ErrorHandler', 'User feedback:', error.userMessage);
    }
  }

  /**
   * Notify error listeners
   */
  notifyListeners(error) {
    this.errorListeners.forEach(listener => {
      try {
        listener(error);
      } catch (listenerError) {
        logger.warn('ErrorHandler', 'Error listener failed:', listenerError);
      }
    });
  }

  /**
   * Handle retry logic for retryable errors
   */
  async handleRetry(error, retryCallback) {
    const errorId = `${error.code}_${error.component}`;
    const attempts = this.retryAttempts.get(errorId) || 0;

    if (attempts >= this.maxRetryAttempts) {
      logger.warn('ErrorHandler', `Max retry attempts reached for ${errorId}`);
      return false;
    }

    const delay = this.retryDelay * Math.pow(2, attempts); // Exponential backoff
    this.retryAttempts.set(errorId, attempts + 1);

    logger.info(
      'ErrorHandler',
      `Retrying ${errorId} in ${delay}ms (attempt ${attempts + 1}/${this.maxRetryAttempts})`
    );

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      const result = await retryCallback();
      this.retryAttempts.delete(errorId); // Clear retry attempts on success
      return result;
    } catch (retryError) {
      // Don't retry again if the retry failed
      logger.warn('ErrorHandler', `Retry failed for ${errorId}:`, retryError);
      return false;
    }
  }

  /**
   * Add error listener
   */
  addErrorListener(listener) {
    this.errorListeners.push(listener);
  }

  /**
   * Remove error listener
   */
  removeErrorListener(listener) {
    const index = this.errorListeners.indexOf(listener);
    if (index > -1) {
      this.errorListeners.splice(index, 1);
    }
  }

  /**
   * Create error with helper method
   */
  createError(message, options = {}) {
    return new ExtensionError(message, options);
  }

  /**
   * Wrapper for async functions with error handling
   */
  async wrapAsync(asyncFn, errorOptions = {}) {
    try {
      return await asyncFn();
    } catch (error) {
      await this.handleError(error, errorOptions);
      throw error; // Re-throw to allow caller to handle if needed
    }
  }

  /**
   * Wrapper for sync functions with error handling
   */
  wrapSync(syncFn, errorOptions = {}) {
    try {
      return syncFn();
    } catch (error) {
      this.handleError(error, errorOptions);
      throw error; // Re-throw to allow caller to handle if needed
    }
  }

  /**
   * Handle Chrome API calls with proper error checking
   */
  async handleChromeApiCall(apiCall, errorOptions = {}) {
    return new Promise((resolve, reject) => {
      try {
        const result = apiCall((error, result) => {
          if (chrome.runtime.lastError) {
            const error = new ExtensionError(chrome.runtime.lastError.message, {
              severity: ErrorSeverity.MEDIUM,
              category: ErrorCategory.CHROME_API,
              code: 'CHROME_API_ERROR',
              context: { apiCall: apiCall.toString() },
              ...errorOptions,
            });
            this.handleError(error);
            reject(error);
          } else {
            // Handle undefined result for storage APIs - provide empty object
            if (result === undefined) {
              resolve({});
            } else {
              resolve(result);
            }
          }
        });

        // Handle synchronous Chrome API calls
        if (result !== undefined) {
          if (chrome.runtime.lastError) {
            const error = new ExtensionError(chrome.runtime.lastError.message, {
              severity: ErrorSeverity.MEDIUM,
              category: ErrorCategory.CHROME_API,
              code: 'CHROME_API_ERROR',
              ...errorOptions,
            });
            this.handleError(error);
            reject(error);
          } else {
            resolve(result);
          }
        }
      } catch (error) {
        this.handleError(this.normalizeError(error, errorOptions));
        reject(error);
      }
    });
  }

  /**
   * Clean up error handler
   */
  cleanup() {
    this.errorListeners = [];
    this.retryAttempts.clear();
    this.initialized = false;
  }
}

// Create and export global instance
export const errorHandler = new ErrorHandler();

// Convenience functions for easy import
export const handleError = (error, options) => errorHandler.handleError(error, options);
export const createError = (message, options) => errorHandler.createError(message, options);
export const wrapAsync = (asyncFn, errorOptions) => errorHandler.wrapAsync(asyncFn, errorOptions);
export const wrapSync = (syncFn, errorOptions) => errorHandler.wrapSync(syncFn, errorOptions);
export const handleChromeApiCall = (apiCall, errorOptions) =>
  errorHandler.handleChromeApiCall(apiCall, errorOptions);

// Initialize error handler
if (typeof document !== 'undefined') {
  // Browser environment - initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => errorHandler.initialize());
  } else {
    errorHandler.initialize();
  }
} else {
  // Service worker/ background script environment - initialize immediately
  errorHandler.initialize();
}

export default errorHandler;
