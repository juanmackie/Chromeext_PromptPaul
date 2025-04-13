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
    
    // Make API call with the selected text as the prompt
    try {
      const config = await validateConfig(); // Fetches endpoint, key, model, and systemPrompt
      const tools = await getAllToolDefinitions(); // Fetch defined tools

      // Format tools for the API request (similar to chat.js)
      const formattedTools = tools.map(tool => {
          try {
              return {
                  type: 'function',
                  function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: JSON.parse(tool.parameters || '{}') // Parse the stored JSON string, default to empty object if null/undefined
                  }
              };
          } catch (e) {
              console.error(`Background: Error parsing parameters for tool ${tool.name}:`, e);
              // Optionally inform the user via chat.js later if needed
              return null; // Skip invalid tools
          }
      }).filter(tool => tool !== null); // Filter out tools with parsing errors

      // Construct messages array, including system prompt if available
      const messages = [];
      if (config.systemPrompt && config.systemPrompt.trim() !== '') {
        messages.push({ role: 'system', content: config.systemPrompt });
      }
      messages.push({ role: 'user', content: selectedText });

      const apiResponse = await fetch(config.llmEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.modelName,
          messages: messages, // Use the constructed messages array
          max_tokens: parseInt(config.maxTokens) || 2048, // Use maxTokens from config or default
          ...(formattedTools.length > 0 && { tools: formattedTools, tool_choice: "auto" }) // Conditionally add tools
        }),
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

      if (
        !responseData ||
        !responseData.choices ||
        !responseData.choices[0] ||
        !responseData.choices[0].message
      ) {
        // Allow responses without content if tool_calls are present
        if (!responseData.choices[0].message.tool_calls) {
             throw new Error('Invalid response format from API: Missing message content or tool_calls.');
        }
      }

      // Check for tool calls in the response
      const responseMessage = responseData.choices[0].message;
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          // Send tool call request to chat.js for handling
          console.log("Background: Received tool_calls from API, forwarding to chat.js", responseMessage.tool_calls);
          setTimeout(() => { // Keep delay to ensure panel is ready
              chrome.runtime.sendMessage({
                  action: 'handleToolCallResponse', // New action for chat.js
                  responseMessage: responseMessage, // Send the whole message object
                  prompt: selectedText, // Include original prompt for context
                  tabId: tab.id,
              });
          }, 300);
      } else if (responseMessage.content) {
          // Handle regular text response
          const latestResponse = responseMessage.content;
          setTimeout(() => {
              chrome.runtime.sendMessage({
                  action: 'setApiResponse',
                  apiResponse: latestResponse,
                  prompt: selectedText,  // Include the selected text as the prompt
                  tabId: tab.id,
              });
          }, 300); // Add a delay to ensure the chat panel is ready
      } else {
          // Handle cases where there's neither content nor tool_calls
           console.error("Background: API response message has neither content nor tool_calls:", responseMessage);
           // Send an error message back
           setTimeout(() => {
              chrome.runtime.sendMessage({
                  action: 'setApiResponse',
                  apiResponse: "Error: Received an empty or invalid response from the AI.",
                  prompt: selectedText,
                  tabId: tab.id,
              });
           }, 300);
      }
    } catch (error) {
      console.error('Error:', error);
      setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'setApiResponse',
          apiResponse: `Error: ${error.message}`,
          prompt: selectedText,  // Include the selected text as the prompt
          tabId: tab.id,
        });
      }, 300);
    }
    return;
  }

  let prompt = '';
  if (info.menuItemId.startsWith('custom_')) {
    // Handle custom instruction
    const instructionId = info.menuItemId.replace('custom_', '');
    const { instructions } = await chrome.storage.sync.get(['instructions']);
    const instruction = instructions.find(i => i.id === instructionId);
    if (instruction) {
      prompt = `${instruction.content}\n\n${selectedText}`;
    } else {
      throw new Error('Custom instruction not found');
    }
  } else {
    // Handle predefined commands
    switch (info.menuItemId) {
      case 'summarize':
        prompt = `Please summarize the following text into a bullet list of points:\n${selectedText}`;
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

  // Make API call to LLM endpoint and handle response/errors within try...catch
  try {
    const config = await validateConfig(); // Fetches endpoint, key, model, and systemPrompt
    const tools = await getAllToolDefinitions(); // Fetch defined tools

    // Format tools for the API request (similar to chat.js)
    const formattedTools = tools.map(tool => {
        try {
            return {
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: JSON.parse(tool.parameters || '{}') // Parse the stored JSON string, default to empty object if null/undefined
                }
            };
        } catch (e) {
            console.error(`Background: Error parsing parameters for tool ${tool.name}:`, e);
            // Optionally inform the user via chat.js later if needed
            return null; // Skip invalid tools
        }
    }).filter(tool => tool !== null); // Filter out tools with parsing errors

    // Construct messages array, including system prompt if available
    const messages = [];
    if (config.systemPrompt && config.systemPrompt.trim() !== '') {
      messages.push({ role: 'system', content: config.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const apiResponse = await fetch(config.llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelName,
        messages: messages, // Use the constructed messages array
        max_tokens: parseInt(config.maxTokens) || 2048, // Use maxTokens from config or default
        ...(formattedTools.length > 0 && { tools: formattedTools, tool_choice: "auto" }) // Conditionally add tools
      }),
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

    if (
      !responseData ||
      !responseData.choices ||
      !responseData.choices[0] ||
      !responseData.choices[0].message
    ) {
       // Allow responses without content if tool_calls are present
       if (!responseData.choices[0].message.tool_calls) {
           throw new Error('Invalid response format from API: Missing message content or tool_calls.');
       }
    }

    // Check for tool calls in the response
    const responseMessage = responseData.choices[0].message;
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        // Send tool call request to chat.js for handling
        console.log("Background: Received tool_calls from API, forwarding to chat.js", responseMessage.tool_calls);
        // No delay needed here as panel should already be open from context menu click
        chrome.runtime.sendMessage({
            action: 'handleToolCallResponse', // New action for chat.js
            responseMessage: responseMessage, // Send the whole message object
            prompt: prompt, // Include original prompt for context
            tabId: tab.id,
        });
    } else if (responseMessage.content) {
        // Handle regular text response
        const latestResponse = responseMessage.content;
        chrome.runtime.sendMessage({
            action: 'setApiResponse',
            apiResponse: latestResponse,
            prompt: prompt,  // Include the prompt that was used
            tabId: tab.id,
        });
    } else {
        // Handle cases where there's neither content nor tool_calls
        console.error("Background: API response message has neither content nor tool_calls:", responseMessage);
        // Send an error message back
        chrome.runtime.sendMessage({
            action: 'setApiResponse',
            apiResponse: "Error: Received an empty or invalid response from the AI.",
            prompt: prompt,
            tabId: tab.id,
        });
    }
  } catch (error) {
    console.error('Error:', error);
    setTimeout(() => { // Add delay here
      chrome.runtime.sendMessage({
        action: 'setApiResponse',
        apiResponse: `Error: ${error.message}`,
        prompt: prompt,  // Include the prompt that was used
        tabId: tab.id,
      });
    }, 200); // 200ms delay
  }
});

// ValidateConfig function to include API configuration
async function validateConfig() {
  return new Promise((resolve, reject) => {
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
      }
    );
  });
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
  const { instructions } = await chrome.storage.sync.get(['instructions']);
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
if (namespace === 'sync' && changes.instructions) {
  // Remove existing menu items
  chrome.contextMenus.remove('customInstructions');
  chrome.contextMenus.remove('separator');
  chrome.contextMenus.remove('manageInstructions');
  
  // Get updated instructions
  const { instructions } = await chrome.storage.sync.get(['instructions']);
  
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
        chrome.storage.sync.get(['promptPaulTools'], (result) => {
            resolve(result.promptPaulTools || []);
        });
    });
    return localTools;
}

// Function to get a single tool definition by name from storage
async function getToolDefinition(name) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['promptPaulTools'], (result) => {
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
