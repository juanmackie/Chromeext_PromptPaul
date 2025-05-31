console.log('Background service worker script started.');

let tabPendingInitializationData = {}; // Stores data for chat.js initialization requests

// --- cURL Parsing and Saving ---

/**
 * Basic function to parse a cURL command string into a tool definition object.
 * Handles URL, method (-X), headers (-H), and data (-d, --data).
 * @param {string} curlCommand - The cURL command string.
 * @returns {object} A tool definition object.
 * @throws {Error} If the command is invalid or essential parts are missing.
 */
function parseCurlCommand(curlCommand) {
  const tool = {
    id: 'tool_' + Date.now(), // Add a unique ID for the tool
    name: 'Generated Tool ' + Date.now(), // Basic name, could be improved
    description: 'Generated from cURL command',
    parameters: '{}', // Default empty parameters
    endpointUrl: '',
    httpMethod: 'GET', // Default method
  };

  // Basic parsing - this is a simplified approach
  const parts = curlCommand.split(/\s+/); // Split by whitespace

  let i = 0;
  while (i < parts.length) {
    const part = parts[i];

    if (part.startsWith('http://') || part.startsWith('https://')) {
      tool.endpointUrl = part;
    } else if (part === '-X' && i + 1 < parts.length) {
      tool.httpMethod = parts[i + 1].toUpperCase();
      i++; // Consume the next part (the method)
    } else if (part === '-H' && i + 1 < parts.length) {
      const header = parts[i + 1];
      const separatorIndex = header.indexOf(':');
      if (separatorIndex > 0) {
        const headerName = header.substring(0, separatorIndex).trim();
        const headerValue = header.substring(separatorIndex + 1).trim();
        // Note: This basic parser doesn't handle complex headers or multiple headers well.
        // For simplicity, we'll just note the first header found or could build a headers object.
        // For now, we won't store headers in the basic tool definition structure.
        // A more advanced parser would be needed for full header support.
      }
      i++; // Consume the next part (the header string)
    } else if ((part === '-d' || part === '--data') && i + 1 < parts.length) {
      // Assuming the data is the next part. This is very basic and won't handle JSON with spaces etc.
      // A real parser would need to handle quoted strings properly.
      const data = parts[i + 1];
      // For simplicity, we'll store the data as the body.
      // A more advanced parser might try to infer parameters from JSON data.
      tool.parameters = JSON.stringify({ body: { type: 'string', description: 'Request body' } }); // Indicate body parameter
      tool.requestBody = data; // Store the raw body data (not part of standard tool schema, but useful)
      tool.httpMethod = tool.httpMethod === 'GET' ? 'POST' : tool.httpMethod; // Assume POST if data is present and method was GET
      i++; // Consume the next part (the data string)
    }
    // Add more parsing logic here for other curl options if needed

    i++;
  }

  if (!tool.endpointUrl) {
    throw new Error('cURL command must include a URL.');
  }

  // Clean up the generated name if it's just the timestamp default
  if (tool.name.startsWith('Generated Tool ')) {
      const urlParts = tool.endpointUrl.split('/');
      const simpleName = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2] || 'Endpoint';
      tool.name = `curl_${simpleName.replace(/[^a-zA-Z0-9_]/g, '')}_${Date.now()}`;
  }


  console.log('Background: Parsed tool definition:', tool);
  return tool;
}

/**
 * Saves a tool definition to chrome.storage.local.
 * @param {object} tool - The tool definition object.
 * @returns {Promise<void>} A promise that resolves when saving is complete.
 */
async function saveToolDefinition(tool) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['promptPaulTools'], (result) => {
      const tools = result.promptPaulTools || [];
      tools.push(tool); // Add the new tool
      chrome.storage.local.set({ promptPaulTools: tools }, () => {
        if (chrome.runtime.lastError) {
          console.error('Background: Error saving tool definition:', chrome.runtime.lastError);
          reject(new Error('Failed to save tool definition.'));
        } else {
          console.log('Background: Tool definition saved successfully.');
          // Optionally, update context menus here if tools affect them
          // updateContextMenus(); // Assuming this function exists and updates tool menus
          resolve();
        }
      });
    });
  });
}

