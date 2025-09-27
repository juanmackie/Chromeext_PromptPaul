/**
 * HTTP/SSE Transport Implementation
 * Single Responsibility: Handle HTTP-based MCP servers with Server-Sent Events
 * Testability: Dependency injection for HTTP client and EventSource
 */

import { McpTransport } from './base.js';

export class HttpSseTransport extends McpTransport {
  constructor(config, httpClient = null, logger = console) {
    super(config, logger);
    this.httpClient = httpClient || new HttpClient();
    this.eventSource = null;
    this.endpointUrl = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.isReconnecting = false;
  }

  /**
   * Validate HTTP/SSE specific configuration
   */
  validateConfig(config) {
    const baseConfig = super.validateConfig(config);
    
    if (!baseConfig.url || typeof baseConfig.url !== 'string') {
      throw new Error('HTTP/SSE transport requires url string');
    }

    try {
      new URL(baseConfig.url);
    } catch (error) {
      throw new Error('Invalid URL format');
    }

    return {
      url: baseConfig.url,
      headers: baseConfig.headers || {},
      timeout: baseConfig.timeout || 30000,
      reconnect: baseConfig.reconnect !== false,
      maxReconnectAttempts: baseConfig.maxReconnectAttempts || 5,
      reconnectDelay: baseConfig.reconnectDelay || 1000
    };
  }

  /**
   * Connect to MCP server via HTTP/SSE
   */
  async connect() {
    if (this.isConnected) {
      this.logger.warn('HTTP/SSE transport already connected');
      return;
    }

    try {
      this.logger.info(`Connecting to MCP server: ${this.config.url}`);
      
      // First, try to detect transport type (Streamable HTTP vs Legacy SSE)
      const transportType = await this.detectTransportType();
      
      if (transportType === 'streamable-http') {
        await this.connectStreamableHttp();
      } else {
        await this.connectLegacySse();
      }

      this.setConnected(true);
      this.reconnectAttempts = 0;
      
      this.logger.info(`Connected to MCP server using ${transportType}`);
    } catch (error) {
      this.logger.error('Failed to connect to MCP server:', error);
      this.emit('error', { error, transportId: this.connectionId });
      throw error;
    }
  }

