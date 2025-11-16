import './marked.min.js';
import analytics from './analytics.js';
import { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync, handleChromeApiCall } from './errorHandler.js';

// Initialize analytics and error handler modules
Promise.all([
  analytics.initialize().catch(error => console.warn('Failed to initialize analytics:', error)),
  errorHandler.initialize().catch(error => console.warn('Failed to initialize error handler:', error))
]);

// Create context menus for images and other media
chrome.runtime.onInstalled.addListener(async (details) => {
    await wrapAsync(async () => {
        // Track install/update event once
        try {
            await analytics.trackInstalled();
        } catch (error) {
            await errorHandler.handleError(createError('Failed to track installation', {
                category: ErrorCategory.ANALYTICS,
                severity: ErrorSeverity.LOW,
                originalError: error
            }));
        }

        // Create context menus with error handling
        const menuItems = [
            // Parent menu for images
            { id: "imageAnalysis", title: "Analyze Image with Prompt Paul", contexts: ["image"] },
            // Quick actions for images
            { id: "analyzeImage", parentId: "imageAnalysis", title: "🔍 General Analysis", contexts: ["image"] },
            { id: "summarizeImage", parentId: "imageAnalysis", title: "📝 Summarize Image", contexts: ["image"] },
            { id: "explainImage", parentId: "imageAnalysis", title: "💡 Explain Image", contexts: ["image"] },
            // Separator for images
            { id: "imageSeparator", parentId: "imageAnalysis", type: "separator", contexts: ["image"] },
            // Parent menu for videos
            { id: "videoAnalysis", title: "Analyze Video with Prompt Paul", contexts: ["video"] },
            { id: "analyzeVideo", parentId: "videoAnalysis", title: "🎥 General Analysis", contexts: ["video"] },
            // Parent menu for audio
            { id: "audioAnalysis", title: "Analyze Audio with Prompt Paul", contexts: ["audio"] },
            { id: "analyzeAudio", parentId: "audioAnalysis", title: "🎵 General Analysis", contexts: ["audio"] }
        ];

        // Create all menu items with error handling
        for (const item of menuItems) {
            try {
                await handleChromeApiCall((callback) => chrome.contextMenus.create(item, callback));
            } catch (error) {
                await errorHandler.handleError(createError(`Failed to create context menu: ${item.title}`, {
                    category: ErrorCategory.CHROME_API,
                    severity: ErrorSeverity.MEDIUM,
                    context: { menuItem: item },
                    originalError: error
                }));
            }
        }

        // Load and add custom instructions for images
        try {
            await updateImageCustomInstructions();
        } catch (error) {
            await errorHandler.handleError(createError('Failed to update image custom instructions', {
                category: ErrorCategory.CONFIGURATION,
                severity: ErrorSeverity.MEDIUM,
                originalError: error
            }));
        }
    }, {
        category: ErrorCategory.SYSTEM,
        userMessage: 'Failed to initialize extension context menus'
    });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    await wrapAsync(async () => {
        if (info.menuItemId === "analyzeImage" || info.menuItemId === "analyzeVideo" || info.menuItemId === "analyzeAudio" ||
            info.menuItemId === "summarizeImage" || info.menuItemId === "explainImage" ||
            info.menuItemId.startsWith("imageCustom_")) {

            // Open side panel FIRST (must be in direct response to user gesture)
            try {
                await handleChromeApiCall((callback) => chrome.sidePanel.open({ tabId: tab.id }, callback));
            } catch (error) {
                throw createError('Failed to open side panel', {
                    category: ErrorCategory.CHROME_API,
                    severity: ErrorSeverity.HIGH,
                    retryable: true,
                    originalError: error
                });
            }

            // Get the media URL and determine action type
            const mediaUrl = info.srcUrl;
            if (!mediaUrl) {
                throw createError('No media URL found', {
                    category: ErrorCategory.USER_INPUT,
                    severity: ErrorSeverity.MEDIUM,
                    context: { menuItemId: info.menuItemId }
                });
            }

            let mediaType, actionType, instructionId;

            if (info.menuItemId.startsWith("imageCustom_")) {
                mediaType = "image";
                actionType = "custom";
                instructionId = info.menuItemId.replace("imageCustom_", "");
            } else if (info.menuItemId === "summarizeImage") {
                mediaType = "image";
                actionType = "summarize";
            } else if (info.menuItemId === "explainImage") {
                mediaType = "image";
                actionType = "explain";
            } else {
                // Default analysis (analyzeImage, analyzeVideo, analyzeAudio)
                mediaType = info.menuItemId.replace("analyze", "").toLowerCase();
                actionType = "analyze";
            }

            // Show loading message immediately
            try {
                chrome.runtime.sendMessage({
                    action: 'setMediaForAnalysis',
                    mediaData: {
                        type: mediaType,
                        base64: null, // Will be set later
                        url: mediaUrl,
                        mimeType: getMimeTypeFromUrl(mediaUrl),
                        loading: true
                    },
                    tabId: tab.id
                });
            } catch (error) {
                console.log('Side panel not ready yet, will send message after image loads');
            }

            // Convert media to base64 for API (async operation)
            const base64Data = await fetchMediaAsBase64(mediaUrl);
            const mimeType = getMimeTypeFromUrl(mediaUrl);
            console.log('Sending media data:', {
                type: mediaType,
                url: mediaUrl,
                mimeType: mimeType,
                base64Length: base64Data.length
            });

            // Send the actual media data (with retry logic for side panel)
            const sendMediaData = () => {
                try {
                    chrome.runtime.sendMessage({
                        action: 'setMediaForAnalysis',
                        mediaData: {
                            type: mediaType,
                            base64: base64Data,
                            url: mediaUrl,
                            mimeType: mimeType,
                            loading: false,
                            actionType: actionType,
                            instructionId: instructionId
                        },
                        tabId: tab.id
                    });
                } catch (error) {
                    console.log('Retrying message send in 500ms...');
                    setTimeout(sendMediaData, 500);
                }
            };

            // Give side panel time to load if it was just opened
            setTimeout(sendMediaData, 1000);
        }
    }, {
        category: ErrorCategory.TOOL_EXECUTION,
        userMessage: 'Failed to process media for analysis',
        retryable: true,
        retryCallback: async () => {
            // Retry the media processing with exponential backoff
            await new Promise(resolve => setTimeout(resolve, 1000));
            return chrome.contextMenus.onClicked.addListener({ ...arguments[0] });
        }
    }).catch(async error => {
        // Handle media fetching errors specifically
        if (error.message.includes('fetchMediaAsBase64') || error.category === ErrorCategory.NETWORK) {
            await errorHandler.handleError(error);

            // Send error message to side panel
            try {
                chrome.runtime.sendMessage({
                    action: 'setMediaForAnalysis',
                    mediaData: {
                        type: mediaType || 'unknown',
                        base64: null,
                        url: info.srcUrl,
                        mimeType: getMimeTypeFromUrl(info.srcUrl),
                        error: error.userMessage || error.message
                    },
                    tabId: tab.id
                });
            } catch (messageError) {
                console.warn('Failed to send error message to side panel:', messageError);
            }
        } else {
            await errorHandler.handleError(error);
        }
    });
});

