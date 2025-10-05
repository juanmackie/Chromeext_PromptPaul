/**
 * Background Service Entry Point
 * Coordinates all background services
 * Implements production-ready coding rules for service coordination
 *
 * Core Principles:
 * - Single Responsibility: Coordinate services, don't implement business logic
 * - Dependency Injection: Use the DI container for service management
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 */

import { container, logger, errorHandler } from '../shared/index.js';
import AnalyticsService from './analytics-service.js';
import ApiService from './api-service.js';
import ContextMenuService from './context-menu-service.js';
import ToolExecutionService from './tool-execution-service.js';
import TabService from './tab-service.js';
import MediaService from './media-service.js';

// Register services with the dependency container
container.register('AnalyticsService', AnalyticsService, ['Storage', 'Logger'], { singleton: true });
container.register('ApiService', ApiService, ['Storage', 'Logger', 'ErrorHandler'], { singleton: true });
container.register('ContextMenuService', ContextMenuService, ['Storage', 'Logger'], { singleton: true });
container.register('ToolExecutionService', ToolExecutionService, ['Storage', 'Logger', 'ErrorHandler'], { singleton: true });
container.register('TabService', TabService, ['Storage', 'Logger', 'ErrorHandler'], { singleton: true });
container.register('MediaService', MediaService, ['Storage', 'Logger', 'ErrorHandler', 'Validator'], { singleton: true });

// Global variables for backward compatibility (will be removed in future)
let tabContentCallback = null;
let pinnedActionTabContentCallback = null;

/**
 * Initializes the background service
 */
async function initializeBackgroundService() {
  logger.info('Initializing background service...');

  try {
    // Resolve services
    const analyticsService = container.resolve('AnalyticsService');
    const apiService = container.resolve('ApiService');
    const contextMenuService = container.resolve('ContextMenuService');
    const toolExecutionService = container.resolve('ToolExecutionService');
    const tabService = container.resolve('TabService');
    const mediaService = container.resolve('MediaService');

    // Initialize services
    await contextMenuService.initialize(handleContextMenuClick);

    // Set up analytics tracking
    chrome.runtime.onInstalled.addListener(async (details) => {
      if (details.reason === 'install') {
        await analyticsService.trackInstalled();
      }
    });

    // Set up message handling
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    // Set up storage change listener
    chrome.storage.onChanged.addListener(handleStorageChange);

    logger.info('Background service initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize background service', {}, error);
    throw error;
  }
}

/**
 * Handles context menu clicks
 * @param {Object} clickInfo - Click information from context menu service
 */
async function handleContextMenuClick(clickInfo) {
  const { menuItemId, menuItemInfo, selectionText, srcUrl, mediaType, tab } = clickInfo;
  const tabService = container.resolve('TabService');
  const mediaService = container.resolve('MediaService');
  const analyticsService = container.resolve('AnalyticsService');

  logger.debug(`Context menu clicked: ${menuItemId}`, {
    hasSelection: !!selectionText,
    hasSrcUrl: !!srcUrl,
    mediaType
  });

  try {
    // Handle different menu item types
    switch (menuItemId) {
      case 'start_chat':
        handleStartChat(selectionText, srcUrl, mediaType, tab);
        break;

      case 'oneoff_instruction':
        handleOneoffInstruction(selectionText, srcUrl, mediaType, tab);
        break;

      case 'manageInstructions':
        handleManageInstructions(tab);
        break;

      default:
        if (menuItemInfo.type === 'predefined') {
          handlePredefinedCommand(menuItemId, selectionText, srcUrl, mediaType, tab);
        } else if (menuItemInfo.type === 'custom') {
          handleCustomInstruction(menuItemInfo.instructionId, selectionText, srcUrl, mediaType, tab);
        } else if (menuItemInfo.type === 'media') {
          await handleMediaAnalysis(menuItemInfo, srcUrl, mediaType, tab);
        }
        break;
    }

    // Track analytics
    await analyticsService.trackInstructionUsed({
      instruction: menuItemId,
      model: 'unknown', // Will be updated when API is called
      tools: []
    });
  } catch (error) {
    logger.error(`Failed to handle context menu click: ${menuItemId}`, {}, error);
    // Show error notification to user
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Prompt Paul',
      message: `Error: ${error.message}`
    });
  }
}

