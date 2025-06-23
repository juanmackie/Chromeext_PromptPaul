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
  } catch (error) {
    console.error("Error loading tool manifest:", error);
  }
}

loadToolManifest();

fs.watchFile(TOOL_MANIFEST_PATH, (curr, prev) => {
  if (curr.mtime !== prev.mtime) {
    console.log("Tool manifest file changed, reloading...");
    loadToolManifest();
  }
});

const PORT = 3000;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id'); // Add mcp-session-id

  if (req.method === 'OPTIONS') {
    res.writeHead(204); // No Content
    res.end();
    return;
  }

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
  } else if (req.method === 'GET' && req.url === '/mcp/manifest') {
    if (toolManifest) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(toolManifest, null, 2));
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Tool manifest not loaded or available on the server.' }));
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

function handleJsonRpcRequest(request, res) {
  if (!request.jsonrpc || request.jsonrpc !== '2.0' || !request.method ) { // ID can be missing for notifications
    sendJsonRpcError(res, request.id !== undefined ? request.id : null, -32600, "Invalid Request");
    return;
  }

  const { method, params, id } = request; // id might be undefined for notifications

  console.log(`[MCP Server] Received method: ${method}, ID: ${id}, Params:`, JSON.stringify(params, null, 2));

  // Standard methods from SDK/Client
  if (method === 'initialize') {
    // Respond to initialize (basic example, SDK handles more complex capabilities)
    sendJsonRpcResponse(res, id, {
        protocolVersion: "0.1.0", // Match client if possible
        capabilities: {
            // Declare server capabilities, e.g., if it supports elicitation
            elicitation: {},
            // any other server capabilities
        },
        serverInfo: {
            name: "PromptPaulMCPTestServer",
            version: "0.1.0"
        }
    });
  } else if (method === 'tools/list') {
    const tools = toolManifest && toolManifest.tools ? toolManifest.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.parameters ? { type: "object", properties: t.parameters.reduce((obj, param) => {
            obj[param.name] = { type: param.type, description: param.description };
            if (param.enum) obj[param.name].enum = param.enum;
            return obj;
        }, {}), required: t.parameters.filter(p => p.required).map(p => p.name) } : {}
    })) : [];
    sendJsonRpcResponse(res, id, { tools });
  } else if (method === 'tools/call') {
    // Pass the original request ID (which is the LLM tool call ID if client passes it)
    executeTool(request, res, id);
  } else if (method === 'tool/parametersFilled') {
    handleParametersFilled(request, res);
  } else if (method === 'tool/consentResponse') {
    handleConsentResponse(request, res);
  } else if (method === 'initialized') { // This is a notification from client
    console.log(`[MCP Server] Client sent 'initialized' notification. Params:`, params);
    // No response needed for notifications generally.
  }
  else {
    if (id !== null && id !== undefined) {
      sendJsonRpcError(res, id, -32601, "Method not found", { requestedMethod: method });
    } else {
      console.warn(`[MCP Server] Received notification for unknown method: ${method}. No response sent.`);
    }
  }
}


const activeToolRequests = new Map();
const elicitationMap = new Map();


function getOriginalLlmToolCallIdFromElicitation(elicitationReqId) {
    return elicitationMap.get(elicitationReqId);
}

// Main Handler for tools/call (and legacy tool/execute)
// originalLlmToolCallId is the id from the tools/call request, used for context.
function executeTool(request, res, originalLlmToolCallId) {
  const { params: toolCallParams } = request;

  // For "tools/call": params are { name: "toolName", arguments: { ... } }
  // For legacy "tool/execute": params are { tool_name: "toolName", parameters: { ... } }
  const toolName = toolCallParams.name || toolCallParams.tool_name;
  const providedParameters = toolCallParams.arguments || toolCallParams.parameters || {};

  if (originalLlmToolCallId === null || originalLlmToolCallId === undefined) {
    console.error(`[MCP Server] ${request.method} received without an ID. Cannot process.`);
    return;
  }

  console.log(`[MCP Server] [${originalLlmToolCallId}] Processing ${request.method} for '${toolName}' with params:`, providedParameters);

  if (!toolManifest || !toolManifest.tools) {
    sendJsonRpcError(res, originalLlmToolCallId, -32000, "Server error: Tool manifest not loaded.");
    return;
  }

  const toolDefinition = toolManifest.tools.find(t => t.name === toolName);

  if (!toolDefinition) {
    sendJsonRpcError(res, originalLlmToolCallId, -32602, "Invalid params: Tool not found", { tool_name: toolName });
    return;
  }

  activeToolRequests.set(originalLlmToolCallId, {
    res, // HTTP response object for the original tools/call
    toolName,
    currentParams: { ...providedParameters },
    toolDefinition,
    nextStep: 'validateParams',
    originalLlmToolCallId: originalLlmToolCallId // Store it for elicitation notifications
  });

  processRequestStateMachine(originalLlmToolCallId);
}

