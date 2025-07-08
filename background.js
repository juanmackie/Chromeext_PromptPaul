import './marked.min.js';
console.log('marked.min.js imported successfully.');
console.log('Background service worker script started.');

let messageListenerAdded = false;
let tabContentCallback = null; // To store sendResponse for getTabContent
let pinnedActionTabContentCallback = null; // To store sendResponse for getPinnedActionTabContent

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
        const response = await fetch(mcpServerUrl, {
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
        const response = await fetch(mcpServerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream' // Correct Accept header
            },
            body: JSON.stringify(requestPayload)
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
            initialized: true
        };
        mcpSessions[mcpServerUrl] = session; // Cache the session
        console.log(`MCP session (with mcpSessionId: ${mcpSessionId}) successfully initialized and cached for ${mcpServerUrl}`);

        // Send "initialized" notification
        await sendMcpNotification(mcpServerUrl, "initialized", {});

        // Attempt to list tools from the MCP server
        try {
            // Note: listMcpTools internally uses sendMcpRequest which relies on the session being in mcpSessions.
            // This is okay because we've already cached it above.
            // Passing sessionId explicitly to listMcpTools is not strictly necessary if sendMcpRequest always pulls from mcpSessions,
            // but it can be kept for clarity or if listMcpTools might be used in contexts where the session isn't yet cached.
            // For now, sendMcpRequest uses the global mcpSessions, so sessionId in listMcpTools isn't used by sendMcpRequest.
            const discoveredTools = await listMcpTools(mcpServerUrl, session.mcpSessionId);
            if (discoveredTools && discoveredTools.length > 0) {
                session.tools = discoveredTools;
                console.log(`MCP Initialize: Discovered ${discoveredTools.length} tools from ${mcpServerUrl}:`, discoveredTools);
            } else {
                session.tools = []; // Ensure session.tools is always an array
                console.log(`MCP Initialize: No tools discovered or returned from ${mcpServerUrl}.`);
            }
        } catch (toolError) {
            console.error(`MCP Initialize: Failed to list tools from ${mcpServerUrl}. Error:`, toolError.message);
            session.tools = []; // Ensure session.tools is an array even on error
            // Do not re-throw; session initialization can proceed without tools.
        }

        return session;

    } catch (error) {
        console.error(`Error during MCP session initialization for ${mcpServerUrl}:`, error);
        delete mcpSessions[mcpServerUrl];
        // Enhanced error message with more details
        const enhancedError = new Error(`MCP session initialization failed for ${mcpServerUrl}: ${error.message}`);
        enhancedError.cause = error; // Attach the original error as cause
        throw enhancedError;
    }
}

async function getMcpSession(mcpServerUrl) {
    if (mcpSessions[mcpServerUrl] && mcpSessions[mcpServerUrl].initialized) {
        console.log(`Returning existing MCP session for: ${mcpServerUrl}`);
        return mcpSessions[mcpServerUrl];
    }
    console.log(`No existing session or not initialized, creating new MCP session for: ${mcpServerUrl}`);
    return await initializeMcpSession(mcpServerUrl);
}

// New function to list tools from an MCP server
async function listMcpTools(mcpServerUrl, sessionId) { // sessionId might not be strictly needed if sendMcpRequest uses global session
    console.log(`Listing tools from MCP server: ${mcpServerUrl}`);
    const requestId = `mcp-listtools-${Date.now()}`;
    const requestPayload = {
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/list", // Standard MCP method for listing tools
        params: {} // Typically no parameters for a list method
    };

    try {
        // sendMcpRequest will use the mcpSessionId from the cached session for mcpServerUrl
        const mcpResponse = await sendMcpRequest(mcpServerUrl, requestPayload);

        if (mcpResponse && mcpResponse.result && Array.isArray(mcpResponse.result.tools)) {
            console.log(`MCP tools/list: Received ${mcpResponse.result.tools.length} tools from ${mcpServerUrl}.`);
            return mcpResponse.result.tools; // Expected structure { tools: [...] }
        } else {
            console.error(`MCP tools/list: Unexpected response format from ${mcpServerUrl}. Response:`, mcpResponse);
            return []; // Return empty array on unexpected format
        }
    } catch (error) {
        console.error(`MCP tools/list: Error listing tools from ${mcpServerUrl}: ${error.message}`);
        // Depending on desired strictness, could throw error or return empty array.
        // For robustness of session initialization, returning empty array.
        return [];
    }
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
        const response = await fetch(mcpServerUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestPayload)
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

// Enable the side panel on all pages
chrome.sidePanel
  .setOptions({ path: 'chat.html' })
  .catch((error) => console.error(error));

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.sidePanel.setOptions({
    tabId,
    path: 'chat.html',
    enabled: true
  }).catch((error) => console.error(`Error setting side panel options for tab ${tabId}:`, error));
});

