/**
 * Transport Tests
 * Single Responsibility: Test all transport implementations
 * Testability: Mock dependencies for isolated testing
 */

export class TransportTestSuite {
  constructor(logger = console) {
    this.logger = logger;
    this.testResults = [];
  }

  /**
   * Run all transport tests
   */
  async runAllTests() {
    this.logger.info('Starting transport test suite...');
    this.testResults = [];

    await this.testBaseTransport();
    await this.testStdioTransport();
    await this.testHttpSseTransport();
    await this.testWebSocketTransport();
    await this.testTransportFactory();

    return this.generateTestReport();
  }

  /**
   * Test base transport functionality
   */
  async testBaseTransport() {
    const testName = 'BaseTransport';
    this.logger.info(`Testing ${testName}...`);

    try {
      const { McpTransport } = await import('../transports/base.js');
      
      // Test constructor
      const transport = new McpTransport({ test: 'config' });
      this.assert(transport.config.test === 'config', 'Constructor should store config');
      this.assert(transport.isConnected === false, 'Should start disconnected');
      
      // Test event handling
      let eventFired = false;
      transport.on('test', () => { eventFired = true; });
      transport.emit('test');
      this.assert(eventFired, 'Event handling should work');
      
      // Test message validation
      this.assert(transport.validateMessage({ jsonrpc: '2.0', method: 'test' }), 'Should validate correct message');
      
      try {
        transport.validateMessage({ invalid: 'message' });
        this.assert(false, 'Should reject invalid message');
      } catch (error) {
        this.assert(true, 'Should throw on invalid message');
      }
      
      // Test abstract methods
      try {
        await transport.connect();
        this.assert(false, 'Abstract connect should throw');
      } catch (error) {
        this.assert(error.message.includes('must be implemented'), 'Abstract methods should throw');
      }

      this.addTestResult(testName, 'PASS', 'All base transport tests passed');
    } catch (error) {
      this.addTestResult(testName, 'FAIL', error.message);
    }
  }

  /**
   * Test stdio transport functionality
   */
  async testStdioTransport() {
    const testName = 'StdioTransport';
    this.logger.info(`Testing ${testName}...`);

    try {
      const { StdioTransport } = await import('../transports/stdio.js');
      
      // Mock process manager
      const mockProcessManager = new MockProcessManager();
      
      // Test constructor and config validation
      const transport = new StdioTransport({
        command: 'node',
        args: ['server.js'],
        env: { TEST: 'value' }
      }, mockProcessManager);
      
      this.assert(transport.config.command === 'node', 'Should store command');
      this.assert(Array.isArray(transport.config.args), 'Should store args as array');
      this.assert(transport.config.env.TEST === 'value', 'Should store environment');
      
      // Test invalid config
      try {
        new StdioTransport({ invalid: 'config' });
        this.assert(false, 'Should reject invalid config');
      } catch (error) {
        this.assert(error.message.includes('command'), 'Should require command');
      }
      
      // Test connection
      await transport.connect();
      this.assert(transport.isConnected, 'Should be connected after connect()');
      this.assert(mockProcessManager.spawnCalled, 'Should call process manager spawn');
      
      // Test message sending
      const testMessage = { jsonrpc: '2.0', method: 'test', id: 1 };
      await transport.send(testMessage);
      this.assert(mockProcessManager.lastWritten === JSON.stringify(testMessage) + '\n', 'Should send JSON message');
      
      // Test message receiving
      let receivedMessage = null;
      transport.on('message', (data) => { receivedMessage = data.message; });
      mockProcessManager.simulateStdout('{"jsonrpc":"2.0","result":"test","id":1}\n');
      this.assert(receivedMessage?.result === 'test', 'Should receive and parse messages');
      
      // Test disconnection
      await transport.disconnect();
      this.assert(!transport.isConnected, 'Should be disconnected after disconnect()');

      this.addTestResult(testName, 'PASS', 'All stdio transport tests passed');
    } catch (error) {
      this.addTestResult(testName, 'FAIL', error.message);
    }
  }

