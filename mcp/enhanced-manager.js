/**
 * Enhanced MCP Manager
 * Single Responsibility: Manage MCP server configurations with multiple transport support
 * Testability: Dependency injection for storage and transport factory
 */

import { TransportFactory } from './transports/factory.js';

export class EnhancedMcpManager {
  constructor(storage = null, transportFactory = null, logger = console) {
    this.storage = storage || new ChromeStorage();
    this.transportFactory = transportFactory || new TransportFactory(logger);
    this.logger = logger;
    this.servers = new Map();
    this.activeTransports = new Map();
    this.editingServerId = null;
    this.eventHandlers = new Map();
  }

  /**
   * Initialize manager and load existing servers
   */
  async initialize() {
    try {
      await this.loadServers();
      this.logger.info(`Initialized MCP manager with ${this.servers.size} servers`);
    } catch (error) {
      this.logger.error('Failed to initialize MCP manager:', error);
      throw error;
    }
  }

  /**
   * Load servers from storage
   */
  async loadServers() {
    try {
      const data = await this.storage.get(['mcpServers', 'mcpServersLegacy']);
      
      // Load standard format servers
      if (data.mcpServers) {
        await this.loadStandardServers(data.mcpServers);
      }

      // Load legacy format servers
      if (data.mcpServersLegacy) {
        await this.loadLegacyServers(data.mcpServersLegacy);
      }

    } catch (error) {
      this.logger.error('Failed to load servers from storage:', error);
      throw error;
    }
  }

  /**
   * Load servers from standard MCP format
   */
  async loadStandardServers(mcpServersConfig) {
    for (const [name, serverConfig] of Object.entries(mcpServersConfig)) {
      try {
        const server = this.createServerFromStandardConfig(name, serverConfig);
        this.servers.set(server.id, server);
      } catch (error) {
        this.logger.error(`Failed to load standard server ${name}:`, error);
      }
    }
  }

  /**
   * Load servers from legacy format
   */
  async loadLegacyServers(legacyServers) {
    if (!Array.isArray(legacyServers)) return;

    for (const serverConfig of legacyServers) {
      try {
        const server = this.createServerFromLegacyConfig(serverConfig);
        this.servers.set(server.id, server);
      } catch (error) {
        this.logger.error('Failed to load legacy server:', error);
      }
    }
  }

  /**
   * Create server object from standard MCP config
   */
  createServerFromStandardConfig(name, serverConfig) {
    const validation = this.transportFactory.validateConfig(serverConfig);
    
    if (!validation.valid) {
      throw new Error(`Invalid configuration for ${name}: ${validation.error}`);
    }

    return {
      id: this.generateServerId(name),
      name: name,
      type: validation.type,
      config: validation.config,
      enabled: serverConfig.enabled !== false,
      allowlisted: serverConfig.allowlisted === true,
      source: 'standard',
      createdAt: serverConfig.createdAt || Date.now(),
      updatedAt: serverConfig.updatedAt || Date.now()
    };
  }

  /**
   * Create server object from legacy config
   */
  createServerFromLegacyConfig(serverConfig) {
    // Convert legacy WebSocket config to new format
    const config = {
      type: 'websocket',
      url: serverConfig.url,
      auth: serverConfig.auth,
      timeout: serverConfig.timeout || 30000
    };

    const validation = this.transportFactory.validateConfig(config);
    
    if (!validation.valid) {
      throw new Error(`Invalid legacy configuration: ${validation.error}`);
    }

    return {
      id: serverConfig.id || this.generateServerId(serverConfig.name),
      name: serverConfig.name,
      type: 'websocket',
      config: validation.config,
      enabled: serverConfig.enabled !== false,
      allowlisted: serverConfig.allowlisted === true,
      source: 'legacy',
      createdAt: serverConfig.createdAt || Date.now(),
      updatedAt: serverConfig.updatedAt || Date.now()
    };
  }

