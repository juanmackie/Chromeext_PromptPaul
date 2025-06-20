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
        const { serverResponse, error: sseError } = parseSseResponse(responseText, requestId, mcpServerUrl);

        if (sseError) {
            // Log the full response text for debugging if parsing failed or the specific response wasn't found.
            console.error(`MCP Initialize: Full SSE response text from ${mcpServerUrl} during parsing error or if target response not found:\n${responseText}`);
            throw new Error(`MCP Initialize failed for ${mcpServerUrl}: ${sseError}`);
        }

        if (!serverResponse) {
            // This case should ideally be caught by sseError, but as a fallback:
            console.error(`MCP Initialize: Full SSE response text from ${mcpServerUrl} when 'initialize' result was not found (after parsing):\n${responseText}`);
            throw new Error(`MCP Initialize failed for ${mcpServerUrl}: 'initialize' result not found in SSE stream (after parsing).`);
        }

        if (serverResponse.error) {
            console.error('MCP Initialize error response from SSE:', JSON.stringify(serverResponse.error, null, 2));
            const serverError = new Error(`MCP Initialize failed for ${mcpServerUrl}: Server error ${serverResponse.error.code} - ${serverResponse.error.message}`);
            serverError.details = serverResponse.error; // Attach the full server error object
            throw serverError;
        }

        if (!serverResponse.result || typeof serverResponse.result.capabilities !== 'object' || typeof serverResponse.result.protocolVersion !== 'string') {
            console.error('MCP Initialize invalid result structure in SSE. Received:', JSON.stringify(serverResponse.result, null, 2));
            throw new Error('MCP Initialize failed: Invalid or incomplete result structure from server in SSE. "capabilities" (object) and "protocolVersion" (string) are required.');
        }

        console.log("MCP Server Initialize Result (from SSE):", serverResponse.result);
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

