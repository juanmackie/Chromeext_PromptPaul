/**
 * @fileoverview Regression coverage for P2-04: adaptive vision routing must only
 * reroute to a profile that is both vision-capable and a usable connection.
 * @module selectOptimalProfile
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../loadingManager.js', () => ({
  loadingManager: {
    showToast: vi.fn(),
  },
}));

const { selectOptimalProfile } = await import('../src/chat/ChatAPI.js');

// A usable API profile: valid http(s) endpoint, non-empty key, non-empty model.
const usableApi = (id, modelName) => ({
  id,
  provider: 'api',
  llmEndpoint: `https://api.example.com/${id}`,
  apiKey: 'sk-test',
  modelName,
});

// An incomplete API profile: missing key/endpoint, so not a usable connection.
const incomplete = (id, modelName) => ({
  id,
  provider: 'api',
  modelName,
});

describe('selectOptimalProfile (P2-04 vision rerouting)', () => {
  it('keeps the current profile when an incomplete vision profile is the only match', async () => {
    const current = usableApi('current', 'gpt-3.5-turbo'); // non-vision name
    const alt = incomplete('alt', 'gpt-4o'); // vision-capable name but unusable
    const result = await selectOptimalProfile([current, alt], 'current', {
      type: 'image',
    });
    expect(result.rerouted).toBe(false);
    expect(result.config.id).toBe('current');
  });

  it('reroutes to a usable vision-capable alternate profile', async () => {
    const current = usableApi('current', 'gpt-3.5-turbo');
    const alt = usableApi('alt', 'gpt-4o');
    const result = await selectOptimalProfile([current, alt], 'current', {
      type: 'image',
    });
    expect(result.rerouted).toBe(true);
    expect(result.config.id).toBe('alt');
  });

  it('retains the working current profile when no usable alternative exists', async () => {
    const current = usableApi('current', 'gpt-3.5-turbo');
    const visionButUnusable = incomplete('alt', 'claude-3-opus');
    const notUsableApi = { id: 'bad', provider: 'api', modelName: 'gpt-4o' }; // no key/endpoint
    const result = await selectOptimalProfile(
      [current, visionButUnusable, notUsableApi],
      'current',
      { type: 'video' }
    );
    expect(result.rerouted).toBe(false);
    expect(result.config.id).toBe('current');
  });

  it('returns the current profile when it already supports vision (no reroute)', async () => {
    const current = usableApi('current', 'gpt-4o');
    const result = await selectOptimalProfile([current], 'current', { type: 'image' });
    expect(result.rerouted).toBe(false);
    expect(result.config.id).toBe('current');
  });

  it('does not reroute when no vision is needed', async () => {
    const current = usableApi('current', 'gpt-4o-mini');
    const result = await selectOptimalProfile([current], 'current', { type: 'text' });
    expect(result.rerouted).toBe(false);
    expect(result.config.id).toBe('current');
  });
});
