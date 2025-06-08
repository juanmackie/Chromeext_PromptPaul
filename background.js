importScripts('marked.min.js');

let tabContentCallback = null; // To store sendResponse for getTabContent

// Enable the side panel on all pages
chrome.sidePanel
  .setOptions({ path: 'chat.html' })
  .catch((error) => console.error('Error setting initial side panel options:', error));

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.sidePanel.setOptions({
    tabId,
    path: 'chat.html',
    enabled: true
  }).catch((error) => console.error(`Error setting side panel options for tab ${tabId}:`, error));
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
  let selectedText = info.selectionText;
  let promptContent = '';

  if (info.mediaType === 'image' && info.srcUrl) {
    const imageUrlText = `Image URL: ${info.srcUrl}`;
    if (selectedText) {
      selectedText = `${imageUrlText}\n${selectedText}`;
    } else {
      selectedText = imageUrlText;
    }
  }
  promptContent = selectedText;

  if (info.menuItemId === 'manageInstructions') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    return;
  }

  if (info.menuItemId === 'oneoff_instruction') {
    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: 'setSelectedText',
        selectedText: promptContent,
        tabId: tab.id
      }).catch(error => console.error(`Error sending setSelectedText for one-off: ${error.message}, tabId: ${tab.id}`));
    }, 100); // Keep timeout as it might be for UI rendering race condition
    return;
  }

  if (info.menuItemId === 'start_chat') {
    chrome.runtime.sendMessage({
      action: 'setSelectedText',
      selectedText: promptContent,
      tabId: tab.id,
      fromStartChat: true
    }).catch(error => console.error(`Error sending setSelectedText for start_chat: ${error.message}, tabId: ${tab.id}`));
    
    await makeLlmApiRequest(promptContent, tab.id, { isStartChat: true });
    return;
  }

  let instructionToolChoice = 'none';
  if (info.menuItemId.startsWith('custom_')) {
    const instructionId = info.menuItemId.replace('custom_', '');
    const { instructions } = await chrome.storage.local.get(['instructions']);
    const instruction = instructions.find(i => i.id === instructionId);
    if (instruction) {
      promptContent = `${instruction.content}\n\n${promptContent}`;
      instructionToolChoice = instruction.tool_choice || 'none';
    } else {
      console.error(`Custom instruction with ID ${instructionId} not found.`);
    }
  } else {
    switch (info.menuItemId) {
      case 'summarize':
        promptContent = `Please summarize the following text into a bullet list of points:\n${promptContent}`;
        break;
      case 'explain':
        promptContent = `Explain this to me in a short concise MECE approach:\n${promptContent}`;
        break;
      case 'polish':
        promptContent = `Polish this text with clarity and purpose:\n${promptContent}`;
        break;
      case 'shorten':
        promptContent = `shorten this text without losing its meaning and context:\n${promptContent}`;
        break;
      case 'formal':
        promptContent = `Make this text more formal and eloquent:\n${promptContent}`;
        break;
      case 'casual':
        promptContent = `Make this text more casual and fun:\n${promptContent}`;
        break;
      case 'analyze':
        promptContent = `Please analyze the following text:\n${promptContent}`;
        break;
      default:
        break;
    }
  }

  await makeLlmApiRequest(promptContent, tab.id, { customInstructionToolChoice: instructionToolChoice });
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

// --- Context Menu Management ---
async function rebuildCustomInstructionsMenu(instructions) {
  await chrome.contextMenus.remove('customInstructions').catch(e => { /* Intentional: ignore if it doesn't exist */ });
  await chrome.contextMenus.remove('separator_custom').catch(e => { /* Intentional: ignore if it doesn't exist */ });
  await chrome.contextMenus.remove('manageInstructions').catch(e => { /* Intentional: ignore if it doesn't exist */ });

  chrome.contextMenus.create({
    id: 'customInstructions',
    title: 'Custom Instructions',
    contexts: ['selection', 'image'],
  });

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

  chrome.contextMenus.create({
    id: 'separator_custom',
    type: 'separator',
    contexts: ['selection', 'image'],
  });

  chrome.contextMenus.create({
    id: 'manageInstructions',
    title: 'Manage Custom Instructions',
    contexts: ['selection', 'image'],
  });
}