  /**
   * Generate unique server ID
   */
  generateServerId(name) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const safeName = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    return `mcp_${safeName}_${timestamp}_${random}`;
  }

  /**
   * Add new server from standard format
   */
  async addStandardServer(name, serverConfig) {
    if (!name || typeof name !== 'string') {
      throw new Error('Server name must be a non-empty string');
    }

    if (this.getServerByName(name)) {
      throw new Error(`Server with name '${name}' already exists`);
    }

    try {
      const server = this.createServerFromStandardConfig(name, serverConfig);
      this.servers.set(server.id, server);
      
      await this.saveServers();
      this.emit('serverAdded', server);
      
      this.logger.info(`Added server: ${name} (${server.type})`);
      return server;
    } catch (error) {
      this.logger.error(`Failed to add server ${name}:`, error);
      throw error;
    }
  }

  /**
   * Update existing server
   */
  async updateServer(serverId, updates) {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error('Server not found');
    }

    try {
      // Validate configuration if config is being updated
      if (updates.config) {
        const validation = this.transportFactory.validateConfig(updates.config);
        if (!validation.valid) {
          throw new Error(`Invalid configuration: ${validation.error}`);
        }
        updates.config = validation.config;
        updates.type = validation.type;
      }

      // Update server object
      const updatedServer = {
        ...server,
        ...updates,
        updatedAt: Date.now()
      };

      this.servers.set(serverId, updatedServer);
      await this.saveServers();
      this.emit('serverUpdated', updatedServer);
      
      this.logger.info(`Updated server: ${updatedServer.name}`);
      return updatedServer;
    } catch (error) {
      this.logger.error(`Failed to update server ${serverId}:`, error);
      throw error;
    }
  }

  /**
   * Delete server
   */
  async deleteServer(serverId) {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error('Server not found');
    }

    try {
      // Disconnect if connected
      await this.disconnectServer(serverId);
      
      this.servers.delete(serverId);
      await this.saveServers();
      this.emit('serverDeleted', server);
      
      this.logger.info(`Deleted server: ${server.name}`);
      return server;
    } catch (error) {
      this.logger.error(`Failed to delete server ${serverId}:`, error);
      throw error;
    }
  }

  /**
   * Connect to server
   */
  async connectServer(serverId) {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error('Server not found');
    }

    if (!server.enabled) {
      throw new Error('Server is disabled');
    }

    if (this.activeTransports.has(serverId)) {
      this.logger.warn(`Server ${server.name} is already connected`);
      return this.activeTransports.get(serverId);
    }

    try {
      const transport = this.transportFactory.createTransport(server.config);
      
      // Setup transport event handlers
      this.setupTransportHandlers(serverId, transport);
      
      await transport.connect();
      this.activeTransports.set(serverId, transport);
      
      this.emit('serverConnected', { serverId, server, transport });
      this.logger.info(`Connected to server: ${server.name}`);
      
      return transport;
    } catch (error) {
      this.logger.error(`Failed to connect to server ${server.name}:`, error);
      this.emit('serverConnectionFailed', { serverId, server, error });
      throw error;
    }
  }

  /**
   * Disconnect from server
   */
  async disconnectServer(serverId) {
    const transport = this.activeTransports.get(serverId);
    if (!transport) {
      return; // Already disconnected
    }

    const server = this.servers.get(serverId);
    
    try {
      await transport.disconnect();
      this.activeTransports.delete(serverId);
      
      this.emit('serverDisconnected', { serverId, server });
      this.logger.info(`Disconnected from server: ${server?.name || serverId}`);
    } catch (error) {
      this.logger.error(`Failed to disconnect from server ${serverId}:`, error);
      throw error;
    }
  }

  /**
   * Setup transport event handlers
   */
  setupTransportHandlers(serverId, transport) {
    transport.on('message', (data) => {
      this.emit('message', { serverId, ...data });
    });

    transport.on('error', (data) => {
      this.emit('transportError', { serverId, ...data });
    });

    transport.on('disconnected', (data) => {
      this.activeTransports.delete(serverId);
      this.emit('serverDisconnected', { serverId, ...data });
    });

    transport.on('reconnected', (data) => {
      this.emit('serverReconnected', { serverId, ...data });
    });
  }

  /**
   * Test server connection
   */
  async testServer(serverId) {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error('Server not found');
    }

    try {
      const transport = this.transportFactory.createTransport(server.config);
      
      // Set up timeout for test
      const testTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Connection test timeout')), 10000);
      });

      // Attempt connection
      const connectPromise = transport.connect();
      
      await Promise.race([connectPromise, testTimeout]);
      await transport.disconnect();
      
      this.logger.info(`Test successful for server: ${server.name}`);
      return { success: true, message: 'Connection test successful' };
    } catch (error) {
      this.logger.error(`Test failed for server ${server.name}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Import servers from various formats
   */
  async importServers(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Import data must be an object');
    }

    const results = {
      imported: 0,
      skipped: 0,
      errors: []
    };

    try {
      // Handle standard MCP format
      if (data.mcpServers) {
        const standardResults = await this.importStandardFormat(data.mcpServers);
        results.imported += standardResults.imported;
        results.skipped += standardResults.skipped;
        results.errors.push(...standardResults.errors);
      }

      // Handle legacy array format
      if (Array.isArray(data)) {
        const legacyResults = await this.importLegacyFormat(data);
        results.imported += legacyResults.imported;
        results.skipped += legacyResults.skipped;
        results.errors.push(...legacyResults.errors);
      }

      await this.saveServers();
      this.emit('serversImported', results);
      
      return results;
    } catch (error) {
      this.logger.error('Import failed:', error);
      throw error;
    }
  }

  /**
   * Import from standard MCP format
   */
  async importStandardFormat(mcpServers) {
    const results = { imported: 0, skipped: 0, errors: [] };

    for (const [name, serverConfig] of Object.entries(mcpServers)) {
      try {
        if (this.getServerByName(name)) {
          results.skipped++;
          continue;
        }

        const server = this.createServerFromStandardConfig(name, serverConfig);
        this.servers.set(server.id, server);
        results.imported++;
      } catch (error) {
        results.errors.push({ name, error: error.message });
      }
    }

    return results;
  }

  /**
   * Import from legacy format
   */
  async importLegacyFormat(serversArray) {
    const results = { imported: 0, skipped: 0, errors: [] };

    for (const serverConfig of serversArray) {
      try {
        if (!serverConfig.id || !serverConfig.name || !serverConfig.url) {
          results.errors.push({ 
            server: serverConfig, 
            error: 'Missing required fields (id, name, url)' 
          });
          continue;
        }

        if (this.servers.has(serverConfig.id)) {
          results.skipped++;
          continue;
        }

        const server = this.createServerFromLegacyConfig(serverConfig);
        this.servers.set(server.id, server);
        results.imported++;
      } catch (error) {
        results.errors.push({ 
          server: serverConfig, 
          error: error.message 
        });
      }
    }

    return results;
  }

  /**
   * Export servers in standard format
   */
  exportStandardFormat() {
    const mcpServers = {};

    for (const server of this.servers.values()) {
      if (server.source === 'standard') {
        mcpServers[server.name] = {
          ...server.config,
          enabled: server.enabled,
          allowlisted: server.allowlisted
        };
      }
    }

    return { mcpServers };
  }

  /**
   * Export servers in legacy format
   */
  exportLegacyFormat() {
    return Array.from(this.servers.values())
      .filter(server => server.source === 'legacy')
      .map(server => ({
        id: server.id,
        name: server.name,
        url: server.config.url,
        auth: server.config.auth,
        enabled: server.enabled,
        allowlisted: server.allowlisted,
        timeout: server.config.timeout,
        createdAt: server.createdAt,
        updatedAt: server.updatedAt
      }));
  }

  /**
   * Save servers to storage
   */
  async saveServers() {
    const standardServers = this.exportStandardFormat();
    const legacyServers = this.exportLegacyFormat();

    await this.storage.set({
      mcpServers: standardServers.mcpServers,
      mcpServersLegacy: legacyServers
    });
  }

  /**
   * Get server by name
   */
  getServerByName(name) {
    return Array.from(this.servers.values()).find(server => server.name === name);
  }

  /**
   * Get all servers
   */
  getAllServers() {
    return Array.from(this.servers.values());
  }

  /**
   * Get enabled servers
   */
  getEnabledServers() {
    return this.getAllServers().filter(server => server.enabled);
  }

  /**
   * Get connected servers
   */
  getConnectedServers() {
    return this.getAllServers().filter(server => this.activeTransports.has(server.id));
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
   * Cleanup resources
   */
  async destroy() {
    // Disconnect all active transports
    for (const [serverId] of this.activeTransports) {
      await this.disconnectServer(serverId);
    }

    this.servers.clear();
    this.activeTransports.clear();
    this.eventHandlers.clear();
    this.transportFactory.destroy();
  }
}

/**
 * Chrome Storage abstraction for testability
 */
class ChromeStorage {
  async get(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  }

  async set(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items, resolve);
    });
  }
}

export { ChromeStorage };