function processRequestStateMachine(originalLlmToolCallId) {
  const requestState = activeToolRequests.get(originalLlmToolCallId);
  if (!requestState) {
    console.error(`[MCP Server] [${originalLlmToolCallId}] No active tool request found for state machine.`);
    return;
  }

  const { res, toolName, currentParams, toolDefinition, nextStep } = requestState;
  console.log(`[MCP Server] [${originalLlmToolCallId}] State machine step: ${nextStep} for tool '${toolName}'`);

  switch (nextStep) {
    case 'validateParams':
      const missingParams = [];
      // Ensure toolDefinition.parameters is an array before iterating
      if (Array.isArray(toolDefinition.parameters)) {
        for (const paramDef of toolDefinition.parameters) {
          if (paramDef.required && !(paramDef.name in currentParams)) {
            missingParams.push({
              name: paramDef.name,
              type: paramDef.type, // Ensure type is defined in manifest or handle if not
              description: paramDef.description
            });
          }
        }
      } else {
        console.warn(`[MCP Server] [${originalLlmToolCallId}] Tool '${toolName}' has no parameters defined in manifest or format is incorrect.`);
      }


      if (missingParams.length > 0) {
        console.log(`[MCP Server] [${originalLlmToolCallId}] Tool '${toolName}' missing params:`, missingParams.map(p=>p.name).join(', '));
        const serverElicitationId = `elicitation-params-${originalLlmToolCallId}-${Date.now()}`;
        // Map the server's elicitation ID back to the original LLM tool call ID
        elicitationMap.set(serverElicitationId, originalLlmToolCallId);

        requestState.nextStep = 'awaitingParams';
        activeToolRequests.set(originalLlmToolCallId, requestState);

        // This is a JSON-RPC *Notification* from server to client
        // The client's SDK will handle this and invoke registered notification handlers.
        // The original tools/call request (identified by originalLlmToolCallId) is still pending a final response.
        // The client does not send a JSON-RPC response *to this notification*.
        // Instead, it will later send a `tool/parametersFilled` request.
        const notificationPayload = {
            jsonrpc: "2.0",
            method: "tool/missingParameters", // This is the notification method
            params: {
                tool_name: toolName,
                missing_parameters: missingParams,
                request_id: serverElicitationId, // Server's ID for this specific elicitation step
                original_llm_tool_call_id: originalLlmToolCallId // Crucial for client to correlate
            }
        };
        // Send this as a server-initiated message if transport supports it (e.g. SSE).
        // For HTTP request/response, this is tricky. MCP typically sends this as part of the *response*
        // to the tools/call, where the `result` field contains this JSON-RPC notification object.
        sendJsonRpcResponse(res, originalLlmToolCallId, notificationPayload); // Embedding notification in response
        console.log(`[MCP Server] [${originalLlmToolCallId}] Sent tool/missingParameters (ServerElicitationID: ${serverElicitationId}). Waiting for tool/parametersFilled.`);
      } else {
        console.log(`[MCP Server] [${originalLlmToolCallId}] All required params for '${toolName}'. Proceeding to consent.`);
        requestState.nextStep = 'requestConsent';
        activeToolRequests.set(originalLlmToolCallId, requestState);
        processRequestStateMachine(originalLlmToolCallId);
      }
      break;

    case 'requestConsent':
      const serverConsentElicitationId = `elicitation-consent-${originalLlmToolCallId}-${Date.now()}`;
      elicitationMap.set(serverConsentElicitationId, originalLlmToolCallId);

      requestState.nextStep = 'awaitingConsent';
      activeToolRequests.set(originalLlmToolCallId, requestState);

      console.log(`[MCP Server] [${originalLlmToolCallId}] Requesting consent for '${toolName}'. Hint: '${toolDefinition.permissions_hint}'`);
      const consentNotificationPayload = {
        jsonrpc: "2.0",
        method: "tool/requestConsent",
        params: {
            tool_name: toolName,
            permissions_hint: toolDefinition.permissions_hint,
            request_id: serverConsentElicitationId,
            original_llm_tool_call_id: originalLlmToolCallId
        }
      };
      sendJsonRpcResponse(res, originalLlmToolCallId, consentNotificationPayload); // Embed in response
      console.log(`[MCP Server] [${originalLlmToolCallId}] Sent tool/requestConsent (ServerElicitationID: ${serverConsentElicitationId}). Waiting for tool/consentResponse.`);
      break;

    case 'execute':
      console.log(`[MCP Server] [${originalLlmToolCallId}] All checks passed for '${toolName}'. Executing.`);
      const executionResult = performToolExecution(originalLlmToolCallId, toolDefinition, currentParams);

      // Final success/error response to the original tools/call request
      const finalResponsePayload = {
          //MCP spec for tools/call result: { content: [...], toolMetadata?: ...}
          content: [{ type: "text", text: String(executionResult.output) }], // Example mapping
          // toolMetadata: { toolName, status: executionResult.success ? "success" : "error" }
      };
      if (!executionResult.success) {
        sendJsonRpcError(res, originalLlmToolCallId, -32000, "Tool execution failed", executionResult.output);
      } else {
        sendJsonRpcResponse(res, originalLlmToolCallId, finalResponsePayload);
      }
      console.log(`[MCP Server] [${originalLlmToolCallId}] Sent final tools/call response. Success: ${executionResult.success}`);
      cleanupRequestState(originalLlmToolCallId);
      break;

    case 'awaitingParams':
    case 'awaitingConsent':
      console.log(`[MCP Server] [${originalLlmToolCallId}] Currently ${nextStep}. Server is effectively paused for this request, waiting for client's parametersFilled or consentResponse.`);
      // The HTTP response for originalLlmToolCallId has already been sent with the elicitation request.
      // The server now waits for a *new* HTTP request from the client for tool/parametersFilled or tool/consentResponse.
      break;

    default:
      console.error(`[MCP Server] [${originalLlmToolCallId}] Unknown state machine step: ${nextStep}`);
      sendJsonRpcError(res, originalLlmToolCallId, -32001, "Server error: Unknown processing step.");
      cleanupRequestState(originalLlmToolCallId);
      break;
  }
}

