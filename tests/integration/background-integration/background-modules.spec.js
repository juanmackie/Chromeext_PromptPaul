/**
 * Background Integration Tests
 * Tests interactions between background modules: ContextMenuManager, MediaProcessor, ApiHandler
 * Uses minimal mocking to test real module interactions
 */

const { ContextMenuManager } = require('../../../background/context-menu-manager.js');
const { MediaProcessor } = require('../../../background/media-processor.js');
const { ApiHandler } = require('../../../background/api-handler.js');
const { errorHandler } = require('../../../mocks/error-handler.mock.js');
const analytics = require('../../../mocks/analytics.mock.js');

// Mock chrome APIs for integration tests
const mockChrome = {
  contextMenus: {
    create: jest.fn(),
    remove: jest.fn(),
    getAll: jest.fn(),
  },
  sidePanel: {
    open: jest.fn(),
  },
  runtime: {
    sendMessage: jest.fn().mockResolvedValue(true),
    lastError: null,
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
    },
  },
};
global.chrome = mockChrome;

describe('Background Module Integration', () => {
  let contextMenuManager;
  let mediaProcessor;
  let apiHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    contextMenuManager = new ContextMenuManager();
    mediaProcessor = new MediaProcessor();
    apiHandler = new ApiHandler();

    // Mock dependencies for integration
    contextMenuManager.updateImageCustomInstructions = jest.fn().mockResolvedValue();
    mediaProcessor.fetchMediaAsBase64 = jest.fn().mockResolvedValue('mock-base64-data');
    apiHandler.validateConfig = jest.fn().mockResolvedValue({ modelName: 'test' });
    apiHandler.getAllToolDefinitions = jest.fn().mockResolvedValue([]);
  });

  describe('ContextMenuManager + MediaProcessor Integration', () => {
    test('should handle menu click -> media processing -> message dispatch flow', async () => {
      const mockInfo = {
        menuItemId: 'analyzeImage',
        srcUrl: 'https://example.com/test.jpg',
      };
      const mockTab = { id: 123 };

      await contextMenuManager.handleMenuClick(mockInfo, mockTab, mediaProcessor);

      // Verify flow: open side panel -> fetch media -> send message
      expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 123 });
      expect(mediaProcessor.fetchMediaAsBase64).toHaveBeenCalledWith(
        'https://example.com/test.jpg'
      );
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'setMediaForAnalysis',
          mediaData: expect.objectContaining({
            base64: 'mock-base64-data',
            url: 'https://example.com/test.jpg',
            mimeType: expect.any(String),
            loading: false,
          }),
        })
      );
      expect(analytics.trackContextMenuClick).toHaveBeenCalled();
    });

    test('should handle different media types through full flow', async () => {
      const testCases = [
        { url: 'https://example.com/image.jpg', expectedMime: 'image/jpeg' },
        { url: 'https://example.com/video.mp4', expectedMime: 'video/mp4' },
        { url: 'https://example.com/audio.mp3', expectedMime: 'audio/mpeg' },
      ];

      for (const testCase of testCases) {
        jest.clearAllMocks();
        const mockInfo = { menuItemId: 'analyzeImage', srcUrl: testCase.url };
        const mockTab = { id: 123 };

        await contextMenuManager.handleMenuClick(mockInfo, mockTab, mediaProcessor);

        expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(
          expect.objectContaining({
            mediaData: expect.objectContaining({
              mimeType: testCase.expectedMime,
            }),
          })
        );
      }
    });

    test('should recover from media fetch error and send error to UI', async () => {
      mediaProcessor.fetchMediaAsBase64.mockRejectedValueOnce(new Error('Fetch failed'));

      const mockInfo = { menuItemId: 'analyzeImage', srcUrl: 'https://fail.com/image.jpg' };
      const mockTab = { id: 123 };

      await expect(
        contextMenuManager.handleMenuClick(mockInfo, mockTab, mediaProcessor)
      ).rejects.toThrow('Fetch failed');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'setMediaForAnalysis',
          mediaData: expect.objectContaining({
            error: expect.stringContaining('Fetch failed'),
          }),
        })
      );
      expect(errorHandler.handle).toHaveBeenCalled();
    });
  });

  describe('ApiHandler Integration with Dependencies', () => {
    test('should integrate config validation -> tool definitions -> API call', async () => {
      // Mock apiClient for integration test
      const mockApiClient = require('../../../services/api-client.js').apiClient;
      mockApiClient.makeStreamingRequest.mockResolvedValue();

      await apiHandler.makeLlmApiRequest('test prompt', '123');

      expect(apiHandler.validateConfig).toHaveBeenCalled();
      expect(apiHandler.getAllToolDefinitions).toHaveBeenCalled();
      expect(apiHandler.getStreamingSettings).toHaveBeenCalled();
      expect(mockApiClient.makeStreamingRequest).toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          action: 'streamApiEnd',
        })
      );
    });

    test('should handle configuration error during integration', async () => {
      const configError = new Error(
        'LLM API endpoint is missing or invalid. Please configure it in the options page.'
      );
      apiHandler.validateConfig.mockRejectedValueOnce(configError);

      await apiHandler.makeLlmApiRequest('test prompt', '123');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'displayErrorInChat',
          errorMessage: expect.stringContaining('LLM API endpoint'),
        })
      );
    });
  });

  describe('Full Background Module Chain: ContextMenu -> Media -> API Prep', () => {
    test('should execute complete flow: menu click -> media process -> API prep message', async () => {
      // Setup mocks for full chain
      const mockInfo = { menuItemId: 'analyzeImage', srcUrl: 'https://chain.com/image.jpg' };
      const mockTab = { id: 123 };

      // The flow relies on runtime.sendMessage for API prep, which we mock to succeed
      await contextMenuManager.handleMenuClick(mockInfo, mockTab, mediaProcessor);

      // Verify end-to-end: media processed and API-ready message sent
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2); // loading + final
      const finalMessage = chrome.runtime.sendMessage.mock.calls[1][0];
      expect(finalMessage.action).toBe('setMediaForAnalysis');
      expect(finalMessage.mediaData.loading).toBe(false);
      expect(finalMessage.mediaData.base64).toBe('mock-base64-data');
    });
  });

  describe('Error Recovery Across Modules', () => {
    test('should handle sidePanel failure but continue media processing', async () => {
      chrome.sidePanel.open.mockRejectedValueOnce(new Error('Side panel unavailable'));

      const mockInfo = { menuItemId: 'analyzeImage', srcUrl: 'https://error.com/image.jpg' };
      const mockTab = { id: 123 };

      await expect(
        contextMenuManager.handleMenuClick(mockInfo, mockTab, mediaProcessor)
      ).rejects.toThrow('Side panel unavailable');

      expect(errorHandler.handle).toHaveBeenCalled();
      expect(mediaProcessor.fetchMediaAsBase64).toHaveBeenCalled(); // Still attempts media fetch
    });
  });
});
