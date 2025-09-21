import { BaseManager } from './BaseManager.js';
import { SessionManager } from './mcp/SessionManager.js';
import { RequestHandler } from './mcp/RequestHandler.js';
import { CircuitBreakerManager } from './mcp/CircuitBreakerManager.js';
import { RetryManager } from './mcp/RetryManager.js';

/**
 * MCP Manager handling all MCP-related operations
 * Implements the Manager pattern for business logic separation
 * Refactored to use specialized managers for better separation of concerns
 */
export class MCPManager extends BaseManager {
  constructor() {
    super();
    
    // Initialize specialized managers
    this.sessionManager = new SessionManager(this);
    this.requestHandler = new RequestHandler(this);
    this.circuitBreakerManager = new CircuitBreakerManager();
    this.retryManager = new RetryManager();
    
    // Legacy properties for backward compatibility
    this.mcpSessions = this.sessionManager.sessions;
    this.mcpCircuitBreakers = this.circuitBreakerManager.circuitBreakers;
    
    // Constants
    this.MCP_SESSION_TIMEOUT = 30000; // 30 seconds
    this.MCP_SESSION_MAX_AGE = 300000; // 5 minutes
    this.MCP_SESSION_CLEANUP_INTERVAL = 60000; // 1 minute
    this.MCP_MAX_RETRY_ATTEMPTS = 3;
    this.MCP_RETRY_DELAY = 1000; // 1 second
  }

  /**
   * Initialize the MCP Manager
   */
  async initialize() {
    console.log('MCPManager: Initializing...');
    
    // Start session cleanup
    this.sessionManager.startSessionCleanup();
    
    this.initialized = true;
    console.log('MCPManager: Initialized successfully');
  }

  /**
   * Get an MCP session for a server URL
   * @param {String} mcpServerUrl - URL of the MCP server
   * @returns {Promise<Object>} - MCP session
   */
  async getMcpSession(mcpServerUrl) {
    // Check circuit breaker
    if (!this.circuitBreakerManager.shouldAllowRequest(mcpServerUrl)) {
      const stats = this.circuitBreakerManager.getStats(mcpServerUrl);
      throw new Error(`Circuit breaker is OPEN for ${mcpServerUrl}. Next attempt in ${Math.round(stats.timeUntilNextAttempt / 1000)}s`);
    }

    try {
      const session = await this.retryManager.retryWithBackoff(
        () => this.sessionManager.getSession(mcpServerUrl),
        {
          maxAttempts: this.MCP_MAX_RETRY_ATTEMPTS,
          baseDelay: this.MCP_RETRY_DELAY,
          context: `getMcpSession(${mcpServerUrl})`,
          retryCondition: this.retryManager.createRetryCondition([
            'timeout',
            'network',
            'connection'
          ])
        }
      );

      // Record success in circuit breaker
      this.circuitBreakerManager.onSuccess(mcpServerUrl);
      
      return session;
      
    } catch (error) {
      // Record failure in circuit breaker
      this.circuitBreakerManager.onFailure(mcpServerUrl, error);
      throw error;
    }
  }

  /**
   * Check if an MCP session is healthy (legacy method)
   * @param {Object} session - Session object
   * @returns {Boolean} - Whether the session is healthy
   */
  isSessionHealthy(session) {
    return this.sessionManager.isSessionHealthy(session);
  }

  /**
   * Initialize an MCP session (legacy method)
   * @param {String} mcpServerUrl - URL of the MCP server
   * @returns {Promise<Object>} - Initialized session
   */
  async initializeMcpSession(mcpServerUrl) {
    return await this.getMcpSession(mcpServerUrl);
  }

  /**
   * Send MCP notification
   * @param {String} mcpServerUrl - URL of the MCP server
   * @param {String} method - Method name
   * @param {Object} params - Parameters for the notification
   */
  async sendMcpNotification(mcpServerUrl, method, params) {
    const session = this.sessionManager.sessions[mcpServerUrl];
    const sessionId = session?.mcpSessionId || null;
    
    try {
      await this.requestHandler.sendNotification(mcpServerUrl, method, params, sessionId);
      this.circuitBreakerManager.onSuccess(mcpServerUrl);
    } catch (error) {
      this.circuitBreakerManager.onFailure(mcpServerUrl, error);
      throw error;
    }
  }

