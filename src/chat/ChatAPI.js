/**
 * @fileoverview Chat API Module - Handles LLM API calls and orchestration
 *
 * Responsibilities:
 * - API configuration retrieval and caching
 * - Tool definitions management
 * - LLM API call execution
 * - Orchestrator integration
 *
 * @module ChatAPI
 * @requires ../../loadingManager.js
 */

import { loadingManager } from '../../loadingManager.js';

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

      if (
        !selectedProfile ||
        !selectedProfile.llmEndpoint ||
        !selectedProfile.apiKey ||
        !selectedProfile.modelName
      ) {
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
    if (tool.name === 'load_skill' || tool.name === 'skills_list' || tool.name === 'skill_view') {
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
  await chrome.runtime.sendMessage({
    action: 'executeRun',
    runId: runId,
    requestConfig: {
      messages: messages,
    },
  });
}

/**
 * Abort an ongoing run
 * @param {string} runId - Run ID to abort
 */
export function abortRun(runId) {
  if (runId) {
    chrome.runtime.sendMessage({
      action: 'abortRun',
      runId: runId,
    });
  }
}