/**
 * Handles start chat command
 * @param {string} selectionText - Selected text
 * @param {string} srcUrl - Source URL
 * @param {string} mediaType - Media type
 * @param {Object} tab - Tab object
 */
function handleStartChat(selectionText, srcUrl, mediaType, tab) {
  logger.debug('Handling start chat command');

  try {
    let mediaData = null;

    // Handle media if present
    if (srcUrl && mediaType) {
      mediaData = {
        srcUrl,
        type: mediaType,
        loading: true
      };

      // Process media asynchronously
      const mediaService = container.resolve('MediaService');
      mediaService.processMediaData(mediaData, mediaType)
        .then(processedData => {
          // Send updated media data to chat
          chrome.runtime.sendMessage({
            action: 'setMediaForAnalysis',
            mediaData: processedData,
            tabId: tab.id
          });
        })
        .catch(error => {
          logger.error('Failed to process media', { mediaType }, error);
          chrome.runtime.sendMessage({
            action: 'setMediaForAnalysis',
            mediaData: {
              type: mediaType,
              loading: false,
              error: error.message
            },
            tabId: tab.id
          });
        });
    }

    // Send message to chat
    chrome.runtime.sendMessage({
      action: 'setSelectedText',
      selectedText: selectionText,
      tabId: tab.id,
      fromStartChat: true,
      mediaData
    });

    // Open chat popup
    chrome.action.openPopup();
  } catch (error) {
    logger.error('Failed to handle start chat command', {}, error);
    throw error;
  }
}

/**
 * Handles one-off instruction command
 * @param {string} selectionText - Selected text
 * @param {string} srcUrl - Source URL
 * @param {string} mediaType - Media type
 * @param {Object} tab - Tab object
 */
function handleOneoffInstruction(selectionText, srcUrl, mediaType, tab) {
  logger.debug('Handling one-off instruction command');

  try {
    // Send message to chat
    chrome.runtime.sendMessage({
      action: 'setSelectedText',
      selectedText: selectionText,
      tabId: tab.id
    });

    // Open chat popup
    chrome.action.openPopup();
  } catch (error) {
    logger.error('Failed to handle one-off instruction command', {}, error);
    throw error;
  }
}

/**
 * Handles manage instructions command
 * @param {Object} tab - Tab object
 */
function handleManageInstructions(tab) {
  logger.debug('Handling manage instructions command');

  try {
    // Open options page
    chrome.runtime.openOptionsPage();
  } catch (error) {
    logger.error('Failed to handle manage instructions command', {}, error);
    throw error;
  }
}

/**
 * Handles predefined command
 * @param {string} command - Command ID
 * @param {string} selectionText - Selected text
 * @param {string} srcUrl - Source URL
 * @param {string} mediaType - Media type
 * @param {Object} tab - Tab object
 */
