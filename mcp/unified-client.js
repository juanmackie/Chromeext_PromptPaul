/**
 * Unified MCP Client
 * Single Responsibility: Handle MCP protocol communication with servers
 * Testability: Dependency injection for transport and message handling
 */

export class UnifiedMcpClient {
  constructor(transport, logger = console) {
    this.transport = transport;
    this.logger = logger;
    this.isInitialized = false;
    this.capabilities = {};
    this.serverInfo = {};
    this.tools = new Map();
    this.resources = new Map();
    this.prompts = new Map();
    this.pendingRequests = new Map();
    this.requestId = 0;
    this.eventHandlers = new Map();
    this.heartbeatInterval = null;
    this.requestTimeout = 30000;
  }

  /**
   * Initialize client and establish MCP session
   */
  async initialize(clientInfo = null) {
    if (this.isInitialized) {
      this.logger.warn('MCP client already initialized');
      return;
    }

    try {
      this.logger.info('Initializing MCP client');
      
      // Setup transport handlers
      this.setupTransportHandlers();
      
      // Ensure transport is connected
      if (!this.transport.isConnected) {
        await this.transport.connect();
      }

      // Send initialize request
      const initResponse = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: this.getClientCapabilities(),
        clientInfo: clientInfo || {
          name: 'enhanced-mcp-client',
          version: '1.0.0'
        }
      });

      this.capabilities = initResponse.capabilities || {};
      this.serverInfo = initResponse.serverInfo || {};
      
      // Send initialized notification
      await this.sendNotification('initialized', {});
      
      // Load server capabilities
      await this.loadServerCapabilities();
      
      this.isInitialized = true;
      this.startHeartbeat();
      
      this.emit('initialized', {
        capabilities: this.capabilities,
        serverInfo: this.serverInfo
      });
      
