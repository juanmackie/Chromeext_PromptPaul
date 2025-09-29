// MCP removed: provide a minimal stub to avoid runtime errors if legacy code paths are reached
class McpRegistry {
  constructor() {}
  async addServer() { throw new Error('MCP disabled'); }
  async updateServer() { throw new Error('MCP disabled'); }
  async removeServer() { return; }
  async listServers() { return []; }
  async testConnect() { return { ok: false, error: 'MCP disabled' }; }
  async listTools() { return []; }
  async callTool() { throw new Error('MCP disabled'); }
  getState() { return null; }
}


// ===== Umami Analytics Module (privacy-first, opt-out) =====
const UMAMI_ENDPOINT = 'https://cloud.umami.is/api/send';
const UMAMI_WEBSITE_ID = 'd1b4d7cb-2e57-44ec-a91f-6692fb365a02';
const ANALYTICS_CONSENT_KEY = 'analyticsConsent';
const ANALYTICS_INSTANCE_KEY = 'analyticsInstance';
const ANALYTICS_ROTATE_AT_KEY = 'analyticsRotateAt';
const ANALYTICS_ROTATE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SAFE_LABEL_REGEX = /^[A-Za-z0-9._:-]{1,64}$/;
const DENYLIST = ['email', 'token', 'key', 'password', 'secret', 'auth', 'cookie', 'session', 'ssid'];

function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11)
    .replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

function sanitizeLabel(v) {
  if (typeof v !== 'string') return undefined;
  let s = v.trim().toLowerCase();
  if (!s) return undefined;
  // quick deny if looks like an email or has spaces
  if (s.includes('@') || s.includes(' ')) return undefined;
  // denylisted keywords
  for (const k of DENYLIST) {
    if (s.includes(k)) return undefined;
  }
  // enforce charset and length
  if (!SAFE_LABEL_REGEX.test(s)) return undefined;
  return s;
}

async function getEnvInfo() {
  const manifest = chrome.runtime.getManifest();
  const extVersion = manifest?.version || '0.0.0';
  const platformInfo = await new Promise(resolve => chrome.runtime.getPlatformInfo(resolve));
  let chromeMajor = '0';
  try {
    const ua = navigator.userAgent;
    const m = ua.match(/Chrome\/(\d+)/);
    if (m) chromeMajor = m[1];
  } catch (_) {}
  return { extVersion, platform: platformInfo?.os || 'unknown', chromeMajor };
}

async function getConsent() {
  const { [ANALYTICS_CONSENT_KEY]: consent } = await chrome.storage.local.get(ANALYTICS_CONSENT_KEY);
  // Default ON (opt-out)
  return consent !== false;
}

async function getInstanceId() {
  const now = Date.now();
  const res = await chrome.storage.local.get([ANALYTICS_INSTANCE_KEY, ANALYTICS_ROTATE_AT_KEY]);
  let instance = res[ANALYTICS_INSTANCE_KEY];
  let rotateAt = res[ANALYTICS_ROTATE_AT_KEY];
  if (!instance || !rotateAt || now >= rotateAt) {
    instance = uuidv4();
    rotateAt = now + ANALYTICS_ROTATE_MS;
    await chrome.storage.local.set({ [ANALYTICS_INSTANCE_KEY]: instance, [ANALYTICS_ROTATE_AT_KEY]: rotateAt });
  }
  return instance;
}

async function sendUmamiEvent(name, data) {
  try {
    const consent = await getConsent();
    if (!consent) return;

    // Send richer segmentation to Umami so you can filter by instruction/model/tools directly.
    // Umami supports additional fields in the payload object such as event_name and data.
    // We keep name as a stable event category (e.g., "instruction_used") and also include
    // event_name set to the specific instruction for top-level segmentation.
    const payload = {
      type: 'event',
      payload: {
        website: UMAMI_WEBSITE_ID,
        hostname: 'extension',
        url: `/ext/usage/${data?.instruction || 'unknown'}`,
        referrer: '',
        name, // high-level category, e.g., "instruction_used"
        event_name: data?.instruction || name, // specific instruction or fallback to name
        data: {
          ...data,
          // Duplicate key fields at top-level-friendly keys for Umami dashboards
          instruction: data?.instruction || 'unknown',
          model: data?.model || 'unknown',
          tools: Array.isArray(data?.tools) ? data.tools : []
        }
      }
    };
    const body = JSON.stringify(payload);

    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(UMAMI_ENDPOINT, blob);
    } else {
      await fetch(UMAMI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      });
    }
  } catch (e) {
    // never throw
    console.warn('Analytics send failed:', e);
  }
}