// Optimized context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log("Context Menu Clicked:", info.menuItemId, "Initial selectionText:", info.selectionText);
  await chrome.sidePanel.open({ tabId: tab.id });

  let originalSelectionText = info.selectionText;
  let promptContent = info.selectionText || '';

  if (!originalSelectionText) {
    console.log("No text selected, attempting to fetch tab content via 'getTabContent' message...");
    try {
        // The contextMenus.onClicked listener IS async (line 23).
        const tabDataResponse = await new Promise((resolve, reject) => {
            const messageTimeout = setTimeout(() => {
                reject(new Error("Timeout waiting for getTabContent response"));
            }, 5000); // 5 second timeout for the message response

            chrome.runtime.sendMessage({ action: 'getTabContent', tabId: tab.id }, (response) => {
                clearTimeout(messageTimeout);
                if (chrome.runtime.lastError) {
                    console.error("Background: Error receiving getTabContent response:", chrome.runtime.lastError.message);
                    return reject(new Error("Failed to get tab content: " + chrome.runtime.lastError.message));
                }
                if (response) {
                    resolve(response); // Resolve with the full response object
                } else {
                    // This case should ideally be caught by chrome.runtime.lastError if sendResponse is not called
                    reject(new Error("Failed to get tab content: No response from getTabContent handler."));
                }
            });
        });

        // Check for both content and data properties to handle different response formats
        if (tabDataResponse && tabDataResponse.success) {
            if (tabDataResponse.content) {
                promptContent = tabDataResponse.content;
                console.log("Background: Tab content fetched via 'getTabContent' message (content property), length:", promptContent.length);
            } else if (tabDataResponse.data) {
                promptContent = tabDataResponse.data;
                console.log("Background: Tab content fetched via 'getTabContent' message (data property), length:", promptContent.length);
            } else {
                console.error("Background: Tab content response successful but missing content/data property. Response:", tabDataResponse);
                promptContent = originalSelectionText; // Fallback
            }
        } else {
            console.error("Background: Failed to get tab content via 'getTabContent' message. Response:", tabDataResponse);
            promptContent = originalSelectionText; // Fallback to empty or original selection
        }
    } catch (error) {
        console.error("Background: Exception while fetching tab content via 'getTabContent' message:", error.message);
        promptContent = originalSelectionText; // Fallback
    }
  }
  
  // Handle image context
  // This should be applied *after* potentially fetching tab content if selection was empty
  if (info.mediaType === 'image' && info.srcUrl) {
    // If promptContent is from tab summary, prepend image URL. Otherwise, it's selection text.
    promptContent = `Image URL: ${info.srcUrl}\n${promptContent}`.trim();
    console.log("Image context added. Updated promptContent:", promptContent.substring(0, 100));
  }

  console.log("Base promptContent before instruction:", promptContent.substring(0, 100));

  // Handle special menu items
  if (info.menuItemId === 'manageInstructions') {
    console.log("Handling manageInstructions, opening options page.");
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    return;
  }

  // Common message sending function
  const sendMessage = (action, extra = {}) => {
    chrome.runtime.sendMessage({
      action,
      selectedText: promptContent,
      tabId: tab.id,
      ...extra
    }).catch(error => console.log(`Error sending ${action}: ${error.message}, tabId: ${tab.id}`));
  };

  if (info.menuItemId === 'oneoff_instruction') {
    console.log("Handling oneoff_instruction. Sending setSelectedText message.");
    setTimeout(() => sendMessage('setSelectedText'), 100); // sendMessage already logs errors
    return;
  }

  if (info.menuItemId === 'start_chat') {
    console.log("Handling start_chat. Sending setSelectedText and calling API.");
    sendMessage('setSelectedText', { fromStartChat: true });
    console.log("Final promptContent with instruction (start_chat - implicit):", promptContent.substring(0, 100));
    console.log("Calling makeLlmApiRequest for menuItemId:", info.menuItemId);
    await makeLlmApiRequest(promptContent, tab.id, { isStartChat: true });
    return;
  }

  // Handle custom instructions
  if (info.menuItemId.startsWith('custom_')) {
    const instructionId = info.menuItemId.replace('custom_', '');
    console.log("Handling custom instruction. ID:", instructionId);
    const { instructions } = await chrome.storage.local.get(['instructions']);
    const instruction = instructions.find(i => i.id === instructionId);
    
    if (instruction) {
      promptContent = `${instruction.content}\n\n${promptContent}`;
      console.log("Final promptContent with instruction (custom):", promptContent.substring(0, 100));
      const toolChoice = instruction.tool_choice || 'none';
      console.log("Calling makeLlmApiRequest for menuItemId (custom):", info.menuItemId, "with tool_choice:", toolChoice);
      await makeLlmApiRequest(promptContent, tab.id, { customInstructionToolChoice: toolChoice });
    } else {
      console.error("Custom instruction not found for ID:", instructionId);
    }
    return;
  }

  // Handle predefined commands
  const commandMap = {
    summarize: 'Please summarize the following text into a bullet list of points',
    explain: 'Explain this to me in a short concise MECE approach',
    // explain: 'Explain this to me in a short concise MECE approach', // Duplicate "explain" removed
    polish: 'Polish this text with clarity and purpose',
    shorten: 'Shorten this text without losing its meaning and context',
    formal: 'Make this text more formal and eloquent',
    casual: 'Make this text more casual and fun',
    analyze: 'Please analyze the following text'
  };

  if (commandMap[info.menuItemId]) {
    promptContent = `${commandMap[info.menuItemId]}:\n${promptContent}`;
    console.log("Final promptContent with instruction (predefined):", promptContent.substring(0, 100));
  } else if (info.menuItemId !== 'prompt_paul' && !info.menuItemId.startsWith('custom_') && info.menuItemId !== 'oneoff_instruction' && info.menuItemId !== 'start_chat' && info.menuItemId !== 'manageInstructions') {
    // Log if no specific instruction handling was matched for known patterns, but it's not a parent menu item
    console.log("No specific command/instruction prepended for menuItemId:", info.menuItemId);
  }

  console.log("Calling makeLlmApiRequest for menuItemId:", info.menuItemId);
  await makeLlmApiRequest(promptContent, tab.id);
});

// Helper function to check for valid URL
function isValidURL(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Simplified validateConfig function
async function validateConfig() {
  console.log('Background: Validating configuration...');
  const result = await new Promise(resolve =>
    chrome.storage.local.get(['profiles', 'lastSelectedProfileId', 'defaultLlmEndpoint'], resolve)
  );
  
  const profiles = result.profiles || [];
  const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
  const defaultLlmEndpoint = result.defaultLlmEndpoint || '';

  // Find profiles
  const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId);
  const defaultProfile = profiles.find(p => p.id === 'default');

  // Validate profile with optional endpoint override
  const validateProfile = (profile, endpointOverride = null) => {
    const endpoint = endpointOverride || profile?.llmEndpoint;
    return endpoint && isValidURL(endpoint) && profile?.apiKey && profile?.modelName;
  };

  // Check profiles in priority order
  let validProfile = null;
  if (validateProfile(selectedProfile)) {
    validProfile = selectedProfile;
  } else if (validateProfile(selectedProfile, defaultLlmEndpoint)) {
    validProfile = { ...selectedProfile, llmEndpoint: defaultLlmEndpoint };
  } else if (validateProfile(defaultProfile)) {
    validProfile = defaultProfile;
  } else if (validateProfile(defaultProfile, defaultLlmEndpoint)) {
    validProfile = { ...defaultProfile, llmEndpoint: defaultLlmEndpoint };
  }

  if (validProfile) {
    console.log(`Background: Using configuration from profile: ${validProfile.name || validProfile.id}`);
    return validProfile;
  }

  // Handle errors
  const hasEndpoint = defaultLlmEndpoint && isValidURL(defaultLlmEndpoint);
  const hasValidProfile = selectedProfile || defaultProfile;
  
  if (!hasEndpoint) {
    throw new Error('LLM API endpoint is missing or invalid. Please configure it in the options page.');
  } else if (!hasValidProfile) {
    throw new Error('No valid profiles found. Please create a profile in the options page.');
  } else {
    throw new Error('Configuration is incomplete. Please set API key and model name in the options page.');
  }
}

