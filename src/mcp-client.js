// ===== MCP Client Module - MCP protocol handling =====
import { trackErrorEvent } from './analytics.js';

// MCP Session Management
let mcpSessions = {};
const mcpClientCapabilities = {
  experimental: {}, // For any experimental features client supports
  // No 'roots' capability declared, as the extension doesn't primarily serve local file roots to tools.
  // No 'sampling' capability declared, as tools don't typically ask the extension (client) to perform LLM sampling for them via MCP.
  elicitation: {} // Declares that the client understands the elicitation protocol.
                  // Actual handling of elicitation requests from the server would be a future enhancement.
};
const mcpClientInfo = { "name": "PromptPaulExtension", "version": "0.1.0" }; // Use appropriate version

// Session lifecycle management constants
const MCP_SESSION_TIMEOUT = 30000; // 30 seconds for requests
const MCP_SESSION_MAX_AGE = 300000; // 5 minutes session lifetime
const MCP_SESSION_CLEANUP_INTERVAL = 60000; // 1 minute cleanup interval
const MCP_MAX_RETRY_ATTEMPTS = 3;
const MCP_RETRY_DELAY = 1000; // 1 second base delay

// Session cleanup timer
let sessionCleanupTimer = null;

// Circuit breaker for MCP servers
const mcpCircuitBreakers = {};
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute
const CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS = 3;

class CircuitBreaker {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.halfOpenCallCount = 0;
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > CIRCUIT_BREAKER_TIMEOUT) {
        this.state = 'HALF_OPEN';
        this.halfOpenCallCount = 0;
        console.log(`Circuit breaker for ${this.serverUrl} moving to HALF_OPEN state`);
      } else {
        throw new Error(`Circuit breaker OPEN for ${this.serverUrl}. Server temporarily unavailable.`);
      }
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenCallCount >= CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS) {
      throw new Error(`Circuit breaker HALF_OPEN limit reached for ${this.serverUrl}. Server still unstable.`);
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
      console.log(`Circuit breaker for ${this.serverUrl} recovered to CLOSED state`);
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
      console.log(`Circuit breaker for ${this.serverUrl} tripped to OPEN state after ${this.failureCount} failures`);
    }
  }
}

function getCircuitBreaker(serverUrl) {
  if (!mcpCircuitBreakers[serverUrl]) {
    mcpCircuitBreakers[serverUrl] = new CircuitBreaker(serverUrl);
  }
  return mcpCircuitBreakers[serverUrl];
}

// Start session cleanup timer
function startSessionCleanup() {
  if (sessionCleanupTimer) return; // Already running

  sessionCleanupTimer = setInterval(() => {
    const now = Date.now();
    const sessionsToCleanup = [];

    for (const [url, session] of Object.entries(mcpSessions)) {
      if (session.lastUsed && (now - session.lastUsed) > MCP_SESSION_MAX_AGE) {
        sessionsToCleanup.push(url);
      }
    }

    for (const url of sessionsToCleanup) {
      console.log(`MCP Session cleanup: Removing stale session for ${url}`);
      delete mcpSessions[url];
    }

    if (Object.keys(mcpSessions).length === 0 && sessionCleanupTimer) {
      clearInterval(sessionCleanupTimer);
      sessionCleanupTimer = null;
      console.log('MCP Session cleanup: No active sessions, stopping cleanup timer');
    }
  }, MCP_SESSION_CLEANUP_INTERVAL);

  console.log('MCP Session cleanup: Started cleanup timer');
}

// Enhanced session health check
function isSessionHealthy(session) {
  if (!session || !session.initialized) return false;

  const now = Date.now();
  if (session.lastUsed && (now - session.lastUsed) > MCP_SESSION_MAX_AGE) {
    return false;
  }

  return true;
}

