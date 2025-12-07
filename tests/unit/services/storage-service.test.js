/**
 * Unit Tests for StorageService
 * Tests Chrome storage operations with error handling, profile management, options
 */

const {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
  wrapAsync,
} = require('../../mocks/error-handler.mock.js');

describe('StorageService', () => {
  let storageService;
  let mockChromeStorageLocal;
  let mockChromeStorageSync;

  beforeEach(() => {
    jest.clearAllMocks();
    storageService = new StorageService();

    mockChromeStorageLocal = {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn(),
    };

    mockChromeStorageSync = {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn(),
    };

    global.chrome = {
      storage: {
        local: mockChromeStorageLocal,
        sync: mockChromeStorageSync,
      },
      runtime: {
        lastError: null,
      },
    };
  });

  describe('Basic Storage Operations', () => {
    test('should get data from local storage', async () => {
      mockChromeStorageLocal.get.mockImplementation((keys, callback) => {
        callback({ testKey: 'testValue' });
      });

      const result = await storageService.getLocal('testKey');

      expect(result).toEqual({ testKey: 'testValue' });
      expect(mockChromeStorageLocal.get).toHaveBeenCalledWith('testKey', expect.any(Function));
    });

    test('should set data in local storage', async () => {
      mockChromeStorageLocal.set.mockImplementation((items, callback) => {
        callback();
      });

      await storageService.setLocal({ newKey: 'newValue' });

      expect(mockChromeStorageLocal.set).toHaveBeenCalledWith(
        { newKey: 'newValue' },
        expect.any(Function)
      );
    });

    test('should remove data from local storage', async () => {
      mockChromeStorageLocal.remove.mockImplementation((keys, callback) => {
        callback();
      });

      await storageService.removeLocal('removeKey');

      expect(mockChromeStorageLocal.remove).toHaveBeenCalledWith('removeKey', expect.any(Function));
    });

    test('should handle storage errors gracefully', async () => {
      mockChromeStorageLocal.get.mockImplementation((keys, callback) => {
        global.chrome.runtime.lastError = { message: 'Storage quota exceeded' };
        callback();
      });

      await expect(storageService.getLocal('errorKey')).rejects.toThrow('Storage get failed');
      expect(errorHandler.handle).toHaveBeenCalled();
    });
  });

  describe('Profile Management', () => {
    test('should get profiles', async () => {
      mockChromeStorageLocal.get.mockImplementation((keys, callback) => {
        callback({ profiles: [{ id: 'test', name: 'Test Profile' }] });
      });

      const profiles = await storageService.getProfiles();

      expect(profiles).toEqual([{ id: 'test', name: 'Test Profile' }]);
    });

    test('should return empty array if no profiles', async () => {
      mockChromeStorageLocal.get.mockImplementation((keys, callback) => {
        callback({});
      });

      const profiles = await storageService.getProfiles();
      expect(profiles).toEqual([]);
    });

    test('should save profiles', async () => {
      mockChromeStorageLocal.set.mockImplementation((items, callback) => callback());

      await storageService.saveProfiles([{ id: 'new', name: 'New' }]);

      expect(mockChromeStorageLocal.set).toHaveBeenCalledWith(
        { profiles: [{ id: 'new', name: 'New' }] },
        expect.any(Function)
      );
    });

    test('should get/set last selected profile ID', async () => {
      mockChromeStorageLocal.get.mockImplementation((keys, callback) => {
        callback({ lastSelectedProfileId: 'selected' });
      });

      const profileId = await storageService.getLastSelectedProfileId();
      expect(profileId).toBe('selected');

      mockChromeStorageLocal.set.mockImplementation((items, callback) => callback());
      await storageService.setLastSelectedProfileId('new-selected');
      expect(mockChromeStorageLocal.set).toHaveBeenCalledWith({
        lastSelectedProfileId: 'new-selected',
      });
    });
  });

  describe('Tool Definitions', () => {
    test('should get tool definitions', async () => {
      mockChromeStorageLocal.get.mockImplementation((keys, callback) => {
        callback({ promptPaulTools: [{ name: 'test-tool' }] });
      });

      const tools = await storageService.getToolDefinitions();
      expect(tools).toEqual([{ name: 'test-tool' }]);
    });

    test('should save tool definitions', async () => {
      mockChromeStorageLocal.set.mockImplementation((items, callback) => callback());

      await storageService.saveToolDefinitions([{ name: 'new-tool' }]);
      expect(mockChromeStorageLocal.set).toHaveBeenCalledWith({
        promptPaulTools: [{ name: 'new-tool' }],
      });
    });
  });

  describe('Custom Instructions', () => {
    test('should get/save image custom instructions', async () => {
      mockChromeStorageLocal.get.mockImplementation((keys, callback) => {
        callback({ imageCustomInstructions: [{ text: 'Analyze' }] });
      });

      const instructions = await storageService.getImageCustomInstructions();
      expect(instructions).toEqual([{ text: 'Analyze' }]);

      mockChromeStorageLocal.set.mockImplementation((items, callback) => callback());
      await storageService.saveImageCustomInstructions([{ text: 'New' }]);
      expect(mockChromeStorageLocal.set).toHaveBeenCalledWith({
        imageCustomInstructions: [{ text: 'New' }],
      });
    });

    test('should get/save general custom instructions', async () => {
      mockChromeStorageLocal.get.mockImplementation((keys, callback) => {
        callback({ generalCustomInstructions: [{ text: 'General' }] });
      });

      const instructions = await storageService.getGeneralCustomInstructions();
      expect(instructions).toEqual([{ text: 'General' }]);
    });
  });

  describe('Options Management', () => {
    test('should get options with defaults', async () => {
      mockChromeStorageSync.get.mockImplementation((keys, callback) => {
        callback({ enableStreaming: true });
      });

      const options = await storageService.getOptions();
      expect(options.enableStreaming).toBe(true);
      expect(options.theme).toBe('auto');
    });

    test('should save options', async () => {
      mockChromeStorageSync.set.mockImplementation((items, callback) => callback());

      await storageService.saveOptions({ enableStreaming: true, theme: 'dark' });
      expect(mockChromeStorageSync.set).toHaveBeenCalledWith({
        enableStreaming: true,
        theme: 'dark',
      });
    });

    test('should get/set streaming enabled', async () => {
      mockChromeStorageSync.get.mockImplementation((keys, callback) =>
        callback({ enableStreaming: false })
      );
      const enabled = await storageService.getStreamingEnabled();
      expect(enabled).toBe(false);

      mockChromeStorageSync.set.mockImplementation((items, callback) => callback());
      await storageService.setStreamingEnabled(true);
      expect(mockChromeStorageSync.set).toHaveBeenCalledWith({ enableStreaming: true });
    });
  });

  describe('Default LLM Endpoint', () => {
    test('should get/set default LLM endpoint', async () => {
      mockChromeStorageLocal.get.mockImplementation((keys, callback) =>
        callback({ defaultLlmEndpoint: 'https://default.com' })
      );
      const endpoint = await storageService.getDefaultLlmEndpoint();
      expect(endpoint).toBe('https://default.com');

      mockChromeStorageLocal.set.mockImplementation((items, callback) => callback());
      await storageService.setDefaultLlmEndpoint('https://new.com');
      expect(mockChromeStorageLocal.set).toHaveBeenCalledWith({
        defaultLlmEndpoint: 'https://new.com',
      });
    });
  });

  describe('Export/Import Settings', () => {
    test('should export all settings', async () => {
      mockChromeStorageLocal.get.mockImplementation((keys, callback) => {
        if (keys.includes('profiles')) callback({ profiles: [{ id: 'test' }] });
        else if (keys.includes('promptPaulTools')) callback({ promptPaulTools: [] });
        else callback({});
      });

      mockChromeStorageSync.get.mockImplementation((keys, callback) => callback({}));

      const settings = await storageService.exportSettings();

      expect(settings.profiles).toEqual([{ id: 'test' }]);
      expect(settings.exportDate).toBeDefined();
      expect(settings.version).toBe('1.0');
    });

    test('should import settings', async () => {
      const mockSettings = {
        profiles: [{ id: 'imported' }],
        promptPaulTools: [{ name: 'imported-tool' }],
        options: { theme: 'light' },
      };

      // Mock all save methods
      const saveProfilesSpy = jest.spyOn(storageService, 'saveProfiles').mockResolvedValue();
      const saveToolDefinitionsSpy = jest
        .spyOn(storageService, 'saveToolDefinitions')
        .mockResolvedValue();
      const saveOptionsSpy = jest.spyOn(storageService, 'saveOptions').mockResolvedValue();

      await storageService.importSettings(mockSettings);

      expect(saveProfilesSpy).toHaveBeenCalledWith([{ id: 'imported' }]);
      expect(saveToolDefinitionsSpy).toHaveBeenCalledWith([{ name: 'imported-tool' }]);
      expect(saveOptionsSpy).toHaveBeenCalledWith({ theme: 'light' });
    });
  });

  describe('Storage Usage', () => {
    test('should get storage usage information', async () => {
      mockChromeStorageLocal.get.mockImplementation((keys, callback) =>
        callback({ key1: 'value1' })
      );
      mockChromeStorageSync.get.mockImplementation((keys, callback) =>
        callback({ key2: 'value2' })
      );

      const usage = await storageService.getStorageUsage();

      expect(usage.localSize).toBeGreaterThan(0);
      expect(usage.syncSize).toBeGreaterThan(0);
      expect(usage.localKeys).toBeGreaterThan(0);
    });

    test('should handle storage usage errors gracefully', async () => {
      mockChromeStorageLocal.get.mockRejectedValue(new Error('Storage error'));

      const usage = await storageService.getStorageUsage();
      expect(usage.localSize).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle sync storage errors', async () => {
      mockChromeStorageSync.get.mockImplementation((keys, callback) => {
        global.chrome.runtime.lastError = { message: 'Sync quota exceeded' };
        callback();
      });

      await expect(storageService.getSync('test')).rejects.toThrow('Storage get failed');
      expect(errorHandler.handle).toHaveBeenCalled();
    });
  });
});
