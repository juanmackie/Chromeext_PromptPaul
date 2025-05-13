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

// ValidateConfig function to include API configuration, loading from the selected profile in local storage
async function validateConfig() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
      const profiles = result.profiles || [];
      const lastSelectedProfileId = result.lastSelectedProfileId || 'default';

      const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId);

      if (!selectedProfile || !selectedProfile.llmEndpoint || !selectedProfile.apiKey || !selectedProfile.modelName) {
        // Fallback or error if selected profile is incomplete or not found
        // As a fallback, try to find the default profile
        const defaultProfile = profiles.find(p => p.id === 'default');
        if (defaultProfile && defaultProfile.llmEndpoint && defaultProfile.apiKey && defaultProfile.modelName) {
           console.warn(`Background: Selected profile '${lastSelectedProfileId}' incomplete or not found, using default profile.`);
           resolve(defaultProfile);
        } else {
           // If even default is incomplete, reject
           reject(
             new Error(
               'Configuration is incomplete. Please set up the API endpoint, API key, and model name in the options page.'
             )
           );
        }
      } else {
        console.log(`Background: Using configuration from profile: ${selectedProfile.name || selectedProfile.id}`);
        resolve(selectedProfile);
      }
    });
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

        let toolsToSend = [];
        let finalToolChoiceValue = 'none'; // Default

        if (isStartChat) {
            // Start chat always sends all tools with auto tool_choice
            toolsToSend = formattedTools;
            finalToolChoiceValue = 'auto';
        } else {
            // Handle custom instruction tool_choice
            if (Array.isArray(customInstructionToolChoice) && customInstructionToolChoice.length > 0) {
                const choiceFromArray = customInstructionToolChoice[0];
                if (choiceFromArray === 'auto') {
                    toolsToSend = formattedTools;
                    finalToolChoiceValue = 'auto';
                } else if (choiceFromArray && choiceFromArray !== 'none') {
                    // Find the specific tool and send only that one
                    const specificTool = formattedTools.find(tool => tool.function.name === choiceFromArray);
                    if (specificTool) {
                        toolsToSend = [specificTool];
                        finalToolChoiceValue = { type: 'function', function: { name: choiceFromArray } };
                    } else {
                        console.warn(`Background: Specified tool '${choiceFromArray}' not found.`);
                        // If tool not found, behave as 'none'
                        toolsToSend = [];
                        finalToolChoiceValue = 'none';
                    }
                } else {
                    // choiceFromArray is 'none' or falsy, behave as 'none'
                    toolsToSend = [];
                    finalToolChoiceValue = 'none';
                }
            } else if (customInstructionToolChoice === 'auto') {
                 // Handle case where customInstructionToolChoice is just the string 'auto'
                 toolsToSend = formattedTools;
                 finalToolChoiceValue = 'auto';
            } else if (customInstructionToolChoice && customInstructionToolChoice !== 'none') {
                // Handle case where customInstructionToolChoice is just a tool name string
                const specificTool = formattedTools.find(tool => tool.function.name === customInstructionToolChoice);
                if (specificTool) {
                    toolsToSend = [specificTool];
                    finalToolChoiceValue = { type: 'function', function: { name: customInstructionToolChoice } };
                } else {
                    console.warn(`Background: Specified tool '${customInstructionToolChoice}' not found.`);
                    // If tool not found, behave as 'none'
                    toolsToSend = [];
                    finalToolChoiceValue = 'none';
                }
            } else {
                // customInstructionToolChoice is 'none' or undefined/falsy, behave as 'none'
                toolsToSend = [];
                finalToolChoiceValue = 'none';
            }
        }

        let toolChoicePayload = {};
        if (toolsToSend.length > 0) {
            toolChoicePayload = { tools: toolsToSend, tool_choice: finalToolChoiceValue };
        }

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
            fetchOptions.body = JSON.stringify(args);
            fetchOptions.headers['Content-Type'] = 'application/json'; // Set Content-Type for body
        }
        // For other methods (like DELETE) or empty args, no body is sent.

        const apiResponse = await fetch(finalEndpointUrl, fetchOptions);

        if (!apiResponse.ok) {
            const errorBody = await apiResponse.text(); // Read as text to avoid JSON parsing errors on non-JSON responses
            throw new Error(`HTTP error! status: ${apiResponse.status}, body: ${errorBody}`);
        }

        // Attempt to parse JSON, but allow non-JSON responses
        try {
            const responseData = await apiResponse.json();
            console.log("Background: User-defined endpoint response (JSON):", responseData);
            return { success: true, data: responseData };
        } catch (e) {
            const responseText = await apiResponse.text();
            console.log("Background: User-defined endpoint response (Text):", responseText);
            return { success: true, data: responseText }; // Return text if JSON parsing fails
        }

    } catch (error) {
        console.error('Background: Error calling user-defined endpoint:', error);
        return { success: false, error: error.message };
    }
}

