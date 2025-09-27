/**
 * Integration Tests
 * Single Responsibility: Test complete MCP system integration
 * Testability: End-to-end testing with real server interactions
 */

export class IntegrationTestSuite {
  constructor(logger = console) {
    this.logger = logger;
    this.testResults = [];
    this.testServers = new Map();
  }

  /**
   * Run all integration tests
   */
  async runAllTests() {
    this.logger.info('Starting integration test suite...');
    this.testResults = [];

    await this.setupTestServers();
    await this.testStandardMcpServerIntegration();
    await this.testManagerIntegration();
    await this.testClientServerCommunication();
    await this.testConfigurationFormats();
    await this.cleanupTestServers();

    return this.generateTestReport();
  }

  /**
   * Setup test servers for integration testing
   */
  async setupTestServers() {
    this.logger.info('Setting up test servers...');
    
    // Memory server (simple stdio server)
    this.testServers.set('memory', {
      name: 'memory',
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        type: 'stdio'
      }
    });

    // Mock HTTP server for testing
    this.testServers.set('http-mock', {
      name: 'http-mock',
      config: {
        url: 'http://localhost:8999/mcp',
        type: 'http-sse'
      }
    });
  }

  /**
   * Test integration with standard MCP servers
   */
  async testStandardMcpServerIntegration() {
    const testName = 'StandardMcpServerIntegration';
    this.logger.info(`Testing ${testName}...`);

    try {
      const { TransportFactory } = await import('../transports/factory.js');
      const { UnifiedMcpClient } = await import('../unified-client.js');
      
      const factory = new TransportFactory();
      const serverConfig = this.testServers.get('memory');
      
      // Test transport creation
      const transport = factory.createTransport(serverConfig.config);
      this.assert(transport.getType() === 'stdio', 'Should create stdio transport');
      
      // Test client initialization
      const client = new UnifiedMcpClient(transport);
      
      // Test connection (this will actually try to spawn the server)
      try {
        await client.initialize();
        this.assert(client.isInitialized, 'Client should initialize successfully');
        
        // Test basic functionality
        const status = client.getStatus();
        this.assert(status.connected, 'Should be connected to server');
        this.assert(status.serverInfo, 'Should have server info');
        
        // Test tool listing (memory server has tools)
        const tools = Array.from(client.tools.values());
        this.logger.info(`Found ${tools.length} tools from memory server`);
        
        // Clean disconnect
        await client.disconnect();
        this.assert(!client.isInitialized, 'Should be disconnected');
        
        this.addTestResult(testName, 'PASS', `Successfully integrated with memory server (${tools.length} tools found)`);
      } catch (error) {
        // This might fail if the server isn't available, which is OK for testing
        if (error.message.includes('ENOENT') || error.message.includes('spawn')) {
          this.addTestResult(testName, 'SKIP', 'Memory server not available for testing');
        } else {
          throw error;
        }
      }
    } catch (error) {
      this.addTestResult(testName, 'FAIL', error.message);
    }
  }

  /**
   * Test enhanced manager integration
   */
  async testManagerIntegration() {
    const testName = 'ManagerIntegration';
    this.logger.info(`Testing ${testName}...`);

    try {
      const { EnhancedMcpManager } = await import('../enhanced-manager.js');
      
      // Create manager with mock storage
      const mockStorage = new MockStorage();
      const manager = new EnhancedMcpManager(mockStorage);
      
      await manager.initialize();
      this.assert(manager.servers.size === 0, 'Should start with no servers');
      
      // Test adding standard format server
      const serverConfig = {
        command: 'echo',
        args: ['test'],
        enabled: true,
        allowlisted: false
      };
      
      const server = await manager.addStandardServer('test-server', serverConfig);
      this.assert(server.name === 'test-server', 'Should create server with correct name');
      this.assert(server.type === 'stdio', 'Should detect stdio transport type');
      this.assert(manager.servers.size === 1, 'Should have one server');
      
      // Test server updates
      const updatedServer = await manager.updateServer(server.id, { enabled: false });
      this.assert(!updatedServer.enabled, 'Should update server properties');
      
      // Test server export
      const exportData = manager.exportStandardFormat();
      this.assert(exportData.mcpServers['test-server'], 'Should export server in standard format');
      
      // Test server deletion
      await manager.deleteServer(server.id);
      this.assert(manager.servers.size === 0, 'Should delete server');
      
      // Test import functionality
      const importData = {
        mcpServers: {
          'imported-server': {
            command: 'node',
            args: ['server.js']
          }
        }
      };
      
      const importResults = await manager.importServers(importData);
      this.assert(importResults.imported === 1, 'Should import one server');
      this.assert(manager.servers.size === 1, 'Should have imported server');
      
      await manager.destroy();
      
      this.addTestResult(testName, 'PASS', 'All manager integration tests passed');
    } catch (error) {
      this.addTestResult(testName, 'FAIL', error.message);
    }
  }

  /**
   * Test client-server communication
   */
  async testClientServerCommunication() {
    const testName = 'ClientServerCommunication';
    this.logger.info(`Testing ${testName}...`);

    try {
      const { UnifiedMcpClient } = await import('../unified-client.js');
      const { StdioTransport } = await import('../transports/stdio.js');
      
      // Create mock transport for controlled testing
      const mockTransport = new MockTransportForIntegration();
      const client = new UnifiedMcpClient(mockTransport);
      
      // Test initialization sequence
      await client.initialize();
      
      // Verify initialization messages were sent
      const messages = mockTransport.getSentMessages();
      this.assert(messages.length >= 2, 'Should send initialize and initialized messages');
      this.assert(messages[0].method === 'initialize', 'First message should be initialize');
      this.assert(messages[1].method === 'initialized', 'Second message should be initialized');
      
      // Test tool calling
      mockTransport.addTool('test-tool', { name: 'test-tool', description: 'Test tool' });
      await client.loadTools();
      
      const toolResult = await client.callTool('test-tool', { param: 'value' });
      this.assert(toolResult.success, 'Tool call should succeed');
      
      // Test resource reading
      mockTransport.addResource('test://resource', { uri: 'test://resource', name: 'Test Resource' });
      await client.loadResources();
      
      const resourceData = await client.readResource('test://resource');
      this.assert(resourceData.contents, 'Resource read should return contents');
      
      // Test error handling
      try {
        await client.callTool('non-existent-tool', {});
        this.assert(false, 'Should throw error for non-existent tool');
      } catch (error) {
        this.assert(error.message.includes('not found'), 'Should provide meaningful error');
      }
      
      await client.disconnect();
      
      this.addTestResult(testName, 'PASS', 'All client-server communication tests passed');
    } catch (error) {
      this.addTestResult(testName, 'FAIL', error.message);
    }
  }

  /**
   * Test configuration format compatibility
   */
  async testConfigurationFormats() {
    const testName = 'ConfigurationFormats';
    this.logger.info(`Testing ${testName}...`);

    try {
      const { TransportFactory } = await import('../transports/factory.js');
      const { EnhancedMcpManager } = await import('../enhanced-manager.js');
      
      const factory = new TransportFactory();
      const manager = new EnhancedMcpManager(new MockStorage());
      
      // Test standard MCP format
      const standardConfig = {
        mcpServers: {
          'filesystem': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']
          },
          'memory': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory']
          },
          'http-server': {
            url: 'http://localhost:8000/mcp',
            headers: { 'Authorization': 'Bearer token' }
          }
        }
      };
      
      // Test import of standard format
      const importResults = await manager.importServers(standardConfig);
      this.assert(importResults.imported === 3, 'Should import all three servers');
      this.assert(importResults.errors.length === 0, 'Should have no import errors');
      
      // Test export of standard format
      const exportData = manager.exportStandardFormat();
      this.assert(Object.keys(exportData.mcpServers).length === 3, 'Should export all servers');
      this.assert(exportData.mcpServers.filesystem.command === 'npx', 'Should preserve command');
      this.assert(exportData.mcpServers['http-server'].url === 'http://localhost:8000/mcp', 'Should preserve URL');
      
      // Test legacy format compatibility
      const legacyConfig = [
        {
          id: 'legacy_1',
          name: 'Legacy Server',
          url: 'wss://example.com/mcp',
          auth: 'Bearer legacy-token',
          enabled: true,
          allowlisted: false
        }
      ];
      
      const legacyResults = await manager.importServers(legacyConfig);
      this.assert(legacyResults.imported === 1, 'Should import legacy server');
      this.assert(manager.servers.size === 4, 'Should have four servers total');
      
      // Test transport factory with different formats
      const stdioTransport = factory.createTransport({
        command: 'node',
        args: ['server.js']
      });
      this.assert(stdioTransport.getType() === 'stdio', 'Should create stdio transport from standard config');
      
      const httpTransport = factory.createTransport({
        url: 'http://localhost:8000/mcp'
      });
      this.assert(httpTransport.getType() === 'http-sse', 'Should create HTTP transport from URL');
      
      const wsTransport = factory.createTransport({
        url: 'wss://example.com/mcp'
      });
      this.assert(wsTransport.getType() === 'websocket', 'Should create WebSocket transport from WSS URL');
      
      this.addTestResult(testName, 'PASS', 'All configuration format tests passed');
    } catch (error) {
      this.addTestResult(testName, 'FAIL', error.message);
    }
  }

  /**
   * Cleanup test servers
   */
  async cleanupTestServers() {
    this.logger.info('Cleaning up test servers...');
    this.testServers.clear();
  }

  /**
   * Test assertion helper
   */
  assert(condition, message) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  /**
   * Add test result
   */
  addTestResult(testName, status, message) {
    this.testResults.push({
      test: testName,
      status,
      message,
      timestamp: new Date().toISOString()
    });
    
    const logLevel = status === 'PASS' ? 'info' : status === 'SKIP' ? 'warn' : 'error';
    this.logger[logLevel](`${testName}: ${status} - ${message}`);
  }

  /**
   * Generate test report
   */
  generateTestReport() {
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(r => r.status === 'PASS').length;
    const skippedTests = this.testResults.filter(r => r.status === 'SKIP').length;
    const failedTests = totalTests - passedTests - skippedTests;
    
    const report = {
      summary: {
        total: totalTests,
        passed: passedTests,
        skipped: skippedTests,
        failed: failedTests,
        success: failedTests === 0
      },
      results: this.testResults,
      timestamp: new Date().toISOString()
    };
    
    this.logger.info(`Integration Test Suite Complete: ${passedTests}/${totalTests} tests passed, ${skippedTests} skipped`);
    
    return report;
  }
}