// --- End cURL Parsing and Saving ---

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




  // Stash minimal data for chat.js to request if it's a fresh load for this tab's side panel
  // If chat.js is already loaded and active for this tab, it won't re-request.
  // This ensures if the panel is enabled for a tab, and then user navigates away and back,
  // or if browser starts with this tab active and panel set to open, it can init.
  if (!tabPendingInitializationData[tabId]) { // Only if not already set by a very recent context click
      tabPendingInitializationData[tabId] = {
          tabId: tabId,
          isTabActivation: true
      };
      console.log(`Background: Stashed init data for tab activation: ${tabId}`, tabPendingInitializationData[tabId]);
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Single side panel open call at start of user gesture
  await chrome.sidePanel.open({ tabId: tab.id });

  // For any action that isn't just opening options page:
  if (info.menuItemId !== 'manageInstructions') {
      tabPendingInitializationData[tab.id] = {
          tabId: tab.id,
          // If it's a start_chat or a direct command, signal to clear history potentially
          // This will be handled by chat.js when it processes the subsequent specific command.
          // For now, initChat just means "load your history if any".
          // The specific command messages will dictate clearing.
          // So, this data is minimal:
          isNewInteraction: true // A generic flag
      };
      console.log(`Background: Stashed init data for context menu click on tab ${tab.id}:`, tabPendingInitializationData[tab.id]);
  }
  // The existing setSelectedText and makeLlmApiRequest calls will proceed as they were.
  // The initChat that chat.js requests will primarily load history.

  const selectedText = info.selectionText;

  // Handle manage instructions click
  if (info.menuItemId === 'manageInstructions') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    return;
  }

  // Handle one-off instruction click with proper sequencing
  if (info.menuItemId === 'oneoff_instruction') {
    // Ensure panel is fully opened before sending message.
    // TODO: Consider a more robust handshake mechanism with chat.js to confirm readiness.
    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: 'setSelectedText',
        selectedText: selectedText,
        tabId: tab.id
      });
    }, 100);
    return;
  }

  // Handle start chat click - Open side panel immediately
  if (info.menuItemId === 'start_chat') {
    // Send message to chat.js with selected text
    chrome.runtime.sendMessage({
      action: 'setSelectedText',
      selectedText: selectedText,
      tabId: tab.id,
      fromStartChat: true // Flag to indicate this is from the start_chat option
    });
    
    // Call the refactored API request function
    await makeLlmApiRequest(selectedText, tab.id, { isStartChat: true });
    return;
  }

  let prompt = '';
  let instructionToolChoice = 'none'; // Default tool choice
  if (info.menuItemId.startsWith('custom_')) {
    // Handle custom instruction
    const instructionId = info.menuItemId.replace('custom_', '');
    const { instructions } = await chrome.storage.local.get(['instructions']);
    const instruction = instructions.find(i => i.id === instructionId);
    if (instruction) {
      prompt = `${instruction.content}\n\n${selectedText}`;
      instructionToolChoice = instruction.tool_choice || 'none'; // Get tool_choice, default to 'none'
    } else {
      // Keep default prompt (selectedText) and toolChoice ('none') if instruction not found
      console.error(`Custom instruction with ID ${instructionId} not found.`);
      prompt = selectedText; // Fallback to just using selected text
      // Optionally, send an error message back to the user via chat.js
      // chrome.runtime.sendMessage({...});
    }
  } else {
    // Handle predefined commands
    switch (info.menuItemId) {
      case 'summarize':
        prompt = `Please summarize the following text into a bullet list of points:\n${selectedText}`;
        break;
      case 'explain':
        prompt = `Explain this to me in a short concise MECE approach:\n${selectedText}`;
        break;
      case 'polish':
        prompt = `Polish this text with clarity and purpose:\n${selectedText}`;
        break;
      case 'shorten':
        prompt = `shorten this text without losing its meaning and context:\n${selectedText}`;
        break;
      case 'formal':
        prompt = `Make this text more formal and eloquent:\n${selectedText}`;
        break;
      case 'casual':
        prompt = `Make this text more casual and fun:\n${selectedText}`;
        break;
      case 'analyze':
        prompt = `Please analyze the following text:\n${selectedText}`;
        break;
      default:
        prompt = selectedText;
    }
  }

  // Call the refactored API request function
  await makeLlmApiRequest(prompt, tab.id, { customInstructionToolChoice: instructionToolChoice });
});

