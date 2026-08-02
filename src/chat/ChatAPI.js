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
import { isProfileUsable, modelSupportsVision } from '../utils/profileRouting.js';

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
  if (!needsVision || (currentProfile && modelSupportsVision(currentProfile.modelName))) {
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
      const selectedProfile =
        profiles.find((p) => p.id === lastSelectedProfileId) ||
        profiles.find((p) => p.id === 'default');

      if (!isProfileUsable(selectedProfile)) {
        console.error('Chat: Configuration is incomplete or missing.');
        const error = new Error(
          'Configuration is incomplete. Please set up the API endpoint, API key, and model name in the options page.'
        );
        loadingManager.showToast('Please configure API settings in options', 'error');
        reject(error);
      } else {
        resolve(selectedProfile);
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

  return definedTools.filter((tool) => {
    if (
      tool.name === 'load_skill' ||
      tool.name === 'skills_list' ||
      tool.name === 'skill_view' ||
      tool.name === 'web_search'
    ) {
      console.warn(`Chat: Skipping user-defined tool named '${tool.name}' because it is reserved.`);
      return false;
    }
    return true;
  });
}

/**
 * Start an orchestrator run
 * @param {Object} runConfig - Run configuration
 * @returns {Promise<string>} - Run ID
 */
export async function startRun(runConfig) {
  const response = await chrome.runtime.sendMessage({
    action: 'startRun',
    config: runConfig,
  });

  if (response.error) {
    throw new Error(response.error);
  }

  return response.runId;
}

/**
 * Execute an orchestrator run
 * @param {string} runId - Run ID
 * @param {Array} messages - Message history
 */
export async function executeRun(runId, messages) {
  const response = await chrome.runtime.sendMessage({
    action: 'executeRun',
    runId: runId,
    requestConfig: {
      messages: messages,
    },
  });

  if (response && response.error) {
    throw new Error(response.error);
  }
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
    });
    return response?.success === true;
  } catch (error) {
    console.error('[ChatAPI] abortRun failed:', error.message);
    return false;
  }
}
