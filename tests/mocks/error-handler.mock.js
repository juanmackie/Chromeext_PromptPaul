/**
 * Mock implementation for errorHandler.js
 * Provides comprehensive error handling functionality for testing
 */

const ErrorSeverity = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
};

const ErrorCategory = {
  VALIDATION: 'validation',
  NETWORK: 'network',
  STORAGE: 'storage',
  CHROME_API: 'chrome_api',
  MEDIA_PROCESSING: 'media_processing',
  API_CLIENT: 'api_client'
};

const createError = jest.fn((message, category = ErrorCategory.GENERAL, severity = ErrorSeverity.ERROR, context = {}) => ({
  message,
  category,
  severity,
  context,
  timestamp: new Date().toISOString(),
  id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}));

const errorHandler = {
  log: jest.fn((error, context) => {
    console.error('[Error Handler]', error, context);
  }),

  handle: jest.fn((error, context) => {
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    const enhancedError = {
      ...errorObj,
      context,
      timestamp: new Date().toISOString()
    };

    console.error('[Error Handler]', enhancedError);
    return enhancedError;
  }),

  handleAsync: jest.fn(async (error, context) => {
    return errorHandler.handle(error, context);
  }),

  wrapAsync: jest.fn((fn, options = {}) => {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        errorHandler.handle(error, options.context || {});
        if (options.throwOnError !== false) {
          throw error;
        }
        return null;
      }
    };
  }),

  validateAndHandle: jest.fn((error, context) => {
    const isValid = error && (error.message || typeof error === 'string');
    if (isValid) {
      return errorHandler.handle(error, context);
    } else {
      return errorHandler.handle(new Error('Invalid error object'), context);
    }
  }),

  createErrorReport: jest.fn((error, context = {}) => ({
    id: `report-${Date.now()}`,
    timestamp: new Date().toISOString(),
    error: {
      message: error.message || String(error),
      stack: error.stack,
      name: error.name
    },
    context,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'test-environment',
    url: typeof window !== 'undefined' ? window.location.href : 'test-url'
  })),

  getErrorStats: jest.fn(() => ({
    total: 0,
    byCategory: {},
    bySeverity: {},
    recent: []
  })),

  clearErrorStats: jest.fn(() => {
    // Mock implementation
  })
};

const handleChromeApiCall = jest.fn(async (apiCall, options = {}) => {
  try {
    const result = await apiCall();
    return { success: true, result };
  } catch (error) {
    errorHandler.handle(error, {
      category: ErrorCategory.CHROME_API,
      operation: options.operation || 'unknown'
    });
    return {
      success: false,
      error: error.message || String(error),
      chromeError: chrome.runtime.lastError
    };
  }
});

const wrapAsync = jest.fn((fn, options = {}) => {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      errorHandler.handle(error, options.context || {});
      if (options.throwOnError !== false) {
        throw error;
      }
      return null;
    }
  };
});

// Default export for compatibility
module.exports = {
  ErrorSeverity,
  ErrorCategory,
  createError,
  errorHandler,
  handleChromeApiCall,
  wrapAsync
};