// Timeout wrapper for fetch requests
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
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// Retry wrapper with exponential backoff
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

      // Don't retry on certain errors
      if (error.message.includes('404') || error.message.includes('401') || error.message.includes('403')) {
        break;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`MCP Retry: Attempt ${attempt} failed, retrying in ${delay}ms. Error:`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

async function sendMcpNotification(mcpServerUrl, method, params) {
  console.log(`Sending MCP notification '${method}' to ${mcpServerUrl} with params:`, params);
  const session = mcpSessions[mcpServerUrl]; // Get session, primarily for mcpSessionId

  const notificationPayload = {
    jsonrpc: "2.0",
    method: method,
    params: params || {}
  };

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream' // Keep this from previous fix
  };

  if (session && session.mcpSessionId) {
    headers['mcp-session-id'] = session.mcpSessionId;
    console.log(`Including mcp-session-id: ${session.mcpSessionId} in notification '${method}' to ${mcpServerUrl}`);
  } else if (method === "initialized") {
    // The 'initialized' notification is part of the session setup.
    // If mcpSessionId was just obtained in initializeMcpSession and set into mcpSessions,
    // it *should* be found here. If not, it's a problem or the server didn't provide one.
    console.warn(`Sending '${method}' notification to ${mcpServerUrl} WITHOUT mcpSessionId. This might be an issue if the server expects it even for 'initialized'.`);
  } else {
    // For other methods, we should have a session ID if the session was properly initialized
    console.warn(`Sending '${method}' notification to ${mcpServerUrl} WITHOUT mcpSessionId. This could cause issues if the server requires it.`);
  }


  try {
    const response = await fetchWithTimeout(mcpServerUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(notificationPayload)
    });

    if (!response.ok) {
      // For notifications, we might not always get a body or a meaningful JSON error.
      // The primary concern is whether the HTTP request itself succeeded.
      console.warn(`MCP Notification HTTP error! Status: ${response.status} for method ${method}`);
      // Optionally, try to read body if there's an issue.
      try {
        const errorBody = await response.text(); // Using text() as it might not be JSON
        console.warn(`MCP Notification error body: ${errorBody}`);
      } catch(e) { /* ignore */ }
    }
    // Notifications do not have responses to parse beyond HTTP status.
  } catch (error) {
    console.error(`Error sending MCP notification '${method}' to ${mcpServerUrl}:`, error);
    // Depending on desired robustness, could throw or just log.
  }
}

