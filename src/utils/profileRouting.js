/**
 * @fileoverview Shared helpers for resolving and validating API profiles.
 * @module profileRouting
 */

import { isValidURL } from './validation.js';

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

export function isProfileUsable(profile, endpointOverride = null) {
  const endpoint = endpointOverride || profile?.llmEndpoint;
  return Boolean(endpoint && isValidURL(endpoint) && profile?.apiKey && profile?.modelName);
}

export function resolvePreferredProfile({
  selectedProfile = null,
  defaultProfile = null,
  defaultLlmEndpoint = '',
} = {}) {
  if (isProfileUsable(selectedProfile)) {
    return selectedProfile;
  }

  if (isProfileUsable(selectedProfile, defaultLlmEndpoint)) {
    return { ...selectedProfile, llmEndpoint: defaultLlmEndpoint };
  }

  if (isProfileUsable(defaultProfile)) {
    return defaultProfile;
  }

  if (isProfileUsable(defaultProfile, defaultLlmEndpoint)) {
    return { ...defaultProfile, llmEndpoint: defaultLlmEndpoint };
  }

  return null;
}
