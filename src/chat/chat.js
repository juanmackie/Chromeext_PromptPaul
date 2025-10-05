/**
 * Chat Entry Point
 * Coordinates all chat functionality
 * Implements production-ready coding rules for chat coordination
 *
 * Core Principles:
 * - Single Responsibility: Coordinate chat modules, don't implement business logic
 * - Dependency Injection: Use the DI container for module management
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 */

import { container, logger } from '../shared/index.js';
import MessageRenderer from './ui/message-renderer.js';
import MediaPreviewHandler from './ui/media-preview.js';
import ThinkingBlockUI from './ui/thinking-block-ui.js';
import ChatApiClient from './api/chat-api-client.js';
import StreamingHandler from './api/streaming-handler.js';
import ConversationStore from './state/conversation-store.js';
import UIStateManager from './state/ui-state-manager.js';

// Register chat modules with the dependency container
container.register('MessageRenderer', MessageRenderer, ['Logger'], { singleton: true });
container.register('MediaPreviewHandler', MediaPreviewHandler, ['Logger'], { singleton: true });
container.register('ThinkingBlockUI', ThinkingBlockUI, ['Logger'], { singleton: true });
container.register('ChatApiClient', ChatApiClient, ['Logger', 'Storage'], { singleton: true });
container.register('StreamingHandler', StreamingHandler, ['Logger'], { singleton: true });
container.register('ConversationStore', ConversationStore, ['Logger', 'Storage'], { singleton: true });
container.register('UIStateManager', UIStateManager, ['Logger'], { singleton: true });

// Global variables for backward compatibility (will be removed in future)
let chatArea = null;
let messageInput = null;
let sendButton = null;
let clearButton = null;
let instructionSelect = null;
let currentStreamingRequest = null;

/**
 * Initializes the chat interface
 */
async function initializeChat() {
  logger.info('Initializing chat interface...');

  try {
    // Get DOM elements
    chatArea = document.getElementById('chatArea');
    messageInput = document.getElementById('messageInput');
    sendButton = document.getElementById('sendButton');
    clearButton = document.getElementById('clearButton');
    instructionSelect = document.getElementById('instructionSelect');

    if (!chatArea || !messageInput || !sendButton) {
      throw new Error('Required chat elements not found');
    }

    // Resolve services
    const messageRenderer = container.resolve('MessageRenderer');
    const mediaPreviewHandler = container.resolve('MediaPreviewHandler');
    const thinkingBlockUI = container.resolve('ThinkingBlockUI');
    const chatApiClient = container.resolve('ChatApiClient');
    const streamingHandler = container.resolve('StreamingHandler');
    const conversationStore = container.resolve('ConversationStore');
    const uiStateManager = container.resolve('UIStateManager');

    // Initialize services
    messageRenderer.initialize(chatArea);
    mediaPreviewHandler.initialize(chatArea);
    thinkingBlockUI.initialize(chatArea);
    await conversationStore.initialize();
    uiStateManager.initialize();

    // Set up event listeners
    setupEventListeners(chatApiClient, streamingHandler, conversationStore, uiStateManager, messageRenderer, mediaPreviewHandler, thinkingBlockUI);

    // Set up message listeners
    setupMessageListeners(uiStateManager, messageRenderer, mediaPreviewHandler, thinkingBlockUI, conversationStore, chatApiClient, streamingHandler);

    logger.info('Chat interface initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize chat interface', {}, error);
    throw error;
  }
}

/**
 * Sets up event listeners
 */
function setupEventListeners(chatApiClient, streamingHandler, conversationStore, uiStateManager, messageRenderer, mediaPreviewHandler, thinkingBlockUI) {
  logger.debug('Setting up event listeners');

  try {
    // Send button click
    sendButton.addEventListener('click', () => {
      handleSendMessage(chatApiClient, streamingHandler, conversationStore, uiStateManager, messageRenderer, thinkingBlockUI);
    });

    // Message input keypress (Enter to send)
    messageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSendMessage(chatApiClient, streamingHandler, conversationStore, uiStateManager, messageRenderer, thinkingBlockUI);
      }
    });

    // Clear button click
    if (clearButton) {
      clearButton.addEventListener('click', () => {
        handleClearChat(conversationStore, messageRenderer, thinkingBlockUI);
      });
    }

    // Instruction select change
    if (instructionSelect) {
      instructionSelect.addEventListener('change', () => {
        handleInstructionChange(instructionSelect, uiStateManager);
      });
    }

    // UI state change listeners
    uiStateManager.addListener('main', (currentState, previousState) => {
      handleUIStateChange(currentState, previousState, messageRenderer, mediaPreviewHandler, thinkingBlockUI);
    });

    logger.debug('Event listeners set up successfully');
  } catch (error) {
    logger.error('Failed to set up event listeners', {}, error);
    throw error;
  }
}

