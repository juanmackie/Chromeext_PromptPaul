/**
 * Jest Test Setup for Chrome Extension
 * Configures global test environment and utilities
 */

const { mockChrome, mockChromeHelpers } = require('./chrome-mocks.cjs');

// Global Chrome API mock
global.chrome = mockChrome;
global.mockChromeHelpers = mockChromeHelpers;

// Note: Module mocking will be handled in individual test files
// to avoid ES6 module resolution issues

// Setup and teardown for each test
beforeEach(() => {
  // Reset Chrome API mocks before each test
  mockChromeHelpers.resetMocks();

  // Set up basic DOM mocks
  global.document = {
    getElementById: jest.fn(),
    createElement: jest.fn(() => ({
      id: '',
      className: '',
      textContent: '',
      innerHTML: '',
      style: {},
      addEventListener: jest.fn(),
      appendChild: jest.fn(),
      querySelector: jest.fn(() => null),
      focus: jest.fn(),
      click: jest.fn(),
      setAttribute: jest.fn(),
      getAttribute: jest.fn(),
      removeAttribute: jest.fn(),
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        contains: jest.fn(() => false),
        toggle: jest.fn(),
      },
    })),
    querySelector: jest.fn(() => null),
    body: { appendChild: jest.fn() },
    addEventListener: jest.fn(),
    location: { reload: jest.fn() },
  };

  global.window = {
    loadingManager: {
      showToast: jest.fn(),
      setButtonLoading: jest.fn(),
    },
    location: global.document.location,
  };

  // Mock fetch API for API calls
  global.fetch = jest.fn();

  // Mock localStorage/sessionStorage
  global.localStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
    length: 0,
    key: jest.fn(),
  };

  global.sessionStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
    length: 0,
    key: jest.fn(),
  };

  // Mock console methods to reduce noise in tests (but keep errors)
  const originalConsole = { ...console };
  global.console = {
    ...originalConsole,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: originalConsole.error, // Keep errors for debugging
    group: jest.fn(),
    groupEnd: jest.fn(),
    groupCollapsed: jest.fn(),
    table: jest.fn(),
    time: jest.fn(),
    timeEnd: jest.fn(),
    timeLog: jest.fn(),
    trace: jest.fn(),
    clear: jest.fn(),
    count: jest.fn(),
    countReset: jest.fn(),
    assert: jest.fn(),
    profile: jest.fn(),
    profileEnd: jest.fn(),
    dir: jest.fn(),
    dirxml: jest.fn(),
  };

  // Mock URL and URLSearchParams
  global.URL = class MockURL {
    constructor(url, base) {
      this.href = url;
      this.origin = 'http://localhost:3000';
      this.protocol = 'http:';
      this.host = 'localhost:3000';
      this.hostname = 'localhost';
      this.port = '3000';
      this.pathname = '/';
      this.search = '';
      this.hash = '';
    }

    toString() {
      return this.href;
    }
  };

  global.URLSearchParams = class MockURLSearchParams {
    constructor(init) {
      this.params = new Map();
      if (typeof init === 'string') {
        // Parse query string
        init.split('&').forEach(pair => {
          const [key, value] = pair.split('=');
          if (key) {
            this.params.set(decodeURIComponent(key), decodeURIComponent(value || ''));
          }
        });
      }
    }

    get(name) {
      return this.params.get(name) || null;
    }

    set(name, value) {
      this.params.set(name, value);
    }

    has(name) {
      return this.params.has(name);
    }

    delete(name) {
      this.params.delete(name);
    }

    toString() {
      const pairs = Array.from(this.params.entries())
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
      return pairs;
    }
  };

  // Mock TextDecoder for streaming
  global.TextDecoder = class MockTextDecoder {
    constructor(encoding = 'utf-8', options = {}) {
      this.encoding = encoding;
      this.fatal = options.fatal || false;
      this.ignoreBOM = options.ignoreBOM || false;
    }

    decode(buffer, options = {}) {
      // Simple mock implementation
      if (typeof buffer === 'string') return buffer;
      if (buffer instanceof ArrayBuffer) {
        return new TextDecoder(this.encoding).decode(buffer);
      }
      return '';
    }
  };

  // Mock Blob for file operations
  global.Blob = class MockBlob {
    constructor(parts, options = {}) {
      this.parts = parts || [];
      this.type = options.type || '';
      this.size = parts.reduce((total, part) => {
        if (typeof part === 'string') return total + part.length;
        if (part instanceof ArrayBuffer) return total + part.byteLength;
        return total;
      }, 0);
    }

    arrayBuffer() {
      return Promise.resolve(new ArrayBuffer(this.size));
    }

    text() {
      return Promise.resolve(this.parts.join(''));
    }

    stream() {
      return {
        getReader: jest.fn(() => ({
          read: jest.fn().mockResolvedValue({ done: true }),
          releaseLock: jest.fn(),
        })),
      };
    }
  };

  // Mock File for file operations
  global.File = class MockFile extends global.Blob {
    constructor(parts, name, options = {}) {
      super(parts, options);
      this.name = name;
      this.lastModified = Date.now();
    }
  };

  // Mock FormData for API requests
  global.FormData = class MockFormData {
    constructor() {
      this.data = new Map();
    }

    append(name, value, filename) {
      this.data.set(name, { value, filename });
    }

    get(name) {
      return this.data.get(name);
    }

    has(name) {
      return this.data.has(name);
    }

    delete(name) {
      this.data.delete(name);
    }

    entries() {
      return this.data.entries();
    }
  };

  // Mock AbortController for request cancellation
  global.AbortController = class MockAbortController {
    constructor() {
      this.signal = {
        aborted: false,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      };
    }

    abort() {
      this.signal.aborted = true;
    }
  };

  // Mock AbortSignal
  global.AbortSignal = class MockAbortSignal {
    constructor() {
      this.aborted = false;
    }

    static timeout(ms) {
      const signal = new MockAbortSignal();
      setTimeout(() => {
        signal.aborted = true;
      }, ms);
      return signal;
    }
  };

  // Mock ReadableStream for streaming responses
  global.ReadableStream = class MockReadableStream {
    constructor(underlyingSource) {
      this.underlyingSource = underlyingSource;
    }

    getReader() {
      return {
        read: jest.fn().mockResolvedValue({ done: true }),
        releaseLock: jest.fn(),
      };
    }

    tee() {
      return [new MockReadableStream(), new MockReadableStream()];
    }

    pipeThrough(transforms) {
      return new MockReadableStream();
    }

    pipeTo(writableStream) {
      return Promise.resolve();
    }
  };

  // Mock Response for fetch API
  global.Response = class MockResponse {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status || 200;
      this.statusText = init.statusText || 'OK';
      this.headers = new Map(Object.entries(init.headers || {}));
      this.ok = this.status >= 200 && this.status < 300;
      this.redirected = init.redirected || false;
      this.type = init.type || 'basic';
      this.url = init.url || '';
    }

    static json(data) {
      return new MockResponse(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    async text() {
      if (typeof this.body === 'string') return this.body;
      if (this.body instanceof ArrayBuffer) {
        return new TextDecoder().decode(this.body);
      }
      return '';
    }

    async json() {
      const text = await this.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new SyntaxError('Unexpected token in JSON');
      }
    }

    async arrayBuffer() {
      if (this.body instanceof ArrayBuffer) return this.body;
      if (typeof this.body === 'string') {
        const encoder = new TextEncoder();
        return encoder.encode(this.body).buffer;
      }
      return new ArrayBuffer(0);
    }

    clone() {
      return new MockResponse(this.body, {
        status: this.status,
        headers: Object.fromEntries(this.headers),
      });
    }
  };

  // Mock Request for fetch API
  global.Request = class MockRequest {
    constructor(input, init = {}) {
      this.url = typeof input === 'string' ? input : input.url;
      this.method = init.method || 'GET';
      this.headers = new Map(Object.entries(init.headers || {}));
      this.body = init.body || null;
      this.mode = init.mode || 'cors';
      this.credentials = init.credentials || 'same-origin';
      this.cache = init.cache || 'default';
      this.redirect = init.redirect || 'follow';
      this.referrer = init.referrer || '';
      this.referrerPolicy = init.referrerPolicy || '';
      this.integrity = init.integrity || '';
      this.keepalive = init.keepalive || false;
      this.signal = init.signal || null;
    }

    async json() {
      if (this.body) {
        try {
          return JSON.parse(this.body);
        } catch {
          throw new SyntaxError('Unexpected token in JSON');
        }
      }
      return null;
    }

    async text() {
      return this.body || '';
    }
  };

  // Mock WebSocket (if needed)
  global.WebSocket = class MockWebSocket {
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = WebSocket.CONNECTING;
      this.bufferedAmount = 0;
      this.extensions = '';
      this.protocol = '';

      // Simulate connection
      setTimeout(() => {
        this.readyState = WebSocket.OPEN;
        this.onopen?.({ type: 'open' });
      }, 10);
    }

    send(data) {
      // Mock send
    }

    close(code, reason) {
      this.readyState = WebSocket.CLOSING;
      this.onclose?.({ type: 'close', code, reason });
    }

    addEventListener(type, listener) {
      // Mock event listener
    }

    removeEventListener(type, listener) {
      // Mock event listener removal
    }
  };

  // WebSocket constants
  global.WebSocket.CONNECTING = 0;
  global.WebSocket.OPEN = 1;
  global.WebSocket.CLOSING = 2;
  global.WebSocket.CLOSED = 3;

  // Mock IntersectionObserver for UI testing
  global.IntersectionObserver = class MockIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
    }

    observe(element) {
      // Mock observation
      setTimeout(() => {
        this.callback([{ isIntersecting: true, target: element }]);
      }, 10);
    }

    unobserve(element) {
      // Mock unobservation
    }

    disconnect() {
      // Mock disconnection
    }
  };

  // Mock ResizeObserver
  global.ResizeObserver = class MockResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }

    observe(element) {
      // Mock observation
    }

    unobserve(element) {
      // Mock unobservation
    }

    disconnect() {
      // Mock disconnection
    }
  };

  // Mock MutationObserver
  global.MutationObserver = class MockMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }

    observe(target, options) {
      // Mock observation
    }

    disconnect() {
      // Mock disconnection
    }

    takeRecords() {
      return [];
    }
  };

  // Mock Performance API
  global.performance = {
    now: jest.fn(() => Date.now()),
    mark: jest.fn(),
    measure: jest.fn(),
    getEntriesByType: jest.fn(() => []),
    getEntriesByName: jest.fn(() => []),
  };

  // Mock crypto API
  global.crypto = {
    getRandomValues: jest.fn(array => {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    }),
    randomUUID: jest.fn(() => `mock-uuid-${  Math.random().toString(36).substr(2, 9)}`),
    subtle: {
      digest: jest.fn(() => Promise.resolve(new ArrayBuffer(32))),
    },
  };

  // Mock atob and btoa
  global.atob = jest.fn(str => Buffer.from(str, 'base64').toString('binary'));
  global.btoa = jest.fn(str => Buffer.from(str, 'binary').toString('base64'));
});

