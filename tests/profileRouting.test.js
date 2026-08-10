import { describe, expect, it } from 'vitest';
import { isProfileUsable, resolvePreferredProfile } from '../src/utils/profileRouting.js';

const validProfile = (overrides = {}) => ({
  id: 'profile',
  llmEndpoint: 'https://api.example.com/v1/chat/completions',
  apiKey: 'stored-key',
  modelName: 'new-model',
  ...overrides,
});

describe('profile routing', () => {
  it('accepts a complete HTTP(S) profile', () => {
    expect(isProfileUsable(validProfile())).toBe(true);
  });

  it('falls back to a valid Default profile when the selected profile is incomplete', () => {
    const selectedProfile = validProfile({ apiKey: '', modelName: 'broken-profile-model' });
    const defaultProfile = validProfile({ id: 'default', modelName: 'default-model' });

    expect(resolvePreferredProfile({ selectedProfile, defaultProfile })).toBe(defaultProfile);
  });

  it('prefers the selected profile when both profiles are valid', () => {
    const selectedProfile = validProfile({ modelName: 'selected-model' });
    const defaultProfile = validProfile({ id: 'default', modelName: 'default-model' });

    expect(resolvePreferredProfile({ selectedProfile, defaultProfile })).toBe(selectedProfile);
  });

  it('accepts a connected-by-auth Codex profile without an API endpoint or key', () => {
    expect(isProfileUsable({ id: 'codex', provider: 'codex', modelName: 'gpt-5.4' })).toBe(true);
  });
});