function handlePredefinedCommand(command, selectionText, srcUrl, mediaType, tab) {
  logger.debug(`Handling predefined command: ${command}`);

  try {
    const apiService = container.resolve('ApiService');
    const tabService = container.resolve('TabService');

    // Get tab content
    tabService.fetchTabContent(tab.id, 'getTabContent')
      .then(response => {
        if (response.success && response.content) {
          // Create prompt based on command
          let prompt = '';
          switch (command) {
            case 'summarize':
              prompt = "Summarize the following text:\n\n" + response.content;
              break;
            case 'analyze':
              prompt = "Analyze the following text:\n\n" + response.content;
              break;
            case 'explain':
              prompt = "Explain the following text:\n\n" + response.content;
              break;
            case 'polish':
              prompt = "Polish the following text:\n\n" + response.content;
              break;
            case 'shorten':
              prompt = "Shorten the following text:\n\n" + response.content;
              break;
            case 'formal':
              prompt = "Convert the following text to formal tone:\n\n" + response.content;
              break;
            case 'casual':
              prompt = "Convert the following text to casual tone:\n\n" + response.content;
              break;
            default:
              prompt = response.content;
              break;
          }

          // Send API request
          apiService.createRequestPayload(prompt, [], {})
            .then(payload => {
              chrome.runtime.sendMessage({
                action: 'executeLlmApiRequest',
                prompt,
                tool_choice: 'none'
              });
            })
            .catch(error => {
              logger.error('Failed to create request payload', {}, error);
              throw error;
            });
        } else {
          throw new Error('No content received from tab');
        }
      })
      .catch(error => {
        logger.error('Failed to get tab content for predefined command', { command }, error);
        throw error;
      });

    // Open chat popup
    chrome.action.openPopup();
  } catch (error) {
    logger.error(`Failed to handle predefined command: ${command}`, {}, error);
    throw error;
  }
}

/**
 * Handles custom instruction
 * @param {string} instructionId - Instruction ID
 * @param {string} selectionText - Selected text
 * @param {string} srcUrl - Source URL
 * @param {string} mediaType - Media type
 * @param {Object} tab - Tab object
 */
function handleCustomInstruction(instructionId, selectionText, srcUrl, mediaType, tab) {
  logger.debug(`Handling custom instruction: ${instructionId}`);

  try {
    const storage = container.resolve('Storage');
    const tabService = container.resolve('TabService');

    // Get instruction details
    storage.get(['instructions'])
      .then(result => {
        const instructions = result.instructions || [];
        const instruction = instructions.find(i => i.id === instructionId);

        if (!instruction) {
          throw new Error(`Instruction not found: ${instructionId}`);
        }

        // Get tab content
        return tabService.fetchTabContent(tab.id, 'getPinnedActionTabContent', { instruction });
      })
      .then(response => {
        if (response.success && response.content) {
          // Create prompt
          let prompt = instruction.content;
          prompt += '\n\nActive Tab Content:\n' + response.content;

          if (selectionText) {
            prompt += '\n\nSelected Text:\n' + selectionText;
          }

          // Send API request
          chrome.runtime.sendMessage({
            action: 'executeLlmApiRequest',
            prompt,
            tool_choice: instruction.tool_choice || 'none'
          });
        } else {
          throw new Error('No content received from tab');
        }
      })
      .catch(error => {
        logger.error('Failed to handle custom instruction', { instructionId }, error);
        throw error;
      });

    // Open chat popup
    chrome.action.openPopup();
  } catch (error) {
    logger.error(`Failed to handle custom instruction: ${instructionId}`, {}, error);
    throw error;
  }
}

/**
 * Handles media analysis
 * @param {Object} menuItemInfo - Menu item information
 * @param {string} srcUrl - Source URL
 * @param {string} mediaType - Media type
 * @param {Object} tab - Tab object
 */
async function handleMediaAnalysis(menuItemInfo, srcUrl, mediaType, tab) {
  logger.debug(`Handling media analysis: ${menuItemInfo.actionType}`);

  try {
    const mediaService = container.resolve('MediaService');

    // Create media data
    const mediaData = {
      srcUrl,
      type: mediaType,
      actionType: menuItemInfo.actionType,
      loading: true
    };

    // Process media
    const processedData = await mediaService.processMediaData(mediaData, mediaType);

    // Send to chat
    chrome.runtime.sendMessage({
      action: 'setMediaForAnalysis',
      mediaData: processedData,
      tabId: tab.id
    });

    // Open chat popup
    chrome.action.openPopup();
  } catch (error) {
    logger.error(`Failed to handle media analysis: ${menuItemInfo.actionType}`, {}, error);
    throw error;
  }
}