function parseSseResponse(responseText, targetRequestId, mcpServerUrl) {
    console.log(`Parsing SSE response for request ID ${targetRequestId} from ${mcpServerUrl}`);
    const lines = responseText.split(/\r?\n/);
    let currentEvent = { type: 'message', data: [] }; // Default event type
    let serverResponse = null;

    for (const line of lines) {
        if (line.startsWith(':')) {
            // Comment, ignore
            console.log("SSE Parser: Ignoring comment line:", line);
            continue;
        }
        if (line.trim() === '') {
            // End of an event
            if (currentEvent.data.length > 0) {
                const fullData = currentEvent.data.join('\n');
                console.log(`SSE Parser: Processing event type '${currentEvent.type}' with data:\n${fullData}`);
                // For initialize, we expect a JSON-RPC response, typically in an unnamed (message) event.
                // Other event types might be ignored or handled differently if needed in the future.
                if (currentEvent.type === 'message' || !currentEvent.type) { // Handle unnamed events as 'message'
                    try {
                        const parsedData = JSON.parse(fullData);
                        if (parsedData.id === targetRequestId && (parsedData.result || parsedData.error)) {
                            console.log("SSE Parser: Found target JSON-RPC response:", parsedData);
                            serverResponse = parsedData;
                            // Found the response we are looking for, can stop processing further events.
                            return { serverResponse, error: null };
                        } else {
                            console.log("SSE Parser: Parsed data, but not the target response. ID:", parsedData.id, "Expected ID:", targetRequestId);
                        }
                    } catch (e) {
                        console.warn(`SSE Parser: Error parsing JSON from data: "${fullData}"`, e);
                        // Continue to the next event, this one might not be the JSON we're looking for or is malformed.
                    }
                } else {
                    console.log(`SSE Parser: Ignoring event type '${currentEvent.type}' as it's not the primary 'message' type for initialization.`);
                }
            }
            currentEvent = { type: 'message', data: [] }; // Reset for next event
            continue;
        }

        const fieldMatch = line.match(/^(\w+):\s?(.*)$/);
        if (fieldMatch) {
            const [, field, value] = fieldMatch;
            if (field === 'event') {
                currentEvent.type = value;
                console.log("SSE Parser: Detected event type:", value);
            } else if (field === 'data') {
                currentEvent.data.push(value);
                console.log("SSE Parser: Appended data line:", value);
            } else if (field === 'id') {
                // SSE event ID, not to be confused with JSON-RPC ID. Store if needed.
                currentEvent.id = value;
                console.log("SSE Parser: Detected SSE event ID:", value);
            } else if (field === 'retry') {
                // SSE retry field. Store or handle if needed.
                currentEvent.retry = parseInt(value, 10);
                console.log("SSE Parser: Detected SSE retry value:", value);
            } else {
                console.log("SSE Parser: Ignoring unknown field:", field);
            }
        } else {
             console.log("SSE Parser: Ignoring malformed line or non-field line:", line);
        }
    }

    // Process the last event if the stream didn't end with a blank line
    if (currentEvent.data.length > 0 && !serverResponse) {
        const fullData = currentEvent.data.join('\n');
        console.log(`SSE Parser: Processing final event (type '${currentEvent.type}') after loop with data:\n${fullData}`);
        if (currentEvent.type === 'message' || !currentEvent.type) {
            try {
                const parsedData = JSON.parse(fullData);
                if (parsedData.id === targetRequestId && (parsedData.result || parsedData.error)) {
                    console.log("SSE Parser: Found target JSON-RPC response in final event:", parsedData);
                    serverResponse = parsedData;
                } else {
                     console.log("SSE Parser: Processed final event data, but not the target response. ID:", parsedData.id, "Expected ID:", targetRequestId);
                }
            } catch (e) {
                console.warn(`SSE Parser: Error parsing JSON from final event data: "${fullData}"`, e);
            }
        }
    }

    if (!serverResponse) {
        const errorMessage = `Target response with ID '${targetRequestId}' not found in SSE stream.`;
        console.error("SSE Parser:", errorMessage);
        return { serverResponse: null, error: errorMessage };
    }

    return { serverResponse, error: null };
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
        console.log(`Including mcp-session-id: ${session.mcpSessionId} in request to ${mcpServerUrl}`);
    } else {

        console.warn(`No mcpSessionId found for ${mcpServerUrl} in sendMcpRequest.`);
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
        let serverResponse = null;
        let foundResponse = false;

        // Check for SSE format before parsing
        if (responseText.includes('event: mes') || responseText.startsWith('data: ')) {
            // Handle SSE response
            const events = responseText.trim().split('\n\n');
            for (const event of events) {
                const lines = event.split('\n');
                let data = '';
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        data += line.substring(6) + '\n';
                    }
                }
                if (data) {
                    try {
                        const result = JSON.parse(data.trim());
                        if (result.id === requestPayload.id && (result.result !== undefined || result.error !== undefined)) {
                            serverResponse = result;
                            foundResponse = true;
                            console.log(`Found MCP response for ID ${requestPayload.id} in SSE data:`, serverResponse);
                            break; // break out of events loop
                        }
                    } catch (e) {
                        console.error('SSE parsing error', e);
                    }
                }
            }
        } else {
            // Handle standard JSON response
            try {
                const json = JSON.parse(responseText);
                if (json.id === requestPayload.id && (json.result !== undefined || json.error !== undefined)) {
                    serverResponse = json;
                    foundResponse = true;
                    console.log(`Found MCP response for ID ${requestPayload.id} in JSON response:`, serverResponse);
                }
            } catch (e) {
                console.error('JSON parsing error', e);
            }
        }

        if (!foundResponse || !serverResponse) {
            console.error(`MCP Request '${requestPayload.method}': Full SSE response text from ${mcpServerUrl} (ID: ${requestPayload.id}) when response was not found:\n${responseText}`);
            console.error(`MCP Request: Response for ID ${requestPayload.id} (method: ${requestPayload.method}) not found in SSE stream. Full response text:`, responseText);
            throw new Error(`MCP Request '${requestPayload.method}' to ${mcpServerUrl} (ID: ${requestPayload.id}) failed: Response not found in SSE stream.`);
        }

        // serverResponse is now the JSON-RPC object like {jsonrpc, id, result} or {jsonrpc, id, error}

        if (serverResponse.error) {
            console.error(`MCP Request error response (for id: ${requestPayload.id}):`, serverResponse.error);
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

// Enhanced validateConfig function
async function validateConfig() {
    console.log('Background: Validating configuration...');
    const storageData = await new Promise(resolve =>
        chrome.storage.local.get(['profiles', 'lastSelectedProfileId', 'defaultLlmEndpoint'], resolve)
    );

    const profiles = storageData.profiles || [];
    const lastSelectedProfileId = storageData.lastSelectedProfileId || 'default';
    const globalDefaultLlmEndpoint = storageData.defaultLlmEndpoint || '';

    const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId);
    const defaultProfile = profiles.find(p => p.id === 'default');

    const profileOptions = [
        { profile: selectedProfile, endpointOverride: null, name: `Selected Profile ('${selectedProfile?.name || lastSelectedProfileId}')` },
        { profile: selectedProfile, endpointOverride: globalDefaultLlmEndpoint, name: `Selected Profile ('${selectedProfile?.name || lastSelectedProfileId}') with Default Endpoint` },
        { profile: defaultProfile, endpointOverride: null, name: `Default Profile ('${defaultProfile?.name || 'default'}')` },
        { profile: defaultProfile, endpointOverride: globalDefaultLlmEndpoint, name: `Default Profile ('${defaultProfile?.name || 'default'}') with Default Endpoint` }
    ];

    for (const option of profileOptions) {
        const currentProfile = option.profile;
        const endpointToTest = option.endpointOverride || currentProfile?.llmEndpoint;

        if (!currentProfile) {
            // This profile doesn't exist (e.g. selectedProfile might be null if ID is stale)
            // Continue to the next option in the fallback chain.
            continue;
        }

        // Check if an endpoint is present for this specific option
        if (!endpointToTest) {
             // If this option relies on an endpoint that isn't set (e.g. profile has no endpoint AND no override)
            console.warn(`ValidateConfig: Endpoint not available for profile option: ${option.name}`);
            continue; // Try next profile option
        }

        if (!isValidURL(endpointToTest)) {
            console.warn(`ValidateConfig: Invalid endpoint URL '${endpointToTest}' for profile option: ${option.name}`);
            // An invalid URL for a specific profile's endpoint doesn't mean all hope is lost,
            // other profiles or the global default endpoint might still be valid.
            // However, if this is the *only* available endpoint, it will eventually fail.
            // We don't return error here yet, let the loop try other options.
            continue;
        }

        // At this point, endpointToTest is valid. Now check API key and model name for the currentProfile.
        if (!currentProfile.apiKey) {
            return {
                isValid: false,
                errorType: 'API_KEY_MISSING',
                message: `API key is missing for profile '${currentProfile.name || currentProfile.id}'. Please configure it in the options page.`,
                profileInUse: { ...currentProfile, llmEndpoint: endpointToTest } // Show what was being attempted
            };
        }
        if (!currentProfile.modelName) {
            return {
                isValid: false,
                errorType: 'MODEL_NAME_MISSING',
                message: `Model name is missing for profile '${currentProfile.name || currentProfile.id}'. Please configure it in the options page.`,
                profileInUse: { ...currentProfile, llmEndpoint: endpointToTest }
            };
        }

        // If all checks pass for this profile option
        const validConfig = { ...currentProfile, llmEndpoint: endpointToTest };
        console.log(`Background: Using configuration from profile: ${option.name}`);
        return { isValid: true, profileInUse: validConfig };
    }

    // If the loop finishes, no valid configuration was found.
    // Determine the most appropriate generic error.
    if (!globalDefaultLlmEndpoint && (!selectedProfile?.llmEndpoint && !defaultProfile?.llmEndpoint) ) {
         return {
            isValid: false,
            errorType: 'ENDPOINT_MISSING_OR_INVALID',
            message: 'No LLM API endpoint configured. Please set a default endpoint or configure one in a profile in the options page.',
            profileInUse: null
        };
    }

    // Check if any profiles exist at all
    if (profiles.length === 0) {
        return {
            isValid: false,
            errorType: 'NO_VALID_PROFILE_FOUND',
            message: 'No profiles configured. Please create a profile in the options page.',
            profileInUse: null
        };
    }

    // If endpoints exist but other parts of profiles are incomplete (e.g. API key/model on ALL tried profiles)
    // This is a more general fallback if specific API_KEY_MISSING or MODEL_NAME_MISSING wasn't hit for a chosen profile.
    return {
        isValid: false,
        errorType: 'PROFILE_INCOMPLETE',
        message: 'Configuration is incomplete. Ensure a selected profile has a valid endpoint, API key, and model name. Check options page.',
        profileInUse: selectedProfile || defaultProfile // Provide some context
    };
}

