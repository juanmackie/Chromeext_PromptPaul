// MCP Server Logic
// This file will implement the server-side logic for the Model Context Protocol.

const fs = require('fs');
const http = require('http');

const TOOL_MANIFEST_PATH = './tool_manifest.json';
let toolManifest = null;

function loadToolManifest() {
  try {
    const manifestData = fs.readFileSync(TOOL_MANIFEST_PATH, 'utf8');
    toolManifest = JSON.parse(manifestData);
    console.log("Tool manifest loaded successfully.");
    // console.log("Tools found:", toolManifest.tools.map(t => t.name).join(', '));
  } catch (error) {
    console.error("Error loading tool manifest:", error);
    // In a real scenario, the server might not start or might operate in a degraded mode.
  }
}

// Initial load
loadToolManifest();

// Watch for changes in the manifest file (optional, good for development)
fs.watchFile(TOOL_MANIFEST_PATH, (curr, prev) => {
  if (curr.mtime !== prev.mtime) {
    console.log("Tool manifest file changed, reloading...");
    loadToolManifest();
  }
});

const PORT = 3000; // Port for the MCP server

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/mcp') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const jsonRpcRequest = JSON.parse(body);
        console.log("Received JSON-RPC request:", JSON.stringify(jsonRpcRequest, null, 2));
        handleJsonRpcRequest(jsonRpcRequest, res);
      } catch (error) {
        console.error("Error parsing JSON request:", error);
        sendJsonRpcError(res, null, -32700, "Parse error");
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  } else if (req.method === 'GET' && req.url === '/mcp/manifest') {
    if (toolManifest) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(toolManifest, null, 2));
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Tool manifest not loaded or available on the server.' }));
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

function handleJsonRpcRequest(request, res) {
  // Basic validation of JSON-RPC structure
  if (!request.jsonrpc || request.jsonrpc !== '2.0' || !request.method || typeof request.id === 'undefined') {
    sendJsonRpcError(res, request.id !== undefined ? request.id : null, -32600, "Invalid Request");
    return;
  }

  const { method, params, id } = request;

  const { method, params, id } = request;

  // Log all incoming methods for easier debugging
  console.log(`Received method: ${method}, ID: ${id}, Params:`, JSON.stringify(params, null, 2));

  if (method === 'tool/execute') {
    executeTool(request, res);
  } else if (method === 'tool/parametersFilled') {
    handleParametersFilled(request, res);
  } else if (method === 'tool/consentResponse') {
    handleConsentResponse(request, res);
  }
  else {
    // For notifications, ID might be null. If so, we can't easily correlate an error response.
    // Standard JSON-RPC says errors for notifications should not be sent.
    // If 'id' is present, it's a request we don't understand.
    if (id !== null && id !== undefined) {
      sendJsonRpcError(res, id, -32601, "Method not found");
    } else {
      console.warn(`Received notification for unknown method: ${method}. No response sent.`);
    }
  }
}

// --- State Management for Elicitation Flows ---
// activeToolRequests: Stores the state of an ongoing tool/execute request.
//   Key: original tool/execute request ID.
//   Value: {
//     res (client HTTP response object for the original tool/execute),
//     toolName,
//     currentParams (accumulated parameters),
//     toolDefinition,
//     nextStep ('validateParams', 'awaitingParams', 'requestConsent', 'awaitingConsent', 'execute')
//   }
const activeToolRequests = new Map();

// elicitationMap: Maps a temporary elicitation ID (for missingParams or consent) back to the original tool/execute request ID.
//   Key: elicitation_specific_request_id (e.g., from tool/missingParameters or tool/requestConsent).
//   Value: original tool/execute request ID.
const elicitationMap = new Map();


function getOriginalRequestIdFromElicitation(elicitationReqId) {
    return elicitationMap.get(elicitationReqId);
}

