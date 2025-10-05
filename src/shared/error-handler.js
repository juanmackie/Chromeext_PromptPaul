/**
 * Centralized Error Handling System
 * Implements production-ready coding rules for error management
 *
 * Core Principles:
 * - Default Deny: Explicit permission required for error exposure
 * - Least Privilege: Minimum necessary error information
 * - Input Validation: Validate all error data
 * - Security: Don't expose system details
 */

class ErrorHandler {
  constructor() {
    this.errorLog = [];
    this.maxLogSize = 1000;
    this.securityLevel = 'production'; // 'development' | 'production'
  }

  /**
   * Creates a standardized error object
   * @param {string} code - Unique error code for categorization
   * @param {string} message - User-friendly error message
   * @param {Error|null} originalError - Original error for debugging
   * @param {Object} context - Additional context data
   * @returns {StandardizedError}
   */
  createError(code, message, originalError = null, context = {}) {
    const error = new Error(message);
    error.code = code;
    error.timestamp = new Date().toISOString();
    error.context = this.sanitizeContext(context);
    error.stack = this.securityLevel === 'development' ? error.stack : undefined;
    error.originalError = this.securityLevel === 'development' ? originalError : null;

    return error;
  }

  /**
   * Sanitizes context data to prevent information leakage
   * @param {Object} context - Raw context data
   * @returns {Object} Sanitized context
   */
  sanitizeContext(context) {
    const sensitiveKeys = [
      'apiKey', 'password', 'token', 'secret', 'auth',
      'cookie', 'session', 'ssid', 'credential'
    ];

    const sanitized = { ...context };

    // Remove or mask sensitive data
    for (const key in sanitized) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        if (typeof sanitized[key] === 'string') {
          sanitized[key] = sanitized[key].substring(0, 4) + '***';
        } else {
          delete sanitized[key];
        }
      }
    }

    return sanitized;
  }

  /**
   * Logs error with appropriate level and sanitization
   * @param {Error} error - Error to log
   * @param {string} level - 'debug' | 'info' | 'warn' | 'error'
   */
  logError(error, level = 'error') {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      code: error.code || 'UNKNOWN',
      message: error.message,
      context: error.context || {},
      stack: this.securityLevel === 'development' ? error.stack : undefined
    };

    // Maintain log size limit
    this.errorLog.push(logEntry);
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift();
    }

    // Console logging with appropriate level
    const consoleMethod = level === 'debug' ? 'log' : level;
    console[consoleMethod](`[${level.toUpperCase()}] ${error.code}: ${error.message}`, {
      context: logEntry.context,
      stack: logEntry.stack
    });
  }

  /**
   * Handles API errors with proper categorization
   * @param {Response} response - Fetch response object
   * @param {string} context - Context where error occurred
   * @returns {Error} Standardized error
   */
  async handleApiError(response, context = 'API call') {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    let errorCode = 'API_ERROR';

    try {
      const errorData = await response.json();
      if (errorData.error && errorData.error.message) {
        errorMessage = errorData.error.message;
      }
      if (errorData.error && errorData.error.code) {
        errorCode = errorData.error.code;
      }
    } catch (parseError) {
      // Use default error message if response parsing fails
    }

    const error = this.createError(
      errorCode,
      `${context} failed: ${errorMessage}`,
      null,
      { status: response.status, url: response.url }
    );

    this.logError(error, 'error');
    return error;
  }

  /**
   * Handles network errors
   * @param {Error} error - Original network error
   * @param {string} context - Context where error occurred
   * @returns {Error} Standardized error
   */
  handleNetworkError(error, context = 'Network operation') {
    const standardizedError = this.createError(
      'NETWORK_ERROR',
      `${context} failed due to network issues. Please check your connection.`,
      error,
      { name: error.name }
    );

    this.logError(standardizedError, 'error');
    return standardizedError;
  }

  /**
   * Handles configuration errors
   * @param {string} missingConfig - Name of missing configuration
   * @param {string} context - Context where error occurred
   * @returns {Error} Standardized error
   */
  handleConfigError(missingConfig, context = 'Configuration') {
    const error = this.createError(
      'CONFIG_ERROR',
      `${context} is incomplete. Please configure "${missingConfig}" in the options page.`,
      null,
      { missingConfig }
    );

    this.logError(error, 'error');
    return error;
  }

  /**
   * Handles validation errors
   * @param {string} field - Field that failed validation
   * @param {string} value - Invalid value (sanitized)
   * @param {string} rule - Validation rule that failed
   * @returns {Error} Standardized error
   */
  handleValidationError(field, value, rule) {
    const error = this.createError(
      'VALIDATION_ERROR',
      `Invalid ${field}: ${rule}`,
      null,
      { field, rule, valueLength: typeof value === 'string' ? value.length : 'unknown' }
    );

    this.logError(error, 'warn');
    return error;
  }

  /**
   * Gets recent error logs for debugging
   * @param {number} limit - Maximum number of logs to return
   * @returns {Array} Recent error logs
   */
  getRecentLogs(limit = 50) {
    return this.errorLog.slice(-limit);
  }

  /**
   * Clears error log
   */
  clearLogs() {
    this.errorLog = [];
  }

  /**
   * Sets security level for error reporting
   * @param {string} level - 'development' | 'production'
   */
  setSecurityLevel(level) {
    this.securityLevel = level;
  }
}

// Custom error classes for better categorization
export class ValidationError extends Error {
  constructor(field, rule, message = `Validation failed for ${field}: ${rule}`) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.rule = rule;
  }
}

export class ApiError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export class ConfigError extends Error {
  constructor(missingConfig, message = `Configuration missing: ${missingConfig}`) {
    super(message);
    this.name = 'ConfigError';
    this.missingConfig = missingConfig;
  }
}

export class NetworkError extends Error {
  constructor(message = 'Network operation failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

// Export singleton instance
export const errorHandler = new ErrorHandler();
export default errorHandler;