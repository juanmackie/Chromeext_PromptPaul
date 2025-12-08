// Initialize browser polyfill for cross-browser compatibility
import './utils/browser-polyfill.js';

// Import all modules
import { memoryManager } from './background/memory-manager.js';
import { mediaHandler } from './background/media-handler.js';
import { toolManager } from './background/tool-manager.js';
import { eventManager } from './background/event-manager.js';
import { apiClient } from './background/api-client.js';
import analytics from './analytics.js';
import logger from './utils/logger.js';

// Set cross-module references
apiClient.setToolManager(toolManager);

// Register collections with memory manager
memoryManager.register('activeToolExecutions', toolManager.activeToolExecutions);
memoryManager.register('activeMessages', eventManager.activeMessages);
memoryManager.register('eventListeners', eventManager.listeners);

// Context menu setup
async function setupContextMenu() {
  // Clear existing context menus
  chrome.contextMenus.removeAll(() => {
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
      parentId: 'prompt_paul',
    });

    chrome.contextMenus.create({
      id: 'analyze',
      title: '🧐 Analyze',
      contexts: ['selection', 'image'],
      parentId: 'prompt_paul',
    });

    chrome.contextMenus.create({
      id: 'explain',
      title: '❓ Explain',
      contexts: ['selection', 'image'],
      parentId: 'prompt_paul',
    });

    chrome.contextMenus.create({
      id: 'polish',
      title: '🪄 Polish',
      contexts: ['selection', 'image'],
      parentId: 'prompt_paul',
    });

    chrome.contextMenus.create({
      id: 'shorten',
      title: '✂️ Shorten',
      contexts: ['selection', 'image'],
      parentId: 'prompt_paul',
    });

    chrome.contextMenus.create({
      id: 'formal',
      title: '💼 Formal',
      contexts: ['selection', 'image'],
      parentId: 'prompt_paul',
    });

    chrome.contextMenus.create({
      id: 'casual',
      title: '🤙 Casual',
      contexts: ['selection', 'image'],
      parentId: 'prompt_paul',
    });

    // Create parent menu for custom instructions
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

    // Add separator and manage instructions after a delay to ensure proper ordering
    setTimeout(() => {
      chrome.contextMenus.create({
        id: 'separator',
        type: 'separator',
        contexts: ['selection', 'image'],
      });

      chrome.contextMenus.create({
        id: 'manageInstructions',
        title: 'Manage Custom Instructions',
        contexts: ['selection', 'image'],
      });
    }, 100);
  });
}

// Initialize on extension startup
chrome.runtime.onInstalled.addListener(async () => {
  logger.info('Background', 'PromptPaul extension installed');

  // Initialize default configuration in sync storage
  // This ensures the API client has access to configuration immediately
  const defaultConfig = {
    llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
    apiKey: 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF',
    modelName: 'mistral-small-latest',
    maxTokens: 16000,
    systemPrompt: 'You are a helpful assistant.',
  };

  // Check if configuration already exists
  const syncData = await chrome.storage.sync.get(['apiKey', 'apiEndpoint']);

  // Only set defaults if no configuration exists
  if (!syncData.apiKey || !syncData.apiEndpoint) {
    logger.info('Background', 'Setting default API configuration');
    await chrome.storage.sync.set({
      apiKey: defaultConfig.apiKey,
      apiEndpoint: defaultConfig.llmEndpoint,
      modelName: defaultConfig.modelName,
      maxTokens: defaultConfig.maxTokens,
      systemPrompt: defaultConfig.systemPrompt,
      enableStreaming: true, // Enable streaming by default
    });
    logger.info('Background', 'Default API configuration set successfully');
  } else {
    logger.info('Background', 'API configuration already exists');
  }

  // Configure side panel
  chrome.sidePanel.setOptions({ path: 'chat.html' }).catch(error => {
    logger.error('Background', 'Error setting side panel options:', error);
  });

  setupContextMenu();
});