// Helper function to fetch media and convert to base64
async function fetchMediaAsBase64(url) {
    return await wrapAsync(async () => {
        console.log('Fetching media from URL:', url);

        if (!url) {
            throw createError('No URL provided for media fetching', {
                category: ErrorCategory.USER_INPUT,
                severity: ErrorSeverity.MEDIUM
            });
        }

        const response = await fetch(url);

        if (!response.ok) {
            throw createError(`Failed to fetch media: ${response.status} ${response.statusText}`, {
                category: ErrorCategory.NETWORK,
                severity: ErrorSeverity.HIGH,
                retryable: true,
                context: {
                    url,
                    status: response.status,
                    statusText: response.statusText
                }
            });
        }

        const blob = await response.blob();
        console.log('Blob size:', blob.size, 'Type:', blob.type);

        if (blob.size > 50 * 1024 * 1024) { // 50MB limit
            throw createError('Media file too large (max 50MB)', {
                category: ErrorCategory.VALIDATION,
                severity: ErrorSeverity.MEDIUM,
                context: { size: blob.size, url }
            });
        }

        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const dataUrl = reader.result;
                    console.log('DataURL prefix:', dataUrl.substring(0, 50));
                    const base64 = dataUrl.split(',')[1]; // Remove data:image/jpeg;base64, prefix
                    console.log('Base64 length:', base64.length);
                    console.log('Base64 sample:', base64.substring(0, 100));
                    resolve(base64);
                } catch (error) {
                    reject(createError('Failed to process media data URL', {
                        category: ErrorCategory.SYSTEM,
                        severity: ErrorSeverity.MEDIUM,
                        originalError: error
                    }));
                }
            };
            reader.onerror = (error) => {
                reject(createError('FileReader error while processing media', {
                    category: ErrorCategory.SYSTEM,
                    severity: ErrorSeverity.MEDIUM,
                    originalError: error
                }));
            };
            reader.readAsDataURL(blob);
        });
    }, {
        category: ErrorCategory.NETWORK,
        userMessage: 'Failed to fetch and process media file',
        retryable: true
    });
}