/**
 * Sets up message listeners
 */
function setupMessageListeners(uiStateManager, messageRenderer, mediaPreviewHandler, thinkingBlockUI, conversationStore, chatApiClient, streamingHandler) {
  logger.debug('Setting up message listeners');

  try {
    // Listen for selected text
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'setSelectedText') {
        handleSetSelectedText(message, uiStateManager, messageInput, instructionSelect);
        return false; // No response needed
      }
    });

    // Listen for media data
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'setMediaForAnalysis') {
        handleSetMediaForAnalysis(message, uiStateManager, mediaPreviewHandler);
        return false; // No response needed
      }
    });

    // Listen for streaming chunks
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'streamChunkToUI') {
        handleStreamChunk(message, thinkingBlockUI);
        return false; // No response needed
      }
    });

    // Listen for streaming completion
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'streamCompleteToUI') {
        handleStreamComplete(message, conversationStore, messageRenderer, thinkingBlockUI);
        return false; // No response needed
      }
    });

    // Listen for streaming errors
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'streamErrorToUI') {
        handleStreamError(message, uiStateManager, thinkingBlockUI);
        return false; // No response needed
      }
    });

    // Listen for tool execution requests
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'executeLlmApiRequest') {
        handleExecuteApiRequest(message, chatApiClient, streamingHandler, conversationStore, uiStateManager, messageRenderer, thinkingBlockUI);
        return true; // Keep message channel open for async response
      }
    });

    logger.debug('Message listeners set up successfully');
  } catch (error) {
    logger.error('Failed to set up message listeners', {}, error);
    throw error;
  }
}

/**
 * Handles send message
 */
async function handleSendMessage(chatApiClient, streamingHandler, conversationStore, uiStateManager, messageRenderer, thinkingBlockUI) {
  const message = messageInput.value.trim();
  if (!message) {
    return;
  }

  logger.debug('Handling send message', { messageLength: message.length });

  try {
    // Clear input
    messageInput.value = '';

    // Get or create conversation
    let conversationId = conversationStore.currentConversationId;
    if (!conversationId) {
      conversationId = conversationStore.createConversation();
    }

    // Add user message to conversation
    conversationStore.addMessageToCurrent('user', message);

    // Render user message
    messageRenderer.renderMessage('User', message, {
      timestamp: new Date(),
      showActions: false
    });

    // Set loading state
    uiStateManager.setLoading(true);

    // Get selected instruction
    const selectedInstruction = instructionSelect ? instructionSelect.value : 'none';

    // Create request payload
    const payload = await chatApiClient.createRequestPayload(message, conversationStore.getCurrentMessages(), {
      tool_choice: selectedInstruction
    });

    // Generate request ID
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    // Create thinking block
    const thinkingBlock = thinkingBlockUI.createThinkingBlock({
      streaming: true
    });

    // Start streaming
    currentStreamingRequest = requestId;
    await chatApiClient.makeStreamingRequest(
      payload,
      {},
      (chunk) => {
        // Handle chunk
        const content = chunk.choices?.[0]?.delta?.content || '';
        if (content) {
          thinkingBlockUI.updateCurrentThinkingBlockContent(
            thinkingBlockUI.getCurrentThinkingBlock().getAttribute('content') + content
          );
        }
      },
      () => {
        // Handle completion
        uiStateManager.setLoading(false);
        uiStateManager.setStreaming(false);
        thinkingBlockUI.finalizeCurrentThinkingBlock();
        currentStreamingRequest = null;
      },
      (error) => {
        // Handle error
        uiStateManager.setLoading(false);
        uiStateManager.setStreaming(false);
        uiStateManager.setError(error.message);
        thinkingBlockUI.removeCurrentThinkingBlock();
        currentStreamingRequest = null;
      }
    );

    // Set streaming state
    uiStateManager.setStreaming(true);
  } catch (error) {
    logger.error('Failed to send message', {}, error);
    uiStateManager.setLoading(false);
    uiStateManager.setError(error.message);
  }
}