      this.logger.info('MCP client initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize MCP client:', error);
      throw error;
    }
  }

  /**
   * Get client capabilities
   */
  getClientCapabilities() {
    return {
      experimental: {},
      sampling: {},
      roots: {
        listChanged: true
      },
      logging: {}
    };
  }

  /**
   * Setup transport event handlers
   */
  setupTransportHandlers() {
    this.transport.on('message', (data) => {
      this.handleMessage(data.message);
    });

    this.transport.on('error', (data) => {
      this.handleTransportError(data.error);
    });

    this.transport.on('disconnected', () => {
      this.handleDisconnection();
    });

    this.transport.on('reconnected', () => {
      this.handleReconnection();
    });
  }

  /**
   * Handle incoming messages
   */
  handleMessage(message) {
    try {
      this.logger.debug('Received message:', message);
      
      if (message.id !== undefined) {
        // Response to our request
        this.handleResponse(message);
      } else if (message.method) {
        // Request or notification from server
        this.handleServerMessage(message);
      } else {
        this.logger.warn('Unknown message format:', message);
      }
    } catch (error) {
      this.logger.error('Error handling message:', error);
    }
  }

  /**
   * Handle response messages
   */
  handleResponse(message) {
    const request = this.pendingRequests.get(message.id);
    if (!request) {
      this.logger.warn(`Received response for unknown request ID: ${message.id}`);
      return;
    }

    this.pendingRequests.delete(message.id);
    clearTimeout(request.timeout);

    if (message.error) {
      request.reject(new Error(`MCP Error ${message.error.code}: ${message.error.message}`));
    } else {
      request.resolve(message.result);
    }
  }

  /**
   * Handle server messages (requests/notifications)
   */
  async handleServerMessage(message) {
    const { method, params, id } = message;

    try {
      switch (method) {
        case 'notifications/message':
          this.handleLogMessage(params);
          break;
        case 'notifications/progress':
          this.handleProgressNotification(params);
          break;
        case 'notifications/resources/updated':
          await this.handleResourcesUpdated(params);
          break;
        case 'notifications/tools/updated':
          await this.handleToolsUpdated(params);
          break;
        case 'notifications/prompts/updated':
          await this.handlePromptsUpdated(params);
          break;
        default:
          if (id !== undefined) {
            // Server request - send error response
            await this.sendResponse(id, null, {
              code: -32601,
              message: `Method not found: ${method}`
            });
          } else {
            this.logger.warn(`Unknown notification method: ${method}`);
          }
      }
    } catch (error) {
      this.logger.error(`Error handling server message ${method}:`, error);
      if (id !== undefined) {
        await this.sendResponse(id, null, {
          code: -32603,
          message: 'Internal error'
        });
      }
    }
  }

  /**
   * Handle log messages from server
   */
  handleLogMessage(params) {
    const { level, message, logger } = params;
    this.emit('serverLog', { level, message, logger });
    
    // Also log to our logger
    const logLevel = level === 'error' ? 'error' : 
                    level === 'warning' ? 'warn' : 'info';
    this.logger[logLevel](`Server [${logger || 'unknown'}]: ${message}`);
  }

  /**
   * Handle progress notifications
   */
  handleProgressNotification(params) {
    this.emit('progress', params);
  }

  /**
   * Handle resources updated notification
   */
  async handleResourcesUpdated(params) {
    try {
      await this.loadResources();
      this.emit('resourcesUpdated', params);
    } catch (error) {
      this.logger.error('Failed to reload resources:', error);
    }
  }

  /**
   * Handle tools updated notification
   */
  async handleToolsUpdated(params) {
    try {
      await this.loadTools();
      this.emit('toolsUpdated', params);
    } catch (error) {
      this.logger.error('Failed to reload tools:', error);
    }
  }

  /**
   * Handle prompts updated notification
   */
  async handlePromptsUpdated(params) {
    try {
      await this.loadPrompts();
      this.emit('promptsUpdated', params);
    } catch (error) {
      this.logger.error('Failed to reload prompts:', error);
    }
  }

  /**
   * Load server capabilities (tools, resources, prompts)
   */
  async loadServerCapabilities() {
    const loadPromises = [];

    if (this.capabilities.tools) {
      loadPromises.push(this.loadTools());
    }

    if (this.capabilities.resources) {
      loadPromises.push(this.loadResources());
    }

    if (this.capabilities.prompts) {
      loadPromises.push(this.loadPrompts());
    }

    await Promise.allSettled(loadPromises);
  }

  /**
   * Load available tools
   */
  async loadTools() {
    try {
      const response = await this.sendRequest('tools/list', {});
      this.tools.clear();
      
      for (const tool of response.tools || []) {
        this.tools.set(tool.name, tool);
      }
      
      this.logger.debug(`Loaded ${this.tools.size} tools`);
      this.emit('toolsLoaded', { tools: Array.from(this.tools.values()) });
    } catch (error) {
      this.logger.error('Failed to load tools:', error);
      throw error;
    }
  }

  /**
   * Load available resources
   */
  async loadResources() {
    try {
      const response = await this.sendRequest('resources/list', {});
      this.resources.clear();
      
      for (const resource of response.resources || []) {
        this.resources.set(resource.uri, resource);
      }
      
      this.logger.debug(`Loaded ${this.resources.size} resources`);
      this.emit('resourcesLoaded', { resources: Array.from(this.resources.values()) });
    } catch (error) {
      this.logger.error('Failed to load resources:', error);
      throw error;
    }
  }

  /**
   * Load available prompts
   */
  async loadPrompts() {
    try {
      const response = await this.sendRequest('prompts/list', {});
      this.prompts.clear();
      
      for (const prompt of response.prompts || []) {
        this.prompts.set(prompt.name, prompt);
      }
      
      this.logger.debug(`Loaded ${this.prompts.size} prompts`);
      this.emit('promptsLoaded', { prompts: Array.from(this.prompts.values()) });
    } catch (error) {
      this.logger.error('Failed to load prompts:', error);
      throw error;
    }
  }

  /**
   * Call a tool
   */
  async callTool(name, arguments_) {
    if (!this.tools.has(name)) {
      throw new Error(`Tool not found: ${name}`);
    }

    try {
      this.logger.debug(`Calling tool: ${name}`, arguments_);
      
      const response = await this.sendRequest('tools/call', {
        name,
        arguments: arguments_ || {}
      });
      
      this.emit('toolCalled', { name, arguments: arguments_, response });
      return response;
    } catch (error) {
      this.logger.error(`Failed to call tool ${name}:`, error);
      throw error;
    }
  }

  /**
   * Read a resource
   */
  async readResource(uri) {
    if (!this.resources.has(uri)) {
      throw new Error(`Resource not found: ${uri}`);
    }

    try {
      this.logger.debug(`Reading resource: ${uri}`);
      
      const response = await this.sendRequest('resources/read', {
        uri
      });
      
      this.emit('resourceRead', { uri, response });
      return response;
    } catch (error) {
      this.logger.error(`Failed to read resource ${uri}:`, error);
      throw error;
    }
  }

  /**
   * Get a prompt
   */
  async getPrompt(name, arguments_) {
    if (!this.prompts.has(name)) {
      throw new Error(`Prompt not found: ${name}`);
    }

    try {
      this.logger.debug(`Getting prompt: ${name}`, arguments_);
      
      const response = await this.sendRequest('prompts/get', {
        name,
        arguments: arguments_ || {}
      });
      
      this.emit('promptRetrieved', { name, arguments: arguments_, response });
      return response;
    } catch (error) {
      this.logger.error(`Failed to get prompt ${name}:`, error);
      throw error;
    }
  }

  /**
   * Send a request to the server
   */
  async sendRequest(method, params) {
    if (!this.transport.isConnected) {
      throw new Error('Transport not connected');
    }

    const id = ++this.requestId;
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.requestTimeout);

      this.pendingRequests.set(id, { resolve, reject, timeout, method });
      
      this.transport.safeSend(message).catch(error => {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Send a notification to the server
   */
  async sendNotification(method, params) {
    if (!this.transport.isConnected) {
      throw new Error('Transport not connected');
    }

    const message = {
      jsonrpc: '2.0',
      method,
      params
    };

    return this.transport.safeSend(message);
  }

  /**
   * Send a response to the server
   */
  async sendResponse(id, result, error = null) {
    if (!this.transport.isConnected) {
      throw new Error('Transport not connected');
    }

    const message = {
      jsonrpc: '2.0',
      id
    };

    if (error) {
      message.error = error;
    } else {
      message.result = result;
    }

    return this.transport.safeSend(message);
  }

  /**
   * Handle transport errors
   */
  handleTransportError(error) {
    this.logger.error('Transport error:', error);
    this.emit('error', { error, source: 'transport' });
  }

  /**
   * Handle disconnection
   */
  handleDisconnection() {
    this.logger.warn('MCP client disconnected');
    this.isInitialized = false;
    this.stopHeartbeat();
    this.rejectPendingRequests(new Error('Connection lost'));
    this.emit('disconnected');
  }

  /**
   * Handle reconnection
   */
  async handleReconnection() {
    this.logger.info('MCP client reconnected, reinitializing...');
    
    try {
      await this.initialize();
      this.emit('reconnected');
    } catch (error) {
      this.logger.error('Failed to reinitialize after reconnection:', error);
      this.emit('error', { error, source: 'reconnection' });
    }
  }

  /**
   * Start heartbeat mechanism
   */
  startHeartbeat() {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.sendRequest('ping', {});
      } catch (error) {
        this.logger.debug('Heartbeat failed:', error);
      }
    }, 30000);
  }

  /**
   * Stop heartbeat mechanism
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Reject all pending requests
   */
  rejectPendingRequests(error) {
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * Get client status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      connected: this.transport.isConnected,
      serverInfo: this.serverInfo,
      capabilities: this.capabilities,
      tools: this.tools.size,
      resources: this.resources.size,
      prompts: this.prompts.size,
      pendingRequests: this.pendingRequests.size,
      transport: this.transport.getStatus()
    };
  }

  /**
   * Event handling
   */
  on(event, handler) {
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
   * Disconnect and cleanup
   */
  async disconnect() {
    this.logger.info('Disconnecting MCP client');
    
    this.stopHeartbeat();
    this.rejectPendingRequests(new Error('Client disconnected'));
    
    if (this.transport.isConnected) {
      await this.transport.disconnect();
    }
    
    this.isInitialized = false;
    this.emit('disconnected');
  }

  /**
   * Cleanup resources
   */
  async destroy() {
    await this.disconnect();
    this.eventHandlers.clear();
    this.tools.clear();
    this.resources.clear();
    this.prompts.clear();
  }
}