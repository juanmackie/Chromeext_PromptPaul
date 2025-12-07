const jestChrome = require('jest-chrome');
import {} from // validateConfig is defined in background.js; import via module to exercise real logic.
'../../../background.js';
import { createError } from '../../../errorHandler.js';

describe('background.validateConfig', () => {
  let originalConsole;

  beforeEach(() => {
    originalConsole = { ...console };
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();

    // Ensure chrome storage mocks are reset
    chrome.flush();
    chrome.runtime.lastError = null;
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  test('creates and saves default profile when none exists', async () => {
    const stored = {};

    chrome.storage.local.get.mockImplementation((keys, cb) => {
      cb(stored);
    });

    chrome.storage.local.set.mockImplementation((data, cb) => {
      Object.assign(stored, data);
      if (cb) cb();
    });

    // Import validateConfig after mocks so background.js picks up jest-chrome
    const { validateConfig } = await import('../../../background.js');

    const profile = await validateConfig();

    expect(profile).toBeDefined();
    expect(profile.id).toBe('default');
    expect(stored.profiles).toBeDefined();
    expect(stored.lastSelectedProfileId).toBe('default');
  });

  test('throws configuration error when endpoint is invalid and no valid profiles', async () => {
    const stored = {
      profiles: [
        {
          id: 'p1',
          name: 'Bad',
          llmEndpoint: 'not-a-url',
          apiKey: '',
          modelName: '',
        },
      ],
      lastSelectedProfileId: 'p1',
      defaultLlmEndpoint: 'also-not-a-url',
    };

    chrome.storage.local.get.mockImplementation((keys, cb) => {
      cb(stored);
    });

    const { validateConfig } = await import('../../../background.js');

    await expect(validateConfig()).rejects.toMatchObject({
      message: expect.stringMatching(/LLM API endpoint is missing or invalid/i),
    });
  });

  test('selects an existing valid profile when available', async () => {
    const stored = {
      profiles: [
        {
          id: 'default',
          name: 'Default',
          llmEndpoint: 'https://api.example.com/v1/chat',
          apiKey: 'test-key',
          modelName: 'test-model',
        },
      ],
      lastSelectedProfileId: 'default',
      defaultLlmEndpoint: 'https://api.example.com/v1/chat',
    };

    chrome.storage.local.get.mockImplementation((keys, cb) => {
      cb(stored);
    });

    const { validateConfig } = await import('../../../background.js');

    const profile = await validateConfig();

    expect(profile).toBeDefined();
    expect(profile.id).toBe('default');
    expect(profile.llmEndpoint).toBe('https://api.example.com/v1/chat');
    expect(profile.apiKey).toBe('test-key');
    expect(profile.modelName).toBe('test-model');
  });
});
