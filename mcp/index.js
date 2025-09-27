/**
 * MCP System Main Entry Point
 * Single Responsibility: Provide unified access to all MCP components
 * Testability: Centralized exports with dependency injection support
 */

// Transport Layer
export { McpTransport } from './transports/base.js';
export { StdioTransport, ProcessManager } from './transports/stdio.js';
export { HttpSseTransport, HttpClient } from './transports/http-sse.js';
export { WebSocketTransport, WebSocketClient } from './transports/websocket.js';
export { TransportFactory } from './transports/factory.js';

// Local imports for internal use
import { TransportFactory as LocalTransportFactory } from './transports/factory.js';

// Client Layer
export { UnifiedMcpClient } from './unified-client.js';
import { UnifiedMcpClient as LocalUnifiedMcpClient } from './unified-client.js';

// Management Layer
export { EnhancedMcpManager, ChromeStorage } from './enhanced-manager.js';
import { EnhancedMcpManager as LocalEnhancedMcpManager, ChromeStorage as LocalChromeStorage } from './enhanced-manager.js';

// UI Layer
export { EnhancedMcpManagerUI, DomHelper } from './ui/enhanced-manager-ui.js';
import { EnhancedMcpManagerUI as LocalEnhancedMcpManagerUI, DomHelper as LocalDomHelper } from './ui/enhanced-manager-ui.js';

// Testing
export { TransportTestSuite } from './tests/transport-tests.js';
export { IntegrationTestSuite } from './tests/integration-tests.js';
export { McpTestRunner, runMcpTests, createTestRunner } from './tests/test-runner.js';

/**
 * Create a complete MCP system with all components
 */
export function createMcpSystem(config = {}) {
  const logger = config.logger || console;
  
  // Create transport factory
  const transportFactory = new LocalTransportFactory(logger);
  
  // Create manager with custom storage if provided
  const storage = config.storage || (typeof chrome !== 'undefined' ? undefined : new MockStorage());
  const manager = new LocalEnhancedMcpManager(storage, transportFactory, logger);
  
  // Create UI if DOM is available and not in a background script
  let ui = null;
  const isBackgroundScript = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest;
  if (typeof document !== 'undefined' && !isBackgroundScript) {
    const domHelper = config.domHelper || undefined;
    ui = new LocalEnhancedMcpManagerUI(manager, domHelper, logger);
  }
  
  return {
    manager,
    ui,
    transportFactory,
    logger,
    
    async initialize() {
      await manager.initialize();
      if (ui) {
        await ui.initialize();
      }
    },
    
    async destroy() {
      if (ui) {
        // UI doesn't have destroy method, but we can clean up
      }
      await manager.destroy();
    }
  };
}

/**
 * Create MCP client for a specific server
 */
export async function createMcpClient(serverConfig, logger = console) {
  const transportFactory = new LocalTransportFactory(logger);
  const transport = transportFactory.createTransport(serverConfig);
  const client = new LocalUnifiedMcpClient(transport, logger);
  
  await client.initialize();
  return client;
}

/**
 * Validate MCP server configuration
 */
export function validateMcpConfig(config) {
  const transportFactory = new LocalTransportFactory();
  return transportFactory.validateConfig(config);
}

/**
 * Convert between MCP configuration formats
 */
export function convertMcpConfig(data, targetFormat = 'standard') {
  const transportFactory = new LocalTransportFactory();
  
  if (targetFormat === 'standard') {
    // Convert legacy array format to standard format
    if (Array.isArray(data)) {
      const mcpServers = {};
      for (const server of data) {
        if (server.name && server.url) {
          mcpServers[server.name] = {
            url: server.url,
            auth: server.auth,
            enabled: server.enabled,
            allowlisted: server.allowlisted
          };
        }
      }
      return { mcpServers };
    }
    return data; // Already in standard format
  } else if (targetFormat === 'legacy') {
    // Convert standard format to legacy array format
    if (data.mcpServers) {
      return Object.entries(data.mcpServers).map(([name, config]) => ({
        id: `mcp_${name}_${Date.now()}`,
        name,
        url: config.url || `stdio://${config.command}`,
        auth: config.auth || (config.command ? JSON.stringify(config) : ''),
        enabled: config.enabled !== false,
        allowlisted: config.allowlisted === true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }));
    }
    return data; // Already in legacy format
  }
  
  throw new Error(`Unsupported target format: ${targetFormat}`);
}

/**
 * Get MCP system examples and documentation
 */
export function getMcpExamples() {
  return {
    standardConfig: {
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/files'],
          env: {}
        },
        memory: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-memory']
        },
        httpServer: {
          url: 'http://localhost:8000/mcp',
          headers: {
            'Authorization': 'Bearer your-token'
          }
        },
        websocketServer: {
          url: 'wss://example.com/mcp',
          auth: 'Bearer your-token'
        }
      }
    },
    
    legacyConfig: [
      {
        id: 'mcp_websocket_1',
        name: 'WebSocket Server',
        url: 'wss://example.com/mcp',
        auth: 'Bearer token',
        enabled: true,
        allowlisted: false
      }
    ],
    
    usage: {
      basic: `
// Basic usage
import { createMcpSystem } from './mcp/index.js';

const mcpSystem = createMcpSystem();
await mcpSystem.initialize();

// Add a server
await mcpSystem.manager.addStandardServer('filesystem', {
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']
});

// Connect to server
await mcpSystem.manager.connectServer(serverId);
`,
      
      client: `
// Direct client usage
import { createMcpClient } from './mcp/index.js';

const client = await createMcpClient({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory']
});

// Use the client
const tools = Array.from(client.tools.values());
const result = await client.callTool('store', { key: 'test', value: 'data' });
`,
      
      testing: `
// Run tests
import { runMcpTests } from './mcp/index.js';

const results = await runMcpTests();
console.log('Test results:', results);
`
    }
  };
}

/**
 * Mock Storage for testing environments
 */
class MockStorage {
  constructor() {
    this.data = {};
  }

  async get(keys) {
    const result = {};
    for (const key of (Array.isArray(keys) ? keys : [keys])) {
      if (this.data.hasOwnProperty(key)) {
        result[key] = this.data[key];
      }
    }
    return result;
  }

  async set(items) {
    Object.assign(this.data, items);
  }
}

export { MockStorage };
