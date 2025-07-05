import './marked.min.js';
// import { SandboxManager } from './sandbox_manager.js'; // SandboxManager removed
console.log('marked.min.js imported successfully.');
console.log('Background service worker script started.');


// const sandboxManager = new SandboxManager(); // SandboxManager removed
// const SANDBOX_INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes // SandboxManager removed

let messageListenerAdded = false;
let tabContentCallback = null; // To store sendResponse for getTabContent
let pinnedActionTabContentCallback = null; // To store sendResponse for getPinnedActionTabContent
let isSmartClipboardEnabled = false; // Cache the setting in background

// Load initial smart clipboard setting
chrome.storage.sync.get({ enableSmartClipboard: false }, (result) => {
    isSmartClipboardEnabled = !!result.enableSmartClipboard;
    console.log("Background: Initial Smart Clipboard enabled state:", isSmartClipboardEnabled);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
});

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
  } else if (info.menuItemId === 'chat_with_pdf') {
    console.log("Background: 'chat_with_pdf' context menu clicked.");
    // Side panel is already opened at the top of the onClicked listener.

    const pdfUrl = info.linkUrl || info.pageUrl;
    if (!pdfUrl) {
        console.error("Background: No PDF URL found for chat_with_pdf action.");
        chrome.runtime.sendMessage({
            action: 'displayErrorInChat',
            errorMessage: "Could not determine the PDF URL.",
            tabId: tab.id
        }).catch(e => console.error("Error sending displayErrorInChat for no PDF URL:", e));
        return;
    }

    // Scenario 1: User is currently viewing the PDF page.
    if (info.pageUrl && info.pageUrl === tab.url && info.pageUrl.toLowerCase().endsWith('.pdf')) {
        console.log(`Background: Requesting PDF text from current tab: ${tab.id}, URL: ${info.pageUrl}`);
        chrome.tabs.sendMessage(tab.id, { action: 'extractPdfText' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Background: Error sending 'extractPdfText' to content script:", chrome.runtime.lastError.message);
                chrome.runtime.sendMessage({
                    action: 'displayErrorInChat',
                    errorMessage: `Failed to communicate with PDF content script: ${chrome.runtime.lastError.message}`,
                    tabId: tab.id
                }).catch(e => console.error("Error sending displayErrorInChat for communication error:", e));
                return;
            }

            if (response && response.success) {
                console.log("Background: PDF text successfully extracted from current tab.");
                chrome.runtime.sendMessage({
                    action: 'startChatWithPdfContent',
                    pdfText: response.content,
                    pdfUrl: info.pageUrl,
                    tabId: tab.id
                }).catch(e => console.error("Error sending startChatWithPdfContent:", e));
            } else {
                console.error("Background: Failed to extract PDF text from current tab.", response ? response.error : "No response");
                chrome.runtime.sendMessage({
                    action: 'displayErrorInChat',
                    errorMessage: `Failed to extract text from PDF: ${response ? response.error : 'Unknown error'}`,
                    tabId: tab.id
                }).catch(e => console.error("Error sending displayErrorInChat for extraction failure:", e));
            }
        });
    }
    // Scenario 2: User clicked a link to a PDF.
    else if (info.linkUrl && info.linkUrl.toLowerCase().endsWith('.pdf')) {
        console.log(`Background: Clicked on a link to PDF: ${info.linkUrl}. This will be handled by opening in a new tab.`);
        openPdfLinkAndExtract(info.linkUrl, tab.id);
    } else {
        console.warn("Background: 'chat_with_pdf' clicked, but URL doesn't seem to be a PDF or context is unclear.", info);
        chrome.runtime.sendMessage({
            action: 'displayErrorInChat',
            errorMessage: "Could not identify a valid PDF to process from the current context.",
            tabId: tab.id
        }).catch(e => console.error("Error sending displayErrorInChat for unclear context:", e));
    }
    return;
  }

  // Handle custom instructions
  if (info.menuItemId.startsWith('custom_')) {
    const instructionId = info.menuItemId.replace('custom_', '');
    console.log("Handling custom instruction. ID:", instructionId);
    try {
      const result = await new Promise((resolve, reject) => {
        chrome.storage.local.get(['instructions'], (data) => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }
          resolve(data);
        });
      });

      const instructions = result.instructions || []; // Default to empty array
      const instruction = instructions.find(i => i.id === instructionId);

      if (instruction) {
        promptContent = `${instruction.content}\n\n${promptContent}`;
        console.log("Final promptContent with instruction (custom):", promptContent.substring(0, 100));
        const toolChoice = instruction.tool_choice || 'none';
        console.log("Calling makeLlmApiRequest for menuItemId (custom):", info.menuItemId, "with tool_choice:", toolChoice);
        await makeLlmApiRequest(promptContent, tab.id, { customInstructionToolChoice: toolChoice });
      } else {
        console.error("Custom instruction not found for ID:", instructionId);
         chrome.runtime.sendMessage({
            action: 'displayErrorInChat',
            errorMessage: `Custom instruction with ID '${instructionId}' not found.`,
            tabId: tab.id
        }).catch(e => console.error("Error sending displayErrorInChat for missing custom instruction:", e));
      }
    } catch (error) {
      console.error("Error fetching custom instructions:", error);
      chrome.runtime.sendMessage({
            action: 'displayErrorInChat',
            errorMessage: `Error loading custom instruction: ${error.message}`,
            tabId: tab.id
        }).catch(e => console.error("Error sending displayErrorInChat for custom instruction load failure:", e));
    }
    return;
  } else if (info.menuItemId === 'chat_with_pdf') {
    console.log("Background: 'chat_with_pdf' context menu clicked.");
    // Ensure side panel is open for the current tab
    // await chrome.sidePanel.open({ tabId: tab.id }); // Already done at the top of onClicked

    const pdfUrl = info.linkUrl || info.pageUrl;
    if (!pdfUrl) {
        console.error("Background: No PDF URL found for chat_with_pdf action.");
        chrome.runtime.sendMessage({
            action: 'displayErrorInChat',
            errorMessage: "Could not determine the PDF URL.",
            tabId: tab.id
        }).catch(e => console.error("Error sending displayErrorInChat for no PDF URL:", e));
        return;
    }

    // Scenario 1: User is currently viewing the PDF page.
    if (info.pageUrl && info.pageUrl === tab.url && info.pageUrl.toLowerCase().endsWith('.pdf')) {
        console.log(`Background: Requesting PDF text from current tab: ${tab.id}, URL: ${info.pageUrl}`);
        chrome.tabs.sendMessage(tab.id, { action: 'extractPdfText' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Background: Error sending 'extractPdfText' to content script:", chrome.runtime.lastError.message);
                chrome.runtime.sendMessage({
                    action: 'displayErrorInChat',
                    errorMessage: `Failed to communicate with PDF content script: ${chrome.runtime.lastError.message}`,
                    tabId: tab.id
                }).catch(e => console.error("Error sending displayErrorInChat for communication error:", e));
                return;
            }

            if (response && response.success) {
                console.log("Background: PDF text successfully extracted from current tab.");
                chrome.runtime.sendMessage({
                    action: 'startChatWithPdfContent',
                    pdfText: response.content,
                    pdfUrl: info.pageUrl,
                    tabId: tab.id
                }).catch(e => console.error("Error sending startChatWithPdfContent:", e));
            } else {
                console.error("Background: Failed to extract PDF text from current tab.", response ? response.error : "No response");
                chrome.runtime.sendMessage({
                    action: 'displayErrorInChat',
                    errorMessage: `Failed to extract text from PDF: ${response ? response.error : 'Unknown error'}`,
                    tabId: tab.id
                }).catch(e => console.error("Error sending displayErrorInChat for extraction failure:", e));
            }
        });
    }
    // Scenario 2: User clicked a link to a PDF.
    else if (info.linkUrl && info.linkUrl.toLowerCase().endsWith('.pdf')) {
        console.log(`Background: Clicked on a link to PDF: ${info.linkUrl}. This will be handled by opening in a new tab.`);
        openPdfLinkAndExtract(info.linkUrl, tab.id);
    } else {
        console.warn("Background: 'chat_with_pdf' clicked, but URL doesn't seem to be a PDF or context is unclear.", info);
        chrome.runtime.sendMessage({
            action: 'displayErrorInChat',
            errorMessage: "Could not identify a valid PDF to process from the current context.",
            tabId: tab.id
        }).catch(e => console.error("Error sending displayErrorInChat for unclear context:", e));
    }
    return; // Ensure this specific action pathway returns
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