/**
 * Mock Storage for testing
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

/**
 * Mock Transport for controlled integration testing
 */
class MockTransportForIntegration {
  constructor() {
    this.isConnected = false;
    this.eventHandlers = new Map();
    this.sentMessages = [];
    this.requestId = 0;
    this.tools = new Map();
    this.resources = new Map();
  }

  async connect() {
    this.isConnected = true;
    this.emit('connected', {});
  }

  async disconnect() {
    this.isConnected = false;
    this.emit('disconnected', {});
  }

  async send(message) {
    // Don't use safeSend to avoid validation issues
    this.sentMessages.push(message);
    
    // Handle different message types
    if (message.method === 'initialize') {
      setTimeout(() => {
        this.emit('message', {
          message: {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
                resources: {},
                prompts: {}
              },
              serverInfo: {
                name: 'mock-server',
                version: '1.0.0'
              }
            }
          }
        });
      }, 10);
    } else if (message.method === 'tools/list') {
      setTimeout(() => {
        this.emit('message', {
          message: {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              tools: Array.from(this.tools.values())
            }
          }
        });
      }, 10);
    } else if (message.method === 'tools/call') {
      setTimeout(() => {
        this.emit('message', {
          message: {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              success: true,
              content: [{ type: 'text', text: 'Tool executed successfully' }]
            }
          }
        });
      }, 10);
    } else if (message.method === 'resources/list') {
      setTimeout(() => {
        this.emit('message', {
          message: {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              resources: Array.from(this.resources.values())
            }
          }
        });
      }, 10);
    } else if (message.method === 'resources/read') {
      setTimeout(() => {
        this.emit('message', {
          message: {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              contents: [{ 
                uri: message.params.uri, 
                mimeType: 'text/plain', 
                text: 'Mock resource content' 
              }]
            }
          }
        });
      }, 10);
    }
  }

  async safeSend(message) {
    return this.send(message);
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  emit(event, data) {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    });
  }

  getSentMessages() {
    return [...this.sentMessages];
  }

  addTool(name, tool) {
    this.tools.set(name, tool);
  }

  addResource(uri, resource) {
    this.resources.set(uri, resource);
  }

  getType() {
    return 'mock';
  }

  getStatus() {
    return {
      type: 'mock',
      connected: this.isConnected,
      queuedMessages: 0
    };
  }
}