  /**
   * List tools from an MCP server
   * @param {String} mcpServerUrl - URL of the MCP server
   * @param {String} sessionId - Session ID (optional)
   * @returns {Promise<Array>} - Array of tools
   */
  async listMcpTools(mcpServerUrl, sessionId = null) {
    // Check circuit breaker
    if (!this.circuitBreakerManager.shouldAllowRequest(mcpServerUrl)) {
      const stats = this.circuitBreakerManager.getStats(mcpServerUrl);
      throw new Error(`Circuit breaker is OPEN for ${mcpServerUrl}. Next attempt in ${Math.round(stats.timeUntilNextAttempt / 1000)}s`);
    }

    try {
      // Get session if not provided
      if (!sessionId) {
        const session = await this.getMcpSession(mcpServerUrl);
        sessionId = session.mcpSessionId;
      }

      const tools = await this.retryManager.retryWithBackoff(
        () => this.requestHandler.listTools(mcpServerUrl, sessionId),
        {
          maxAttempts: this.MCP_MAX_RETRY_ATTEMPTS,
          baseDelay: this.MCP_RETRY_DELAY,
          context: `listMcpTools(${mcpServerUrl})`
        }
      );

      this.circuitBreakerManager.onSuccess(mcpServerUrl);
      return tools;
      
    } catch (error) {
      this.circuitBreakerManager.onFailure(mcpServerUrl, error);
      throw error;
    }
  }

  /**
   * Call an MCP tool
   * @param {String} mcpServerUrl - URL of the MCP server
   * @param {String} toolName - Name of the tool
   * @param {Object} args - Tool arguments
   * @returns {Promise<Object>} - Tool execution result
   */
  async callMcpTool(mcpServerUrl, toolName, args) {
    // Check circuit breaker
    if (!this.circuitBreakerManager.shouldAllowRequest(mcpServerUrl)) {
      const stats = this.circuitBreakerManager.getStats(mcpServerUrl);
      throw new Error(`Circuit breaker is OPEN for ${mcpServerUrl}. Next attempt in ${Math.round(stats.timeUntilNextAttempt / 1000)}s`);
    }

    try {
      // Get session
      const session = await this.getMcpSession(mcpServerUrl);
      
      const result = await this.retryManager.retryWithBackoff(
        () => this.requestHandler.callTool(mcpServerUrl, toolName, args, session.mcpSessionId),
        {
          maxAttempts: this.MCP_MAX_RETRY_ATTEMPTS,
          baseDelay: this.MCP_RETRY_DELAY,
          context: `callMcpTool(${mcpServerUrl}, ${toolName})`
        }
      );

      this.circuitBreakerManager.onSuccess(mcpServerUrl);
      return result;
      
    } catch (error) {
      this.circuitBreakerManager.onFailure(mcpServerUrl, error);
      throw error;
    }
  }

  /**
   * Test connectivity to an MCP server
   * @param {String} mcpServerUrl - URL of the MCP server
   * @returns {Promise<Object>} - Test result
   */
  async testMcpConnectivity(mcpServerUrl) {
    try {
      const result = await this.requestHandler.testConnectivity(mcpServerUrl);
      
      if (result.success && result.reachable) {
        this.circuitBreakerManager.onSuccess(mcpServerUrl);
      } else {
        this.circuitBreakerManager.onFailure(mcpServerUrl, new Error('Connectivity test failed'));
      }
      
      return result;
      
    } catch (error) {
      this.circuitBreakerManager.onFailure(mcpServerUrl, error);
      throw error;
    }
  }

  /**
   * Get MCP server status
   * @param {String} mcpServerUrl - URL of the MCP server
   * @returns {Object} - Server status
   */
  getMcpServerStatus(mcpServerUrl) {
    const sessionInfo = this.sessionManager.getSessionInfo(mcpServerUrl);
    const circuitBreakerStats = this.circuitBreakerManager.getStats(mcpServerUrl);
    
    return {
      url: mcpServerUrl,
      session: sessionInfo,
      circuitBreaker: circuitBreakerStats,
      healthy: sessionInfo?.healthy && (!circuitBreakerStats || circuitBreakerStats.state !== 'OPEN')
    };
  }

