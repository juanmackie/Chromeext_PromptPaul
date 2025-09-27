// ===== MCP (Model Context Protocol) Service =====

import { McpRegistry } from './mcp/registry.js';

const mcpRegistry = new McpRegistry({
  console: console,
  storage: chrome.storage.local
});

const MAX_MCP_LOGS = 500;
let mcpLogsBuffer = [];

function appendMcpLog(entry) {
  mcpLogsBuffer.push({
    timestamp: new Date().toISOString(),
    ...entry
  });
  
  // Keep only the last MAX_MCP_LOGS entries
  if (mcpLogsBuffer.length > MAX_MCP_LOGS) {
    mcpLogsBuffer = mcpLogsBuffer.slice(-MAX_MCP_LOGS);
  }
  
  // Persist logs to storage
  // Use try-catch for Chrome API calls in service worker
  try {
    chrome.storage.local.set({ mcpLogs: mcpLogsBuffer.slice(-MAX_MCP_LOGS) });
  } catch (error) {
    console.warn('Failed to save MCP logs:', error);
  }
}

let mcpSessions = {};
const mcpClientCapabilities = {
  "roots": { "listChanged": true },
  "sampling": {},
  "experimental": {},
  "logging": {}
};

const mcpClientInfo = { "name": "PromptPaulExtension", "version": "0.1.0" };

// Session management constants
const MCP_SESSION_TIMEOUT = 30000; // 30 seconds for requests
const MCP_SESSION_MAX_AGE = 300000; // 5 minutes session lifetime
const MCP_SESSION_CLEANUP_INTERVAL = 60000; // 1 minute cleanup interval
const MCP_MAX_RETRY_ATTEMPTS = 3;
const MCP_RETRY_DELAY = 1000; // 1 second base delay

let sessionCleanupTimer = null;

// Circuit breaker implementation
const mcpCircuitBreakers = {};
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute
const CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS = 3;

class CircuitBreaker {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenCallCount = 0;
    this.nextAttemptTime = 0;
  }

  async call(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error(`Circuit breaker OPEN for ${this.serverUrl}`);
      }
      this.state = 'HALF_OPEN';
      this.halfOpenCallCount = 0;
      appendMcpLog({ level: 'info', message: `Circuit breaker transitioning to HALF_OPEN for ${this.serverUrl}` });
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenCallCount >= CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS) {
      throw new Error(`Circuit breaker HALF_OPEN call limit exceeded for ${this.serverUrl}`);
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      appendMcpLog({ level: 'info', message: `Circuit breaker reset to CLOSED for ${this.serverUrl}` });
    }
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.halfOpenCallCount++;
    }

    if (this.failureCount >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + CIRCUIT_BREAKER_TIMEOUT;
      appendMcpLog({
        level: 'warn',
        message: `Circuit breaker OPEN for ${this.serverUrl}, retry after ${new Date(this.nextAttemptTime).toISOString()}`
      });
    }
  }
}

function getCircuitBreaker(serverUrl) {
  if (!mcpCircuitBreakers[serverUrl]) {
    mcpCircuitBreakers[serverUrl] = new CircuitBreaker(serverUrl);
  }
  return mcpCircuitBreakers[serverUrl];
}

function startSessionCleanup() {
  if (sessionCleanupTimer) {
    clearInterval(sessionCleanupTimer);
  }
  
  sessionCleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [url, session] of Object.entries(mcpSessions)) {
      const age = now - session.createdAt;
      if (age > MCP_SESSION_MAX_AGE || !isSessionHealthy(session)) {
        appendMcpLog({
          level: 'info',
          message: `Cleaning up stale session for ${url}, age: ${Math.round(age/1000)}s`
        });
        delete mcpSessions[url];
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      appendMcpLog({ level: 'info', message: `Cleaned up ${cleanedCount} stale MCP sessions` });
    }
  }, MCP_SESSION_CLEANUP_INTERVAL);
  
  appendMcpLog({ level: 'info', message: 'Started MCP session cleanup timer' });
}

function isSessionHealthy(session) {
  if (!session) return false;
  
  const now = Date.now();
  const age = now - session.createdAt;
  const timeSinceLastActivity = now - (session.lastActivity || session.createdAt);
  
  // Session is unhealthy if too old or inactive
  return age < MCP_SESSION_MAX_AGE && timeSinceLastActivity < MCP_SESSION_MAX_AGE;
}

async function fetchWithTimeout(url, options, timeoutMs = MCP_SESSION_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

async function retryWithBackoff(operation, maxAttempts = MCP_MAX_RETRY_ATTEMPTS, baseDelay = MCP_RETRY_DELAY) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts) {
        break;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 0.1 * delay;
      const totalDelay = delay + jitter;
      
      appendMcpLog({
        level: 'warn',
        message: `Attempt ${attempt} failed, retrying in ${Math.round(totalDelay)}ms: ${error.message}`
      });
      
      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
  }
  
  throw lastError;
}

