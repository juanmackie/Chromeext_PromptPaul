// ===== Main Background Script - Orchestrates all services =====

// import './marked.min.js'; // Not needed in service worker
import { trackInstalled, trackErrorEvent, trackInstructionUsed, initializeAnalyticsConsent } from './analytics.js';
import { initializeContextMenus, fetchMediaAsBase64, getMimeTypeFromUrl } from './contextMenuService.js';
import { makeLlmApiRequest } from './apiService.js';
import { getAllToolDefinitions, executeToolCall } from './toolService.js';
import { createMcpSystem, createMcpClient } from './mcp/index.js';

// Global state for message handling
let messageListenerAdded = false;
let tabContentCallback = null; // To store sendResponse for getTabContent
let pinnedActionTabContentCallback = null; // To store sendResponse for getPinnedActionTabContent

// Initialize all services
let initServicesPromise = null;
async function initializeBackgroundServices() {
  try {
    console.log('Initializing background services...');

    // Prevent concurrent init
    if (initServicesPromise) { try { await initServicesPromise; } catch (_) {} return; }
    initServicesPromise = (async () => {
    
    // Initialize analytics consent
    await initializeAnalyticsConsent();
    
    // Initialize context menus
    await initializeContextMenus();
    
    // Initialize MCP system
    try {
      globalThis.mcpSystem = createMcpSystem();
      await globalThis.mcpSystem.initialize();
      console.log('MCP system initialized successfully');
    } catch (error) {
      console.error('Failed to initialize MCP system:', error);
    }
    
    // Track installation
    await trackInstalled();
    
    console.log('Background services initialized successfully');
    })();
    await initServicesPromise;
  } catch (error) {
    console.error('Error initializing background services:', error);
    await trackErrorEvent('initialization', 'services_init_failed');
  }
}

// Tab management
chrome.tabs.onActivated.addListener(({ tabId }) => {
  console.log("Background: Tab activated, tabId:", tabId);
  
  if (tabContentCallback) {
    tabContentCallback({ 
      action: 'getTabContentResponse', 
      success: false, 
      error: 'Tab changed during content extraction' 
    });
    tabContentCallback = null;
  }
  
  if (pinnedActionTabContentCallback) {
    pinnedActionTabContentCallback({ 
      action: 'getPinnedActionTabContentResponse', 
      success: false, 
      error: 'Tab changed during content extraction' 
    });
    pinnedActionTabContentCallback = null;
  }
});

// Context menu handlers
async function getSelectionOrPageText(info, tab) {
  // If user selected text, use it; otherwise inject content script to get page text
  if (info.selectionText && info.selectionText.trim()) {
    return info.selectionText.trim();
  }
  try {
    // Using chrome.tabs.sendMessage to get content from the content script
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageContent' });
    // content_script_unified now returns {success,content,title,url}
    const content = response?.content || response?.data || '';
    if (content && content.trim()) return content.trim();
  } catch (error) {
    console.warn('Error getting content via sendMessage:', error);
  }
  // Fallback: directly extract from the page via scripting
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        try {
          const el = document.body;
          const txt = (el?.innerText || el?.textContent || '').trim();
          return txt;
        } catch (e) {
          return '';
        }
      }
    });
    if (res && res.result && res.result.trim()) return res.result.trim();
  } catch (error) {
    console.warn('Error getting content via executeScript:', error);
  }
  return '';
}

async function handleImageMenuClick(info, tab) {
  try {
    // Kick off loading state in side panel
    try {
      await sendToPanel({
        action: 'setMediaForAnalysis',
        mediaData: { type: 'image', base64: null, url: info.srcUrl, mimeType: getMimeTypeFromUrl(info.srcUrl), loading: true },
        tabId: tab.id
      });
    } catch (_) {}

    // Fetch and send image
    const imageDataUrl = await fetchMediaAsBase64(info.srcUrl);
    const mimeType = getMimeTypeFromUrl(info.srcUrl);
    const base64 = imageDataUrl.startsWith('data:') ? imageDataUrl.split(',')[1] : imageDataUrl;

    let actionType = 'analyze';
    let instructionId = null;
    if (info.menuItemId === 'summarizeImage') actionType = 'summarize';
    else if (info.menuItemId === 'explainImage') actionType = 'explain';
    else if (info.menuItemId.startsWith('image_instruction_')) { actionType = 'custom'; instructionId = info.menuItemId.replace('image_instruction_', ''); }

    await sendToPanel({
      action: 'setMediaForAnalysis',
      mediaData: { type: 'image', base64: base64, url: info.srcUrl, mimeType, loading: false, actionType, instructionId },
      tabId: tab.id
    });
  } catch (error) {
    console.error('Error handling image menu:', error);
    try {
      await chrome.runtime.sendMessage({ action: 'setMediaForAnalysis', mediaData: { type: 'image', base64: null, url: info.srcUrl, mimeType: getMimeTypeFromUrl(info.srcUrl), error: error.message }, tabId: tab.id });
    } catch (_) {}
  }
}

