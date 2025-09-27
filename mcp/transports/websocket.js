/**
 * WebSocket Transport Implementation
 * Single Responsibility: Handle WebSocket-based MCP servers
 * Testability: Dependency injection for WebSocket client
 */

import { McpTransport } from './base.js';

export class WebSocketTransport extends McpTransport {
  constructor(config, webSocketClient = null, logger = console) {
    super(config, logger);
    this.webSocketClient = webSocketClient || new WebSocketClient();
    this.ws = null;
    this.pingInterval = null;
    this.pongTimeout = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.isReconnecting = false;
    this.lastPingTime = 0;
  }

  /**
   * Validate WebSocket specific configuration
   */
  validateConfig(config) {
    const baseConfig = super.validateConfig(config);
    
    if (!baseConfig.url || typeof baseConfig.url !== 'string') {
      throw new Error('WebSocket transport requires url string');
    }

    try {
      const url = new URL(baseConfig.url);
      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        throw new Error('WebSocket URL must use ws:// or wss:// protocol');
      }
    } catch (error) {
      throw new Error('Invalid WebSocket URL format');
    }

    return {
      url: baseConfig.url,
      auth: baseConfig.auth || '',
      headers: baseConfig.headers || {},
      timeout: baseConfig.timeout || 30000,
      pingInterval: baseConfig.pingInterval || 30000,
      pongTimeout: baseConfig.pongTimeout || 5000,
      reconnect: baseConfig.reconnect !== false,
      maxReconnectAttempts: baseConfig.maxReconnectAttempts || 5,
      reconnectDelay: baseConfig.reconnectDelay || 1000,
      backoffFactor: baseConfig.backoffFactor || 2,
      backoffJitter: baseConfig.backoffJitter || 0.2
    };
  }

  /**
   * Connect to MCP server via WebSocket
   */
  async connect() {
    if (this.isConnected) {
      this.logger.warn('WebSocket transport already connected');
      return;
    }

    try {
      this.logger.info(`Connecting to MCP WebSocket server: ${this.config.url}`);
      
      const headers = { ...this.config.headers };
      
      // Add authentication header if provided
      if (this.config.auth) {
        headers['Authorization'] = this.config.auth;
      }

      this.ws = await this.webSocketClient.connect({
        url: this.config.url,
        headers: headers,
        timeout: this.config.timeout
      });

      this.setupWebSocketHandlers();
      this.startHeartbeat();
      this.setConnected(true);
      this.reconnectAttempts = 0;
      
      this.logger.info('Connected to MCP WebSocket server');
    } catch (error) {
      this.logger.error('Failed to connect to MCP WebSocket server:', error);
      this.emit('error', { error, transportId: this.connectionId });
      throw error;
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  setupWebSocketHandlers() {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.logger.debug('WebSocket connection opened');
      this.emit('wsConnected', { transportId: this.connectionId });
    };

    this.ws.onmessage = (event) => {
      this.handleWebSocketMessage(event);
    };

    this.ws.onerror = (error) => {
      this.handleWebSocketError(error);
    };

    this.ws.onclose = (event) => {
      this.handleWebSocketClose(event);
    };
  }

  /**
   * Handle WebSocket message events
   */
  handleWebSocketMessage(event) {
    try {
      // Handle ping/pong for heartbeat
      if (event.data === 'ping') {
        this.sendPong();
        return;
      }

      if (event.data === 'pong') {
        this.handlePong();
        return;
      }

      // Parse JSON-RPC message
      const message = JSON.parse(event.data);
      this.validateMessage(message);
      this.emit('message', { message, transportId: this.connectionId });
    } catch (error) {
      this.logger.warn('Invalid WebSocket message received:', event.data, error);
      this.emit('invalidMessage', { 
        data: event.data, 
        error, 
        transportId: this.connectionId 
      });
    }
  }

  /**
   * Handle WebSocket errors
   */
  handleWebSocketError(error) {
    this.logger.error('WebSocket connection error:', error);
    this.emit('error', { error, transportId: this.connectionId });
  }

  /**
   * Handle WebSocket close events
   */
  handleWebSocketClose(event) {
    this.logger.warn(`WebSocket connection closed: ${event.code} - ${event.reason}`);
    this.setConnected(false);
    this.stopHeartbeat();
    this.ws = null;

    // Attempt reconnection based on close code
    if (this.shouldReconnect(event.code) && 
        this.config.reconnect && 
        !this.isReconnecting) {
      this.attemptReconnect();
    } else {
      this.emit('connectionClosed', { 
        code: event.code, 
        reason: event.reason, 
        transportId: this.connectionId 
      });
    }
  }

  /**
   * Determine if reconnection should be attempted based on close code
   */
  shouldReconnect(code) {
    // Don't reconnect for certain close codes
    const noReconnectCodes = [
      1000, // Normal closure
      1001, // Going away
      1003, // Unsupported data
      1007, // Invalid data
      1008, // Policy violation
      1011  // Server error
    ];

    return !noReconnectCodes.includes(code);
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  async attemptReconnect() {
    if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    // Calculate delay with exponential backoff and jitter
    const baseDelay = this.config.reconnectDelay * Math.pow(this.config.backoffFactor, this.reconnectAttempts - 1);
    const jitter = baseDelay * this.config.backoffJitter * (Math.random() * 2 - 1);
    const delay = Math.max(0, baseDelay + jitter);

    this.logger.info(`Attempting to reconnect in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.connect();
        this.emit('reconnected', { 
          attempts: this.reconnectAttempts, 
          transportId: this.connectionId 
        });
      } catch (error) {
        this.logger.error('Failed to reconnect:', error);
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.emit('reconnectFailed', { 
            attempts: this.reconnectAttempts, 
            error, 
            transportId: this.connectionId 
          });
        }
      } finally {
        this.isReconnecting = false;
      }
    }, delay);
  }

  /**
   * Start heartbeat mechanism
   */
  startHeartbeat() {
    if (this.config.pingInterval <= 0) return;

    this.stopHeartbeat(); // Clear any existing interval

    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, this.config.pingInterval);
  }

  /**
   * Stop heartbeat mechanism
   */
  stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  /**
   * Send ping message
   */
  sendPing() {
    if (!this.isConnected || !this.ws) return;

    try {
      this.lastPingTime = Date.now();
      this.ws.send('ping');

      // Set timeout for pong response
      this.pongTimeout = setTimeout(() => {
        this.logger.warn('Pong timeout, closing connection');
        this.ws?.close(1002, 'Pong timeout');
      }, this.config.pongTimeout);

    } catch (error) {
      this.logger.error('Failed to send ping:', error);
    }
  }

  /**
   * Send pong message
   */
  sendPong() {
    if (!this.isConnected || !this.ws) return;

    try {
      this.ws.send('pong');
    } catch (error) {
      this.logger.error('Failed to send pong:', error);
    }
  }

  /**
   * Handle pong response
   */
  handlePong() {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }

    const latency = Date.now() - this.lastPingTime;
    this.emit('heartbeat', { 
      latency, 
      transportId: this.connectionId 
    });
  }

  /**
   * Send message to MCP server via WebSocket
   */
  async send(message) {
    if (!this.isConnected || !this.ws) {
      throw new Error('WebSocket transport not connected');
    }

    const messageStr = JSON.stringify(message);
    
    return new Promise((resolve, reject) => {
      try {
        this.ws.send(messageStr);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect() {
    if (!this.isConnected) {
      return;
    }

    this.logger.info('Disconnecting WebSocket transport');
    this.setConnected(false);
    this.stopHeartbeat();

    if (this.ws) {
      try {
        this.ws.close(1000, 'Normal closure');
      } catch (error) {
        this.logger.warn('Error during WebSocket close:', error);
      }
      this.ws = null;
    }

    this.reconnectAttempts = 0;
  }

  /**
   * Get transport type
   */
  getType() {
    return 'websocket';
  }

  /**
   * Get connection latency from last heartbeat
   */
  getLatency() {
    return this.lastPingTime > 0 ? Date.now() - this.lastPingTime : null;
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.disconnect();
    super.destroy();
  }
}

/**
 * WebSocket Client for dependency injection and testing
 * Single Responsibility: Abstract WebSocket operations for testability
 */
class WebSocketClient {
  async connect(options) {
    const { url, headers, timeout } = options;
    
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      
      const timeoutId = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, timeout);

      ws.onopen = () => {
        clearTimeout(timeoutId);
        resolve(ws);
      };

      ws.onerror = (error) => {
        clearTimeout(timeoutId);
        reject(error);
      };
    });
  }
}

export { WebSocketClient };