// Helper function to process API response and send messages to chat.js
async function _handleApiResponseAndSendMessage(responseMessage, prompt, tabId, isStartChatContext) {
    const sendMessageDelay = isStartChatContext ? 300 : 200; // Standardized delay based on original blocks

    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        console.log("Background: Received tool_calls from API, forwarding to chat.js", responseMessage.tool_calls);
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'handleToolCallResponse',
                responseMessage: responseMessage,
                prompt: prompt,
                tabId: tabId,
            }).catch(error => console.log(`Error sending handleToolCallResponse: ${error.message}, tabId: ${tabId}`));
        }, sendMessageDelay);
    } else if (responseMessage.content) {
        const latestResponse = responseMessage.content;
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: latestResponse,
                prompt: prompt,
                tabId: tabId,
            }).catch(error => console.log(`Error sending setApiResponse (content): ${error.message}, tabId: ${tabId}`));
        }, sendMessageDelay);
    } else {
        console.error("Background: API response message has neither content nor tool_calls:", responseMessage);
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: "Error: Received an empty or invalid response from the AI.",
                prompt: prompt,
                tabId: tabId,
            }).catch(error => console.log(`Error sending setApiResponse (error response): ${error.message}, tabId: ${tabId}`));
        }, sendMessageDelay);
    }
}

