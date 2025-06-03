console.log('Background service worker script started.');
importScripts('marked.min.js');
console.log('marked.min.js imported successfully.');

let messageListenerAdded = false;
let tabContentCallback = null; // To store sendResponse for getTabContent

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
  let selectedText = info.selectionText; // Allow modification
  let promptContent = ''; // Initialize promptContent

  // Handle image context: Prepend image URL if present
  if (info.mediaType === 'image' && info.srcUrl) {
    const imageUrlText = `Image URL: ${info.srcUrl}`;
    if (selectedText) {
      selectedText = `${imageUrlText}\n${selectedText}`;
    } else {
      selectedText = imageUrlText;
    }
  }
  // At this point, selectedText contains the image URL and/or the selected text.
  // Initialize promptContent with this potentially modified selectedText.
  promptContent = selectedText;

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
        selectedText: promptContent, // Pass the combined content
        tabId: tab.id
      }).catch(error => console.log(`Error sending setSelectedText for one-off: ${error.message}, tabId: ${tab.id}`));
    }, 100);
    return;
  }

  // Handle start chat click - Open side panel immediately
  if (info.menuItemId === 'start_chat') {
    // Send message to chat.js with selected text (which now includes image URL if applicable)
    chrome.runtime.sendMessage({
      action: 'setSelectedText',
      selectedText: promptContent, // Pass the combined content
      tabId: tab.id,
      fromStartChat: true // Flag to indicate this is from the start_chat option
    }).catch(error => console.log(`Error sending setSelectedText for start_chat: ${error.message}, tabId: ${tab.id}`));
    
    // Call the refactored API request function with the combined content
    await makeLlmApiRequest(promptContent, tab.id, { isStartChat: true });
    return;
  }

  let instructionToolChoice = 'none'; // Default tool choice
  // promptContent is already initialized with selectedText (which could be an image URL, text, or both)

  if (info.menuItemId.startsWith('custom_')) {
    // Handle custom instruction
    const instructionId = info.menuItemId.replace('custom_', '');
    const { instructions } = await chrome.storage.local.get(['instructions']);
    const instruction = instructions.find(i => i.id === instructionId);
    if (instruction) {
      // Prepend instruction content. promptContent might be just an image URL,
      // or image URL + text, or just text.
      promptContent = `${instruction.content}\n\n${promptContent}`;
      instructionToolChoice = instruction.tool_choice || 'none'; // Get tool_choice, default to 'none'
    } else {
      console.error(`Custom instruction with ID ${instructionId} not found.`);
      // promptContent remains as is (selectedText, potentially with image URL)
    }
  } else {
    // Handle predefined commands
    // promptContent is already set (it includes image URL if applicable).
    // We need to ensure the specific command prompt is prepended correctly.
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
      // If it's not a predefined command, not custom, and not one of the special items above,
      // promptContent will just be the original selectedText (potentially with image URL).
      // This path handles cases like clicking on "Prompt Paul" parent item directly if it were to trigger this part,
      // or any other menu item that doesn't fit the specific command structure.
      default:
        // promptContent is already as needed (selectedText, possibly with image URL)
        break;
    }
  }

  // Call the refactored API request function
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