/**
 * Handles clear chat
 */
function handleClearChat(conversationStore, messageRenderer, thinkingBlockUI) {
  logger.debug('Handling clear chat');

  try {
    // Create new conversation
    conversationStore.createConversation();

    // Clear messages
    messageRenderer.clearMessages();
    thinkingBlockUI.clearThinkingBlocks();

    // Clear UI state
    uiStateManager.resetState();

    logger.debug('Chat cleared successfully');
  } catch (error) {
    logger.error('Failed to clear chat', {}, error);
    uiStateManager.setError(error.message);
  }
}

/**
 * Handles instruction change
 */
function handleInstructionChange(instructionSelect, uiStateManager) {
  const selectedInstruction = instructionSelect.value;
  logger.debug('Instruction changed', { selectedInstruction });

  try {
    // Get instruction details
    chrome.storage.local.get(['instructions'], (result) => {
      const instructions = result.instructions || [];
      const instruction = instructions.find(i => i.id === selectedInstruction);

      if (instruction) {
        uiStateManager.setCurrentInstruction(instruction);
      } else {
        uiStateManager.setCurrentInstruction(null);
      }
    });
  } catch (error) {
    logger.error('Failed to handle instruction change', {}, error);
  }
}

/**
 * Handles UI state change
 */
function handleUIStateChange(currentState, previousState, messageRenderer, mediaPreviewHandler, thinkingBlockUI) {
  logger.debug('Handling UI state change', { 
    isLoading: currentState.isLoading,
    isStreaming: currentState.isStreaming,
    hasError: currentState.hasError
  });

  try {
    // Handle loading state
    if (currentState.isLoading !== previousState.isLoading) {
      if (currentState.isLoading) {
        sendButton.disabled = true;
        sendButton.textContent = 'Sending...';
      } else {
        sendButton.disabled = false;
        sendButton.textContent = 'Send';
      }
    }

    // Handle streaming state
    if (currentState.isStreaming !== previousState.isStreaming) {
      if (currentState.isStreaming) {
        sendButton.disabled = true;
        sendButton.textContent = 'Streaming...';
      } else if (!currentState.isLoading) {
        sendButton.disabled = false;
        sendButton.textContent = 'Send';
      }
    }

    // Handle error state
    if (currentState.hasError && currentState.hasError !== previousState.hasError) {
      messageRenderer.renderMessage('System', `Error: ${currentState.errorMessage}`, {
        timestamp: new Date(),
        showActions: false
      });
    }

    // Handle media data
    if (currentState.mediaData !== previousState.mediaData) {
      if (currentState.mediaData) {
        if (currentState.mediaData.loading) {
          mediaPreviewHandler.renderMediaLoading(currentState.mediaData);
        } else if (currentState.mediaData.error) {
          mediaPreviewHandler.renderMediaError(currentState.mediaData, currentState.mediaData.error);
        } else {
          mediaPreviewHandler.renderMediaPreview(currentState.mediaData);
        }
      }
    }
  } catch (error) {
    logger.error('Failed to handle UI state change', {}, error);
  }
}

/**
 * Handles set selected text message
 */
function handleSetSelectedText(message, uiStateManager, messageInput, instructionSelect) {
  logger.debug('Handling set selected text message');

  try {
    // Set selected text in state
    uiStateManager.setSelectedText(message.selectedText);
    uiStateManager.setActiveTabId(message.tabId);

    // Set message input if from start chat
    if (message.fromStartChat) {
      messageInput.value = message.selectedText || '';
    }

    // Focus input
    messageInput.focus();
  } catch (error) {
    logger.error('Failed to handle set selected text message', {}, error);
  }
}

/**
 * Handles set media for analysis message
 */
function handleSetMediaForAnalysis(message, uiStateManager, mediaPreviewHandler) {
  logger.debug('Handling set media for analysis message');

  try {
    // Set media data in state
    uiStateManager.setMediaData(message.mediaData);
    uiStateManager.setActiveTabId(message.tabId);
  } catch (error) {
    logger.error('Failed to handle set media for analysis message', {}, error);
  }
}