// --- Main Handler for tool/execute ---
function executeTool(request, res) {
  const { params: toolCallParams, id: originalRequestId } = request;

  if (originalRequestId === null || originalRequestId === undefined) {
    console.error("tool/execute received without an ID. Cannot process.");
    // According to JSON-RPC, if id is missing, it's a notification, and tool/execute should be a request.
    // We won't send an error response here as there's no ID to correlate.
    return;
  }

  const toolName = toolCallParams.tool_name;
  const providedParameters = toolCallParams.parameters || {};

  console.log(`[${originalRequestId}] Processing tool/execute for '${toolName}' with params:`, providedParameters);

  if (!toolManifest || !toolManifest.tools) {
    sendJsonRpcError(res, originalRequestId, -32000, "Server error: Tool manifest not loaded.");
    return;
  }

  const toolDefinition = toolManifest.tools.find(t => t.name === toolName);

  if (!toolDefinition) {
    sendJsonRpcError(res, originalRequestId, -32602, "Invalid params: Tool not found", { tool_name: toolName });
    return;
  }

  // Store the initial state of the request
  activeToolRequests.set(originalRequestId, {
    res,
    toolName,
    currentParams: { ...providedParameters },
    toolDefinition,
    nextStep: 'validateParams'
  });

  processRequestStateMachine(originalRequestId);
}

// --- State Machine for Processing a Tool Request ---
function processRequestStateMachine(originalRequestId) {
  const requestState = activeToolRequests.get(originalRequestId);
  if (!requestState) {
    console.error(`[${originalRequestId}] No active tool request found for processing state machine.`);
    return;
  }

  const { res, toolName, currentParams, toolDefinition, nextStep } = requestState;
  console.log(`[${originalRequestId}] State machine step: ${nextStep} for tool '${toolName}'`);

  switch (nextStep) {
    case 'validateParams':
      const missingParams = [];
      for (const paramDef of toolDefinition.parameters) {
        if (paramDef.required && !(paramDef.name in currentParams)) {
          missingParams.push({
            name: paramDef.name,
            type: paramDef.type,
            description: paramDef.description
          });
        }
      }

      if (missingParams.length > 0) {
        console.log(`[${originalRequestId}] Tool '${toolName}' missing params:`, missingParams.map(p=>p.name).join(', '));
        const missingParamsElicitationId = `elicitation-params-${originalRequestId}-${Date.now()}`;
        elicitationMap.set(missingParamsElicitationId, originalRequestId);

        requestState.nextStep = 'awaitingParams';
        activeToolRequests.set(originalRequestId, requestState); // Persist state change

        // This response goes back to the client who made the tool/execute call.
        // It's a JSON-RPC *response* to tool/execute, but its *result* is a JSON-RPC *request* for the client to act upon.
        sendJsonRpcResponse(res, originalRequestId, {
            jsonrpc: "2.0", // This indicates the *payload* is a JSON-RPC message
            method: "tool/missingParameters",
            params: {
                tool_name: toolName,
                missing_parameters: missingParams,
                request_id: missingParamsElicitationId // Client must echo this in tool/parametersFilled
            }
        });
        console.log(`[${originalRequestId}] Sent tool/missingParameters (elicitation ID: ${missingParamsElicitationId}). Waiting for tool/parametersFilled.`);
      } else {
        console.log(`[${originalRequestId}] All required parameters present for '${toolName}'. Proceeding to consent.`);
        requestState.nextStep = 'requestConsent';
        activeToolRequests.set(originalRequestId, requestState);
        processRequestStateMachine(originalRequestId); // Immediately move to next step
      }
      break;

    case 'requestConsent':
      const consentElicitationId = `elicitation-consent-${originalRequestId}-${Date.now()}`;
      elicitationMap.set(consentElicitationId, originalRequestId);

      requestState.nextStep = 'awaitingConsent';
      activeToolRequests.set(originalRequestId, requestState);

      console.log(`[${originalRequestId}] Requesting consent for tool '${toolName}'. Hint: '${toolDefinition.permissions_hint}'`);
      sendJsonRpcResponse(res, originalRequestId, {
        jsonrpc: "2.0",
        method: "tool/requestConsent",
        params: {
            tool_name: toolName,
            permissions_hint: toolDefinition.permissions_hint,
            request_id: consentElicitationId // Client must echo this in tool/consentResponse
        }
      });
      console.log(`[${originalRequestId}] Sent tool/requestConsent (elicitation ID: ${consentElicitationId}). Waiting for tool/consentResponse.`);
      break;

    case 'execute':
      console.log(`[${originalRequestId}] All checks passed for '${toolName}'. Executing tool.`);
      const executionResult = performToolExecution(originalRequestId, toolDefinition, currentParams);

      // This is the final success/error response to the original tool/execute request
      sendJsonRpcResponse(res, originalRequestId, {
          tool_name: toolName,
          status: executionResult.success ? "success" : "error",
          output: executionResult.output,
          request_id: originalRequestId
      });
      console.log(`[${originalRequestId}] Sent final tool/execute response. Success: ${executionResult.success}`);
      cleanupRequestState(originalRequestId);
      break;

    case 'awaitingParams':
    case 'awaitingConsent':
      console.log(`[${originalRequestId}] Currently ${nextStep}. Waiting for client callback.`);
      // No action from server, it's waiting for tool/parametersFilled or tool/consentResponse
      break;

    default:
      console.error(`[${originalRequestId}] Unknown state machine step: ${nextStep}`);
      sendJsonRpcError(res, originalRequestId, -32001, "Server error: Unknown processing step.");
      cleanupRequestState(originalRequestId);
      break;
  }
}