// ValidateConfig function to include API configuration
async function validateConfig() {
  return new Promise((resolve, reject) => {
    console.log('Background: Validating configuration...');
    // Fetch profiles, lastSelectedProfileId, and defaultLlmEndpoint simultaneously
    chrome.storage.local.get(['profiles', 'lastSelectedProfileId', 'defaultLlmEndpoint'], (result) => {
      console.log('Background: Storage get result:', result);
      const profiles = result.profiles || [];
      const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
      const defaultLlmEndpoint = result.defaultLlmEndpoint || ''; // Get default endpoint

      console.log('Background: Profiles:', profiles);
      console.log('Background: Last selected profile ID:', lastSelectedProfileId);
      console.log('Background: Default LLM Endpoint:', defaultLlmEndpoint);

      let selectedProfile = profiles.find(p => p.id === lastSelectedProfileId);
      let profileToUse = null;
      let endpointError = false;

      // Scenario 1: A selected profile exists
      if (selectedProfile) {
        console.log(`Background: Checking selected profile: ${selectedProfile.name || selectedProfile.id}`);
        // Check if its endpoint is valid
        if (selectedProfile.llmEndpoint && isValidURL(selectedProfile.llmEndpoint)) {
          // If endpoint is valid, check for API key and model name
          if (selectedProfile.apiKey && selectedProfile.modelName) {
            profileToUse = selectedProfile;
            console.log(`Background: Selected profile '${profileToUse.name || profileToUse.id}' is valid and complete.`);
          } else {
            // Endpoint is valid, but API key or model name is missing
            console.warn(`Background: Selected profile '${selectedProfile.name || selectedProfile.id}' has a valid endpoint but is missing API key or model name.`);
            // We will later check the default profile or reject with a generic error
          }
        } else {
          // Selected profile's endpoint is missing or invalid
          console.warn(`Background: Selected profile '${selectedProfile.name || selectedProfile.id}' has missing or invalid llmEndpoint. Attempting to use defaultLlmEndpoint.`);
          endpointError = true; // Mark that an endpoint issue was detected
          if (defaultLlmEndpoint && isValidURL(defaultLlmEndpoint)) {
            // Default LLM endpoint is valid, try to use it with the selected profile's other details
            if (selectedProfile.apiKey && selectedProfile.modelName) {
              // Create a temporary profile object with the default endpoint
              profileToUse = { ...selectedProfile, llmEndpoint: defaultLlmEndpoint };
              console.log(`Background: Using defaultLlmEndpoint for selected profile '${selectedProfile.name || selectedProfile.id}'.`);
            } else {
              // Default endpoint is ok, but selected profile still missing API key/model
              console.warn(`Background: defaultLlmEndpoint is valid, but selected profile '${selectedProfile.name || selectedProfile.id}' is still missing API key or model name.`);
            }
          } else {
            // Default LLM endpoint is also missing or invalid
            console.warn('Background: defaultLlmEndpoint is also missing or invalid.');
            // No need to set profileToUse, will proceed to defaultProfile check or reject
          }
        }
      } else {
        console.warn('Background: No selected profile found with ID:', lastSelectedProfileId);
        endpointError = true; // Potentially an endpoint issue if no profile is selected
      }

      // Scenario 2: If no valid profileToUse yet, try the default profile
      if (!profileToUse) {
        console.log('Background: No valid selected profile configuration yet. Checking default profile...');
        const defaultProfile = profiles.find(p => p.id === 'default');

        if (defaultProfile) {
          console.log('Background: Checking default profile.');
          // Check default profile's endpoint
          if (defaultProfile.llmEndpoint && isValidURL(defaultProfile.llmEndpoint)) {
            if (defaultProfile.apiKey && defaultProfile.modelName) {
              profileToUse = defaultProfile;
              endpointError = false; // Default profile has a valid endpoint
              console.log('Background: Using default profile as it is valid and complete.');
            } else {
              console.warn('Background: Default profile has a valid endpoint but is missing API key or model name.');
              // endpointError remains true if it was set by selectedProfile's endpoint failure
            }
          } else {
            // Default profile's endpoint is missing or invalid
            console.warn('Background: Default profile has missing or invalid llmEndpoint. Attempting to use defaultLlmEndpoint.');
            endpointError = true; // Mark that an endpoint issue was detected with default profile
            if (defaultLlmEndpoint && isValidURL(defaultLlmEndpoint)) {
              if (defaultProfile.apiKey && defaultProfile.modelName) {
                profileToUse = { ...defaultProfile, llmEndpoint: defaultLlmEndpoint };
                console.log('Background: Using defaultLlmEndpoint for default profile.');
                endpointError = false; // Using the global default endpoint successfully
              } else {
                  console.warn('Background: defaultLlmEndpoint is valid, but default profile is still missing API key or model name.');
              }
            } else {
              console.warn('Background: defaultLlmEndpoint is also missing or invalid (when checking for default profile).');
            }
          }
        } else {
          console.warn('Background: Default profile (id: "default") not found.');
          // endpointError remains true if it was set by selectedProfile's endpoint failure or no selected profile
        }
      }

      // Scenario 3: Final decision based on profileToUse and endpointError
      if (profileToUse && profileToUse.llmEndpoint && profileToUse.apiKey && profileToUse.modelName && isValidURL(profileToUse.llmEndpoint)) {
        console.log(`Background: Using configuration from profile: ${profileToUse.name || profileToUse.id}`);
        console.log('Background: Configuration:', {
          endpoint: profileToUse.llmEndpoint,
          key: profileToUse.apiKey ? '********' + profileToUse.apiKey.slice(-4) : 'Not set',
          model: profileToUse.modelName,
          systemPrompt: profileToUse.systemPrompt // also log systemPrompt
        });
        resolve(profileToUse);
      } else {
        // If no usable profile is found, decide on the error message
        if (endpointError && (!profileToUse || !isValidURL(profileToUse.llmEndpoint))) {
          // If an endpoint error was specifically identified and not resolved
          console.error('Background: Configuration rejected due to missing or invalid LLM API endpoint.');
          reject(new Error('LLM API endpoint is missing or invalid. Please configure it in the options page.'));
        } else {
          // For any other missing configuration (API key, model name, or profile entirely missing)
          console.error('Background: Configuration rejected due to incomplete general configuration.');
          reject(new Error('Configuration is incomplete. Please set up the API endpoint, API key, and model name in the options page.'));
        }
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
        if (config.systemPrompt && config.systemPrompt.trim() !== '') {
            messages.push({ role: 'system', content: config.systemPrompt });
        }
        messages.push({ role: 'user', content: promptContent });

        console.log('Background: Refactored API call. Tools sent to API:', formattedTools);

        let toolChoicePayload = {};
        let finalToolChoice = customInstructionToolChoice; // Use the value passed in

        // Normalize tool choice if it's an array containing 'none' or is empty
        if (Array.isArray(finalToolChoice)) {
            if (finalToolChoice.length === 0 || (finalToolChoice.length === 1 && finalToolChoice[0] === 'none')) {
                finalToolChoice = 'none';
            } else if (finalToolChoice.includes('auto')) {
                 finalToolChoice = 'auto'; // If 'auto' is present, treat as auto
            }
            // If it's an array of specific tools, keep it as an array
        } else if (finalToolChoice === undefined) {
            finalToolChoice = 'none'; // Default if not set
        }

        if (finalToolChoice === 'none') {
            // Case 1: No tools or tool_choice sent
            toolChoicePayload = {};
        } else if (finalToolChoice === 'auto') {
            // Case 2: All tools sent, tool_choice is "auto"
            if (formattedTools.length > 0) {
                toolChoicePayload = { tools: formattedTools, tool_choice: "auto" };
            } else {
                // If 'auto' is chosen but no tools are defined, send no tools
                toolChoicePayload = {};
            }
        } else if (Array.isArray(finalToolChoice)) {
            // Case 3: Specific tools selected
            const selectedToolNames = finalToolChoice;
            const selectedFormattedTools = formattedTools.filter(tool => selectedToolNames.includes(tool.function.name));

            if (selectedFormattedTools.length > 0) {
                 let specificToolChoiceFormat;
                 if (selectedFormattedTools.length === 1) {
                     // API expects { type: 'function', function: { name: 'tool_name' } } for a single specific tool
                     specificToolChoiceFormat = { type: 'function', function: { name: selectedFormattedTools[0].function.name } };
                 } else {
                     // API expects [{ type: 'function', function: { name: 'tool1' } }, ...] for multiple specific tools
                     specificToolChoiceFormat = selectedFormattedTools.map(tool => ({ type: 'function', function: { name: tool.function.name } }));
                 }
                 toolChoicePayload = { tools: selectedFormattedTools, tool_choice: specificToolChoiceFormat };
            } else {
                // If specific tools were selected but none of them are defined/formatted correctly, send no tools
                toolChoicePayload = {};
            }
        } else {
            // Fallback for unexpected values, treat as none
            console.warn(`Background: Unexpected tool choice value: ${finalToolChoice}. Treating as 'none'.`);
            toolChoicePayload = {};
        }

        // If formattedTools is empty, toolChoicePayload remains {}, and no 'tools' or 'tool_choice' is sent to the API.

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
                                        console.log("Background: Received tool_call delta (streaming):", toolCallChunk);
                                         chrome.runtime.sendMessage({
                                            action: 'streamApiToolCallChunk',
                                            toolCallChunk: toolCallChunk,
                                            tabId: tabId,
                                            prompt: promptContent
                                        }).catch(error => console.log(`Error sending streamApiToolCallChunk: ${error.message}, tabId: ${tabId}`));
                                    }
                                }
                            } catch (e) {
                                console.error("Background: Error parsing JSON from stream:", e, "Attempted to parse:", currentPayload, "Original full line:", line);
                            }
                        } else if (currentPayload) {
                            // Log if it's not [DONE] and not starting with { or [ after stripping data:
                            console.log("Background: SSE line does not appear to be JSON or [DONE] after stripping prefixes. Payload:", currentPayload, "Original line:", line);
                        }
                        // If currentPayload is empty after stripping, it's ignored.
                    }
                }
            }
            // After stream finishes, if there was any remaining data in buffer that was a valid data line (unlikely if stream ends cleanly)
            // it could be processed here. However, typically the stream ends after the last complete message.

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
console.log("Background: Attempting to add onMessage listener NOW...");
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getTabContent') {
        // Store the sendResponse function to call it later
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
                            // Send a structured response consistent with chat.js expectations
                            tabContentCallback({ action: 'tabContentResponse', success: false, error: 'Failed to inject script. ' + (chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Unknown error') });
                            tabContentCallback = null; // Clear callback
                        }
                    }
                    // If injection is successful, we wait for 'extractedTabContent' message
                });
            } else {
                console.error('No active tab found for getTabContent.');
                if (tabContentCallback) {
                    // Send a structured response
                    tabContentCallback({ action: 'tabContentResponse', success: false, error: 'No active tab found.' });
                    tabContentCallback = null; // Clear callback
                }
            }
        });
        return true; // Indicates that sendResponse will be called asynchronously.
    } else if (request.action === 'extractedTabContent') {
        if (tabContentCallback) {
            // Send a structured response consistent with chat.js expectations for tabContentResponse
            if (request.success) {
                tabContentCallback({ action: 'tabContentResponse', success: true, content: request.data });
            } else {
                tabContentCallback({ action: 'tabContentResponse', success: false, error: request.error });
            }
            tabContentCallback = null; // Clear callback after use
        } else {
            console.warn("Received extractedTabContent but no pending callback.");
        }
        return false; // No further async response from this branch.
    } else if (request.action === 'executePromptPaulTool') {
        const { id, name, arguments: argsString } = request.toolCall;
        // This is the log that was appearing multiple times (e.g., background.js:692)
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
        return true; // Crucial for async sendResponse
    }
    // Handle other actions if any
});
console.log("Background: onMessage listener function HAS BEEN registered.");
