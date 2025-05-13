importScripts('marked.min.js');

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

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Single side panel open call at start of user gesture
  await chrome.sidePanel.open({ tabId: tab.id });
  const selectedText = info.selectionText;

  // Handle manage instructions click
  if (info.menuItemId === 'manageInstructions') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    return;
  }

  // Handle one-off instruction click with proper sequencing
  if (info.menuItemId === 'oneoff_instruction') {
    // Ensure panel is fully opened before sending message
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

// ValidateConfig function to include API configuration
async function validateConfig() {
  return new Promise((resolve, reject) => {
<<<<<<< HEAD
<<<<<<< HEAD
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
=======
    chrome.storage.sync.get(
      ['llmEndpoint', 'apiKey', 'modelName', 'systemPrompt', 'maxTokens'], // Add systemPrompt and maxTokens
      (result) => {
        if (!result.llmEndpoint || !result.apiKey || !result.modelName) {
          reject(
            new Error(
              'Configuration is incomplete. Please set up the API endpoint, API key, and model name in the options page.' // Note: systemPrompt and maxTokens are optional
            )
          );
        } else {
          resolve(result);
        }
>>>>>>> parent of c6f1b07 (fixed profile drop down)
=======
    chrome.storage.sync.get(
      ['llmEndpoint', 'apiKey', 'modelName', 'systemPrompt', 'maxTokens'], // Add systemPrompt and maxTokens
      (result) => {
        if (!result.llmEndpoint || !result.apiKey || !result.modelName) {
          reject(
            new Error(
              'Configuration is incomplete. Please set up the API endpoint, API key, and model name in the options page.' // Note: systemPrompt and maxTokens are optional
            )
          );
        } else {
          resolve(result);
        }
>>>>>>> parent of c6f1b07 (fixed profile drop down)
      }
    );
  });
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
            });
        }, sendMessageDelay);
    } else if (responseMessage.content) {
        const latestResponse = responseMessage.content;
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: latestResponse,
                prompt: prompt,
                tabId: tabId,
            });
        }, sendMessageDelay);
    } else {
        console.error("Background: API response message has neither content nor tool_calls:", responseMessage);
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: "Error: Received an empty or invalid response from the AI.",
                prompt: prompt,
                tabId: tabId,
            });
        }, sendMessageDelay);
    }
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

        console.log('Background: Refactored API call. Tools sent to API:', formattedTools);

        let toolChoicePayload = {}; // This will hold {tools: ..., tool_choice: ...} or be empty
        if (formattedTools.length > 0) { // Only add tools and tool_choice if there are formatted tools
            if (isStartChat) {
                toolChoicePayload = { tools: formattedTools, tool_choice: "auto" };
            } else {
                // Logic for customInstructionToolChoice, aiming to match original behavior (lines 260-274)
                // customInstructionToolChoice is passed from the calling context (derived from instruction.tool_choice || 'none')
                let finalToolChoiceValue = 'none'; // Default fallback, as in original line 273

                if (Array.isArray(customInstructionToolChoice) && customInstructionToolChoice.length > 0) {
                    const choiceFromArray = customInstructionToolChoice[0];
                    if (choiceFromArray === 'auto') {
                        finalToolChoiceValue = 'auto';
                    } else if (choiceFromArray && choiceFromArray !== 'none') { // Check if it's a tool name
                        finalToolChoiceValue = { type: 'function', function: { name: choiceFromArray } };
                    }
                    // If choiceFromArray is 'none' or falsy (e.g. empty string from array), finalToolChoiceValue remains 'none'.
                }
                // If customInstructionToolChoice was not a non-empty array (e.g. it was a string 'none', 'auto', or a tool name directly, or undefined),
                // the original logic would effectively lead to 'none' unless it was 'auto' or a tool name handled by some other path not shown in lines 260-274.
                // Given instructionToolChoice = instruction.tool_choice || 'none' (line 179), if instruction.tool_choice is a string like "my_tool",
                // Array.isArray(customInstructionToolChoice) would be false, leading to 'none'.
                // This new logic ensures that if customInstructionToolChoice is directly 'auto' or a tool name string, it's not used unless it's in an array.
                // This strictly adheres to the original `Array.isArray` check.

                toolChoicePayload = { tools: formattedTools, tool_choice: finalToolChoiceValue };
            }
        }
        // If formattedTools is empty, toolChoicePayload remains {}, and no 'tools' or 'tool_choice' is sent to the API.

        const apiRequestBody = {
            model: config.modelName,
            messages: messages,
            max_tokens: parseInt(config.maxTokens) || 2048,
            ...toolChoicePayload // Spread the tools and tool_choice if they exist
        };
        
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

        const responseData = await apiResponse.json();

        if (!responseData || !responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
            // Allow responses without content if tool_calls are present
            if (!(responseData.choices && responseData.choices[0] && responseData.choices[0].message && responseData.choices[0].message.tool_calls)) {
                 throw new Error('Invalid response format from API: Missing message content or tool_calls.');
            }
        }
        
        // Pass isStartChat to determine the correct delay in the handler
        await _handleApiResponseAndSendMessage(responseData.choices[0].message, promptContent, tabId, isStartChat);

    } catch (error) {
        console.error('Error in makeLlmApiRequest:', error);
        // Determine error message delay based on context, matching original behavior
        const errorDelay = isStartChat ? 300 : 200;
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: `Error: ${error.message}`,
                prompt: promptContent,
                tabId: tabId,
            });
        }, errorDelay);
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

  // Add a separator and manage instructions at the end
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

  // Add separator and manage instructions at the end
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
    }

    // Handle other potential actions if needed
});