// Helper function to process API response and send messages to chat.js (for NON-STREAMING responses)
async function _handleApiResponseAndSendMessage(responseMessage, prompt, tabId, isStartChatContext, usingAnthropicMcp) {
    const sendMessageDelay = isStartChatContext ? 300 : 200;

    if (usingAnthropicMcp) {
        // This branch handles non-streaming responses when the Anthropic MCP Connector was used.
        // Anthropic's response (responseMessage) will be an object where responseMessage.content is an array of blocks
        // (e.g., text, mcp_tool_use, mcp_tool_result).
        console.log("Background: Handling non-streaming response for Anthropic MCP Connector.", responseMessage);
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: responseMessage, // Send the whole Anthropic message object
                isAnthropicMcp: true, // Flag for chat.js to identify this response type
                prompt: prompt,
                tabId: tabId,
            }).catch(error => console.log(`Error sending Anthropic MCP response to chat: ${error.message}, tabId: ${tabId}`));
        }, sendMessageDelay);

    } else if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        // This is the OpenAI-style tool call
        console.log("Background: Received OpenAI style tool_calls from API, forwarding to chat.js", responseMessage.tool_calls);
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'handleToolCallResponse', // chat.js handles this by calling executePromptPaulTool
                responseMessage: responseMessage,
                prompt: prompt,
                tabId: tabId,
            }).catch(error => console.log(`Error sending handleToolCallResponse: ${error.message}, tabId: ${tabId}`));
        }, sendMessageDelay);

    } else if (responseMessage.content) { // Standard text response
        const latestResponse = typeof responseMessage.content === 'string' ? responseMessage.content : JSON.stringify(responseMessage.content);
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: latestResponse,
                isAnthropicMcp: false, // Explicitly false
                prompt: prompt,
                tabId: tabId,
            }).catch(error => console.log(`Error sending setApiResponse (content): ${error.message}, tabId: ${tabId}`));
        }, sendMessageDelay);
    } else {
        console.error("Background: API response message has neither standard content nor tool_calls (OpenAI/Anthropic MCP):", responseMessage);
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: "Error: Received an empty or invalid response from the AI.",
                isAnthropicMcp: false, // Explicitly false
                prompt: prompt,
                tabId: tabId,
            }).catch(error => console.log(`Error sending setApiResponse (error response): ${error.message}, tabId: ${tabId}`));
        }, sendMessageDelay);
    }
}