// ValidateConfig function to include API configuration
async function validateConfig() {
    const result = await new Promise((resolve) =>
        chrome.storage.local.get(['profiles', 'lastSelectedProfileId', 'defaultLlmEndpoint'], resolve)
    );

    const profiles = result.profiles || [];
    const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
    const globalDefaultEndpoint = result.defaultLlmEndpoint || '';

    let chosenProfile = null;
    let isEndpointValid = false;
    let isConfigComplete = false;
    let specificError = null;

    const checkProfileCoreComponents = (profile) => {
        return profile && profile.apiKey && profile.modelName;
    };

    let candidateProfile = profiles.find(p => p.id === lastSelectedProfileId);
    if (candidateProfile) {
        if (candidateProfile.llmEndpoint && isValidURL(candidateProfile.llmEndpoint)) {
            if (checkProfileCoreComponents(candidateProfile)) {
                chosenProfile = { ...candidateProfile };
                isEndpointValid = true;
                isConfigComplete = true;
            } else {
                specificError = 'Selected profile is missing API key or model name.';
            }
        } else if (globalDefaultEndpoint && isValidURL(globalDefaultEndpoint)) {
            if (checkProfileCoreComponents(candidateProfile)) {
                chosenProfile = { ...candidateProfile, llmEndpoint: globalDefaultEndpoint };
                isEndpointValid = true;
                isConfigComplete = true;
            } else {
                specificError = 'Selected profile is missing API key or model name (even with global default endpoint).';
            }
        } else {
             specificError = 'Selected profile has an invalid or missing LLM endpoint, and no valid global default endpoint is set.';
        }
    } else {
        specificError = 'Selected profile not found.';
    }

    if (!isConfigComplete) {
        candidateProfile = profiles.find(p => p.id === 'default');
        if (candidateProfile) {
            const originalSelectedProfileError = specificError;
            specificError = null;

            if (candidateProfile.llmEndpoint && isValidURL(candidateProfile.llmEndpoint)) {
                if (checkProfileCoreComponents(candidateProfile)) {
                    chosenProfile = { ...candidateProfile };
                    isEndpointValid = true;
                    isConfigComplete = true;
                } else {
                    specificError = 'Default profile is missing API key or model name.';
                }
            } else if (globalDefaultEndpoint && isValidURL(globalDefaultEndpoint)) {
                if (checkProfileCoreComponents(candidateProfile)) {
                    chosenProfile = { ...candidateProfile, llmEndpoint: globalDefaultEndpoint };
                    isEndpointValid = true;
                    isConfigComplete = true;
                } else {
                    specificError = 'Default profile is missing API key or model name (even with global default endpoint).';
                }
            } else {
                specificError = 'Default profile has an invalid or missing LLM endpoint, and no valid global default endpoint is set.';
            }
            if (!isConfigComplete && originalSelectedProfileError && originalSelectedProfileError !== 'Selected profile not found.') {
                 specificError = originalSelectedProfileError;
            }
        } else if (!chosenProfile) {
            specificError = specificError || 'Default profile (id: "default") not found.';
        }
    }

    if (isConfigComplete && chosenProfile) {
        return chosenProfile;
    } else {
        if (!isEndpointValid && chosenProfile && !(chosenProfile.llmEndpoint && isValidURL(chosenProfile.llmEndpoint))) {
            reject(new Error('LLM API endpoint is missing or invalid. Please configure it in the options page.'));
        } else if (specificError) {
            reject(new Error(specificError + ' Please check the options page.'));
        }
         else {
            reject(new Error('Configuration is incomplete. Please set up the API endpoint, API key, and model name in the options page.'));
        }
    }
}

// Helper function to process API response and send messages to chat.js
async function _handleApiResponseAndSendMessage(responseMessage, prompt, tabId, isStartChatContext) {
    const sendMessageDelay = isStartChatContext ? 300 : 200;

    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'handleToolCallResponse',
                responseMessage: responseMessage,
                prompt: prompt,
                tabId: tabId,
            }).catch(error => console.error(`Error sending handleToolCallResponse: ${error.message}, tabId: ${tabId}`));
        }, sendMessageDelay);
    } else if (responseMessage.content) {
        const latestResponse = responseMessage.content;
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: latestResponse,
                prompt: prompt,
                tabId: tabId,
            }).catch(error => console.error(`Error sending setApiResponse (content): ${error.message}, tabId: ${tabId}`));
        }, sendMessageDelay);
    } else {
        console.error("Background: API response message has neither content nor tool_calls:", responseMessage);
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: "Error: Received an empty or invalid response from the AI.",
                prompt: prompt,
                tabId: tabId,
            }).catch(error => console.error(`Error sending setApiResponse (error response): ${error.message}, tabId: ${tabId}`));
        }, sendMessageDelay);
    }
}

