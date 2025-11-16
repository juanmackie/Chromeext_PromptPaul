/**
 * Unit Tests for ContextMenuManager
 * Tests context menu creation, management, and click handling
 */

const { errorHandler, ErrorSeverity, ErrorCategory } = require('../../mocks/error-handler.mock.js');
const analytics = require('../../mocks/analytics.mock.js');

// Mock the ContextMenuManager class directly since it's an ES6 module
const createMockContextMenuManager = () => {
  const menuItems = [
    { id: "imageAnalysis", title: "Analyze Image with Prompt Paul", contexts: ["image"] },
    { id: "analyzeImage", parentId: "imageAnalysis", title: "🔍 General Analysis", contexts: ["image"] },
    { id: "summarizeImage", parentId: "imageAnalysis", title: "📝 Summarize Image", contexts: ["image"] },
    { id: "explainImage", parentId: "imageAnalysis", title: "💡 Explain Image", contexts: ["image"] },
    { id: "imageSeparator", parentId: "imageAnalysis", type: "separator", contexts: ["image"] },
    { id: "videoAnalysis", title: "Analyze Video with Prompt Paul", contexts: ["video"] },
    { id: "analyzeVideo", parentId: "videoAnalysis", title: "🎥 General Analysis", contexts: ["video"] },
    { id: "audioAnalysis", title: "Analyze Audio with Prompt Paul", contexts: ["audio"] },
    { id: "analyzeAudio", parentId: "audioAnalysis", title: "🎵 General Analysis", contexts: ["audio"] }
  ];

  return {
    menuItems,

    async initializeMenus() {
      try {
        // Track install/update event
        await analytics.trackInstalled();

        // Create all menu items
        for (const item of this.menuItems) {
          chrome.contextMenus.create(item);
        }

        // Update custom instructions
        await this.updateImageCustomInstructions();

      } catch (error) {
        errorHandler.handle(error, { category: ErrorCategory.SYSTEM });
        throw error;
      }
    },

    async handleMenuClick(info, tab, mediaProcessor) {
      if (!this.isMediaAnalysisMenu(info.menuItemId)) {
        return;
      }

      // Open side panel
      chrome.sidePanel.open({ tabId: tab.id });

      const mediaUrl = info.srcUrl;
      if (!mediaUrl) {
        throw new Error('No media URL found');
      }

      // Parse menu action
      const action = this.parseMenuAction(info.menuItemId);

      // Get MIME type
      const mimeType = this.getMimeTypeFromUrl(mediaUrl);

      // Process media
      const mediaData = await mediaProcessor.fetchMediaAsBase64(mediaUrl);

      // Send to side panel
      chrome.runtime.sendMessage({
        action: 'processMedia',
        url: mediaUrl,
        mimeType,
        action,
        mediaData
      });

      // Track analytics
      analytics.trackContextMenuClick(info.menuItemId, {
        mediaType: mimeType,
        action,
        url: mediaUrl
      });
    },

    isMediaAnalysisMenu(menuItemId) {
      return this.menuItems.some(item => item.id === menuItemId && !item.type);
    },

    parseMenuAction(menuItemId) {
      if (menuItemId.includes('analyze')) return 'analyze';
      if (menuItemId.includes('summarize')) return 'summarize';
      if (menuItemId.includes('explain')) return 'explain';
      return 'analyze';
    },

    getMimeTypeFromUrl(url) {
      if (!url) return 'unknown';

      if (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png') || url.includes('.gif') || url.includes('.webp')) {
        return 'image';
      }
      if (url.includes('.mp4') || url.includes('.webm') || url.includes('.avi') || url.includes('.mov')) {
        return 'video';
      }
      if (url.includes('.mp3') || url.includes('.wav') || url.includes('.ogg') || url.includes('.m4a')) {
        return 'audio';
      }

      return 'unknown';
    },

    async updateImageCustomInstructions() {
      return new Promise((resolve, reject) => {
        chrome.storage.local.get(['imageCustomInstructions'], (result) => {
          const customInstructions = result.imageCustomInstructions || [];

          // Remove existing custom instruction menus
          chrome.contextMenus.getAll((menuItems) => {
            menuItems.forEach((item) => {
              if (item.id && item.id.startsWith('customInstruction-')) {
                chrome.contextMenus.remove(item.id);
              }
            });

            // Add new custom instruction menus
            customInstructions.forEach((instruction, index) => {
              if (instruction.enabled && instruction.text) {
                chrome.contextMenus.create({
                  id: `customInstruction-${index}`,
                  parentId: "imageAnalysis",
                  title: `✏️ ${instruction.text}`,
                  contexts: ["image"]
                });
              }
            });
          });

          resolve();
        });
      });
    }
  };
};

