/**
 * Base Transport Abstract Class
 * Single Responsibility: Define transport contract for MCP communication
 * Testability: Event-driven architecture with dependency injection
 */

export class McpTransport {
  constructor(config, logger = console) {
    this.config = this.validateConfig(config);
    this.logger = logger;
    this.isConnected = false;
    this.eventHandlers = new Map();
    this.messageQueue = [];
    this.connectionId = Math.random().toString(36).substring(7);
  }

  /**
   * Abstract methods - must be implemented by subclasses
   */
  async connect() {
    throw new Error('connect() must be implemented by subclass');
  }

  async disconnect() {
    throw new Error('disconnect() must be implemented by subclass');
  }

  async send(message) {
    throw new Error('send() must be implemented by subclass');
  }

  /**
   * Event handling for loose coupling
   */
  on(event, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Event handler must be a function');
    }

    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  off(event, handler) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        this.logger.error(`Error in event handler for ${event}:`, error);
      }
    });
  }

  /**
   * Message validation following MCP JSON-RPC 2.0 spec
   */
  validateMessage(message) {
    if (!message || typeof message !== 'object') {
      throw new Error('Message must be an object');
    }

    if (!message.jsonrpc || message.jsonrpc !== '2.0') {
      throw new Error('Message must have jsonrpc: "2.0"');
    }

    // Validate method for requests
    if (message.method && typeof message.method !== 'string') {
      throw new Error('Method must be a string');
    }

    // Validate id for requests/responses
    if (message.id !== undefined && 
        typeof message.id !== 'string' && 
        typeof message.id !== 'number' && 
        message.id !== null) {
      throw new Error('ID must be string, number, or null');
    }

    return true;
  }

  /**
   * Configuration validation - override in subclasses for specific needs
   */
  validateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Configuration must be an object');
    }
    return config;
  }

  /**
   * Safe message sending with validation
   */
  async safeSend(message) {
    try {
      this.validateMessage(message);
      
      if (!this.isConnected) {
        this.messageQueue.push(message);
        this.logger.warn('Transport not connected, message queued');
        return false;
      }

      await this.send(message);
      this.emit('messageSent', { message, transportId: this.connectionId });
      return true;
    } catch (error) {
      this.logger.error('Failed to send message:', error);
      this.emit('error', { error, message, transportId: this.connectionId });
      throw error;
    }
  }

  /**
   * Process queued messages after connection
   */
  async processMessageQueue() {
    if (!this.isConnected || this.messageQueue.length === 0) {
      return;
    }

    const messages = [...this.messageQueue];
    this.messageQueue = [];

    for (const message of messages) {
      try {
        await this.send(message);
        this.emit('messageSent', { message, transportId: this.connectionId });
      } catch (error) {
        this.logger.error('Failed to send queued message:', error);
        this.emit('error', { error, message, transportId: this.connectionId });
      }
    }
  }

  /**
   * Connection state management
   */
  setConnected(connected) {
    const wasConnected = this.isConnected;
    this.isConnected = connected;

    if (connected && !wasConnected) {
      this.emit('connected', { transportId: this.connectionId });
      this.processMessageQueue();
    } else if (!connected && wasConnected) {
      this.emit('disconnected', { transportId: this.connectionId });
    }
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.eventHandlers.clear();
    this.messageQueue = [];
    this.isConnected = false;
  }

  /**
   * Get transport type - override in subclasses
   */
  getType() {
    return 'base';
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      type: this.getType(),
      connected: this.isConnected,
      connectionId: this.connectionId,
      queuedMessages: this.messageQueue.length,
      config: this.getSafeConfig()
    };
  }

  /**
   * Get sanitized config for logging/debugging
   */
  getSafeConfig() {
    const safe = { ...this.config };
    
    // Remove sensitive data
    if (safe.auth) safe.auth = '***REDACTED***';
    if (safe.token) safe.token = '***REDACTED***';
    if (safe.password) safe.password = '***REDACTED***';
    if (safe.env) {
      safe.env = Object.keys(safe.env).reduce((acc, key) => {
        acc[key] = key.toLowerCase().includes('token') || 
                   key.toLowerCase().includes('key') || 
                   key.toLowerCase().includes('password') 
                   ? '***REDACTED***' 
                   : safe.env[key];
        return acc;
      }, {});
    }

    return safe;
  }
}