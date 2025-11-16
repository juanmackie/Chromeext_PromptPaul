/**
 * Unit Tests for ConfigValidator
 * Comprehensive coverage of configuration validation, profile management, and tool definitions
 */

const { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync, handleChromeApiCall } = require('../../../mocks/error-handler.mock.js');

describe('ConfigValidator', () => {
  let configValidator;
  let mockStorageGet, mockStorageSet;

  beforeEach(() => {
    jest.clearAllMocks();
    configValidator = new ConfigValidator();

    // Mock chrome.storage.local
    mockStorageGet = jest.fn();
    mockStorageSet = jest.fn();
    global.chrome = {
      storage: {
        local: {
          get: mockStorageGet,
          set: mockStorageSet
        }
      },
      runtime: {
        lastError: null
      }
    };
  });

  describe('Constructor', () => {
    test('should initialize with default profile', () => {
      expect(configValidator.defaultProfile).toEqual({
        id: 'default',
        name: 'Default',
        llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
        apiKey: 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF',
        modelName: 'mistral-small-latest',
        maxTokens: 16000,
        systemPrompt: expect.any(String),
        lastUpdated: expect.any(String)
      });
    });
  });

  describe('validateConfig', () => {
    test('should return valid profile from storage', async () => {
      mockStorageGet.mockImplementation((keys, callback) => {
        callback({
          profiles: [{
            id: 'test',
            name: 'Test',
            llmEndpoint: 'https://api.example.com/v1/chat',
            apiKey: 'test-key',
            modelName: 'test-model',
            maxTokens: 4096
          }],
          lastSelectedProfileId: 'test',
          defaultLlmEndpoint: 'https://api.example.com/v1/chat'
        });
      });

      const profile = await configValidator.validateConfig();

      expect(profile).toEqual({
        id: 'test',
        name: 'Test',
        llmEndpoint: 'https://api.example.com/v1/chat',
        apiKey: 'test-key',
        modelName: 'test-model',
        maxTokens: 4096
      });
      expect(mockStorageGet).toHaveBeenCalledWith(['profiles', 'lastSelectedProfileId', 'defaultLlmEndpoint'], expect.any(Function));
    });

    test('should create and save default profile when none exists', async () => {
      mockStorageGet.mockImplementation((keys, callback) => {
        callback({});
      });

      mockStorageSet.mockImplementation((data, callback) => {
        callback();
      });

      const profile = await configValidator.validateConfig();

      expect(profile.id).toBe('default');
      expect(mockStorageSet).toHaveBeenCalledWith({
        profiles: expect.arrayContaining([expect.objectContaining({ id: 'default' })]),
        lastSelectedProfileId: 'default'
      });
    });

    test('should throw configuration error for invalid endpoint and no profiles', async () => {
      mockStorageGet.mockImplementation((keys, callback) => {
        callback({
          profiles: [],
          lastSelectedProfileId: null,
          defaultLlmEndpoint: 'invalid-url'
        });
      });

      await expect(configValidator.validateConfig()).rejects.toThrow('LLM API endpoint is missing or invalid');
      expect(errorHandler.handle).toHaveBeenCalled();
    });

    test('should use defaultLlmEndpoint override for selected profile', async () => {
      mockStorageGet.mockImplementation((keys, callback) => {
        callback({
          profiles: [{
            id: 'test',
            llmEndpoint: 'invalid',
            apiKey: 'test-key',
            modelName: 'test-model'
          }],
          lastSelectedProfileId: 'test',
          defaultLlmEndpoint: 'https://api.example.com/v1/chat'
        });
      });

      const profile = await configValidator.validateConfig();

      expect(profile.llmEndpoint).toBe('https://api.example.com/v1/chat');
    });

    test('should fallback to default profile', async () => {
      mockStorageGet.mockImplementation((keys, callback) => {
        callback({
          profiles: [{
            id: 'default',
            llmEndpoint: 'https://api.example.com/v1/chat',
            apiKey: 'test-key',
            modelName: 'test-model'
          }],
          lastSelectedProfileId: 'invalid'
        });
      });

      const profile = await configValidator.validateConfig();
      expect(profile.id).toBe('default');
    });
  });

  describe('ensureDefaultProfile', () => {
    test('should not create default if exists', async () => {
      const profiles = [{ id: 'default', name: 'Existing Default' }];
      const result = await configValidator.ensureDefaultProfile(profiles);
      expect(result).toEqual(profiles);
      expect(mockStorageSet).not.toHaveBeenCalled();
    });

    test('should create default profile when none exists', async () => {
      const profiles = [];
      mockStorageSet.mockImplementation((data, callback) => callback());

      const result = await configValidator.ensureDefaultProfile(profiles);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('default');
      expect(mockStorageSet).toHaveBeenCalledWith({
        profiles: expect.any(Array),
        lastSelectedProfileId: 'default'
      });
    });

    test('should add default to existing non-default profiles', async () => {
      const profiles = [{ id: 'custom', name: 'Custom' }];
      mockStorageSet.mockImplementation((data, callback) => callback());

      const result = await configValidator.ensureDefaultProfile(profiles);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('default');
      expect(result[1].id).toBe('custom');
    });
  });

  describe('findValidProfile', () => {
    test('should select last selected valid profile', () => {
      const profiles = [
        { id: 'selected', llmEndpoint: 'https://valid.com', apiKey: 'key', modelName: 'model' },
        { id: 'default', llmEndpoint: 'invalid', apiKey: 'key', modelName: 'model' }
      ];
      const result = configValidator.findValidProfile(profiles, 'selected', '');
      expect(result.id).toBe('selected');
    });

    test('should use default endpoint override', () => {
      const profiles = [
        { id: 'selected', llmEndpoint: 'invalid', apiKey: 'key', modelName: 'model' }
      ];
      const result = configValidator.findValidProfile(profiles, 'selected', 'https://override.com');
      expect(result.llmEndpoint).toBe('https://override.com');
    });

    test('should fallback to default profile', () => {
      const profiles = [
        { id: 'default', llmEndpoint: 'https://valid.com', apiKey: 'key', modelName: 'model' }
      ];
      const result = configValidator.findValidProfile(profiles, 'invalid', '');
      expect(result.id).toBe('default');
    });

    test('should return null if no valid profiles', () => {
      const profiles = [{ id: 'bad', llmEndpoint: 'invalid', apiKey: '', modelName: '' }];
      const result = configValidator.findValidProfile(profiles, 'bad', 'invalid');
      expect(result).toBeNull();
    });
  });

  describe('handleConfigurationError', () => {
    test('should throw MISSING_ENDPOINT error', () => {
      expect(() => configValidator.handleConfigurationError('invalid', [])).toThrow('LLM API endpoint is missing or invalid');
    });

    test('should throw NO_VALID_PROFILES error', () => {
      expect(() => configValidator.handleConfigurationError('https://valid.com', [])).toThrow('No valid profiles found');
    });

    test('should throw INCOMPLETE_CONFIG error', () => {
      expect(() => configValidator.handleConfigurationError('https://valid.com', [{}])).toThrow('Configuration is incomplete');
    });
  });

  describe('getAllToolDefinitions', () => {
    test('should return tools from storage', async () => {
      mockStorageGet.mockImplementation((keys, callback) => {
        callback({ promptPaulTools: [{ name: 'test-tool' }] });
      });

      const tools = await configValidator.getAllToolDefinitions();
      expect(tools).toEqual([{ name: 'test-tool' }]);
    });

    test('should return empty array on storage error', async () => {
      mockStorageGet.mockImplementation((keys, callback) => {
        global.chrome.runtime.lastError = { message: 'Storage error' };
        callback({});
      });

      const tools = await configValidator.getAllToolDefinitions();
      expect(tools).toEqual([]);
      expect(errorHandler.handle).toHaveBeenCalled();
    });

    test('should return empty array if no tools stored', async () => {
      mockStorageGet.mockImplementation((keys, callback) => {
        callback({ promptPaulTools: undefined });
      });

      const tools = await configValidator.getAllToolDefinitions();
      expect(tools).toEqual([]);
    });
  });

  describe('getToolDefinition', () => {
    test('should return specific tool', async () => {
      mockStorageGet.mockImplementation((keys, callback) => {
        callback({
          promptPaulTools: [
            { name: 'test-tool', description: 'Test' },
            { name: 'other-tool', description: 'Other' }
          ]
        });
      });

      const tool = await configValidator.getToolDefinition('test-tool');
      expect(tool).toEqual({ name: 'test-tool', description: 'Test' });
    });

    test('should return null if tool not found', async () => {
      mockStorageGet.mockImplementation((keys, callback) => {
        callback({ promptPaulTools: [] });
      });

      const tool = await configValidator.getToolDefinition('missing');
      expect(tool).toBeNull();
    });
  });

  describe('Validators', () => {
    test('isValidURL should validate proper URLs', () => {
      expect(configValidator.isValidURL('https://api.example.com/v1')).toBe(true);
      expect(configValidator.isValidURL('http://localhost:3000')).toBe(true);
      expect(configValidator.isValidURL('invalid')).toBe(false);
    });

    test('isValidMaxTokens should validate positive numbers', () => {
      expect(configValidator.isValidMaxTokens(4096)).toBe(true);
      expect(configValidator.isValidMaxTokens('4096')).toBe(true);
      expect(configValidator.isValidMaxTokens(0)).toBe(false);
      expect(configValidator.isValidMaxTokens(-1)).toBe(false);
      expect(configValidator.isValidMaxTokens(100001)).toBe(false);
    });
  });

  describe('Profile Management', () => {
    test('createProfile should validate and create profile', async () => {
      const profileData = {
        name: 'Test Profile',
        llmEndpoint: 'https://api.example.com',
        apiKey: 'test-key',
        modelName: 'test-model',
        maxTokens: 4096
      };

      const profile = await configValidator.createProfile(profileData);

      expect(profile.id).toBeDefined();
      expect(profile.name).toBe('Test Profile');
      expect(profile.llmEndpoint).toBe('https://api.example.com');
    });

    test('createProfile should throw on invalid data', async () => {
      const invalidData = { name: '', llmEndpoint: 'invalid' };
      await expect(configValidator.createProfile(invalidData)).rejects.toThrow('Profile name is required');
    });

    test('saveProfile should update existing or add new', async () => {
      mockStorageGet.mockImplementation((keys, callback) => {
        callback({ profiles: [{ id: 'existing', name: 'old' }] });
      });
      mockStorageSet.mockImplementation((data, callback) => callback());

      const profile = { id: 'existing', name: 'updated' };
      await configValidator.saveProfile(profile);

      expect(mockStorageSet).toHaveBeenCalledWith({ profiles: expect.arrayContaining([expect.objectContaining({ name: 'updated' })] ) });
    });

    test('deleteProfile should remove non-default profile', async () => {
      mockStorageGet.mockImplementation((keys, callback) => {
        callback({
          profiles: [{ id: 'to-delete', name: 'DeleteMe' }, { id: 'default', name: 'Default' }],
          lastSelectedProfileId: 'other'
        });
      });
      mockStorageSet.mockImplementation((data, callback) => callback());

      await configValidator.deleteProfile('to-delete');

      expect(mockStorageSet).toHaveBeenCalledWith({
        profiles: expect.arrayContaining([expect.objectContaining({ id: 'default' })]),
        lastSelectedProfileId: 'other'
      });
    });

    test('deleteProfile should prevent default deletion', async () => {
      await expect(configValidator.deleteProfile('default')).rejects.toThrow('Cannot delete default profile');
    });

    test('deleteProfile should switch to default if selected was deleted', async () => {
      mockStorageGet.mockImplementation((keys, callback) => {
        callback({
          profiles: [{ id: 'to-delete', name: 'Selected' }],
          lastSelectedProfileId: 'to-delete'
        });
      });
      mockStorageSet.mockImplementation((data, callback) => callback());

      await configValidator.deleteProfile('to-delete');

      expect(mockStorageSet).toHaveBeenCalledWith(
        expect.objectContaining({ lastSelectedProfileId: 'default' })
      );
    });
  });
});