// Listen for messages from the options page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'createToolFromCurl') {
    console.log('Background: Received createToolFromCurl message:', request.curl);
    try {
      console.log('Background: Attempting to parse cURL command.'); // Added log
      const toolDefinition = parseCurlCommand(request.curl);
      console.log('Background: cURL command parsed successfully.', toolDefinition); // Added log
      saveToolDefinition(toolDefinition).then(() => {
        console.log('Background: Tool definition saved successfully, sending success response.'); // Added log
        sendResponse({ success: true });
      }).catch(error => {
        console.error('Background: Error saving tool definition:', error); // Added log
        sendResponse({ success: false, error: error.message });
      });
    } catch (error) {
      console.error('Background: Error parsing cURL command:', error); // Added log
      sendResponse({ success: false, error: error.message });
    }
    return true; // Indicate that the response will be sent asynchronously
  }
});


/**
 * Validates and retrieves API configuration for background service worker operations.
 * Ensures that a valid profile (active or default) is available before making API calls.
 * Does not use an in-memory cache as service worker invocations can be short-lived;
 * always fetches from `chrome.storage.local` for up-to-date settings.
 */
async function validateConfig() {
  return new Promise((resolve, reject) => {
    console.log('Background: Validating configuration...');
    chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
      console.log('Background: Storage get result:', result);
      const profiles = result.profiles || [];
      const lastSelectedProfileId = result.lastSelectedProfileId || 'default';

      console.log('Background: Profiles:', profiles);
      console.log('Background: Last selected profile ID:', lastSelectedProfileId);

      const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId);

      if (!selectedProfile || !selectedProfile.llmEndpoint || !selectedProfile.apiKey || !selectedProfile.modelName) {
        console.warn('Background: Selected profile is missing or incomplete');
        // Fallback or error if selected profile is incomplete or not found
        // As a fallback, try to find the default profile
        const defaultProfile = profiles.find(p => p.id === 'default');
        if (defaultProfile && defaultProfile.llmEndpoint && defaultProfile.apiKey && defaultProfile.modelName) {
           console.warn(`Background: Selected profile '${lastSelectedProfileId}' incomplete or not found, using default profile.`);
           resolve(defaultProfile);
        } else {
           console.error('Background: Default profile is also incomplete or missing');
           // If even default is incomplete, reject
           reject(
             new Error(
               'Configuration is incomplete. Please set up the API endpoint, API key, and model name in the options page.'
             )
           );
        }
      } else {
        console.log(`Background: Using configuration from profile: ${selectedProfile.name || selectedProfile.id}`);
        console.log('Background: Configuration:', {
          endpoint: selectedProfile.llmEndpoint,
          key: selectedProfile.apiKey ? '********' + selectedProfile.apiKey.slice(-4) : 'Not set',
          model: selectedProfile.modelName
        });
        resolve(selectedProfile);
      }
    });
  });
}

