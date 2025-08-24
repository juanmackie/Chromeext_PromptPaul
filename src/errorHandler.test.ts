// errorHandler.test.ts - Test suite for error handling functionality
import { ErrorHandler, errorHandler, withErrorBoundary, enhanceError } from './errorHandler.js';
import type { EnhancedError } from './types/index.js';

describe('ErrorHandler', () => {
  let mockTrackErrorEvent: jest.MockedFunction<any>;

  beforeEach(() => {
    // Mock the global trackErrorEvent function
    mockTrackErrorEvent = jest.fn();
    global.trackErrorEvent = mockTrackErrorEvent;

    // Clear error history before each test
    errorHandler.clearErrorHistory();

    // Mock console methods
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('enhanceError', () => {
    it('should enhance a basic error with additional context', () => {
      const originalError = new Error('Test error');
      const context = { userId: '123', action: 'test' };

      const enhancedError = ErrorHandler.enhanceError(originalError, context);

      expect(enhancedError.message).toBe('Test error');
      expect(enhancedError.timestamp).toBeDefined();
      expect(enhancedError.context).toEqual(context);
      expect(enhancedError.originalError).toBe(originalError);
    });

    it('should preserve error name and stack', () => {
      const originalError = new Error('Test error');
      originalError.name = 'CustomError';
      originalError.stack = 'Custom stack trace';

      const enhancedError = ErrorHandler.enhanceError(originalError);

      expect(enhancedError.name).toBe('CustomError');
      expect(enhancedError.stack).toBe('Custom stack trace');
    });
  });

  describe('withErrorBoundary', () => {
    it('should return successful result when function succeeds', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      const wrappedFn = ErrorHandler.withErrorBoundary(mockFn);

      const result = await wrappedFn('arg1', 'arg2');

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should call fallback when function throws', async () => {
      const error = new Error('Test error');
      const mockFn = jest.fn().mockRejectedValue(error);
      const fallback = jest.fn().mockResolvedValue('fallback result');

      const wrappedFn = ErrorHandler.withErrorBoundary(mockFn, fallback);

      const result = await wrappedFn();

      expect(result).toBe('fallback result');
      expect(fallback).toHaveBeenCalledWith(error);
    });

    it('should re-throw enhanced error when no fallback provided', async () => {
      const error = new Error('Test error');
      const mockFn = jest.fn().mockRejectedValue(error);

      const wrappedFn = ErrorHandler.withErrorBoundary(mockFn);

      await expect(wrappedFn()).rejects.toThrow();
    });
  });

  describe('withRetry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should succeed on first attempt', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      const result = await errorHandler.withRetry(mockOperation);

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('success');

      const result = await errorHandler.withRetry(mockOperation, { maxRetries: 2 });

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('should stop retrying after max attempts', async () => {
      const error = new Error('Persistent error');
      const mockOperation = jest.fn().mockRejectedValue(error);

      await expect(errorHandler.withRetry(mockOperation, { maxRetries: 2 })).rejects.toThrow();

      expect(mockOperation).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should respect retry condition', async () => {
      const retryableError = new Error('Retryable error');
      (retryableError as any).status = 500;

      const nonRetryableError = new Error('Non-retryable error');
      (nonRetryableError as any).status = 400;

      const mockOperation = jest.fn().mockRejectedValue(nonRetryableError);

      await expect(errorHandler.withRetry(mockOperation)).rejects.toThrow();

      expect(mockOperation).toHaveBeenCalledTimes(1); // No retries for 400 error
    });

    it('should call onRetry callback', async () => {
      const mockOnRetry = jest.fn();
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('success');

      await errorHandler.withRetry(mockOperation, {
        maxRetries: 1,
        onRetry: mockOnRetry
      });

      expect(mockOnRetry).toHaveBeenCalledWith(
        expect.any(Error),
        0,
        expect.any(Number)
      );
    });
  });

  describe('logError', () => {
    it('should log error to history', () => {
      const error = new Error('Test error');
      const context = { component: 'TestComponent' };

      errorHandler.logError(error, context);

      const stats = errorHandler.getErrorStats();
      expect(stats.total).toBe(1);
      expect(stats.byType['Error']).toBe(1);
    });

    it('should limit error history size', () => {
      // Fill history beyond max
      for (let i = 0; i < 120; i++) {
        errorHandler.logError(new Error(`Error ${i}`));
      }

      const stats = errorHandler.getErrorStats();
      expect(stats.total).toBe(100); // Should be capped at 100
    });

    it('should call trackErrorEvent if available', () => {
      const error = new Error('Test error');
      const context = { component: 'TestComponent' };

      errorHandler.logError(error, context);

      expect(mockTrackErrorEvent).toHaveBeenCalledWith(error, context);
    });
  });

  describe('getUserFriendlyMessage', () => {
    it('should return user-friendly message for network errors', () => {
      const error = new Error('fetch failed');
      error.name = 'TypeError';

      const message = errorHandler.getUserFriendlyMessage(error);

      expect(message.title).toBe('Connection Error');
      expect(message.type).toBe('network');
      expect(message.suggestions).toContain('Check your internet connection');
    });

    it('should return user-friendly message for HTTP errors', () => {
      const error = new Error('Bad Request');
      (error as EnhancedError).status = 400;

      const message = errorHandler.getUserFriendlyMessage(error);

      expect(message.title).toBe('Invalid Request');
      expect(message.type).toBe('validation');
    });

    it('should return user-friendly message for server errors', () => {
      const error = new Error('Internal Server Error');
      (error as EnhancedError).status = 500;

      const message = errorHandler.getUserFriendlyMessage(error);

      expect(message.title).toBe('Server Error');
      expect(message.type).toBe('server');
    });

    it('should return default message for unknown errors', () => {
      const error = new Error('Unknown error');

      const message = errorHandler.getUserFriendlyMessage(error);

      expect(message.title).toBe('Something Went Wrong');
      expect(message.type).toBe('unknown');
    });
  });

  describe('isRetryableError', () => {
    it('should identify retryable network errors', () => {
      const fetchError = new Error('fetch failed');
      fetchError.name = 'TypeError';

      expect((errorHandler as any).isRetryableError(fetchError)).toBe(true);
    });

    it('should identify retryable HTTP status codes', () => {
      const serverError = new Error('Server Error');
      (serverError as EnhancedError).status = 500;

      const rateLimitError = new Error('Too Many Requests');
      (rateLimitError as EnhancedError).status = 429;

      const clientError = new Error('Bad Request');
      (clientError as EnhancedError).status = 400;

      expect((errorHandler as any).isRetryableError(serverError)).toBe(true);
      expect((errorHandler as any).isRetryableError(rateLimitError)).toBe(true);
      expect((errorHandler as any).isRetryableError(clientError)).toBe(false);
    });

    it('should identify retryable connection errors', () => {
      const connectionError = new Error('Connection refused');
      (connectionError as any).code = 'ECONNREFUSED';

      expect((errorHandler as any).isRetryableError(connectionError)).toBe(true);
    });
  });

  describe('getErrorStats', () => {
    it('should return error statistics', () => {
      errorHandler.logError(new Error('Error 1'));
      errorHandler.logError(new Error('Error 2'));

      const stats = errorHandler.getErrorStats();

      expect(stats.total).toBe(2);
      expect(stats.byType['Error']).toBe(2);
      expect(stats.recent).toHaveLength(2);
    });
  });

  describe('global error handlers', () => {
    it('should handle unhandled promise rejections', () => {
      const error = new Error('Unhandled promise rejection');

      // Simulate unhandled rejection
      window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
        reason: error
      }));

      const stats = errorHandler.getErrorStats();
      expect(stats.total).toBe(1);
    });

    it('should handle global errors', () => {
      const error = new Error('Global error');

      // Simulate global error
      window.dispatchEvent(new ErrorEvent('error', {
        error,
        message: 'Global error',
        filename: 'test.js',
        lineno: 10,
        colno: 5
      }));

      const stats = errorHandler.getErrorStats();
      expect(stats.total).toBe(1);
    });
  });
});