  /**
   * Detect transport type (Streamable HTTP vs Legacy SSE)
   */
  async detectTransportType() {
    try {
      // Try Streamable HTTP first
      const response = await this.httpClient.request({
        method: 'POST',
        url: this.config.url,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          ...this.config.headers
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'mcp-client', version: '1.0.0' }
          },
          id: 1
        }),
        timeout: 5000
      });

      if (response.ok) {
        return 'streamable-http';
      }
    } catch (error) {
      this.logger.debug('Streamable HTTP detection failed, trying legacy SSE');
    }

    try {
      // Try legacy SSE
      const response = await this.httpClient.request({
        method: 'GET',
        url: this.config.url,
        headers: {
          'Accept': 'text/event-stream',
          ...this.config.headers
        },
        timeout: 5000
      });

      if (response.ok) {
        return 'legacy-sse';
      }
    } catch (error) {
      this.logger.debug('Legacy SSE detection failed');
    }

    throw new Error('Unsupported transport type');
  }

  /**
   * Connect using Streamable HTTP transport
   */
  async connectStreamableHttp() {
    // For Streamable HTTP, we use the same endpoint for both sending and receiving
    this.endpointUrl = this.config.url;
    await this.setupStreamableHttpReceiver();
  }

  /**
   * Connect using Legacy SSE transport
   */
  async connectLegacySse() {
    await this.setupLegacySseReceiver();
  }

  /**
   * Setup Streamable HTTP message receiver
   */
  async setupStreamableHttpReceiver() {
    try {
      this.eventSource = await this.httpClient.createEventSource({
        url: this.config.url,
        headers: {
          'Accept': 'text/event-stream',
          ...this.config.headers
        }
      });

      this.setupEventSourceHandlers();
    } catch (error) {
      throw new Error(`Failed to setup Streamable HTTP receiver: ${error.message}`);
    }
  }

  /**
   * Setup Legacy SSE message receiver
   */
  async setupLegacySseReceiver() {
    try {
      this.eventSource = await this.httpClient.createEventSource({
        url: this.config.url,
        headers: {
          'Accept': 'text/event-stream',
          ...this.config.headers
        }
      });

      this.setupEventSourceHandlers();

      // Wait for endpoint event in legacy SSE
      await this.waitForEndpointEvent();
    } catch (error) {
      throw new Error(`Failed to setup Legacy SSE receiver: ${error.message}`);
    }
  }

  /**
   * Setup EventSource event handlers
   */
  setupEventSourceHandlers() {
    if (!this.eventSource) return;

    this.eventSource.onopen = () => {
      this.logger.debug('SSE connection opened');
      this.emit('sseConnected', { transportId: this.connectionId });
    };

    this.eventSource.onmessage = (event) => {
      this.handleSseMessage(event);
    };

    this.eventSource.onerror = (error) => {
      this.handleSseError(error);
    };

    // Handle custom events for legacy SSE
    this.eventSource.addEventListener('endpoint', (event) => {
      this.handleEndpointEvent(event);
    });

    this.eventSource.addEventListener('message', (event) => {
      this.handleMessageEvent(event);
    });
  }

  /**
   * Handle SSE message events
   */
  handleSseMessage(event) {
    try {
      const message = JSON.parse(event.data);
      this.validateMessage(message);
      this.emit('message', { message, transportId: this.connectionId });
    } catch (error) {
      this.logger.warn('Invalid SSE message received:', event.data, error);
      this.emit('invalidMessage', { 
        data: event.data, 
        error, 
        transportId: this.connectionId 
      });
    }
  }

  /**
   * Handle SSE endpoint event (legacy SSE)
   */
  handleEndpointEvent(event) {
    try {
      const endpointData = JSON.parse(event.data);
      if (endpointData.uri) {
        this.endpointUrl = endpointData.uri;
        this.logger.debug(`Received endpoint URL: ${this.endpointUrl}`);
        this.emit('endpointReceived', { 
          endpoint: this.endpointUrl, 
          transportId: this.connectionId 
        });
      }
    } catch (error) {
      this.logger.warn('Invalid endpoint event:', event.data, error);
    }
  }

  /**
   * Handle SSE message event (legacy SSE)
   */
  handleMessageEvent(event) {
    this.handleSseMessage(event);
  }

  /**
   * Handle SSE errors
   */
  handleSseError(error) {
    this.logger.error('SSE connection error:', error);
    this.setConnected(false);

    if (this.config.reconnect && !this.isReconnecting) {
      this.attemptReconnect();
    } else {
      this.emit('error', { error, transportId: this.connectionId });
    }
  }

  /**
   * Wait for endpoint event in legacy SSE
   */
  waitForEndpointEvent() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for endpoint event'));
      }, this.config.timeout);

      const endpointHandler = () => {
        clearTimeout(timeout);
        this.off('endpointReceived', endpointHandler);
        resolve();
      };

      this.on('endpointReceived', endpointHandler);
    });
  }

  /**
   * Attempt to reconnect
   */
  async attemptReconnect() {
    if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    this.logger.info(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

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
   * Send message to MCP server via HTTP POST
   */
  async send(message) {
    if (!this.isConnected || !this.endpointUrl) {
      throw new Error('HTTP/SSE transport not connected or no endpoint available');
    }

    try {
      const response = await this.httpClient.request({
        method: 'POST',
        url: this.endpointUrl,
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers
        },
        body: JSON.stringify(message),
        timeout: this.config.timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      this.logger.error('Failed to send HTTP message:', error);
      throw error;
    }
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect() {
    if (!this.isConnected) {
      return;
    }

    this.logger.info('Disconnecting HTTP/SSE transport');
    this.setConnected(false);

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.endpointUrl = null;
    this.reconnectAttempts = 0;
  }

  /**
   * Get transport type
   */
  getType() {
    return 'http-sse';
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
 * HTTP Client for dependency injection and testing
 * Single Responsibility: Abstract HTTP operations for testability
 */
class HttpClient {
  async request(options) {
    const { method, url, headers, body, timeout } = options;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async createEventSource(options) {
    const { url, headers } = options;
    
    // In browser environment, use EventSource
    if (typeof EventSource !== 'undefined') {
      const eventSource = new EventSource(url);
      
      // Apply custom headers if supported
      if (headers && Object.keys(headers).length > 0) {
        this.logger?.warn('Custom headers not supported in browser EventSource');
      }
      
      return eventSource;
    }
    
    // In Node.js environment, would need polyfill or alternative implementation
    throw new Error('EventSource not available in this environment');
  }
}

export { HttpClient };