// Refactored function to make LLM API calls
async function makeLlmApiRequest(promptContent, tabId, { isStartChat = false, customInstructionToolChoice = 'none' } = {}) {
    let config, tools, enableStreaming, usingAnthropicMcpConnectorGlobal = false; // Keep track of connector usage
    try {
        // Step 1: Validate configuration and get tool definitions
        try {
            const results = await Promise.all([
                validateConfig(),
                getAllToolDefinitions(),
                new Promise(resolve => chrome.storage.sync.get({ enableStreaming: false }, data => resolve(data)))
            ]);
            config = results[0];
            tools = results[1];
            enableStreaming = results[2].enableStreaming;
        } catch (error) {
            // Check if this is the specific configuration error we're looking for
            if (error.message === "LLM API endpoint is missing or invalid. Please configure it in the options page.") {
                console.warn("Background: Caught specific LLM endpoint configuration error.");
                chrome.runtime.sendMessage({
                    action: 'displayErrorInChat', // New action for chat.js
                    errorMessage: "The LLM API endpoint is not configured or is invalid. Please go to the extension options page (right-click the extension icon) and set it up.",
                    tabId: tabId,
                    prompt: promptContent // Pass prompt content for context if needed
                }).catch(e => console.error("Background: Error sending displayErrorInChat message:", e));
                return; // Stop further execution in this function
            }
            // If it's a different error from validateConfig or other setup, re-throw it
            throw error;
        }

        const formattedTools = tools.map(tool => {
            try {
                return {
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: JSON.parse(tool.parameters || '{}')
                    }
                };
            } catch (e) {
                console.error(`Background: Error parsing parameters for tool ${tool.name}:`, e);
                return null;
            }
        }).filter(tool => tool !== null);

        const messages = [];        const now = new Date();        const dateTimeString = `Date: ${now.toLocaleDateString()} Time: ${now.toLocaleTimeString()}`;        let systemPromptContent = dateTimeString;        if (config.systemPrompt && config.systemPrompt.trim() !== '') {            systemPromptContent += `

${config.systemPrompt}`;        }        messages.push({ role: 'system', content: systemPromptContent });        messages.push({ role: 'user', content: promptContent });

        // START SHARED API REQUEST PREP LOGIC (manual sync with chat.js)
        // Note: 'tools' variable here is 'allAvailableTools' in chat.js
        // 'customInstructionToolChoice' is 'tool_choice' in chat.js makeApiCall signature
        const allAvailableToolsRaw = tools; // Alias for clarity within this block
        const current_tool_choice_option = customInstructionToolChoice; // Parameter to this function

        const formattedToolsForRequest = allAvailableToolsRaw.map(tool => {
            try {
                return {
                    type: 'function',
                    function: { name: tool.name, description: tool.description, parameters: JSON.parse(tool.parameters || '{}') }
                };
            } catch (e) {
                console.error(`Background: Error parsing parameters for tool ${tool.name}:`, e); // Context-specific error
                return null;
            }
        }).filter(tool => tool !== null);

        let toolChoicePayload = {};

        if (current_tool_choice_option === 'none' || formattedToolsForRequest.length === 0) {
            toolChoicePayload = {};
            if (formattedToolsForRequest.length === 0 && current_tool_choice_option !== 'none') {
                 console.warn("Background: makeLlmApiRequest - No tools available, though choice was not 'none'. Sending request without tools.");
            } else {
                 console.log("Background: makeLlmApiRequest - Tool choice is 'none' or no tools available. Sending request without tools.");
            }
        } else if (current_tool_choice_option === 'auto') {
            toolChoicePayload = { tools: formattedToolsForRequest, tool_choice: "auto" };
            console.log("Background: makeLlmApiRequest - Tool choice is 'auto'. Sending with all available tools.");
        } else if (typeof current_tool_choice_option === 'string') { // Specific tool name
            const specificTool = formattedToolsForRequest.find(t => t.function.name === current_tool_choice_option);
            if (specificTool) {
                toolChoicePayload = { tools: [specificTool], tool_choice: { type: "function", function: { name: current_tool_choice_option } } };
                console.log(`Background: makeLlmApiRequest - Tool choice is specific: '${current_tool_choice_option}'. Sending with this tool.`);
            } else {
                console.warn(`Background: Specified tool "${current_tool_choice_option}" not found. No tools will be sent.`); // Context-specific error
                toolChoicePayload = {};
            }
        } else if (Array.isArray(current_tool_choice_option) && current_tool_choice_option.length > 0) {
            // This part is still specific to background.js as chat.js doesn't handle array of tool names yet.
            // If it needs to be fully harmonized, chat.js would need this logic too, or it's removed from here.
            // For now, keeping it as per current background.js capability.
            const selectedTools = formattedToolsForRequest.filter(tool =>
                current_tool_choice_option.includes(tool.function.name)
            );
            if (selectedTools.length > 0) {
                const tcObject = selectedTools.length === 1
                    ? { type: 'function', function: { name: selectedTools[0].function.name } }
                    // The API spec for tool_choice array seems to expect specific objects if not 'auto' or 'none'
                    // Forcing a specific tool with an array of names might require multiple {type: "function", function: {name: "X"}} objects
                    // or it might imply 'any' of these. Let's assume for now it means "the LLM must call one of these tools".
                    // The most robust way if the API supports it would be just to list the tools and let the LLM pick.
                    // However, to be explicit for "tool_choice" when it's a list:
                    // OpenAI docs are a bit sparse on this exact format for an array of *required* tools.
                    // Typically, 'tool_choice' is one specific tool or 'auto'/'none'.
                    // If the intention is to make a *subset* of tools available, that's done by filtering the `tools` array.
                    // If the intention for an array in `customInstructionToolChoice` was to *force one from a list*,
                    // the API usually expects a single tool object for `tool_choice`.
                    // Given this, the most direct interpretation matching the previous logic for an array:
                    // This implies the model *must* choose one of the functions in this list.
                    // The `tools` parameter should list these, and `tool_choice` could be "auto" over this subset,
                    // or if the API supports it, a list of functions.
                    // Let's simplify: if an array is passed, we'll make *only those tools available* and set choice to "auto".
                    // This aligns better with typical API usage.
                    : "auto"; // If multiple tools in the array, let the model choose from them.

                toolChoicePayload = { tools: selectedTools, tool_choice: tcObject };
                 console.log(`Background: makeLlmApiRequest - Tool choice is an array. Making these tools available: ${selectedTools.map(t=>t.function.name).join(', ')} with choice:`, tcObject);
            } else {
                 console.warn(`Background: Specified tools in array "${current_tool_choice_option}" not found. No tools will be sent.`);
                 toolChoicePayload = {};
            }
        } else {
            console.warn(`Background: Invalid tool choice format: ${current_tool_choice_option}. Defaulting to no tools.`);
            toolChoicePayload = {};
        }
        // END SHARED API REQUEST PREP LOGIC

        const apiRequestBody = {
            model: config.modelName,
            messages: messages,
            max_tokens: parseInt(config.maxTokens) || 2048,
            // toolChoicePayload will be spread later after checking for Anthropic MCP
        };

        const fetchHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        };

        // --- Anthropic MCP Connector Logic ---
        // This section implements the "Managed MCP Approach (Anthropic-style)".
        // If the configured LLM endpoint is identified as an Anthropic API endpoint
        // and there are tools configured with an "mcpServerUrl", this logic will:
        // 1. Add the 'anthropic-beta: mcp-client-2025-04-04' header.
        // 2. Construct an 'mcp_servers' array in the API request body, listing the MCP servers.
        // 3. Anthropic's backend will then manage the discovery and execution of tools from these servers.
        // 4. The OpenAI-style 'tools' and 'tool_choice' parameters are omitted in this case.
        // The response from Anthropic will include specific content blocks like 'mcp_tool_use' and 'mcp_tool_result'.

        // Simple check for Anthropic endpoint, can be made more robust
        const isAnthropicEndpoint = config.llmEndpoint.includes('api.anthropic.com');
        let usingAnthropicMcpConnector = false; // This flag will be passed down to response handlers

        if (isAnthropicEndpoint) {
            console.log("Background: Anthropic endpoint detected. Checking for MCP tools to use with MCP Connector.");
            const mcpConfiguredTools = allAvailableToolsRaw.filter(tool => tool.mcpServerUrl && tool.mcpServerUrl.trim() !== "");

            if (mcpConfiguredTools.length > 0) {
                usingAnthropicMcpConnector = true;
                fetchHeaders['anthropic-beta'] = 'mcp-client-2025-04-04'; // Required header

                apiRequestBody.mcp_servers = mcpConfiguredTools.map(tool => {
                    const serverEntry = {
                        type: "url",
                        url: tool.mcpServerUrl, // This should be the direct URL to the MCP server
                        name: tool.name, // Tool name used as server identifier for Anthropic
                        // tool_configuration: { enabled: true } // by default all tools on server are enabled
                    };
                    // TODO: Add authorization_token if available in tool definition (e.g., tool.mcpAuthToken)
                    // if (tool.mcpAuthToken) {
                    //     serverEntry.authorization_token = tool.mcpAuthToken;
                    // }
                    return serverEntry;
                });
                console.log("Background: Using Anthropic MCP Connector. mcp_servers payload:", JSON.stringify(apiRequestBody.mcp_servers, null, 2));
                // When using Anthropic MCP Connector, we don't send OpenAI-style 'tools' or 'tool_choice'
                // The 'tools' are implicitly discovered by Anthropic from the mcp_servers.
            } else {
                console.log("Background: Anthropic endpoint, but no MCP-configured tools found. Proceeding with standard tool definition if any.");
                // Spread OpenAI-style toolChoicePayload if not using Anthropic MCP connector
                Object.assign(apiRequestBody, toolChoicePayload);
            }
        } else {
            // Not an Anthropic endpoint, use standard OpenAI-style tool definition
            Object.assign(apiRequestBody, toolChoicePayload);
        }
        // --- End Anthropic MCP Connector Logic ---
        
        if (enableStreaming && !usingAnthropicMcpConnector) { // Anthropic might handle streaming differently with MCP, or this might need adjustment
            apiRequestBody.stream = true;
        } else if (enableStreaming && usingAnthropicMcpConnector) {
            // Anthropic Messages API with mcp_servers supports streaming for the main content.
            // The tool_use and tool_result blocks appear as discrete messages in the stream.
            apiRequestBody.stream = true;
            console.log("Background: Enabling streaming for Anthropic request with MCP Connector.");
        }


        console.log("Background: Final API Request Body:", JSON.stringify(apiRequestBody, null, 2));
        console.log("Background: Final Fetch Headers:", JSON.stringify(fetchHeaders, null, 2));


        const apiResponse = await fetch(config.llmEndpoint, {
            method: 'POST',
            headers: fetchHeaders,
            body: JSON.stringify(apiRequestBody),
        });

        if (!apiResponse.ok) {
            const errorData = await apiResponse.json().catch(() => null);
            throw new Error(
                `API request failed with status ${apiResponse.status}: ${
                errorData ? JSON.stringify(errorData) : apiResponse.statusText
                }`
            );
        }

        if (enableStreaming) {
            console.log("Background: Streaming API response...");
            const reader = apiResponse.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            // Send a message to chat.js to indicate streaming has started
            // This allows chat.js to prepare the UI for incoming chunks
            // Moved out of setTimeout to send immediately
            chrome.runtime.sendMessage({
                action: 'streamApiStart',
                tabId: tabId,
                prompt: promptContent
            }).catch(error => console.log(`Error sending streamApiStart synchronously: ${error.message}, tabId: ${tabId}`));

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    console.log("Background: Stream finished.");
                    chrome.runtime.sendMessage({ action: 'streamApiEnd', tabId: tabId, prompt: promptContent })
                        .catch(error => console.log(`Error sending streamApiEnd: ${error.message}, tabId: ${tabId}`));
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                console.log("Background: Stream raw chunk received:", buffer);

                // Process buffer line by line for SSE
                let lines = buffer.split('\n');
                buffer = lines.pop(); // Keep the last partial line in the buffer

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        let currentPayload = line.substring(5).trim(); // Remove the initial "data:" prefix and trim

                        // Aggressively strip any further "data:" prefixes
                        while (currentPayload.startsWith('data:')) {
                            console.warn("Background: Stripping nested 'data:' prefix. Current payload before strip:", currentPayload);
                            currentPayload = currentPayload.substring(5).trim();
                            console.warn("Background: Current payload after strip:", currentPayload);
                        }

                        if (currentPayload === '[DONE]') {
                            console.log("Background: Stream signaled [DONE].");
                            continue;
                        }

                        // Proceed to parse only if currentPayload is not empty and looks like JSON
                        if (currentPayload && currentPayload.length > 0 && (currentPayload.startsWith('{') || currentPayload.startsWith('['))) {
                            console.log('Background SSE Processing: Original line (after buffer split):', line);
                            console.log('Background SSE Processing: Final string to be parsed (currentPayload):', currentPayload);
                            try {
                                const parsed = JSON.parse(currentPayload);

                                // Check if we are using Anthropic MCP Connector for this request (Managed Approach)
                                if (usingAnthropicMcpConnectorGlobal) {
                                    // Handle Anthropic's specific streaming events.
                                    // These events include message_start, content_block_start, content_block_delta,
                                    // content_block_stop, message_delta, and message_stop.
                                    // The extension forwards relevant parts to chat.js for rendering.
                                    // Tool execution is handled by Anthropic's backend.
                                    console.log("Background: Anthropic MCP Stream Event:", parsed);

                                    if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.type === 'text_delta') {
                                        // Stream text chunks as they arrive.
                                        chrome.runtime.sendMessage({
                                            action: 'streamApiResponseChunk',
                                            chunk: parsed.delta.text,
                                            tabId: tabId,
                                            prompt: promptContent
                                        }).catch(error => console.log(`Error sending Anthropic text_delta chunk: ${error.message}`));
                                    } else if (parsed.type === 'content_block_start' && parsed.content_block) {
                                        // A new content block has started (e.g., text block or mcp_tool_use).
                                        // Send the initial content_block to chat.js.
                                        // chat.js will use this to display "Using tool..." for mcp_tool_use blocks.
                                        chrome.runtime.sendMessage({
                                            action: 'streamApiAnthropicContentBlockStart',
                                            contentBlock: parsed.content_block, // Contains type ('text' or 'mcp_tool_use'), name, input etc. for tools
                                            tabId: tabId,
                                            prompt: promptContent
                                        }).catch(error => console.log(`Error sending Anthropic content_block_start: ${error.message}`));
                                    } else if (parsed.type === 'message_delta' && parsed.delta && parsed.delta.stop_reason) {
                                        // Log message_delta, especially if it contains stop_reason or usage data.
                                        console.log("Background: Anthropic message_delta with stop_reason/usage:", parsed.delta);
                                    } else if (parsed.type === 'message_stop') {
                                        // This event signals the end of the message from Anthropic.
                                        // It often contains the complete final message object including all content blocks.
                                        console.log("Background: Anthropic MCP Stream message_stop event received.", parsed);
                                        if (parsed.message) { // The 'message' field holds the final assistant message.
                                             chrome.runtime.sendMessage({
                                                action: 'streamApiAnthropicMessageStop',
                                                anthropicMessage: parsed.message,
                                                tabId: tabId,
                                                prompt: promptContent
                                            }).catch(error => console.log(`Error sending Anthropic message_stop: ${error.message}`));
                                        }
                                    }
                                    // Other events like 'message_start', 'content_block_stop' are logged but not specifically actioned to chat.js unless needed.
                                } else {
                                    // Standard OpenAI-style streaming (Client-Managed tools if any, or text)
                                    // This path is taken if not using Anthropic or if Anthropic endpoint but no MCP tools were configured for it.
                                    if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                                        const contentChunk = parsed.choices[0].delta.content;
                                        const toolCallChunk = parsed.choices[0].delta.tool_calls;

                                        if (contentChunk) {
                                            chrome.runtime.sendMessage({
                                                action: 'streamApiResponseChunk',
                                                chunk: contentChunk,
                                                tabId: tabId,
                                                prompt: promptContent
                                            }).catch(error => console.log(`Error sending streamApiResponseChunk: ${error.message}, tabId: ${tabId}`));
                                        }

                                        if (toolCallChunk) {
                                            console.log("Background: Received OpenAI style tool_call delta (streaming):", toolCallChunk);
                                            chrome.runtime.sendMessage({
                                                action: 'streamApiToolCallChunk', // This tells chat.js to expect OpenAI tool_call
                                                toolCallChunk: toolCallChunk,
                                                tabId: tabId,
                                                prompt: promptContent
                                            }).catch(error => console.log(`Error sending streamApiToolCallChunk: ${error.message}, tabId: ${tabId}`));
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error("Background: Error parsing JSON from stream:", e, "Attempted to parse:", currentPayload, "Original full line:", line);
                            }
                        } else if (currentPayload) {
                            console.log("Background: SSE line does not appear to be JSON or [DONE] after stripping prefixes. Payload:", currentPayload, "Original line:", line);
                        }
                    }
                }
            }
        } else { // Non-streaming path
            const responseData = await apiResponse.json();
            // For Anthropic MCP non-streaming, responseData.content will be an array of blocks.
            // For OpenAI, responseData.choices[0].message is the object to check.
            const messageObject = usingAnthropicMcpConnectorGlobal ? responseData : (responseData.choices && responseData.choices[0] ? responseData.choices[0].message : null);

            if (!messageObject) {
                 throw new Error('Invalid response format from API: Missing message structure.');
            }
            // Pass usingAnthropicMcpConnectorGlobal to _handleApiResponseAndSendMessage
            await _handleApiResponseAndSendMessage(messageObject, promptContent, tabId, isStartChat, usingAnthropicMcpConnectorGlobal);
        }

    } catch (error) {
        // This is the generic catch block for any other errors that occur in makeLlmApiRequest
        console.error('Error in makeLlmApiRequest (generic catch):', error);
        const errorDelay = isStartChat ? 300 : 200;
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: `Error: ${error.message}`, // Standard error reporting
                prompt: promptContent,
                tabId: tabId,
            }).catch(e => console.error(`Error sending setApiResponse (from generic catch): ${e.message}, tabId: ${tabId}`));
        }, errorDelay);
    }
}