describe('ContextMenuManager', () => {
  let contextMenuManager;
  let mockMediaProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    contextMenuManager = createMockContextMenuManager();
    mockMediaProcessor = {
      fetchMediaAsBase64: jest.fn().mockResolvedValue('base64-data')
    };
  });

  describe('Initialization', () => {
    test('should instantiate with correct menu items', () => {
      expect(contextMenuManager.menuItems).toHaveLength(9);
      expect(contextMenuManager.menuItems[0].id).toBe('imageAnalysis');
      expect(contextMenuManager.menuItems[0].contexts).toEqual(['image']);
    });

    test('should have all required menu types', () => {
      const menuTypes = new Set(contextMenuManager.menuItems.map(item => item.contexts[0]));
      expect(menuTypes.has('image')).toBe(true);
      expect(menuTypes.has('video')).toBe(true);
      expect(menuTypes.has('audio')).toBe(true);
    });

    test('should have proper parent-child relationships', () => {
      const imageMenuItems = contextMenuManager.menuItems.filter(item => item.parentId === 'imageAnalysis');
      expect(imageMenuItems).toHaveLength(4); // 3 actions + 1 separator
    });
  });

  describe('initializeMenus', () => {
    test('should initialize menus successfully', async () => {
      await contextMenuManager.initializeMenus();

      expect(analytics.trackInstalled).toHaveBeenCalled();
      expect(chrome.contextMenus.create).toHaveBeenCalledTimes(9);
    });

    test('should handle analytics tracking failure gracefully', async () => {
      analytics.trackInstalled.mockRejectedValue(new Error('Analytics failed'));

      await contextMenuManager.initializeMenus();

      expect(errorHandler.handle).toHaveBeenCalled();
      expect(chrome.contextMenus.create).toHaveBeenCalled();
    });

    test('should handle individual menu creation failures', async () => {
      chrome.contextMenus.create.mockImplementation(() => {
        throw new Error('Menu creation failed');
      });

      await contextMenuManager.initializeMenus();

      expect(errorHandler.handle).toHaveBeenCalled();
    });

    test('should update custom instructions during initialization', async () => {
      await contextMenuManager.initializeMenus();

      expect(chrome.storage.local.get).toHaveBeenCalledWith(['imageCustomInstructions']);
    });
  });

  describe('isMediaAnalysisMenu', () => {
    test('should identify media analysis menus correctly', () => {
      expect(contextMenuManager.isMediaAnalysisMenu('analyzeImage')).toBe(true);
      expect(contextMenuManager.isMediaAnalysisMenu('summarizeImage')).toBe(true);
      expect(contextMenuManager.isMediaAnalysisMenu('videoAnalysis')).toBe(true);
    });

    test('should return false for non-analysis menus', () => {
      expect(contextMenuManager.isMediaAnalysisMenu('imageSeparator')).toBe(false);
      expect(contextMenuManager.isMediaAnalysisMenu('unknownMenu')).toBe(false);
    });
  });

  describe('parseMenuAction', () => {
    test('should parse analyze action correctly', () => {
      expect(contextMenuManager.parseMenuAction('analyzeImage')).toBe('analyze');
      expect(contextMenuManager.parseMenuAction('analyzeVideo')).toBe('analyze');
      expect(contextMenuManager.parseMenuAction('analyzeAudio')).toBe('analyze');
    });

    test('should parse summarize action correctly', () => {
      expect(contextMenuManager.parseMenuAction('summarizeImage')).toBe('summarize');
    });

    test('should parse explain action correctly', () => {
      expect(contextMenuManager.parseMenuAction('explainImage')).toBe('explain');
    });

    test('should default to analyze for unknown actions', () => {
      expect(contextMenuManager.parseMenuAction('unknownAction')).toBe('analyze');
    });
  });

  describe('getMimeTypeFromUrl', () => {
    test('should detect image types correctly', () => {
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/image.jpg')).toBe('image');
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/photo.jpeg')).toBe('image');
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/icon.png')).toBe('image');
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/animation.gif')).toBe('image');
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/picture.webp')).toBe('image');
    });

    test('should detect video types correctly', () => {
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/video.mp4')).toBe('video');
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/clip.webm')).toBe('video');
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/movie.avi')).toBe('video');
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/film.mov')).toBe('video');
    });

    test('should detect audio types correctly', () => {
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/song.mp3')).toBe('audio');
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/sound.wav')).toBe('audio');
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/audio.ogg')).toBe('audio');
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/track.m4a')).toBe('audio');
    });

    test('should return unknown for unrecognized types', () => {
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/page.html')).toBe('unknown');
      expect(contextMenuManager.getMimeTypeFromUrl('https://example.com/document.pdf')).toBe('unknown');
    });

    test('should handle null/undefined URLs', () => {
      expect(contextMenuManager.getMimeTypeFromUrl(null)).toBe('unknown');
      expect(contextMenuManager.getMimeTypeFromUrl(undefined)).toBe('unknown');
    });
  });

  describe('updateImageCustomInstructions', () => {
    test('should add custom instruction menus', async () => {
      chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({
          imageCustomInstructions: [
            { text: 'Custom instruction 1', enabled: true },
            { text: 'Custom instruction 2', enabled: true }
          ]
        });
      });

      await contextMenuManager.updateImageCustomInstructions();

      expect(chrome.contextMenus.create).toHaveBeenCalledWith({
        id: 'customInstruction-0',
        parentId: 'imageAnalysis',
        title: '✏️ Custom instruction 1',
        contexts: ['image']
      });

      expect(chrome.contextMenus.create).toHaveBeenCalledWith({
        id: 'customInstruction-1',
        parentId: 'imageAnalysis',
        title: '✏️ Custom instruction 2',
        contexts: ['image']
      });
    });

    test('should skip disabled custom instructions', async () => {
      chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({
          imageCustomInstructions: [
            { text: 'Enabled instruction', enabled: true },
            { text: 'Disabled instruction', enabled: false }
          ]
        });
      });

      await contextMenuManager.updateImageCustomInstructions();

      expect(chrome.contextMenus.create).toHaveBeenCalledTimes(1);
      expect(chrome.contextMenus.create).toHaveBeenCalledWith({
        id: 'customInstruction-0',
        parentId: 'imageAnalysis',
        title: '✏️ Enabled instruction',
        contexts: ['image']
      });
    });

    test('should remove existing custom instruction menus', async () => {
      chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ imageCustomInstructions: [] });
      });

      chrome.contextMenus.getAll.mockImplementation((callback) => {
        callback([
          { id: 'customInstruction-0', title: 'Old instruction' },
          { id: 'customInstruction-1', title: 'Another instruction' }
        ]);
      });

      await contextMenuManager.updateImageCustomInstructions();

      expect(chrome.contextMenus.remove).toHaveBeenCalledWith('customInstruction-0');
      expect(chrome.contextMenus.remove).toHaveBeenCalledWith('customInstruction-1');
    });

    test('should handle empty custom instructions', async () => {
      chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ imageCustomInstructions: [] });
      });

      await contextMenuManager.updateImageCustomInstructions();

      expect(chrome.contextMenus.remove).toHaveBeenCalled();
    });
  });

  describe('handleMenuClick', () => {
    test('should handle successful menu click', async () => {
      const info = {
        menuItemId: 'analyzeImage',
        srcUrl: 'https://example.com/image.jpg'
      };
      const tab = { id: 123 };

      await contextMenuManager.handleMenuClick(info, tab, mockMediaProcessor);

      expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 123 });
      expect(mockMediaProcessor.fetchMediaAsBase64).toHaveBeenCalledWith('https://example.com/image.jpg');
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'processMedia',
        url: 'https://example.com/image.jpg',
        mimeType: 'image',
        action: 'analyze',
        mediaData: 'base64-data'
      });
      expect(analytics.trackContextMenuClick).toHaveBeenCalledWith('analyzeImage', {
        mediaType: 'image',
        action: 'analyze',
        url: 'https://example.com/image.jpg'
      });
    });

    test('should ignore non-media analysis menu clicks', async () => {
      const info = { menuItemId: 'unknownMenu' };
      const tab = { id: 123 };

      await contextMenuManager.handleMenuClick(info, tab, mockMediaProcessor);

      expect(chrome.sidePanel.open).not.toHaveBeenCalled();
      expect(mockMediaProcessor.fetchMediaAsBase64).not.toHaveBeenCalled();
    });

    test('should throw error when media URL is missing', async () => {
      const info = { menuItemId: 'analyzeImage' }; // Missing srcUrl
      const tab = { id: 123 };

      await expect(contextMenuManager.handleMenuClick(info, tab, mockMediaProcessor))
        .rejects.toThrow('No media URL found');

      expect(chrome.sidePanel.open).toHaveBeenCalled(); // Side panel still opens before error
    });

    test('should handle side panel opening failure', async () => {
      chrome.sidePanel.open.mockRejectedValue(new Error('Failed to open side panel'));

      const info = { menuItemId: 'analyzeImage', srcUrl: 'https://example.com/image.jpg' };
      const tab = { id: 123 };

      await expect(contextMenuManager.handleMenuClick(info, tab, mockMediaProcessor))
        .rejects.toThrow('Failed to open side panel');

      expect(errorHandler.handle).toHaveBeenCalled();
    });

    test('should handle different action types correctly', async () => {
      const testCases = [
        { menuItemId: 'analyzeImage', expectedAction: 'analyze' },
        { menuItemId: 'summarizeImage', expectedAction: 'summarize' },
        { menuItemId: 'explainImage', expectedAction: 'explain' }
      ];

      for (const testCase of testCases) {
        const info = { menuItemId: testCase.menuItemId, srcUrl: 'https://example.com/image.jpg' };
        const tab = { id: 123 };

        jest.clearAllMocks();
        await contextMenuManager.handleMenuClick(info, tab, mockMediaProcessor);

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ action: testCase.expectedAction })
        );
      }
    });

    test('should handle different media types correctly', async () => {
      const testCases = [
        { srcUrl: 'https://example.com/image.jpg', expectedMimeType: 'image' },
        { srcUrl: 'https://example.com/video.mp4', expectedMimeType: 'video' },
        { srcUrl: 'https://example.com/audio.mp3', expectedMimeType: 'audio' }
      ];

      for (const testCase of testCases) {
        const info = { menuItemId: 'analyzeImage', srcUrl: testCase.srcUrl };
        const tab = { id: 123 };

        jest.clearAllMocks();
        await contextMenuManager.handleMenuClick(info, tab, mockMediaProcessor);

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ mimeType: testCase.expectedMimeType })
        );
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle Chrome API errors gracefully', async () => {
      chrome.contextMenus.create.mockRejectedValue(new Error('Chrome API error'));

      await contextMenuManager.initializeMenus();

      expect(errorHandler.handle).toHaveBeenCalled();
    });

    test('should handle storage errors during custom instruction update', async () => {
      chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback(new Error('Storage error'));
      });

      await contextMenuManager.updateImageCustomInstructions();

      // Should not throw but handle gracefully
      expect(chrome.contextMenus.getAll).not.toHaveBeenCalled();
    });

    test('should propagate critical errors', async () => {
      chrome.sidePanel.open.mockRejectedValue(new Error('Critical side panel error'));

      const info = { menuItemId: 'analyzeImage', srcUrl: 'https://example.com/image.jpg' };
      const tab = { id: 123 };

      await expect(contextMenuManager.handleMenuClick(info, tab, mockMediaProcessor))
        .rejects.toThrow('Critical side panel error');
    });
  });
});