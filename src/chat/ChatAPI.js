/**
 * @fileoverview Chat API Module - Handles LLM API calls and orchestration
 *
 * Responsibilities:
 * - API configuration retrieval and caching
 * - Tool definitions management
 * - LLM API call execution
 * - Orchestrator integration
 * - Adaptive model routing for vision/media requests
 *
 * @module ChatAPI
 * @requires ../../loadingManager.js
 */

import { loadingManager } from '../../loadingManager.js';
import { modelSupportsVision, resolvePreferredProfile } from '../utils/profileRouting.js';
import { normalizeToolDefinition } from '../utils/validation.js';
import { buildHermesTurn } from '../utils/hermesContext.js';
import { setActiveRun } from './ChatRunRecovery.js';

/**
 * Select the optimal profile for a request based on media context.
 * If the current profile's model doesn't support vision but media is attached,
 * tries to find a vision-capable profile. Returns the selected config and
 * a flag indicating whether a reroute occurred.
 * @param {Array} profiles - All available profiles from storage
 * @param {string} selectedProfileId - Currently selected profile ID
 * @param {Object|null} mediaData - Current media data (may indicate vision need)
 * @returns {Promise<{config: Object, rerouted: boolean}>}
 */
export async function selectOptimalProfile(profiles, selectedProfileId, mediaData) {
  const needsVision = mediaData && (mediaData.type === 'image' || mediaData.type === 'video');

  const currentProfile =
    profiles.find((p) => p.id === selectedProfileId) || profiles.find((p) => p.id === 'default');

  // If no vision needed or current profile already supports it, use current
  if (
    !needsVision ||
    currentProfile?.provider === 'hermes' ||
    (currentProfile && modelSupportsVision(currentProfile.modelName))
  ) {
    return { config: currentProfile, rerouted: false };
  }

  // No media or no profiles — use current
  if (!profiles.length || !currentProfile) {
    return { config: currentProfile, rerouted: false };
  }

  // Try to find a vision-capable profile
  const visionProfile = profiles.find((p) => modelSupportsVision(p.modelName));
  if (visionProfile) {
    console.log(
      `[ChatAPI] Auto-routing from "${currentProfile.modelName}" to "${visionProfile.modelName}" for vision request.`
    );
    return { config: visionProfile, rerouted: true };
  }

  // No vision-capable profile found — use current and still allow the attempt
  return { config: currentProfile, rerouted: false };
}

// ── Config Cache ──────────────────────────────────────────────────

/** @type {Object|null} */
let configCache = null;
const runOwnerTokens = new Map();

/** @type {number} */
let configCacheTimestamp = 0;

/** Cache TTL in milliseconds (30 seconds) */
const CONFIG_CACHE_TTL = 30000;

/**
 * Invalidate the API config cache.
 * Called automatically on storage change, or can be called manually.
 */
export function invalidateConfigCache() {
  configCache = null;
  configCacheTimestamp = 0;
}

// Auto-invalidate cache when storage changes
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.profiles || changes.lastSelectedProfileId)) {
      invalidateConfigCache();
    }
  });
}

/**
 * Get API configuration with in-memory caching.
 * Falls back to fresh storage read if cache is stale or missing.
 * @returns {Promise<Object>} - API configuration object
 */
export async function getApiConfigCached() {
  const now = Date.now();
  if (configCache && now - configCacheTimestamp < CONFIG_CACHE_TTL) {
    return configCache;
  }
  const config = await getApiConfig();
  configCache = config;
  configCacheTimestamp = now;
  return config;
}

/**
 * Get API configuration from Chrome storage
 * @returns {Promise<Object>} - API configuration object
 */
export async function getApiConfig() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
      if (chrome.runtime.lastError) {
        const error = new Error(
          `Failed to read configuration: ${chrome.runtime.lastError.message}`
        );
        console.error('Chat: Storage read error:', chrome.runtime.lastError.message);
        loadingManager.showToast('Error reading configuration', 'error');
        reject(error);
        return;
      }

      const profiles = result.profiles || [];
      const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
      const selectedProfile = profiles.find((p) => p.id === lastSelectedProfileId);
      const defaultProfile = profiles.find((p) => p.id === 'default');
      const usableProfile = resolvePreferredProfile({ selectedProfile, defaultProfile });

      if (!usableProfile) {
        console.error('Chat: Configuration is incomplete or missing.');
        const error = new Error(
          'Configuration is incomplete. Please configure a usable provider in the options page.'
        );
        loadingManager.showToast('Please configure API settings in options', 'error');
        reject(error);
      } else {
        resolve({ ...usableProfile, profileId: usableProfile.id });
      }
    });
  });
}

