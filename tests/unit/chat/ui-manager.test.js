/**
 * Unit Tests for UIManager
 * Tests UI state management, event handling, and user interface controls
 */

import { UIManager } from '../../../chat/ui-manager.js';
import { jest } from '@jest/globals';

// Mock DOM APIs
const mockElement = {
  id: '',
  className: '',
  innerHTML: '',
  textContent: '',
  value: '',
  disabled: false,
  hidden: false,
  style: {},
  dataset: {},
  classList: {
    add: jest.fn(),
    remove: jest.fn(),
    contains: jest.fn(() => false),
    toggle: jest.fn()
  },
  appendChild: jest.fn(),
  removeChild: jest.fn(),
  querySelector: jest.fn(() => null),
  querySelectorAll: jest.fn(() => []),
  getAttribute: jest.fn(),
  setAttribute: jest.fn(),
  removeAttribute: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  click: jest.fn(),
  focus: jest.fn(),
  blur: jest.fn()
};

const mockDocument = {
  getElementById: jest.fn((id) => {
    const element = { ...mockElement, id };
    return element;
  }),
  createElement: jest.fn(() => mockElement),
  querySelector: jest.fn(() => null),
  querySelectorAll: jest.fn(() => []),
  body: {
    appendChild: jest.fn()
  },
  activeElement: null,
  readyState: 'complete'
};

const mockWindow = {
  location: { reload: jest.fn() },
  CustomEvent: jest.fn((type, options) => ({
    type,
    detail: options?.detail || {},
    bubbles: options?.bubbles || false,
    cancelable: options?.cancelable || false
  })),
  dispatchEvent: jest.fn(),
  history: { pushState: jest.fn() }
};