async function trackInstalled() {
  const env = await getEnvInfo();
  const instance = await getInstanceId();
  await sendUmamiEvent('installed', { ...env, instance });
}

async function trackErrorEvent(category, code) {
  const env = await getEnvInfo();
  const instance = await getInstanceId();
  const cat = sanitizeLabel(category) || 'unknown';
  const c = sanitizeLabel(code) || 'unknown';
  await sendUmamiEvent('error_event', { ...env, instance, category: cat, code: c });
}

async function trackInstructionUsed({ instruction, model, tools }) {
  const env = await getEnvInfo();
  const instance = await getInstanceId();
  const instr = sanitizeLabel(instruction) || 'unknown';
  const mdl = sanitizeLabel(model) || 'unknown';
  const toolsSafe = Array.isArray(tools)
    ? tools.map(t => sanitizeLabel(String(t))).filter(Boolean).slice(0, 8)
    : [];
  // Put the instruction and model into the event "name" context via sendUmamiEvent enhancements above
  await sendUmamiEvent('instruction_used', {
    ...env,
    instance,
    instruction: instr,
    model: mdl,
    tools: toolsSafe,
    count: 1
  });
}

// Default consent: set to true if not present
(async () => {
  const existing = await chrome.storage.local.get(ANALYTICS_CONSENT_KEY);
  if (!(ANALYTICS_CONSENT_KEY in existing)) {
    await chrome.storage.local.set({ [ANALYTICS_CONSENT_KEY]: true });
  }
})();

// Listen for options page consent changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[ANALYTICS_CONSENT_KEY]) {
    // no-op, just acknowledge; future hook if batching is added
    console.log('Analytics consent changed:', changes[ANALYTICS_CONSENT_KEY].newValue);
  }
});
// Create context menus for images and other media
chrome.runtime.onInstalled.addListener(async (details) => {
    // Track install/update event once
    try {
      await trackInstalled();
    } catch (_) {}
    // Create parent menu for images
    chrome.contextMenus.create({
        id: "imageAnalysis",
        title: "Analyze Image with Prompt Paul",
        contexts: ["image"]
    });
    
    // Quick actions for images
    chrome.contextMenus.create({
        id: "analyzeImage",
        parentId: "imageAnalysis",
        title: "\uD83D\uDD0D General Analysis",
        contexts: ["image"]
    });
    
    chrome.contextMenus.create({
        id: "summarizeImage", 
        parentId: "imageAnalysis",
        title: "📝 Summarize Image",
        contexts: ["image"]
    });
    
    chrome.contextMenus.create({
        id: "explainImage",
        parentId: "imageAnalysis", 
        title: "💡 Explain Image",
        contexts: ["image"]
    });
    
    // Add separator
    chrome.contextMenus.create({
        id: "imageSeparator",
        parentId: "imageAnalysis",
        type: "separator",
        contexts: ["image"]
    });
    
    // Load and add custom instructions for images
    await updateImageCustomInstructions();
    
    // Create parent menu for videos
    chrome.contextMenus.create({
        id: "videoAnalysis",
        title: "Analyze Video with Prompt Paul", 
        contexts: ["video"]
    });
    
    chrome.contextMenus.create({
        id: "analyzeVideo",
        parentId: "videoAnalysis",
        title: "\uD83C\uDFA5 General Analysis",
        contexts: ["video"]
    });
    
    // Create parent menu for audio
    chrome.contextMenus.create({
        id: "audioAnalysis", 
        title: "Analyze Audio with Prompt Paul",
        contexts: ["audio"]
    });
    
    chrome.contextMenus.create({
        id: "analyzeAudio",
        parentId: "audioAnalysis",
        title: "\uD83C\uDFB5 General Analysis", 
        contexts: ["audio"]
    });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "analyzeImage" || info.menuItemId === "analyzeVideo" || info.menuItemId === "analyzeAudio" || 
        info.menuItemId === "summarizeImage" || info.menuItemId === "explainImage" || 
        info.menuItemId.startsWith("imageCustom_")) {
        try {
            // Open side panel FIRST (must be in direct response to user gesture)
            await chrome.sidePanel.open({ tabId: tab.id });
            
            // Get the media URL and determine action type
            const mediaUrl = info.srcUrl;
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
            
            // Show loading message immediately (with error handling)
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
            fetchMediaAsBase64(mediaUrl).then(base64Data => {
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
            }).catch(async error => {
                console.error('Error fetching media:', error);
                try { await trackErrorEvent('network', `media_${error?.name || 'err'}`); } catch (_) {}
                chrome.runtime.sendMessage({
                    action: 'setMediaForAnalysis',
                    mediaData: {
                        type: mediaType,
                        base64: null,
                        url: mediaUrl,
                        mimeType: getMimeTypeFromUrl(mediaUrl),
                        error: error.message
                    },
                    tabId: tab.id
                });
            });
            
        } catch (error) {
            console.error('Error processing media:', error);
        }
    }
});