  /**
   * Test HTTP/SSE transport functionality
   */
  async testHttpSseTransport() {
    const testName = 'HttpSseTransport';
    this.logger.info(`Testing ${testName}...`);

    try {
      const { HttpSseTransport } = await import('../transports/http-sse.js');
      
      // Mock HTTP client
      const mockHttpClient = new MockHttpClient();
      
      // Test constructor and config validation
      const transport = new HttpSseTransport({
        url: 'http://localhost:8000/mcp',
        headers: { 'Authorization': 'Bearer token' }
      }, mockHttpClient);
      
      this.assert(transport.config.url === 'http://localhost:8000/mcp', 'Should store URL');
      this.assert(transport.config.headers.Authorization === 'Bearer token', 'Should store headers');
      
      // Test invalid config
      try {
        new HttpSseTransport({ invalid: 'config' });
        this.assert(false, 'Should reject invalid config');
      } catch (error) {
        this.assert(error.message.includes('url'), 'Should require URL');
      }
      
      // Test connection with streamable HTTP
      mockHttpClient.setStreamableHttpSupport(true);
      await transport.connect();
      this.assert(transport.isConnected, 'Should connect with streamable HTTP');
      
      // Test message sending
      const testMessage = { jsonrpc: '2.0', method: 'test', id: 1 };
      await transport.send(testMessage);
      this.assert(mockHttpClient.lastRequest.body === JSON.stringify(testMessage), 'Should send JSON via HTTP');
      
      // Test disconnection
      await transport.disconnect();
      this.assert(!transport.isConnected, 'Should be disconnected after disconnect()');

      this.addTestResult(testName, 'PASS', 'All HTTP/SSE transport tests passed');
    } catch (error) {
      this.addTestResult(testName, 'FAIL', error.message);
    }
  }

  /**
   * Test WebSocket transport functionality
   */
  async testWebSocketTransport() {
    const testName = 'WebSocketTransport';
    this.logger.info(`Testing ${testName}...`);

    try {
      const { WebSocketTransport } = await import('../transports/websocket.js');
      
      // Mock WebSocket client
      const mockWsClient = new MockWebSocketClient();
      
      // Test constructor and config validation
      const transport = new WebSocketTransport({
        url: 'wss://example.com/mcp',
        auth: 'Bearer token'
      }, mockWsClient);
      
      this.assert(transport.config.url === 'wss://example.com/mcp', 'Should store URL');
      this.assert(transport.config.auth === 'Bearer token', 'Should store auth');
      
      // Test invalid config
      try {
        new WebSocketTransport({ url: 'http://invalid' });
        this.assert(false, 'Should reject non-WebSocket URL');
      } catch (error) {
        this.assert(error.message.includes('ws://'), 'Should require WebSocket protocol');
      }
      
      // Test connection
      await transport.connect();
      this.assert(transport.isConnected, 'Should be connected after connect()');
      this.assert(mockWsClient.connected, 'Should establish WebSocket connection');
      
      // Test message sending
      const testMessage = { jsonrpc: '2.0', method: 'test', id: 1 };
      await transport.send(testMessage);
      this.assert(mockWsClient.lastSent === JSON.stringify(testMessage), 'Should send JSON message');
      
      // Test message receiving
      let receivedMessage = null;
      transport.on('message', (data) => { receivedMessage = data.message; });
      mockWsClient.simulateMessage('{"jsonrpc":"2.0","result":"test","id":1}');
      this.assert(receivedMessage?.result === 'test', 'Should receive and parse messages');
      
      // Test heartbeat
      mockWsClient.simulateMessage('ping');
      this.assert(mockWsClient.lastSent === 'pong', 'Should respond to ping with pong');
      
      // Test disconnection
      await transport.disconnect();
      this.assert(!transport.isConnected, 'Should be disconnected after disconnect()');

      this.addTestResult(testName, 'PASS', 'All WebSocket transport tests passed');
    } catch (error) {
      this.addTestResult(testName, 'FAIL', error.message);
    }
  }

  /**
   * Test transport factory functionality
   */
  async testTransportFactory() {
    const testName = 'TransportFactory';
    this.logger.info(`Testing ${testName}...`);

    try {
      const { TransportFactory } = await import('../transports/factory.js');
      
      const factory = new TransportFactory();
      
      // Test stdio transport creation
      const stdioConfig = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem']
      };
      const stdioTransport = factory.createTransport(stdioConfig);
      this.assert(stdioTransport.getType() === 'stdio', 'Should create stdio transport');
      
      // Test HTTP/SSE transport creation
      const httpConfig = {
        url: 'http://localhost:8000/mcp'
      };
      const httpTransport = factory.createTransport(httpConfig);
      this.assert(httpTransport.getType() === 'http-sse', 'Should create HTTP/SSE transport');
      
      // Test WebSocket transport creation
      const wsConfig = {
        url: 'wss://example.com/mcp'
      };
      const wsTransport = factory.createTransport(wsConfig);
      this.assert(wsTransport.getType() === 'websocket', 'Should create WebSocket transport');
      
      // Test standard config conversion
      const standardConfig = {
        'filesystem': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem']
        }
      };
      const result = factory.createFromMcpServers(standardConfig);
      this.assert(result.success, 'Should convert standard config successfully');
      this.assert(result.transports.has('filesystem'), 'Should create transport for filesystem server');
      
