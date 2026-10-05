/**
 * @fileoverview Background-owned model discovery for API and Codex profiles.
 * @module modelDiscovery
 */

import { CODEX_API_ENDPOINT } from './codexAuth.js';

export const OPENAI_MODELS_ENDPOINT = 'https://api.openai.com/v1/models';
export const CODEX_MODELS_ENDPOINT = CODEX_API_ENDPOINT.replace(/\/responses\/?$/, '/models');
const DEFAULT_CODEX_CLIENT_VERSION = '0.0.0';

const MAX_MODELS = 200;
const NON_CHAT_MODEL_PATTERNS = [
  /embedding/i,
  /moderation/i,
  /whisper/i,
  /transcrib/i,
  /tts/i,
  /dall[-_]?e/i,
  /realtime/i,
  /audio/i,
  /sora/i,
];

function normalizeReasoningLevel(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized || '';
}

function normalizeReasoningLevels(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((entry) => {
      const value =
        typeof entry === 'string'
          ? entry
          : entry?.effort || entry?.level || entry?.value || entry?.id;
      const normalized = normalizeReasoningLevel(value);
      if (!normalized) return null;
      return {
        value: normalized,
        label: String(entry?.display_name || entry?.displayName || entry?.label || normalized),
        description: String(entry?.description || ''),
      };
    })
    .filter(Boolean)
    .filter(
      (entry, index, values) => values.findIndex((item) => item.value === entry.value) === index
    );
}

function extractModelRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.models)) return payload.models;
  if (Array.isArray(payload?.model_info)) return payload.model_info;
  return [];
}

function modelId(model) {
  return String(model?.id || model?.slug || model?.model || '').trim();
}

function isVisibleCodexModel(model) {
  const visibility = String(model?.visibility || '').toLowerCase();
  return visibility !== 'hide' && visibility !== 'none';
}

function isChatModel(model) {
  const id = modelId(model);
  return id && !NON_CHAT_MODEL_PATTERNS.some((pattern) => pattern.test(id));
}

function normalizeModel(model, provider) {
  const id = modelId(model);
  if (!id || (provider === 'codex' ? !isVisibleCodexModel(model) : !isChatModel(model))) {
    return null;
  }

  const reasoningLevels = normalizeReasoningLevels(
    model?.supported_reasoning_levels || model?.supported_reasoning_efforts
  );
  const defaultReasoningLevel = normalizeReasoningLevel(
    model?.default_reasoning_level || model?.default_reasoning_effort
  );

  return {
    id,
    displayName: String(model?.display_name || model?.displayName || id),
    description: String(model?.description || ''),
    reasoningLevels,
    defaultReasoningLevel,
    priority: Number.isFinite(Number(model?.priority)) ? Number(model.priority) : 0,
    supportsTools:
      provider === 'codex'
        ? true
        : Array.isArray(model?.supported_parameters)
          ? model.supported_parameters.includes('tools')
          : null,
  };
}

/**
 * Normalize a provider model response into the small shape used by Options.
 * @param {object|Array} payload - Provider response body.
 * @param {'api'|'codex'} provider - Profile provider.
 * @returns {Array<object>}
 */
export function normalizeAvailableModels(payload, provider = 'api') {
  const models = extractModelRecords(payload)
    .map((model) => normalizeModel(model, provider))
    .filter(Boolean)
    .slice(0, MAX_MODELS);

  if (provider === 'codex') {
    return models.sort(
      (left, right) => left.priority - right.priority || left.id.localeCompare(right.id)
    );
  }
  return models.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Resolve the OpenAI-compatible models endpoint for an API profile.
 * @param {string} endpoint - Configured chat or responses endpoint.
 * @returns {string}
 */
export function deriveModelsEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.hostname === 'api.openai.com' && url.pathname === '/v1/chat/completions') {
      return OPENAI_MODELS_ENDPOINT;
    }
    if (/\/(chat\/completions|responses)\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/(chat\/completions|responses)\/?$/, '/models');
    } else if (!/\/models\/?$/.test(url.pathname)) {
      const path = url.pathname.replace(/\/+$/, '').split('/');
      path.pop();
      url.pathname = `${path.join('/') || ''}/models`;
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function createCodexModelHeaders(auth, clientVersion = DEFAULT_CODEX_CLIENT_VERSION) {
  const headers = {
    Authorization: `Bearer ${auth.accessToken}`,
    'OpenAI-Beta': 'codex-1',
    originator: 'prompt_paul',
    version: String(clientVersion || DEFAULT_CODEX_CLIENT_VERSION),
    'User-Agent': 'PromptPaul/6.1',
  };
  if (auth.accountId) headers['ChatGPT-Account-Id'] = auth.accountId;
  return headers;
}

/**
 * Fetch and normalize the models visible to a profile.
 * @param {object} params - Discovery options.
 * @param {object} params.profile - Stored profile record.
 * @param {object|null} [params.auth] - Valid Codex auth record.
 * @param {Function} [params.fetchImpl=fetch] - Fetch implementation.
 * @returns {Promise<Array<object>>}
 */
export async function fetchAvailableModels({
  profile,
  auth = null,
  clientVersion = DEFAULT_CODEX_CLIENT_VERSION,
  fetchImpl = fetch,
}) {
  const provider = profile?.provider === 'codex' ? 'codex' : 'api';
  let endpoint =
    provider === 'codex' ? CODEX_MODELS_ENDPOINT : deriveModelsEndpoint(profile?.llmEndpoint);
  if (!endpoint) throw new Error('The configured endpoint does not expose a models route.');
  if (provider === 'codex' && !auth?.accessToken) {
    throw new Error('Connect this Codex profile before loading models.');
  }
  if (provider === 'codex') {
    endpoint = `${endpoint}?client_version=${encodeURIComponent(
      String(clientVersion || DEFAULT_CODEX_CLIENT_VERSION)
    )}`;
  }

  const response = await fetchImpl(endpoint, {
    method: 'GET',
    headers:
      provider === 'codex'
        ? createCodexModelHeaders(auth, clientVersion)
        : { Authorization: `Bearer ${profile.apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Model discovery failed with HTTP ${response.status}.`);
  }
  const models = normalizeAvailableModels(await response.json(), provider);
  if (provider === 'codex' && !models.length) {
    throw new Error('Codex returned no visible models for this account.');
  }
  return models;
}