// Global test utilities
global.testUtils = {
  // Wait for promises to resolve
  waitFor: (ms = 0) => new Promise(resolve => setTimeout(resolve, ms)),

  // Wait for next tick
  nextTick: () => new Promise(resolve => setImmediate(resolve)),

  // Create mock fetch response
  mockFetchResponse: (data, options = {}) => {
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
      headers: new Map(),
      ...options,
    };
    global.fetch.mockResolvedValue(response);
    return response;
  },

  // Create mock fetch error
  mockFetchError: (message, status = 500) => {
    const error = new Error(message);
    error.status = status;
    global.fetch.mockRejectedValue(error);
  },

  // Simulate Chrome storage changes
  simulateStorageChange: (changes, areaName) => {
    mockChrome.storage.onChanged._listeners.forEach(listener => {
      listener(changes, areaName);
    });
  },

  // Create mock DOM element
  createElement: (tag, attributes = {}) => {
    const element = {
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      innerHTML: '',
      style: {},
      dataset: {},
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      click: jest.fn(),
      focus: jest.fn(),
      blur: jest.fn(),
      querySelector: jest.fn(() => null),
      querySelectorAll: jest.fn(() => []),
      getAttribute: jest.fn(),
      setAttribute: jest.fn(),
      removeAttribute: jest.fn(),
      appendChild: jest.fn(),
      removeChild: jest.fn(),
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        contains: jest.fn(() => false),
        toggle: jest.fn(),
      },
      ...attributes,
    };

    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'id') element.id = value;
      else if (key === 'className') element.className = value;
      else if (key === 'textContent') element.textContent = value;
      else if (key === 'innerHTML') element.innerHTML = value;
      else element[key] = value;
    });

    return element;
  },

  // Create mock event
  createEvent: (type, properties = {}) => {
    return {
      type,
      bubbles: false,
      cancelable: false,
      defaultPrevented: false,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      ...properties,
    };
  },
};

// Mock timers for consistent testing
jest.useFakeTimers();

// Increase timeout for async operations
jest.setTimeout(10000);

// Setup global error handlers for tests
process.on('unhandledRejection', error => {
  console.error('Unhandled Rejection in tests:', error);
});