  /**
   * Get all MCP server statuses
   * @returns {Array} - Array of server statuses
   */
  getAllMcpServerStatuses() {
    const sessionUrls = Object.keys(this.sessionManager.sessions);
    const circuitBreakerUrls = Object.keys(this.circuitBreakerManager.circuitBreakers);
    const allUrls = [...new Set([...sessionUrls, ...circuitBreakerUrls])];
    
    return allUrls.map(url => this.getMcpServerStatus(url));
  }

  /**
   * Force reset an MCP server (clear session and circuit breaker)
   * @param {String} mcpServerUrl - URL of the MCP server
   */
  forceResetMcpServer(mcpServerUrl) {
    console.log(`Force resetting MCP server: ${mcpServerUrl}`);
    
    // Remove session
    delete this.sessionManager.sessions[mcpServerUrl];
    
    // Reset circuit breaker
    this.circuitBreakerManager.reset(mcpServerUrl);
    
    console.log(`MCP server ${mcpServerUrl} has been reset`);
  }

  /**
   * Clean up MCP sessions and circuit breakers
   */
  cleanupMcpSessions() {
    console.log('MCP Cleanup: Cleaning up all sessions and circuit breakers');
    
    // Clean up sessions
    this.sessionManager.cleanupAllSessions();
    
    // Clean up circuit breakers
    const breakerCount = this.circuitBreakerManager.clearAll();
    
    console.log('MCP Cleanup: Completed cleanup');
  }

  /**
   * Get MCP manager statistics
   * @returns {Object} - Manager statistics
   */
  getStats() {
    return {
      sessions: {
        count: this.sessionManager.getSessionCount(),
        details: this.sessionManager.getAllSessionsInfo()
      },
      circuitBreakers: {
        count: this.circuitBreakerManager.getCount(),
        openCount: this.circuitBreakerManager.getOpenBreakerUrls().length,
        details: this.circuitBreakerManager.getAllStats()
      },
      healthySessions: this.sessionManager.getAllSessionsInfo().filter(s => s.healthy).length,
      unhealthySessions: this.sessionManager.getAllSessionsInfo().filter(s => !s.healthy).length
    };
  }

  /**
   * Perform health check on all MCP connections
   * @returns {Promise<Object>} - Health check results
   */
  async performHealthCheck() {
    console.log('MCPManager: Performing health check...');
    
    const stats = this.getStats();
    const issues = [];
    
    // Check for stale sessions
    const staleSessions = stats.sessions.details.filter(s => !s.healthy);
    if (staleSessions.length > 0) {
      issues.push(`${staleSessions.length} stale sessions detected`);
    }
    
    // Check for open circuit breakers
    const openBreakers = stats.circuitBreakers.details.filter(cb => cb.state === 'OPEN');
    if (openBreakers.length > 0) {
      issues.push(`${openBreakers.length} circuit breakers are OPEN`);
    }
    
    // Cleanup stale sessions
    this.sessionManager.cleanupStaleSessions();
    
    // Cleanup old circuit breakers
    this.circuitBreakerManager.cleanup();
    
    const healthCheckResult = {
      timestamp: Date.now(),
      healthy: issues.length === 0,
      issues: issues,
      stats: stats
    };
    
    console.log('MCPManager: Health check completed', healthCheckResult);
    return healthCheckResult;
  }

  // Legacy methods for backward compatibility
  async fetchWithTimeout(url, options, timeoutMs) {
    return await this.requestHandler.fetchWithTimeout(url, options, timeoutMs);
  }

  async retryWithBackoff(operation, maxAttempts, baseDelay) {
    return await this.retryManager.retryWithBackoff(operation, {
      maxAttempts: maxAttempts || this.MCP_MAX_RETRY_ATTEMPTS,
      baseDelay: baseDelay || this.MCP_RETRY_DELAY
    });
  }

  async sendMcpRequest(mcpServerUrl, requestPayload) {
    const session = this.sessionManager.sessions[mcpServerUrl];
    const sessionId = session?.mcpSessionId || null;
    return await this.requestHandler.sendRequest(mcpServerUrl, requestPayload, sessionId);
  }
}