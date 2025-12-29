import {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
  wrapAsync,
} from '../errorHandler.js';
import { MessageRenderer } from './message-renderer.js';
import { UIManager } from './ui-manager.js';
import { StreamingManager } from './streaming-manager.js';
import { ConversationManager } from './conversation-manager.js';
import { SpeechManager } from './speech-manager.js';

import logger from '../utils/logger.js'; /**
 * Chat Orchestrator
 * Coordinates all chat modules and handles Chrome extension messaging
 * Manages the overall chat functionality and module interactions
 */
export class ChatOrchestrator {
  constructor() {
    // Module instances
    this.messageRenderer = null;
    this.uiManager = null;
    this.streamingManager = null;
    this.conversationManager = null;
    this.speechManager = null;

    // DOM elements
    this.chatArea = null;
    this.userInput = null;
    this.sendButton = null;
    this.clearButton = null;
    this.chatMainArea = null;
    this.oneoffInstructionArea = null;
    this.selectedTextDiv = null;
    this.explainBtn = null;
    this.customInstructionSelect = null;
    this.loadingManager = null;

    // State
    this.isInitialized = false;
    this.currentLoadingMessage = null;
    this.oneoffContext = null; // Track one-off instruction context
  }

  /**
   * Initialize the chat orchestrator
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.info('ChatOrchestrator', 'Chat: Initializing orchestrator...');

      // Get DOM elements
      this.initializeDOMElements();

      // Initialize loading manager
      if (window.loadingManager) {
        this.loadingManager = window.loadingManager;
      }

      // Initialize modules
      this.uiManager = new UIManager(this.chatArea, this.showToast.bind(this), this.loadingManager);
      this.messageRenderer = new MessageRenderer(this.chatArea, this.showToast.bind(this), this.uiManager);
      this.streamingManager = new StreamingManager(this.messageRenderer, this.uiManager);
      this.conversationManager = new ConversationManager(
        this.messageRenderer,
        this.uiManager,
        this.streamingManager
      );
      this.speechManager = new SpeechManager(
        this.userInput,
        this.micDictationButton,
        this.micIcon,
        this.uiManager
      );

      // Initialize conversation manager
      await this.conversationManager.initialize();

      // Setup event listeners
      this.setupEventListeners();

      // Setup Chrome extension message listeners
      this.setupChromeMessageListeners();

      // Setup quick actions
      this.setupQuickActions();

      this.isInitialized = true;
      logger.info('ChatOrchestrator', 'Chat: Orchestrator initialization complete');
    } catch (error) {
      logger.error('ChatOrchestrator', 'Chat: Failed to initialize orchestrator:', error);
      await errorHandler.handleError(
        createError('Chat initialization failed', {
          category: ErrorCategory.SYSTEM,
          severity: ErrorSeverity.CRITICAL,
          originalError: error,
        })
      );
    }
  }

  /**
   * Initialize DOM element references
   */
  initializeDOMElements() {
    this.chatArea = document.getElementById('chat-area');
    this.userInput = document.getElementById('user-input');
    this.sendButton = document.getElementById('send-button');
    this.clearButton = document.getElementById('clear-button');
    this.chatMainArea = document.getElementById('chat-main-area');
    this.oneoffInstructionArea = document.getElementById('oneoff-instruction-area');
    this.selectedTextDiv = document.getElementById('selectedText');
    this.explainBtn = document.getElementById('explain-button');
    this.customInstructionSelect = document.getElementById('customInstructionSelect');
    this.summarizeTabButton = document.getElementById('summarize-tab-button');
    this.loadContextBtn = document.getElementById('load-context-button');
    this.pinnedActionsContainer = document.getElementById('pinned-actions-container');
    this.exportConversationBtn = document.getElementById('export-conversation-btn');
    this.micDictationButton = document.getElementById('mic-dictation-button');
    this.micIcon = document.getElementById('mic-icon');

    // Validate essential elements
    const requiredElements = [this.chatArea, this.userInput, this.sendButton];
    const missingElements = requiredElements.filter(el => !el);

    if (missingElements.length > 0) {
      throw createError('Required DOM elements not found', {
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.CRITICAL,
        context: { missingElements: missingElements.map(el => el?.id || 'unknown') },
      });
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Send button click
    this.sendButton.addEventListener('click', () => this.handleSendMessage());

    // Clear button click
    this.clearButton.addEventListener('click', () => this.handleClearChat());

    // User input events
    this.userInput.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.handleSendMessage();
      }
    });

    // Auto-expand textarea
    this.userInput.addEventListener('input', () => {
      this.uiManager.autoExpandTextarea(this.userInput);
    });

    // Explain button click
    if (this.explainBtn) {
      this.explainBtn.addEventListener('click', () => this.handleExplainContent());
    }

    // Load Context button click
    if (this.loadContextBtn) {
      this.loadContextBtn.addEventListener('click', () => this.handleLoadTabContext());
    }

    // Custom instruction change
    if (this.customInstructionSelect) {
      this.customInstructionSelect.addEventListener('change', () => {
        this.handleCustomInstructionChange();
      });
    }

    // Export button (if exists)
    const exportBtn = document.getElementById('export-conversation-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.handleExportConversation());
    }
  }

  /**
   * Setup Chrome extension message listeners
   */
  setupChromeMessageListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleChromeMessage(request, sender, sendResponse);
      // Immediately acknowledge receipt to prevent "message port closed" errors.
      // The background script waits for this response when using sendMessageWithRetry.
      // We don't need to return data for these events, just an ack.
      sendResponse({ received: true });
      return false;
    });
  }

  /**
   * Handle Chrome extension messages
   */
  async handleChromeMessage(request, sender, sendResponse) {
    try {
      logger.info('ChatOrchestrator', 'Chat: Received message:', request.action);

      switch (request.action) {
        case 'setSelectedText':
          this.handleSetSelectedText(request);
          break;

        case 'setMediaForAnalysis':
          this.handleSetMediaForAnalysis(request);
          break;

        case 'streamApiStart':
          this.streamingManager.startStream(
            request,
            this.conversationManager.conversationHistory,
            this.userInput,
            this.sendButton,
            this.clearButton,
            this.loadingManager
          );
          break;

        case 'streamApiResponseChunk':
          this.streamingManager.processStreamChunk(request);
          break;

        case 'streamApiToolCallChunk':
          this.streamingManager.processToolCallChunk(request);
          break;

        case 'streamApiAnthropicContentBlockStart':
          this.streamingManager.processAnthropicContentBlockStart(request);
          break;

        case 'streamApiAnthropicMessageStop':
          this.streamingManager.processAnthropicMessageStop(
            request,
            this.conversationManager.conversationHistory,
            this.userInput,
            this.sendButton,
            this.clearButton,
            this.loadingManager
          );
          break;

        case 'streamApiEnd':
          this.streamingManager.endStream(
            request,
            this.conversationManager.conversationHistory,
            this.userInput,
            this.sendButton,
            this.clearButton,
            this.loadingManager
          );
          break;

        case 'setApiResponse':
          this.handleSetApiResponse(request);
          break;

        case 'handleToolCallResponse':
          this.handleToolCallResponse(request);
          break;

        case 'displayErrorInChat':
          this.handleDisplayError(request);
          break;

        case 'tabContentResponse':
          this.handleTabContentResponse(request);
          break;

        case 'pinnedActionTabContentResponse':
          this.handlePinnedActionResponse(request);
          break;

        case 'explainContentResponse':
          this.handleExplainContentResponse(request);
          break;

        // Ignore request-type actions that are handled in background.js.
        // The chat side only cares about their corresponding *response* actions.
        case 'getTabContent':
        case 'getExplainContent':
        case 'getPinnedActionTabContent':
          // No-op in chat context
          break;

        default:
          logger.warn('ChatOrchestrator', 'Chat: Unknown message action:', request.action);
      }
    } catch (error) {
      logger.error('ChatOrchestrator', 'Chat: Error handling message:', error);
      await errorHandler.handleError(
        createError('Message handling failed', {
          category: ErrorCategory.SYSTEM,
          severity: ErrorSeverity.MEDIUM,
          originalError: error,
          context: { action: request.action },
        })
      );
    }
  }

  /**
   * Handle send message
   */
  async handleSendMessage() {
    let message = this.userInput.value.trim();
    if (!message) return;

    // Prepend one-off context if active
    if (this.oneoffContext) {
      message = `${message}\n\nContext:\n${this.oneoffContext}`;
      // Log for debugging
      logger.info('ChatOrchestrator', 'Chat: Sending message with one-off context');
    }

    // Clear input
    this.userInput.value = '';
    this.uiManager.autoExpandTextarea(this.userInput);

    // If one-off mode was active, switch back to chat area
    if (this.oneoffContext) {
      this.uiManager.toggleAreas({
        chatMainArea: { element: this.chatMainArea, visible: true },
        oneoffInstructionArea: { element: this.oneoffInstructionArea, visible: false },
      });
      this.oneoffContext = null; // Reset context
    }

    // Add user message to UI
    this.messageRenderer.addMessage('User', message.split('\n\nContext:')[0]);

    // Make API call
    await this.conversationManager.makeApiCall(message, {
      streaming: true,
      isStartChat: true, // Treat consolidated one-off/start as a fresh chat context for clarity
      tool_choice: 'auto',
    });
  }

  /**
   * Handle clear chat
   */
  handleClearChat() {
    this.uiManager.clearChat();
    this.conversationManager.clearHistory();
    this.chatMainArea.style.display = 'block';
    this.oneoffInstructionArea.style.display = 'none';
    this.oneoffContext = null; // Reset context
    this.userInput.focus();
  }

  /**
   * Handle set selected text
   */
  handleSetSelectedText(request) {
    this.uiManager.setSelectedText(request.selectedText, request.tabId);

    if (request.fromStartChat) {
      this.chatMainArea.style.display = 'block';
      this.oneoffInstructionArea.style.display = 'none';
      this.oneoffContext = null;
      this.conversationManager.clearHistory();
    } else {
      this.uiManager.updateSelectedTextDisplay(this.selectedTextDiv);
      this.chatMainArea.style.display = 'none';
      this.oneoffInstructionArea.style.display = 'block';
      this.oneoffContext = request.selectedText;
    }
  }

  /**
   * Handle set media for analysis
   */
  async handleSetMediaForAnalysis(request) {
    const mediaData = request.mediaData;
    this.uiManager.setCurrentMediaData(mediaData);
    this.tabId = request.tabId;

    // Show chat area
    this.chatMainArea.style.display = 'block';
    this.oneoffInstructionArea.style.display = 'none';

    // Handle loading state
    if (mediaData && mediaData.loading) {
      this.currentLoadingMessage = this.uiManager.addLoadingMessage();
    } else if (mediaData && mediaData.error) {
      this.uiManager.showMediaError(mediaData);
    } else if (mediaData && mediaData.base64) {
      this.uiManager.addMediaPreview(mediaData);

      // Determine analysis prompt and tool choice
      let analysisPrompt = 'Please analyze this media content.';
      let toolChoiceForMedia = 'none';
      const actionType = mediaData.actionType;
      const instructionId = mediaData.instructionId;

      if (actionType === 'summarize') {
        analysisPrompt = 'Please provide a summary of this media content.';
      } else if (actionType === 'explain') {
        analysisPrompt = 'Please explain what is shown in this media content in detail.';
      } else if (actionType === 'custom' && instructionId) {
        const instruction = await this.getInstructionById(instructionId);

        if (instruction) {
          // Use the saved instruction content as the prompt
          analysisPrompt = instruction.content || analysisPrompt;

          // Use the instruction's tool choice
          const toolChoiceRaw = instruction.tool_choice || 'none';
          toolChoiceForMedia = toolChoiceRaw;

          this.messageRenderer.addMessage(
            'System',
            `Using custom instruction for image analysis: ${instruction.name}`
          );
        } else {
          this.messageRenderer.addMessage(
            'System',
            'Custom image instruction not found; falling back to a generic image analysis.'
          );
        }
      }

      // Add media to conversation and make API call
      this.conversationManager.addToHistory({
        role: 'user',
        content: `[${mediaData.type.toUpperCase()} Analysis Request] ${analysisPrompt}`,
        media: mediaData,
      });

      await this.conversationManager.makeApiCallWithMedia(
        analysisPrompt,
        mediaData,
        toolChoiceForMedia
      );
    }

    // Remove loading message if it exists
    if (this.currentLoadingMessage) {
      this.uiManager.removeLoadingMessage(this.currentLoadingMessage);
      this.currentLoadingMessage = null;
    }
  }

  /**
   * Handle set API response
   */
  handleSetApiResponse(request) {
    if (request.apiResponse) {
      this.messageRenderer.addMessage('LLM', request.apiResponse);
      this.conversationManager.addToHistory({
        role: 'assistant',
        content: request.apiResponse,
      });
    }

    // Reset UI state
    this.userInput.disabled = false;
    this.sendButton.disabled = false;
    this.clearButton.textContent = 'Clear';
    this.userInput.focus();

    if (this.loadingManager) {
      this.loadingManager.setButtonLoading(this.sendButton, false);
      this.sendButton.textContent = 'Send';
    }
  }

  /**
   * Handle tool call response
   */
  async handleToolCallResponse(request) {
    logger.info('ChatOrchestrator', 'Chat: Handling tool call response:', request);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'executePromptPaulTool',
        toolCall: request.responseMessage.tool_calls[0],
      });

      if (response.error) {
        this.messageRenderer.addMessage('System', `Tool execution error: ${response.error}`);
      } else {
        this.messageRenderer.addMessage(
          'System',
          `Tool executed: ${request.responseMessage.tool_calls[0].function.name}`
        );
      }
    } catch (error) {
      logger.error('ChatOrchestrator', 'Chat: Error executing tool call:', error);
      this.messageRenderer.addMessage('System', `Tool execution error: ${error.message}`);
    }
  }

  /**
   * Handle display error in chat
   */
  handleDisplayError(request) {
    this.messageRenderer.addMessage('System', request.errorMessage);
  }

  /**
   * Send a Chrome runtime message and return a Promise for the response.
   * Normalizes callback-based chrome.runtime.sendMessage into async/await.
   */
  async sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) {
            logger.error(
              'ChatOrchestrator',
              'Chat: chrome.runtime.sendMessage error:',
              chrome.runtime.lastError
            );
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle load tab context (quick action in sidebar)
   * Loads current tab content into conversation history as context.
   */
  async handleLoadTabContext() {
    try {
      this.showToast('Loading tab context...');

      const response = await this.sendRuntimeMessage({
        action: 'getTabContent',
      });

      if (!response || !response.success) {
        logger.error('ChatOrchestrator', 'Chat: getTabContent failed. Response:', response);
        this.showToast(response?.error || 'Failed to get tab content', 'error');
        return;
      }

      if (!response.content) {
        this.showToast('No content received from tab.', 'warning');
        return;
      }

      // Add context to conversation history
      this.conversationManager.addToHistory({
        role: 'system',
        content: `The following is the content of the current tab for context:\n\n${response.content}`,
      });

      // Show a persistent notification box in the chat area
      const tabTitle = response.title || 'the current tab';
      this.messageRenderer.addMessage(
        'System',
        `Ready to chat about ${tabTitle}. Content length: ${response.content.length} characters.`,
        {
          isContext: true,
          fullContent: response.content,
          isError: false,
          isHelp: false
        }
      );

      this.showToast('Tab context loaded');
    } catch (error) {
      logger.error('ChatOrchestrator', 'Chat: Error loading tab context:', error);
      this.showToast('Failed to load tab context', 'error');
    }
  }

  /**
   * Handle explain content (quick action in sidebar)
   * Explains the current tab content, without requiring pre-selected text.
   */
  async handleExplainContent() {
    try {
      this.showToast('Requesting tab content for explanation...');

      const response = await this.sendRuntimeMessage({
        action: 'getTabContent',
      });

      if (!response || !response.success) {
        logger.error('ChatOrchestrator', 'Chat: getTabContent failed. Response:', response);
        this.showToast(response?.error || 'Failed to get tab content', 'error');
        return;
      }

      if (!response.content) {
        this.showToast('No content received from tab.', 'warning');
        return;
      }

      // Ensure chat area is visible
      this.uiManager.toggleAreas({
        chatMainArea: { element: this.chatMainArea, visible: true },
        oneoffInstructionArea: { element: this.oneoffInstructionArea, visible: false },
      });

      const prompt = `Explain the following content clearly and concisely:\n\n${response.content}`;

      await this.conversationManager.makeApiCall(prompt, { isStartChat: true });
      this.showToast('Tab content received, explaining...');
    } catch (error) {
      logger.error('ChatOrchestrator', 'Chat: Error explaining content:', error);
      this.showToast('Failed to explain content', 'error');
    }
  }

  /**
   * Handle custom instruction change
   */
  handleCustomInstructionChange() {
    if (!this.customInstructionSelect) return;

    const selectedInstruction = this.customInstructionSelect.value;
    if (!selectedInstruction) return;

    const selectedText = this.uiManager.getSelectedText();
    if (!selectedText) {
      this.showToast('No text selected for custom instruction', 'warning');
      return;
    }

    // This would need to fetch the actual instruction content
    logger.info('ChatOrchestrator', 'Chat: Selected custom instruction:', selectedInstruction);
  }

  /**
   * Handle export conversation
   */
  handleExportConversation() {
    try {
      const conversationText = this.conversationManager.exportConversation();
      if (!conversationText) {
        this.showToast('No conversation to export', 'warning', 2000);
        return;
      }

      // Create download
      const blob = new Blob([conversationText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversation_${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.showToast('Conversation exported', 'success', 2000);
    } catch (error) {
      logger.error('ChatOrchestrator', 'Chat: Error exporting conversation:', error);
      this.showToast('Failed to export conversation', 'error');
    }
  }

  /**
   * Handle tab content response
   */
  handleTabContentResponse(request) {
    // This would be handled by the component that requested the tab content
    logger.info('ChatOrchestrator', 'Chat: Tab content response:', request);
  }

  /**
   * Handle pinned action response
   */
  handlePinnedActionResponse(request) {
    // This would be handled by the component that requested the pinned action
    logger.info('ChatOrchestrator', 'Chat: Pinned action response:', request);
  }


  /**
   * Handle explain content response
   */
  handleExplainContentResponse(request) {
    if (request.content) {
      const prompt = 'Explain the following text:\n\n' + request.content;
      this.conversationManager.makeApiCall(prompt);
      this.showToast('Tab content received, explaining...');
    } else {
      this.showToast('No content received from tab.');
    }
  }

  /**
   * Setup quick actions (summarize, pinned actions)
   */
  setupQuickActions() {
    // Setup summarize tab button
    if (this.summarizeTabButton) {
      this.summarizeTabButton.addEventListener('click', () => this.handleSummarizeTab());
    }

    // Load pinned actions
    this.loadPinnedActions();
  }

  /**
   * Handle summarize tab functionality
   */
  async handleSummarizeTab() {
    try {
      this.showToast('Requesting tab content for summary...');

      const response = await this.sendRuntimeMessage({ action: 'getTabContent' });

      if (!response || !response.success) {
        const errorMessage = response?.error || 'Failed to get tab content';
        logger.error('ChatOrchestrator', 'Chat: getTabContent failed. Response:', response, 'Error:', errorMessage);
        this.showToast(errorMessage, 'error');
        return;
      }

      if (response.content) {
        const prompt = 'Summarize the following text:\n\n' + response.content;

        // Ensure chat area is visible
        this.uiManager.toggleAreas({
          chatMainArea: { element: this.chatMainArea, visible: true },
          oneoffInstructionArea: { element: this.oneoffInstructionArea, visible: false },
        });

        await this.conversationManager.makeApiCall(prompt, { isStartChat: true });
        this.showToast('Tab content received, summarizing...');
      } else {
        this.showToast('No content received from tab.', 'warning');
      }
    } catch (error) {
      logger.error('ChatOrchestrator', 'Chat: Error summarizing tab:', error);
      this.showToast('Failed to summarize tab content', 'error');
    }
  }

  /**
   * Load pinned actions from storage
   */
  async loadPinnedActions() {
    try {
      const result = await chrome.storage.local.get(['pinnedQuickActions', 'instructions']);
      const pinnedQuickActions = result.pinnedQuickActions || [];
      const instructions = result.instructions || [];

      if (this.pinnedActionsContainer) {
        this.pinnedActionsContainer.innerHTML = '';

        // Get pinned instructions
        const pinnedInstructions = instructions.filter(instruction =>
          pinnedQuickActions.includes(instruction.id)
        );

        // Create buttons for each pinned instruction
        pinnedInstructions.forEach(instruction => {
          const button = document.createElement('button');
          button.className = 'quick-action-button pinned-action';
          button.title = instruction.content;
          button.textContent = instruction.name.charAt(0).toUpperCase();
          button.addEventListener('click', async () => {
            // Ensure chat area is visible
            this.uiManager.toggleAreas({
              chatMainArea: { element: this.chatMainArea, visible: true },
              oneoffInstructionArea: { element: this.oneoffInstructionArea, visible: false },
            });

            // If instruction has tool_choice, we might treat it differently,
            // but for now we follow the "grab content and prompt" pattern.

            try {
              this.showToast('Requesting tab content...');
              const response = await this.sendRuntimeMessage({ action: 'getTabContent' });

              if (!response || !response.success) {
                // Fallback: just send the instruction if content fetch fails?
                // Or warn the user. Let's warn.
                this.showToast('Failed to get tab content to apply instruction to', 'error');
                return;
              }

              const content = response.content || '';
              if (!content) {
                this.showToast('No content found on tab', 'warning');
                return;
              }

              const prompt = `${instruction.content}\n\n${content}`;

              // Send instruction as message
              this.conversationManager.makeApiCall(prompt, { isStartChat: true });

            } catch (e) {
              logger.error('ChatOrchestrator', 'Chat: Error executing pinned action:', e);
              this.showToast('Error executing action', 'error');
            }
          });

          this.pinnedActionsContainer.appendChild(button);
        });
      }
    } catch (error) {
      logger.error('ChatOrchestrator', 'Chat: Error loading pinned actions:', error);
    }
  }

  /**
   * Show toast notification
   */
  showToast(message, type = 'success', duration = 3000, options = {}) {
    if (this.loadingManager && this.loadingManager.showToast) {
      this.loadingManager.showToast(message, type, duration, options);
    } else {
      logger.info('ChatOrchestrator', `Toast (${type}): ${message}`);
    }
  }

  /**
   * Get instruction by ID from storage
   * Get instruction by ID from storage
   * @param {string} instructionId - The instruction ID to fetch
   * @returns {Promise<Object|null>} The instruction object or null if not found
   */
  async getInstructionById(instructionId) {
    try {
      const result = await chrome.storage.local.get(['instructions']);
      const instructions = result.instructions || [];
      return instructions.find(instruction => instruction.id === instructionId) || null;
    } catch (error) {
      logger.error('ChatOrchestrator', 'Chat: Error fetching instruction by ID:', error);
      return null;
    }
  }

  /**
   * Get orchestrator state
   * @returns {Object} Current state
   */
  getState() {
    return {
      isInitialized: this.isInitialized,
      conversationStats: this.conversationManager.getConversationStats(),
      streamingState: this.streamingManager.getStreamingState(),
      uiState: this.uiManager.getUIState(),
    };
  }

  /**
   * Reset orchestrator
   */
  reset() {
    this.uiManager.reset();
    this.conversationManager.clearHistory();
    this.streamingManager.resetStreamingState();
  }
}

// Export singleton instance
export const chatOrchestrator = new ChatOrchestrator();
