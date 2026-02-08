/**
 * @fileoverview Background Service Worker for Prompt Paul Chrome Extension
 *
 * This service worker handles:
 * - Context menu creation and click handling for text, image, video, and audio analysis
 * - Message routing between content scripts, side panel, and options page
 * - LLM API communication with streaming support
 * - Analytics tracking via Umami
 *
 * @module background
 * @requires ./src/utils/validation.js
 */

import { isValidURL } from './src/utils/validation.js';

// ===== Named Constants =====
// Time constants
const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_SECOND_IN_MS = 1000;
const MESSAGE_RETRY_DELAY_MS = 500;
const SIDE_PANEL_READY_DELAY_MS = 1000;

// Content extraction constants
const MIN_CONTENT_LENGTH = 50;
const CONTENT_PREVIEW_LENGTH = 500;

// HTTP status codes
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
const HTTP_STATUS_INTERNAL_ERROR = 500;

// API limits
const MAX_RESPONSE_TOKENS = 4096;
const MAX_TOOL_CALL_RETRIES = 3;

// ===== Umami Analytics Module (privacy-first, opt-out) =====
const UMAMI_ENDPOINT = 'https://cloud.umami.is/api/send';
const UMAMI_WEBSITE_ID = 'd1b4d7cb-2e57-44ec-a91f-6692fb365a02';
const ANALYTICS_CONSENT_KEY = 'analyticsConsent';
const ANALYTICS_INSTANCE_KEY = 'analyticsInstance';
const ANALYTICS_ROTATE_AT_KEY = 'analyticsRotateAt';
const ANALYTICS_ROTATE_MS = THIRTY_DAYS_IN_MS;
const SAFE_LABEL_REGEX = /^[A-Za-z0-9._:-]{1,64}$/;
const DENYLIST = ['email', 'token', 'key', 'password', 'secret', 'auth', 'cookie', 'session', 'ssid'];

/**
 * Generates a UUID v4 compliant unique identifier.
 * @returns {string} A randomly generated UUID string.
 */
function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11)
    .replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

/**
 * Sanitizes a label string for safe use in analytics.
 * Removes potentially sensitive information and enforces character restrictions.
 * @param {string} v - The label value to sanitize.
 * @returns {string|undefined} The sanitized label, or undefined if invalid.
 */
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

/**
 * Retrieves environment information for analytics purposes.
 * @returns {Promise<{extVersion: string, platform: string, chromeMajor: string}>} Environment info object.
 */
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

/**
 * Checks if the user has consented to analytics tracking.
 * Default is opt-in (consent = true).
 * @returns {Promise<boolean>} True if user has consented to analytics.
 */
async function getConsent() {
  const { [ANALYTICS_CONSENT_KEY]: consent } = await chrome.storage.local.get(ANALYTICS_CONSENT_KEY);
  // Default ON (opt-out)
  return consent !== false;
}

/**
 * Gets or creates a unique instance ID for analytics, rotating every 30 days.
 * @returns {Promise<string>} The instance identifier.
 */
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

/**
 * Sends an analytics event to the Umami analytics endpoint.
 * Only sends if user has consented to analytics.
 * @param {string} name - The event name/category.
 * @param {Object} [data] - Additional event data to include.
 * @returns {Promise<void>}
 */
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

/**
 * Tracks when the extension is installed or updated.
 * @returns {Promise<void>}
 */
async function trackInstalled() {
  const env = await getEnvInfo();
  const instance = await getInstanceId();
  await sendUmamiEvent('installed', { ...env, instance });
}

/**
 * Tracks an error event for analytics purposes.
 * @param {string} category - The error category.
 * @param {string} code - The error code.
 * @returns {Promise<void>}
 */
async function trackErrorEvent(category, code) {
  const env = await getEnvInfo();
  const instance = await getInstanceId();
  const cat = sanitizeLabel(category) || 'unknown';
  const c = sanitizeLabel(code) || 'unknown';
  await sendUmamiEvent('error_event', { ...env, instance, category: cat, code: c });
}

/**
 * Tracks when a custom instruction is used.
 * @param {Object} params - The tracking parameters.
 * @param {string} params.instruction - The instruction name.
 * @param {string} params.model - The model name used.
 * @param {Array<string>} [params.tools] - Array of tool names used.
 * @returns {Promise<void>}
 */
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
  }
});

