// ===== API Client Module - LLM API calls =====
import { trackInstructionUsed, trackErrorEvent } from './analytics.js';

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

// Helper function to get all tool definitions from storage
async function getAllToolDefinitions() {
  const localTools = await new Promise((resolve) => {
    chrome.storage.local.get(['promptPaulTools'], (result) => {
      resolve(result.promptPaulTools || []);
    });
  });
  return localTools;
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

    const messages = [];
    const now = new Date();
    const dateTimeString = `Date: ${now.toLocaleDateString()} Time: ${now.toLocaleTimeString()}`;
    let systemPromptContent = dateTimeString;
    if (config.systemPrompt && config.systemPrompt.trim() !== '') {
      systemPromptContent += `\n\n${config.systemPrompt}`;
    }
    messages.push({ role: 'system', content: systemPromptContent });
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
        usingAnthropicMcpConnectorGlobal = true; // Fix: Set global variable for streaming
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

    if (enableStreaming && !usingAnthropicMcpConnector) {
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
    try {
      const cat = error?.message?.includes('API request failed') ? 'api_error' : 'network';
      const code = (error?.message || 'error').slice(0, 64);
      await trackErrorEvent(cat, code);
    } catch (_) {}
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

export {
  validateConfig,
  makeLlmApiRequest,
  getAllToolDefinitions,
  _handleApiResponseAndSendMessage
};