// Helper function to fetch media and convert to base64
async function fetchMediaAsBase64(url) {
    try {
        console.log('Fetching media from URL:', url);
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
        }
        
        const blob = await response.blob();
        console.log('Blob size:', blob.size, 'Type:', blob.type);
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                console.log('DataURL prefix:', dataUrl.substring(0, 50));
                const base64 = dataUrl.split(',')[1]; // Remove data:image/jpeg;base64, prefix
                console.log('Base64 length:', base64.length);
                console.log('Base64 sample:', base64.substring(0, 100));
                resolve(base64);
            };
            reader.onerror = (error) => {
                console.error('FileReader error:', error);
                reject(error);
            };
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('Error fetching media:', error);
        throw error;
    }
}

// Track existing image custom instruction menu items
let existingImageCustomMenuItems = new Set();

// Helper function to update image custom instructions in context menu
async function updateImageCustomInstructions() {
    try {
        // Remove existing custom instruction menu items that we know exist
        for (const menuItemId of existingImageCustomMenuItems) {
            try {
                await new Promise((resolve, reject) => {
                    chrome.contextMenus.remove(menuItemId, () => {
                        if (chrome.runtime.lastError) {
                            // Menu item doesn't exist, that's fine
                            resolve();
                        } else {
                            resolve();
                        }
                    });
                });
            } catch (e) {
                // Ignore errors for non-existent menu items
            }
        }
        existingImageCustomMenuItems.clear();
        
        // Add current custom instructions
        const { instructions } = await chrome.storage.local.get(['instructions']);
        if (instructions && instructions.length > 0) {
            for (const instruction of instructions) {
                const menuItemId = `imageCustom_${instruction.id}`;
                try {
                    await new Promise((resolve, reject) => {
                        chrome.contextMenus.create({
                            id: menuItemId,
                            parentId: "imageAnalysis",
                            title: `⚡ ${instruction.name}`,
                            contexts: ["image"]
                        }, () => {
                            if (chrome.runtime.lastError) {
                                console.warn(`Failed to create menu item ${menuItemId}:`, chrome.runtime.lastError.message);
                                resolve();
                            } else {
                                existingImageCustomMenuItems.add(menuItemId);
                                resolve();
                            }
                        });
                    });
                } catch (e) {
                    console.warn(`Error creating menu item for instruction ${instruction.name}:`, e);
                }
            }
            console.log(`Updated image context menu with ${existingImageCustomMenuItems.size} custom instructions`);
        } else {
            console.log('No custom instructions found for image context menus');
        }
    } catch (error) {
        console.error('Error updating image custom instructions:', error);
    }
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
// console.log('marked.min.js imported successfully.');
console.log('Background service worker script started.');


let messageListenerAdded = false;
let tabContentCallback = null; // To store sendResponse for getTabContent
let pinnedActionTabContentCallback = null; // To store sendResponse for getPinnedActionTabContent

// MCP features removed during refactor

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
    console.log("No text selected, attempting to fetch tab content directly...");
    try {
        const tabDataResponse = await new Promise((resolve) => {
            fetchTabContent(tab.id, resolve);
        });

        if (tabDataResponse && tabDataResponse.success) {
            promptContent = tabDataResponse.content;
            console.log("Background: Tab content fetched directly, length:", promptContent.length);
        } else {
            console.error("Background: Failed to get tab content directly. Response:", tabDataResponse);
            promptContent = originalSelectionText; // Fallback to empty or original selection
        }
    } catch (error) {
        console.error("Background: Exception while fetching tab content directly:", error.message);
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
    try {
      chrome.runtime.sendMessage({
        action,
        selectedText: promptContent,
        tabId: tab.id,
        ...extra
      });
    } catch (error) {
      console.warn(`Could not send ${action} to UI (side panel may not be open): ${error.message}, tabId: ${tab.id}`);
    }
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
        await trackInstructionUsed({ instruction: instruction.name || 'custom', model: cfg?.modelName, tools: Array.isArray(instruction.tool_choice) ? instruction.tool_choice : (instruction.tool_choice && instruction.tool_choice !== 'none' ? [instruction.tool_choice] : []) });
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
      await trackInstructionUsed({ instruction: info.menuItemId, model: cfg?.modelName, tools: [] });
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

// Helper function to process API response and send messages to chat.js (for NON-STREAMING responses)
async function _handleApiResponseAndSendMessage(responseMessage, prompt, tabId, isStartChatContext, usingAnthropicMcp) {
    const sendMessageDelay = isStartChatContext ? 300 : 200;

    if (usingAnthropicMcp) {
        // This branch handles non-streaming responses when the Anthropic MCP Connector was used.
        // Anthropic's response (responseMessage) will be an object where responseMessage.content is an array of blocks
        // (e.g., text, mcp_tool_use, mcp_tool_result).
        console.log("Background: Handling non-streaming response for Anthropic MCP Connector.", responseMessage);
        setTimeout(() => {
            try {
                chrome.runtime.sendMessage({
                    action: 'setApiResponse',
                    requestId: requestId,
                    apiResponse: responseMessage, // Send the whole Anthropic message object
                    isAnthropicMcp: true, // Flag for chat.js to identify this response type
                    prompt: prompt,
                    tabId: tabId,
                });
            } catch (error) {
                console.warn(`Could not send Anthropic MCP response to UI (side panel may not be open): ${error.message}, tabId: ${tabId}`);
            }
        }, sendMessageDelay);

    } else if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        // This is the OpenAI-style tool call
        console.log("Background: Received OpenAI style tool_calls from API, forwarding to chat.js", responseMessage.tool_calls);
        setTimeout(() => {
            try {
                chrome.runtime.sendMessage({
                    action: 'handleToolCallResponse', // chat.js handles this by calling executePromptPaulTool
                    responseMessage: responseMessage,
                    prompt: prompt,
                    tabId: tabId,
                });
            } catch (error) {
                console.warn(`Could not send tool call response to UI (side panel may not be open): ${error.message}, tabId: ${tabId}`);
            }
        }, sendMessageDelay);

    } else if (responseMessage.content) { // Standard text response
        const latestResponse = typeof responseMessage.content === 'string' ? responseMessage.content : JSON.stringify(responseMessage.content);
        setTimeout(() => {
            try {
                chrome.runtime.sendMessage({
                    action: 'setApiResponse',
                    requestId: requestId,
                    apiResponse: latestResponse,
                    isAnthropicMcp: false, // Explicitly false
                    prompt: prompt,
                    tabId: tabId,
                });
            } catch (error) {
                console.warn(`Could not send standard response to UI (side panel may not be open): ${error.message}, tabId: ${tabId}`);
            }
        }, sendMessageDelay);
    } else {
        console.error("Background: API response message has neither standard content nor tool_calls (OpenAI/Anthropic MCP):", responseMessage);
        setTimeout(() => {
            try {
                chrome.runtime.sendMessage({
                    action: 'setApiResponse',
                    requestId: requestId,
                    apiResponse: "Error: Received an empty or invalid response from the AI.",
                    isAnthropicMcp: false, // Explicitly false
                    prompt: prompt,
                    tabId: tabId,
                });
            } catch (error) {
                console.warn(`Could not send error response to UI (side panel may not be open): ${error.message}, tabId: ${tabId}`);
            }
        }, sendMessageDelay);
    }
}

// Refactored function to make LLM API calls
async function makeLlmApiRequest(promptContent, tabId, { isStartChat = false, customInstructionToolChoice = 'none' } = {}, requestId = null) {
    let config, tools, enableStreaming, usingAnthropicMcpConnector = false; // Keep track of connector usage
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
            // toolChoicePayload will be spread later after checking for Anthropic MCP
        };

        const fetchHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        };

        // Not an Anthropic endpoint, use standard OpenAI-style tool definition
        Object.assign(apiRequestBody, toolChoicePayload);
        
        if (enableStreaming && !usingAnthropicMcpConnector) { // Anthropic might handle streaming differently with MCP, or this might need adjustment
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
            try {
                chrome.runtime.sendMessage({
                    action: 'streamApiStart',
                    requestId: requestId,
                    tabId: tabId,
                    prompt: promptContent
                });
            } catch (error) {
                console.warn(`Could not send streamApiStart to UI (side panel may not be open): ${error.message}, tabId: ${tabId}`);
            }

            // Variables for handling thinking/reasoning blocks
            let thinkBuffer = '';
            let answerBuffer = '';
            let inThink = false; // Start in answer mode initially
            let hasThinkBlock = false; // Track if we encountered a think block
            let thinkingStreamStarted = false; // Track if we've started sending thinking stream updates

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    console.log("Background: Stream finished.");
                    
                    // Send any remaining content in the buffers at the end of the stream
                    if (hasThinkBlock && (thinkBuffer.length > 0 || answerBuffer.length > 0)) {
                        try {
                            chrome.runtime.sendMessage({
                                action: 'streamApiThinkingChunk',
                                requestId: requestId,
                                think: thinkBuffer,
                                answer: answerBuffer,
                                tabId: tabId,
                                prompt: promptContent
                            });
                        } catch (error) {
                            console.warn(`Could not send streamApiThinkingChunk to UI (side panel may not be open): ${error.message}, tabId: ${tabId}`);
                        }
                    } else if (!thinkingStreamStarted && answerBuffer.length > 0) {
                        // If no thinking stream was started, send remaining answer content as regular chunks
                        try {
                            chrome.runtime.sendMessage({
                                action: 'streamApiResponseChunk',
                                requestId: requestId,
                                requestId: requestId,
                                chunk: answerBuffer,
                                tabId: tabId,
                                prompt: promptContent
                            });
                        } catch (error) {
                            console.warn(`Could not send streamApiResponseChunk to UI (side panel may not be open): ${error.message}, tabId: ${tabId}`);
                        }
                    }
                    
                    try {
                        chrome.runtime.sendMessage({ action: 'streamApiEnd', requestId: requestId, tabId: tabId, prompt: promptContent });
                    } catch (error) {
                        console.warn(`Could not send streamApiEnd to UI (side panel may not be open): ${error.message}, tabId: ${tabId}`);
                    }
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

                                // OpenAI-compatible SSE events
                                const choice = parsed.choices && parsed.choices[0];
                                if (choice && choice.delta) {
                                        // Handle reasoning field if present
                                        let reasoningChunk = null;
                                        if (typeof choice.delta.reasoning === 'string' && choice.delta.reasoning.length > 0) {
                                            reasoningChunk = choice.delta.reasoning;
                                        }

                                        if (typeof choice.delta.content === 'string' && choice.delta.content.length > 0) {
                                            // Process the content chunk for thinking tags
                                            let contentChunk = choice.delta.content;
                                            
                                            // Split content by thinking tags - handle both  and <thinking> tags <think> and <thinking> tags
                                            const parts = contentChunk.split(/(<thinking[^>]*>|<\/thinking>|<think[^>]*>|<\/think>)/);
                                            
                                            for (let j = 0; j < parts.length; j++) {
                                                const part = parts[j];
                                                if (part === '') continue;
                                                
                                                if ((part.startsWith('<thinking') || part.startsWith('<think')) && part.endsWith('>')) {
                                                    // We're entering thinking mode
                                                    inThink = true;
                                                    hasThinkBlock = true;
                                                } else if (part === '</thinking>' || part === '</think>') {
                                                    // We're exiting thinking mode
                                                    inThink = false;
                                                } else {
                                                    // This is content - add to appropriate buffer
                                                    if (inThink) {
                                                        thinkBuffer += part;
                                                    } else {
                                                        answerBuffer += part;
                                                    }
                                                }
                                            }
                                            
                                            // Send updates when we have content
                                            if (hasThinkBlock && (thinkBuffer.length > 0 || answerBuffer.length > 0)) {
                                                try {
                                                    chrome.runtime.sendMessage({
                                                        action: 'streamApiThinkingChunk',
                                                        think: thinkBuffer,
                                                        answer: answerBuffer,
                                                        tabId: tabId,
                                                        prompt: promptContent
                                                    });
                                                } catch (error) {
                                                    console.warn(`Could not send streamApiThinkingChunk to UI (side panel may not be open): ${error.message}, tabId: ${tabId}`);
                                                }
                                                
                                                // Mark that we've started the thinking stream to prevent regular chunks
                                                thinkingStreamStarted = true;
                                                
                                                // Don't clear the buffers here - let them accumulate until the end
                                                // This way the frontend gets the full content each time
                                            } else if (!thinkingStreamStarted && (contentChunk || reasoningChunk)) {
                                                // If we haven't started thinking stream yet, send as regular response chunk
                                                try {
                                                    chrome.runtime.sendMessage({
                                                        action: 'streamApiResponseChunk',
                                                        chunk: contentChunk || '',
                                                        reasoningChunk: reasoningChunk,
                                                        tabId: tabId,
                                                        prompt: promptContent
                                                    });
                                                } catch (err) {
                                                    console.warn(`Could not send streamApiResponseChunk to UI (side panel may not be open): ${err.message}, tabId: ${tabId}`);
                                                }
                                            }
                                        }
                                        if (Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length > 0) {
                                            try {
                                                chrome.runtime.sendMessage({
                                                    action: 'streamApiToolCallChunk',
                                                    toolCallChunk: choice.delta.tool_calls,
                                                    tabId: tabId,
                                                    prompt: promptContent
                                                });
                                            } catch (err) {
                                                console.warn(`Could not send streamApiToolCallChunk to UI (side panel may not be open): ${err.message}, tabId: ${tabId}`);
                                            }
                                        }
                                    }
                            } catch (e) {
                                console.warn('Background: Failed to parse currentPayload as JSON:', currentPayload, e);
                            }
                        }
                    }
                }
            }
        } // Close the try block properly
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
            try {
                chrome.runtime.sendMessage({
                    action: 'setApiResponse',
                    requestId: requestId,
                    apiResponse: `Error: ${error.message}`, // Standard error reporting
                    prompt: promptContent,
                    tabId: tabId,
                });
            } catch (sendError) {
                console.warn(`Could not send error response to UI (side panel may not be open): ${sendError.message}, tabId: ${tabId}`);
            }
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
    title: '\u2702\uFE0F Shorten',
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
async function callUserDefinedEndpoint(endpointUrl, args, userDefinedMethod, originalToolName = null, mcpProxyUrlBase = null) { // Added userDefinedMethod parameter
    console.log(`Background: Calling user-defined endpoint: ${endpointUrl} with args:`, args);
    try {
        let finalEndpointUrl = endpointUrl;
        let finalFetchOptions = { // Initialize with common headers
            headers: {
                'Accept': 'application/json' // Always accept JSON response
            }
        };
        let finalArgs = args;

        if (mcpProxyUrlBase && isValidURL(mcpProxyUrlBase)) {
            try {
                finalEndpointUrl = new URL(endpointUrl, mcpProxyUrlBase).href;
                console.log(`Background: MCP Tool detected. Constructed proxy URL: ${finalEndpointUrl}`);
                // For MCP proxy, always POST a JSON payload with tool name and args
                finalFetchOptions.method = 'POST'; // Override method to POST for MCP proxy
                finalFetchOptions.headers['Content-Type'] = 'application/json';
                finalArgs = { tool_name: originalToolName, arguments: args }; // Structure payload for MCP proxy
                finalFetchOptions.body = JSON.stringify(finalArgs);
                console.log(`Background: MCP Tool - Method forced to POST. Payload:`, finalArgs);
            } catch (e) {
                console.error(`Background: Error constructing MCP proxy URL from base '${mcpProxyUrlBase}' and path '${endpointUrl}':`, e);
                throw new Error(`Invalid MCP Proxy URL configuration: ${e.message}`);
            }
        } else {
            // Existing logic for non-MCP tools (handling GET/POST based on args and userDefinedMethod)
            const isEmptyArgs = !args || Object.keys(args).length === 0;
            let method = userDefinedMethod || (isEmptyArgs ? 'GET' : 'POST');
            method = method.toUpperCase();
            finalFetchOptions.method = method;
            console.log(`Background: Using method ${method} (User defined: ${userDefinedMethod || 'Auto'}) for endpoint ${finalEndpointUrl}`);

            if (method === 'GET' && !isEmptyArgs) {
                const queryParams = new URLSearchParams(finalArgs).toString();
                finalEndpointUrl = `${finalEndpointUrl}?${queryParams}`;
                console.log(`Background: Appended query params for GET request: ${queryParams}`);
            } else if (['POST', 'PUT', 'PATCH'].includes(method) && !isEmptyArgs) {
                finalFetchOptions.headers['Content-Type'] = 'application/json';
                finalFetchOptions.body = JSON.stringify(finalArgs);
            }
        }
        // For DELETE, args might be used in the URL path (not handled here) or ignored, body is typically empty.
        // If args are needed for DELETE, the user should construct the endpointUrl accordingly in the tool definition.
        
        console.log("Background: Webhook Fetch Details:", { endpointUrl: finalEndpointUrl, fetchOptions: finalFetchOptions });

        const response = await fetch(finalEndpointUrl, finalFetchOptions); // Use finalEndpointUrl and finalFetchOptions
        console.log(`Background: Fetch response received. Status: ${response.status}, StatusText: ${response.statusText}`);

        if (!response.ok) {
            let errorBody = '';
            try {
                errorBody = await response.text(); // Try to get error details from response body
            } catch (_) { /* Ignore if body cannot be read */ }
            const errorMsg = `HTTP error ${response.status}: ${response.statusText}. ${errorBody}`.trim();
            console.error(`Background: HTTP error for ${finalEndpointUrl}:`, errorMsg);
            throw new Error(errorMsg);
        }

        // Attempt to parse response as JSON, fall back to text if not JSON
        const contentType = response.headers.get('content-type');
        console.log(`Background: Response content-type: ${contentType}`);
        
        let result;
        if (contentType && contentType.includes('application/json')) {
            result = await response.json();
        } else {
            result = await response.text();
        }
        
        console.log(`Background: Parsed response result:`, result);
        return result;

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

function fetchTabContent(tabId, callback) {
    console.log('Background: fetchTabContent called. Injecting content script for extraction.');
    
    const timeoutId = setTimeout(() => {
        callback({ success: false, error: 'Background: Content extraction timed out' });
    }, 30000); // 30 seconds timeout

    chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content_script_unified.js']
    }, (injectionResults) => {
        clearTimeout(timeoutId); // Ensure timeout is cleared
        if (chrome.runtime.lastError) {
            console.error('Background: Error executing content_script_unified.js:', chrome.runtime.lastError);
            callback({ success: false, error: 'Failed to execute script: ' + chrome.runtime.lastError.message });
            return;
        }
        if (injectionResults && injectionResults[0] && injectionResults[0].result) {
            const result = injectionResults[0].result;
            console.log('Background: fetchTabContent - Result from content_script_unified.js:', result);
            callback({
                success: result.success,
                content: result.data,
                error: result.error
            });
        } else {
            console.error('Background: fetchTabContent - No result from content_script_unified.js');
            callback({ success: false, error: 'No result from content script', content: '' });
        }
    });
}