// Create context menu items
chrome.runtime.onInstalled.addListener(async () => {

  // Create one-off instruction menu item (always at top)
  chrome.contextMenus.create({
    id: 'oneoff_instruction',
    title: '✨ One-off Instruction',
    contexts: ['selection', 'image'],
  });
  // Create start chat menu item
  chrome.contextMenus.create({
    id: 'start_chat',
    title: '💬 Start Chat',
    contexts: ['selection', 'image'],
  });

  // Create parent menu for Prompt Paul
  chrome.contextMenus.create({
    id: 'prompt_paul',
    title: 'Query Prompt Paul',
    contexts: ['selection', 'image'],
  });

  // Create predefined menu items under Prompt Paul
  chrome.contextMenus.create({
    id: 'summarize',
    title: '📝 Summarize',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });
  chrome.contextMenus.create({
    id: 'analyze',
    title: '🧐 Analyze',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });
  chrome.contextMenus.create({
    id: 'explain',
    title: '❓ Explain',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });
  chrome.contextMenus.create({
    id: 'polish',
    title: '🪄 Polish',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });
    
  chrome.contextMenus.create({
    id: 'shorten',
    title: '✂️ Shorten',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });

  chrome.contextMenus.create({
    id: 'formal',
    title: '💼 Formal',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });
  chrome.contextMenus.create({
    id: 'casual',
    title: '🤙 Casual',
    contexts: ['selection', 'image'],
    parentId: 'prompt_paul'
  });
  // Create custom instructions menu items
  // Create parent menu for custom instructions
  chrome.contextMenus.create({
    id: 'customInstructions',
    title: 'Custom Instructions',
    contexts: ['selection', 'image'],
  });
  const { instructions } = await chrome.storage.local.get(['instructions']);
  console.log('Context menu loaded instructions from local:', instructions);
  if (instructions && instructions.length > 0) {
    instructions.forEach(instruction => {
      chrome.contextMenus.create({
        id: `custom_${instruction.id}`,
        parentId: 'customInstructions',
        title: `✨ ${instruction.name}`,
        contexts: ['selection', 'image'],
      });
    });
  }

  // Add a separator and manage instructions at the end
  setTimeout(() => {
    // Add a separator
    chrome.contextMenus.create({
      id: 'separator',
      type: 'separator',
      contexts: ['selection', 'image'],
    });

     // Add option to manage custom instructions as the last item
    chrome.contextMenus.create({
      id: 'manageInstructions',
      title: 'Manage Custom Instructions',
      contexts: ['selection', 'image'],
    });
  }, 100);
});