async function initializeMcpSession(mcpServerUrl) {
  console.log(`Initializing MCP session for: ${mcpServerUrl} (expecting SSE response)`);

  // Check circuit breaker before attempting initialization
  const circuitBreaker = getCircuitBreaker(mcpServerUrl);

  return await circuitBreaker.execute(async () => {
    const requestId = `mcp-init-${Date.now()}`;
    const initializeParams = {
      protocolVersion: "0.1.0",
      capabilities: mcpClientCapabilities,
      clientInfo: mcpClientInfo
    };
    const requestPayload = {
      jsonrpc: "2.0",
      id: requestId,
      method: "initialize",
      params: initializeParams
    };

  try {
    const response = await retryWithBackoff(async () => {
      return await fetchWithTimeout(mcpServerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream' // Correct Accept header
        },
        body: JSON.stringify(requestPayload)
      });
    });

    if (!response.ok) {
      let errorMsg = `MCP Initialize HTTP error! Status: ${response.status}`;
      try {
        const errorBody = await response.text(); // Use text() for potential non-JSON errors too
        errorMsg += `, Body: ${errorBody}`;
      } catch (e) { /* ignore */ }
      throw new Error(`MCP Initialize failed for ${mcpServerUrl}: HTTP status ${response.status}. Body: ${errorBody}`);
    }

    const mcpSessionId = response.headers.get('mcp-session-id');
    if (!mcpSessionId) {
      console.error(`MCP Initialize Error: mcp-session-id header not found in response from ${mcpServerUrl}. This is required for subsequent requests.`);
      // This is now treated as an error since most servers will require the session ID
      throw new Error(`MCP Initialize failed: mcp-session-id header missing in response from ${mcpServerUrl}`);
    } else {
      console.log(`MCP Initialize: Received mcp-session-id: ${mcpSessionId}`);
    }

    const responseText = await response.text();
    console.debug(`MCP Initialize: Raw response text from ${mcpServerUrl} for request ID ${requestId}:\n${responseText}`);
    let serverResponse = null;
    let foundInitializeResult = false;

    // Process potential SSE stream for the initialize response
    // An SSE stream might contain multiple messages. We need to find the one that's a JSON-RPC response to our 'initialize' request.
    const lines = responseText.split('\n');
    let accumulatedData = ''; // For multi-line data fields in SSE

    for (const line of lines) {
      if (line.startsWith('data:')) {
        accumulatedData += line.substring(5).trim(); // Accumulate data lines
      } else if (line.trim() === '' && accumulatedData) { // Empty line signifies end of an SSE message's data
        try {
          const parsedEventData = JSON.parse(accumulatedData);
          console.debug(`MCP Initialize: Parsed SSE data event from ${mcpServerUrl} for request ID ${requestId}:`, parsedEventData);
          if (parsedEventData.id === requestId && (parsedEventData.result || parsedEventData.error)) {
            serverResponse = parsedEventData;
            foundInitializeResult = true;
            console.log(`MCP Initialize: Found JSON-RPC response for ID ${requestId} in SSE data:`, serverResponse);
            break;
          }
        } catch (e) {
          console.warn(`MCP Initialize: Could not parse accumulated SSE data as JSON or not the target response. Data: "${accumulatedData}". Error:`, e);
        }
        accumulatedData = ''; // Reset for next message
      } else if (accumulatedData && !line.startsWith('id:') && !line.startsWith('event:') && !line.startsWith('retry:')) {
        // If a line is not 'data:' but part of a multi-line data field (though less common for JSON-RPC over SSE)
        // This simplistic accumulation might need refinement based on exact server behavior.
        // For now, primary focus is on complete JSON objects per 'data:' line or block.
        // The check `line.trim() === '' && accumulatedData` is more robust for distinct JSON objects.
      }
    }

    // If after processing all lines, there's still accumulatedData, try to parse it (e.g., stream ended without a final empty line)
    if (accumulatedData && !foundInitializeResult) {
      try {
        const parsedEventData = JSON.parse(accumulatedData);
        console.debug(`MCP Initialize: Parsed final accumulated SSE data event from ${mcpServerUrl} for request ID ${requestId}:`, parsedEventData);
        if (parsedEventData.id === requestId && (parsedEventData.result || parsedEventData.error)) {
          serverResponse = parsedEventData;
          foundInitializeResult = true;
          console.log(`MCP Initialize: Found JSON-RPC response for ID ${requestId} in final accumulated SSE data:`, serverResponse);
        }
      } catch (e) {
        console.warn(`MCP Initialize: Could not parse final accumulated SSE data as JSON. Data: "${accumulatedData}". Error:`, e);
      }
    }

    if (!foundInitializeResult || !serverResponse) {
      // Fallback: if SSE parsing didn't yield a result, try parsing the whole responseText as a single JSON object
      // This handles cases where the server might not use SSE for the initialize response despite Accept header.
      if (!responseText.includes('data:')) { // Only try this if it doesn't look like SSE at all
        try {
          console.log(`MCP Initialize: Response from ${mcpServerUrl} did not seem to be SSE. Attempting to parse as plain JSON.`);
          const parsedResponse = JSON.parse(responseText);
          if (parsedResponse.id === requestId && (parsedResponse.result || parsedResponse.error)) {
            serverResponse = parsedResponse;
            foundInitializeResult = true;
            console.log(`MCP Initialize: Successfully parsed non-SSE response for ID ${requestId}:`, serverResponse);
          }
        } catch (e) {
          console.warn(`MCP Initialize: Failed to parse response as plain JSON after SSE attempt failed for ${mcpServerUrl}. Error:`, e);
        }
      }
    }

    if (!foundInitializeResult || !serverResponse) {
      console.error(`MCP Initialize: Critical - JSON-RPC response for request ID ${requestId} not found in response from ${mcpServerUrl}. Full response text was logged previously.`);
      throw new Error(`MCP Initialize failed for ${mcpServerUrl}: JSON-RPC response for request ID ${requestId} not found.`);
    }

    if (serverResponse.error) {
      console.error(`MCP Initialize: Server returned an error for request ID ${requestId}:`, serverResponse.error);
      throw new Error(`MCP Initialize failed for ${mcpServerUrl}: Server error ${serverResponse.error.code} - ${serverResponse.error.message}`);
    }

    if (!serverResponse.result || !serverResponse.result.capabilities || !serverResponse.result.protocolVersion) {
      console.error(`MCP Initialize: Invalid result structure in response for ID ${requestId} from ${mcpServerUrl}:`, serverResponse.result);
      throw new Error(`MCP Initialize failed: Invalid result structure from server for request ID ${requestId}.`);
    }

    console.log(`MCP Server Initialize Result (for ID ${requestId} from ${mcpServerUrl}):`, serverResponse.result);
    if (serverResponse.result.protocolVersion !== initializeParams.protocolVersion) {
      console.warn(`MCP Protocol version mismatch: Client sent ${initializeParams.protocolVersion}, Server responded with ${serverResponse.result.protocolVersion}. Proceeding.`);
    }

    const session = {
      mcpSessionId: mcpSessionId, // Store the extracted session ID
      serverUrl: mcpServerUrl,
      serverCapabilities: serverResponse.result.capabilities,
      protocolVersion: serverResponse.result.protocolVersion,
      initialized: true,
      createdAt: Date.now(),
      lastUsed: Date.now()
    };
    mcpSessions[mcpServerUrl] = session; // Cache the session
    console.log(`MCP session (with mcpSessionId: ${mcpSessionId}) successfully initialized and cached for ${mcpServerUrl}`);

    // Start cleanup timer if this is the first session
    startSessionCleanup();

    // Send "initialized" notification
    await sendMcpNotification(mcpServerUrl, "initialized", {});

    return session;

  } catch (error) {
    console.error(`Error during MCP session initialization for ${mcpServerUrl}:`, error);
    delete mcpSessions[mcpServerUrl];
    // Enhanced error message with more details
    const enhancedError = new Error(`MCP session initialization failed for ${mcpServerUrl}: ${error.message}`);
    enhancedError.cause = error; // Attach the original error as cause
    throw enhancedError;
  }
  }); // Close circuit breaker execute
}

