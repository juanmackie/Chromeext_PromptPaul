import { BaseManager } from '../BaseManager.js';

/**
 * MCP Circuit Breaker Manager for handling failure resilience
 * Implements the Single Responsibility Principle for circuit breaker logic
 */
export class CircuitBreakerManager extends BaseManager {
  constructor() {
    super();
    this.circuitBreakers = {};
    
    // Circuit breaker constants
    this.FAILURE_THRESHOLD = 5;
    this.RECOVERY_TIMEOUT = 60000; // 1 minute
    this.HALF_OPEN_MAX_CALLS = 3;
  }

  /**
   * Get circuit breaker state for a server
   * @param {String} mcpServerUrl - URL of the MCP server
   * @returns {String} - Circuit breaker state (CLOSED, OPEN, HALF_OPEN)
   */
  getState(mcpServerUrl) {
    const breaker = this.circuitBreakers[mcpServerUrl];
    if (!breaker) {
      return 'CLOSED';
    }

    // Check if we should transition from OPEN to HALF_OPEN
    if (breaker.state === 'OPEN' && Date.now() > breaker.nextAttempt) {
      breaker.state = 'HALF_OPEN';
      breaker.halfOpenCalls = 0;
      console.log(`Circuit breaker for ${mcpServerUrl} transitioned to HALF_OPEN`);
    }

    return breaker.state;
  }

  /**
   * Check if a request should be allowed
   * @param {String} mcpServerUrl - URL of the MCP server
   * @returns {Boolean} - Whether the request should be allowed
   */
  shouldAllowRequest(mcpServerUrl) {
    const state = this.getState(mcpServerUrl);
    
    switch (state) {
      case 'CLOSED':
        return true;
        
      case 'OPEN':
        return false;
        
      case 'HALF_OPEN':
        const breaker = this.circuitBreakers[mcpServerUrl];
        return breaker.halfOpenCalls < this.HALF_OPEN_MAX_CALLS;
        
      default:
        return true;
    }
  }

  /**
   * Record a successful request
   * @param {String} mcpServerUrl - URL of the MCP server
   */
  onSuccess(mcpServerUrl) {
    const breaker = this.circuitBreakers[mcpServerUrl];
    
    if (!breaker) {
      return; // No breaker exists, nothing to do
    }

    if (breaker.state === 'HALF_OPEN') {
      breaker.halfOpenCalls++;
      
      // If we've had enough successful calls in HALF_OPEN, close the circuit
      if (breaker.halfOpenCalls >= this.HALF_OPEN_MAX_CALLS) {
        breaker.state = 'CLOSED';
        breaker.failureCount = 0;
        breaker.halfOpenCalls = 0;
        console.log(`Circuit breaker for ${mcpServerUrl} transitioned to CLOSED after successful recovery`);
      }
    } else if (breaker.state === 'CLOSED') {
      // Reset failure count on success
      breaker.failureCount = 0;
    }

    breaker.lastActivity = Date.now();
  }

  /**
   * Record a failed request
   * @param {String} mcpServerUrl - URL of the MCP server
   * @param {Error} error - The error that occurred
   */
  onFailure(mcpServerUrl, error) {
    let breaker = this.circuitBreakers[mcpServerUrl];
    
    if (!breaker) {
      breaker = this.createCircuitBreaker(mcpServerUrl);
    }

    breaker.failureCount++;
    breaker.lastError = error.message;
    breaker.lastActivity = Date.now();

    // Check if we should open the circuit
    if (breaker.state === 'CLOSED' && breaker.failureCount >= this.FAILURE_THRESHOLD) {
      breaker.state = 'OPEN';
      breaker.nextAttempt = Date.now() + this.RECOVERY_TIMEOUT;
      console.log(`Circuit breaker for ${mcpServerUrl} OPENED after ${breaker.failureCount} failures`);
    } else if (breaker.state === 'HALF_OPEN') {
      // If we fail in HALF_OPEN, go back to OPEN
      breaker.state = 'OPEN';
      breaker.nextAttempt = Date.now() + this.RECOVERY_TIMEOUT;
      breaker.halfOpenCalls = 0;
      console.log(`Circuit breaker for ${mcpServerUrl} returned to OPEN after failure in HALF_OPEN`);
    }
  }

  /**
   * Create a new circuit breaker for a server
   * @param {String} mcpServerUrl - URL of the MCP server
   * @returns {Object} - Circuit breaker object
   */
  createCircuitBreaker(mcpServerUrl) {
    const breaker = {
      state: 'CLOSED',
      failureCount: 0,
      nextAttempt: 0,
      halfOpenCalls: 0,
      lastError: null,
      lastActivity: Date.now(),
      createdAt: Date.now()
    };

    this.circuitBreakers[mcpServerUrl] = breaker;
    console.log(`Created circuit breaker for ${mcpServerUrl}`);
    
    return breaker;
  }