// Track existing image custom instruction menu items
let existingImageCustomMenuItems = new Set();

// Helper function to update image custom instructions in context menu
async function updateImageCustomInstructions() {
    return await wrapAsync(async () => {
        // Remove existing custom instruction menu items
        for (const menuItemId of existingImageCustomMenuItems) {
            try {
                await handleChromeApiCall((callback) => chrome.contextMenus.remove(menuItemId, callback));
            } catch (error) {
                // Menu item doesn't exist, that's fine
                console.debug(`Menu item ${menuItemId} not found for removal:`, error.message);
            }
        }
        existingImageCustomMenuItems.clear();

        // Get custom instructions from storage
        const { instructions } = await handleChromeApiCall((callback) =>
            chrome.storage.local.get(['instructions'], callback)
        );

        if (instructions && instructions.length > 0) {
            for (const instruction of instructions) {
                const menuItemId = `imageCustom_${instruction.id}`;
                try {
                    await handleChromeApiCall((callback) => {
                        chrome.contextMenus.create({
                            id: menuItemId,
                            parentId: "imageAnalysis",
                            title: `⚡ ${instruction.name}`,
                            contexts: ["image"]
                        }, callback);
                    });
                    existingImageCustomMenuItems.add(menuItemId);
                } catch (error) {
                    await errorHandler.handleError(createError(`Failed to create menu item for instruction: ${instruction.name}`, {
                        category: ErrorCategory.CHROME_API,
                        severity: ErrorSeverity.LOW,
                        context: { instruction, menuItemId },
                        originalError: error
                    }));
                }
            }
            console.log(`Updated image context menu with ${existingImageCustomMenuItems.size} custom instructions`);
        } else {
            console.log('No custom instructions found for image context menus');
        }
    }, {
        category: ErrorCategory.CONFIGURATION,
        userMessage: 'Failed to update custom instruction menu items'
    });
}

// Listen for storage changes to update context menus
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.instructions) {
        console.log('Custom instructions changed, updating image context menus...');
        updateImageCustomInstructions();
    }
});