/**
 * Sends media analysis data to the side panel for processing.
 * @param {number} tabId - The ID of the tab where media was selected.
 * @param {Object} mediaData - The media data object containing type, base64, URL, etc.
 * @returns {Promise<Object>} The response from the message handler.
 */
async function sendMediaAnalysisMessage(tabId, mediaData) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: 'setMediaForAnalysis',
            mediaData: mediaData,
            tabId: tabId
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('Background: setMediaForAnalysis message failed:', chrome.runtime.lastError.message);
            }
            resolve(response);
        });
    });
}

/**
 * Determines MIME type based on file extension in a URL.
 * @param {string} url - The URL of the media file.
 * @returns {string} The MIME type string (defaults to 'image/jpeg' if unknown).
 */
function getMimeTypeFromUrl(url) {
    try {
        // Handle query parameters and fragments
        const cleanUrl = url.split('?')[0].split('#')[0];
        const extension = cleanUrl.split('.').pop().toLowerCase();

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

        const mimeType = mimeTypes[extension] || 'image/jpeg';
        return mimeType;
    } catch (error) {
        console.error('Error determining MIME type:', error);
        return 'image/jpeg';
    }
}

/**
 * Fetches media from a URL and converts it to base64 encoding.
 * @param {string} url - The URL of the media to fetch.
 * @returns {Promise<string>} Base64 encoded string of media.
 * @throws {Error} If the fetch fails or the media cannot be read.
 */