// Refactored function to make LLM API calls
async function makeLlmApiRequest(promptContent, tabId, { isStartChat = false, customInstructionToolChoice = 'none' } = {}) {
    let config, tools, enableStreaming;

    // Step 1: Validate configuration
    const validationResult = await validateConfig();

    if (!validationResult.isValid) {
        console.warn(`Background: Configuration validation failed. Type: ${validationResult.errorType}, Message: ${validationResult.message}`);
        chrome.runtime.sendMessage({
            action: 'displayErrorInChat', // Or 'setApiResponse' and handle 'isConfigurationError' in chat.js
            errorMessage: validationResult.message,
            errorType: validationResult.errorType,
            isConfigurationError: true,
            tabId: tabId,
            prompt: promptContent // Pass prompt content for context
        }).catch(e => console.error("Background: Error sending configuration error message to chat:", e));
        return; // Stop further execution
    }

    config = validationResult.profileInUse; // Use the validated and selected profile config

    // Step 2: Get tool definitions and streaming preference (can proceed as config is valid)
    try {
        const results = await Promise.all([
            // validateConfig() is already done
            getAllToolDefinitions(),
            new Promise(resolve => chrome.storage.sync.get({ enableStreaming: false }, data => resolve(data.enableStreaming)))
        ]);
        tools = results[0];
        enableStreaming = results[1];
    } catch (error) {
        // This catch is for errors in getAllToolDefinitions or getting enableStreaming setting
        console.error('Background: Error fetching tool definitions or streaming settings:', error);
        chrome.runtime.sendMessage({
            action: 'displayErrorInChat',
            errorMessage: `Error fetching extension settings: ${error.message}`,
            isConfigurationError: false, // This is a runtime error, not config
            tabId: tabId,
            prompt: promptContent
        }).catch(e => console.error("Background: Error sending settings fetch error message:", e));
        return;
    }

    try {
        // The rest of the makeLlmApiRequest function proceeds from here...
        // Ensure 'config' is used consistently as it's now sourced from validationResult.profileInUse
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

        const messages = [];
        if (config.systemPrompt && config.systemPrompt.trim() !== '') {
            messages.push({ role: 'system', content: config.systemPrompt });
        }
        messages.push({ role: 'user', content: promptContent });

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
            ...toolChoicePayload // Spread the tools and tool_choice if they exist
        };
        
        if (enableStreaming) {
            apiRequestBody.stream = true;
        }

        console.log("Background: API Request Body (Refactored):", JSON.stringify(apiRequestBody, null, 2));

        const apiResponse = await fetch(config.llmEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
            },
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
                // console.log("Background: Stream raw buffer update:", buffer);

                let eventBoundaryIndex;
                while ((eventBoundaryIndex = buffer.indexOf('\n\n')) !== -1) {
                    const eventMessages = buffer.substring(0, eventBoundaryIndex);
                    buffer = buffer.substring(eventBoundaryIndex + 2); // +2 for '\n\n'

                    const lines = eventMessages.split('\n');
                    let eventData = [];
                    // let eventType = 'message'; // Default type, though LLM streams might not use 'event:' lines often

                    for (const line of lines) {
                        if (line.startsWith(':')) { // Comment
                            console.log("Background SSE Stream: Ignoring comment:", line);
                            continue;
                        }
                        if (line.startsWith('data:')) {
                            eventData.push(line.substring(5).trim());
                        }
                        // Add handling for 'event:', 'id:', 'retry:' if needed for this specific LLM stream,
                        // but typically they just send data lines.
                        // Example: if (line.startsWith('event:')) eventType = line.substring(6).trim();
                    }

                    if (eventData.length > 0) {
                        const fullPayload = eventData.join(''); // For LLM streams, data is often a single JSON object, possibly split, not multiple distinct JSONs in one event.
                                                              // If data lines were meant to be concatenated as strings and then parsed, it would be eventData.join('\n')

                        console.log("Background SSE Stream: Complete event data payload:", fullPayload);

                        if (fullPayload === '[DONE]') {
                            console.log("Background SSE Stream: Received [DONE] signal.");
                            // The main loop will handle streamApiEnd when done is true.
                            // We just need to make sure not to process [DONE] as JSON.
                            continue; // Skip JSON parsing for [DONE]
                        }

                        try {
                            const parsed = JSON.parse(fullPayload);
                            if (parsed.choices && parsed.choices.length > 0 && parsed.choices[0].delta) {
                                const delta = parsed.choices[0].delta;
                                const contentChunk = delta.content;
                                const toolCallChunk = delta.tool_calls;

                                if (contentChunk) {
                                    chrome.runtime.sendMessage({
                                        action: 'streamApiResponseChunk',
                                        chunk: contentChunk,
                                        tabId: tabId,
                                        prompt: promptContent
                                    }).catch(error => console.error(`Error sending streamApiResponseChunk: ${error.message}, tabId: ${tabId}`));
                                }

                                if (toolCallChunk && toolCallChunk.length > 0) { // Ensure toolCallChunk is not empty
                                    console.log("Background SSE Stream: Received tool_call delta:", JSON.stringify(toolCallChunk));
                                    chrome.runtime.sendMessage({
                                        action: 'streamApiToolCallChunk',
                                        toolCallChunk: toolCallChunk,
                                        tabId: tabId,
                                        prompt: promptContent
                                    }).catch(error => console.error(`Error sending streamApiToolCallChunk: ${error.message}, tabId: ${tabId}`));
                                }
                            } else {
                                console.warn("Background SSE Stream: Parsed JSON, but no choices[0].delta found. Payload:", parsed);
                            }
                        } catch (e) {
                            console.error("Background SSE Stream: Error parsing JSON from event data:", e, "Problematic payload:", fullPayload);
                        }
                    }
                }
            }
            // After the loop, if 'buffer' still contains data, it's an incomplete event.
            // It will be processed in the next iteration when more data arrives, or discarded if the stream ends.
            // No special handling needed here for the remainder in 'buffer' because the stream ending (done=true)
            // is the ultimate terminator.

        } else { // Non-streaming path
            const responseData = await apiResponse.json();

            if (!responseData || !responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
                if (!(responseData.choices && responseData.choices[0] && responseData.choices[0].message && responseData.choices[0].message.tool_calls)) {
                    throw new Error('Invalid response format from API: Missing message content or tool_calls.');
                }
            }
            await _handleApiResponseAndSendMessage(responseData.choices[0].message, promptContent, tabId, isStartChat);
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
async function callUserDefinedEndpoint(endpointUrl, args, userDefinedMethod, originalToolName = null, mcpProxyUrlBase = null) {
    let callType = "Direct HTTP Webhook";
    if (mcpProxyUrlBase) {
        callType = "MCP Proxy Call via HTTP Webhook";
    }
    console.log(`Background: ${callType} - Initializing for tool '${originalToolName || 'N/A'}'. Endpoint/Path: ${endpointUrl}, Args:`, args);

    try {
        let finalEndpointUrl = endpointUrl;
        let finalFetchOptions = {
            headers: {
                'Accept': 'application/json'
            }
        };
        let bodyForLogging = null; // For safe logging

        if (mcpProxyUrlBase) { // MCP Proxy Call
            if (!isValidURL(mcpProxyUrlBase)) { // Should be validated before, but good for safety
                throw new Error(`Invalid MCP Proxy URL Base: ${mcpProxyUrlBase}`);
            }
            try {
                finalEndpointUrl = new URL(endpointUrl, mcpProxyUrlBase).href;
                console.log(`Background: ${callType} - Constructed proxy URL: ${finalEndpointUrl}`);
            } catch (e) {
                console.error(`Background: ${callType} - Error constructing MCP proxy URL from base '${mcpProxyUrlBase}' and path '${endpointUrl}':`, e);
                throw new Error(`Invalid MCP Proxy URL configuration: ${e.message}`);
            }

            finalFetchOptions.method = 'POST';
            finalFetchOptions.headers['Content-Type'] = 'application/json';
            const proxyPayload = { tool_name: originalToolName, arguments: args };
            finalFetchOptions.body = JSON.stringify(proxyPayload);
            bodyForLogging = proxyPayload; // Safe to log this structured payload
            console.log(`Background: ${callType} - Method: POST, Payload:`, bodyForLogging);

        } else { // Direct HTTP Webhook
            const isEmptyArgs = !args || Object.keys(args).length === 0;
            let method = userDefinedMethod || (isEmptyArgs ? 'GET' : 'POST');
            method = method.toUpperCase();
            finalFetchOptions.method = method;
            console.log(`Background: ${callType} - Method: ${method} (User defined: ${userDefinedMethod || 'Auto'})`);

            if (method === 'GET' && !isEmptyArgs) {
                const queryParams = new URLSearchParams(args).toString();
                finalEndpointUrl = `${finalEndpointUrl}?${queryParams}`;
                console.log(`Background: ${callType} - Appended query params for GET request: ${queryParams}`);
            } else if (['POST', 'PUT', 'PATCH'].includes(method) && !isEmptyArgs) {
                finalFetchOptions.headers['Content-Type'] = 'application/json';
                finalFetchOptions.body = JSON.stringify(args);
                // Consider what is safe to log from 'args' if it can be very large or sensitive.
                // For now, we'll log it, assuming typical tool arguments are not overly sensitive.
                bodyForLogging = args;
            }
             // For DELETE, body is typically empty. If args are used, they'd be in URL path (tool definition's responsibility).
        }
        
        console.log(`Background: ${callType} - Fetching. URL: ${finalEndpointUrl}, Options:`, { method: finalFetchOptions.method, headers: finalFetchOptions.headers, body: bodyForLogging /* Log controlled body */ });

        const response = await fetch(finalEndpointUrl, finalFetchOptions);

        console.log(`Background: ${callType} - Response Status: ${response.status}`);
        if (!response.ok) {
            let errorBody = '';
            try {
                errorBody = await response.text();
                console.error(`Background: ${callType} - Error response body:`, errorBody);
            } catch (e) {
                console.error(`Background: ${callType} - Could not read error response body:`, e);
            }
            throw new Error(`HTTP error ${response.status}: ${response.statusText}. ${errorBody}`.trim());
        }

        const contentType = response.headers.get('content-type');
        let responseData;
        if (contentType && contentType.includes('application/json')) {
            responseData = await response.json();
            console.log(`Background: ${callType} - Parsed JSON response.`);
        } else {
            responseData = await response.text();
            console.log(`Background: ${callType} - Received text response.`);
        }
        return responseData;

    } catch (error) {
        // Catch both network errors from fetch() and explicitly thrown errors (e.g., HTTP error)
        console.error(`Background: ${callType} - Error during endpoint call to ${endpointUrl || mcpProxyUrlBase}:`, error.message);
        // Rethrow a new error to ensure consistent error structure for the caller,
        // or just rethrow if the caught error is already well-structured.
        // For now, rethrowing a slightly more specific message.
        throw new Error(`Failed to call ${callType} endpoint (${endpointUrl}): ${error.message}`);
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
        const { id, name, arguments: argsString } = request.toolCall; // 'id' here is the LLM tool_call_id
        console.log(`Background: Received 'executePromptPaulTool'. Tool Name: '${name}', Tool Call ID: '${id}', Raw Arguments: '${argsString}'`);

        (async () => {
            let result, errorMsg;
            try {
                const allTools = await getAllToolDefinitions();
                const toolDefinition = allTools.find(t => t.name === name);

                if (!toolDefinition) {
                    throw new Error(`Tool definition for '${name}' not found in local storage.`);
                }

                let argsObject;
                try {
                    argsObject = JSON.parse(argsString || '{}');
                    console.log(`Background: Parsed arguments for tool '${name}':`, argsObject);
                } catch (parseError) {
                    throw new Error(`Invalid arguments format for tool '${name}'. Expected JSON. Received: ${argsString}. Parse Error: ${parseError.message}`);
                }

                if (toolDefinition.mcpServerUrl && toolDefinition.mcpServerUrl.trim() !== "") {
                    // MCP Tool Execution Path
                    if (toolDefinition.endpointUrl) {
                        console.warn(`Background: Tool '${name}' has both mcpServerUrl and endpointUrl defined. Prioritizing mcpServerUrl.`);
                    }
                    console.log(`Background: Executing '${name}' as DIRECT MCP Tool. MCP Server: ${toolDefinition.mcpServerUrl}`);

                    const session = await getMcpSession(toolDefinition.mcpServerUrl);
                    if (!session || !session.initialized) {
                        throw new Error(`MCP session could not be initialized for ${toolDefinition.mcpServerUrl}.`);
                    }

                    const serverTools = session.tools; // Already fetched during initializeMcpSession
                    if (!Array.isArray(serverTools) || !serverTools.some(t => t.name === name)) {
                        console.warn(`Background: Tool '${name}' not listed in server capabilities from ${toolDefinition.mcpServerUrl}. Server tools:`, serverTools);
                        throw new Error(`MCP server at ${toolDefinition.mcpServerUrl} does not list tool '${name}'.`);
                    }

                    const mcpRequestId = `mcp-tc-${Date.now()}`;
                    const mcpPayload = createMcpToolCallPayload(name, argsObject, mcpRequestId); // Use 'name' from request, not definition.name
                    console.log(`Background: Sending MCP 'tools/call' request for '${name}' to ${toolDefinition.mcpServerUrl}. Payload:`, JSON.stringify(mcpPayload, null, 2));

                    const mcpResponse = await sendMcpRequest(toolDefinition.mcpServerUrl, mcpPayload);
                    console.log(`Background: Received MCP 'tools/call' response for '${name}':`, JSON.stringify(mcpResponse, null, 2));

                    // Standard MCP tools/call response has the actual tool output in mcpResponse.result.content
                    if (mcpResponse.result && mcpResponse.result.content !== undefined) {
                        result = mcpResponse.result; // Keep the structure { content: "...", isError: ... }
                    } else {
                        // This case might indicate an issue with the MCP server's response format or the tool itself
                        console.warn(`Background: MCP tool response for '${name}' is missing 'result.content'. Response:`, mcpResponse);
                        result = mcpResponse.result; // Pass through the result as is, caller might expect it
                    }

                } else if (toolDefinition.endpointUrl) { // HTTP Webhook (Direct or MCP Proxy)
                    // The mcpProxyUrlBase is part of the toolDefinition if this endpointUrl is for an MCP Proxy
                    const mcpProxyUrlBase = toolDefinition.mcpProxyUrlBase || null;
                    const executionType = mcpProxyUrlBase ? "MCP PROXY HTTP Webhook" : "DIRECT HTTP Webhook";
                    console.log(`Background: Executing '${name}' as ${executionType}. Endpoint URL/Path: ${toolDefinition.endpointUrl}`);

                    result = await callUserDefinedEndpoint(
                        toolDefinition.endpointUrl,
                        argsObject,
                        toolDefinition.httpMethod,
                        name, // originalToolName for MCP Proxy
                        mcpProxyUrlBase
                    );
                    console.log(`Background: ${executionType} tool '${name}' executed. Result:`, result);

                } else { // Built-in JS tool (fallback)
                    console.log(`Background: Executing '${name}' as BUILT-IN JS Tool.`);
                    const builtInFunction = toolImplementations[name];
                    if (builtInFunction && typeof builtInFunction === 'function') {
                        result = await builtInFunction(argsObject);
                        console.log(`Background: Built-in JS tool '${name}' executed. Result:`, result);
                    } else {
                        throw new Error(`Tool '${name}' is not configured for MCP, HTTP Webhook, and no built-in JS implementation found.`);
                    }
                }

                console.log(`Background: Tool '${name}' execution successful. Final result to send:`, result);
                sendResponse({ result: result });

            } catch (error) {
                console.error(`Background: Error processing tool '${name}' in 'executePromptPaulTool':`, error.message, error.stack);
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
    }
    // Handle other actions if any
});
console.log("Background: onMessage listener function HAS BEEN registered.");