async function handleMediaGeneric(info, tab, type, defaultPrompt) {
  try {
    await openSidePanelForTab(tab.id);
    await new Promise(r => setTimeout(r, 150));
    try {
      await sendToPanel({ action: 'setMediaForAnalysis', mediaData: { type, base64: null, url: info.srcUrl, mimeType: '', loading: true }, tabId: tab.id });
    } catch (_) {}
    await sendToPanelWithRetry({ action: 'executePrompt', prompt: defaultPrompt, tool_choice: 'none' });
  } catch (e) {
    console.error('Error handling media generic:', e);
  }
}

// Context menu handlers
async function sendToPanel(message) {
  // Stamp a messageId for deduplication on the UI side
  if (message && message.action === 'executePrompt' && !message.messageId) {
    message.messageId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  // First try sidePanel.postMessage (Chrome 122+)
  try {
    if (chrome.sidePanel && chrome.sidePanel.postMessage) {
      await chrome.sidePanel.postMessage(message);
      return true;
    }
  } catch (e) {
    // ignore, will retry using runtime
  }
  // Fallback to runtime broadcast; chat.js listens via chrome.runtime.onMessage
  try {
    await chrome.runtime.sendMessage(message);
    return true;
  } catch (e) {
    const em = (e && e.message) ? e.message : String(e || '');
    // If there is no receiver at all, we truly failed
    if (em.includes('Receiving end does not exist')) {
      return false;
    }
    // A very common MV3 rejection when the receiver doesn't send a response
    if (em.includes('The message port closed before a response was received')) {
      // Message likely delivered; treat as success to avoid duplicate retries
      return true;
    }
    // Be permissive for other transient errors to avoid spamming duplicates
    return true;
  }
}

async function sendToPanelWithRetry(message, attempts = 8, delayMs = 200) {
  // Reduce retries for executePrompt to avoid flooding duplicates
  if (message?.action === 'executePrompt') {
    attempts = Math.min(attempts, 2);
  }
  for (let i = 0; i < attempts; i++) {
    const ok = await sendToPanel(message);
    if (ok) return true;
    await new Promise(r => setTimeout(r, delayMs));
  }
  console.warn('Failed to deliver message to panel after retries:', message.action, message?.messageId || 'no-id');
  return false;
}

async function openSidePanelForTab(tabId) {
  if (!chrome.sidePanel || !chrome.sidePanel.open) {
    console.warn('Side panel API not available or open() missing.');
    return false;
  }

  // Fire-and-forget enabling to avoid losing user gesture before open
  try {
    if (chrome.sidePanel.setOptions) {
      chrome.sidePanel.setOptions({ tabId, path: 'chat.html', enabled: true })
        .catch(e => console.warn('Non-fatal: pre-open setOptions failed:', e));
    }
  } catch (_) {}

  // Try to open immediately to preserve the user gesture
  try {
    await chrome.sidePanel.open({ tabId });
    return true;
  } catch (openErr) {
    console.warn('Initial side panel open failed, attempting to enable and retry:', openErr);
    // If open failed (likely not enabled yet), enable and retry once (awaiting this time)
    try {
      if (chrome.sidePanel.setOptions) {
        await chrome.sidePanel.setOptions({ tabId, path: 'chat.html', enabled: true });
      }
      await chrome.sidePanel.open({ tabId });
      return true;
    } catch (retryErr) {
      console.error('Retry to open side panel failed:', retryErr);
      return false;
    }
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    console.log("Context menu clicked:", info.menuItemId, "on tab:", tab.id);

    // Manage Custom Instructions opens options page; do not open side panel
    if (info.menuItemId === 'manageInstructions') {
      openOptionsPage();
      return;
    }

    // Always try to open the side panel for leaf actions (non-manage)
    await openSidePanelForTab(tab.id);
    await new Promise(r => setTimeout(r, 150));

    // Handle media analysis menus
    if (info.menuItemId === 'analyzeImage' || info.menuItemId === 'summarizeImage' || info.menuItemId === 'explainImage' || info.menuItemId.startsWith('image_instruction_')) {
      await handleImageMenuClick(info, tab);
      return;
    }
    if (info.menuItemId === 'analyzeVideo') {
      await handleMediaGeneric(info, tab, 'video', 'Please analyze this video and describe the key events, content, and insights.');
      return;
    }
    if (info.menuItemId === 'analyzeAudio') {
      await handleMediaGeneric(info, tab, 'audio', 'Please analyze this audio and summarize the key content and insights.');
      return;
    }

    // Text selection actions
    const baseText = await getSelectionOrPageText(info, tab);

    if (info.menuItemId === 'oneoff_instruction') {
      // Show one-off input in the panel
      await sendToPanelWithRetry({ action: 'setSelectedText', selectedText: baseText, tabId: tab.id, fromStartChat: false });
      return;
    }

    if (info.menuItemId === 'start_chat') {
      await sendToPanelWithRetry({ action: 'setSelectedText', selectedText: baseText, tabId: tab.id, fromStartChat: true });
      await sendToPanel({ action: 'executePrompt', prompt: baseText, tool_choice: 'none' });
      return;
    }

    // Custom instruction under Custom Instructions
    if (info.menuItemId.startsWith('custom_')) {
      const instructionId = info.menuItemId.replace('custom_', '');
      const { instructions } = await chrome.storage.local.get(['instructions']);
      const instruction = instructions?.find(i => i.id === instructionId);
      if (!instruction) return;
      const toolChoice = Array.isArray(instruction.tool_choice) ? (instruction.tool_choice[0] || 'none') : (instruction.tool_choice || 'none');
      const prompt = `${instruction.content || instruction.prompt || ''}\n\n${baseText}`.trim();
      try { await trackInstructionUsed({ instruction: instruction.name || 'custom', model: 'text', tools: toolChoice && toolChoice !== 'none' ? [toolChoice] : [] }); } catch (_) {}
      await sendToPanelWithRetry({ action: 'executePrompt', prompt, tool_choice: toolChoice });
      return;
    }

    // Predefined Prompt Paul children
    const commandMap = {
      summarize: 'Please summarize the following text into a bullet list of points',
      analyze: 'Please analyze the following text',
      explain: 'Explain this to me in a short concise MECE approach',
      polish: 'Polish this text with clarity and purpose',
      shorten: 'Shorten this text without losing its meaning and context',
      formal: 'Make this text more formal and eloquent',
      casual: 'Make this text more casual and fun'
    };

    if (commandMap[info.menuItemId]) {
      try { await trackInstructionUsed({ instruction: info.menuItemId, model: 'text', tools: [] }); } catch (_) {}
      const prompt = `${commandMap[info.menuItemId]}:\n${baseText}`;
      await sendToPanelWithRetry({ action: 'executePrompt', prompt, tool_choice: 'none' });
      return;
    }
  } catch (error) {
    console.error('Error handling context menu click:', error);
    await trackErrorEvent('context_menu', 'click_handler_failed');
  }
});