async function fetchMediaAsBase64(url) {
    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                const base64 = dataUrl.split(',')[1];
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

let messageListenerAdded = false;
let tabContentCallback = null;
let pinnedActionTabContentCallback = null;

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

// Unified context menu click handler for all modalities
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Validate tab exists and has a valid ID (tab.id is -1 for side panel, devtools, chrome:// URLs)
  if (!tab || tab.id === -1 || tab.id === undefined) {
    console.warn('Context menu invoked from invalid tab context - ignoring');
    return;
  }

  try {
    await chrome.sidePanel.open({ tabId: tab.id });

    // Detect media context
    const isMediaContext = info.mediaType === 'image' || info.mediaType === 'video' || info.mediaType === 'audio';
    const mediaUrl = info.srcUrl || '';
    const mediaType = info.mediaType || 'text';

    // Normalize selection text to avoid undefined
    let originalSelectionText = info.selectionText || '';
    let promptContent = originalSelectionText;

    // Fetch tab content only if we have no media and no selection
    if (!isMediaContext && !originalSelectionText) {
      try {
        const tabDataResponse = await new Promise((resolve, reject) => {
          const messageTimeout = setTimeout(() => {
            reject(new Error("Timeout waiting for getTabContent response"));
          }, 5000);

          chrome.runtime.sendMessage({ action: 'getTabContent', tabId: tab.id }, (response) => {
            clearTimeout(messageTimeout);
            if (chrome.runtime.lastError) {
              console.error("Background: Error receiving getTabContent response:", chrome.runtime.lastError.message);
              return reject(new Error("Failed to get tab content: " + chrome.runtime.lastError.message));
            }
            if (response) {
              resolve(response);
            } else {
              reject(new Error("Failed to get tab content: No response from getTabContent handler."));
            }
          });
        });

        if (tabDataResponse && tabDataResponse.success) {
          if (tabDataResponse.content) {
            promptContent = tabDataResponse.content;
          } else if (tabDataResponse.data) {
            promptContent = tabDataResponse.data;
          }
        }
      } catch (error) {
        console.error("Background: Exception while fetching tab content:", error.message);
        promptContent = '';
      }
    }

    // Handle media loading
    let mediaData = null;
    if (isMediaContext && mediaUrl) {
      try {
        const base64Data = await fetchMediaAsBase64(mediaUrl);
        const mimeType = getMimeTypeFromUrl(mediaUrl);

        mediaData = {
          type: mediaType,
          base64: base64Data,
          url: mediaUrl,
          mimeType: mimeType
        };
      } catch (error) {
        console.error('Error fetching media:', error);
        try { await trackErrorEvent('network', `media_${error?.name || 'err'}`); } catch (_) {}

        mediaData = {
          type: mediaType,
          base64: null,
          url: mediaUrl,
          mimeType: getMimeTypeFromUrl(mediaUrl),
          error: error.message
        };
      }

      // Send media to chat (but NOT for oneoff_instruction - it handles media separately)
      if (info.menuItemId !== 'oneoff_instruction') {
        await sendMediaAnalysisMessage(tab.id, {
          ...mediaData,
          loading: false
        });
      }
    }

    // Handle special menu items
    if (info.menuItemId === 'manageInstructions') {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
      return;
    }

    // Common message sending function
    const sendMessage = (action, extra = {}) => {
      try {
        chrome.runtime.sendMessage({
          action,
          selectedText: promptContent || '',
          tabId: tab.id,
          ...extra
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn(`Background: sendMessage (${action}) failed:`, chrome.runtime.lastError.message);
          }
        });
      } catch (error) {
        console.error(`Background: Exception sending message (${action}):`, error.message);
      }
    };

    // One-off instruction - open composer with optional media
    if (info.menuItemId === 'oneoff_instruction') {
      if (isMediaContext) {
        // For media, load it first, then open one-off with media attached
        setTimeout(() => {
          chrome.runtime.sendMessage({
            action: 'setSelectedText',
            selectedText: '',
            tabId: tab.id,
            mediaData: mediaData
          });
        }, SIDE_PANEL_READY_DELAY_MS);
      } else {
        // For text, just open composer
        setTimeout(() => sendMessage('setSelectedText'), 100);
      }
      return;
    }

    // Start chat
    if (info.menuItemId === 'start_chat') {
      sendMessage('setSelectedText', { fromStartChat: true, mediaData });
      if (isMediaContext) {
        // Media will be handled in chat.js via currentMediaData
        return;
      }
      await makeLlmApiRequest(promptContent, tab.id, { isStartChat: true });
      return;
    }

    // Handle custom instructions
    if (info.menuItemId.startsWith('custom_')) {
      const instructionId = info.menuItemId.replace('custom_', '');
      const { instructions } = await chrome.storage.local.get(['instructions']);
      const instruction = instructions.find(i => i.id === instructionId);

      if (instruction) {
        try {
          const cfg = await validateConfig().catch(() => ({}));
          await trackInstructionUsed({ instruction: instruction.name || 'custom', model: cfg?.modelName, tools: Array.isArray(instruction.tool_choice) ? instruction.tool_choice : (instruction.tool_choice && instruction.tool_choice !== 'none' ? [instruction.tool_choice] : []) });
        } catch (_) {}

        const toolChoice = instruction.tool_choice || 'none';

        if (isMediaContext) {
          // Send media with custom instruction to chat
          chrome.runtime.sendMessage({
            action: 'setMediaForAnalysis',
            mediaData: {
              ...mediaData,
              actionType: 'custom',
              instructionId: instructionId
            },
            tabId: tab.id
          });
        } else {
          // Text-only custom instruction
          const fullPrompt = `${instruction.content}\n\n${promptContent}`;
          await makeLlmApiRequest(fullPrompt, tab.id, { customInstructionToolChoice: toolChoice });
        }
      } else {
        console.error("Custom instruction not found for ID:", instructionId);
      }
      return;
    }

    // Handle predefined commands (modality-neutral prompts)
    const commandMap = {
      summarize: 'Please summarize the following content into a bullet list of key points',
      explain: 'Explain the following content to me in a short concise MECE approach. Break down what you see into clear, structured categories.',
      polish: 'Polish the following content with clarity and purpose',
      shorten: 'Shorten the following content without losing its meaning and context',
      formal: 'Make the following content more formal and eloquent',
      casual: 'Make the following content more casual and fun',
      analyze: 'Please analyze the following content. Describe what you see and provide any relevant insights.'
    };

    if (commandMap[info.menuItemId]) {
      try {
        const cfg = await validateConfig().catch(() => ({}));
        await trackInstructionUsed({ instruction: info.menuItemId, model: cfg?.modelName, tools: [] });
      } catch (_) {}

      if (isMediaContext) {
        // Send media with predefined instruction
        const actionType = info.menuItemId;
        chrome.runtime.sendMessage({
          action: 'setMediaForAnalysis',
          mediaData: {
            ...mediaData,
            actionType: actionType,
            instructionId: null
          },
          tabId: tab.id
        });
      } else {
        // Text-only predefined instruction
        const fullPrompt = `${commandMap[info.menuItemId]}:\n\n${promptContent}`;
        await makeLlmApiRequest(fullPrompt, tab.id);
      }
    }
  } catch (error) {
    console.error('Error in context menu click handler:', error);
  }
});