describe('UIManager', () => {
  let uiManager;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set up global DOM mocks
    global.document = mockDocument;
    global.window = mockWindow;
    global.console = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    };

    // Create UI manager instance
    uiManager = new UIManager();
  });

  describe('Initialization', () => {
    test('should instantiate UIManager successfully', () => {
      expect(uiManager).toBeDefined();
      expect(uiManager.elements).toBeDefined();
      expect(uiManager.state).toBeDefined();
      expect(uiManager.config).toBeDefined();
    });

    test('should initialize with default configuration', () => {
      expect(uiManager.config.enableAnimations).toBe(true);
      expect(uiManager.config.enableKeyboardShortcuts).toBe(true);
      expect(uiManager.config.enableAutoFocus).toBe(true);
      expect(uiManager.config.autoSave).toBe(true);
      expect(uiManager.config.debounceDelay).toBe(300);
    });

    test('should update configuration when provided', () => {
      const customConfig = {
        enableAnimations: false,
        debounceDelay: 500
      };

      uiManager.updateConfig(customConfig);

      expect(uiManager.config.enableAnimations).toBe(false);
      expect(uiManager.config.debounceDelay).toBe(500);
    });
  });

  describe('DOM Element Discovery', () => {
    test('should find all required UI elements', () => {
      const elements = uiManager.discoverElements();

      expect(mockDocument.getElementById).toHaveBeenCalledWith('chat-area');
      expect(mockDocument.getElementById).toHaveBeenCalledWith('user-input');
      expect(mockDocument.getElementById).toHaveBeenCalledWith('send-button');
      expect(mockDocument.getElementById).toHaveBeenCalledWith('loading-indicator');

      expect(elements.chatArea).toBeDefined();
      expect(elements.userInput).toBeDefined();
      expect(elements.sendButton).toBeDefined();
      expect(elements.loadingIndicator).toBeDefined();
    });

    test('should handle missing elements gracefully', () => {
      mockDocument.getElementById.mockReturnValue(null);

      const elements = uiManager.discoverElements();

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Element not found')
      );
    });

    test('should cache discovered elements', () => {
      const elements1 = uiManager.discoverElements();
      const elements2 = uiManager.discoverElements();

      expect(mockDocument.getElementById).toHaveBeenCalledTimes(5); // Called once, then cached
      expect(elements1).toBe(elements2);
    });
  });

  describe('Input Management', () => {
    test('should get user input value', () => {
      const inputElement = { ...mockElement, value: 'Hello world' };
      mockDocument.getElementById.mockReturnValue(inputElement);

      const inputValue = uiManager.getUserInput();

      expect(inputValue).toBe('Hello world');
      expect(mockDocument.getElementById).toHaveBeenCalledWith('user-input');
    });

    test('should set user input value', () => {
      const inputElement = { ...mockElement, value: '' };
      mockDocument.getElementById.mockReturnValue(inputElement);

      uiManager.setUserInput('New message');

      expect(inputElement.value).toBe('New message');
    });

    test('should clear user input', () => {
      const inputElement = { ...mockElement, value: 'Some text' };
      mockDocument.getElementById.mockReturnValue(inputElement);

      uiManager.clearInput();

      expect(inputElement.value).toBe('');
    });

    test('should get input selection range', () => {
      const inputElement = {
        ...mockElement,
        selectionStart: 5,
        selectionEnd: 10
      };
      mockDocument.getElementById.mockReturnValue(inputElement);

      const selection = uiManager.getInputSelection();

      expect(selection.start).toBe(5);
      expect(selection.end).toBe(10);
    });

    test('should set input selection range', () => {
      const inputElement = {
        ...mockElement,
        setSelectionRange: jest.fn()
      };
      mockDocument.getElementById.mockReturnValue(inputElement);

      uiManager.setInputSelection(2, 8);

      expect(inputElement.setSelectionRange).toHaveBeenCalledWith(2, 8);
    });
  });

  describe('Button Management', () => {
    test('should enable send button', () => {
      const sendButton = { ...mockElement, disabled: true };
      mockDocument.getElementById.mockReturnValue(sendButton);

      uiManager.enableSendButton();

      expect(sendButton.disabled).toBe(false);
      expect(sendButton.classList.remove).toHaveBeenCalledWith('disabled');
    });

    test('should disable send button', () => {
      const sendButton = { ...mockElement, disabled: false };
      mockDocument.getElementById.mockReturnValue(sendButton);

      uiManager.disableSendButton();

      expect(sendButton.disabled).toBe(true);
      expect(sendButton.classList.add).toHaveBeenCalledWith('disabled');
    });

    test('should set button loading state', () => {
      const sendButton = { ...mockElement };
      mockDocument.getElementById.mockReturnValue(sendButton);

      uiManager.setButtonLoading(true);

      expect(sendButton.classList.add).toHaveBeenCalledWith('loading');
      expect(sendButton.disabled).toBe(true);
    });

    test('should remove button loading state', () => {
      const sendButton = { ...mockElement };
      mockDocument.getElementById.mockReturnValue(sendButton);

      uiManager.setButtonLoading(false);

      expect(sendButton.classList.remove).toHaveBeenCalledWith('loading');
      expect(sendButton.disabled).toBe(false);
    });
  });

  describe('Loading and Status Indicators', () => {
    test('should show loading indicator', () => {
      const loadingIndicator = { ...mockElement, hidden: true };
      mockDocument.getElementById.mockReturnValue(loadingIndicator);

      uiManager.showLoading();

      expect(loadingIndicator.hidden).toBe(false);
      expect(loadingIndicator.classList.remove).toHaveBeenCalledWith('hidden');
    });

    test('should hide loading indicator', () => {
      const loadingIndicator = { ...mockElement, hidden: false };
      mockDocument.getElementById.mockReturnValue(loadingIndicator);

      uiManager.hideLoading();

      expect(loadingIndicator.hidden).toBe(true);
      expect(loadingIndicator.classList.add).toHaveBeenCalledWith('hidden');
    });

    test('should show typing indicator', () => {
      const typingIndicator = { ...mockElement, hidden: true };
      mockDocument.getElementById.mockImplementation((id) => {
        if (id === 'typing-indicator') return typingIndicator;
        return mockElement;
      });

      uiManager.showTypingIndicator();

      expect(typingIndicator.hidden).toBe(false);
    });

    test('should hide typing indicator', () => {
      const typingIndicator = { ...mockElement, hidden: false };
      mockDocument.getElementById.mockImplementation((id) => {
        if (id === 'typing-indicator') return typingIndicator;
        return mockElement;
      });

      uiManager.hideTypingIndicator();

      expect(typingIndicator.hidden).toBe(true);
    });
  });

  describe('Focus Management', () => {
    test('should focus user input when enabled', () => {
      uiManager.updateConfig({ enableAutoFocus: true });

      const inputElement = { ...mockElement };
      mockDocument.getElementById.mockReturnValue(inputElement);

      uiManager.focusInput();

      expect(inputElement.focus).toHaveBeenCalled();
    });

    test('should not focus input when disabled', () => {
      uiManager.updateConfig({ enableAutoFocus: false });

      const inputElement = { ...mockElement };
      mockDocument.getElementById.mockReturnValue(inputElement);

      uiManager.focusInput();

      expect(inputElement.focus).not.toHaveBeenCalled();
    });

    test('should check if input is focused', () => {
      global.document.activeElement = { id: 'user-input' };

      const isFocused = uiManager.isInputFocused();

      expect(isFocused).toBe(true);
    });

    test('should blur input', () => {
      const inputElement = { ...mockElement };
      mockDocument.getElementById.mockReturnValue(inputElement);

      uiManager.blurInput();

      expect(inputElement.blur).toHaveBeenCalled();
    });
  });

  describe('Event Handling', () => {
    test('should add event listeners for input events', () => {
      const inputElement = { ...mockElement };
      const sendButton = { ...mockElement };
      mockDocument.getElementById.mockImplementation((id) => {
        if (id === 'user-input') return inputElement;
        if (id === 'send-button') return sendButton;
        return mockElement;
      });

      uiManager.setupEventListeners();

      expect(inputElement.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(inputElement.addEventListener).toHaveBeenCalledWith('input', expect.any(Function));
      expect(sendButton.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    });

    test('should handle Enter key to send message', () => {
      const inputElement = { ...mockElement, value: 'Hello world' };
      mockDocument.getElementById.mockReturnValue(inputElement);

      let callback;
      inputElement.addEventListener.mockImplementation((event, cb) => {
        if (event === 'keydown') callback = cb;
      });

      uiManager.setupEventListeners();

      // Simulate Enter key press
      const enterEvent = {
        key: 'Enter',
        shiftKey: false,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn()
      };

      callback(enterEvent);

      expect(enterEvent.preventDefault).toHaveBeenCalled();
      expect(enterEvent.stopPropagation).toHaveBeenCalled();
    });

    test('should handle Shift+Enter for new line', () => {
      const inputElement = { ...mockElement, value: 'Hello\nworld' };
      mockDocument.getElementById.mockReturnValue(inputElement);

      let callback;
      inputElement.addEventListener.mockImplementation((event, cb) => {
        if (event === 'keydown') callback = cb;
      });

      uiManager.setupEventListeners();

      // Simulate Shift+Enter
      const shiftEnterEvent = {
        key: 'Enter',
        shiftKey: true,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn()
      };

      callback(shiftEnterEvent);

      expect(shiftEnterEvent.preventDefault).not.toHaveBeenCalled();
    });

    test('should remove event listeners', () => {
      const inputElement = { ...mockElement };
      mockDocument.getElementById.mockReturnValue(inputElement);

      uiManager.setupEventListeners();
      uiManager.removeEventListeners();

      expect(inputElement.removeEventListener).toHaveBeenCalled();
    });
  });

  describe('Keyboard Shortcuts', () => {
    test('should handle keyboard shortcuts when enabled', () => {
      uiManager.updateConfig({ enableKeyboardShortcuts: true });

      let callback;
      mockDocument.addEventListener.mockImplementation((event, cb) => {
        if (event === 'keydown') callback = cb;
      });

      uiManager.setupKeyboardShortcuts();

      // Simulate Ctrl+K shortcut
      const ctrlKEvent = {
        ctrlKey: true,
        key: 'k',
        preventDefault: jest.fn()
      };

      callback(ctrlKEvent);

      expect(ctrlKEvent.preventDefault).toHaveBeenCalled();
    });

    test('should ignore keyboard shortcuts when disabled', () => {
      uiManager.updateConfig({ enableKeyboardShortcuts: false });

      uiManager.setupKeyboardShortcuts();

      expect(mockDocument.addEventListener).not.toHaveBeenCalledWith('keydown', expect.any(Function));
    });
  });

  describe('State Management', () => {
    test('should update UI state', () => {
      uiManager.setState('loading', true);

      expect(uiManager.state.loading).toBe(true);
    });

    test('should get UI state', () => {
      uiManager.state.loading = true;
      uiManager.state.typing = false;

      const state = uiManager.getState();

      expect(state.loading).toBe(true);
      expect(state.typing).toBe(false);
    });

    test('should reset UI state', () => {
      uiManager.state.loading = true;
      uiManager.state.typing = true;

      uiManager.resetState();

      expect(uiManager.state.loading).toBe(false);
      expect(uiManager.state.typing).toBe(false);
    });
  });

  describe('Animation and Transitions', () => {
    test('should add animation class with callback', () => {
      const element = { ...mockElement };
      const callback = jest.fn();

      uiManager.addAnimation(element, 'fade-in', callback);

      expect(element.classList.add).toHaveBeenCalledWith('fade-in');

      // Simulate animation end
      const animationEvent = { type: 'animationend' };
      element.addEventListener.mock.calls[0][1](animationEvent);

      expect(element.classList.remove).toHaveBeenCalledWith('fade-in');
      expect(callback).toHaveBeenCalled();
    });

    test('should show element with animation', () => {
      const element = { ...mockElement, hidden: true };
      uiManager.updateConfig({ enableAnimations: true });

      uiManager.showElement(element);

      expect(element.hidden).toBe(false);
      expect(element.classList.add).toHaveBeenCalledWith('fade-in');
    });

    test('should show element without animation when disabled', () => {
      const element = { ...mockElement, hidden: true };
      uiManager.updateConfig({ enableAnimations: false });

      uiManager.showElement(element);

      expect(element.hidden).toBe(false);
      expect(element.classList.add).not.toHaveBeenCalledWith('fade-in');
    });
  });

  describe('Modal and Dialog Management', () => {
    test('should create modal overlay', () => {
      const modalContent = { ...mockElement };
      const modal = uiManager.createModal(modalContent);

      expect(modal.className).toContain('modal-overlay');
      expect(modal.appendChild).toHaveBeenCalledWith(modalContent);
    });

    test('should show modal', () => {
      const modal = { ...mockElement, hidden: true };
      const overlay = { ...mockElement, hidden: true };

      uiManager.showModal(modal, overlay);

      expect(modal.hidden).toBe(false);
      expect(overlay.hidden).toBe(false);
    });

    test('should hide modal', () => {
      const modal = { ...mockElement, hidden: false };
      const overlay = { ...mockElement, hidden: false };

      uiManager.hideModal(modal, overlay);

      expect(modal.hidden).toBe(true);
      expect(overlay.hidden).toBe(true);
    });
  });

  describe('Toast Notifications', () => {
    test('should create toast notification', () => {
      const toast = uiManager.createToast('Success message', 'success');

      expect(toast.className).toContain('toast');
      expect(toast.className).toContain('success');
      expect(toast.textContent).toBe('Success message');
    });

    test('should show toast notification', () => {
      const toast = { ...mockElement };
      const container = { ...mockElement };
      mockDocument.getElementById.mockReturnValue(container);

      uiManager.showToast(toast);

      expect(container.appendChild).toHaveBeenCalledWith(toast);
    });

    test('should auto-remove toast after delay', () => {
      const toast = { ...mockElement };
      const container = {
        ...mockElement,
        removeChild: jest.fn()
      };
      mockDocument.getElementById.mockReturnValue(container);

      uiManager.showToast(toast, 1000);

      expect(container.removeChild).not.toHaveBeenCalled();

      // Fast forward time
      jest.advanceTimersByTime(1000);

      expect(container.removeChild).toHaveBeenCalledWith(toast);
    });
  });

  describe('Responsive Design', () => {
    test('should detect mobile viewport', () => {
      global.innerWidth = 500;

      const isMobile = uiManager.isMobile();

      expect(isMobile).toBe(true);
    });

    test('should detect desktop viewport', () => {
      global.innerWidth = 1200;

      const isMobile = uiManager.isMobile();

      expect(isMobile).toBe(false);
    });

    test('should handle window resize events', () => {
      let resizeCallback;
      mockWindow.addEventListener.mockImplementation((event, cb) => {
        if (event === 'resize') resizeCallback = cb;
      });

      uiManager.setupResponsiveHandling();

      // Simulate resize
      resizeCallback();

      expect(uiManager.state.isMobile).toBeDefined();
    });
  });

  describe('Accessibility', () => {
    test('should announce screen reader messages', () => {
      const ariaLiveRegion = { ...mockElement, textContent: '' };
      mockDocument.getElementById.mockImplementation((id) => {
        if (id === 'aria-live-region') return ariaLiveRegion;
        return mockElement;
      });

      uiManager.announceToScreenReader('Message sent');

      expect(ariaLiveRegion.textContent).toBe('Message sent');
    });

    test('should set ARIA attributes', () => {
      const element = { ...mockElement };

      uiManager.setAriaAttributes(element, {
        role: 'button',
        'aria-label': 'Send message',
        'aria-expanded': 'false'
      });

      expect(element.setAttribute).toHaveBeenCalledWith('role', 'button');
      expect(element.setAttribute).toHaveBeenCalledWith('aria-label', 'Send message');
      expect(element.setAttribute).toHaveBeenCalledWith('aria-expanded', 'false');
    });

    test('should manage focus trap for modals', () => {
      const modal = { ...mockElement };
      const firstFocusable = { ...mockElement };
      const lastFocusable = { ...mockElement };

      modal.querySelectorAll = jest.fn()
        .mockReturnValueOnce([firstFocusable])
        .mockReturnValueOnce([lastFocusable]);

      uiManager.trapFocus(modal);

      expect(firstFocusable.focus).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle missing DOM elements gracefully', () => {
      mockDocument.getElementById.mockReturnValue(null);

      expect(() => {
        uiManager.getUserInput();
        uiManager.enableSendButton();
        uiManager.showLoading();
      }).not.toThrow();

      expect(console.warn).toHaveBeenCalledTimes(3);
    });

    test('should validate configuration', () => {
      const invalidConfig = {
        debounceDelay: -100,
        enableAnimations: 'not-a-boolean'
      };

      expect(() => {
        uiManager.updateConfig(invalidConfig);
      }).not.toThrow();

      expect(uiManager.config.debounceDelay).toBeGreaterThanOrEqual(0);
      expect(typeof uiManager.config.enableAnimations).toBe('boolean');
    });
  });

  describe('Cleanup and Memory Management', () => {
    test('should cleanup all event listeners', () => {
      const inputElement = { ...mockElement };
      mockDocument.getElementById.mockReturnValue(inputElement);

      uiManager.setupEventListeners();
      uiManager.cleanup();

      expect(inputElement.removeEventListener).toHaveBeenCalled();
    });

    test('should clear timeouts and intervals', () => {
      clearTimeout = jest.fn();
      clearInterval = jest.fn();

      uiManager.state.timeouts = [123, 456];
      uiManager.state.intervals = [789];

      uiManager.cleanup();

      expect(clearTimeout).toHaveBeenCalledWith(123);
      expect(clearTimeout).toHaveBeenCalledWith(456);
      expect(clearInterval).toHaveBeenCalledWith(789);
    });
  });
});