// Deprecated: old image instruction handler retained for compatibility
async function handleImageInstruction(info, tab) {
  try {
    const instructionId = info.menuItemId.replace('image_instruction_', '');
    const { instructions } = await chrome.storage.local.get(['instructions']);
    const instruction = instructions?.find(inst => inst.id === instructionId);
    
    if (!instruction) {
      console.error('Instruction not found:', instructionId);
      return;
    }

    // Fetch the image
    const imageDataUrl = await fetchMediaAsBase64(info.srcUrl);
    const mimeType = getMimeTypeFromUrl(info.srcUrl);
    
    // Create prompt with image
    const prompt = `${instruction.prompt}\n\n[Image: ${info.srcUrl}]`;
    
    // Send to LLM with image data
    await makeLlmApiRequest(prompt, tab.id, {
      isStartChat: true,
      imageData: {
        data: imageDataUrl,
        mimeType: mimeType,
        url: info.srcUrl
      }
    });

    // Track usage
    await trackInstructionUsed({
      instruction: instruction.title,
      model: 'image_analysis',
      tools: []
    });

  } catch (error) {
    console.error('Error handling image instruction:', error);
    await trackErrorEvent('image_instruction', 'execution_failed');
  }
}

// Options page handler
function openOptionsPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
}

// MCP server testing handler
async function handleTestMcpServer(request) {
  try {
    const { serverUrl, serverAuth } = request;
    
    if (!globalThis.mcpSystem) {
      return { success: false, error: 'MCP system not initialized' };
    }

    // Create a temporary transport to test the connection
    
    // Determine config based on URL
    let config;
    if (serverUrl.startsWith('wss://') || serverUrl.startsWith('ws://')) {
      config = {
        type: 'websocket',
        url: serverUrl,
        auth: serverAuth
      };
    } else if (serverUrl.startsWith('http://') || serverUrl.startsWith('https://')) {
      config = {
        type: 'http-sse',
        url: serverUrl,
        headers: serverAuth ? { 'Authorization': serverAuth } : {}
      };
    } else {
      return { success: false, error: 'Unsupported server URL format' };
    }

    // Test connection with timeout
    const client = await createMcpClient(config);
    await client.disconnect();
    
    return { success: true, message: 'Connection test successful' };
  } catch (error) {
    console.error('MCP server test failed:', error);
    return { success: false, error: error.message };
  }
}