async function getMcpSession(mcpServerUrl) {
  const existingSession = mcpSessions[mcpServerUrl];

  if (existingSession && isSessionHealthy(existingSession)) {
    console.log(`Returning existing healthy MCP session for: ${mcpServerUrl}`);
    existingSession.lastUsed = Date.now(); // Update last used timestamp
    return existingSession;
  }

  if (existingSession && !isSessionHealthy(existingSession)) {
    console.log(`Existing session for ${mcpServerUrl} is stale, removing and creating new session`);
    delete mcpSessions[mcpServerUrl];
  }

  console.log(`No existing session or not initialized, creating new MCP session for: ${mcpServerUrl}`);
  return await initializeMcpSession(mcpServerUrl);
}

function createMcpToolCallPayload(toolName, toolArguments, requestId) {
  // Ensure toolArguments is an object, as expected by MCP for structured params.
  // The LLM often sends arguments as a JSON string, which should be parsed *before* calling this.
  // If toolArguments is already an object, this is fine. If it's a string,
  // it indicates it wasn't parsed at the executePromptPaulTool level.
  // For safety, though this function expects an object:
  let paramsArguments = toolArguments;
  // Ensure toolArguments is an object
  if (typeof toolArguments === 'string') {
    try {
      paramsArguments = JSON.parse(toolArguments);
    } catch (e) {
      console.error("Tool arguments for MCP call were a string but not valid JSON:", toolArguments, e);
      throw new Error("Tool arguments must be a valid JSON object or pre-parsed object.");
    }
  } else if (typeof toolArguments !== 'object' || toolArguments === null) {
    console.error("Tool arguments must be an object:", toolArguments);
    throw new Error("Tool arguments must be an object.");
  }

  const toolCallParams = {
    name: toolName,
    arguments: paramsArguments
  };

  const requestPayload = {
    jsonrpc: "2.0",
    id: requestId, // Caller should generate a unique ID for each request
    method: "tools/call",
    params: toolCallParams
  };

  console.log(`MCP tools/call Request Payload for ${toolName}:`, JSON.stringify(requestPayload, null, 2));
  return requestPayload;
}