// Function to execute a tool call
async function executeToolCall(toolCall, tabId) {
    console.log("Background: Executing tool call:", toolCall);
    const toolName = toolCall.function.name;
    const toolArgs = JSON.parse(toolCall.function.arguments); // Assuming arguments are always a JSON string

    const toolDefinition = await getToolDefinition(toolName);

    if (!toolDefinition) {
        console.error(`Background: Tool definition not found for tool: ${toolName}`);
        return {
            tool_call_id: toolCall.id,
            output: `Error: Tool '${toolName}' not found.`
        };
    }

    // Check if the tool is an MCP tool or a user-defined endpoint tool
    if (toolDefinition.type === 'mcp') {
        // Handle MCP tool execution (requires MCP server connection)
        // This part is a placeholder as MCP server integration is not fully implemented yet
        console.warn(`Background: Attempted to execute MCP tool '${toolName}'. MCP server integration is not yet fully implemented.`);
        return {
            tool_call_id: toolCall.id,
            output: `Error: MCP tool execution for '${toolName}' is not yet supported.`
        };
    } else if (toolDefinition.type === 'user_defined_endpoint') {
        // Handle user-defined endpoint tool execution
        const endpointUrl = toolDefinition.endpoint_url;
        const userDefinedMethod = toolDefinition.method; // Get the user-defined method

        if (!endpointUrl) {
            console.error(`Background: Endpoint URL not defined for user-defined tool: ${toolName}`);
            return {
                tool_call_id: toolCall.id,
                output: `Error: Endpoint URL not defined for tool '${toolName}'.`
            };
        }

        const result = await callUserDefinedEndpoint(endpointUrl, toolArgs, userDefinedMethod); // Pass userDefinedMethod

        if (result.success) {
            // Return the data as a JSON string in the output
            return {
                tool_call_id: toolCall.id,
                output: JSON.stringify(result.data)
            };
        } else {
            return {
                tool_call_id: toolCall.id,
                output: `Error executing tool '${toolName}': ${result.error}`
            };
        }
    } else {
        console.error(`Background: Unknown tool type for tool: ${toolName}`);
        return {
            tool_call_id: toolCall.id,
            output: `Error: Unknown tool type for tool '${toolName}'.`
        };
    }
}

// Handle messages from chat.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'executeToolCalls') {
        console.log("Background: Received executeToolCalls message:", request.toolCalls);
        const toolCallPromises = request.toolCalls.map(toolCall => executeToolCall(toolCall, request.tabId));

        Promise.all(toolCallPromises)
            .then(toolOutputs => {
                console.log("Background: Tool execution results:", toolOutputs);
                // Send the tool outputs back to chat.js
                chrome.runtime.sendMessage({
                    action: 'handleToolOutputs',
                    toolOutputs: toolOutputs,
                    conversationHistory: request.conversationHistory, // Pass back the conversation history
                    tabId: request.tabId
                });
            })
            .catch(error => {
                console.error("Background: Error during tool execution:", error);
                // Send an error message back to chat.js
                chrome.runtime.sendMessage({
                    action: 'setApiResponse',
                    apiResponse: `Error executing tools: ${error.message}`,
                    prompt: "Tool Execution Error", // Indicate this is an error related to tool execution
                    tabId: request.tabId
                });
            });

        // Indicate that the response will be sent asynchronously
        return true;
    } else if (request.action === 'makeLlmApiRequest') {
        console.log("Background: Received makeLlmApiRequest message:", request);
        // This handles API requests initiated from chat.js (e.g., follow-up turns after tool execution)
        makeLlmApiRequest(request.prompt, request.tabId, { isStartChat: false, customInstructionToolChoice: 'auto' }); // Assume 'auto' tool choice for chat turns for now
        return true; // Indicate that the response will be sent asynchronously
    }
});

// Placeholder for MCP server connection status
let isMcpServerConnected = false;

// Function to update MCP server connection status (called by MCP server)
function updateMcpServerStatus(isConnected) {
    isMcpServerConnected = isConnected;
    console.log(`Background: MCP Server Connection Status: ${isMcpServerConnected}`);
    // Potentially update UI or tool availability based on connection status
}

// Example of how an MCP server might signal its status (this would be handled by the MCP communication layer)
// chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
//     if (request.action === 'mcpServerStatus') {
//         updateMcpServerStatus(request.isConnected);
//         sendResponse({ success: true });
//     }
// });

// Placeholder for MCP tool definitions (these would be provided by the MCP server)
let mcpToolDefinitions = [];

// Function to update MCP tool definitions (called by MCP server)
function updateMcpToolDefinitions(toolDefinitions) {
    mcpToolDefinitions = toolDefinitions;
    console.log("Background: Updated MCP Tool Definitions:", mcpToolDefinitions);
    // Potentially update context menus or internal tool list
}

// Example of how an MCP server might provide tool definitions
// chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
//     if (request.action === 'mcpToolDefinitions') {
//         updateMcpToolDefinitions(request.toolDefinitions);
//         sendResponse({ success: true });
//     }
// });