/**
 * Get user-defined tools from storage
 * @returns {Promise<Array>} - Array of tool definitions
 */
export async function getTools() {
  const { promptPaulTools: definedTools = [] } = await new Promise((resolve) => {
    chrome.storage.local.get(['promptPaulTools'], resolve);
  });

  return definedTools
    .map((tool) => normalizeToolDefinition(tool))
    .filter((entry) => {
      if (!entry.valid) {
        console.warn(`Chat: Skipping invalid user-defined tool: ${entry.error}`);
        return false;
      }
      return true;
    })
    .map((entry) => entry.value);
}

/**
 * Start an orchestrator run
 * @param {Object} runConfig - Run configuration
 * @returns {Promise<string>} - Run ID
 */
export async function startRun(runConfig) {
  const safeRunConfig = { ...runConfig };
  delete safeRunConfig.apiKey;
  const response = await chrome.runtime.sendMessage({
    action: 'startRun',
    config: safeRunConfig,
  });

  if (response.error) {
    throw new Error(response.error);
  }
  if (!response.runId || typeof response.ownerToken !== 'string' || !response.ownerToken) {
    throw new Error('Run authorization was not established. Reload Prompt Paul and try again.');
  }

  runOwnerTokens.set(response.runId, response.ownerToken);
  if (response.sourceTabId != null) runConfig.sourceTabId = response.sourceTabId;
  await setActiveRun(response.runId, runConfig.sourceTabId);
  return response.runId;
}

/**
 * Return the opaque token for a run-owned runtime request.
 * @param {string} runId - Active run ID.
 * @returns {string} Opaque owner token, or an empty string when unavailable.
 */
export function getRunOwnerToken(runId) {
  return runOwnerTokens.get(runId) || '';
}

/**
 * Release the opaque owner token after a terminal run event is rendered.
 * Execution acknowledgements are intentionally non-terminal so long-running
 * runs can outlive the side-panel message channel.
 * @param {string} runId - Active run ID.
 * @returns {void}
 */
export function clearRunOwnerToken(runId) {
  if (runId) runOwnerTokens.delete(runId);
}

/**
 * Build the owner fields for a run-scoped runtime request.
 * @param {string} runId - Active run ID.
 * @param {number|null} sourceTabId - Source tab identity, when available.
 * @returns {{ownerToken: string, sourceTabId: number|null}}
 */
export function getRunAuth(runId, sourceTabId = null) {
  return { ownerToken: getRunOwnerToken(runId), sourceTabId };
}

/**
 * Ask the background worker to execute an orchestrator run. The worker
 * acknowledges acceptance immediately; completion arrives through runtime
 * events so this call never holds a message channel open for the run lifetime.
 * @param {string} runId - Run ID
 * @param {Array} messages - Message history
 * @returns {Promise<object>}
 */
export async function executeRun(runId, messages) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'executeRun',
      runId: runId,
      ownerToken: getRunOwnerToken(runId),
      requestConfig: {
        messages: messages,
      },
    });

    if (response?.error) {
      throw new Error(response.error);
    }
    if (response?.success === false) {
      throw new Error(response.error || 'The background worker rejected the run.');
    }
    return response || { success: true, accepted: true };
  } catch (error) {
    clearRunOwnerToken(runId);
    throw error;
  }
}

/**
 * Prepare the history sent through the runtime bridge for one provider run.
 * Hermes receives bounded explicit history; other providers retain the full
 * local transcript behavior.
 * @param {Object} config - Selected provider configuration.
 * @param {Array} messages - Local conversation history.
 * @returns {Array}
 */
export function prepareRunMessages(config, messages) {
  if (config?.provider !== 'hermes') return messages;
  const turn = buildHermesTurn(messages, {
    modelId: config.modelName,
    instructions: config.systemPrompt,
  });
  const currentMessages = Array.isArray(turn.input)
    ? turn.input
    : [{ role: 'user', content: turn.input }];
  return [...turn.conversationHistory, ...currentMessages];
}

/**
 * Abort an ongoing run
 * @param {string} runId - Run ID to abort
 * @returns {Promise<boolean>} True if abort was acknowledged
 */
export async function abortRun(runId) {
  if (!runId) return false;
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'abortRun',
      runId,
      ownerToken: getRunOwnerToken(runId),
    });
    const acknowledged = response?.success === true;
    if (acknowledged) clearRunOwnerToken(runId);
    return acknowledged;
  } catch (error) {
    console.error('[ChatAPI] abortRun failed:', error.message);
    return false;
  }
}