// Main message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background: Received message:", request.action, "from:", sender.tab?.id || 'extension');

  const handleAsync = async () => {
    try {
      switch (request.action) {
        case 'openOptions':
          openOptionsPage();
          return { success: true };

        case 'getTabContent':
          return await handleGetTabContent(request, sender, sendResponse);

        case 'getExplainContent':
          return await handleGetExplainContent(request, sender, sendResponse);

        case 'getPinnedActionTabContent':
          return await handleGetPinnedActionTabContent(request, sender, sendResponse);

        case 'makeApiRequest':
          await makeLlmApiRequest(request.prompt, sender.tab?.id, {
            isStartChat: request.isStartChat || false
          });
          return { success: true };

        case 'trackError':
          await trackErrorEvent(request.category, request.code);
          return { success: true };

        case 'trackInstructionUsage':
          await trackInstructionUsed(request.data);
          return { success: true };

        case 'handleToolCallResponse':
          await handleToolCallResponse(request);
          return { success: true };

        case 'testMcpServer':
          return await handleTestMcpServer(request);

        default:
          console.warn('Unknown action:', request.action);
          return { success: false, error: 'Unknown action' };
      }
    } catch (error) {
      console.error('Error handling message:', error);
      await trackErrorEvent('message_handler', error.message);
      return { success: false, error: error.message };
    }
  };

  // Handle async operations
  handleAsync().then(result => {
    if (sendResponse) {
      sendResponse(result);
    }
  }).catch(error => {
    console.error('Async handler error:', error);
    if (sendResponse) {
      sendResponse({ success: false, error: error.message });
    }
  });

  return true; // Keep the message channel open for async response
});

async function handleGetTabContent(request, sender, sendResponse) {
  tabContentCallback = sendResponse;
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) {
      throw new Error('No active tab found');
    }

    chrome.tabs.sendMessage(tabs[0].id, {
      action: 'getPageContent'
    }).then(response => {
      tabContentCallback = null;
      sendResponse({
        action: 'getTabContentResponse',
        success: true,
        content: response?.content || '',
        title: response?.title || '',
        url: response?.url || ''
      });
    }).catch(error => {
      tabContentCallback = null;
      console.error('Error getting tab content:', error);
      sendResponse({
        action: 'getTabContentResponse',
        success: false,
        error: error.message
      });
    });
    
    // Return true to keep the message channel open for async response
    return true;
  } catch (error) {
    tabContentCallback = null;
    sendResponse({
      action: 'getTabContentResponse',
      success: false,
      error: error.message
    });
    return true; // Keep message channel open for async response
  }
}