// Update context menus when instructions change
chrome.storage.onChanged.addListener(async (changes, namespace) => {
if (namespace === 'local' && changes.instructions) {
  // Remove existing menu items
  await chrome.contextMenus.remove('customInstructions').catch(e => console.log("Error removing customInstructions, it might not exist:", e));
  await chrome.contextMenus.remove('separator').catch(e => console.log("Error removing separator, it might not exist:", e));
  await chrome.contextMenus.remove('manageInstructions').catch(e => console.log("Error removing manageInstructions, it might not exist:", e));
  
  // Get updated instructions
  const { instructions } = await chrome.storage.local.get(['instructions']);
  
  // Recreate custom instructions menu
  chrome.contextMenus.create({
    id: 'customInstructions',
    title: 'Custom Instructions',
    contexts: ['selection', 'image'], // Add 'image' context here
  });
  
  if (instructions && instructions.length > 0) {
    instructions.forEach(instruction => {
      chrome.contextMenus.create({
        id: `custom_${instruction.id}`,
        parentId: 'customInstructions',
        title: `✨ ${instruction.name}`,
        contexts: ['selection', 'image'], // Add 'image' context here
      });
    });
  }

  // Add separator and manage instructions at the end
  setTimeout(() => { // Original setTimeout kept
    // Add a separator
    chrome.contextMenus.create({
      id: 'separator',
      type: 'separator',
      contexts: ['selection', 'image'], // Add 'image' context here
    });

     // Add option to manage custom instructions as the last item
    chrome.contextMenus.create({
      id: 'manageInstructions',
      title: 'Manage Custom Instructions',
      contexts: ['selection', 'image'], // Add 'image' context here
    });
  }, 100); // Original setTimeout kept
}
});