/**
 * Handles runtime messages
 * @param {Object} request - Message request
 * @param {Object} sender - Message sender
 * @param {Function} sendResponse - Response function
 */
function handleRuntimeMessage(request, sender, sendResponse) {
  logger.debug(`Handling runtime message: ${request.action}`);

  try {
    switch (request.action) {
      case 'executePromptPaulTool':
        handleExecuteTool(request, sendResponse);
        break;

      case 'getTabContent':
        handleGetTabContent(request, sendResponse);
        break;

      case 'getExplainContent':
        handleGetExplainContent(request, sendResponse);
        break;

      case 'getPinnedActionTabContent':
        handleGetPinnedActionTabContent(request, sendResponse);
        break;

      case 'startApiRequest':
        handleStartApiRequest(request, sendResponse);
        break;

      case 'logMessage':
        handleLogMessage(request);
        break;

      default:
        logger.warn(`Unknown runtime message action: ${request.action}`);
        break;
    }
  } catch (error) {
    logger.error(`Failed to handle runtime message: ${request.action}`, {}, error);
    sendResponse({ error: error.message });
  }

  // Return true for async response
  return true;
}

/**
 * Handles tool execution
 * @param {Object} request - Request object
 * @param {Function} sendResponse - Response function
 */
function handleExecuteTool(request, sendResponse) {
  logger.debug(`Handling tool execution: ${request.toolCall.name}`);

  try {
    const toolExecutionService = container.resolve('ToolExecutionService');

    toolExecutionService.executeTool(request.toolCall)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        logger.error('Tool execution failed', { toolName: request.toolCall.name }, error);
        sendResponse({ success: false, error: error.message });
      });
  } catch (error) {
    logger.error('Failed to handle tool execution', { toolName: request.toolCall.name }, error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handles get tab content request
 * @param {Object} request - Request object
 * @param {Function} sendResponse - Response function
 */
function handleGetTabContent(request, sendResponse) {
  logger.debug('Handling get tab content request');

  try {
    const tabService = container.resolve('TabService');

    tabService.getActiveTab()
      .then(tab => {
        if (!tab) {
          throw new Error('No active tab found');
        }

        return tabService.getTabContentForSummary(tab.id);
      })
      .then(response => {
        if (response.success) {
          sendResponse({
            action: 'tabContentResponse',
            success: true,
            content: response.content
          });
        } else {
          sendResponse({
            action: 'tabContentResponse',
            success: false,
            content: response.error || 'Failed to get tab content'
          });
        }
      })
      .catch(error => {
        logger.error('Failed to get tab content', {}, error);
        sendResponse({
          action: 'tabContentResponse',
          success: false,
          content: error.message
        });
      });
  } catch (error) {
    logger.error('Failed to handle get tab content request', {}, error);
    sendResponse({
      action: 'tabContentResponse',
      success: false,
      content: error.message
    });
  }
}

/**
 * Handles get explain content request
 * @param {Object} request - Request object
 * @param {Function} sendResponse - Response function
 */
function handleGetExplainContent(request, sendResponse) {
  logger.debug('Handling get explain content request');

  try {
    const tabService = container.resolve('TabService');

    tabService.getActiveTab()
      .then(tab => {
        if (!tab) {
          throw new Error('No active tab found');
        }

        return tabService.getTabContentForExplanation(tab.id);
      })
      .then(response => {
        if (response.success) {
          sendResponse({
            action: 'explainContentResponse',
            success: true,
            content: response.content
          });
        } else {
          sendResponse({
            action: 'explainContentResponse',
            success: false,
            content: response.error || 'Failed to get tab content'
          });
        }
      })
      .catch(error => {
        logger.error('Failed to get explain content', {}, error);
        sendResponse({
          action: 'explainContentResponse',
          success: false,
          content: error.message
        });
      });
  } catch (error) {
    logger.error('Failed to handle get explain content request', {}, error);
    sendResponse({
      action: 'explainContentResponse',
      success: false,
      content: error.message
    });
  }
}

/**
 * Handles get pinned action tab content request
 * @param {Object} request - Request object
 * @param {Function} sendResponse - Response function
 */
function handleGetPinnedActionTabContent(request, sendResponse) {
  logger.debug('Handling get pinned action tab content request');

  try {
    const tabService = container.resolve('TabService');

    tabService.getActiveTab()
      .then(tab => {
        if (!tab) {
          throw new Error('No active tab found');
        }

        return tabService.getTabContentForPinnedAction(tab.id, request.instruction);
      })
      .then(response => {
        if (response.success) {
          sendResponse({
            action: 'pinnedActionTabContentResponse',
            success: true,
            content: response.content,
            instruction: request.instruction
          });
        } else {
          sendResponse({
            action: 'pinnedActionTabContentResponse',
            success: false,
            content: response.error || 'Failed to get tab content',
            instruction: request.instruction
          });
        }
      })
      .catch(error => {
        logger.error('Failed to get pinned action tab content', {}, error);
        sendResponse({
          action: 'pinnedActionTabContentResponse',
          success: false,
          content: error.message,
          instruction: request.instruction
        });
      });
  } catch (error) {
    logger.error('Failed to handle get pinned action tab content request', {}, error);
    sendResponse({
      action: 'pinnedActionTabContentResponse',
      success: false,
      content: error.message,
      instruction: request.instruction
    });
  }
}

/**
 * Handles start API request
 * @param {Object} request - Request object
 * @param {Function} sendResponse - Response function
 */
function handleStartApiRequest(request, sendResponse) {
  logger.debug('Handling start API request');

  try {
    const apiService = container.resolve('ApiService');

    apiService.createRequestPayload(request.prompt, [], { tool_choice: request.tool_choice })
      .then(payload => {
        // Send to chat for streaming
        chrome.runtime.sendMessage({
          action: 'streamApiStart',
          requestId: request.requestId,
          prompt: request.prompt
        });

        // Make API request
        apiService.makeStreamingRequest(
          payload.endpoint,
          payload,
          (chunk) => {
            // Send chunk to chat
            chrome.runtime.sendMessage({
              action: 'streamApiResponseChunk',
              requestId: request.requestId,
              chunk: chunk.choices?.[0]?.delta?.content || ''
            });
          },
          () => {
            // Send end to chat
            chrome.runtime.sendMessage({
              action: 'streamApiEnd',
              requestId: request.requestId
            });
          },
          (error) => {
            // Send error to chat
            chrome.runtime.sendMessage({
              action: 'streamApiError',
              requestId: request.requestId,
              error: error.message
            });
          }
        );
      })
      .catch(error => {
        logger.error('Failed to start API request', {}, error);
        sendResponse({ error: error.message });
      });
  } catch (error) {
    logger.error('Failed to handle start API request', {}, error);
    sendResponse({ error: error.message });
  }
}

/**
 * Handles log message
 * @param {Object} request - Request object
 */
function handleLogMessage(request) {
  logger.debug('Handling log message', { level: request.logEntry.level });
  
  try {
    const logEntry = request.logEntry;
    logger[logEntry.level](logEntry.message, logEntry.context);
  } catch (error) {
    logger.error('Failed to handle log message', {}, error);
  }
}

/**
 * Handles storage changes
 * @param {Object} changes - Storage changes
 * @param {string} area - Storage area
 */
function handleStorageChange(changes, area) {
  logger.debug('Handling storage change', { area });

  try {
    // Handle analytics consent changes
    if (area === 'local' && changes.analyticsConsent) {
      const analyticsService = container.resolve('AnalyticsService');
      analyticsService.setConsent(changes.analyticsConsent.newValue);
    }
  } catch (error) {
    logger.error('Failed to handle storage change', { area }, error);
  }
}

// Initialize background service
initializeBackgroundService().catch(error => {
  logger.error('Failed to initialize background service', {}, error);
});