// Simplified validateConfig function
async function validateConfig() {
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
async function _handleApiResponseAndSendMessage(responseMessage, prompt, tabId, isStartChatContext) {
    const sendMessageDelay = isStartChatContext ? 300 : 200;

    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        // This is the OpenAI-style tool call
        setTimeout(() => {
            try {
                chrome.runtime.sendMessage({
                    action: 'handleToolCallResponse', // chat.js handles this by calling executePromptPaulTool
                    responseMessage: responseMessage,
                    prompt: prompt,
                    tabId: tabId,
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('Background: handleToolCallResponse message failed:', chrome.runtime.lastError.message);
                    }
                });
            } catch (error) {
                console.error('Background: Exception sending handleToolCallResponse:', error.message);
            }
        }, sendMessageDelay);

    } else if (responseMessage.content) { // Standard text response
        const latestResponse = typeof responseMessage.content === 'string' ? responseMessage.content : JSON.stringify(responseMessage.content);
        setTimeout(() => {
            try {
                chrome.runtime.sendMessage({
                    action: 'setApiResponse',
                    apiResponse: latestResponse,
                    prompt: prompt,
                    tabId: tabId,
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('Background: setApiResponse (standard) message failed:', chrome.runtime.lastError.message);
                    }
                });
            } catch (error) {
                console.error('Background: Exception sending setApiResponse (standard):', error.message);
            }
        }, sendMessageDelay);
    } else {
        console.error("Background: API response message has neither standard content nor tool_calls:", responseMessage);
        setTimeout(() => {
            try {
                chrome.runtime.sendMessage({
                    action: 'setApiResponse',
                    apiResponse: "Error: Received an empty or invalid response from the AI.",
                    prompt: prompt,
                    tabId: tabId,
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('Background: setApiResponse (error) message failed:', chrome.runtime.lastError.message);
                    }
                });
            } catch (error) {
                console.error('Background: Exception sending setApiResponse (error):', error.message);
            }
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
            }
        } else if (current_tool_choice_option === 'auto') {
            toolChoicePayload = { tools: formattedToolsForRequest, tool_choice: "auto" };
        } else if (typeof current_tool_choice_option === 'string') { // Specific tool name
            const specificTool = formattedToolsForRequest.find(t => t.function.name === current_tool_choice_option);
            if (specificTool) {
                toolChoicePayload = { tools: [specificTool], tool_choice: { type: "function", function: { name: current_tool_choice_option } } };
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
        };

        const fetchHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        };

        // Use standard OpenAI-style tool definition
        Object.assign(apiRequestBody, toolChoicePayload);

        if (enableStreaming) {
            apiRequestBody.stream = true;
        }




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
            const reader = apiResponse.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            // Send a message to chat.js to indicate streaming has started
            // This allows chat.js to prepare the UI for incoming chunks
            // Moved out of setTimeout to send immediately
            try {
                chrome.runtime.sendMessage({
                    action: 'streamApiStart',
                    tabId: tabId,
                    prompt: promptContent
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('Background: streamApiStart message failed:', chrome.runtime.lastError.message);
                    }
                });
            } catch (error) {
                console.error('Background: Exception sending streamApiStart:', error.message);
            }

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    try {
                        chrome.runtime.sendMessage({ action: 'streamApiEnd', tabId: tabId, prompt: promptContent }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.warn('Background: streamApiEnd message failed:', chrome.runtime.lastError.message);
                            }
                        });
                    } catch (error) {
                        console.error('Background: Exception sending streamApiEnd:', error.message);
                    }
                    break;
                }

                buffer += decoder.decode(value, { stream: true });

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
                            continue;
                        }

                        // Proceed to parse only if currentPayload is not empty and looks like JSON
                        if (currentPayload && currentPayload.length > 0 && (currentPayload.startsWith('{') || currentPayload.startsWith('['))) {
                            try {
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
                                        });
                                    }

                                    if (toolCallChunk) {
                                        chrome.runtime.sendMessage({
                                            action: 'streamApiToolCallChunk',
                                            toolCallChunk: toolCallChunk,
                                            tabId: tabId,
                                            prompt: promptContent
                                        });
                                    }
                                }
                            } catch (e) {
                                console.error("Background: Error parsing JSON from stream:", e, "Attempted to parse:", currentPayload, "Original full line:", line);
                            }
                        } else if (currentPayload) {
                        }
                    }
                }
            }
        } else { // Non-streaming path
            const responseData = await apiResponse.json();
            // Extract the message object from the response
            const messageObject = responseData.choices && responseData.choices[0] ? responseData.choices[0].message : null;

            if (!messageObject) {
                 throw new Error('Invalid response format from API: Missing message structure.');
            }
            await _handleApiResponseAndSendMessage(messageObject, promptContent, tabId, isStartChat, false);
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

// Unified context menu creation for all modalities
async function createUnifiedMenus() {
  const modalities = ['selection', 'image', 'video', 'audio'];

  // Create one-off instruction menu item (always at top)
  chrome.contextMenus.create({
    id: 'oneoff_instruction',
    title: '✨ One-off Instruction',
    contexts: modalities,
  });

  // Create start chat menu item
  chrome.contextMenus.create({
    id: 'start_chat',
    title: '💬 Start Chat',
    contexts: modalities,
  });

  // Create parent menu for Prompt Paul
  chrome.contextMenus.create({
    id: 'prompt_paul',
    title: 'Query Prompt Paul',
    contexts: modalities,
  });

  // Create predefined menu items under Prompt Paul
  chrome.contextMenus.create({
    id: 'summarize',
    title: '📝 Summarize',
    contexts: modalities,
    parentId: 'prompt_paul'
  });
  chrome.contextMenus.create({
    id: 'analyze',
    title: '🔍 Analyze',
    contexts: modalities,
    parentId: 'prompt_paul'
  });
  chrome.contextMenus.create({
    id: 'explain',
    title: '❓ Explain',
    contexts: modalities,
    parentId: 'prompt_paul'
  });
  chrome.contextMenus.create({
    id: 'polish',
    title: '🪄 Polish',
    contexts: modalities,
    parentId: 'prompt_paul'
  });

  chrome.contextMenus.create({
    id: 'shorten',
    title: '✂️ Shorten',
    contexts: modalities,
    parentId: 'prompt_paul'
  });

  chrome.contextMenus.create({
    id: 'formal',
    title: '💼 Formal',
    contexts: modalities,
    parentId: 'prompt_paul'
  });
  chrome.contextMenus.create({
    id: 'casual',
    title: '🤙 Casual',
    contexts: modalities,
    parentId: 'prompt_paul'
  });

  // Create custom instructions menu items
  chrome.contextMenus.create({
    id: 'customInstructions',
    title: 'Custom Instructions',
    contexts: modalities,
  });

  const { instructions } = await chrome.storage.local.get(['instructions']);
  if (instructions && instructions.length > 0) {
    instructions.forEach(instruction => {
      chrome.contextMenus.create({
        id: `custom_${instruction.id}`,
        parentId: 'customInstructions',
        title: `✨ ${instruction.name}`,
        contexts: modalities,
      });
    });
  }

  // Add a separator and manage instructions at the end
  setTimeout(() => {
    chrome.contextMenus.create({
      id: 'separator',
      type: 'separator',
      contexts: modalities,
    });

    chrome.contextMenus.create({
      id: 'manageInstructions',
      title: 'Manage Custom Instructions',
      contexts: modalities,
    });
  }, 100);
}

// Create context menu items on install
chrome.runtime.onInstalled.addListener(async () => {
  await createUnifiedMenus();
});

// Update context menus when instructions change
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && changes.instructions) {
    // Remove all unified menu items and recreate
    const menuIdsToRemove = [
      'oneoff_instruction',
      'start_chat',
      'prompt_paul',
      'summarize',
      'analyze',
      'explain',
      'polish',
      'shorten',
      'formal',
      'casual',
      'customInstructions',
      'separator',
      'manageInstructions'
    ];

    // Remove existing custom instruction menu items
    if (changes.instructions.oldValue) {
      changes.instructions.oldValue.forEach(instruction => {
        menuIdsToRemove.push(`custom_${instruction.id}`);
      });
    }

    menuIdsToRemove.forEach(id => {
      chrome.contextMenus.remove(id, () => {
        if (chrome.runtime.lastError) {
          // Ignore errors if menu doesn't exist
        }
      });
    });

    // Recreate all menus
    await createUnifiedMenus();
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
async function callUserDefinedEndpoint(endpointUrl, args, userDefinedMethod = 'GET') {
    try {
        let finalEndpointUrl = endpointUrl;
        let finalFetchOptions = {
            headers: {
                'Accept': 'application/json'
            }
        };
        let finalArgs = args;

        const isEmptyArgs = !args || Object.keys(args).length === 0;
        let method = userDefinedMethod || (isEmptyArgs ? 'GET' : 'POST');
        method = method.toUpperCase();
        finalFetchOptions.method = method;

        if (method === 'GET' && !isEmptyArgs) {
            const queryParams = new URLSearchParams(finalArgs).toString();
            finalEndpointUrl = `${finalEndpointUrl}?${queryParams}`;
        } else if (['POST', 'PUT', 'PATCH'].includes(method) && !isEmptyArgs) {
            finalFetchOptions.headers['Content-Type'] = 'application/json';
            finalFetchOptions.body = JSON.stringify(finalArgs);
        }
        // For DELETE, args might be used in the URL path or ignored


        const response = await fetch(finalEndpointUrl, finalFetchOptions); // Use finalEndpointUrl and finalFetchOptions

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

        let result;
        if (contentType && contentType.includes('application/json')) {
            result = await response.json();
        } else {
            result = await response.text();
        }

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
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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


    if (request.action === 'getLoadContent') {
        if (tabContentCallback) {
            sendResponse({ action: 'loadContentResponse', success: false, error: 'Another content extraction is already in progress' });
            return true;
        }

        tabContentCallback = sendResponse;

        const timeoutId = setTimeout(() => {
            if (tabContentCallback) {
                console.error('Background: getLoadContent timed out.');
                tabContentCallback({ action: 'loadContentResponse', success: false, error: 'Background: Content extraction timed out' });
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
                        console.error('Background: Error executing content_script_unified.js for getLoadContent:', chrome.runtime.lastError);
                        if (tabContentCallback) {
                            tabContentCallback({ action: 'loadContentResponse', success: false, error: 'Failed to execute script: ' + chrome.runtime.lastError.message });
                            tabContentCallback = null;
                        }
                        return;
                    }
                    if (injectionResults && injectionResults[0] && injectionResults[0].result) {
                        const result = injectionResults[0].result;
                        if (tabContentCallback) {
                            tabContentCallback({
                                action: 'loadContentResponse',
                                success: result.success,
                                content: result.data,
                                title: result.title,
                                url: result.url,
                                error: result.error
                            });
                            tabContentCallback = null;
                        }
                    } else {
                        console.error('Background: getLoadContent - No result from content_script_unified.js');
                        if (tabContentCallback) {
                            tabContentCallback({ action: 'loadContentResponse', success: false, error: 'No result from content script', content: '' });
                            tabContentCallback = null;
                        }
                    }
                });
            } else {
                console.error('No active tab found for getLoadContent.');
                clearTimeout(timeoutId);
                if (tabContentCallback) {
                    tabContentCallback({ action: 'loadContentResponse', success: false, error: 'No active tab found.' });
                    tabContentCallback = null;
                }
            }
        });
        return true;
    }

    if (request.action === 'getTabContent') {
        if (tabContentCallback) {
            sendResponse({ action: 'tabContentResponse', success: false, error: 'Another content extraction is already in progress' });
            return true;
        }

        tabContentCallback = sendResponse;

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

        // Prevent duplicate executions
        const executionKey = `${id}-${name}`;
        if (activeToolExecutions.has(executionKey)) {
            return true;
        }

        activeToolExecutions.add(executionKey);

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

                if (toolDefinition.endpointUrl) {
                    // User-defined endpoint tool
                    const result = await callUserDefinedEndpoint(toolDefinition.endpointUrl, argsObject, toolDefinition.httpMethod);
                    try { await trackInstructionUsed({ instruction: 'tool_invoke', model: (await validateConfig().catch(()=>({})))?.modelName, tools: [name] }); } catch (_) {}
                    sendResponse({ result: result });
                } else {
                    // Built-in tool implementation
                    const builtInFunction = toolImplementations[name];
                    if (builtInFunction) {
                        const result = await builtInFunction(argsObject);
                        try { await trackInstructionUsed({ instruction: 'tool_invoke', model: (await validateConfig().catch(()=>({})))?.modelName, tools: [name] }); } catch (_) {}
                        sendResponse({ result: result });
                    } else {
                        throw new Error(`Tool '${name}' is not properly configured: It has no endpointUrl and no built-in implementation.`);
                    }
                }

            } catch (error) { // General error catch for executePromptPaulTool
                console.error(`Background: Error processing tool '${name}' in executePromptPaulTool:`, error);
                let errorMessage = error.message || 'Tool processing failed';
                if (error.details) {
                    errorMessage += ` (Details: ${JSON.stringify(error.details)})`;
                }
                sendResponse({ error: errorMessage });
            } finally {
                // Always remove from active executions when done
                activeToolExecutions.delete(executionKey);
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