async function sendMcpRequest(mcpServerUrl, requestPayload) {
  console.log(`Sending MCP request to ${mcpServerUrl} with payload:`, JSON.stringify(requestPayload, null, 2));
  const session = mcpSessions[mcpServerUrl];
  const headers = {
    'Content-Type': 'application/json',

    'Accept': 'application/json, text/event-stream'
  };

  if (session && session.mcpSessionId) {
    headers['mcp-session-id'] = session.mcpSessionId;
    console.log(`MCP sendMcpRequest: Including mcp-session-id: ${session.mcpSessionId} in request '${requestPayload.method}' to ${mcpServerUrl}`);
  } else {
    // For the 'initialize' method, mcpSessionId is not expected in the request header.
    // For other methods, its absence is a problem if a session was expected to be established.
    if (requestPayload.method !== 'initialize') {
      console.error(`MCP sendMcpRequest: Critical - No mcpSessionId found for ${mcpServerUrl} when sending method '${requestPayload.method}'. This will likely cause the request to fail.`);
      // Optionally, could throw an error here if a session was strictly required:
      // throw new Error(`MCP sendMcpRequest: mcpSessionId is missing for server ${mcpServerUrl} during method ${requestPayload.method}.`);
    } else {
      console.log(`MCP sendMcpRequest: Sending 'initialize' method to ${mcpServerUrl}; mcpSessionId is not included in the request header as per protocol.`);
    }
  }

  try {
    const response = await retryWithBackoff(async () => {
      return await fetchWithTimeout(mcpServerUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestPayload)
      });
    });

    if (!response.ok) {
      let errorMsg = `MCP Request HTTP error! Status: ${response.status}`;
      try {
        const errorBody = await response.text(); // Use text() for more robust error body reading
        errorMsg += `, Body: ${errorBody}`;
      } catch (e) { /* ignore if body isn't text */ }
      throw new Error(`MCP Request '${requestPayload.method}' to ${mcpServerUrl} failed: HTTP status ${response.status}. Body: ${errorBody}`);
    }

    const responseText = await response.text();
    console.debug(`MCP sendMcpRequest: Raw response text from ${mcpServerUrl} for method '${requestPayload.method}', ID ${requestPayload.id}:\n${responseText}`);
    let serverResponse = null;
    let foundResponse = false;

    // Attempt to parse as SSE if response looks like it might be SSE
    if (responseText.includes('data:')) { // A simple heuristic for SSE
      console.debug(`MCP sendMcpRequest: Attempting to parse response from ${mcpServerUrl} (method '${requestPayload.method}', ID ${requestPayload.id}) as SSE.`);
      const lines = responseText.split('\n');
      let accumulatedData = '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          accumulatedData += line.substring(5).trim();
        } else if (line.trim() === '' && accumulatedData) { // End of an SSE message
          try {
            const parsedEventData = JSON.parse(accumulatedData);
            console.debug(`MCP sendMcpRequest: Parsed SSE data event for ID ${requestPayload.id}:`, parsedEventData);
            if (parsedEventData.id === requestPayload.id && (parsedEventData.result !== undefined || parsedEventData.error !== undefined)) {
              serverResponse = parsedEventData;
              foundResponse = true;
              console.log(`MCP sendMcpRequest: Found JSON-RPC response for ID ${requestPayload.id} (method '${requestPayload.method}') in SSE data:`, serverResponse);
              break;
            }
          } catch (e) {
            console.warn(`MCP sendMcpRequest: Could not parse accumulated SSE data for ID ${requestPayload.id} as JSON. Data: "${accumulatedData}". Error:`, e);
          }
          accumulatedData = ''; // Reset for next message
        }
      }
      // Process any remaining accumulated data if the stream didn't end with a blank line
      if (accumulatedData && !foundResponse) {
        try {
          const parsedEventData = JSON.parse(accumulatedData);
          console.debug(`MCP sendMcpRequest: Parsed final accumulated SSE data for ID ${requestPayload.id}:`, parsedEventData);
          if (parsedEventData.id === requestPayload.id && (parsedEventData.result !== undefined || parsedEventData.error !== undefined)) {
            serverResponse = parsedEventData;
            foundResponse = true;
            console.log(`MCP sendMcpRequest: Found JSON-RPC response for ID ${requestPayload.id} (method '${requestPayload.method}') in final accumulated SSE data:`, serverResponse);
          }
        } catch (e) {
          console.warn(`MCP sendMcpRequest: Could not parse final accumulated SSE data for ID ${requestPayload.id} as JSON. Data: "${accumulatedData}". Error:`, e);
        }
      }
    }

    // If not found via SSE parsing, or if it didn't look like SSE, try parsing as plain JSON
    if (!foundResponse) {
      console.debug(`MCP sendMcpRequest: SSE parsing did not yield response for ID ${requestPayload.id} (method '${requestPayload.method}'). Attempting plain JSON parse.`);
      try {
        const parsedJson = JSON.parse(responseText);
        if (parsedJson.id === requestPayload.id && (parsedJson.result !== undefined || parsedJson.error !== undefined)) {
          serverResponse = parsedJson;
          foundResponse = true;
          console.log(`MCP sendMcpRequest: Successfully parsed non-SSE JSON response for ID ${requestPayload.id} (method '${requestPayload.method}'):`, serverResponse);
        } else {
           console.warn(`MCP sendMcpRequest: Parsed plain JSON, but ID mismatch or missing result/error. Expected ID ${requestPayload.id}, got:`, parsedJson.id);
        }
      } catch (e) {
        console.warn(`MCP sendMcpRequest: Failed to parse response as plain JSON for ID ${requestPayload.id} (method '${requestPayload.method}'). Error:`, e);
      }
    }

    if (!foundResponse || !serverResponse) {
      console.error(`MCP sendMcpRequest: Critical - JSON-RPC response for request ID ${requestPayload.id} (method '${requestPayload.method}') not found in response from ${mcpServerUrl}. Full response text was logged previously.`);
      throw new Error(`MCP Request '${requestPayload.method}' to ${mcpServerUrl} (ID: ${requestPayload.id}) failed: Pertinent JSON-RPC response not found in server's output.`);
    }

    if (serverResponse.error) {
      console.error(`MCP sendMcpRequest: Server returned an error for request ID ${requestPayload.id} (method '${requestPayload.method}'):`, serverResponse.error);
      const mcpError = new Error(`MCP Request '${requestPayload.method}' to ${mcpServerUrl} failed: Server error ${serverResponse.error.code} - ${serverResponse.error.message}`);
      mcpError.details = serverResponse.error; // Attach full error object
      throw mcpError;
    }

    // ID check already implicitly done by finding the response in the stream by requestPayload.id
    // if (serverResponse.id !== requestPayload.id) {
    //     console.warn(`MCP Request ID mismatch: Expected ${requestPayload.id}, received ${serverResponse.id}`);
    // }

    console.log(`MCP Response for id ${requestPayload.id} (from SSE):`, serverResponse);
    return serverResponse; // This will be the full JSON-RPC response {jsonrpc, id, result}

  } catch (error) {
    console.error(`Error sending MCP request '${requestPayload.method}' to ${mcpServerUrl}:`, error);
    throw new Error(`MCP request '${requestPayload.method}' to ${mcpServerUrl} encountered an error: ${error.message}`);
  }
}

// Cleanup function for extension shutdown
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

// Add periodic health check for sessions
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

// Run health check every 2 minutes
setInterval(performSessionHealthCheck, 120000);

export {
  initializeMcpSession,
  getMcpSession,
  sendMcpRequest,
  sendMcpNotification,
  createMcpToolCallPayload,
  cleanupMcpSessions,
  performSessionHealthCheck,
  mcpSessions
};