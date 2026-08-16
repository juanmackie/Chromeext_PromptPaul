/**
 * @fileoverview Shared helpers for resolving and validating API profiles.
 * @module profileRouting
 */

import { isValidHttpUrl } from './validation.js';

const VISION_MODEL_PATTERNS = [
  /vision/i,
  /gpt-4o/i,
  /gpt-4\.\d+-turbo/i,
  /claude-3/i,
  /claude-4/i,
  /gemini-pro-vision/i,
  /gemini-2\.\d+-flash/i,
  /gemini-2\.\d+-pro/i,
  /llava/i,
  /cogvlm/i,
  /qwen-vl/i,
  /internlm-xcomposer/i,
];

export function modelSupportsVision(modelName) {
  if (!modelName) return false;
  return VISION_MODEL_PATTERNS.some((pattern) => pattern.test(modelName));
}

const REASONING_MODEL_PATTERNS = [
  /claude-3-7/i,
  /claude-(opus|sonnet)-4/i,
  /claude-.*-4-/i,
  /o[1-4](-|$)/i,
  /gpt-5/i,
  /deepseek-reasoner/i,
  /deepseek-r1/i,
  /grok-.*reason/i,
  /gemini-2\.5/i,
];

/**
 * Whether a model is known to emit reasoning/thinking tokens.
 * Used to request Anthropic extended thinking; OpenAI-compatible endpoints
 * stream reasoning unconditionally and are parsed regardless.
 * @param {string} modelName
 * @returns {boolean}
 */
export function modelSupportsReasoning(modelName) {
  if (!modelName) return false;
  const normalized = String(modelName).replace(/^anthropic:/, '');
  return REASONING_MODEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Return the configured Hermes endpoint, including the legacy field used by
 * profiles created before Hermes had a dedicated endpoint property.
 * @param {object|null|undefined} profile
 * @returns {string}
 */
export function getHermesEndpoint(profile) {
  if (!profile || profile.provider !== 'hermes') return '';
  return String(profile.hermesEndpoint || profile.llmEndpoint || '').trim();
}

export function isProfileUsable(profile) {
  if (profile?.provider === 'codex') {
    return Boolean(profile.id && typeof profile.modelName === 'string' && profile.modelName.trim());
  }

  if (profile?.provider === 'hermes') {
    const endpoint = getHermesEndpoint(profile);
    return Boolean(profile.id && endpoint && isValidHttpUrl(endpoint));
  }

  return Boolean(
    profile?.llmEndpoint &&
    isValidHttpUrl(profile.llmEndpoint) &&
    typeof profile.apiKey === 'string' &&
    profile.apiKey &&
    typeof profile.modelName === 'string' &&
    profile.modelName
  );
}

export function resolvePreferredProfile({ selectedProfile = null, defaultProfile = null } = {}) {
  if (isProfileUsable(selectedProfile)) {
    return selectedProfile;
  }

  if (isProfileUsable(defaultProfile)) {
    return defaultProfile;
  }

  return null;
}