// Helper function to determine MIME type from URL
function getMimeTypeFromUrl(url) {
    try {
        // Handle query parameters and fragments
        const cleanUrl = url.split('?')[0].split('#')[0];
        const extension = cleanUrl.split('.').pop().toLowerCase();
        console.log('Detected extension:', extension, 'from URL:', cleanUrl);
        
        const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            'bmp': 'image/bmp',
            'tiff': 'image/tiff',
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'ogg': 'video/ogg',
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'flac': 'audio/flac'
        };
        
        const mimeType = mimeTypes[extension] || 'image/jpeg'; // Default to jpeg for images
        console.log('Determined MIME type:', mimeType);
        return mimeType;
    } catch (error) {
        console.error('Error determining MIME type:', error);
        return 'image/jpeg'; // Safe default
    }
}
console.log('marked.min.js imported successfully.');
console.log('Background service worker script started.');

let tabContentCallback = null; // To store sendResponse for getTabContent
let pinnedActionTabContentCallback = null; // To store sendResponse for getPinnedActionTabContent



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
  // Skip media analysis menu items - they're handled by the new multimodal handler above
  if (info.menuItemId === "analyzeImage" || info.menuItemId === "analyzeVideo" || info.menuItemId === "analyzeAudio" || 
      info.menuItemId === "summarizeImage" || info.menuItemId === "explainImage" || 
      info.menuItemId.startsWith("imageCustom_") || 
      info.menuItemId === "imageAnalysis" || info.menuItemId === "videoAnalysis" || info.menuItemId === "audioAnalysis") {
    return; // Let the new handler above handle these
  }
  
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
  
  // Handle image context (only for non-multimodal menu items)
  // This should be applied *after* potentially fetching tab content if selection was empty
  // Skip this for our new multimodal menu items since they're handled separately
  if (info.mediaType === 'image' && info.srcUrl && 
      !info.menuItemId.includes("Image") && !info.menuItemId.includes("Video") && !info.menuItemId.includes("Audio")) {
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
      // Track custom instruction usage
      try {
        const cfg = await validateConfig().catch(() => ({}));
        await analytics.trackInstructionUsed({ instruction: instruction.name || 'custom', model: cfg?.modelName, tools: Array.isArray(instruction.tool_choice) ? instruction.tool_choice : (instruction.tool_choice && instruction.tool_choice !== 'none' ? [instruction.tool_choice] : []) });
      } catch (_) {}
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
    // Track predefined instruction usage
    try {
      const cfg = await validateConfig().catch(() => ({}));
      await analytics.trackInstructionUsed({ instruction: info.menuItemId, model: cfg?.modelName, tools: [] });
    } catch (_) {}
    promptContent = `${commandMap[info.menuItemId]}:\n${promptContent}`;
    console.log("Final promptContent with instruction (predefined):", promptContent.substring(0, 100));
  } else if (info.menuItemId.startsWith('custom_')) {
    // handled earlier, but if reaches here ignore
  } else if (info.menuItemId !== 'prompt_paul' && info.menuItemId !== 'oneoff_instruction' && info.menuItemId !== 'start_chat' && info.menuItemId !== 'manageInstructions') {
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
  return await wrapAsync(async () => {
    console.log('Background: Validating configuration...');

    let result;
    try {
      result = await handleChromeApiCall((callback) =>
        chrome.storage.local.get(['profiles', 'lastSelectedProfileId', 'defaultLlmEndpoint'], callback)
      );
    } catch (error) {
      throw createError('Failed to access configuration storage', {
        category: ErrorCategory.STORAGE,
        severity: ErrorSeverity.CRITICAL,
        retryable: true,
        originalError: error
      });
    }

    // Defensive check - ensure result is always an object
    if (!result || typeof result !== 'object') {
      console.warn('Configuration storage returned unexpected result, using defaults:', result);
      result = {};
    }

    const profiles = result.profiles || [];
    const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
    const defaultLlmEndpoint = result.defaultLlmEndpoint || '';

    // Ensure we have at least a default profile
    if (profiles.length === 0 || !profiles.find(p => p.id === 'default')) {
      console.warn('No default profile found, creating one');
      const defaultProfile = {
        id: 'default',
        name: 'Default',
        llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
        apiKey: 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF',
        modelName: 'mistral-small-latest',
        maxTokens: 16000,
        systemPrompt: 'You are a helpful, knowledgeable, and friendly AI assistant. Provide clear, accurate, and concise responses while being respectful and professional.',
        lastUpdated: new Date().toLocaleString()
      };

      // Add default profile to array
      if (profiles.length === 0) {
        profiles.push(defaultProfile);
      } else {
        // Insert at beginning if array exists but no default
        profiles.unshift(defaultProfile);
      }

      // Try to save the default profile
      try {
        await chrome.storage.local.set({
          profiles: profiles,
          lastSelectedProfileId: 'default'
        });
        console.log('Default profile created and saved');
      } catch (saveError) {
        console.error('Failed to save default profile:', saveError);
      }
    }

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

    // Handle errors with specific error types
    const hasEndpoint = defaultLlmEndpoint && isValidURL(defaultLlmEndpoint);
    const hasValidProfile = selectedProfile || defaultProfile;

    if (!hasEndpoint) {
      throw createError('LLM API endpoint is missing or invalid. Please configure it in the options page.', {
        category: ErrorCategory.CONFIGURATION,
        severity: ErrorSeverity.CRITICAL,
        code: 'MISSING_ENDPOINT',
        context: { defaultLlmEndpoint, hasValidProfile }
      });
    } else if (!hasValidProfile) {
      throw createError('No valid profiles found. Please create a profile in the options page.', {
        category: ErrorCategory.CONFIGURATION,
        severity: ErrorSeverity.CRITICAL,
        code: 'NO_VALID_PROFILES',
        context: { profilesCount: profiles.length, hasEndpoint }
      });
    } else {
      throw createError('Configuration is incomplete. Please set API key and model name in the options page.', {
        category: ErrorCategory.CONFIGURATION,
        severity: ErrorSeverity.CRITICAL,
        code: 'INCOMPLETE_CONFIG',
        context: { hasEndpoint, hasValidProfile }
      });
    }
  }, {
    category: ErrorCategory.CONFIGURATION,
    userMessage: 'Failed to validate extension configuration',
    critical: true
  });
}

