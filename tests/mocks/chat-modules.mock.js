/**
 * Mock implementations for chat modules
 * Used to avoid ES6 module import issues in testing
 */

// Mock MessageRenderer
export const MessageRenderer = jest.fn().mockImplementation(() => ({
  chatArea: null,
  showToast: null,

  discoverElements: jest.fn(),
  createMessageElement: jest.fn().mockReturnValue({
    id: 'mock-message',
    className: 'message',
    innerHTML: '',
    querySelector: jest.fn(),
    classList: { add: jest.fn(), remove: jest.fn() }
  }),

  addMessage: jest.fn().mockResolvedValue({ id: 'mock-message' }),
  removeMessage: jest.fn(),
  updateMessage: jest.fn(),
  updateStreamingMessage: jest.fn(),
  finalizeStreamingMessage: jest.fn(),
  processContent: jest.fn((content) => content),

  createErrorMessage: jest.fn().mockReturnValue({
    className: 'error-message',
    textContent: 'Mock error'
  }),

  addErrorMessage: jest.fn(),
  clearAllMessages: jest.fn(),

  highlightCode: jest.fn(),
  detectCodeLanguage: jest.fn(),

  updateConfig: jest.fn(),
  debounce: jest.fn((fn) => fn),
  throttle: jest.fn((fn) => fn),

  cleanup: jest.fn()
}));

// Mock UIManager
export const UIManager = jest.fn().mockImplementation(() => ({
  elements: {},
  state: {},
  config: {
    enableAnimations: true,
    enableKeyboardShortcuts: true,
    enableAutoFocus: true,
    debounceDelay: 300
  },

  discoverElements: jest.fn().mockReturnValue({
    chatArea: { id: 'chat-area' },
    userInput: { id: 'user-input' },
    sendButton: { id: 'send-button' },
    loadingIndicator: { id: 'loading-indicator' }
  }),

  getUserInput: jest.fn().mockReturnValue(''),
  setUserInput: jest.fn(),
  clearInput: jest.fn(),
  getInputSelection: jest.fn().mockReturnValue({ start: 0, end: 0 }),
  setInputSelection: jest.fn(),

  enableSendButton: jest.fn(),
  disableSendButton: jest.fn(),
  setButtonLoading: jest.fn(),

  showLoading: jest.fn(),
  hideLoading: jest.fn(),
  showTypingIndicator: jest.fn(),
  hideTypingIndicator: jest.fn(),

  focusInput: jest.fn(),
  blurInput: jest.fn(),
  isInputFocused: jest.fn().mockReturnValue(false),

  setupEventListeners: jest.fn(),
  removeEventListeners: jest.fn(),
  setupKeyboardShortcuts: jest.fn(),

  setState: jest.fn(),
  getState: jest.fn().mockReturnValue({}),
  resetState: jest.fn(),

  updateConfig: jest.fn(),
  showElement: jest.fn(),
  hideElement: jest.fn(),
  addAnimation: jest.fn(),

  createModal: jest.fn(),
  showModal: jest.fn(),
  hideModal: jest.fn(),

  createToast: jest.fn(),
  showToast: jest.fn(),

  isMobile: jest.fn().mockReturnValue(false),
  setupResponsiveHandling: jest.fn(),

  announceToScreenReader: jest.fn(),
  setAriaAttributes: jest.fn(),
  trapFocus: jest.fn(),

  cleanup: jest.fn()
}));

// Mock StreamingManager
export const StreamingManager = jest.fn().mockImplementation((messageRenderer, conversationManager) => ({
  messageRenderer,
  conversationManager,
  activeStreams: new Map(),
  config: {
    chunkTimeout: 5000,
    maxRetries: 3,
    retryDelay: 1000,
    enableMarkdown: true,
    autoScroll: true
  },

  startStreaming: jest.fn().mockResolvedValue({ messageId: 'test-message' }),
  stopStreaming: jest.fn(),
  stopAllStreams: jest.fn(),

  updateConfig: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),

  parseSSEData: jest.fn().mockReturnValue(['Hello', 'World']),
  parseJSONChunk: jest.fn(),
  detectStreamFormat: jest.fn().mockReturnValue('text'),

  destroy: jest.fn()
}));

// Mock ConversationManager
export const ConversationManager = jest.fn().mockImplementation(() => ({
  conversations: new Map(),
  currentConversationId: null,

  loadConversations: jest.fn().mockResolvedValue([]),
  saveConversations: jest.fn().mockResolvedValue(),

  createConversation: jest.fn().mockResolvedValue({ id: 'new-conversation', messages: [] }),
  getConversation: jest.fn().mockResolvedValue({ id: 'test-conversation', messages: [] }),
  getCurrentConversation: jest.fn().mockReturnValue({ id: 'test-conversation', messages: [] }),
  setCurrentConversation: jest.fn(),

  addMessage: jest.fn().mockResolvedValue({ id: 'new-message' }),
  updateMessage: jest.fn().mockResolvedValue(),
  deleteMessage: jest.fn().mockResolvedValue(),

  deleteConversation: jest.fn().mockResolvedValue(),
  clearAllConversations: jest.fn().mockResolvedValue(),

  exportConversations: jest.fn().mockResolvedValue('{}'),
  importConversations: jest.fn().mockResolvedValue(),

  generateTitle: jest.fn().mockResolvedValue('New Conversation'),

  updateConfig: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),

  cleanup: jest.fn()
}));

// Mock ChatOrchestrator
export const ChatOrchestrator = jest.fn().mockImplementation(() => ({
  messageRenderer: new MessageRenderer(),
  uiManager: new UIManager(),
  streamingManager: new StreamingManager(new MessageRenderer(), new ConversationManager()),
  conversationManager: new ConversationManager(),

  initialize: jest.fn().mockResolvedValue(),

  sendMessage: jest.fn().mockResolvedValue({ id: 'response-message' }),
  sendStreamingMessage: jest.fn().mockResolvedValue({ id: 'streaming-message' }),

  regenerateResponse: jest.fn().mockResolvedValue({ id: 'regenerated-message' }),
  stopStreaming: jest.fn(),

  clearChat: jest.fn().mockResolvedValue(),
  exportConversation: jest.fn().mockResolvedValue('{}'),

  toggleSettings: jest.fn(),
  toggleTheme: jest.fn(),

  updateConfig: jest.fn(),
  getState: jest.fn().mockReturnValue({}),

  on: jest.fn(),
  off: jest.fn(),

  cleanup: jest.fn()
}));