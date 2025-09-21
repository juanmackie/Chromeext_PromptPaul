import { BaseManager } from '../BaseManager.js';

/**
 * MCP Session Manager for handling MCP session lifecycle
 * Implements the Single Responsibility Principle for session management
 */
export class SessionManager extends BaseManager {
  constructor(mcpManager) {
    super();
    this.mcpManager = mcpManager;
    this.sessions = {};
    this.sessionCleanupTimer = null;
    
    // Constants
    this.SESSION_MAX_AGE = 300000; // 5 minutes
    this.SESSION_CLEANUP_INTERVAL = 60000; // 1 minute
  }

  /**
   * Get an MCP session for a server URL
   * @param {String} mcpServerUrl - URL of the MCP server
   * @returns {Promise<Object>} - MCP session
   */
  async getSession(mcpServerUrl) {
    const existingSession = this.sessions[mcpServerUrl];
    
    if (existingSession && this.isSessionHealthy(existingSession)) {
      console.log(`Returning existing healthy MCP session for: ${mcpServerUrl}`);
      existingSession.lastUsed = Date.now(); // Update last used timestamp
      return existingSession;
    }
    
    if (existingSession && !this.isSessionHealthy(existingSession)) {
      console.log(`Existing session for ${mcpServerUrl} is stale, removing and creating new session`);
      delete this.sessions[mcpServerUrl];
    }
    
    console.log(`No existing session or not initialized, creating new MCP session for: ${mcpServerUrl}`);
    return await this.initializeSession(mcpServerUrl);
  }

  /**
   * Check if an MCP session is healthy
   * @param {Object} session - Session object
   * @returns {Boolean} - Whether the session is healthy
   */
  isSessionHealthy(session) {
    if (!session) return false;
    if (!session.initialized) return false;
    
    const now = Date.now();
    const age = now - (session.lastUsed || session.createdAt || 0);
    
    return age <= this.SESSION_MAX_AGE;
  }

  /**
   * Initialize a new MCP session
   * @param {String} mcpServerUrl - URL of the MCP server
   * @returns {Promise<Object>} - Initialized session
   */
  async initializeSession(mcpServerUrl) {
    console.log(`Initializing new MCP session for: ${mcpServerUrl}`);
    
    try {
      // Create new session object
      const session = {
        mcpServerUrl: mcpServerUrl,
        mcpSessionId: null,
        initialized: false,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        tools: [],
        capabilities: null
      };

      // Send initialize request
      const initResult = await this.sendInitializeRequest(mcpServerUrl, session);
      
      if (initResult.success) {
        session.initialized = true;
        session.mcpSessionId = initResult.sessionId;
        session.capabilities = initResult.capabilities;
        
        // Store session
        this.sessions[mcpServerUrl] = session;
        
        // Send initialized notification
        await this.sendInitializedNotification(mcpServerUrl, session);
        
        // List available tools
        session.tools = await this.listSessionTools(mcpServerUrl, session);
        
        console.log(`Successfully initialized MCP session for ${mcpServerUrl}`);
        return session;
      } else {
        throw new Error(`Failed to initialize session: ${initResult.error}`);
      }
      
    } catch (error) {
      console.error(`Error initializing MCP session for ${mcpServerUrl}:`, error);
      throw error;
    }
  }