// Helper function to process API response and send messages to chat.js (for NON-STREAMING responses)
async function _handleApiResponseAndSendMessage(responseMessage, prompt, tabId, isStartChatContext) {
    const sendMessageDelay = isStartChatContext ? 300 : 200;

    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
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
                prompt: prompt,
                tabId: tabId,
            }).catch(error => console.log(`Error sending setApiResponse (content): ${error.message}, tabId: ${tabId}`));
        }, sendMessageDelay);
    } else {
        console.error("Background: API response message has neither standard content nor tool_calls:", responseMessage);
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
            // toolChoicePayload will be spread later after tool configuration
        };

        const fetchHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        };

        // Add tool choice payload to request body
        Object.assign(apiRequestBody, toolChoicePayload);

        if (enableStreaming) {
            apiRequestBody.stream = true;
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

                                    // Standard OpenAI-style streaming
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
            // For non-streaming responses, responseData.content will be an array of blocks.
            // For OpenAI, responseData.choices[0].message is the object to check.
            const messageObject = responseData.choices && responseData.choices[0] ? responseData.choices[0].message : null;

            if (!messageObject) {
                 throw new Error('Invalid response format from API: Missing message structure.');
            }
            await _handleApiResponseAndSendMessage(messageObject, promptContent, tabId, isStartChat);
        }

    } catch (error) {
        // This is the generic catch block for any other errors that occur in makeLlmApiRequest
        console.error('Error in makeLlmApiRequest (generic catch):', error);
        try {
          const cat = error?.message?.includes('API request failed') ? 'api_error' : 'network';
          const code = (error?.message || 'error').slice(0, 64);
          await analytics.trackErrorEvent(cat, code);
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
    return await wrapAsync(async () => {
        const localTools = await new Promise((resolve, reject) => {
            chrome.storage.local.get(['promptPaulTools'], (result) => {
                if (chrome.runtime.lastError) {
                    reject(createError('Failed to access tool definitions from storage', {
                        category: ErrorCategory.STORAGE,
                        severity: ErrorSeverity.MEDIUM,
                        context: { error: chrome.runtime.lastError.message }
                    }));
                    return;
                }
                resolve(result.promptPaulTools || []);
            });
        });
        return localTools;
    }, {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to load tool definitions',
        severity: ErrorSeverity.MEDIUM
    }).catch(error => {
        console.warn('Failed to load tool definitions, using empty array:', error);
        return [];
    });
}

// Function to get a single tool definition by name from storage
async function getToolDefinition(name) {
    return await wrapAsync(async () => {
        return await new Promise((resolve, reject) => {
            chrome.storage.local.get(['promptPaulTools'], (result) => {
                if (chrome.runtime.lastError) {
                    reject(createError('Failed to access tool definition from storage', {
                        category: ErrorCategory.STORAGE,
                        severity: ErrorSeverity.MEDIUM,
                        context: { toolName: name, error: chrome.runtime.lastError.message }
                    }));
                    return;
                }
                const toolsArray = result.promptPaulTools || [];
                const tool = toolsArray.find(t => t.name === name);
                resolve(tool);
            });
        });
    }, {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to load tool definition',
        severity: ErrorSeverity.MEDIUM
    }).catch(error => {
        console.warn(`Failed to load tool definition for '${name}':`, error);
        return null;
    });
}

// Generic function to call a user-defined endpoint
async function callUserDefinedEndpoint(endpointUrl, args, userDefinedMethod, originalToolName = null) {
    return await wrapAsync(async () => {
        console.log(`Background: Calling user-defined endpoint: ${endpointUrl} with args:`, args);

        if (!endpointUrl) {
            throw createError('No endpoint URL provided', {
                category: ErrorCategory.USER_INPUT,
                severity: ErrorSeverity.HIGH,
                context: { originalToolName, userDefinedMethod }
            });
        }

        if (!isValidURL(endpointUrl)) {
            throw createError(`Invalid endpoint URL: ${endpointUrl}`, {
                category: ErrorCategory.VALIDATION,
                severity: ErrorSeverity.HIGH,
                context: { endpointUrl, originalToolName }
            });
        }

        let finalEndpointUrl = endpointUrl;
        let finalFetchOptions = {
            headers: {
                'Accept': 'application/json'
            }
        };
        let finalArgs = args || {};

        // Determine HTTP method
        const isEmptyArgs = !Object.keys(finalArgs).length === 0;
        let method = userDefinedMethod || (isEmptyArgs ? 'GET' : 'POST');
        method = method.toUpperCase();
        finalFetchOptions.method = method;

        console.log(`Background: Using method ${method} (User defined: ${userDefinedMethod || 'Auto'}) for endpoint ${finalEndpointUrl}`);

        // Prepare request based on method
        if (method === 'GET' && !isEmptyArgs) {
            const queryParams = new URLSearchParams(finalArgs).toString();
            finalEndpointUrl = `${finalEndpointUrl}?${queryParams}`;
            console.log(`Background: Appended query params for GET request: ${queryParams}`);
        } else if (['POST', 'PUT', 'PATCH'].includes(method) && !isEmptyArgs) {
            finalFetchOptions.headers['Content-Type'] = 'application/json';
            finalFetchOptions.body = JSON.stringify(finalArgs);
        }

        console.log("Background: Webhook Fetch Details:", { endpointUrl: finalEndpointUrl, fetchOptions: finalFetchOptions });

        // Add timeout to fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        finalFetchOptions.signal = controller.signal;

        const response = await fetch(finalEndpointUrl, finalFetchOptions);
        clearTimeout(timeoutId);

        console.log(`Background: Fetch response received. Status: ${response.status}, StatusText: ${response.statusText}`);

        if (!response.ok) {
            let errorBody = '';
            try {
                errorBody = await response.text();
            } catch (_) { /* Ignore if body cannot be read */ }

            const errorMsg = `HTTP error ${response.status}: ${response.statusText}. ${errorBody}`.trim();
            console.error(`Background: HTTP error for ${finalEndpointUrl}:`, errorMsg);

            throw createError(`HTTP request failed: ${errorMsg}`, {
                category: ErrorCategory.NETWORK,
                severity: ErrorSeverity.HIGH,
                retryable: [500, 502, 503, 504].includes(response.status),
                context: {
                    endpointUrl: finalEndpointUrl,
                    status: response.status,
                    statusText: response.statusText,
                    errorBody: errorBody.substring(0, 500) // Limit error body size
                }
            });
        }

        // Parse response
        const contentType = response.headers.get('content-type');
        console.log(`Background: Response content-type: ${contentType}`);

        let result;
        try {
            if (contentType && contentType.includes('application/json')) {
                result = await response.json();
            } else {
                result = await response.text();
            }
        } catch (parseError) {
            throw createError('Failed to parse response from endpoint', {
                category: ErrorCategory.NETWORK,
                severity: ErrorSeverity.MEDIUM,
                context: { endpointUrl: finalEndpointUrl, contentType },
                originalError: parseError
            });
        }

        console.log(`Background: Parsed response result:`, result);
        return result;

    }, {
        category: ErrorCategory.TOOL_EXECUTION,
        userMessage: `Failed to execute tool${originalToolName ? `: ${originalToolName}` : ''}`,
        retryable: true,
        context: { endpointUrl, originalToolName, userDefinedMethod }
    });
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


// Track active tool executions to prevent duplicates
const activeToolExecutions = new Set();

// Listener for messages from content scripts or other extension parts (like chat.js)
console.log("Background: Attempting to add onMessage listener NOW...");
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Flag to indicate if sendResponse has been called for this message
    let responseSent = false;
    const originalSendResponse = sendResponse;

    // Wrap sendResponse to ensure it's only called once
    sendResponse = (response) => {
        if (!responseSent) {
            originalSendResponse(response);
            responseSent = true;
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
console.log('[Background] Injecting content script into tab for getTabContent:', tabs[0].url);
chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    files: ['content_script_unified.js']
}, (injectionResults) => {
    clearTimeout(timeoutId); // Ensure timeout is cleared
    if (chrome.runtime.lastError) {
        console.error('Background: Error executing content_script_unified.js for getTabContent:', chrome.runtime.lastError);
        if (tabContentCallback) {
            tabContentCallback({ action: 'tabContentResponse', success: false, error: 'Failed to execute script: ' + chrome.runtime.lastError.message });
            tabContentCallback = null;
        }
        return;
    }
    if (injectionResults && injectionResults[0] && injectionResults[0].result) {
        const result = injectionResults[0].result;
        console.log('Background: getTabContent - Result from content_script_unified.js:', result);
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
        console.error('Background: getTabContent - No result from content_script_unified.js');
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
        // Handle content extracted by content_script_unified.js
        // This message is sent by content_script_unified.js
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
console.log('[Background] Injecting content script into tab for getPinnedActionTabContent:', tabs[0].url);
chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    files: ['content_script_unified.js']
}, (injectionResults) => {
    clearTimeout(timeoutId); // Ensure timeout is cleared
    if (chrome.runtime.lastError) {
        console.error('Background: Error executing content_script_unified.js for getPinnedActionTabContent:', chrome.runtime.lastError);
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
        console.log('Background: getPinnedActionTabContent - Result from content_script_unified.js:', result);
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
        console.error('Background: getPinnedActionTabContent - No result from content_script_unified.js');
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
console.log('[Background] Injecting content script into tab for getExplainContent:', tabs[0].url);
chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    files: ['content_script_unified.js']
}, (injectionResults) => {
    // If there was a timeout for getExplainContent, clear it here.
    // clearTimeout(timeoutId_for_getExplainContent);
    if (chrome.runtime.lastError) {
        console.error('Failed to inject/execute content_script_unified.js:', chrome.runtime.lastError);
        if (tabContentCallback) {
            tabContentCallback({ action: 'explainContentResponse', success: false, error: 'Failed to inject script. ' + (chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Unknown error'), content: '' });
            tabContentCallback = null;
        }
        return;
    }
    if (injectionResults && injectionResults[0] && injectionResults[0].result) {
        const result = injectionResults[0].result;
        console.log('Background: getExplainContent - Result from content_script_unified.js:', result);
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
        console.error('Background: getExplainContent - No result from content_script_unified.js');
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

        // Prevent duplicate executions
        const executionKey = `${id}-${name}`;
        if (activeToolExecutions.has(executionKey)) {
            console.log(`Background: Tool execution '${executionKey}' already in progress, ignoring duplicate request`);
            return true;
        }
        
        activeToolExecutions.add(executionKey);
        console.log(`Background: Added '${executionKey}' to active executions. Active count: ${activeToolExecutions.size}`);

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

                // Skip MCP tools (MCP functionality has been removed)
                if (toolDefinition.endpointUrl) { // User-defined HTTP tool logic
                    console.log(`Executing '${name}' as a user-defined HTTP tool via ${toolDefinition.endpointUrl}`);
                    const result = await callUserDefinedEndpoint(toolDefinition.endpointUrl, argsObject, toolDefinition.httpMethod);
                    console.log(`Background: User-defined tool '${name}' executed successfully via endpoint. Result:`, result);
                    try { await analytics.trackInstructionUsed({ instruction: 'tool_invoke', model: (await validateConfig().catch(()=>({})))?.modelName, tools: [name] }); } catch (_) {}
                    sendResponse({ result: result });
                } else { // Existing built-in tool logic (if any)
                    const builtInFunction = toolImplementations[name];
                    if (builtInFunction) {
                        console.log(`Executing '${name}' as a built-in tool.`);
                        const result = await builtInFunction(argsObject);
                        console.log(`Background: Built-in tool '${name}' executed successfully. Result:`, result);
                        try { await analytics.trackInstructionUsed({ instruction: 'tool_invoke', model: (await validateConfig().catch(()=>({})))?.modelName, tools: [name] }); } catch (_) {}
                        sendResponse({ result: result });
                    } else {
                        throw new Error(`Tool '${name}' is not properly configured: It has no endpointUrl and no built-in implementation.`);
                    }
                }

            } catch (error) { // General error catch for executePromptPaulTool
                console.error(`Background: Error processing tool '${name}' in executePromptPaulTool:`, error);
                // Provide detailed error message for debugging
                let errorMessage = error.message || 'Tool processing failed';
                if (error.details) {
                    errorMessage += ` (Details: ${JSON.stringify(error.details)})`;
                }
                sendResponse({ error: errorMessage });
            } finally {
                // Always remove from active executions when done
                activeToolExecutions.delete(executionKey);
                console.log(`Background: Removed '${executionKey}' from active executions. Active count: ${activeToolExecutions.size}`);
            }
        })();
          return true; // Crucial for async sendResponse
    } else if (request.action === 'executeLlmApiRequest') {
        const { prompt, tool_choice } = request;
        (async () => {
            await makeLlmApiRequest(prompt, null, { customInstructionToolChoice: tool_choice });
        })();
        return true;
    }
    // Handle other actions if any
});
console.log("Background: onMessage listener function HAS BEEN registered.");

// Cleanup completed - unnecessary state and timers have been removed.
