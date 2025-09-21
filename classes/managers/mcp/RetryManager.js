import { BaseManager } from '../BaseManager.js';

/**
 * MCP Retry Manager for handling retry logic with exponential backoff
 * Implements the Single Responsibility Principle for retry logic
 */
export class RetryManager extends BaseManager {
  constructor() {
    super();
    
    // Retry constants
    this.MAX_RETRY_ATTEMPTS = 3;
    this.BASE_DELAY = 1000; // 1 second
    this.MAX_DELAY = 30000; // 30 seconds
    this.BACKOFF_MULTIPLIER = 2;
    this.JITTER_FACTOR = 0.1; // 10% jitter
  }

  /**
   * Retry an operation with exponential backoff
   * @param {Function} operation - Operation to retry
   * @param {Object} options - Retry options
   * @returns {Promise<Any>} - Result of the operation
   */
  async retryWithBackoff(operation, options = {}) {
    const {
      maxAttempts = this.MAX_RETRY_ATTEMPTS,
      baseDelay = this.BASE_DELAY,
      maxDelay = this.MAX_DELAY,
      backoffMultiplier = this.BACKOFF_MULTIPLIER,
      jitterFactor = this.JITTER_FACTOR,
      retryCondition = this.defaultRetryCondition,
      onRetry = null,
      context = 'operation'
    } = options;

    let lastError;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      
      try {
        const result = await operation();
        
        if (attempt > 1) {
          console.log(`${context}: Succeeded on attempt ${attempt}`);
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        console.log(`${context}: Attempt ${attempt} failed:`, error.message);
        
        // Check if we should retry this error
        if (!retryCondition(error, attempt)) {
          console.log(`${context}: Not retrying due to retry condition`);
          break;
        }
        
        // Don't delay after the last attempt
        if (attempt >= maxAttempts) {
          break;
        }
        
        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt, baseDelay, maxDelay, backoffMultiplier, jitterFactor);
        
        console.log(`${context}: Retrying in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})`);
        
        // Call retry callback if provided
        if (onRetry) {
          try {
            await onRetry(error, attempt, delay);
          } catch (callbackError) {
            console.warn(`${context}: Retry callback failed:`, callbackError);
          }
        }
        
        // Wait before next attempt
        await this.delay(delay);
      }
    }

    // All attempts failed
    console.error(`${context}: All ${maxAttempts} attempts failed. Last error:`, lastError);
    throw lastError;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   * @param {Number} attempt - Current attempt number (1-based)
   * @param {Number} baseDelay - Base delay in milliseconds
   * @param {Number} maxDelay - Maximum delay in milliseconds
   * @param {Number} backoffMultiplier - Backoff multiplier
   * @param {Number} jitterFactor - Jitter factor (0-1)
   * @returns {Number} - Delay in milliseconds
   */
  calculateDelay(attempt, baseDelay, maxDelay, backoffMultiplier, jitterFactor) {
    // Exponential backoff: baseDelay * (backoffMultiplier ^ (attempt - 1))
    const exponentialDelay = baseDelay * Math.pow(backoffMultiplier, attempt - 1);
    
    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, maxDelay);
    