// Modify getAllToolDefinitions to merge local and MCP tools
// async function getAllToolDefinitions() {
//     const localTools = await new Promise((resolve) => {
//         chrome.storage.local.get(['promptPaulTools'], (result) => {
//             resolve(result.promptPaulTools || []);
//         });
//     });
//     // Merge local and MCP tools if MCP server is connected
//     if (isMcpServerConnected) {
//         return [...localTools, ...mcpToolDefinitions];
//     } else {
//         return localTools;
//     }
// }

// Modify getToolDefinition to search both local and MCP tools
// async function getToolDefinition(name) {
//     const localTool = await new Promise((resolve) => {
//         chrome.storage.local.get(['promptPaulTools'], (result) => {
//             const toolsArray = result.promptPaulTools || [];
//             resolve(toolsArray.find(t => t.name === name));
//         });
//     });
//     if (localTool) {
//         return localTool;
//     } else if (isMcpServerConnected) {
//         // Search MCP tools if not found locally and MCP server is connected
//         return mcpToolDefinitions.find(t => t.name === name);
//     } else {
//         return null;
//     }
// }

// Modify executeToolCall to handle MCP tool execution
// async function executeToolCall(toolCall, tabId) {
//     console.log("Background: Executing tool call:", toolCall);
//     const toolName = toolCall.function.name;
//     const toolArgs = JSON.parse(toolCall.function.arguments); // Assuming arguments are always a JSON string

//     const toolDefinition = await getToolDefinition(toolName);

//     if (!toolDefinition) {
//         console.error(`Background: Tool definition not found for tool: ${toolName}`);
//         return {
//             tool_call_id: toolCall.id,
//             output: `Error: Tool '${toolName}' not found.`
//         };
//     }

//     if (toolDefinition.type === 'mcp') {
//         // Send tool execution request to MCP server
//         return new Promise((resolve, reject) => {
//             chrome.runtime.sendMessage(toolDefinition.mcp_extension_id, {
//                 action: 'executeMcpTool',
//                 toolName: toolName,
//                 args: toolArgs,
//                 toolCallId: toolCall.id // Pass toolCallId for response correlation
//             }, (response) => {
//                 if (chrome.runtime.lastError) {
//                     console.error(`Background: Error sending message to MCP server for tool '${toolName}':`, chrome.runtime.lastError);
//                     resolve({
//                         tool_call_id: toolCall.id,
//                         output: `Error communicating with MCP server for tool '${toolName}': ${chrome.runtime.lastError.message}`
//                     });
//                 } else if (response && response.success) {
//                     console.log(`Background: MCP tool '${toolName}' executed successfully. Output:`, response.output);
//                     resolve({
//                         tool_call_id: toolCall.id,
//                         output: JSON.stringify(response.output) // Assuming MCP server returns output in 'output' field
//                     });
//                 } else {
//                     console.error(`Background: MCP tool '${toolName}' execution failed. Response:`, response);
//                     resolve({
//                         tool_call_id: toolCall.id,
//                         output: `Error executing MCP tool '${toolName}': ${response ? response.error : 'Unknown error'}`
//                     });
//                 }
//             });
//         });
//     } else if (toolDefinition.type === 'user_defined_endpoint') {
//         // Handle user-defined endpoint tool execution (existing logic)
//         const endpointUrl = toolDefinition.endpoint_url;
//         const userDefinedMethod = toolDefinition.method;

//         if (!endpointUrl) {
//             console.error(`Background: Endpoint URL not defined for user-defined tool: ${toolName}`);
//             return {
//                 tool_call_id: toolCall.id,
//                 output: `Error: Endpoint URL not defined for tool '${toolName}'.`
//             };
//         }

//         const result = await callUserDefinedEndpoint(endpointUrl, toolArgs, userDefinedMethod);

//         if (result.success) {
//             return {
//                 tool_call_id: toolCall.id,
//                 output: JSON.stringify(result.data)
//             };
//         } else {
//             return {
//                 tool_call_id: toolCall.id,
//                 output: `Error executing tool '${toolName}': ${result.error}`
//             };
//         }
//     } else {
//         console.error(`Background: Unknown tool type for tool: ${toolName}`);
//         return {
//             tool_call_id: toolCall.id,
//             output: `Error: Unknown tool type for tool '${toolName}'.`
//         };
//     }
// }

// Handle responses from MCP server tool executions
// chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
//     if (request.action === 'mcpToolOutput') {
//         console.log("Background: Received MCP tool output:", request);
//         // Find the corresponding tool call and process the output
//         // This would involve matching request.toolCallId to an ongoing tool execution
//         // and then sending the output back to chat.js via handleToolOutputs
//         // Placeholder for now
//         console.warn("Background: Received MCP tool output, but handling logic is a placeholder.");
//         sendResponse({ success: true });
//     }
// });