async function handleGetExplainContent(request, sender, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) {
      throw new Error('No active tab found');
    }

    // In Chrome extensions, chrome.tabs.sendMessage returns a Promise that resolves with the response
    // from the content script, but when used inside runtime.onMessage listener we need to return true
    // to keep the message channel open for async response
    
    chrome.tabs.sendMessage(tabs[0].id, {
      action: 'getPageContent'
    }).then(response => {
      // Send response back to the requesting script
      sendResponse({
        action: 'explainContentResponse',
        success: true,
        content: response?.content || '',
        title: response?.title || '',
        url: response?.url || ''
      });
    }).catch(error => {
      console.error('Error getting page content for explain:', error);
      sendResponse({
        action: 'explainContentResponse',
        success: false,
        error: error.message
      });
    });
    
    // Return true to keep the message channel open for async response
    return true;
  } catch (error) {
    console.error('Error in handleGetExplainContent:', error);
    sendResponse({
      action: 'explainContentResponse',
      success: false,
      error: error.message
    });
    return true; // Keep message channel open for async response
  }
}

async function handleGetPinnedActionTabContent(request, sender, sendResponse) {
  pinnedActionTabContentCallback = sendResponse;
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) {
      throw new Error('No active tab found');
    }

    chrome.tabs.sendMessage(tabs[0].id, {
      action: 'getPageContent'
    }).then(response => {
      pinnedActionTabContentCallback = null;
      sendResponse({
        action: 'getPinnedActionTabContentResponse',
        success: true,
        content: response?.content || '',
        title: response?.title || '',
        url: response?.url || ''
      });
    }).catch(error => {
      pinnedActionTabContentCallback = null;
      console.error('Error getting pinned action tab content:', error);
      sendResponse({
        action: 'getPinnedActionTabContentResponse',
        success: false,
        error: error.message
      });
    });
    
    // Return true to keep the message channel open for async response
    return true;
  } catch (error) {
    pinnedActionTabContentCallback = null;
    sendResponse({
      action: 'getPinnedActionTabContentResponse',
      success: false,
      error: error.message
    });
    return true; // Keep message channel open for async response
  }
}

// Handle tool call response from apiService
async function handleToolCallResponse(request) {
  try {
    const { responseMessage, tabId, isStartChat } = request;
    
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      // Import toolService dynamically to handle tool calls
      const { handleToolCalls } = await import('./toolService.js');
      // Create a mock API response structure
      const mockApiResponse = {
        choices: [{
          message: responseMessage
        }]
      };
      await handleToolCalls(mockApiResponse, {}, {}, '', tabId, isStartChat);
    }
  } catch (error) {
    console.error('Error handling tool call response:', error);
    await trackErrorEvent('tool_call', 'response_handler_failed');
  }
}

// Extension lifecycle management
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Extension installed/updated:', details.reason);
  await initializeBackgroundServices();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('Extension startup');
  await initializeBackgroundServices();
});

chrome.runtime.onSuspend?.addListener(async () => {
  console.log('Extension suspending, cleaning up resources');
  try {
    if (globalThis.mcpSystem) {
      await globalThis.mcpSystem.destroy();
      console.log('MCP system cleaned up successfully');
    }
  } catch (error) {
    console.error('Error cleaning up MCP system:', error);
  }
});

// Initialize services immediately
initializeBackgroundServices();

// Proactively configure the side panel so it's ready when a context menu is clicked
try {
  if (chrome.sidePanel?.setOptions) {
    // Set default path globally (manifest also defines default_path)
    chrome.sidePanel.setOptions({ path: 'chat.html' }).catch(e => console.error('Side panel setOptions (global) error:', e));
  }
} catch (_) {}

// Ensure the side panel is enabled for the active tab
chrome.tabs.onActivated.addListener(({ tabId }) => {
  try {
    if (chrome.sidePanel?.setOptions) {
      chrome.sidePanel.setOptions({ tabId, path: 'chat.html', enabled: true }).catch(e => console.error(`Side panel setOptions for tab ${tabId} error:`, e));
    }
  } catch (_) {}
});