  /**
   * Send initialize request to MCP server
   * @param {String} mcpServerUrl - URL of the MCP server
   * @param {Object} session - Session object
   * @returns {Promise<Object>} - Initialize result
   */
  async sendInitializeRequest(mcpServerUrl, session) {
    const requestId = `mcp-init-${Date.now()}`;
    const initPayload = {
      jsonrpc: "2.0",
      id: requestId,
      method: "initialize",
      params: {
        protocolVersion: "1.0.0",
        capabilities: {
          tools: {}
        },
        clientInfo: {
          name: "PromptPaul",
          version: "1.0.0"
        }
      }
    };

    try {
      const response = await this.mcpManager.requestHandler.sendRequest(mcpServerUrl, initPayload);
      
      if (response && response.result) {
        return {
          success: true,
          sessionId: response.id || `session-${Date.now()}`,
          capabilities: response.result.capabilities
        };
      } else {
        return {
          success: false,
          error: 'Invalid initialize response'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send initialized notification
   * @param {String} mcpServerUrl - URL of the MCP server
   * @param {Object} session - Session object
   */
  async sendInitializedNotification(mcpServerUrl, session) {
    try {
      await this.mcpManager.requestHandler.sendNotification(
        mcpServerUrl, 
        'initialized', 
        {}, 
        session.mcpSessionId
      );
    } catch (error) {
      console.warn(`Failed to send initialized notification to ${mcpServerUrl}:`, error);
    }
  }

  /**
   * List tools for a session
   * @param {String} mcpServerUrl - URL of the MCP server
   * @param {Object} session - Session object
   * @returns {Promise<Array>} - Array of tools
   */
  async listSessionTools(mcpServerUrl, session) {
    try {
      const requestId = `mcp-listtools-${Date.now()}`;
      const requestPayload = {
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/list",
        params: {}
      };

      const response = await this.mcpManager.requestHandler.sendRequest(
        mcpServerUrl, 
        requestPayload, 
        session.mcpSessionId
      );

      if (response && response.result && Array.isArray(response.result.tools)) {
        console.log(`Listed ${response.result.tools.length} tools for session ${mcpServerUrl}`);
        return response.result.tools;
      } else {
        console.warn(`Unexpected tools/list response from ${mcpServerUrl}:`, response);
        return [];
      }
    } catch (error) {
      console.error(`Error listing tools for session ${mcpServerUrl}:`, error);
      return [];
    }
  }

  /**
   * Start periodic session cleanup
   */
  startSessionCleanup() {
    if (this.sessionCleanupTimer) {
      return; // Already started
    }

    this.sessionCleanupTimer = setInterval(() => {
      this.cleanupStaleSessions();
    }, this.SESSION_CLEANUP_INTERVAL);

    console.log('Started MCP session cleanup timer');
  }

  /**
   * Stop periodic session cleanup
   */
  stopSessionCleanup() {
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
      this.sessionCleanupTimer = null;
      console.log('Stopped MCP session cleanup timer');
    }
  }

  /**
   * Clean up stale sessions
   */
  cleanupStaleSessions() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [url, session] of Object.entries(this.sessions)) {
      if (!this.isSessionHealthy(session)) {
        delete this.sessions[url];
        cleanedCount++;
        console.log(`Cleaned up stale MCP session for: ${url}`);
      }
    }

    if (cleanedCount > 0) {
      console.log(`MCP session cleanup: Removed ${cleanedCount} stale sessions`);
    }
  }

  /**
   * Clean up all sessions
   */
  cleanupAllSessions() {
    const sessionCount = Object.keys(this.sessions).length;
    this.sessions = {};
    this.stopSessionCleanup();
    
    console.log(`Cleaned up all ${sessionCount} MCP sessions`);
  }

  /**
   * Get session count
   * @returns {Number} - Number of active sessions
   */
  getSessionCount() {
    return Object.keys(this.sessions).length;
  }

  /**
   * Get session info
   * @param {String} mcpServerUrl - URL of the MCP server
   * @returns {Object|null} - Session info or null
   */
  getSessionInfo(mcpServerUrl) {
    const session = this.sessions[mcpServerUrl];
    if (!session) return null;

    return {
      url: mcpServerUrl,
      sessionId: session.mcpSessionId,
      initialized: session.initialized,
      createdAt: session.createdAt,
      lastUsed: session.lastUsed,
      age: Date.now() - session.createdAt,
      toolCount: session.tools.length,
      healthy: this.isSessionHealthy(session)
    };
  }

  /**
   * Get all session info
   * @returns {Array} - Array of session info objects
   */
  getAllSessionsInfo() {
    return Object.keys(this.sessions).map(url => this.getSessionInfo(url));
  }
}