// Helper function to open PDF link in a new tab and manage extraction
// This needs to be defined outside the onClicked listener to be accessible.
const pdfLinkExtractionJobs = {}; // Store job details: { originalTabId, sendResponseToChat }

async function openPdfLinkAndExtract(pdfLinkUrl, originalTabId) {
    console.log(`Background: Opening PDF link in new tab for extraction: ${pdfLinkUrl}`);
    try {
        const newPdfTab = await chrome.tabs.create({ url: pdfLinkUrl, active: false });
        pdfLinkExtractionJobs[newPdfTab.id] = { originalTabId, pdfUrl: pdfLinkUrl, status: 'opening' };
        console.log(`Background: New tab ${newPdfTab.id} created for PDF. Job details stored.`);
    } catch (error) {
        console.error(`Background: Error creating new tab for PDF link ${pdfLinkUrl}:`, error);
        chrome.runtime.sendMessage({
            action: 'displayErrorInChat',
            errorMessage: `Failed to open PDF link: ${error.message}`,
            tabId: originalTabId
        }).catch(e => console.error("Error sending displayErrorInChat for tab creation failure:", e));
    }
}


// Listener for tab updates, specifically for our temporary PDF tabs
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const job = pdfLinkExtractionJobs[tabId];
    if (job && job.status === 'opening' && changeInfo.status === 'complete') {
        console.log(`Background: Temporary PDF tab ${tabId} finished loading. URL: ${tab.url}`);
        job.status = 'loaded';

        // Wait a brief moment for content script to potentially initialize
        await new Promise(resolve => setTimeout(resolve, 500));

        console.log(`Background: Sending 'extractPdfText' to temporary tab ${tabId}`);
        chrome.tabs.sendMessage(tabId, { action: 'extractPdfText' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(`Background: Error sending 'extractPdfText' to temp tab ${tabId}:`, chrome.runtime.lastError.message);
                chrome.runtime.sendMessage({
                    action: 'displayErrorInChat',
                    errorMessage: `Failed to communicate with PDF content script in new tab: ${chrome.runtime.lastError.message}`,
                    tabId: job.originalTabId
                }).catch(e => console.error("Error sending displayErrorInChat for temp tab communication error:", e));
                return;
            }

            if (response && response.success) {
                console.log(`Background: PDF text successfully extracted from temp tab ${tabId}.`);
                chrome.runtime.sendMessage({
                    action: 'startChatWithPdfContent',
                    pdfText: response.content,
                    pdfUrl: job.pdfUrl, // Use the original link URL for context
                    tabId: job.originalTabId
                }).catch(e => console.error("Error sending startChatWithPdfContent from temp tab:", e));
            } else {
                console.error(`Background: Failed to extract PDF text from temp tab ${tabId}.`, response ? response.error : "No response");
                chrome.runtime.sendMessage({
                    action: 'displayErrorInChat',
                    errorMessage: `Failed to extract text from linked PDF: ${response ? response.error : 'Unknown error'}`,
                    tabId: job.originalTabId
                }).catch(e => console.error("Error sending displayErrorInChat for temp tab extraction failure:", e));
            }

            // Clean up: close the temporary tab and remove job
            chrome.tabs.remove(tabId).catch(e => console.warn(`Error removing temp PDF tab ${tabId}:`, e));
            delete pdfLinkExtractionJobs[tabId];
            console.log(`Background: Temporary PDF tab ${tabId} closed and job removed.`);
        });
    } else if (job && job.status === 'opening' && changeInfo.status === 'loading' && tab.url && !tab.url.startsWith('chrome://')) {
        // Sometimes PDF viewers might redirect or have intermediate loading states.
        // If the URL changes to something that's not the initial PDF link (and not a chrome internal page),
        // it might indicate an issue or a different PDF viewer.
        // This is a heuristic and might need refinement.
        if (tab.url !== job.pdfUrl && !tab.url.toLowerCase().endsWith('.pdf')) {
             console.warn(`Background: Temporary PDF tab ${tabId} navigated to unexpected URL: ${tab.url}. Original: ${job.pdfUrl}`);
        }
    }
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

        const now = new Date();        const currentDateTime = `Current date and time: ${now.toLocaleString()}`;        const promptWithDateTime = `${currentDateTime}\n\n${promptContent}`;

        const messages = [];        if (config.systemPrompt && config.systemPrompt.trim() !== '') {            messages.push({ role: 'system', content: config.systemPrompt });        }        messages.push({ role: 'user', content: promptWithDateTime });

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
                apiResponse: `Error: ${error.message}`,
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

  // Create "Chat with this PDF" menu item
  chrome.contextMenus.create({
    id: 'chat_with_pdf',
    title: '📄 Chat with this PDF',
    contexts: ['link', 'page'],
    targetUrlPatterns: ["*://*/*.pdf", "*://*/*.PDF", "file://*/*.pdf", "file://*/*.PDF"],
    documentUrlPatterns: ["*://*/*.pdf", "*://*/*.PDF", "file://*/*.pdf", "file://*/*.PDF"]
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
async function callUserDefinedEndpoint(endpointUrl, args, userDefinedMethod) {
    console.log(`Background: Calling user-defined endpoint: ${endpointUrl} with args:`, args);
    try {
        let finalEndpointUrl = endpointUrl;
        let finalFetchOptions = {
            headers: {
                'Accept': 'application/json'
            }
        };
        const isEmptyArgs = !args || Object.keys(args).length === 0;
        let method = userDefinedMethod || (isEmptyArgs ? 'GET' : 'POST');
        method = method.toUpperCase();
        finalFetchOptions.method = method;
        console.log(`Background: Using method ${method} (User defined: ${userDefinedMethod || 'Auto'}) for endpoint ${finalEndpointUrl}`);

        if (method === 'GET' && !isEmptyArgs) {
            const queryParams = new URLSearchParams(args).toString();
            finalEndpointUrl = `${finalEndpointUrl}?${queryParams}`;
            console.log(`Background: Appended query params for GET request: ${queryParams}`);
        } else if (['POST', 'PUT', 'PATCH'].includes(method) && !isEmptyArgs) {
            finalFetchOptions.headers['Content-Type'] = 'application/json';
            finalFetchOptions.body = JSON.stringify(args);
        }
        
        console.log("Background: Webhook Fetch Details:", { endpointUrl: finalEndpointUrl, fetchOptions: finalFetchOptions });

        const response = await fetch(finalEndpointUrl, finalFetchOptions);

        if (!response.ok) {
            let errorBody = '';
            try {
                errorBody = await response.text();
            } catch (_) { /* Ignore if body cannot be read */ }
            throw new Error(`HTTP error ${response.status}: ${response.statusText}. ${errorBody}`.trim());
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        } else {
            return await response.text();
        }

    } catch (error) {
        console.error(`Background: Error calling endpoint ${endpointUrl}:`, error);
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
    // Removed startSandbox and stopSandbox logic as MCP feature is deprecated.
    // if (request.action === 'startSandbox') {
    //     (async () => {
    //         const tool = mcpClientRegistry.getToolSchema(request.toolId);
    //         if (tool) {
    //             try {
    //                 await sandboxManager.startSandbox(tool);
    //                 sendResponse({ success: true });
    //             } catch (error) {
    //                 sendResponse({ success: false, error: error.message });
    //             }
    //         } else {
    //             sendResponse({ success: false, error: `Tool with id ${request.toolId} not found.` });
    //         }
    //     })();
    //     return true;
    // } else if (request.action === 'stopSandbox') {
    //     (async () => {
    //         try {
    //             await sandboxManager.stopSandbox(request.toolId);
    //             sendResponse({ success: true });
    //         } catch (error) {
    //             sendResponse({ success: false, error: error.message });
    //         }
    //     })();
    //     return true;
    // }
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
                content: result.content, // Changed from result.data
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
                content: result.content, // Changed from result.data
                // data: result.data, // Removed redundant field
                error: result.error,
                instruction: request.instruction // Echo back instruction on success
            });
            pinnedActionTabContentCallback = null;
        }
    }
 else {
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
                content: result.content, // Changed from result.data
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

                // Removed stdio tool type handling as MCP feature is deprecated.
                // if (toolDefinition.type === 'stdio') {
                //     try {
                //         const sandbox = await sandboxManager.startSandbox(toolDefinition);
                //         // Assuming sandbox provides a way to call tools directly or a simplified client
                //         // For now, we'll assume direct execution if it's a stdio tool
                //         // In a real scenario, you'd have a client for stdio tools as well
                //         // For simplicity, we'll just return a mock result for now
                //         sendResponse({ result: { output: `Executed stdio tool ${name} with args ${JSON.stringify(argsObject)}` } });

                //         // Reset inactivity timer
                //         if (sandbox.inactivityTimer) {
                //             clearTimeout(sandbox.inactivityTimer);
                //         }
                //         sandbox.inactivityTimer = setTimeout(() => {
                //             sandboxManager.stopSandbox(toolDefinition.id);
                //         }, SANDBOX_INACTIVITY_TIMEOUT);

                //     } catch (error) {
                //         console.error(`Error executing tool ${name} in sandbox:`, error);
                //         sendResponse({ error: `Failed to execute tool ${name} in sandbox: ${error.message}` });
                //     }
                // } else
                if (toolDefinition.endpointUrl) {
                    console.log(`Executing '${name}' as a user-defined HTTP tool via ${toolDefinition.endpointUrl}`);
                    const result = await callUserDefinedEndpoint(toolDefinition.endpointUrl, argsObject, toolDefinition.httpMethod);
                    console.log(`Background: User-defined tool '${name}' executed successfully via endpoint. Result:`, result);
                    sendResponse({ result: result });
                } else {
                    const builtInFunction = toolImplementations[name];
                    if (builtInFunction) {
                        console.log(`Executing '${name}' as a built-in tool.`);
                        const result = await builtInFunction(argsObject);
                        console.log(`Background: Built-in tool '${name}' executed successfully. Result:`, result);
                        sendResponse({ result: result });
                    } else {
                        throw new Error(`Tool '${name}' is not properly configured: It has no endpointUrl, and no built-in implementation.`);
                    }
                }

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
    } else if (request.action === 'QUICK_ACTION') {
        console.log("Background: QUICK_ACTION received", request);
        const { instruction, tabContent } = request;
        if (!instruction || !tabContent) {
            console.error("Background: Missing instruction or tabContent in QUICK_ACTION");
            return;
        }

        const prompt = `${instruction}\n\n${tabContent}`;
        console.log("Background: QUICK_ACTION prompt:", prompt.substring(0, 100) + "...");

        // Call the existing LLM API function
        makeLlmApiRequest(prompt, request.tabId);
    } else if (request.action === 'smartClipboardSettingChanged') {
        isSmartClipboardEnabled = !!request.enabled;
        console.log("Background: Smart Clipboard setting changed to:", isSmartClipboardEnabled);
        // No sendResponse needed for this notification
    } else if (request.action === 'textCopied') {
        if (isSmartClipboardEnabled) {
            console.log("Background: Received 'textCopied' message. Smart Clipboard is enabled. Proceeding."); // Added logging
            console.log("Background: Text copied and Smart Clipboard enabled. Copied text:", request.copiedText.substring(0, 100) + "...");
            // Open side panel and send message to chat.js
            // Need the current tab's ID to open the side panel in context.
            // The 'sender' object in onMessage listener has a 'tab' property if sent from a content script.
            if (sender && sender.tab && sender.tab.id) {
                const currentTabId = sender.tab.id;
                (async () => {
                    try {
                        console.log("Background: Attempting to open side panel for tab:", currentTabId);
                        await chrome.sidePanel.open({ tabId: currentTabId });
                        // Send message to chat.js AFTER side panel is confirmed or attempted to open
                        // Adding a small delay to ensure chat.js might be ready if panel was just opened.
                        setTimeout(() => {
                            chrome.runtime.sendMessage({
                                action: 'showSmartClipboardUI',
                                copiedText: request.copiedText,
                                tabId: currentTabId // Pass tabId for chat.js if needed
                            }).catch(err => console.warn("Background: Error sending 'showSmartClipboardUI' message, chat.js might not be ready.", err.message));
                        }, 150); // 150ms delay
                    } catch (e) {
                        console.error("Background: Error opening side panel for smart clipboard.", e);
                    }
                })();
            } else {
                console.warn("Background: 'textCopied' received, but sender tab ID is missing. Cannot open side panel reliably.");
            }
        } else {
            console.log("Background: Text copied, but Smart Clipboard is disabled.");
        }
        // No sendResponse needed for this notification
    } else if (request.action === 'getTabUrlForDynamicActions') {
        if (sender && sender.tab && sender.tab.id) {
            chrome.tabs.get(sender.tab.id, (tab) => {
                if (chrome.runtime.lastError) {
                    console.error("Background: Error getting tab URL for dynamic actions:", chrome.runtime.lastError.message);
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                } else if (tab) {
                    sendResponse({ success: true, url: tab.url, tabId: tab.id });
                } else {
                    sendResponse({ success: false, error: "Tab not found." });
                }
            });
        } else {
             // If not sent from a tab context (e.g. popup or options page, though less likely for this action)
             // try to get the active tab of the current window.
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs.length > 0) {
                    sendResponse({ success: true, url: tabs[0].url, tabId: tabs[0].id });
                } else {
                    console.error("Background: No active tab found for getTabUrlForDynamicActions.");
                    sendResponse({ success: false, error: "No active tab found." });
                }
            });
        }
        return true; // Indicates asynchronous response
    }
    // Handle other actions if any
});
console.log("Background: onMessage listener function HAS BEEN registered.");