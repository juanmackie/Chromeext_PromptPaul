// ===== Tool Executor Module - Tool execution logic =====
import { trackInstructionUsed, trackErrorEvent } from './analytics.js';
import { getMcpSession, createMcpToolCallPayload, sendMcpRequest } from './mcp-client.js';

// Track active tool executions to prevent duplicates
const activeToolExecutions = new Set();

// Function to get a single tool definition by name from storage
async function getToolDefinition(name) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['promptPaulTools'], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        const toolsArray = result.promptPaulTools || [];
        const tool = toolsArray.find(t => t.name === name);
        resolve(tool);
      }
    });
  });
}

// Generic function to call a user-defined endpoint
async function callUserDefinedEndpoint(endpointUrl, args, userDefinedMethod, originalToolName = null, mcpProxyUrlBase = null) { // Added userDefinedMethod parameter
  console.log(`Background: Calling user-defined endpoint: ${endpointUrl} with args:`, args);
  try {
    let finalEndpointUrl = endpointUrl;
    let finalFetchOptions = { // Initialize with common headers
      headers: {
        'Accept': 'application/json' // Always accept JSON response
      }
    };
    let finalArgs = args;

    if (mcpProxyUrlBase && isValidURL(mcpProxyUrlBase)) {
      try {
        finalEndpointUrl = new URL(endpointUrl, mcpProxyUrlBase).href;
        console.log(`Background: MCP Tool detected. Constructed proxy URL: ${finalEndpointUrl}`);
        // For MCP proxy, always POST a JSON payload with tool name and args
        finalFetchOptions.method = 'POST'; // Override method to POST for MCP proxy
        finalFetchOptions.headers['Content-Type'] = 'application/json';
        finalArgs = { tool_name: originalToolName, arguments: args }; // Structure payload for MCP proxy
        finalFetchOptions.body = JSON.stringify(finalArgs);
        console.log(`Background: MCP Tool - Method forced to POST. Payload:`, finalArgs);
      } catch (e) {
        console.error(`Background: Error constructing MCP proxy URL from base '${mcpProxyUrlBase}' and path '${endpointUrl}':`, e);
        throw new Error(`Invalid MCP Proxy URL configuration: ${e.message}`);
      }
    } else {
      // Existing logic for non-MCP tools (handling GET/POST based on args and userDefinedMethod)
      const isEmptyArgs = !args || Object.keys(args).length === 0;
      let method = userDefinedMethod || (isEmptyArgs ? 'GET' : 'POST');
      method = method.toUpperCase();
      finalFetchOptions.method = method;
      console.log(`Background: Using method ${method} (User defined: ${userDefinedMethod || 'Auto'}) for endpoint ${finalEndpointUrl}`);

      if (method === 'GET' && !isEmptyArgs) {
        const queryParams = new URLSearchParams(finalArgs).toString();
        finalEndpointUrl = `${finalEndpointUrl}?${queryParams}`;
        console.log(`Background: Appended query params for GET request: ${queryParams}`);
      } else if (['POST', 'PUT', 'PATCH'].includes(method) && !isEmptyArgs) {
        finalFetchOptions.headers['Content-Type'] = 'application/json';
        finalFetchOptions.body = JSON.stringify(finalArgs);
      }
    }
    // For DELETE, args might be used in the URL path (not handled here) or ignored, body is typically empty.
    // If args are needed for DELETE, the user should construct the endpointUrl accordingly in the tool definition.

    console.log("Background: Webhook Fetch Details:", { endpointUrl: finalEndpointUrl, fetchOptions: finalFetchOptions });

    const response = await fetch(finalEndpointUrl, finalFetchOptions); // Use finalEndpointUrl and finalFetchOptions
    console.log(`Background: Fetch response received. Status: ${response.status}, StatusText: ${response.statusText}`);

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text(); // Try to get error details from response body
      } catch (_) { /* Ignore if body cannot be read */ }
      const errorMsg = `HTTP error ${response.status}: ${response.statusText}. ${errorBody}`.trim();
      console.error(`Background: HTTP error for ${finalEndpointUrl}:`, errorMsg);
      throw new Error(errorMsg);
    }

    // Attempt to parse response as JSON, fall back to text if not JSON
    const contentType = response.headers.get('content-type');
    console.log(`Background: Response content-type: ${contentType}`);

    let result;
    if (contentType && contentType.includes('application/json')) {
      result = await response.json();
    } else {
      result = await response.text();
    }

    console.log(`Background: Parsed response result:`, result);
    return result;

  } catch (error) {
    console.error(`Background: Error calling endpoint ${endpointUrl}:`, error);
    // Rethrow a more specific error message
    throw new Error(`Failed to call endpoint ${endpointUrl}: ${error.message}`);
  }
}