    // Add jitter to avoid thundering herd
    const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1); // ±jitterFactor%
    const finalDelay = Math.max(0, cappedDelay + jitter);
    
    return Math.round(finalDelay);
  }

  /**
   * Default retry condition
   * @param {Error} error - The error that occurred
   * @param {Number} attempt - Current attempt number
   * @returns {Boolean} - Whether to retry
   */
  defaultRetryCondition(error, attempt) {
    // Don't retry on certain HTTP status codes
    if (error.message.includes('400') || // Bad Request
        error.message.includes('401') || // Unauthorized
        error.message.includes('403') || // Forbidden
        error.message.includes('404') || // Not Found
        error.message.includes('422')) { // Unprocessable Entity
      return false;
    }
    
    // Don't retry on certain error types
    if (error.name === 'TypeError' || 
        error.name === 'SyntaxError' ||
        error.message.includes('Invalid JSON')) {
      return false;
    }
    
    // Retry on network errors, timeouts, and server errors
    return true;
  }

  /**
   * Create a retry condition for specific error types
   * @param {Array} retryableErrors - Array of error conditions to retry
   * @returns {Function} - Retry condition function
   */
  createRetryCondition(retryableErrors = []) {
    return (error, attempt) => {
      // First check default conditions
      if (!this.defaultRetryCondition(error, attempt)) {
        return false;
      }
      
      // If no specific conditions provided, use default
      if (retryableErrors.length === 0) {
        return true;
      }
      
      // Check if error matches any retryable condition
      return retryableErrors.some(condition => {
        if (typeof condition === 'string') {
          return error.message.includes(condition);
        } else if (condition instanceof RegExp) {
          return condition.test(error.message);
        } else if (typeof condition === 'function') {
          return condition(error, attempt);
        }
        return false;
      });
    };
  }

  /**
   * Retry with linear backoff (constant delay)
   * @param {Function} operation - Operation to retry
   * @param {Object} options - Retry options
   * @returns {Promise<Any>} - Result of the operation
   */
  async retryWithLinearBackoff(operation, options = {}) {
    return this.retryWithBackoff(operation, {
      ...options,
      backoffMultiplier: 1 // Linear backoff
    });
  }

  /**
   * Retry with fixed delay
   * @param {Function} operation - Operation to retry
   * @param {Number} delay - Fixed delay in milliseconds
   * @param {Number} maxAttempts - Maximum number of attempts
   * @returns {Promise<Any>} - Result of the operation
   */
  async retryWithFixedDelay(operation, delay = this.BASE_DELAY, maxAttempts = this.MAX_RETRY_ATTEMPTS) {
    return this.retryWithBackoff(operation, {
      maxAttempts,
      baseDelay: delay,
      backoffMultiplier: 1,
      jitterFactor: 0
    });
  }

  /**
   * Retry immediately (no delay between attempts)
   * @param {Function} operation - Operation to retry
   * @param {Number} maxAttempts - Maximum number of attempts
   * @returns {Promise<Any>} - Result of the operation
   */
  async retryImmediate(operation, maxAttempts = this.MAX_RETRY_ATTEMPTS) {
    return this.retryWithBackoff(operation, {
      maxAttempts,
      baseDelay: 0,
      backoffMultiplier: 1,
      jitterFactor: 0
    });
  }

  /**
   * Delay execution for specified milliseconds
   * @param {Number} ms - Milliseconds to delay
   * @returns {Promise<void>} - Promise that resolves after delay
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a retryable version of a function
   * @param {Function} fn - Function to make retryable
   * @param {Object} options - Retry options
   * @returns {Function} - Retryable function
   */
  makeRetryable(fn, options = {}) {
    return async (...args) => {
      return this.retryWithBackoff(
        () => fn(...args),
        options
      );
    };
  }

  /**
   * Get retry statistics for monitoring
   * @param {Number} attempt - Current attempt number
   * @param {Number} maxAttempts - Maximum attempts
   * @param {Number} baseDelay - Base delay
   * @returns {Object} - Retry statistics
   */
  getRetryStats(attempt, maxAttempts, baseDelay) {
    const remainingAttempts = maxAttempts - attempt;
    const nextDelay = attempt < maxAttempts ? 
      this.calculateDelay(attempt + 1, baseDelay, this.MAX_DELAY, this.BACKOFF_MULTIPLIER, this.JITTER_FACTOR) : 0;
    
    return {
      currentAttempt: attempt,
      maxAttempts: maxAttempts,
      remainingAttempts: remainingAttempts,
      nextDelay: nextDelay,
      progress: attempt / maxAttempts
    };
  }
}