// --- Handlers for Client Callbacks (Elicitation Responses) ---
function handleParametersFilled(request, res) { // res here is for the parametersFilled request itself
  const { params, id: notificationId } = request;
  const elicitationId = params.request_id;
  const originalRequestId = getOriginalRequestIdFromElicitation(elicitationId);

  if (!originalRequestId) {
    console.error(`Received tool/parametersFilled with unknown elicitation_id: ${elicitationId}`);
    if (notificationId) sendJsonRpcError(res, notificationId, -32602, "Invalid params: Unknown elicitation request_id for parametersFilled.");
    return;
  }

  const requestState = activeToolRequests.get(originalRequestId);
  if (!requestState || requestState.nextStep !== 'awaitingParams') {
    console.error(`[${originalRequestId}] Received tool/parametersFilled in unexpected state: ${requestState ? requestState.nextStep : 'N/A'}. Expected 'awaitingParams'.`);
    if (notificationId) sendJsonRpcError(res, notificationId, -32002, "Server error: Received parametersFilled in unexpected state.");
    return;
  }

  console.log(`[${originalRequestId}] Received tool/parametersFilled (elicitation ID: ${elicitationId}). Params:`, params.filled_parameters);
  Object.assign(requestState.currentParams, params.filled_parameters); // Merge filled parameters

  elicitationMap.delete(elicitationId); // Clean up this specific elicitation ID

  requestState.nextStep = 'requestConsent'; // Transition to the next state
  activeToolRequests.set(originalRequestId, requestState);
  processRequestStateMachine(originalRequestId); // Trigger state machine

  // Acknowledge the parametersFilled request (client might expect this for a request, not for a notification)
  if (notificationId) {
    sendJsonRpcResponse(res, notificationId, { status: "received", message: "Parameters received by server." });
  }
}

function handleConsentResponse(request, res) { // res here is for the consentResponse request itself
  const { params, id: notificationId } = request;
  const elicitationId = params.request_id;
  const originalRequestId = getOriginalRequestIdFromElicitation(elicitationId);

  if (!originalRequestId) {
    console.error(`Received tool/consentResponse with unknown elicitation_id: ${elicitationId}`);
    if (notificationId) sendJsonRpcError(res, notificationId, -32602, "Invalid params: Unknown elicitation request_id for consentResponse.");
    return;
  }

  const requestState = activeToolRequests.get(originalRequestId);
  if (!requestState || requestState.nextStep !== 'awaitingConsent') {
    console.error(`[${originalRequestId}] Received tool/consentResponse in unexpected state: ${requestState ? requestState.nextStep : 'N/A'}. Expected 'awaitingConsent'.`);
    if (notificationId) sendJsonRpcError(res, notificationId, -32003, "Server error: Received consentResponse in unexpected state.");
    return;
  }

  console.log(`[${originalRequestId}] Received tool/consentResponse (elicitation ID: ${elicitationId}). Decision:`, params.decision);
  elicitationMap.delete(elicitationId); // Clean up this specific elicitation ID

  if (params.decision === 'allow') {
    requestState.nextStep = 'execute';
    activeToolRequests.set(originalRequestId, requestState);
    processRequestStateMachine(originalRequestId);
  } else {
    console.log(`[${originalRequestId}] User denied consent for tool '${requestState.toolName}'.`);
    // Send final error response to the *original* tool/execute request
    sendJsonRpcError(requestState.res, originalRequestId, -32004, "User denied consent for tool execution.", { tool_name: requestState.toolName });
    cleanupRequestState(originalRequestId);
  }

  if (notificationId) {
    sendJsonRpcResponse(res, notificationId, { status: "received", message: `Consent decision '${params.decision}' processed by server.` });
  }
}