// Track active tool executions to prevent duplicates
const activeToolExecutions = new Set();

// Listener for messages from content scripts or other extension parts (like chat.js)
console.log("Background: Attempting to add onMessage listener NOW...");
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Short-circuit any legacy MCP requests (feature removed)
    if (request && typeof request.action === 'string' && request.action.startsWith('mcp.')) {
        try { sendResponse({ success: false, error: 'MCP disabled' }); } catch (_) {}
        return true;
    }
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

    

    if (request.action === 'extractedTabContent') {
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
    } else if (request.action === 'startApiRequest') {
        const { requestId, prompt, tool_choice } = request;
        // Start streaming with requestId
        makeLlmApiRequest(prompt, null, {}, requestId).catch(err => console.error('startApiRequest error', err));
        return false;
    } else if (request.action === 'getTabContent') {
      if (tabContentCallback) {
          try { sendResponse({ action: 'tabContentResponse', success: false, content: 'Another content extraction is already in progress' }); } catch (_) {}
          return true;
      }
      tabContentCallback = sendResponse;
      console.log('Background: getTabContent received. Injecting content script for extraction.');
      const timeoutId = setTimeout(() => {
          if (tabContentCallback) {
              console.error('Background: getTabContent timed out.');
              try { tabContentCallback({ action: 'tabContentResponse', success: false, content: 'Background: Content extraction timed out' }); } catch (_) {}
              tabContentCallback = null;
          }
      }, 30000);
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs[0] && tabs[0].id) {
              const activeTabId = tabs[0].id;
              chrome.scripting.executeScript({
                  target: { tabId: activeTabId },
                  files: ['content_script_unified.js']
              }, (injectionResults) => {
                  clearTimeout(timeoutId);
                  if (chrome.runtime.lastError) {
                      console.error('Background: Error executing content_script_unified.js for getTabContent:', chrome.runtime.lastError);
                      if (tabContentCallback) {
                          try { tabContentCallback({ action: 'tabContentResponse', success: false, content: 'Failed to execute script: ' + chrome.runtime.lastError.message }); } catch (_) {}
                          tabContentCallback = null;
                      }
                      return;
                  }
                  if (injectionResults && injectionResults[0] && injectionResults[0].result) {
                      const result = injectionResults[0].result;
                      console.log('Background: getTabContent - Result from content_script_unified.js:', result);
                      if (tabContentCallback) {
                          try { tabContentCallback({ action: 'tabContentResponse', success: result.success, content: result.data, data: result.data, error: result.error }); } catch (_) {}
                          tabContentCallback = null;
                      }
                  } else {
                      console.error('Background: getTabContent - No result from content_script_unified.js');
                      if (tabContentCallback) {
                          try { tabContentCallback({ action: 'tabContentResponse', success: false, content: 'No result from content script' }); } catch (_) {}
                          tabContentCallback = null;
                      }
                  }
              });
          } else {
              console.error('No active tab found for getTabContent.');
              clearTimeout(timeoutId);
              if (tabContentCallback) {
                  try { tabContentCallback({ action: 'tabContentResponse', success: false, content: 'No active tab found.' }); } catch (_) {}
                  tabContentCallback = null;
              }
          }
      });
      return true;
    } else if (request.action === 'getExplainContent') {
        // Store the sendResponse function to call it later
        tabContentCallback = sendResponse;

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id) {
                const activeTabId = tabs[0].id;
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

                if (toolDefinition.mcpServerUrl && toolDefinition.mcpServerUrl.trim() !== "") {
                    console.error(`Background: MCP tool '${name}' configuration found but MCP support has been removed.`);
                    try {
                        sendResponse({ error: `MCP support has been removed. Tool '${name}' can no longer be executed via MCP server.` });
                    } catch (error) {
                        console.warn(`Could not send tool response (sender may be closed): ${error.message}`);
                    }
                } else if (toolDefinition.endpointUrl) { // Existing non-MCP tool logic
                    console.log(`Executing '${name}' as a user-defined HTTP tool via ${toolDefinition.endpointUrl}`);
                    const result = await callUserDefinedEndpoint(toolDefinition.endpointUrl, argsObject, toolDefinition.httpMethod);
                    console.log(`Background: User-defined tool '${name}' executed successfully via endpoint. Result:`, result);
                    try { await trackInstructionUsed({ instruction: 'tool_invoke', model: (await validateConfig().catch(()=>({})))?.modelName, tools: [name] }); } catch (_) {}
                    try {
                        sendResponse({ result: result });
                    } catch (error) {
                        console.warn(`Could not send tool response (sender may be closed): ${error.message}`);
                    }
                } else { // Existing built-in tool logic (if any)
                    const builtInFunction = toolImplementations[name];
                    if (builtInFunction) {
                        console.log(`Executing '${name}' as a built-in tool.`);
                        const result = await builtInFunction(argsObject);
                        console.log(`Background: Built-in tool '${name}' executed successfully. Result:`, result);
                        try { await trackInstructionUsed({ instruction: 'tool_invoke', model: (await validateConfig().catch(()=>({})))?.modelName, tools: [name] }); } catch (_) {}
                        try {
                            sendResponse({ result: result });
                        } catch (error) {
                            console.warn(`Could not send tool response (sender may be closed): ${error.message}`);
                        }
                    } else {
                        throw new Error(`Tool '${name}' is not properly configured: It has no mcpServerUrl, no endpointUrl, and no built-in implementation.`);
                    }
                }

            } catch (error) { // General error catch for executePromptPaulTool
                console.error(`Background: Error processing tool '${name}' in executePromptPaulTool:`, error);
                // Provide more detailed error message for MCP tools
                let errorMessage = error.message || 'Tool processing failed';
                if (error.details) {
                    errorMessage += ` (Details: ${JSON.stringify(error.details)})`;
                }
                try {
                    sendResponse({ error: errorMessage });
                } catch (sendError) {
                    console.warn(`Could not send tool error response (sender may be closed): ${sendError.message}`);
                }
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

// Cleanup function for extension shutdown
function cleanupMcpSessions() {
    console.log('MCP Cleanup: Cleaning up all sessions and timers');
    
    // Clear session cleanup timer
    if (sessionCleanupTimer) {
        clearInterval(sessionCleanupTimer);
        sessionCleanupTimer = null;
    }
    
    // Clear all sessions
    const sessionCount = Object.keys(mcpSessions).length;
    mcpSessions = {};
    
    // Clear circuit breakers
    const breakerCount = Object.keys(mcpCircuitBreakers).length;
    for (const url in mcpCircuitBreakers) {
        delete mcpCircuitBreakers[url];
    }
    
    console.log(`MCP Cleanup: Cleared ${sessionCount} sessions and ${breakerCount} circuit breakers`);
}

// Handle extension lifecycle events
chrome.runtime.onSuspend?.addListener(() => {
    console.log('Extension suspending, cleaning up MCP resources');
    cleanupMcpSessions();
});

// Add periodic health check for sessions
function performSessionHealthCheck() {
    const now = Date.now();
    let healthyCount = 0;
    let unhealthyCount = 0;
    
    for (const [url, session] of Object.entries(mcpSessions)) {
        if (isSessionHealthy(session)) {
            healthyCount++;
        } else {
            unhealthyCount++;
            console.log(`MCP Health Check: Session for ${url} is unhealthy, will be cleaned up`);
        }
    }
    
    if (healthyCount > 0 || unhealthyCount > 0) {
        console.log(`MCP Health Check: ${healthyCount} healthy, ${unhealthyCount} unhealthy sessions`);
    }
}

// Run health check every 2 minutes
/* MCP removed end */