// Refactored function to make LLM API calls
async function makeLlmApiRequest(promptContent, tabId, { isStartChat = false, customInstructionToolChoice = 'none' } = {}) {
    try {
        const config = await validateConfig();
        const tools = await getAllToolDefinitions();

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

        console.log('Background: Streaming API call. Tools sent to API:', formattedTools);

        let toolChoicePayload = {};
        let finalToolChoice = customInstructionToolChoice;

        if (Array.isArray(finalToolChoice)) {
            if (finalToolChoice.length === 0 || (finalToolChoice.length === 1 && finalToolChoice[0] === 'none')) {
                finalToolChoice = 'none';
            } else if (finalToolChoice.includes('auto')) {
                 finalToolChoice = 'auto';
            }
        } else if (finalToolChoice === undefined) {
            finalToolChoice = 'none';
        }

        if (finalToolChoice === 'none') {
            toolChoicePayload = {};
        } else if (finalToolChoice === 'auto') {
            if (formattedTools.length > 0) {
                toolChoicePayload = { tools: formattedTools, tool_choice: "auto" };
            } else {
                toolChoicePayload = {};
            }
        } else if (Array.isArray(finalToolChoice)) {
            const selectedToolNames = finalToolChoice;
            const selectedFormattedTools = formattedTools.filter(tool => selectedToolNames.includes(tool.function.name));

            if (selectedFormattedTools.length > 0) {
                 let specificToolChoiceFormat;
                 if (selectedFormattedTools.length === 1) {
                     specificToolChoiceFormat = { type: 'function', function: { name: selectedFormattedTools[0].function.name } };
                 } else {
                     specificToolChoiceFormat = selectedFormattedTools.map(tool => ({ type: 'function', function: { name: tool.function.name } }));
                 }
                 toolChoicePayload = { tools: selectedFormattedTools, tool_choice: specificToolChoiceFormat };
            } else {
                toolChoicePayload = {};
            }
        } else {
            console.warn(`Background: Unexpected tool choice value: ${finalToolChoice}. Treating as 'none'.`);
            toolChoicePayload = {};
        }

        const apiRequestBody = {
            model: config.modelName,
            messages: messages,
            max_tokens: parseInt(config.maxTokens) || 2048,
            stream: true, // Enable streaming
            ...toolChoicePayload
        };
        
        console.log("Background: API Request Body (Streaming):", JSON.stringify(apiRequestBody, null, 2));

        const apiResponse = await fetch(config.llmEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(apiRequestBody),
        });

        if (!apiResponse.ok) {
            const errorData = await apiResponse.json().catch(() => null); // Try to parse error JSON
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: `API request failed: ${apiResponse.status} ${apiResponse.statusText}${errorData ? ` - ${JSON.stringify(errorData)}` : ''}`,
                streamState: 'error',
                prompt: promptContent,
                tabId: tabId,
                streamId: streamId // Include streamId in error message if fetch fails early
            });
            return; // Exit early on fetch error
        }

        const reader = apiResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let isFirstChunk = true;
        let accumulatedToolCallJson = ''; // For assembling multi-chunk tool calls if needed
        let activeToolCallInfo = null; // Stores { id, name, arguments } for the current tool call
        const streamId = `stream-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                console.log("Background: Stream finished.");
                // If there was an unterminated tool call being assembled, handle it as an error or incomplete.
                if (activeToolCallInfo) {
                    console.warn("Background: Stream ended with an incomplete tool call:", activeToolCallInfo);
                     chrome.runtime.sendMessage({
                        action: 'setApiResponse',
                        apiResponse: "Error: Stream ended with incomplete tool call data.",
                        streamState: 'error',
                        prompt: promptContent,
                        tabId: tabId,
                        streamId: streamId
                    });
                } else {
                    // Send end message only if not already handled by [DONE] or error
                     chrome.runtime.sendMessage({
                        action: 'setApiResponse',
                        apiResponse: '',
                        streamState: 'end',
                        tabId: tabId,
                        streamId: streamId
                    });
                }
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep the last (potentially incomplete) line in the buffer

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataContent = line.substring(5).trim();
                    if (dataContent === '[DONE]') {
                        console.log("Background: Stream indicated completion with [DONE].");
                        if (activeToolCallInfo && accumulatedToolCallJson) {
                             // This case implies [DONE] arrived while a tool call was being assembled.
                             // This is unusual for OpenAI but we should try to finalize it.
                            try {
                                const parsedArgs = JSON.parse(accumulatedToolCallJson);
                                activeToolCallInfo.arguments = parsedArgs; // Arguments are now complete
                                chrome.runtime.sendMessage({
                                    action: 'handleToolCallResponse',
                                    responseMessage: { tool_calls: [activeToolCallInfo] },
                                    prompt: promptContent,
                                    tabId: tabId,
                                    streamState: 'tool_call_end', // Indicate this is the end of a tool call stream
                                    streamId: streamId
                                });
                            } catch (e) {
                                console.error("Background: Error parsing accumulated tool call JSON before [DONE]:", e, accumulatedToolCallJson);
                                chrome.runtime.sendMessage({
                                    action: 'setApiResponse',
                                    apiResponse: `Error parsing tool call arguments: ${e.message}`,
                                    streamState: 'error',
                                    prompt: promptContent,
                                    tabId: tabId,
                                    streamId: streamId
                                });
                            }
                            activeToolCallInfo = null;
                            accumulatedToolCallJson = '';
                        }
                        chrome.runtime.sendMessage({
                            action: 'setApiResponse',
                            apiResponse: '',
                            streamState: 'end',
                            tabId: tabId,
                            streamId: streamId
                        });
                        return; // Exit makeLlmApiRequest as stream is done.
                    }

                    try {
                        const chunk = JSON.parse(dataContent);
                        if (chunk.choices && chunk.choices[0]) {
                            const delta = chunk.choices[0].delta;
                            const finishReason = chunk.choices[0].finish_reason;

                            if (delta && delta.content) {
                                if (isFirstChunk) {
                                    chrome.runtime.sendMessage({
                                        action: 'setApiResponse',
                                        apiResponse: delta.content,
                                        streamState: 'start',
                                        prompt: promptContent,
                                        tabId: tabId,
                                        streamId: streamId
                                    });
                                    isFirstChunk = false;
                                } else {
                                    chrome.runtime.sendMessage({
                                        action: 'setApiResponse',
                                        apiResponse: delta.content,
                                        streamState: 'continue',
                                        tabId: tabId,
                                        streamId: streamId
                                    });
                                }
                            } else if (delta && delta.tool_calls) {
                                // Handle streaming tool calls
                                const toolCallChunk = delta.tool_calls[0]; // Assuming one tool call per delta for now

                                if (toolCallChunk.id) { // Start of a new tool call
                                    if (activeToolCallInfo && accumulatedToolCallJson) {
                                        // This means a new tool call started before the previous one's arguments finished.
                                        // This is unlikely with current OpenAI models but good to be aware of.
                                        // For now, we'll assume one tool call's arguments stream completely before another starts.
                                        console.warn("Background: New tool call started before previous arguments finished. Previous:", activeToolCallInfo.name);
                                        // Optionally send the previously accumulated one if it's parsable, or handle error.
                                    }
                                    activeToolCallInfo = { id: toolCallChunk.id, name: toolCallChunk.function.name, arguments: '' };
                                    accumulatedToolCallJson = toolCallChunk.function.arguments || ''; // Start accumulating arguments
                                } else if (activeToolCallInfo && toolCallChunk.function && toolCallChunk.function.arguments) {
                                    // Continuation of arguments for the current tool call
                                    accumulatedToolCallJson += toolCallChunk.function.arguments;
                                }
                                // Send a message to chat.js that a tool call is starting/streaming
                                // chat.js might display "Thinking about using tool X..."
                                chrome.runtime.sendMessage({
                                    action: 'setApiResponse', // Or a new action like 'toolCallStream'
                                    toolCallInfo: { name: activeToolCallInfo.name, id: activeToolCallInfo.id, partialArguments: accumulatedToolCallJson },
                                    streamState: 'tool_call_start', // Or 'tool_call_delta'
                                    prompt: promptContent,
                                    tabId: tabId,
                                    streamId: streamId
                                });


                            } else if (finishReason === 'tool_calls' || (chunk.choices[0].message && chunk.choices[0].message.tool_calls)) {
                                // This indicates the full tool call object might be present or it's the end of a tool call stream.
                                if (activeToolCallInfo && accumulatedToolCallJson) {
                                     try {
                                        const parsedArgs = JSON.parse(accumulatedToolCallJson);
                                        const completeToolCall = {
                                            id: activeToolCallInfo.id,
                                            type: 'function', // OpenAI specific
                                            function: {
                                                name: activeToolCallInfo.name,
                                                arguments: JSON.stringify(parsedArgs) // Ensure arguments are stringified for the final message
                                            }
                                        };
                                        console.log("Background: Sending complete tool call to chat.js:", completeToolCall);
                                        chrome.runtime.sendMessage({
                                            action: 'handleToolCallResponse', // Use existing action for complete tool calls
                                            responseMessage: { tool_calls: [completeToolCall] },
                                            prompt: promptContent,
                                            tabId: tabId,
                                            streamId: streamId // Pass streamId along
                                            // streamState: 'tool_call_end' // Can add this if chat.js needs to differentiate
                                        });
                                    } catch (e) {
                                        console.error("Background: Error parsing accumulated tool call JSON:", e, accumulatedToolCallJson);
                                        chrome.runtime.sendMessage({
                                            action: 'setApiResponse',
                                            apiResponse: `Error parsing tool call arguments: ${e.message}`,
                                            streamState: 'error',
                                            prompt: promptContent,
                                            tabId: tabId,
                                            streamId: streamId
                                        });
                                    }
                                    activeToolCallInfo = null;
                                    accumulatedToolCallJson = '';
                                } else if (chunk.choices[0].message && chunk.choices[0].message.tool_calls) {
                                    // Handle non-streamed tool calls that might arrive in a stream-enabled response
                                    // This can happen if the model decides to call a tool immediately.
                                    const toolCalls = chunk.choices[0].message.tool_calls;
                                    console.log("Background: Received non-streamed tool_calls in stream:", toolCalls);
                                    chrome.runtime.sendMessage({
                                        action: 'handleToolCallResponse',
                                        responseMessage: { tool_calls: toolCalls },
                                        prompt: promptContent,
                                        tabId: tabId,
                                        streamId: streamId // Pass streamId along
                                    });

                                }
                            }
                            // If finishReason is 'stop' or other terminal reasons, the [DONE] message will handle stream termination.
                        }
                    } catch (e) {
                        console.warn('Background: Error parsing JSON chunk or processing delta:', e, 'Chunk:', dataContent);
                        // Optionally send an error to chat.js, or try to continue if minor.
                        // For now, we log and continue, as some chunks might be metadata or empty.
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error in makeLlmApiRequest (streaming):', error);
        // Ensure tabId is available for sending the error message
        // The original `tabId` parameter of makeLlmApiRequest should be used.
        chrome.runtime.sendMessage({
            action: 'setApiResponse',
            apiResponse: `Error: ${error.message}`,
            streamState: 'error', // Custom state for stream errors
            prompt: promptContent, // promptContent should be available from the function parameter
            tabId: tabId,      // tabId should be available from the function parameter
            streamId: typeof streamId !== 'undefined' ? streamId : null // Include streamId if available
        });
    }
}

// Create context menu items
chrome.runtime.onInstalled.addListener(async () => {

  // Create one-off instruction menu item (always at top)
  chrome.contextMenus.create({
    id: 'oneoff_instruction',
    title: '✨ One-off Instruction',
    contexts: ['selection'],
  });
  // Create start chat menu item
  chrome.contextMenus.create({
    id: 'start_chat',
    title: '💬 Start Chat',
    contexts: ['selection'],
  });

  // Create parent menu for Prompt Paul
  chrome.contextMenus.create({
    id: 'prompt_paul',
    title: 'Query Prompt Paul',
    contexts: ['selection'],
  });

  // Create predefined menu items under Prompt Paul
  chrome.contextMenus.create({
    id: 'summarize',
    title: '📝 Summarize',
    contexts: ['selection'],
    parentId: 'prompt_paul'
  });
  chrome.contextMenus.create({
    id: 'analyze',
    title: '🧐 Analyze',
    contexts: ['selection'],
    parentId: 'prompt_paul'
  });
  chrome.contextMenus.create({
    id: 'explain',
    title: '❓ Explain',
    contexts: ['selection'],
    parentId: 'prompt_paul'
  });
  chrome.contextMenus.create({
    id: 'polish',
    title: '🪄 Polish',
    contexts: ['selection'],
    parentId: 'prompt_paul'
  });
    
  chrome.contextMenus.create({
    id: 'shorten',
    title: '✂️ Shorten',
    contexts: ['selection'],
    parentId: 'prompt_paul'
  });

  chrome.contextMenus.create({
    id: 'formal',
    title: '💼 Formal',
    contexts: ['selection'],
    parentId: 'prompt_paul'
  });
  chrome.contextMenus.create({
    id: 'casual',
    title: '🤙 Casual',
    contexts: ['selection'],
    parentId: 'prompt_paul'
  });
  // Create custom instructions menu items
  // Create parent menu for custom instructions
  chrome.contextMenus.create({
    id: 'customInstructions',
    title: 'Custom Instructions',
    contexts: ['selection'],
  });
  const { instructions } = await chrome.storage.local.get(['instructions']);
  console.log('Context menu loaded instructions from local:', instructions);
  if (instructions && instructions.length > 0) {
    instructions.forEach(instruction => {
      chrome.contextMenus.create({
        id: `custom_${instruction.id}`,
        parentId: 'customInstructions',
        title: `✨ ${instruction.name}`,
        contexts: ['selection'],
      });
    });
  }

  // Add a separator and manage instructions at the end.
  // The timeout is used to ensure these specific menu items are added last,
  // potentially due to asynchronous nature of context menu creation or to order them visually.
  setTimeout(() => {
    // Add a separator
    chrome.contextMenus.create({
      id: 'separator',
      type: 'separator',
      contexts: ['selection'],
    });

     // Add option to manage custom instructions as the last item
    chrome.contextMenus.create({
      id: 'manageInstructions',
      title: 'Manage Custom Instructions',
      contexts: ['selection'],
    });
  }, 100);
});

// Update context menus when instructions change
chrome.storage.onChanged.addListener(async (changes, namespace) => {
if (namespace === 'local' && changes.instructions) {
  // Remove existing menu items
  chrome.contextMenus.remove('customInstructions');
  chrome.contextMenus.remove('separator');
  chrome.contextMenus.remove('manageInstructions');
  
  // Get updated instructions
  const { instructions } = await chrome.storage.local.get(['instructions']);
  
  // Recreate custom instructions menu
  chrome.contextMenus.create({
    id: 'customInstructions',
    title: 'Custom Instructions',
    contexts: ['selection'],
  });
  
  if (instructions && instructions.length > 0) {
    instructions.forEach(instruction => {
      chrome.contextMenus.create({
        id: `custom_${instruction.id}`,
        parentId: 'customInstructions',
        title: `✨ ${instruction.name}`,
        contexts: ['selection'],
      });
    });
  }

  // Add separator and manage instructions at the end.
  // The timeout is used to ensure these specific menu items are added last,
  // potentially due to asynchronous nature of context menu creation or to order them visually.
  setTimeout(() => {
    // Add a separator
    chrome.contextMenus.create({
      id: 'separator',
      type: 'separator',
      contexts: ['selection'],
    });

     // Add option to manage custom instructions as the last item
    chrome.contextMenus.create({
      id: 'manageInstructions',
      title: 'Manage Custom Instructions',
      contexts: ['selection'],
    });
  }, 100);
}
});

// --- Tool Execution Logic ---

// Helper function to get all tool definitions from storage
/**
 * Get all tool definitions, merging local and MCP tools.
 */
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
async function callUserDefinedEndpoint(endpointUrl, args, userDefinedMethod) { // Added userDefinedMethod parameter
    console.log(`Background: Calling user-defined endpoint: ${endpointUrl} with args:`, args);
    try {
        // Determine HTTP method: Use user-defined method if provided, otherwise default based on args
        const isEmptyArgs = !args || Object.keys(args).length === 0;
        let method = userDefinedMethod || (isEmptyArgs ? 'GET' : 'POST'); // Prioritize user setting
        method = method.toUpperCase(); // Ensure method is uppercase

        console.log(`Background: Using method ${method} (User defined: ${userDefinedMethod || 'Auto'}) for endpoint ${endpointUrl}`);

        const fetchOptions = {
            method: method,
            headers: {
                'Accept': 'application/json' // Always accept JSON response
                // Note: No API keys or auth headers are sent by default.
            },
        };

        // Handle arguments based on method
        let finalEndpointUrl = endpointUrl;
        if (method === 'GET' && !isEmptyArgs) {
            // Append args as query parameters for GET requests
            const queryParams = new URLSearchParams(args).toString();
            finalEndpointUrl = `${endpointUrl}?${queryParams}`;
            console.log(`Background: Appended query params for GET request: ${queryParams}`);
        } else if (['POST', 'PUT', 'PATCH'].includes(method) && !isEmptyArgs) {
            // Send args in body for POST, PUT, PATCH
            fetchOptions.headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify(args);
        }
        // For DELETE, args might be used in the URL path (not handled here) or ignored, body is typically empty.
        // If args are needed for DELETE, the user should construct the endpointUrl accordingly in the tool definition.
        // Remove the temporary log we added earlier
        // console.log("Background: Webhook Fetch Details:", { endpointUrl: finalEndpointUrl, fetchOptions, args });

        const response = await fetch(finalEndpointUrl, fetchOptions); // Use finalEndpointUrl which might include query params

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
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'executePromptPaulTool') {
        const { id, name, arguments: argsString } = request.toolCall;
        console.log(`Background: Received request to execute tool '${name}' with id '${id}'`);

        (async () => {
            try {
                // 1. Fetch all tool definitions to find the one requested
                const allTools = await getAllToolDefinitions();
                const toolDefinition = allTools.find(t => t.name === name);

                if (!toolDefinition) {
                    throw new Error(`Tool definition for '${name}' not found in storage or MCP servers.`);
                }

                // 2. Parse arguments
                let args;
                try {
                    args = JSON.parse(argsString || '{}');
                } catch (parseError) {
                    throw new Error(`Invalid arguments format for tool '${name}'. Expected JSON. Received: ${argsString}`);
                }

                // 3. Check if it has a user-defined endpoint URL
                if (toolDefinition.endpointUrl) {
                    const result = await callUserDefinedEndpoint(toolDefinition.endpointUrl, args, toolDefinition.httpMethod);
                    console.log(`Background: User-defined tool '${name}' executed successfully via endpoint. Result:`, result);
                    sendResponse({ result: result });
                }
                // 4. If no endpoint URL, check for a built-in implementation
                else {
                    const builtInFunction = toolImplementations[name];
                    if (builtInFunction) {
                        const result = await builtInFunction(args);
                        console.log(`Background: Built-in tool '${name}' executed successfully. Result:`, result);
                        sendResponse({ result: result });
                    } else {
                        throw new Error(`Tool '${name}' has no configured endpoint URL, no built-in implementation, and is not an MCP tool.`);
                    }
                }
            } catch (error) {
                console.error(`Background: Error processing tool '${name}':`, error);
                sendResponse({ error: error.message || 'Tool processing failed' });
            }
        })();

        return true; // Crucial: Indicates that sendResponse will be called asynchronously
    } else if (request.action === 'requestInitDataForMyTab') {
        console.log('Background: Received requestInitDataForMyTab. Sender:', sender); // Added log to inspect sender object
        console.log('Background: sender.tab is:', sender.tab); // Added log
        const tabId = sender.tab?.id; // Use optional chaining for safety
        
        if (tabId === undefined) {
            console.warn('Background: Received requestInitDataForMyTab from a context without a valid tab ID. Sender:', sender);
            // Do not proceed with tab-specific initialization if tabId is undefined
            return true; // Indicate that sendResponse will not be called here
        }

        // Proceed only if tabId is valid
        const dataToInitializeWith = tabPendingInitializationData[tabId] || { tabId: tabId, fromRequest: true }; // Ensure tabId is always sent
        console.log(`Background: Received requestInitDataForMyTab from tab ${tabId}, sending initChat with data:`, dataToInitializeWith);
        
        // Send message directly to the specific tab that requested it
        chrome.tabs.sendMessage(tabId, {
            action: 'initChat',
            ...dataToInitializeWith
        }); // Corrected brace placement
        delete tabPendingInitializationData[tabId]; // Clear after sending
    } else {
        console.warn("Background: Received requestInitDataForMyTab from a context without a valid tab ID. Sender:", sender);
        // Do not proceed with tab-specific initialization if tabId is undefined
        // return true; // Removed this return as it's not needed here based on the original structure
    }
    // Handle other potential actions if needed
});
