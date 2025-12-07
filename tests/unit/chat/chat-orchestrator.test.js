/**
 * Unit Tests for Chat Orchestrator
 * Tests the central coordinator for chat functionality
 */

const { ChatOrchestrator } = require('../../mocks/chat-modules.mock.js');
const { mockChrome, mockChromeHelpers } = require('../../setup/chrome-mocks.js');

describe('ChatOrchestrator', () => {
  let chatOrchestrator;
  let mockDOM;
  let mockMessageRenderer;
  let mockUIManager;
  let mockStreamingManager;
  let mockConversationManager;
  let mockStorageService;

  beforeEach(() => {
    // Reset mocks
    mockChromeHelpers.resetMocks();

    // Create mock DOM environment
    mockDOM = mockChromeHelpers.createMockDOM();
    global.document = mockDOM.document;
    global.window = mockDOM.window;

    // Mock modules
    mockMessageRenderer = {
      addMessage: jest.fn(),
      updateMessageContent: jest.fn(),
      clearChatArea: jest.fn(),
      showMessageStatus: jest.fn(),
      formatTimestamp: jest.fn(),
      renderToolCall: jest.fn(),
      renderToolResult: jest.fn(),
    };

    mockUIManager = {
      toggleAreas: jest.fn(),
      showElement: jest.fn(),
      hideElement: jest.fn(),
      setElementText: jest.fn(),
      disableElement: jest.fn(),
      enableElement: jest.fn(),
      autoExpandTextarea: jest.fn(),
      setButtonLoading: jest.fn(),
      showToast: jest.fn(),
      showError: jest.fn(),
      showSuccess: jest.fn(),
      initializeEventListeners: jest.fn(),
      clearInput: jest.fn(),
      getInputValue: jest.fn(),
      setInputValue: jest.fn(),
      focusInput: jest.fn(),
    };

    mockStreamingManager = {
      startStream: jest.fn(),
      handleStreamChunk: jest.fn(),
      handleToolCallChunk: jest.fn(),
      stopStream: jest.fn(),
      isActive: jest.fn().mockReturnValue(false),
      getStreamingState: jest.fn().mockReturnValue({ active: false }),
    };

    mockConversationManager = {
      initialize: jest.fn(),
      loadApiConfig: jest.fn(),
      loadTools: jest.fn(),
      makeApiCall: jest.fn(),
      makeApiCallWithMedia: jest.fn(),
      addToHistory: jest.fn(),
      getHistory: jest.fn(),
      clearHistory: jest.fn(),
      exportConversation: jest.fn(),
      getCurrentRequest: jest.fn(),
      isProcessing: jest.fn(),
      getConversationStats: jest.fn(),
      refresh: jest.fn(),
    };

    mockStorageService = {
      getLocal: jest.fn(),
      setLocal: jest.fn(),
      getSync: jest.fn(),
      setSync: jest.fn(),
      getToolDefinitions: jest.fn(),
      clearAll: jest.fn(),
      exportData: jest.fn(),
      importData: jest.fn(),
      getStorageUsage: jest.fn(),
    };

    // Mock module imports
    require('../../../chat/message-renderer.js').MessageRenderer = jest.fn(
      () => mockMessageRenderer
    );
    require('../../../chat/ui-manager.js').UIManager = jest.fn(() => mockUIManager);
    require('../../../chat/streaming-manager.js').StreamingManager = jest.fn(
      () => mockStreamingManager
    );
    require('../../../chat/conversation-manager.js').ConversationManager = jest.fn(
      () => mockConversationManager
    );
    require('../../../services/storage-service.js').storageService = mockStorageService;

    // Create ChatOrchestrator instance
    chatOrchestrator = new ChatOrchestrator();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    test('should instantiate ChatOrchestrator successfully', () => {
      expect(chatOrchestrator).toBeDefined();
      expect(chatOrchestrator.messageRenderer).toBeDefined();
      expect(chatOrchestrator.uiManager).toBeDefined();
      expect(chatOrchestrator.streamingManager).toBeDefined();
      expect(chatOrchestrator.conversationManager).toBeDefined();
    });

    test('should initialize DOM elements correctly', () => {
      // Mock required DOM elements
      const mockElements = {
        'chat-area': { id: 'chat-area' },
        'user-input': { id: 'user-input', value: '' },
        'send-button': { id: 'send-button', disabled: false },
        'clear-button': { id: 'clear-button', disabled: false },
        'chat-main-area': { id: 'chat-main-area', style: {} },
        'oneoff-instruction-area': { id: 'oneoff-instruction-area', style: {} },
      };

      mockDOM.document.getElementById.mockImplementation(id => mockElements[id] || null);

      // Test DOM element initialization
      chatOrchestrator.initializeDOMElements();

      // Verify all required elements are found
      expect(chatOrchestrator.chatArea).toBe(mockElements['chat-area']);
      expect(chatOrchestrator.userInput).toBe(mockElements['user-input']);
      expect(chatOrchestrator.sendButton).toBe(mockElements['send-button']);
      expect(chatOrchestrator.clearButton).toBe(mockElements['clear-button']);
      expect(chatOrchestrator.chatMainArea).toBe(mockElements['chat-main-area']);
      expect(chatOrchestrator.oneoffInstructionArea).toBe(mockElements['oneoff-instruction-area']);
    });

    test('should handle missing DOM elements gracefully', () => {
      // Mock missing element
      mockDOM.document.getElementById.mockImplementation(id => null);

      // Should not throw error
      expect(() => chatOrchestrator.initializeDOMElements()).not.toThrow();

      // Elements should be null
      expect(chatOrchestrator.chatArea).toBeNull();
      expect(chatOrchestrator.userInput).toBeNull();
    });

    test('should initialize successfully', async () => {
      // Mock successful DOM elements
      const mockElements = {
        'chat-area': { id: 'chat-area' },
        'user-input': { id: 'user-input', value: '' },
        'send-button': { id: 'send-button', disabled: false },
        'clear-button': { id: 'clear-button', disabled: false },
        'chat-main-area': { id: 'chat-main-area', style: {} },
        'oneoff-instruction-area': { id: 'oneoff-instruction-area', style: {} },
      };
      mockDOM.document.getElementById.mockImplementation(id => mockElements[id] || null);

      // Mock storage data
      mockStorageService.getLocal.mockResolvedValue({
        pinnedQuickActions: [],
      });

      await chatOrchestrator.initialize();

      // Verify modules are initialized
      expect(mockMessageRenderer.addMessage).toHaveBeenCalledWith('System', expect.any(String));
      expect(mockUIManager.initializeEventListeners).toHaveBeenCalled();
      expect(mockConversationManager.initialize).toHaveBeenCalled();
      expect(mockConversationManager.loadPinnedActions).toHaveBeenCalled();
    });

    test('should handle initialization errors gracefully', async () => {
      // Mock storage service error
      mockStorageService.getLocal.mockRejectedValue(new Error('Storage error'));

      await chatOrchestrator.initialize();

      // Should show error message
      expect(mockMessageRenderer.addMessage).toHaveBeenCalledWith(
        'System',
        expect.stringContaining('failed')
      );
      expect(mockUIManager.showError).toHaveBeenCalled();
    });
  });

  describe('State Management', () => {
    test('should get current state', () => {
      const state = chatOrchestrator.getState();

      expect(state).toHaveProperty('activeConversation');
      expect(state).toHaveProperty('isProcessing');
      expect(state).toHaveProperty('pinnedActions');
      expect(state).toHaveProperty('apiConfig');
    });

    test('should check if processing request', () => {
      // Mock conversation manager to return false
      mockConversationManager.isProcessing.mockReturnValue(false);
      mockStreamingManager.isActive.mockReturnValue(false);

      expect(chatOrchestrator.isProcessing()).toBe(false);

      // Mock active streaming
      mockStreamingManager.isActive.mockReturnValue(true);
      expect(chatOrchestrator.isProcessing()).toBe(true);
    });

    test('should reset chat state', async () => {
      await chatOrchestrator.resetChat();

      expect(mockConversationManager.clearHistory).toHaveBeenCalled();
      expect(mockMessageRenderer.clearChatArea).toHaveBeenCalled();
      expect(mockUIManager.clearInput).toHaveBeenCalled();
      expect(mockUIManager.focusInput).toHaveBeenCalled();
      expect(mockStreamingManager.stopStream).toHaveBeenCalled();
    });
  });

  describe('Message Handling', () => {
    beforeEach(() => {
      // Mock DOM elements
      const mockElements = {
        'chat-area': { id: 'chat-area' },
        'user-input': { id: 'user-input', value: '' },
        'send-button': { id: 'send-button', disabled: false },
        'clear-button': { id: 'clear-button', disabled: false },
      };
      mockDOM.document.getElementById.mockImplementation(id => mockElements[id] || null);
    });

    test('should handle send message', async () => {
      const testMessage = 'Hello, world!';

      // Mock conversation manager
      mockConversationManager.isProcessing.mockReturnValue(false);
      mockStorageService.getLocal.mockResolvedValue({
        pinnedQuickActions: [],
      });

      await chatOrchestrator.handleSendMessage(testMessage);

      expect(mockConversationManager.makeApiCall).toHaveBeenCalledWith(testMessage, {
        tool_choice: 'auto',
      });
      expect(mockUIManager.setButtonLoading).toHaveBeenCalledWith(
        mockDOM.document.getElementById('send-button'),
        true
      );
    });

    test('should handle empty message', async () => {
      const testMessage = '';

      await chatOrchestrator.handleSendMessage(testMessage);

      expect(mockConversationManager.makeApiCall).not.toHaveBeenCalled();
      expect(mockUIManager.showToast).toHaveBeenCalledWith('Please enter a message', 'warning');
    });

    test('should handle message while processing', async () => {
      const testMessage = 'Processing test';

      // Mock active processing
      mockConversationManager.isProcessing.mockReturnValue(true);

      await chatOrchestrator.handleSendMessage(testMessage);

      expect(mockConversationManager.makeApiCall).not.toHaveBeenCalled();
      expect(mockUIManager.showToast).toHaveBeenCalledWith(
        'Please wait for the current response to complete',
        'warning'
      );
    });

    test('should handle message with attached media', async () => {
      const testMessage = 'Look at this image';
      const mockMediaData = {
        type: 'image',
        mimeType: 'image/png',
        base64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      };

      mockConversationManager.isProcessing.mockReturnValue(false);
      mockStorageService.getLocal.mockResolvedValue({
        pinnedQuickActions: [],
      });

      await chatOrchestrator.handleSendMessage(testMessage, mockMediaData);

      expect(mockConversationManager.makeApiCallWithMedia).toHaveBeenCalledWith(
        testMessage,
        mockMediaData,
        {
          tool_choice: 'auto',
        }
      );
    });
  });

  describe('Quick Actions', () => {
    beforeEach(() => {
      // Mock DOM elements for quick actions
      const mockElements = {
        'pinned-actions-container': { id: 'pinned-actions-container', innerHTML: '' },
        'quick-actions-sidebar': { id: 'quick-actions-sidebar', style: { display: 'none' } },
      };
      mockDOM.document.getElementById.mockImplementation(id => mockElements[id] || null);
    });

    test('should load pinned actions', async () => {
      const mockPinnedActions = [
        {
          id: 'action1',
          name: 'Summarize',
          instruction: 'Summarize the current conversation',
          icon: 'summarize',
        },
        {
          id: 'action2',
          name: 'Translate',
          instruction: 'Translate to English',
          icon: 'translate',
        },
      ];

      mockStorageService.getLocal.mockResolvedValue({
        pinnedQuickActions: mockPinnedActions,
      });

      await chatOrchestrator.loadPinnedActions();

      expect(mockUIManager.showElement).toHaveBeenCalled();
      expect(mockUIManager.setElementText).toHaveBeenCalled();
    });

    test('should handle empty pinned actions', async () => {
      mockStorageService.getLocal.mockResolvedValue({
        pinnedQuickActions: [],
      });

      await chatOrchestrator.loadPinnedActions();

      expect(mockUIManager.hideElement).toHaveBeenCalled();
    });

    test('should handle pinned action click', async () => {
      const mockAction = {
        id: 'action1',
        name: 'Summarize',
        instruction: 'Summarize the conversation',
      };

      mockConversationManager.isProcessing.mockReturnValue(false);
      mockStorageService.getLocal.mockResolvedValue({
        pinnedQuickActions: [mockAction],
      });

      await chatOrchestrator.loadPinnedActions();

      // Simulate click event
      const clickEvent = testUtils.createEvent('click');
      const mockButton = testUtils.createElement('button');
      mockUIManager.setElementText.mockImplementation((element, text) => {
        if (text.includes('Summarize')) {
          mockButton.click = jest.fn();
          return mockButton;
        }
      });

      mockUIManager.setElementText(mockDOM.document.getElementById('pinned-actions-container'), '');

      // Trigger click
      mockButton.click();

      expect(mockConversationManager.makeApiCall).toHaveBeenCalledWith(
        'Summarize the conversation',
        {
          tool_choice: 'none',
        }
      );
    });

    test('should handle summarize tab functionality', async () => {
      // Mock summarize tab button
      const mockElements = {
        'summarize-tab-button': { id: 'summarize-tab-button', addEventListener: jest.fn() },
      };
      mockDOM.document.getElementById.mockImplementation(id => mockElements[id] || null);

      chatOrchestrator.setupQuickActions();

      // Verify event listener is added
      expect(mockElements['summarize-tab-button'].addEventListener).toHaveBeenCalledWith(
        'click',
        expect.any(Function)
      );
    });
  });

  describe('One-off Instructions', () => {
    beforeEach(() => {
      // Mock DOM elements
      const mockElements = {
        'oneoff-instruction-area': { id: 'oneoff-instruction-area', style: { display: 'none' } },
        customInstructionSelect: { id: 'customInstructionSelect', value: '' },
        submitBtn: { id: 'submitBtn', addEventListener: jest.fn() },
      };
      mockDOM.document.getElementById.mockImplementation(id => mockElements[id] || null);
    });

    test('should show one-off instruction area', () => {
      chatOrchestrator.showOneOffInstructionArea();

      expect(mockUIManager.showElement).toHaveBeenCalledWith(
        mockDOM.document.getElementById('oneoff-instruction-area')
      );
      expect(mockUIManager.showElement).toHaveBeenCalledWith(
        mockDOM.document.getElementById('chat-main-area')
      );
      expect(mockUIManager.hideElement).toHaveBeenCalledWith(
        mockDOM.document.getElementById('oneoff-instruction-area')
      );
    });

    test('should hide one-off instruction area', () => {
      chatOrchestrator.hideOneOffInstructionArea();

      expect(mockUIManager.hideElement).toHaveBeenCalledWith(
        mockDOM.document.getElementById('oneoff-instruction-area')
      );
      expect(mockUIManager.showElement).toHaveBeenCalledWith(
        mockDOM.document.getElementById('chat-main-area')
      );
    });

    test('should handle custom instruction submission', async () => {
      const mockInstructions = [
        { id: 'inst1', name: 'Translate', instruction: 'Translate to Spanish' },
        { id: 'inst2', name: 'Summarize', instruction: 'Create a summary' },
      ];

      mockStorageService.getLocal.mockResolvedValue({
        instructions: mockInstructions,
      });

      chatOrchestrator.setupOneOffInstructions();

      // Find the submit button and trigger click
      const submitBtn = mockDOM.document.getElementById('submitBtn');
      const clickHandler = submitBtn.addEventListener.mock.calls[0][1];

      // Mock instruction selection
      mockDOM.document.getElementById.mockImplementation(id => {
        if (id === 'customInstructionSelect') {
          return { value: 'inst1' };
        }
        return null;
      });

      // Mock conversation state
      mockConversationManager.isProcessing.mockReturnValue(false);

      // Simulate click
      clickHandler({ preventDefault: jest.fn() });

      expect(mockConversationManager.makeApiCall).toHaveBeenCalledWith('Translate to Spanish', {
        tool_choice: 'none',
      });
    });

    test('should handle empty instruction selection', async () => {
      mockStorageService.getLocal.mockResolvedValue({
        instructions: [],
      });

      chatOrchestrator.setupOneOffInstructions();

      const submitBtn = mockDOM.document.getElementById('submitBtn');
      const clickHandler = submitBtn.addEventListener.mock.calls[0][1];

      // Mock empty selection
      mockDOM.document.getElementById.mockImplementation(id => {
        if (id === 'customInstructionSelect') {
          return { value: '' };
        }
        return null;
      });

      // Simulate click
      clickHandler({ preventDefault: jest.fn() });

      expect(mockUIManager.showToast).toHaveBeenCalledWith(
        'Please select an instruction',
        'warning'
      );
      expect(mockConversationManager.makeApiCall).not.toHaveBeenCalled();
    });
  });

  describe('Chrome Extension Integration', () => {
    test('should handle extension startup message', async () => {
      const mockMessage = {
        action: 'extensionStartup',
      };

      const mockSendResponse = jest.fn();
      mockChrome.runtime._messageListeners.push((message, sender, sendResponse) => {
        return chatOrchestrator.handleChromeMessage(message, sender, sendResponse);
      });

      const result = await chatOrchestrator.handleChromeMessage(mockMessage, {}, mockSendResponse);

      expect(result).toBe(true);
    });

    test('should handle API response messages', async () => {
      const mockMessage = {
        action: 'setApiResponse',
        apiResponse: 'Hello from AI!',
        prompt: 'Test message',
      };

      const mockSendResponse = jest.fn();

      await chatOrchestrator.handleChromeMessage(mockMessage, {}, mockSendResponse);

      expect(mockMessageRenderer.addMessage).toHaveBeenCalledWith('LLM', 'Hello from AI!');
      expect(mockUIManager.setButtonLoading).toHaveBeenCalled();
    });

    test('should handle streaming start message', async () => {
      const mockMessage = {
        action: 'streamApiStart',
        prompt: 'Test message',
      };

      const mockSendResponse = jest.fn();

      await chatOrchestrator.handleChromeMessage(mockMessage, {}, mockSendResponse);

      expect(mockStreamingManager.startStream).toHaveBeenCalled();
      expect(mockUIManager.setButtonLoading).toHaveBeenCalled();
    });

    test('should handle streaming chunk messages', async () => {
      const mockMessage = {
        action: 'streamApiResponseChunk',
        chunk: 'Hello',
        prompt: 'Test message',
      };

      const mockSendResponse = jest.fn();

      await chatOrchestrator.handleChromeMessage(mockMessage, {}, mockSendResponse);

      expect(mockStreamingManager.handleStreamChunk).toHaveBeenCalledWith('Hello');
    });

    test('should handle stream end message', async () => {
      const mockMessage = {
        action: 'streamApiEnd',
        prompt: 'Test message',
      };

      const mockSendResponse = jest.fn();

      await chatOrchestrator.handleChromeMessage(mockMessage, {}, mockSendResponse);

      expect(mockStreamingManager.stopStream).toHaveBeenCalled();
      expect(mockUIManager.setButtonLoading).toHaveBeenCalled();
    });

    test('should handle clear chat message', async () => {
      const mockMessage = {
        action: 'clearChat',
      };

      const mockSendResponse = jest.fn();

      await chatOrchestrator.handleChromeMessage(mockMessage, {}, mockSendResponse);

      expect(mockConversationManager.clearHistory).toHaveBeenCalled();
      expect(mockMessageRenderer.clearChatArea).toHaveBeenCalled();
    });

    test('should handle export conversation message', async () => {
      const mockExportedConversation = 'User: Hello\nAI: Hi there!';
      mockConversationManager.exportConversation.mockReturnValue(mockExportedConversation);

      const mockMessage = {
        action: 'exportConversation',
      };

      const mockSendResponse = jest.fn();

      await chatOrchestrator.handleChromeMessage(mockMessage, {}, mockSendResponse);

      expect(mockSendResponse).toHaveBeenCalledWith({
        conversation: mockExportedConversation,
      });
    });

    test('should handle unknown message action', async () => {
      const mockMessage = {
        action: 'unknownAction',
      };

      const mockSendResponse = jest.fn();

      await chatOrchestrator.handleChromeMessage(mockMessage, {}, mockSendResponse);

      expect(mockUIManager.showToast).toHaveBeenCalledWith(
        'Unknown action: unknownAction',
        'error'
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle API response errors', async () => {
      const mockMessage = {
        action: 'setApiResponse',
        error: 'API Error: Request failed',
        prompt: 'Test message',
      };

      const mockSendResponse = jest.fn();

      await chatOrchestrator.handleChromeMessage(mockMessage, {}, mockSendResponse);

      expect(mockMessageRenderer.addMessage).toHaveBeenCalledWith(
        'System',
        'API Error: Request failed'
      );
      expect(mockUIManager.setButtonLoading).toHaveBeenCalled();
    });

    test('should handle exceptions gracefully', async () => {
      // Mock method that throws error
      mockConversationManager.makeApiCall.mockRejectedValue(new Error('Test error'));

      // Mock DOM elements
      const mockElements = {
        'user-input': { id: 'user-input', value: 'Test message' },
        'send-button': { id: 'send-button', disabled: false },
      };
      mockDOM.document.getElementById.mockImplementation(id => mockElements[id] || null);

      mockConversationManager.isProcessing.mockReturnValue(false);
      mockStorageService.getLocal.mockResolvedValue({
        pinnedQuickActions: [],
      });

      await chatOrchestrator.handleSendMessage('Test message');

      expect(mockUIManager.setButtonLoading).toHaveBeenCalledWith(
        mockElements['send-button'],
        false
      );
    });
  });

  describe('Cleanup', () => {
    test('should properly cleanup on destroy', () => {
      chatOrchestrator.destroy();

      // Verify cleanup operations
      expect(mockStreamingManager.cancelAllStreams).toHaveBeenCalled();
    });
  });
});
