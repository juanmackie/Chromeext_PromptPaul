// Import all modules
import { memoryManager } from './background/memory-manager.js';
import { mediaHandler } from './background/media-handler.js';
import { toolManager } from './background/tool-manager.js';
import { eventManager } from './background/event-manager.js';
import { apiClient } from './background/api-client.js';
import analytics from './analytics.js';

// Set cross-module references
apiClient.setToolManager(toolManager);

// Register collections with memory manager
memoryManager.register('activeToolExecutions', toolManager.activeToolExecutions);
memoryManager.register('activeMessages', eventManager.activeMessages);
memoryManager.register('eventListeners', eventManager.listeners);

// Context menu setup
function setupContextMenu() {
  // Clear existing context menus
  chrome.contextMenus.removeAll(() => {
    // Main menu for analyzing selection
    chrome.contextMenus.create({
      id: 'analyzeSelection',
      title: 'Explain with PromptPaul',
      contexts: ['selection'],
    });

    // Menu for analyzing images
    chrome.contextMenus.create({
      id: 'analyzeImage',
      title: 'Analyze Image with PromptPaul',
      contexts: ['image'],
    });

    // Menu for explaining page
    chrome.contextMenus.create({
      id: 'explainPage',
      title: 'Explain Page with PromptPaul',
      contexts: ['page'],
    });

    // Menu for custom instructions (will be populated dynamically)
    chrome.contextMenus.create({
      id: 'customInstructions',
      title: 'Custom Instructions',
      contexts: ['selection', 'image'],
    });

    // Load and add custom instructions
    chrome.storage.local.get(['instructions'], result => {
      if (result.instructions && result.instructions.length > 0) {
        result.instructions.forEach(instruction => {
          chrome.contextMenus.create({
            id: `custom_${instruction.id}`,
            parentId: 'customInstructions',
            title: `✨ ${instruction.name}`,
            contexts: ['selection', 'image'],
          });
        });
      }
    });

    // Add management option
    chrome.contextMenus.create({
      id: 'manageInstructions',
      title: 'Manage Custom Instructions',
      contexts: ['selection', 'image'],
    });
  });
}

// Initialize on extension startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('PromptPaul extension installed');
  setupContextMenu();
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuItemId = info.menuItemId;

  try {
    // Get tab content
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        return {
          title: document.title,
          url: window.location.href,
          selection: window.getSelection().toString(),
          pageContent: document.body.innerText,
        };
      },
    });

    const { title, url, selection, pageContent } = result.result;

    let prompt = '';

    // Handle different menu actions
    if (menuItemId === 'analyzeSelection' && selection) {
      prompt = `Please explain: ${selection}`;
    } else if (menuItemId === 'analyzeImage' && info.srcUrl) {
      // Handle image analysis
      const base64Image = await mediaHandler.fetchMediaAsBase64(info.srcUrl);
      prompt = `Please analyze this image: ${base64Image}`;
    } else if (menuItemId === 'explainPage') {
      prompt = `Please explain this page:\n\nTitle: ${title}\nURL: ${url}\n\nContent: ${pageContent}`;
    } else if (menuItemId.toString().startsWith('custom_')) {
      // Handle custom instruction
      const instructionId = menuItemId.toString().replace('custom_', '');
      const { instructions } = await chrome.storage.local.get(['instructions']);
      const instruction = instructions.find(i => i.id === instructionId);

      if (instruction) {
        prompt = instruction.prompt;
        if (selection) {
          prompt = `${instruction.prompt}\n\nSelection: ${selection}`;
        }
      }
    } else if (menuItemId === 'manageInstructions') {
      // Open options page
      chrome.runtime.openOptionsPage();
      return;
    }

    // Send prompt to API
    if (prompt) {
      await apiClient.makeApiRequest(prompt, tab.id);
    }
  } catch (error) {
    console.error('Error handling context menu click:', error);
  }
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Register message for race condition protection
  const messageId = eventManager.registerMessage(request, sender);

  // Create enhanced sendResponse with race condition protection
  const safeSendResponse = response => {
    if (!eventManager.wasMessageResponded(messageId)) {
      eventManager.markMessageResponded(messageId);

      if (response) {
        response._messageId = messageId;
        response._timestamp = Date.now();
      }

      sendResponse(response);
    }
  };

  // Handle different message types
  (async () => {
    try {
      switch (request.action) {
        case 'getTabContent':
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            func: () => document.body.innerText,
          });
          safeSendResponse({ content: result.result });
          break;

        case 'makeLlmApiRequest':
          await apiClient.makeApiRequest(request.prompt, sender.tab.id, request.options);
          safeSendResponse({ success: true });
          break;

        case 'executeTool':
          const toolResult = await toolManager.executeTool(request.toolCall, request.config);
          safeSendResponse(toolResult);
          break;

        case 'getMemoryReport':
          safeSendResponse(memoryManager.getReport());
          break;

        case 'getToolManagerReport':
          safeSendResponse(toolManager.getReport());
          break;

        case 'getEventManagerReport':
          safeSendResponse(eventManager.getReport());
          break;

        default:
          console.warn('Unknown action:', request.action);
          safeSendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      safeSendResponse({ error: error.message });
    }
  })();

  // Return true to indicate async response
  return true;
});

// Storage change listener
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.instructions) {
    // Rebuild context menu when instructions change
    setupContextMenu();
  }
});

// Analytics tracking for extension usage
chrome.runtime.onStartup.addListener(() => {
  analytics.trackExtensionUsed({ action: 'startup' });
});

chrome.runtime.onInstalled.addListener(() => {
  analytics.trackExtensionUsed({ action: 'installed' });
});

console.log('PromptPaul background script initialized');