// Refactored function to make LLM API calls
async function makeLlmApiRequest(promptContent, tabId, { isStartChat = false, customInstructionToolChoice = 'none' } = {}) {
    let config, tools, enableStreaming;
    try {
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
            if (error.message.includes("LLM API endpoint is missing or invalid") || error.message.includes("Configuration is incomplete")) {
                chrome.runtime.sendMessage({
                    action: 'displayErrorInChat',
                    errorMessage: error.message, // Pass the specific error from validateConfig
                    tabId: tabId,
                    prompt: promptContent
                }).catch(e => console.error("Background: Error sending displayErrorInChat message:", e));
                return;
            }
            throw error; // Re-throw other errors
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
        if (config.systemPrompt && config.systemPrompt.trim() !== '') {
            messages.push({ role: 'system', content: config.systemPrompt });
        }
        messages.push({ role: 'user', content: promptContent });

        let finalToolChoice = customInstructionToolChoice;

        if (Array.isArray(finalToolChoice)) {
            if (finalToolChoice.length === 0 || (finalToolChoice.length === 1 && finalToolChoice[0] === 'none')) {
                finalToolChoice = 'none';
            } else if (finalToolChoice.includes('auto')) {
                finalToolChoice = 'auto';
            }
        } else if (typeof finalToolChoice !== 'string') {
            finalToolChoice = 'none';
        }
        
        const apiRequestBody = {
            model: config.modelName,
            messages: messages,
            max_tokens: parseInt(config.maxTokens) || 2048,
        };

        if (finalToolChoice === 'auto') {
            if (formattedTools.length > 0) {
                apiRequestBody.tools = formattedTools;
                apiRequestBody.tool_choice = "auto";
            }
        } else if (Array.isArray(finalToolChoice)) {
            const selectedFormattedTools = formattedTools.filter(tool => finalToolChoice.includes(tool.function.name));
            if (selectedFormattedTools.length > 0) {
                apiRequestBody.tools = selectedFormattedTools;
                if (selectedFormattedTools.length === 1) {
                    apiRequestBody.tool_choice = { type: "function", function: { name: selectedFormattedTools[0].function.name } };
                } else {
                    apiRequestBody.tool_choice = "auto";
                    console.warn("Background: Multiple specific tools selected via custom instruction. Setting tool_choice to 'auto'. The LLM will pick from the provided tools.");
                }
            }
        }
        
        if (enableStreaming) {
            apiRequestBody.stream = true;
        }

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

        if (enableStreaming && apiRequestBody.stream) { // Ensure stream was actually requested
            const reader = apiResponse.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            chrome.runtime.sendMessage({
                action: 'streamApiStart',
                tabId: tabId,
                prompt: promptContent
            }).catch(error => console.error(`Error sending streamApiStart: ${error.message}, tabId: ${tabId}`));

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    chrome.runtime.sendMessage({ action: 'streamApiEnd', tabId: tabId, prompt: promptContent })
                        .catch(error => console.error(`Error sending streamApiEnd: ${error.message}, tabId: ${tabId}`));
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                let lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        let currentPayload = line.substring(5).trim();
                        while (currentPayload.startsWith('data:')) {
                            currentPayload = currentPayload.substring(5).trim();
                        }
                        if (currentPayload === '[DONE]') continue;

                        if (currentPayload && currentPayload.length > 0 && (currentPayload.startsWith('{') || currentPayload.startsWith('['))) {
                            try {
                                const parsed = JSON.parse(currentPayload);
                                if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                                    const contentChunk = parsed.choices[0].delta.content;
                                    const toolCallChunk = parsed.choices[0].delta.tool_calls;

                                    if (contentChunk) {
                                        chrome.runtime.sendMessage({
                                            action: 'streamApiResponseChunk',
                                            chunk: contentChunk,
                                            tabId: tabId,
                                            prompt: promptContent
                                        }).catch(error => console.error(`Error sending streamApiResponseChunk: ${error.message}, tabId: ${tabId}`));
                                    }

                                    if (toolCallChunk) {
                                         chrome.runtime.sendMessage({
                                            action: 'streamApiToolCallChunk',
                                            toolCallChunk: toolCallChunk,
                                            tabId: tabId,
                                            prompt: promptContent
                                        }).catch(error => console.error(`Error sending streamApiToolCallChunk: ${error.message}, tabId: ${tabId}`));
                                    }
                                }
                            } catch (e) {
                                console.error("Background: Error parsing JSON from stream:", e, "Attempted to parse:", currentPayload);
                            }
                        } else if (currentPayload) {
                            // console.log("Background: SSE line not JSON or [DONE]:", currentPayload);
                        }
                    }
                }
            }
        } else {
            const responseData = await apiResponse.json();
            if (!responseData || !responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
                 // Check for tool_calls even if content is missing, as per OpenAI spec
                if (!(responseData.choices && responseData.choices[0] && responseData.choices[0].message && responseData.choices[0].message.tool_calls)) {
                    throw new Error('Invalid response format from API: Missing message content or tool_calls.');
                }
            }
            await _handleApiResponseAndSendMessage(responseData.choices[0].message, promptContent, tabId, isStartChat);
        }
    } catch (error) {
        console.error('Error in makeLlmApiRequest:', error); // Keep this top-level error log
        const errorDelay = isStartChat ? 300 : 200;
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: `Error: ${error.message}`,
                prompt: promptContent,
                tabId: tabId,
            }).catch(e => console.error(`Error sending setApiResponse (from generic catch): ${e.message}, tabId: ${tabId}`));
        }, errorDelay);
    }
}