      // Test config validation
      const validation = factory.validateConfig(stdioConfig);
      this.assert(validation.valid, 'Should validate correct config');
      this.assert(validation.type === 'stdio', 'Should detect correct transport type');

      this.addTestResult(testName, 'PASS', 'All transport factory tests passed');
    } catch (error) {
      this.addTestResult(testName, 'FAIL', error.message);
    }
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
    
    const logLevel = status === 'PASS' ? 'info' : 'error';
    this.logger[logLevel](`${testName}: ${status} - ${message}`);
  }

  /**
   * Generate test report
   */
  generateTestReport() {
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(r => r.status === 'PASS').length;
    const failedTests = totalTests - passedTests;
    
    const report = {
      summary: {
        total: totalTests,
        passed: passedTests,
        failed: failedTests,
        success: failedTests === 0
      },
      results: this.testResults,
      timestamp: new Date().toISOString()
    };
    
    this.logger.info(`Test Suite Complete: ${passedTests}/${totalTests} tests passed`);
    
    return report;
  }
}

/**
 * Mock Process Manager for testing
 */
class MockProcessManager {
  constructor() {
    this.spawnCalled = false;
    this.process = null;
    this.lastWritten = null;
  }

  async spawn(options) {
    this.spawnCalled = true;
    this.process = new MockProcess();
    return this.process;
  }
}

class MockProcess {
  constructor() {
    this.stdout = new MockStream();
    this.stderr = new MockStream();
    this.stdin = new MockWritableStream();
    this.pid = 12345;
    this.killed = false;
  }

  kill(signal) {
    this.killed = true;
    setTimeout(() => {
      this.emit('exit', 0, signal);
    }, 10);
  }

  on(event, handler) {
    if (!this.handlers) this.handlers = new Map();
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(handler);
  }

  emit(event, ...args) {
    const handlers = this.handlers?.get(event) || [];
    handlers.forEach(handler => handler(...args));
  }

  simulateStdout(data) {
    this.stdout.emit('data', Buffer.from(data));
  }
}

class MockStream {
  constructor() {
    this.handlers = new Map();
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(handler);
  }

  emit(event, ...args) {
    const handlers = this.handlers.get(event) || [];
    handlers.forEach(handler => handler(...args));
  }
}

class MockWritableStream extends MockStream {
  write(data, callback) {
    this.lastWritten = data;
    if (callback) setTimeout(callback, 0);
  }

  end() {
    this.emit('finish');
  }
}

/**
 * Mock HTTP Client for testing
 */
class MockHttpClient {
  constructor() {
    this.streamableHttpSupport = false;
    this.lastRequest = null;
    this.eventSource = null;
  }

  setStreamableHttpSupport(supported) {
    this.streamableHttpSupport = supported;
  }

  async request(options) {
    this.lastRequest = options;
    
    // Simulate transport detection
    if (options.method === 'POST' && options.body) {
      const body = JSON.parse(options.body);
      if (body.method === 'initialize') {
        return {
          ok: this.streamableHttpSupport,
          status: this.streamableHttpSupport ? 200 : 404
        };
      }
    }
    
    return { ok: true, status: 200 };
  }

  async createEventSource(options) {
    this.eventSource = new MockEventSource();
    return this.eventSource;
  }
}

class MockEventSource {
  constructor() {
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.readyState = 1; // OPEN
  }

  addEventListener(event, handler) {
    this[`on${event}`] = handler;
  }

  close() {
    this.readyState = 2; // CLOSED
  }

  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }
}

/**
 * Mock WebSocket Client for testing
 */
class MockWebSocketClient {
  constructor() {
    this.connected = false;
    this.lastSent = null;
  }

  async connect(options) {
    this.connected = true;
    return new MockWebSocket();
  }
}

class MockWebSocket {
  constructor() {
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.readyState = 1; // OPEN
    
    // Simulate connection
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 10);
  }

  send(data) {
    this.lastSent = data;
  }

  close(code, reason) {
    this.readyState = 3; // CLOSED
    setTimeout(() => {
      if (this.onclose) this.onclose({ code, reason });
    }, 10);
  }

  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }
}