// Helper function to check for valid URL (duplicate from api-client.js, should be shared)
function isValidURL(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Registry for *built-in* tool implementations (developer adds specific functions here)
// User-defined endpoints will be handled separately.
const toolImplementations = {
  // Example built-in tool (if any are needed):
  /*
  'getCurrentTime': async (args) => {
    console.log("Executing built-in tool getCurrentTime");
    return { currentTime: new Date().toISOString() };
  }
  */
  // Add the generic caller function to the registry for potential direct use if needed,
  // but the main logic will check endpointUrl first.
  _callUserDefinedEndpoint: callUserDefinedEndpoint
};

// Execute tool function
async function executePromptPaulTool(request, sender, sendResponse) {
  const { id, name, arguments: argsString } = request.toolCall;
  console.log(`Background: Received request to execute tool '${name}' with id '${id}' (executePromptPaulTool entry)`);

  // Prevent duplicate executions
  const executionKey = `${id}-${name}`;
  if (activeToolExecutions.has(executionKey)) {
    console.log(`Background: Tool execution '${executionKey}' already in progress, ignoring duplicate request`);
    return true;
  }

  activeToolExecutions.add(executionKey);
  console.log(`Background: Added '${executionKey}' to active executions. Active count: ${activeToolExecutions.size}`);

  (async () => {
    try {
      const allTools = await getAllToolDefinitions();
      const toolDefinition = allTools.find(t => t.name === name);

      if (!toolDefinition) {
        throw new Error(`Tool definition for '${name}' not found in storage.`);
      }

      let argsObject;
      try {
        argsObject = JSON.parse(argsString || '{}');
      } catch (parseError) {
        throw new Error(`Invalid arguments format for tool '${name}'. Expected JSON. Received: ${argsString}`);
      }

      // === NEW MCP LOGIC STARTS HERE ===
      if (toolDefinition.mcpServerUrl && toolDefinition.mcpServerUrl.trim() !== "") {
        console.log(`Executing '${name}' as an MCP tool via ${toolDefinition.mcpServerUrl}`);
        try {
          const session = await getMcpSession(toolDefinition.mcpServerUrl);
          if (!session || !session.initialized) {
            throw new Error("MCP session could not be initialized.");
          }

          // Update session last used timestamp
          session.lastUsed = Date.now();

          // Add debug logging for MCP tool execution
          console.debug(`MCP Tool Execution: ${name} with args:`, argsObject);

          // Validate that the server supports this tool
          // Check if tools exists and is an array before using .some()
          const serverTools = session.tools;
          if (!Array.isArray(serverTools) || !serverTools.some(t => t.name === name)) {
            console.warn(`Tool '${name}' not found in server capabilities or serverCapabilities.tools is not an array. Server tools:`, serverTools);
            throw new Error(`MCP server at ${toolDefinition.mcpServerUrl} does not list tool '${name}' among its capabilities.`);
          }

          const requestId = `mcp-tc-${Date.now()}`;
          const mcpPayload = createMcpToolCallPayload(toolDefinition.name, argsObject, requestId);

          // Execute MCP request
          const mcpResponse = await sendMcpRequest(toolDefinition.mcpServerUrl, mcpPayload);

          // MCP's tools/call result is expected to be CallToolResult, which has a 'content' field.
          // The actual data might be in mcpResponse.result.content or just mcpResponse.result
          // For now, sending mcpResponse.result as per the generic structure.
          // The structure of 'result' from 'tools/call' should be: { content: "...", isError: false/true }
          // So, mcpResponse.result should be this object.
          try { await trackInstructionUsed({ instruction: 'tool_invoke', model: (await validateConfig().catch(()=>({})))?.modelName, tools: [name] }); } catch (_) {}
          sendResponse({ result: mcpResponse.result });

        } catch (mcpError) {
          console.error(`Background: Error executing MCP tool '${name}':`, mcpError, mcpError.details); // Log details if present
          // Enhanced error logging for TypeErrors
          // The existing mcpError.details logging seems correct as per the requirement.
          // The requirement states: "ensure the console.error in the catch (mcpError) block ... correctly logs mcpError.details if it exists, which it already seems to do."
          // The existing line is: console.error(`Background: Error executing MCP tool '${name}':`, mcpError, mcpError.details);
          // This already logs mcpError.details if it exists.
          if (mcpError instanceof TypeError) {
            // This debug info is helpful for TypeErrors which was the original problem.
            console.error('MCP Capabilities Debug Info during TypeError:', {
              serverCapabilities: session?.serverCapabilities, // Use optional chaining for session as well
              tools: session?.serverCapabilities?.tools
            });
          }
          let userFriendlyMessage;
          if (mcpError.details && mcpError.details.message) { // Check if mcpError.details and its message exist
            userFriendlyMessage = `MCP Tool '${name}' Error: ${mcpError.details.message} (Code: ${mcpError.details.code || 'N/A'})`;
          } else {
            userFriendlyMessage = `Failed to execute MCP tool '${name}': ${mcpError.message || 'An unknown error occurred during MCP tool execution.'}`;
          }
          try { await trackErrorEvent('tool_error', name); } catch (_) {}
          sendResponse({ error: userFriendlyMessage });
        }
      } else if (toolDefinition.endpointUrl) { // Existing non-MCP tool logic
        console.log(`Executing '${name}' as a user-defined HTTP tool via ${toolDefinition.endpointUrl}`);
        const result = await callUserDefinedEndpoint(toolDefinition.endpointUrl, argsObject, toolDefinition.httpMethod);
        console.log(`Background: User-defined tool '${name}' executed successfully via endpoint. Result:`, result);
        try { await trackInstructionUsed({ instruction: 'tool_invoke', model: (await validateConfig().catch(()=>({})))?.modelName, tools: [name] }); } catch (_) {}
        sendResponse({ result: result });
      } else { // Existing built-in tool logic (if any)
        const builtInFunction = toolImplementations[name];
        if (builtInFunction) {
          console.log(`Executing '${name}' as a built-in tool.`);
          const result = await builtInFunction(argsObject);
          console.log(`Background: Built-in tool '${name}' executed successfully. Result:`, result);
          try { await trackInstructionUsed({ instruction: 'tool_invoke', model: (await validateConfig().catch(()=>({})))?.modelName, tools: [name] }); } catch (_) {}
          sendResponse({ result: result });
        } else {
          throw new Error(`Tool '${name}' is not properly configured: It has no mcpServerUrl, no endpointUrl, and no built-in implementation.`);
        }
      }
      // === MCP LOGIC ENDS HERE ===

    } catch (error) { // General error catch for executePromptPaulTool
      console.error(`Background: Error processing tool '${name}' in executePromptPaulTool:`, error);
      // Provide more detailed error message for MCP tools
      let errorMessage = error.message || 'Tool processing failed';
      if (error.details) {
        errorMessage += ` (Details: ${JSON.stringify(error.details)})`;
      }
      sendResponse({ error: errorMessage });
    } finally {
      // Always remove from active executions when done
      activeToolExecutions.delete(executionKey);
      console.log(`Background: Removed '${executionKey}' from active executions. Active count: ${activeToolExecutions.size}`);
    }
  })();
  return true; // Crucial for async sendResponse
}

// Get discovered MCP tool schema
async function getDiscoveredMcpToolSchema(request, sender, sendResponse) {
  const { mcpServerUrl, toolName } = request;
  if (!mcpServerUrl || !toolName) {
    sendResponse({ success: false, error: 'Missing mcpServerUrl or toolName in request.' });
    return;
  }

  // Import mcpSessions from mcp-client module
  const { mcpSessions } = await import('./mcp-client.js');
  const session = mcpSessions[mcpServerUrl];
  if (session && session.tools && Array.isArray(session.tools)) {
    const discoveredTool = session.tools.find(t => t.name === toolName);
    if (discoveredTool) {
      // The discoveredTool object should contain name, description, and inputSchema (or similar)
      sendResponse({ success: true, toolSchema: discoveredTool });
    } else {
      sendResponse({ success: false, error: `Tool '${toolName}' not found in discovered tools for ${mcpServerUrl}.` });
    }
  } else {
    sendResponse({ success: false, error: `MCP session for ${mcpServerUrl} not active or tools not listed.` });
  }
  return true; // Indicates asynchronous response
}

// Fetch MCP tool details from server
async function fetchMcpToolDetailsFromServer(request, sender, sendResponse) {
  const { mcpServerUrl, toolName } = request;
  if (!mcpServerUrl || !toolName) {
    sendResponse({ success: false, error: 'Missing mcpServerUrl or toolName in request for fetchMcpToolDetailsFromServer.' });
    return;
  }
  console.log(`Background: fetchMcpToolDetailsFromServer - Request to fetch details for tool '${toolName}' from MCP server '${mcpServerUrl}'`);
  try {
    // Ensure session is initialized and tools are listed
    const session = await getMcpSession(mcpServerUrl); // This initializes and calls listMcpTools internally
    if (!session || !session.initialized) {
      throw new Error(`MCP session could not be initialized for ${mcpServerUrl}.`);
    }

    if (session.tools && Array.isArray(session.tools)) {
      const discoveredTool = session.tools.find(t => t.name === toolName);
      if (discoveredTool) {
        console.log(`Background: fetchMcpToolDetailsFromServer - Found tool '${toolName}'. Schema:`, discoveredTool);
        // Send back the full tool schema as discovered from the server
        sendResponse({ success: true, toolSchema: discoveredTool });
      } else {
        console.warn(`Background: fetchMcpToolDetailsFromServer - Tool '${toolName}' not found in discovered tools for ${mcpServerUrl}. Available tools:`, session.tools.map(t => t.name));
        sendResponse({ success: false, error: `Tool '${toolName}' not found among tools listed by ${mcpServerUrl}.` });
      }
    } else {
      console.error(`Background: fetchMcpToolDetailsFromServer - MCP session for ${mcpServerUrl} does not have a valid 'tools' array. Session state:`, session);
      sendResponse({ success: false, error: `Failed to list or retrieve tools from ${mcpServerUrl}. Session 'tools' array is invalid or missing.` });
    }
  } catch (error) {
    console.error(`Background: fetchMcpToolDetailsFromServer - Error fetching tool details for '${toolName}' from ${mcpServerUrl}:`, error);
    sendResponse({ success: false, error: `Error initializing session or fetching tool details: ${error.message}` });
  }
  return true; // Indicates asynchronous response
}

export {
  executePromptPaulTool,
  getDiscoveredMcpToolSchema,
  fetchMcpToolDetailsFromServer,
  activeToolExecutions
};