// Create context menu items
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: 'oneoff_instruction',
    title: '✨ One-off Instruction',
    contexts: ['selection', 'image'],
  });
  chrome.contextMenus.create({
    id: 'start_chat',
    title: '💬 Start Chat',
    contexts: ['selection', 'image'],
  });
  chrome.contextMenus.create({
    id: 'prompt_paul',
    title: 'Query Prompt Paul',
    contexts: ['selection', 'image'],
  });
  const predefinedActions = [
    { id: 'summarize', title: '📝 Summarize' },
    { id: 'analyze', title: '🧐 Analyze' },
    { id: 'explain', title: '❓ Explain' },
    { id: 'polish', title: '🪄 Polish' },
    { id: 'shorten', title: '✂️ Shorten' },
    { id: 'formal', title: '💼 Formal' },
    { id: 'casual', title: '🤙 Casual' },
  ];
  predefinedActions.forEach(action => {
    chrome.contextMenus.create({
      id: action.id,
      title: action.title,
      contexts: ['selection', 'image'],
      parentId: 'prompt_paul',
    });
  });

  const { instructions } = await chrome.storage.local.get(['instructions']);
  await rebuildCustomInstructionsMenu(instructions || []);
});

// Update context menus when instructions change
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && changes.instructions) {
    const newInstructions = changes.instructions.newValue || [];
    await rebuildCustomInstructionsMenu(newInstructions);
  }
});

// --- Tool Execution Logic ---
async function getAllToolDefinitions() {
    const localTools = await new Promise((resolve) => {
        chrome.storage.local.get(['promptPaulTools'], (result) => {
            resolve(result.promptPaulTools || []);
        });
    });
    return localTools;
}

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

