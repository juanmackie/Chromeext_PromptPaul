/**
 * Transport Factory
 * Single Responsibility: Create transport instances with dependency injection
 * Testability: Allows injection of transport implementations for testing
 */

import { StdioTransport } from './stdio.js';
import { HttpSseTransport } from './http-sse.js';
import { WebSocketTransport } from './websocket.js';

export class TransportFactory {
  constructor(logger = console) {
    this.logger = logger;
    this.transportTypes = new Map([
      ['stdio', StdioTransport],
      ['http-sse', HttpSseTransport],
      ['sse', HttpSseTransport], // Alias for backward compatibility
      ['http', HttpSseTransport], // Alias for backward compatibility
      ['websocket', WebSocketTransport],
      ['ws', WebSocketTransport], // Alias for backward compatibility
      ['wss', WebSocketTransport] // Alias for backward compatibility
    ]);
    this.dependencyProviders = new Map();
  }

  /**
   * Register custom transport type
   */
  registerTransport(type, transportClass) {
    if (typeof type !== 'string' || !type.trim()) {
      throw new Error('Transport type must be a non-empty string');
    }

    if (typeof transportClass !== 'function') {
      throw new Error('Transport class must be a constructor function');
    }

    this.transportTypes.set(type.toLowerCase(), transportClass);
    this.logger.debug(`Registered transport type: ${type}`);
  }

  /**
   * Register dependency provider for testing
   */
  registerDependencyProvider(transportType, provider) {
    if (typeof transportType !== 'string' || !transportType.trim()) {
      throw new Error('Transport type must be a non-empty string');
    }

    if (typeof provider !== 'object' || provider === null) {
      throw new Error('Provider must be an object');
    }

    this.dependencyProviders.set(transportType.toLowerCase(), provider);
    this.logger.debug(`Registered dependency provider for: ${transportType}`);
  }

  /**
   * Create transport instance from configuration
   */
  createTransport(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Transport configuration must be an object');
    }

    const transportType = this.detectTransportType(config);
    const TransportClass = this.transportTypes.get(transportType);

    if (!TransportClass) {
      throw new Error(`Unsupported transport type: ${transportType}`);
    }

    const dependencies = this.getDependencies(transportType);
    
    try {
      return new TransportClass(config, ...dependencies, this.logger);
    } catch (error) {
      this.logger.error(`Failed to create ${transportType} transport:`, error);
      throw new Error(`Failed to create ${transportType} transport: ${error.message}`);
    }
  }

  /**
   * Detect transport type from configuration
   */
  detectTransportType(config) {
    // Explicit type specified
    if (config.type && typeof config.type === 'string') {
      return config.type.toLowerCase();
    }

    // Detect from URL protocol
    if (config.url && typeof config.url === 'string') {
      try {
        const url = new URL(config.url);
        switch (url.protocol) {
          case 'ws:':
          case 'wss:':
            return 'websocket';
          case 'http:':
          case 'https:':
            return 'http-sse';
          default:
            this.logger.warn(`Unknown URL protocol: ${url.protocol}, defaulting to http-sse`);
            return 'http-sse';
        }
      } catch (error) {
        this.logger.warn('Invalid URL format, checking other indicators');
      }
    }

    // Detect from command/args (stdio)
    if (config.command || config.args) {
      return 'stdio';
    }

    // Default fallback
    throw new Error('Cannot detect transport type from configuration. Please specify explicit type.');
  }

  /**
   * Get dependencies for transport type
   */
  getDependencies(transportType) {
    const provider = this.dependencyProviders.get(transportType.toLowerCase());
    
    if (!provider) {
      return []; // Use default dependencies
    }

    switch (transportType.toLowerCase()) {
      case 'stdio':
        return [provider.processManager];
      case 'http-sse':
      case 'sse':
      case 'http':
        return [provider.httpClient];
      case 'websocket':
      case 'ws':
      case 'wss':
        return [provider.webSocketClient];
      default:
        return [];
    }
  }

  /**
   * Get list of supported transport types
   */
  getSupportedTypes() {
    return Array.from(this.transportTypes.keys());
  }

  /**
   * Validate transport configuration
   */
  validateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Configuration must be an object');
    }

    const transportType = this.detectTransportType(config);
    const TransportClass = this.transportTypes.get(transportType);

    if (!TransportClass) {
      throw new Error(`Unsupported transport type: ${transportType}`);
    }

    // Create temporary instance to validate config
    try {
      const tempInstance = new TransportClass(config, null, { 
        info: () => {}, 
        warn: () => {}, 
        error: () => {}, 
        debug: () => {} 
      });
      return {
        valid: true,
        type: transportType,
        config: tempInstance.config
      };
    } catch (error) {
      return {
        valid: false,
        type: transportType,
        error: error.message
      };
    }
  }

  /**
   * Create transport from standard MCP server configuration
   */
  createFromStandardConfig(name, serverConfig) {
    if (!name || typeof name !== 'string') {
      throw new Error('Server name must be a non-empty string');
    }

    if (!serverConfig || typeof serverConfig !== 'object') {
      throw new Error('Server configuration must be an object');
    }

    // Convert standard MCP config to internal format
    const internalConfig = this.convertStandardConfig(serverConfig);
    
    // Add metadata
    internalConfig.name = name;
    internalConfig.source = 'standard';

    return this.createTransport(internalConfig);
  }

  /**
   * Convert standard MCP configuration to internal format
   */
  convertStandardConfig(serverConfig) {
    const config = { ...serverConfig };

    // Handle stdio format
    if (config.command) {
      config.type = 'stdio';
      return config;
    }

    // Handle HTTP/SSE format
    if (config.url) {
      config.type = this.detectTransportType(config);
      return config;
    }

    // Handle legacy WebSocket format
    if (config.auth && !config.url) {
      throw new Error('WebSocket transport requires URL');
    }

    throw new Error('Invalid server configuration format');
  }

  /**
   * Create multiple transports from standard mcpServers configuration
   */
  createFromMcpServers(mcpServersConfig) {
    if (!mcpServersConfig || typeof mcpServersConfig !== 'object') {
      throw new Error('mcpServers configuration must be an object');
    }

    const transports = new Map();
    const errors = [];

    for (const [name, serverConfig] of Object.entries(mcpServersConfig)) {
      try {
        const transport = this.createFromStandardConfig(name, serverConfig);
        transports.set(name, transport);
      } catch (error) {
        errors.push({ name, error: error.message });
        this.logger.error(`Failed to create transport for ${name}:`, error);
      }
    }

    return {
      transports,
      errors,
      success: errors.length === 0
    };
  }

  /**
   * Get transport configuration examples
   */
  getConfigExamples() {
    return {
      stdio: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/files'],
        env: { 'API_KEY': 'your-key-here' }
      },
      'http-sse': {
        type: 'http-sse',
        url: 'http://localhost:8000/mcp',
        headers: { 'Authorization': 'Bearer your-token' }
      },
      websocket: {
        type: 'websocket',
        url: 'wss://example.com/mcp',
        auth: 'Bearer your-token'
      }
    };
  }

  /**
   * Cleanup all registered dependencies
   */
  destroy() {
    this.transportTypes.clear();
    this.dependencyProviders.clear();
  }
}