/**
 * Handles stream chunk message
 */
function handleStreamChunk(message, thinkingBlockUI) {
  try {
    if (thinkingBlockUI.hasCurrentThinkingBlock()) {
      const currentContent = thinkingBlockUI.getCurrentThinkingBlock().getAttribute('content') || '';
      thinkingBlockUI.updateCurrentThinkingBlockContent(currentContent + message.content);
    }
  } catch (error) {
    logger.error('Failed to handle stream chunk', {}, error);
  }
}

/**
 * Handles stream complete message
 */
function handleStreamComplete(message, conversationStore, messageRenderer, thinkingBlockUI) {
  logger.debug('Handling stream complete message');

  try {
    // Get current thinking block
    const thinkingBlock = thinkingBlockUI.getCurrentThinkingBlock();
    if (!thinkingBlock) {
      return;
    }

    // Get content from thinking block
    const content = thinkingBlock.getAttribute('content') || '';
    const answer = thinkingBlock.getAttribute('answer') || '';

    // Add assistant message to conversation
    conversationStore.addMessageToCurrent('assistant', answer || content);

    // Render assistant message
    messageRenderer.renderMessage('LLM', answer || content, {
      timestamp: new Date(),
      showActions: true,
      isMarkdown: true
    });

    // Finalize thinking block
    thinkingBlockUI.finalizeCurrentThinkingBlock();
  } catch (error) {
    logger.error('Failed to handle stream complete', {}, error);
  }
}

/**
 * Handles stream error message
 */
function handleStreamError(message, uiStateManager, thinkingBlockUI) {
  logger.debug('Handling stream error message');

  try {
    // Set error in state
    uiStateManager.setError(message.error);

    // Remove thinking block
    thinkingBlockUI.removeCurrentThinkingBlock();
  } catch (error) {
    logger.error('Failed to handle stream error', {}, error);
  }
}

/**
 * Handles execute API request message
 */
async function handleExecuteApiRequest(message, chatApiClient, streamingHandler, conversationStore, uiStateManager, messageRenderer, thinkingBlockUI, sendResponse) {
  logger.debug('Handling execute API request message');

  try {
    // Get or create conversation
    let conversationId = conversationStore.currentConversationId;
    if (!conversationId) {
      conversationId = conversationStore.createConversation();
    }

    // Add user message to conversation
    conversationStore.addMessageToCurrent('user', message.prompt);

    // Render user message
    messageRenderer.renderMessage('User', message.prompt, {
      timestamp: new Date(),
      showActions: false
    });

    // Set loading state
    uiStateManager.setLoading(true);

    // Create request payload
    const payload = await chatApiClient.createRequestPayload(message.prompt, conversationStore.getCurrentMessages(), {
      tool_choice: message.tool_choice
    });

    // Start streaming
    streamingHandler.startStreaming(message.requestId, {
      onChunk: (content) => {
        // Send chunk to background
        chrome.runtime.sendMessage({
          action: 'streamChunkToUI',
          requestId: message.requestId,
          content
        }).catch(() => {
          // Ignore if no one is listening
        });
      },
      onComplete: (session) => {
        // Send completion to background
        chrome.runtime.sendMessage({
          action: 'streamCompleteToUI',
          requestId: message.requestId,
          session
        }).catch(() => {
          // Ignore if no one is listening
        });
      },
      onError: (error) => {
        // Send error to background
        chrome.runtime.sendMessage({
          action: 'streamErrorToUI',
          requestId: message.requestId,
          error: error.message
        }).catch(() => {
          // Ignore if no one is listening
        });
      }
    });

    // Send streaming start to background
    chrome.runtime.sendMessage({
      action: 'streamApiStart',
      requestId: message.requestId,
      prompt: message.prompt
    }).catch(() => {
      // Ignore if no one is listening
    });

    // Set streaming state
    uiStateManager.setStreaming(true);

    sendResponse({ success: true });
  } catch (error) {
    logger.error('Failed to execute API request', {}, error);
    uiStateManager.setLoading(false);
    uiStateManager.setError(error.message);
    sendResponse({ success: false, error: error.message });
  }
}

// Initialize chat when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeChat);
} else {
  initializeChat().catch(error => {
    logger.error('Failed to initialize chat', {}, error);
  });
}