async function callUserDefinedEndpoint(endpointUrl, args, userDefinedMethod) {
    console.log(`Background: Calling user-defined endpoint: ${endpointUrl} with args:`, args); // Keep for debugging user tools
    try {
        const isEmptyArgs = !args || Object.keys(args).length === 0;
        let method = userDefinedMethod || (isEmptyArgs ? 'GET' : 'POST');
        method = method.toUpperCase();

        console.log(`Background: Using method ${method} (User defined: ${userDefinedMethod || 'Auto'}) for endpoint ${endpointUrl}`); // Keep for debugging user tools

        const fetchOptions = {
            method: method,
            headers: { 'Accept': 'application/json' },
        };

        let finalEndpointUrl = endpointUrl;
        if (method === 'GET' && !isEmptyArgs) {
            const queryParams = new URLSearchParams(args).toString();
            finalEndpointUrl = `${endpointUrl}?${queryParams}`;
            // console.log(`Background: Appended query params for GET request: ${queryParams}`); // Verbose, can be removed
        } else if (['POST', 'PUT', 'PATCH'].includes(method) && !isEmptyArgs) {
            fetchOptions.headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify(args);
        }

        const response = await fetch(finalEndpointUrl, fetchOptions);

        if (!response.ok) {
            let errorBody = '';
            try { errorBody = await response.text(); } catch (_) { /* Ignore */ }
            throw new Error(`HTTP error ${response.status}: ${response.statusText}. ${errorBody}`.trim());
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        } else {
            return await response.text();
        }

    } catch (error) {
        console.error(`Background: Error calling endpoint ${endpointUrl}:`, error); // Keep critical error
        throw new Error(`Failed to call endpoint ${endpointUrl}: ${error.message}`);
    }
}

const toolImplementations = {
   _callUserDefinedEndpoint: callUserDefinedEndpoint
};

function handleGetTabContent(request, sender, sendResponse) {
    tabContentCallback = sendResponse;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].id) {
            const activeTabId = tabs[0].id;
            chrome.scripting.executeScript({
                target: { tabId: activeTabId },
                files: ['content_script_tab_summary.js']
            }, (injectionResults) => {
                if (chrome.runtime.lastError || !injectionResults || !injectionResults.length) {
                    console.error('Failed to inject content_script_tab_summary.js:', chrome.runtime.lastError);
                    if (tabContentCallback) {
                        tabContentCallback({ action: 'tabContentResponse', success: false, error: 'Failed to inject script. ' + (chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Unknown error') });
                        tabContentCallback = null;
                    }
                }
            });
        } else {
            console.error('No active tab found for getTabContent.');
            if (tabContentCallback) {
                tabContentCallback({ action: 'tabContentResponse', success: false, error: 'No active tab found.' });
                tabContentCallback = null;
            }
        }
    });
    return true;
}

function handleExtractedTabContent(request, sender, sendResponse) {
    if (tabContentCallback) {
        if (request.success) {
            tabContentCallback({ action: 'tabContentResponse', success: true, content: request.data });
        } else {
            tabContentCallback({ action: 'tabContentResponse', success: false, error: request.error });
        }
        tabContentCallback = null;
    } else {
        console.warn("Received extractedTabContent but no pending callback.");
    }
    return false;
}

async function handleExecutePromptPaulTool(request, sender, sendResponse) {
    const { id, name, arguments: argsString } = request.toolCall;

    try {
        const allTools = await getAllToolDefinitions();
        const toolDefinition = allTools.find(t => t.name === name);

        if (!toolDefinition) {
            throw new Error(`Tool definition for '${name}' not found.`);
        }

        let args;
        try {
            args = JSON.parse(argsString || '{}');
        } catch (parseError) {
            throw new Error(`Invalid arguments format for tool '${name}'. Expected JSON. Received: ${argsString}`);
        }

        if (toolDefinition.endpointUrl) {
            const result = await callUserDefinedEndpoint(toolDefinition.endpointUrl, args, toolDefinition.httpMethod);
            sendResponse({ result: result });
        } else {
            const builtInFunction = toolImplementations[name];
            if (builtInFunction) {
                const result = await builtInFunction(args);
                sendResponse({ result: result });
            } else {
                throw new Error(`Tool '${name}' has no configured endpoint URL and no built-in implementation.`);
            }
        }
    } catch (error) {
        console.error(`Background: Error processing tool '${name}':`, error); // Keep critical error
        sendResponse({ error: error.message || 'Tool processing failed' });
    }
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case 'getTabContent':
            return handleGetTabContent(request, sender, sendResponse);
        case 'extractedTabContent':
            return handleExtractedTabContent(request, sender, sendResponse);
        case 'executePromptPaulTool':
            handleExecutePromptPaulTool(request, sender, sendResponse);
            return true;
        default:
            console.warn(`Background: Received unknown message action: ${request.action}`); // Keep this warning
            return false;
    }
});
