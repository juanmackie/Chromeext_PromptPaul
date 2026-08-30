import { describe, expect, it } from 'vitest';
import {
  isValidHttpUrl,
  formatToolRequestError,
  BACKUP_LOCAL_KEYS,
  BACKUP_SYNC_KEYS,
  normalizeBackupPayload,
  normalizeProfileRecord,
  normalizeToolDefinition,
  normalizeToolHttpMethod,
} from '../src/utils/validation.js';

describe('validation helpers', () => {
  it('allows only HTTP(S) request URLs', () => {
    expect(isValidHttpUrl('https://api.example.com/v1')).toBe(true);
    expect(isValidHttpUrl('http://localhost:3000/tool')).toBe(true);
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('file:///tmp/secret')).toBe(false);
    expect(isValidHttpUrl('https://user:pass@example.com')).toBe(false);
    expect(isValidHttpUrl('https://:pass@example.com')).toBe(false);
  });

  it('normalizes and bounds tool definitions', () => {
    const result = normalizeToolDefinition({
      name: ' lookup_weather ',
      description: ' Look up the weather ',
      parameters: { type: 'object', properties: {} },
      endpointUrl: 'https://example.com/tool',
      httpMethod: 'post',
    });

    expect(result.valid).toBe(true);
    expect(result.value).toMatchObject({
      name: 'lookup_weather',
      description: 'Look up the weather',
      endpointUrl: 'https://example.com/tool',
      httpMethod: 'POST',
      parameters: '{"type":"object","properties":{}}',
    });
  });

  it('rejects reserved, malformed, and unsupported tool records', () => {
    expect(normalizeToolDefinition({ name: 'web_search', description: 'x' }).valid).toBe(false);
    expect(normalizeToolDefinition({ name: 'bad name', description: 'x' }).valid).toBe(false);
    expect(
      normalizeToolDefinition({
        name: 'lookup',
        description: 'x',
        endpointUrl: 'javascript:alert(1)',
      }).valid
    ).toBe(false);
    expect(
      normalizeToolDefinition({ name: 'lookup', description: 'x', httpMethod: 'CONNECT' }).valid
    ).toBe(false);
  });

  it('normalizes automatic and explicit methods', () => {
    expect(normalizeToolHttpMethod('')).toBe('');
    expect(normalizeToolHttpMethod(' patch ')).toBe('PATCH');
    expect(normalizeToolHttpMethod('OPTIONS')).toBe(null);
  });

  it('formats tool failures without leaking endpoint or response data', () => {
    expect(formatToolRequestError(502)).toBe('User tool request failed with HTTP 502.');
    expect(formatToolRequestError()).toBe('User tool request failed.');
    expect(formatToolRequestError(502)).not.toContain('https://');
  });

  it('allows incomplete profiles for setup but rejects unsafe endpoints', () => {
    expect(
      normalizeProfileRecord({
        id: 'default',
        name: 'Default',
        llmEndpoint: 'https://api.example.com/chat',
        apiKey: '',
        modelName: 'model',
      }).valid
    ).toBe(true);
    expect(
      normalizeProfileRecord({
        id: 'default',
        name: 'Default',
        llmEndpoint: 'file:///tmp/key',
      }).valid
    ).toBe(false);
  });

  it('filters unknown backup keys and validates nested profiles/tools', () => {
    const result = normalizeBackupPayload({
      local: {
        profiles: [
          {
            id: 'default',
            name: 'Default',
            llmEndpoint: 'https://api.example.com/chat',
            apiKey: 'demo',
            modelName: 'model',
          },
        ],
        braveSearchApiKey: 'secret',
        promptPaulTools: [
          { name: 'lookup', description: 'Lookup', endpointUrl: 'https://example.com/tool' },
        ],
        unknownInjectedKey: 'ignored',
      },
      sync: { darkTheme: true },
    });

    expect(result.valid).toBe(true);
    expect(result.value.local.unknownInjectedKey).toBeUndefined();
    expect(result.value.local.braveSearchApiKey).toBeUndefined();
    expect(result.value.local.profiles[0].apiKey).toBe('');
    expect(result.value.local.promptPaulTools[0].httpMethod).toBe('');
    expect(result.warnings).toHaveLength(2);
  });

  it('validates the Light, Dark, and System theme preference', () => {
    expect(BACKUP_SYNC_KEYS).toContain('themePreference');
    expect(normalizeBackupPayload({ sync: { themePreference: 'system' } }).valid).toBe(true);
    expect(normalizeBackupPayload({ sync: { themePreference: 'sepia' } }).valid).toBe(false);
  });

  it('preserves the persistent notch preference and position in backups', () => {
    expect(BACKUP_LOCAL_KEYS).toContain('notchEnabled');
    expect(BACKUP_LOCAL_KEYS).toContain('notchPosition');
    const result = normalizeBackupPayload({
      local: { notchEnabled: true, notchPosition: 72.5 },
    });

    expect(result.valid).toBe(true);
    expect(result.value.local.notchEnabled).toBe(true);
    expect(result.value.local.notchPosition).toBe(72.5);
    expect(normalizeBackupPayload({ local: { notchPosition: 101 } }).valid).toBe(false);
  });

  it('does not restore the transient Act permission from a backup', () => {
    const result = normalizeBackupPayload({ local: { pageActionsEnabled: true } });

    expect(result.valid).toBe(true);
    expect(result.value.local.pageActionsEnabled).toBeUndefined();
    expect(result.warnings).toEqual(["Skipped unsupported local key 'pageActionsEnabled'."]);
  });

  it('rejects malformed backup records before storage writes', () => {
    const result = normalizeBackupPayload({
      local: {
        promptPaulTools: [{ name: 'lookup', description: 'Lookup', endpointUrl: 'file:///bad' }],
      },
    });
    expect(result.valid).toBe(false);
  });

  it('does not retain API credentials or endpoints on Codex profiles', () => {
    const result = normalizeProfileRecord({
      id: 'codex',
      name: 'Codex',
      provider: 'codex',
      llmEndpoint: 'https://example.com/ignored',
      apiKey: 'ignored-api-key',
      modelName: 'gpt-5.4',
      reasoningLevel: 'high',
    });

    expect(result.value).toMatchObject({
      provider: 'codex',
      llmEndpoint: '',
      apiKey: '',
      reasoningLevel: 'high',
    });
  });

  it('migrates a legacy Hermes endpoint into the dedicated field', () => {
    const result = normalizeProfileRecord({
      id: 'hermes',
      name: 'Hermes',
      provider: 'hermes',
      llmEndpoint: 'https://100.126.237.111:30433',
      hermesEndpoint: '',
      modelName: '',
    });

    expect(result).toMatchObject({ valid: true });
    expect(result.value).toMatchObject({
      provider: 'hermes',
      hermesEndpoint: 'https://100.126.237.111:30433',
      llmEndpoint: '',
    });
  });
});
