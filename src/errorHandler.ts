// errorHandler.ts - Centralized error handling and retry mechanisms with TypeScript
import type {
  ErrorContext,
  FriendlyErrorMessage,
  RetryOptions,
  EnhancedError
} from './types/index.js';

// Declare trackErrorEvent function for analytics
declare function trackErrorEvent(error: Error, context: Record<string, any>): void;

export class ErrorHandler {
  private retryConfigs: Map<string, RetryOptions> = new Map();
  private errorHistory: Array<{
    timestamp: string;
    error: {
      name: string;
      message: string;
      stack: string | undefined;
      code: string | undefined;
      status: number | undefined;
    };
    context: Record<string, any>;
    userAgent: string;
    url: string;
  }> = [];
  private maxErrorHistory: number = 100;

  constructor() {}

  // Error boundary-like functionality with type safety
  static withErrorBoundary<T extends any[], R>(
    fn: (...args: T) => R | Promise<R>,
    fallback?: (error: Error, ...args: T) => R | Promise<R>
  ): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        console.error('Error boundary caught error:', error);

        if (fallback) {
          return await fallback(error as Error, ...args);
        }

        // Re-throw with enhanced error information
        throw this.enhanceError(error as Error);
      }
    };
  }

  // Enhance error with additional context
  static enhanceError(error: Error, context: Record<string, any> = {}): EnhancedError {
    const enhancedError = new Error(error.message) as EnhancedError;
    enhancedError.name = error.name || 'UnknownError';
    enhancedError.stack = error.stack || '';
    enhancedError.timestamp = new Date().toISOString();
    enhancedError.context = context;
    enhancedError.originalError = error;

    return enhancedError;
  }

  // Network retry mechanism with exponential backoff and type safety
  async withRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const config: Required<RetryOptions> = {
      maxRetries: options.maxRetries || 3,
      baseDelay: options.baseDelay || 1000,
      maxDelay: options.maxDelay || 30000,
      backoffFactor: options.backoffFactor || 2,
      retryCondition: options.retryCondition || this.isRetryableError.bind(this),
      onRetry: options.onRetry || (() => {}),
      ...options
    };

    let lastError: Error;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Log the error
        this.logError(lastError, { attempt, maxRetries: config.maxRetries });

        // Check if we should retry
        if (attempt < config.maxRetries && config.retryCondition(lastError)) {
          const delay = this.calculateDelay(attempt, config);
          console.log(`Retrying operation in ${delay}ms (attempt ${attempt + 1}/${config.maxRetries + 1})`);

          if (config.onRetry) {
            config.onRetry(lastError, attempt, delay);
          }

          await this.delay(delay);
        } else {
          break;
        }
      }
    }

    throw ErrorHandler.enhanceError(lastError!, { retries: config.maxRetries });
  }

  // Calculate delay with exponential backoff and jitter
  private calculateDelay(attempt: number, config: Required<RetryOptions>): number {
    const exponentialDelay = config.baseDelay * Math.pow(config.backoffFactor, attempt);
    const delayWithJitter = exponentialDelay * (0.5 + Math.random() * 0.5); // Add jitter
    return Math.min(delayWithJitter, config.maxDelay);
  }

  // Simple delay utility
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Determine if an error is retryable
  private isRetryableError(error: Error): boolean {
    // Network errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return true;
    }

    // HTTP errors
    const enhancedError = error as EnhancedError;
    if (enhancedError.status) {
      // Retry on 5xx server errors, timeouts, and specific 4xx errors
      return enhancedError.status >= 500 ||
             enhancedError.status === 408 || // Request timeout
             enhancedError.status === 429 || // Too many requests
             enhancedError.status === 502 || // Bad gateway
             enhancedError.status === 503 || // Service unavailable
             enhancedError.status === 504;   // Gateway timeout
    }

    // Connection errors
    if (enhancedError.code === 'ECONNREFUSED' ||
        enhancedError.code === 'ENOTFOUND' ||
        enhancedError.code === 'ECONNRESET' ||
        enhancedError.code === 'ETIMEDOUT') {
      return true;
    }

    return false;
  }

  // Enhanced error logging
  logError(error: Error, context: Record<string, any> = {}): void {
    const enhancedError = error as EnhancedError;
    const errorEntry = {
      timestamp: new Date().toISOString(),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack || undefined,
        code: enhancedError.code || undefined,
        status: enhancedError.status || undefined
      },
      context,
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    this.errorHistory.push(errorEntry);

    // Keep only recent errors
    if (this.errorHistory.length > this.maxErrorHistory) {
      this.errorHistory = this.errorHistory.slice(-this.maxErrorHistory);
    }

    // Log to console with appropriate level
    if (error.name === 'ValidationError' || (error as EnhancedError).status === 400) {
      console.warn('Validation Error:', error);
    } else {
      console.error('Application Error:', error);
    }

    // Could also send to analytics service
    if (typeof trackErrorEvent === 'function') {
      trackErrorEvent(error, context);
    }
  }

  // User-friendly error message generation
  getUserFriendlyMessage(error: Error): FriendlyErrorMessage {
    const enhancedError = error as EnhancedError;

    // Network errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return {
        title: 'Connection Error',
        message: 'Unable to connect to the server. Please check your internet connection and try again.',
        type: 'network',
        suggestions: [
          'Check your internet connection',
          'Try again in a few moments',
          'Contact support if the problem persists'
        ]
      };
    }

    // HTTP status codes
    if (enhancedError.status) {
      switch (enhancedError.status) {
        case 400:
          return {
            title: 'Invalid Request',
            message: 'The request contained invalid data. Please check your input and try again.',
            type: 'validation',
            suggestions: ['Check the information you entered', 'Try refreshing the page']
          };
        case 401:
          return {
            title: 'Authentication Required',
            message: 'You need to log in to continue.',
            type: 'auth',
            suggestions: ['Log in to your account', 'Check your credentials']
          };
        case 403:
          return {
            title: 'Access Denied',
            message: 'You don\'t have permission to perform this action.',
            type: 'auth',
            suggestions: ['Contact your administrator', 'Check your permissions']
          };
        case 404:
          return {
            title: 'Not Found',
            message: 'The requested resource could not be found.',
            type: 'not_found',
            suggestions: ['Check the URL', 'Try refreshing the page']
          };
        case 429:
          return {
            title: 'Too Many Requests',
            message: 'You\'ve made too many requests recently. Please wait before trying again.',
            type: 'rate_limit',
            suggestions: ['Wait a few minutes', 'Reduce request frequency']
          };
        case 500:
        case 502:
        case 503:
        case 504:
          return {
            title: 'Server Error',
            message: 'The server encountered an error. Please try again later.',
            type: 'server',
            suggestions: ['Try again in a few minutes', 'Contact support if the problem persists']
          };
        default:
          return {
            title: 'Request Failed',
            message: 'An unexpected error occurred while processing your request.',
            type: 'unknown',
            suggestions: ['Try again', 'Contact support if the problem persists']
          };
      }
    }

    // Other errors
    if (error.name === 'ValidationError') {
      return {
        title: 'Validation Error',
        message: error.message || 'Please check the information you entered.',
        type: 'validation',
        suggestions: ['Check the highlighted fields', 'Ensure all required fields are filled']
      };
    }

    if (error.name === 'AbortError') {
      return {
        title: 'Request Cancelled',
        message: 'The request was cancelled.',
        type: 'cancelled',
        suggestions: ['Try your request again']
      };
    }

    // Default error message
    return {
      title: 'Something Went Wrong',
      message: error.message || 'An unexpected error occurred.',
      type: 'unknown',
      suggestions: ['Try refreshing the page', 'Contact support if the problem persists']
    };
  }

  // Get error statistics
  getErrorStats() {
    const stats = {
      total: this.errorHistory.length,
      byType: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
      recent: this.errorHistory.slice(-10)
    };

    this.errorHistory.forEach(entry => {
      const errorType = entry.error.name || 'Unknown';
      const status = entry.error.status || 'no_status';

      stats.byType[errorType] = (stats.byType[errorType] || 0) + 1;
      if (status !== 'no_status') {
        stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
      }
    });

    return stats;
  }

  // Clear error history
  clearErrorHistory(): void {
    this.errorHistory = [];
  }

  // Get error history (for debugging)
  getErrorHistory(): typeof this.errorHistory {
    return [...this.errorHistory];
  }
}

// Create global error handler instance
export const errorHandler = new ErrorHandler();

// Global error event listeners
window.addEventListener('error', (event) => {
  errorHandler.logError(event.error || new Error(event.message), {
    source: 'global_error_handler',
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
});

window.addEventListener('unhandledrejection', (event) => {
  errorHandler.logError(event.reason, {
    source: 'unhandled_promise_rejection'
  });
});

// Export convenience functions
export const withErrorBoundary = ErrorHandler.withErrorBoundary;
export const enhanceError = ErrorHandler.enhanceError;

// Type guard for enhanced errors
export function isEnhancedError(error: Error): error is EnhancedError {
  return 'timestamp' in error && 'context' in error;
}