// Handlers for Client Callbacks (Elicitation Responses from Client)
// These are new requests from the client.
function handleParametersFilled(request, res) {
  const { params, id: clientRequestId } = request; // id here is for the tool/parametersFilled request itself
  const serverElicitationId = params.request_id; // The ID server sent in tool/missingParameters
  const originalLlmToolCallId = getOriginalLlmToolCallIdFromElicitation(serverElicitationId);

  if (!originalLlmToolCallId) {
    console.error(`[MCP Server] Received tool/parametersFilled with unknown ServerElicitationID: ${serverElicitationId}`);
    if (clientRequestId) sendJsonRpcError(res, clientRequestId, -32602, "Invalid params: Unknown server elicitation request_id for parametersFilled.");
    return;
  }

  const requestState = activeToolRequests.get(originalLlmToolCallId);
  if (!requestState || requestState.nextStep !== 'awaitingParams') {
    console.error(`[MCP Server] [${originalLlmToolCallId}] Received tool/parametersFilled in unexpected state: ${requestState ? requestState.nextStep : 'N/A'}. Expected 'awaitingParams'.`);
    if (clientRequestId) sendJsonRpcError(res, clientRequestId, -32002, "Server error: Received parametersFilled in unexpected state.");
    return;
  }

  console.log(`[MCP Server] [${originalLlmToolCallId}] Received tool/parametersFilled (ServerElicitationID: ${serverElicitationId}). Params:`, params.filled_parameters);
  Object.assign(requestState.currentParams, params.filled_parameters);

  elicitationMap.delete(serverElicitationId);

  requestState.nextStep = 'requestConsent';
  requestState.res = res; // IMPORTANT: Update res to respond to *this* parametersFilled request.
  activeToolRequests.set(originalLlmToolCallId, requestState);
  processRequestStateMachine(originalLlmToolCallId); // Trigger next step (consent or execute)

  // Acknowledge the parametersFilled request itself.
  // The actual tool result or next elicitation will be sent via processRequestStateMachine using the *new* `res`.
  // No, processRequestStateMachine will use the *new* res to send the *next* elicitation or final result.
  // So, no separate ack needed here usually. The response to parametersFilled *is* the next step.
  // However, if client expects an immediate ack for parametersFilled before next step, send it.
  // For now, assume next step is the response.
  // if (clientRequestId) {
  //   sendJsonRpcResponse(res, clientRequestId, { status: "received", message: "Parameters received by server." });
  // }
}