// --- Tool Execution Logic ---

// Helper function to get all tool definitions from storage
async function getAllToolDefinitions() {
    const localTools = await new Promise((resolve) => {
        chrome.storage.local.get(['promptPaulTools'], (result) => {
            resolve(result.promptPaulTools || []);
        });
    });
    return localTools;
}

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

        if (!response.ok) {
            let errorBody = '';
            try {
                errorBody = await response.text(); // Try to get error details from response body
            } catch (_) { /* Ignore if body cannot be read */ }
            throw new Error(`HTTP error ${response.status}: ${response.statusText}. ${errorBody}`.trim());
        }

        // Attempt to parse response as JSON, fall back to text if not JSON
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        } else {
            return await response.text();
        }

    } catch (error) {
        console.error(`Background: Error calling endpoint ${endpointUrl}:`, error);
        // Rethrow a more specific error message
        throw new Error(`Failed to call endpoint ${endpointUrl}: ${error.message}`);
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


// Listener for messages from content scripts or other extension parts (like chat.js)
console.log("Background: Attempting to add onMessage listener NOW...");
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Flag to indicate if sendResponse has been called for this message
    let responseSent = false;
    const originalSendResponse = sendResponse;

    // Wrap sendResponse to ensure it's only called once and to clear timeouts
    sendResponse = (response) => {
        if (!responseSent) {
            originalSendResponse(response);
            responseSent = true;
            // Clear any associated timeouts here if they were set for this specific message
            // (This requires passing timeoutId into the scope of this wrapped sendResponse)
        } else {
            console.warn("Background: Attempted to call sendResponse multiple times for the same message.");
        }
    };

    if (request.action === 'getTabContent') {
        if (tabContentCallback) {
            sendResponse({ action: 'tabContentResponse', success: false, error: 'Another content extraction is already in progress' });
            return true;
        }
        
        tabContentCallback = sendResponse;
        console.log('Background: getTabContent received. Injecting content script for extraction.');
        
        const timeoutId = setTimeout(() => {
            if (tabContentCallback) {
                console.error('Background: getTabContent timed out.');
                tabContentCallback({ action: 'tabContentResponse', success: false, error: 'Background: Content extraction timed out' });
                tabContentCallback = null;
            }
        }, 30000); // 30 seconds timeout

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id) {
                const activeTabId = tabs[0].id;
chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    files: ['content_script_tab_summary.js']
}, (injectionResults) => {
    clearTimeout(timeoutId); // Ensure timeout is cleared
    if (chrome.runtime.lastError) {
        console.error('Background: Error executing content_script_tab_summary.js for getTabContent:', chrome.runtime.lastError);
        if (tabContentCallback) {
            tabContentCallback({ action: 'tabContentResponse', success: false, error: 'Failed to execute script: ' + chrome.runtime.lastError.message });
            tabContentCallback = null;
        }
        return;
    }
    if (injectionResults && injectionResults[0] && injectionResults[0].result) {
        const result = injectionResults[0].result;
        console.log('Background: getTabContent - Result from content_script_tab_summary.js:', result);
        if (tabContentCallback) {
            tabContentCallback({
                action: 'tabContentResponse',
                success: result.success,
                content: result.data, // Ensure 'content' field is used as expected by chat.js
                error: result.error
            });
            tabContentCallback = null;
        }
    } else {
        console.error('Background: getTabContent - No result from content_script_tab_summary.js');
        if (tabContentCallback) {
            tabContentCallback({ action: 'tabContentResponse', success: false, error: 'No result from content script', content: '' }); // Ensure content is defined
            tabContentCallback = null;
        }
    }
});
            } else {
                console.error('No active tab found for getTabContent.');
                clearTimeout(timeoutId); // Clear timeout if no tab found
                if (tabContentCallback) {
                    tabContentCallback({ action: 'tabContentResponse', success: false, error: 'No active tab found.' });
                    tabContentCallback = null;
                }
            }
        });
        return true; // Indicates that sendResponse will be called asynchronously.
    } else if (request.action === 'extractedTabContent') {
        // Handle content extracted by content_script_tab_summary.js
        // This message is sent by content_script_tab_summary.js
        if (tabContentCallback) {
            tabContentCallback({
                action: 'tabContentResponse',
                success: request.success,
                content: request.data, // Use 'content' field for consistency
                data: request.data,    // Also keep 'data' field for backward compatibility
                error: request.error
            });
            tabContentCallback = null; // Clear callback
        } else if (pinnedActionTabContentCallback) { // Also check for pinned action callback
            pinnedActionTabContentCallback({
                action: 'pinnedActionTabContentResponse',
                success: request.success,
                content: request.data, // Use 'content' for pinned action response
                error: request.error
            });
            pinnedActionTabContentCallback = null; // Clear callback
        } else {
            console.warn("Background: Received 'extractedTabContent' but no pending callback.");
        }
        return true; // Indicate async response, though sendResponse might have been called by the callback
    } else if (request.action === 'getPinnedActionTabContent') {
        if (pinnedActionTabContentCallback) {
            sendResponse({ action: 'pinnedActionTabContentResponse', success: false, content: 'Another content extraction is already in progress' });
            return true;
        }
        
        pinnedActionTabContentCallback = sendResponse;
        console.log('Background: getPinnedActionTabContent received. Injecting content script for extraction.');
        
        const timeoutId = setTimeout(() => {
            if (pinnedActionTabContentCallback) {
                console.error('Background: getPinnedActionTabContent timed out.');
                pinnedActionTabContentCallback({ action: 'pinnedActionTabContentResponse', success: false, content: 'Background: Content extraction timed out' });
                pinnedActionTabContentCallback = null;
            }
        }, 30000); // 30 seconds timeout
        
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id) {
                const activeTabId = tabs[0].id;
chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    files: ['content_script_tab_summary.js']
}, (injectionResults) => {
    clearTimeout(timeoutId); // Ensure timeout is cleared
    if (chrome.runtime.lastError) {
        console.error('Background: Error executing content_script_tab_summary.js for getPinnedActionTabContent:', chrome.runtime.lastError);
        if (pinnedActionTabContentCallback) {
            pinnedActionTabContentCallback({
                action: 'pinnedActionTabContentResponse',
                success: false,
                content: 'Failed to execute script: ' + chrome.runtime.lastError.message,
                instruction: request.instruction // Echo back instruction on error
            });
            pinnedActionTabContentCallback = null;
        }
        return;
    }
    if (injectionResults && injectionResults[0] && injectionResults[0].result) {
        const result = injectionResults[0].result;
        console.log('Background: getPinnedActionTabContent - Result from content_script_tab_summary.js:', result);
        if (pinnedActionTabContentCallback) {
            pinnedActionTabContentCallback({
                action: 'pinnedActionTabContentResponse',
                success: result.success,
                content: result.data,
                data: result.data,
                error: result.error,
                instruction: request.instruction // Echo back instruction on success
            });
            pinnedActionTabContentCallback = null;
        }
    } else {
        console.error('Background: getPinnedActionTabContent - No result from content_script_tab_summary.js');
        if (pinnedActionTabContentCallback) {
            pinnedActionTabContentCallback({
                action: 'pinnedActionTabContentResponse',
                success: false,
                content: 'No result from content script',
                instruction: request.instruction // Echo back instruction on error
            });
            pinnedActionTabContentCallback = null;
        }
    }
});
            } else {
                console.error('No active tab found for getPinnedActionTabContent.');
                clearTimeout(timeoutId); // Clear timeout if no tab found
                if (pinnedActionTabContentCallback) {
                    pinnedActionTabContentCallback({
                        action: 'pinnedActionTabContentResponse',
                        success: false,
                        content: 'No active tab found.',
                        instruction: request.instruction // Echo back instruction on error
                    });
                    pinnedActionTabContentCallback = null;
                }
            }
        });
        return true; // Async response
    } else if (request.action === 'getExplainContent') {
        // Store the sendResponse function to call it later
        tabContentCallback = sendResponse;

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id) {
                const activeTabId = tabs[0].id;
chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    files: ['content_script_explain.js']
}, (injectionResults) => {
    // If there was a timeout for getExplainContent, clear it here.
    // clearTimeout(timeoutId_for_getExplainContent);
    if (chrome.runtime.lastError) {
        console.error('Failed to inject/execute content_script_explain.js:', chrome.runtime.lastError);
        if (tabContentCallback) {
            tabContentCallback({ action: 'explainContentResponse', success: false, error: 'Failed to inject script. ' + (chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Unknown error'), content: '' });
            tabContentCallback = null;
        }
        return;
    }
    if (injectionResults && injectionResults[0] && injectionResults[0].result) {
        const result = injectionResults[0].result;
        console.log('Background: getExplainContent - Result from content_script_explain.js:', result);
        if (tabContentCallback) {
            tabContentCallback({
                action: 'explainContentResponse',
                success: result.success,
                content: result.data, // Ensure 'content' field is used
                error: result.error
            });
            tabContentCallback = null;
        }
    } else {
        console.error('Background: getExplainContent - No result from content_script_explain.js');
        if (tabContentCallback) {
            tabContentCallback({ action: 'explainContentResponse', success: false, error: 'No result from content script', content: '' });
            tabContentCallback = null;
        }
    }
});
            } else {
                console.error('No active tab found for getExplainContent.');
                if (tabContentCallback) {
                    tabContentCallback({ action: 'explainContentResponse', success: false, error: 'No active tab found.' });
                    tabContentCallback = null;
                }
            }
        });
        return true;
    } else if (request.action === 'executePromptPaulTool') {
        const { id, name, arguments: argsString } = request.toolCall;
        console.log(`Background: Received request to execute tool '${name}' with id '${id}' (executePromptPaulTool entry)`);

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

                        // Assuming mcpServerUrl is the direct JSON-RPC endpoint for MCP.
                        const mcpResponse = await sendMcpRequest(toolDefinition.mcpServerUrl, mcpPayload);

                        // MCP's tools/call result is expected to be CallToolResult, which has a 'content' field.
                        // The actual data might be in mcpResponse.result.content or just mcpResponse.result
                        // For now, sending mcpResponse.result as per the generic structure.
                        // The structure of 'result' from 'tools/call' should be: { content: "...", isError: false/true }
                        // So, mcpResponse.result should be this object.
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
                        sendResponse({ error: userFriendlyMessage });
                    }
                } else if (toolDefinition.endpointUrl) { // Existing non-MCP tool logic
                    console.log(`Executing '${name}' as a user-defined HTTP tool via ${toolDefinition.endpointUrl}`);
                    const result = await callUserDefinedEndpoint(toolDefinition.endpointUrl, argsObject, toolDefinition.httpMethod);
                    console.log(`Background: User-defined tool '${name}' executed successfully via endpoint. Result:`, result);
                    sendResponse({ result: result });
                } else { // Existing built-in tool logic (if any)
                    const builtInFunction = toolImplementations[name];
                    if (builtInFunction) {
                        console.log(`Executing '${name}' as a built-in tool.`);
                        const result = await builtInFunction(argsObject);
                        console.log(`Background: Built-in tool '${name}' executed successfully. Result:`, result);
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
            }
        })();
        return true; // Crucial for async sendResponse
    } else if (request.action === 'getDiscoveredMcpToolSchema') {
        (async () => {
            const { mcpServerUrl, toolName } = request;
            if (!mcpServerUrl || !toolName) {
                sendResponse({ success: false, error: 'Missing mcpServerUrl or toolName in request.' });
                return;
            }

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
        })();
        return true; // Indicates asynchronous response
    } else if (request.action === 'fetchMcpToolDetailsFromServer') {
        (async () => {
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
        })();
        return true; // Indicates asynchronous response
    }
    // Handle other actions if any
});
console.log("Background: onMessage listener function HAS BEEN registered.");
