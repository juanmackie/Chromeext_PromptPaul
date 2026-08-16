import { describe, expect, it } from 'vitest';
import {
  CODEX_MODELS_ENDPOINT,
  deriveModelsEndpoint,
  fetchAvailableModels,
  normalizeAvailableModels,
} from '../src/utils/modelDiscovery.js';

describe('model discovery', () => {
  it('derives the OpenAI models endpoint from the chat endpoint', () => {
    expect(deriveModelsEndpoint('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1/models'
    );
    expect(deriveModelsEndpoint('https://api.mistral.ai/v1/chat/completions')).toBe(
      'https://api.mistral.ai/v1/models'
    );
  });

  it('normalizes API models and removes non-chat model families', () => {
    const models = normalizeAvailableModels(
      {
        data: [
          { id: 'gpt-5.4', owned_by: 'openai' },
          { id: 'text-embedding-3-small', owned_by: 'openai' },
        ],
      },
      'api'
    );

    expect(models).toEqual([
      {
        id: 'gpt-5.4',
        displayName: 'gpt-5.4',
        description: '',
        reasoningLevels: [],
        defaultReasoningLevel: '',
        priority: 0,
      },
    ]);
  });

  it('keeps visible Codex model metadata for the thinking-level selector', () => {
    const models = normalizeAvailableModels(
      {
        models: [
          {
            slug: 'gpt-5.4-codex',
            display_name: 'GPT-5.4-Codex',
            visibility: 'list',
            priority: 1,
            default_reasoning_level: 'medium',
            supported_reasoning_levels: [
              { effort: 'low', display_name: 'Low' },
              { effort: 'medium', display_name: 'Medium' },
              { effort: 'high', display_name: 'High' },
            ],
          },
          { slug: 'hidden-model', visibility: 'hide' },
        ],
      },
      'codex'
    );

    expect(CODEX_MODELS_ENDPOINT).toBe('https://chatgpt.com/backend-api/codex/models');
    expect(models[0]).toMatchObject({
      id: 'gpt-5.4-codex',
      defaultReasoningLevel: 'medium',
      reasoningLevels: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
    });
    expect(models).toHaveLength(1);
  });

  it('uses background auth for Codex model discovery without returning credentials', async () => {
    let request;
    const models = await fetchAvailableModels({
      profile: { provider: 'codex', llmEndpoint: '', apiKey: '' },
      auth: { accessToken: 'access-secret', accountId: 'account-1' },
      fetchImpl: async (url, options) => {
        request = { url, options };
        return {
          ok: true,
          async json() {
            return { models: [{ slug: 'gpt-5.4-codex', visibility: 'list' }] };
          },
        };
      },
    });

    expect(request.url).toBe(`${CODEX_MODELS_ENDPOINT}?client_version=0.0.0`);
    expect(request.options.headers.version).toBe('0.0.0');
    expect(request.options.headers.Authorization).toBe('Bearer access-secret');
    expect(request.options.headers['ChatGPT-Account-Id']).toBe('account-1');
    expect(models[0]).not.toHaveProperty('accessToken');
    expect(models[0].id).toBe('gpt-5.4-codex');
  });

  it('sends the Codex client version on the discovery request', async () => {
    let request;
    await fetchAvailableModels({
      profile: { provider: 'codex' },
      auth: { accessToken: 'access-secret' },
      clientVersion: '6.1.0',
      fetchImpl: async (url, options) => {
        request = { url, options };
        return {
          ok: true,
          async json() {
            return { models: [{ slug: 'gpt-5.4-codex', visibility: 'list' }] };
          },
        };
      },
    });

    expect(request.url).toBe(`${CODEX_MODELS_ENDPOINT}?client_version=6.1.0`);
    expect(request.options.headers.version).toBe('6.1.0');
  });
});