  /**
   * Force open a circuit breaker
   * @param {String} mcpServerUrl - URL of the MCP server
   * @param {Number} timeoutMs - How long to keep it open (optional)
   */
  forceOpen(mcpServerUrl, timeoutMs = this.RECOVERY_TIMEOUT) {
    let breaker = this.circuitBreakers[mcpServerUrl];
    
    if (!breaker) {
      breaker = this.createCircuitBreaker(mcpServerUrl);
    }

    breaker.state = 'OPEN';
    breaker.nextAttempt = Date.now() + timeoutMs;
    breaker.lastActivity = Date.now();
    
    console.log(`Forced circuit breaker OPEN for ${mcpServerUrl} for ${timeoutMs}ms`);
  }

  /**
   * Force close a circuit breaker
   * @param {String} mcpServerUrl - URL of the MCP server
   */
  forceClose(mcpServerUrl) {
    let breaker = this.circuitBreakers[mcpServerUrl];
    
    if (!breaker) {
      breaker = this.createCircuitBreaker(mcpServerUrl);
    }

    breaker.state = 'CLOSED';
    breaker.failureCount = 0;
    breaker.halfOpenCalls = 0;
    breaker.lastActivity = Date.now();
    
    console.log(`Forced circuit breaker CLOSED for ${mcpServerUrl}`);
  }

  /**
   * Reset a circuit breaker
   * @param {String} mcpServerUrl - URL of the MCP server
   */
  reset(mcpServerUrl) {
    delete this.circuitBreakers[mcpServerUrl];
    console.log(`Reset circuit breaker for ${mcpServerUrl}`);
  }

  /**
   * Get circuit breaker stats
   * @param {String} mcpServerUrl - URL of the MCP server
   * @returns {Object|null} - Circuit breaker stats
   */
  getStats(mcpServerUrl) {
    const breaker = this.circuitBreakers[mcpServerUrl];
    if (!breaker) {
      return null;
    }

    return {
      url: mcpServerUrl,
      state: breaker.state,
      failureCount: breaker.failureCount,
      lastError: breaker.lastError,
      lastActivity: breaker.lastActivity,
      nextAttempt: breaker.nextAttempt,
      timeUntilNextAttempt: Math.max(0, breaker.nextAttempt - Date.now()),
      halfOpenCalls: breaker.halfOpenCalls,
      age: Date.now() - breaker.createdAt
    };
  }

  /**
   * Get all circuit breaker stats
   * @returns {Array} - Array of circuit breaker stats
   */
  getAllStats() {
    return Object.keys(this.circuitBreakers).map(url => this.getStats(url));
  }

  /**
   * Clean up old circuit breakers
   * @param {Number} maxAge - Maximum age in milliseconds (default: 1 hour)
   */
  cleanup(maxAge = 3600000) {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [url, breaker] of Object.entries(this.circuitBreakers)) {
      const age = now - breaker.lastActivity;
      
      if (age > maxAge) {
        delete this.circuitBreakers[url];
        cleanedCount++;
        console.log(`Cleaned up old circuit breaker for ${url} (age: ${Math.round(age / 1000)}s)`);
      }
    }

    if (cleanedCount > 0) {
      console.log(`Circuit breaker cleanup: Removed ${cleanedCount} old breakers`);
    }

    return cleanedCount;
  }

  /**
   * Clear all circuit breakers
   */
  clearAll() {
    const count = Object.keys(this.circuitBreakers).length;
    this.circuitBreakers = {};
    console.log(`Cleared all ${count} circuit breakers`);
    return count;
  }

  /**
   * Get circuit breaker count
   * @returns {Number} - Number of active circuit breakers
   */
  getCount() {
    return Object.keys(this.circuitBreakers).length;
  }

  /**
   * Check if any circuit breakers are open
   * @returns {Boolean} - Whether any breakers are open
   */
  hasOpenBreakers() {
    return Object.values(this.circuitBreakers).some(breaker => breaker.state === 'OPEN');
  }

  /**
   * Get open circuit breaker URLs
   * @returns {Array} - Array of URLs with open circuit breakers
   */
  getOpenBreakerUrls() {
    return Object.entries(this.circuitBreakers)
      .filter(([, breaker]) => breaker.state === 'OPEN')
      .map(([url]) => url);
  }
}