// Helper to send message with retry logic
async function sendMessageWithRetry(message, maxRetries = 5, baseDelay = 200) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.runtime.sendMessage(message);
      logger.info('Background', `Message sent successfully: ${message.action}`);
      return;
    } catch (error) {
      const isLastAttempt = i === maxRetries - 1;

      // Check if it's the specific error we're looking for
      if (error.message && error.message.includes('Receiving end does not exist')) {
        if (isLastAttempt) {
          logger.error('Background', `Failed to send message after ${maxRetries} attempts:`, error);
          throw error;
        }

        // Exponential backoff
        const delay = baseDelay * Math.pow(1.5, i);
        logger.debug('Background', `Retry ${i + 1}/${maxRetries} for message ${message.action} in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // For other errors, log and rethrow immediately
        logger.error('Background', 'Error sending message:', error);
        throw error;
      }
    }
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuItemId = info.menuItemId;
  logger.info('Background', 'Context menu clicked:', menuItemId, 'Media Type:', info.mediaType);

  try {
    // Handle manage instructions (doesn't need side panel)
    if (menuItemId === 'manageInstructions') {
      chrome.runtime.openOptionsPage();
      return;
    }

    // Open side panel first (must be in direct response to user action)
    // Wrap in try-catch with retry logic to handle "No active side panel" errors
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
      logger.info('Background', 'Side panel opened for tab:', tab.id);
    } catch (error) {
      logger.warn('Background', 'First attempt to open side panel failed:', error);

      // Retry strategy 1: Ensure options are set for this specific tab
      try {
        await chrome.sidePanel.setOptions({
          tabId: tab.id,
          path: 'chat.html',
          enabled: true
        });
        await chrome.sidePanel.open({ tabId: tab.id });
        logger.info('Background', 'Side panel opened for tab (after setting options):', tab.id);
      } catch (retryError) {
        logger.warn('Background', 'Second attempt to open side panel failed:', retryError);

        // Retry strategy 2: Fallback to windowId
        try {
          if (tab.windowId) {
            await chrome.sidePanel.open({ windowId: tab.windowId });
            logger.info('Background', 'Side panel opened for window:', tab.windowId);
          } else {
            throw new Error('No windowId available for fallback');
          }
        } catch (finalError) {
          logger.error('Background', 'Critical: Failed to open side panel via all methods:', finalError);
          // We continue processing, but the user might not see the result if panel didn't open
        }
      }
    }

    // Determines content to process
    let promptContent = '';
    let isImage = false;

    if (info.selectionText) {
      promptContent = info.selectionText;
      logger.info('Background', 'Processing selected text');
    } else if (info.mediaType === 'image' && info.srcUrl) {
      promptContent = info.srcUrl;
      isImage = true;
      logger.info('Background', 'Processing image URL:', info.srcUrl);
    } else {
      // Fallback to page content
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return {
            title: document.title,
            url: window.location.href,
            pageContent: document.body.innerText,
          };
        },
      });
      promptContent = result.result?.pageContent || '';
      logger.info('Background', 'Processing full page content');
    }

    // Handle different menu actions
    if (menuItemId === 'oneoff_instruction') {
      // One-off instruction - just show the selected text/image URL in chat
      // Use retry logic to ensure side panel is ready to receive
      sendMessageWithRetry({
        action: 'setSelectedText',
        selectedText: promptContent,
        tabId: tab.id,
        fromStartChat: false,
      }).catch(e => logger.error('Background', 'Error sending setSelectedText:', e));
      return;
    } else if (menuItemId === 'start_chat') {
      // Start chat - send selected text and make API request
      // Use retry logic instead of fixed timeout
      sendMessageWithRetry({
        action: 'setSelectedText',
        selectedText: promptContent,
        tabId: tab.id,
        fromStartChat: true,
      }).catch(e => logger.error('Background', 'Error sending setSelectedText:', e));

      const requestOptions = { isStartChat: true };
      // TODO: Pass isImage flag or handle image processing in apiClient if needed
      await apiClient.makeApiRequest(promptContent, tab.id, requestOptions);
      return;
    } else if (menuItemId.toString().startsWith('custom_')) {
      // Handle custom instruction
      const instructionId = menuItemId.toString().replace('custom_', '');
      const { instructions } = await chrome.storage.local.get(['instructions']);
      const instruction = instructions?.find(i => i.id === instructionId);

      if (instruction) {
        const prefix = isImage ? `[Image Analysis]\nImage URL: ${promptContent}\n\n` : '';
        const fullPrompt = `${instruction.content}\n\n${prefix}${isImage ? '' : promptContent}`;
        const toolChoice = instruction.tool_choice || 'none';
        await apiClient.makeApiRequest(fullPrompt, tab.id, { customInstructionToolChoice: toolChoice });
      }
      return;
    }

    // Handle predefined instructions under "Query Prompt Paul"
    const commandMap = {
      summarize: 'Please summarize the following text into a bullet list of points',
      explain: 'Explain this to me in a short concise MECE approach',
      polish: 'Polish this text with clarity and purpose',
      shorten: 'Shorten this text without losing its meaning and context',
      formal: 'Make this text more formal and eloquent',
      casual: 'Make this text more casual and fun',
      analyze: 'Please analyze the following',
    };

    if (commandMap[menuItemId]) {
      let fullPrompt;
      if (isImage) {
        fullPrompt = `${commandMap[menuItemId]} image:\n${promptContent}`;
      } else {
        fullPrompt = `${commandMap[menuItemId]}:\n${promptContent}`;
      }
      await apiClient.makeApiRequest(fullPrompt, tab.id);
      return;
    }

    // Send prompt to API if we have content
    if (promptContent) {
      await apiClient.makeApiRequest(promptContent, tab.id);
    }
  } catch (error) {
    logger.error('Background', 'Error handling context menu click:', error);
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
          // Prefer tabId from request, fallback to sender.tab, then query active tab
          let targetTabId = request.tabId || sender.tab?.id;

          if (!targetTabId) {
            // Query active tab as fallback
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs && tabs[0] && typeof tabs[0].id === 'number') {
              targetTabId = tabs[0].id;
            }
          }

          if (!targetTabId) {
            safeSendResponse({ success: false, error: 'No tab context available' });
            break;
          }

          try {
            const [result] = await chrome.scripting.executeScript({
              target: { tabId: targetTabId },
              func: () => {
                // Extract page content - prioritize selected text, then full page content
                const selection = window.getSelection().toString();
                const pageContent = document.body.innerText;
                return selection || pageContent || '';
              },
            });

            if (result && result.result !== undefined) {
              safeSendResponse({ success: true, content: result.result });
            } else {
              safeSendResponse({ success: false, error: 'Failed to extract content' });
            }
          } catch (error) {
            safeSendResponse({ success: false, error: error.message });
          }
          break;

        case 'getExplainContent':
          // Use tabId from request if available, otherwise from sender
          const explainTabId = request.tabId || sender.tab?.id;

          if (!explainTabId) {
            safeSendResponse({
              action: 'explainContentResponse',
              success: false,
              error: 'No tab context available',
              content: ''
            });
            break;
          }

          try {
            const [result] = await chrome.scripting.executeScript({
              target: { tabId: explainTabId },
              files: ['content_script_unified.js'],
            });

            if (result && result.result) {
              const extractionResult = result.result;
              console.log('Background: getExplainContent - Result from content_script_unified.js:', extractionResult);

              safeSendResponse({
                action: 'explainContentResponse',
                success: extractionResult.success,
                content: extractionResult.data || extractionResult.content || '',
                error: extractionResult.error,
                instruction: request.instruction
              });
            } else {
              console.error('Background: getExplainContent - No result from content_script_unified.js');
              safeSendResponse({
                action: 'explainContentResponse',
                success: false,
                error: 'No result from content script',
                content: '',
                instruction: request.instruction
              });
            }
          } catch (error) {
            console.error('Failed to inject/execute content_script_unified.js for getExplainContent:', error);
            safeSendResponse({
              action: 'explainContentResponse',
              success: false,
              error: 'Failed to inject script: ' + error.message,
              content: '',
              instruction: request.instruction
            });
          }
          break;

        case 'makeLlmApiRequest':
          // Use tabId from request if available, otherwise from sender
          const tabId = request.tabId || sender.tab?.id;
          if (!tabId) {
            safeSendResponse({ error: 'No tab ID available' });
            break;
          }
          await apiClient.makeApiRequest(request.prompt, tabId, request.options);
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
          logger.warn('Background', 'Unknown action:', request.action);
          safeSendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      logger.error('Background', 'Error handling message:', error);
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
  analytics.sendUmamiEvent('extension_startup', { action: 'startup' });
});

chrome.runtime.onInstalled.addListener(() => {
  analytics.trackInstalled();
});

logger.info('Background', 'PromptPaul background script initialized');