async function sendMcpNotification(mcpServerUrl, method, params) {
  try {
    const session = mcpSessions[mcpServerUrl];
    if (!session || !session.websocket || session.websocket.readyState !== WebSocket.OPEN) {
      throw new Error(`No active session for ${mcpServerUrl}`);
    }

    const notification = {
      jsonrpc: "2.0",
      method: method,
      params: params || {}
    };

    session.websocket.send(JSON.stringify(notification));
    session.lastActivity = Date.now();
    
    appendMcpLog({
      level: 'debug',
      message: `Sent notification ${method} to ${mcpServerUrl}`,
      data: { method, params }
    });

  } catch (error) {
    appendMcpLog({
      level: 'error',
      message: `Failed to send notification to ${mcpServerUrl}: ${error.message}`,
      error: error.stack
    });
    throw error;
  }
}

async function initializeMcpSession(mcpServerUrl) {
  const circuitBreaker = getCircuitBreaker(mcpServerUrl);
  
  return await circuitBreaker.call(async () => {
    return await retryWithBackoff(async () => {
      appendMcpLog({
        level: 'info',
        message: `Initializing MCP session for ${mcpServerUrl}`
      });

      const websocket = new WebSocket(mcpServerUrl);
      let sessionInitialized = false;
      let initializationError = null;

      const session = {
        websocket: websocket,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        status: 'connecting',
        requestId: 1,
        pendingRequests: new Map()
      };

      // Store session immediately
      mcpSessions[mcpServerUrl] = session;

      const initPromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          if (!sessionInitialized) {
            initializationError = new Error('Session initialization timeout');
            reject(initializationError);
          }
        }, MCP_SESSION_TIMEOUT);

        websocket.onopen = async () => {
          try {
            appendMcpLog({
              level: 'info',
              message: `WebSocket connected to ${mcpServerUrl}`
            });

            session.status = 'connected';

            // Send initialize request
            const initRequest = {
              jsonrpc: "2.0",
              id: session.requestId++,
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: mcpClientCapabilities,
                clientInfo: mcpClientInfo
              }
            };

            websocket.send(JSON.stringify(initRequest));
            session.lastActivity = Date.now();

          } catch (error) {
            initializationError = error;
            clearTimeout(timeoutId);
            reject(error);
          }
        };

        websocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            session.lastActivity = Date.now();

            appendMcpLog({
              level: 'debug',
              message: `Received message from ${mcpServerUrl}`,
              data: message
            });

            if (message.id && message.method === undefined) {
              // This is a response
              if (message.result && message.result.protocolVersion) {
                // Initialize response
                session.status = 'initialized';
                sessionInitialized = true;
                clearTimeout(timeoutId);

                // Send initialized notification
                const initializedNotification = {
                  jsonrpc: "2.0",
                  method: "notifications/initialized"
                };
                websocket.send(JSON.stringify(initializedNotification));

                resolve(session);
              }
            }
          } catch (error) {
            appendMcpLog({
              level: 'error',
              message: `Error processing message from ${mcpServerUrl}: ${error.message}`,
              error: error.stack
            });
          }
        };

        websocket.onerror = (error) => {
          appendMcpLog({
            level: 'error',
            message: `WebSocket error for ${mcpServerUrl}`,
            error: error
          });
          
          if (!sessionInitialized) {
            initializationError = new Error(`WebSocket connection failed: ${error.message || 'Unknown error'}`);
            clearTimeout(timeoutId);
            reject(initializationError);
          }
        };

        websocket.onclose = (event) => {
          appendMcpLog({
            level: 'info',
            message: `WebSocket closed for ${mcpServerUrl}, code: ${event.code}, reason: ${event.reason}`
          });
          
          session.status = 'closed';
          
          if (!sessionInitialized && !initializationError) {
            initializationError = new Error(`WebSocket closed unexpectedly: ${event.reason || 'Unknown reason'}`);
            clearTimeout(timeoutId);
            reject(initializationError);
          }
        };
      });

      return await initPromise;
    });
  });
}

async function getMcpSession(mcpServerUrl) {
  let session = mcpSessions[mcpServerUrl];
  
  if (!session || !isSessionHealthy(session) || 
      !session.websocket || session.websocket.readyState !== WebSocket.OPEN) {
    
    if (session) {
      appendMcpLog({
        level: 'info',
        message: `Existing session for ${mcpServerUrl} is unhealthy, creating new session`
      });
      delete mcpSessions[mcpServerUrl];
    }
    
    session = await initializeMcpSession(mcpServerUrl);
  }
  
  return session;
}

