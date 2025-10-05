/**
 * Centralized Logging System
 * Implements production-ready coding rules for logging
 *
 * Core Principles:
 * - Structured logging for better analysis
 * - Appropriate log levels for different situations
 * - Performance considerations (no logging in tight loops)
 * - Security-aware (no sensitive data in logs)
 */

class Logger {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000;
    this.minLevel = 'info'; // Minimum level to log
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      fatal: 4
    };
  }

  /**
   * Logs a message with specified level and context
   * @param {string} level - Log level (debug, info, warn, error, fatal)
   * @param {string} message - Log message
   * @param {Object} context - Additional context data
   * @param {Error} error - Optional error object
   */
  log(level, message, context = {}, error = null) {
    // Check if this level should be logged
    if (this.levels[level] < this.levels[this.minLevel]) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this.sanitizeContext(context),
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : null
    };

    // Add to internal log
    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Console output
    const consoleMethod = level === 'debug' ? 'log' : level;
    const logData = {
      level,
      message,
      context: logEntry.context,
      ...(error && { error: logEntry.error })
    };

    console[consoleMethod](`[${level.toUpperCase()}] ${message}`, logData);

    // Browser extension specific: send to background for persistent logging
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      try {
        chrome.runtime.sendMessage({
          action: 'logMessage',
          logEntry: {
            level,
            message,
            context: logEntry.context,
            timestamp: logEntry.timestamp
          }
        }).catch(() => {
          // Silently fail if no one is listening
        });
      } catch (e) {
        // Silently fail in case of extension context issues
      }
    }
  }

  /**
   * Debug level logging
   */
  debug(message, context = {}) {
    this.log('debug', message, context);
  }

  /**
   * Info level logging
   */
  info(message, context = {}) {
    this.log('info', message, context);
  }

  /**
   * Warning level logging
   */
  warn(message, context = {}) {
    this.log('warn', message, context);
  }

  /**
   * Error level logging
   */
  error(message, context = {}, error = null) {
    this.log('error', message, context, error);
  }

  /**
   * Fatal level logging
   */
  fatal(message, context = {}, error = null) {
    this.log('fatal', message, context, error);
  }

  /**
   * Sanitizes context data to prevent information leakage
   * @param {Object} context - Raw context data
   * @returns {Object} Sanitized context
   */
  sanitizeContext(context) {
    const sensitiveKeys = [
      'apiKey', 'password', 'token', 'secret', 'auth',
      'cookie', 'session', 'ssid', 'credential', 'key'
    ];

    const sanitized = { ...context };

    for (const key in sanitized) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        if (typeof sanitized[key] === 'string') {
          // Show first and last 2 characters for debugging while hiding sensitive data
          const value = sanitized[key];
          if (value.length <= 4) {
            sanitized[key] = '***';
          } else {
            sanitized[key] = value.substring(0, 2) + '***' + value.substring(value.length - 2);
          }
        } else {
          sanitized[key] = '[HIDDEN]';
        }
      }
    }

    return sanitized;
  }

  /**
   * Performance logging helper
   * @param {string} operation - Name of operation being timed
   * @param {Function} fn - Function to execute and time
   * @returns {Promise} Result of function execution
   */
  async timeOperation(operation, fn, context = {}) {
    const startTime = performance.now();
    this.debug(`Starting operation: ${operation}`, context);

    try {
      const result = await fn();
      const duration = performance.now() - startTime;

      this.info(`Operation completed: ${operation}`, {
        ...context,
        duration: `${Math.round(duration * 100) / 100}ms`,
        success: true
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;

      this.error(`Operation failed: ${operation}`, {
        ...context,
        duration: `${Math.round(duration * 100) / 100}ms`,
        success: false
      }, error);

      throw error;
    }
  }

  /**
   * Sets minimum log level
   * @param {string} level - Minimum level to log
   */
  setMinLevel(level) {
    if (level in this.levels) {
      this.minLevel = level;
      this.info(`Log level set to: ${level}`);
    }
  }

  /**
   * Gets recent logs
   * @param {number} limit - Maximum number of logs to return
   * @param {string} level - Filter by log level
   * @returns {Array} Filtered log entries
   */
  getLogs(limit = 100, level = null) {
    let filteredLogs = this.logs;

    if (level && level in this.levels) {
      filteredLogs = filteredLogs.filter(log => log.level === level);
    }

    return filteredLogs.slice(-limit);
  }

  /**
   * Clears all logs
   */
  clearLogs() {
    this.logs = [];
    this.info('Logs cleared');
  }

  /**
   * Exports logs for debugging
   * @returns {string} JSON string of logs
   */
  exportLogs() {
    return JSON.stringify(this.logs, null, 2);
  }
}

// Export singleton instance
export const logger = new Logger();
export default logger;