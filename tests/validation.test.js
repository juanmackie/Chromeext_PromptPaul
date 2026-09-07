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
    // Built-in page tool names are reserved on every custom-tool entry path
    // (P2-03), including the read-only page_find_text/page_wait/page_batch.
    for (const reserved of ['page_find_text', 'page_wait', 'page_batch']) {
      expect(normalizeToolDefinition({ name: reserved, description: 'x' }).valid).toBe(false);
    }
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

  it('preserves the search provider preference in backups', () => {
    expect(BACKUP_LOCAL_KEYS).toContain('searchProvider');
    expect(normalizeBackupPayload({ local: { searchProvider: 'duckduckgo' } }).valid).toBe(true);
    expect(normalizeBackupPayload({ local: { searchProvider: 'brave' } }).valid).toBe(true);
    expect(normalizeBackupPayload({ local: { searchProvider: 'yahoo' } }).valid).toBe(false);
  });

  it('preserves the persistent notch preference and position in backups', () => {
    expect(BACKUP_LOCAL_KEYS).toContain('notchEnabled');
    expect(BACKUP_LOCAL_KEYS).toContain('notchPosition');
    expect(BACKUP_LOCAL_KEYS).toContain('notchPlacement');
    const result = normalizeBackupPayload({
      local: { notchEnabled: true, notchPosition: 72.5, notchPlacement: 'right' },
    });

    expect(result.valid).toBe(true);
    expect(result.value.local.notchEnabled).toBe(true);
    expect(result.value.local.notchPosition).toBe(72.5);
    expect(result.value.local.notchPlacement).toBe('right');
    expect(normalizeBackupPayload({ local: { notchPosition: 101 } }).valid).toBe(false);
    expect(normalizeBackupPayload({ local: { notchPlacement: 'diagonal' } }).valid).toBe(false);
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

describe('backup pinned quick actions (P1-03)', () => {
  it('round-trips a populated pin list of string instruction IDs', () => {
    const result = normalizeBackupPayload({
      local: { pinnedQuickActions: ['instruction_123', 'instruction_456'] },
    });
    expect(result.valid).toBe(true);
    expect(result.value.local.pinnedQuickActions).toEqual(['instruction_123', 'instruction_456']);
  });

  it('accepts an empty pin list and deduplicates repeated IDs', () => {
    const empty = normalizeBackupPayload({ local: { pinnedQuickActions: [] } });
    expect(empty.valid).toBe(true);
    expect(empty.value.local.pinnedQuickActions).toEqual([]);

    const dupes = normalizeBackupPayload({
      local: { pinnedQuickActions: ['a', 'a', 'b', 'b'] },
    });
    expect(dupes.valid).toBe(true);
    expect(dupes.value.local.pinnedQuickActions).toEqual(['a', 'b']);
  });

  it('does not treat pin ID strings as object records (regression for pinning blocking backups)', () => {
    // Previously this shape returned 'pinnedQuickActions contains an invalid record.'
    const result = normalizeBackupPayload({
      local: { pinnedQuickActions: ['instruction_123'] },
    });
    expect(result.valid).toBe(true);
  });

  it('round-trips profiles, instructions, skills, tools, pins, and theme together', () => {
    const result = normalizeBackupPayload({
      local: {
        profiles: [
          {
            id: 'default',
            name: 'Default',
            provider: 'api',
            llmEndpoint: 'https://api.example.com/chat',
            apiKey: 'secret-key',
            modelName: 'openrouter/free',
          },
        ],
        instructions: [{ id: 'instruction_123', title: 'Summary', text: 'Summarize this.' }],
        customSkills: [{ id: 'skill_1', name: 'writer' }],
        promptPaulTools: [
          { name: 'lookup', description: 'Lookup', endpointUrl: 'https://example.com/tool' },
        ],
        pinnedQuickActions: ['instruction_123'],
        customSiteSuggestions: [{ url: 'https://example.com', label: 'Example' }],
      },
      sync: { themePreference: 'dark' },
    });
    expect(result.valid).toBe(true);
    expect(result.value.local.profiles[0].apiKey).toBe('');
    expect(result.value.local.pinnedQuickActions).toEqual(['instruction_123']);
    expect(result.value.local.instructions).toHaveLength(1);
    expect(result.value.local.customSkills).toHaveLength(1);
    expect(result.value.local.promptPaulTools).toHaveLength(1);
    expect(result.value.local.customSiteSuggestions).toHaveLength(1);
    expect(result.value.sync.themePreference).toBe('dark');
  });

  it('restores a boundary file (exactly MAX_BACKUP_ARRAY_ITEMS records) fully', () => {
    // A file at exactly the import bound (500) must restore without dropping records.
    const records = Array.from({ length: 500 }, (_, i) => ({
      id: `skill_${i}`,
      name: `writer_${i}`,
    }));
    const result = normalizeBackupPayload({ local: { customSkills: records } });
    expect(result.valid).toBe(true);
    expect(result.value.local.customSkills).toHaveLength(500);
  });

  it('rejects restore inputs exceeding the bounded record count (P2-07)', () => {
    // Profiles and tools must share the same bound as per-type import rejects
    // so full restore (write-back) cannot inject more records than import accepts.
    const manyProfiles = Array.from({ length: 501 }, (_, i) => ({
      id: `profile_${i}`,
      name: `Profile ${i}`,
      provider: 'api',
    }));
    const manyTools = Array.from({ length: 501 }, (_, i) => ({
      name: `tool_${i}`,
      description: `Tool ${i}`,
      endpointUrl: 'https://example.com/tool',
      httpMethod: 'POST',
    }));
    expect(normalizeBackupPayload({ local: { profiles: manyProfiles } }).valid).toBe(false);
    expect(normalizeBackupPayload({ local: { promptPaulTools: manyTools } }).valid).toBe(false);
  });
});