async function listMcpTools(mcpServerUrl, sessionId) {
  try {
    const session = await getMcpSession(mcpServerUrl);
    
    const request = {
      jsonrpc: "2.0",
      id: session.requestId++,
      method: "tools/list",
      params: {}
    };

    const response = await sendMcpRequest(mcpServerUrl, request);
    
    if (response && response.result && Array.isArray(response.result.tools)) {
      return response.result.tools;
    }
    
    throw new Error('Invalid tools list response');
  } catch (error) {
    appendMcpLog({
      level: 'error',
      message: `Failed to list tools from ${mcpServerUrl}: ${error.message}`,
      error: error.stack
    });
    throw error;
  }
}

function createMcpToolCallPayload(toolName, toolArguments, requestId) {
  return {
    jsonrpc: "2.0",
    id: requestId,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: toolArguments || {}
    }
  };
}

async function sendMcpRequest(mcpServerUrl, requestPayload) {
  const circuitBreaker = getCircuitBreaker(mcpServerUrl);
  
  return await circuitBreaker.call(async () => {
    return await retryWithBackoff(async () => {
      const session = await getMcpSession(mcpServerUrl);
      
      if (!session.websocket || session.websocket.readyState !== WebSocket.OPEN) {
        throw new Error(`WebSocket not ready for ${mcpServerUrl}`);
      }

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          session.pendingRequests.delete(requestPayload.id);
          reject(new Error(`Request timeout for ${mcpServerUrl}`));
        }, MCP_SESSION_TIMEOUT);

        const cleanup = () => {
          clearTimeout(timeoutId);
          session.pendingRequests.delete(requestPayload.id);
        };

        session.pendingRequests.set(requestPayload.id, {
          resolve: (response) => {
            cleanup();
            resolve(response);
          },
          reject: (error) => {
            cleanup();
            reject(error);
          }
        });

        // Set up message handler for this specific request
        const originalOnMessage = session.websocket.onmessage;
        session.websocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            
            if (message.id === requestPayload.id) {
              const pendingRequest = session.pendingRequests.get(requestPayload.id);
              if (pendingRequest) {
                if (message.error) {
                  pendingRequest.reject(new Error(`MCP Error: ${JSON.stringify(message.error)}`));
                } else {
                  pendingRequest.resolve(message);
                }
              }
            }
            
            // Call original handler for other messages
            if (originalOnMessage) {
              originalOnMessage(event);
            }
          } catch (error) {
            const pendingRequest = session.pendingRequests.get(requestPayload.id);
            if (pendingRequest) {
              pendingRequest.reject(error);
            }
          }
        };

        try {
          session.websocket.send(JSON.stringify(requestPayload));
          session.lastActivity = Date.now();
          
          appendMcpLog({
            level: 'debug',
            message: `Sent request ${requestPayload.method} to ${mcpServerUrl}`,
            data: requestPayload
          });
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    });
  });
}

function cleanupMcpSessions() {
  console.log('MCP Cleanup: Cleaning up all sessions and timers');
  
  // Clear session cleanup timer
  if (sessionCleanupTimer) {
    clearInterval(sessionCleanupTimer);
    sessionCleanupTimer = null;
  }
  
  // Clear all sessions
  const sessionCount = Object.keys(mcpSessions).length;
  mcpSessions = {};
  
  // Clear circuit breakers
  const breakerCount = Object.keys(mcpCircuitBreakers).length;
  for (const url in mcpCircuitBreakers) {
    delete mcpCircuitBreakers[url];
  }
  
  console.log(`MCP Cleanup: Cleared ${sessionCount} sessions and ${breakerCount} circuit breakers`);
}

function performSessionHealthCheck() {
  const now = Date.now();
  let healthyCount = 0;
  let unhealthyCount = 0;
  
  for (const [url, session] of Object.entries(mcpSessions)) {
    if (isSessionHealthy(session)) {
      healthyCount++;
    } else {
      unhealthyCount++;
      console.log(`MCP Health Check: Session for ${url} is unhealthy, will be cleaned up`);
    }
  }
  
  if (healthyCount > 0 || unhealthyCount > 0) {
    console.log(`MCP Health Check: ${healthyCount} healthy, ${unhealthyCount} unhealthy sessions`);
  }
}

// Initialize MCP service
function initializeMcpService() {
  startSessionCleanup();
  
  // Run health check every 2 minutes
  setInterval(performSessionHealthCheck, 120000);
  
  appendMcpLog({ level: 'info', message: 'MCP Service initialized' });
}

export {
  initializeMcpService,
  getMcpSession,
  listMcpTools,
  sendMcpRequest,
  createMcpToolCallPayload,
  cleanupMcpSessions,
  appendMcpLog,
  mcpLogsBuffer
};