function handleConsentResponse(request, res) {
  const { params, id: clientRequestId } = request;
  const serverElicitationId = params.request_id;
  const originalLlmToolCallId = getOriginalLlmToolCallIdFromElicitation(serverElicitationId);

  if (!originalLlmToolCallId) {
    console.error(`[MCP Server] Received tool/consentResponse with unknown ServerElicitationID: ${serverElicitationId}`);
    if (clientRequestId) sendJsonRpcError(res, clientRequestId, -32602, "Invalid params: Unknown server elicitation request_id for consentResponse.");
    return;
  }

  const requestState = activeToolRequests.get(originalLlmToolCallId);
  if (!requestState || requestState.nextStep !== 'awaitingConsent') {
    console.error(`[MCP Server] [${originalLlmToolCallId}] Received tool/consentResponse in unexpected state: ${requestState ? requestState.nextStep : 'N/A'}. Expected 'awaitingConsent'.`);
    if (clientRequestId) sendJsonRpcError(res, clientRequestId, -32003, "Server error: Received consentResponse in unexpected state.");
    return;
  }

  console.log(`[MCP Server] [${originalLlmToolCallId}] Received tool/consentResponse (ServerElicitationID: ${serverElicitationId}). Decision:`, params.decision);
  elicitationMap.delete(serverElicitationId);
  requestState.res = res; // Update res to respond to *this* consentResponse request.

  if (params.decision === 'allow') {
    requestState.nextStep = 'execute';
    activeToolRequests.set(originalLlmToolCallId, requestState);
    processRequestStateMachine(originalLlmToolCallId);
  } else {
    console.log(`[MCP Server] [${originalLlmToolCallId}] User denied consent for tool '${requestState.toolName}'.`);
    // Send final error response to the *original* tools/call request, via *this current* HTTP response.
    sendJsonRpcError(res, originalLlmToolCallId, -32004, "User denied consent for tool execution.", { tool_name: requestState.toolName });
    cleanupRequestState(originalLlmToolCallId);
  }

  // Similar to parametersFilled, the response to consentResponse *is* the next step (execute or error).
  // if (clientRequestId) {
  //    sendJsonRpcResponse(res, clientRequestId, { status: "received", message: `Consent decision '${params.decision}' processed by server.` });
  // }
}

function performToolExecution(originalLlmToolCallId, toolDefinition, filledParameters) {
  let command = toolDefinition.command;
  if (Array.isArray(toolDefinition.parameters)) {
    for (const paramDef of toolDefinition.parameters) {
      const paramName = paramDef.name;
      const value = filledParameters[paramName];
      const placeholderRegex = new RegExp(`{${paramName}(?:[:-]([^}]+))?}`, 'g');

      if (value !== undefined) {
        command = command.replace(placeholderRegex, String(value));
      } else {
        const match = placeholderRegex.exec(toolDefinition.command);
        if (match && match[1]) {
          command = command.replace(placeholderRegex, match[1]);
        } else {
          command = command.replace(placeholderRegex, '');
        }
      }
    }
  }
  command = command.replace(/\s+/g, ' ').trim();

  console.log(`[MCP Server] [${originalLlmToolCallId}] Executing command: ${command}`);
  try {
    if (command.startsWith("echo")) {
        const output = command.substring(5).replace(/'/g, '');
        return { success: true, output: output };
    }
    // Simulate a more complex tool
    if (toolDefinition.name === "get_weather") {
        const location = filledParameters.location || "default city";
        return { success: true, output: `Weather in ${location}: Sunny, 25°C` };
    }
    return { success: true, output: `Mock execution successful for: ${command}` };
  } catch (error) {
    console.error(`[MCP Server] [${originalLlmToolCallId}] Error during mock execution of command "${command}":`, error);
    return { success: false, output: `Error executing command: ${error.message}` };
  }
}

function cleanupRequestState(originalLlmToolCallId) {
  activeToolRequests.delete(originalLlmToolCallId);
  for (const [elicitationId, reqId] of elicitationMap.entries()) {
      if (reqId === originalLlmToolCallId) {
          elicitationMap.delete(elicitationId);
      }
  }
  console.log(`[MCP Server] [${originalLlmToolCallId}] Cleaned up state.`);
}

function sendJsonRpcResponse(res, id, resultOrNotificationPayload) {
  const responsePayload = { jsonrpc: "2.0", id };
  // If the resultOrNotificationPayload itself is a JSON-RPC message (like for elicitation notification),
  // then this is the 'result' part of the *current* HTTP response.
  if (resultOrNotificationPayload && resultOrNotificationPayload.jsonrpc === "2.0" && resultOrNotificationPayload.method) {
      responsePayload.result = resultOrNotificationPayload;
  } else {
      responsePayload.result = resultOrNotificationPayload; // Standard result
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(responsePayload));
}

function sendJsonRpcError(res, id, code, message, data = null) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  const errorResponse = {
    jsonrpc: "2.0",
    id, // Can be null for some errors like parse error before ID is known
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