// --- Tool Execution Logic ---
function performToolExecution(originalRequestId, toolDefinition, filledParameters) {
  let command = toolDefinition.command;

  // Replace parameters in command string
  for (const paramDef of toolDefinition.parameters) {
    const paramName = paramDef.name;
    const value = filledParameters[paramName];
    const placeholderRegex = new RegExp(`{${paramName}(?:[:-]([^}]+))?}`, 'g'); // Matches {param}, {param:default}, {param:-default}

    if (value !== undefined) {
      command = command.replace(placeholderRegex, String(value));
    } else {
      // Parameter not provided by user. Check for default in command string.
      const match = placeholderRegex.exec(toolDefinition.command); // Must re-exec on original command string
      if (match && match[1]) { // match[1] is the default value part
        command = command.replace(placeholderRegex, match[1]);
      } else {
        // No value, no default in command string, remove the placeholder
        command = command.replace(placeholderRegex, '');
      }
    }
  }
  command = command.replace(/\s+/g, ' ').trim(); // Clean up extra spaces

  console.log(`[${originalRequestId}] Executing command: ${command}`);
  // Mock execution
  // In a real server: const { exec } = require('child_process'); exec(command, callback);
  try {
    // Simulate execution
    if (command.startsWith("echo")) {
        const output = command.substring(5).replace(/'/g, ''); // Basic echo simulation
        return { success: true, output: output };
    }
    return { success: true, output: `Mock execution successful for: ${command}` };
  } catch (error) {
    console.error(`[${originalRequestId}] Error during mock execution of command "${command}":`, error);
    return { success: false, output: `Error executing command: ${error.message}` };
  }
}

// --- Utility and Cleanup ---
function cleanupRequestState(originalRequestId) {
  activeToolRequests.delete(originalRequestId);
  // Clean up any elicitation IDs associated with this originalRequestId
  for (const [elicitationId, reqId] of elicitationMap.entries()) {
      if (reqId === originalRequestId) {
          elicitationMap.delete(elicitationId);
      }
  }
  console.log(`[${originalRequestId}] Cleaned up state.`);
}

// --- JSON-RPC Response Sending Functions ---
function sendJsonRpcResponse(res, id, result) {
  // If the result itself is a JSON-RPC message (like for elicitation), keep it as an object.
  // Otherwise, structure it as a standard result.
  const responsePayload = { jsonrpc: "2.0", id };
  if (result && result.jsonrpc === "2.0" && result.method) { // It's an embedded JSON-RPC request for client
      responsePayload.result = result; // The 'result' field contains the full JSON-RPC message object
  } else {
      responsePayload.result = result; // Standard result
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(responsePayload));
}

function sendJsonRpcError(res, id, code, message, data = null) {
  res.writeHead(200, { 'Content-Type': 'application/json' }); // JSON-RPC errors use HTTP 200
  const errorResponse = {
    jsonrpc: "2.0",
    id,
    error: { code, message }
  };
  if (data) {
    errorResponse.error.data = data;
  }
  res.end(JSON.stringify(errorResponse));
}

server.listen(PORT, () => {
  console.log(`MCP Server listening on http://localhost:${PORT}/mcp`);
});

console.log("MCP Server starting logic completed. Now listening for requests.");

// TODO: Implement the rest of the server logic as per the plan.
