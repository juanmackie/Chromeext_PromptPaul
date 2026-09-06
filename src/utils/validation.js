/**
 * @fileoverview Input and storage validation utilities.
 * @module validation
 */

const MAX_TOOL_NAME_LENGTH = 64;
const MAX_TOOL_DESCRIPTION_LENGTH = 1024;
export const MAX_TOOL_ARGUMENTS_BYTES = 16_384;
const MAX_TOOL_PARAMETERS_BYTES = 16_384;
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_PROFILE_ID_LENGTH = 128;
const MAX_PROFILE_NAME_LENGTH = 128;
const MAX_MODEL_NAME_LENGTH = 256;
const MAX_API_KEY_LENGTH = 4_096;
const MAX_SYSTEM_PROMPT_LENGTH = 20_000;
const MAX_BACKUP_ARRAY_ITEMS = 500;
const MAX_BACKUP_RECORD_BYTES = 100_000;
const ALLOWED_REASONING_LEVELS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

export const RESERVED_TOOL_NAMES = Object.freeze([
  'skills_list',
  'skill_view',
  'web_search',
  'page_get_state',
  'page_find_text',
  'page_wait',
  'page_batch',
  'page_click',
  'page_input',
  'page_select',
  'page_scroll',
  'page_list_tabs',
  'page_open_tab',
  'page_open_link',
  'page_switch_tab',
  'page_close_tab',
  'page_request_user_input',
  'page_pause_for_user',
  'page_record_note',
  'page_replan',
]);
export const ALLOWED_TOOL_METHODS = Object.freeze(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

export const BACKUP_LOCAL_KEYS = Object.freeze([
  'profiles',
  'lastSelectedProfileId',
  'instructions',
  'customSkills',
  'promptPaulTools',
  'analyticsConsent',
  'analyticsInstance',
  'analyticsRotateAt',
  'voiceInputEnabled',
  'voiceInputPermissionState',
  'voiceInputPermissionLastChecked',
  'webSearchEnabled',
  'pageActionsTrustedMode',
  'pageActionsMultiTabEnabled',
  'notchEnabled',
  'notchPosition',
  'notchPlacement',
  'pinnedQuickActions',
  'customSiteSuggestions',
]);

export const BACKUP_SYNC_KEYS = Object.freeze(['darkTheme', 'themePreference']);

/**
 * Validate that a string is a valid URL.
 * @param {string} string - URL string to validate.
 * @returns {boolean} True if the value parses as a URL.
 */
export function isValidURL(string) {
  if (!string) return false;
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Validate a URL that will be requested by the extension.
 * @param {string} value - Candidate endpoint URL.
 * @returns {boolean} True only for HTTP(S) URLs without excessive length.
 */
export function isValidHttpUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  const trimmed = value.trim();
  if (trimmed.length > MAX_ENDPOINT_LENGTH) return false;

  try {
    const parsed = new URL(trimmed);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password
    );
  } catch (_) {
    return false;
  }
}

/**
 * Normalize a configured tool HTTP method.
 * @param {string} method - Optional configured method.
 * @returns {string|null} Uppercase method, empty string for automatic mode, or null when invalid.
 */
export function normalizeToolHttpMethod(method) {
  const normalized = String(method || '')
    .trim()
    .toUpperCase();
  if (!normalized) return '';
  return ALLOWED_TOOL_METHODS.includes(normalized) ? normalized : null;
}

/**
 * Build a user-tool failure message without including endpoint URLs or remote bodies.
 * @param {number|null} status - HTTP response status, when available.
 * @returns {string} Safe user-facing error.
 */
export function formatToolRequestError(status = null) {
  return Number.isInteger(status) && status > 0
    ? `User tool request failed with HTTP ${status}.`
    : 'User tool request failed.';
}

/**
 * Normalize and validate a configured tool record.
 * @param {object} tool - Candidate tool record.
 * @returns {{valid: boolean, value?: object, error?: string}}
 */
export function normalizeToolDefinition(tool) {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
    return { valid: false, error: 'Tool must be an object.' };
  }

  const name = String(tool.name || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) || name.length > MAX_TOOL_NAME_LENGTH) {
    return {
      valid: false,
      error: 'Tool name must be 1–64 letters, numbers, underscores, or hyphens.',
    };
  }
  if (RESERVED_TOOL_NAMES.includes(name.toLowerCase())) {
    return { valid: false, error: `Tool name '${name}' is reserved by Prompt Paul.` };
  }

  const description = String(tool.description || '').trim();
  if (!description || description.length > MAX_TOOL_DESCRIPTION_LENGTH) {
    return {
      valid: false,
      error: 'Tool description is required and must be at most 1,024 characters.',
    };
  }

  const endpointUrl = String(tool.endpointUrl || '').trim();
  if (endpointUrl && !isValidHttpUrl(endpointUrl)) {
    return { valid: false, error: 'Tool endpoint URL must use http or https.' };
  }

  const httpMethod = normalizeToolHttpMethod(tool.httpMethod);
  if (httpMethod === null) {
    return { valid: false, error: 'Tool HTTP method is not supported.' };
  }

  let parameters = '';
  if (typeof tool.parameters === 'string') {
    parameters = tool.parameters.trim();
  } else if (tool.parameters && typeof tool.parameters === 'object') {
    try {
      parameters = JSON.stringify(tool.parameters);
    } catch (_) {
      return { valid: false, error: 'Tool parameters must be valid JSON.' };
    }
  }

  if (parameters) {
    if (new TextEncoder().encode(parameters).byteLength > MAX_TOOL_PARAMETERS_BYTES) {
      return { valid: false, error: 'Tool parameters are too large.' };
    }
    try {
      const parsed = JSON.parse(parameters);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { valid: false, error: 'Tool parameters must be a JSON object.' };
      }
    } catch (_) {
      return { valid: false, error: 'Tool parameters must be valid JSON.' };
    }
  }

  const value = {
    name,
    description,
    parameters,
    endpointUrl,
    httpMethod,
  };
  for (const key of ['id', 'createdAt', 'lastUpdated']) {
    if (typeof tool[key] === 'string' && tool[key].length <= 128) value[key] = tool[key];
  }

  return { valid: true, value };
}

/**
 * Normalize a profile record for storage or runtime resolution.
 * Incomplete profiles are retained so the Options page can show setup state.
 * @param {object} profile - Candidate profile record.
 * @returns {{valid: boolean, value?: object, error?: string}}
 */
export function normalizeProfileRecord(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { valid: false, error: 'Profile must be an object.' };
  }

  const id = String(profile.id || '').trim();
  const name = String(profile.name || '').trim();
  const provider = ['api', 'codex', 'hermes'].includes(profile.provider) ? profile.provider : 'api';
  const endpoint = String(profile.llmEndpoint || '').trim();
  const hermesEndpoint = String(
    profile.hermesEndpoint || (provider === 'hermes' ? profile.llmEndpoint : '') || ''
  ).trim();
  const hermesProfile = String(profile.hermesProfile || '').trim();
  const apiKey = String(profile.apiKey || '').trim();
  const modelName = String(profile.modelName || '').trim();
  const reasoningLevel = String(profile.reasoningLevel || '')
    .trim()
    .toLowerCase();
  const systemPrompt = String(profile.systemPrompt || '');

  if (!id || id.length > MAX_PROFILE_ID_LENGTH || name.length > MAX_PROFILE_NAME_LENGTH) {
    return { valid: false, error: 'Profile id and name are required and bounded.' };
  }
  if (provider === 'api' && endpoint && !isValidHttpUrl(endpoint)) {
    return { valid: false, error: 'Profile endpoint URL must use http or https.' };
  }
  if (provider === 'hermes' && hermesEndpoint && !isValidHttpUrl(hermesEndpoint)) {
    return { valid: false, error: 'Hermes endpoint URL must use http or https.' };
  }
  if (hermesProfile && !/^[A-Za-z0-9._-]{1,64}$/.test(hermesProfile)) {
    return { valid: false, error: 'Hermes profile name is invalid.' };
  }
  if (apiKey.length > MAX_API_KEY_LENGTH || modelName.length > MAX_MODEL_NAME_LENGTH) {
    return { valid: false, error: 'Profile credential or model name is too large.' };
  }
  if (systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    return { valid: false, error: 'Profile system prompt is too large.' };
  }
  if (reasoningLevel && !ALLOWED_REASONING_LEVELS.has(reasoningLevel)) {
    return { valid: false, error: 'Profile reasoning level is not supported.' };
  }

  const normalizedProfile = {
    id,
    name,
    provider,
    llmEndpoint: provider === 'api' ? endpoint : '',
    apiKey: provider === 'api' ? apiKey : '',
    modelName,
    systemPrompt,
    ...(provider === 'hermes' ? { hermesEndpoint, hermesProfile } : {}),
    ...(provider === 'hermes' && profile.hermesRemoteConfirmed === true
      ? { hermesRemoteConfirmed: true }
      : {}),
    ...(reasoningLevel ? { reasoningLevel } : {}),
    ...(typeof profile.lastUpdated === 'string' ? { lastUpdated: profile.lastUpdated } : {}),
  };

  return {
    valid: true,
    value: normalizedProfile,
  };
}

function normalizeRecordArray(value, label) {
  if (!Array.isArray(value) || value.length > MAX_BACKUP_ARRAY_ITEMS) {
    return { valid: false, error: `${label} must be a bounded array.` };
  }

  const records = [];
  for (const record of value) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return { valid: false, error: `${label} contains an invalid record.` };
    }
    let serialized;
    try {
      serialized = JSON.stringify(record);
    } catch (_) {
      return { valid: false, error: `${label} contains non-serializable data.` };
    }
    if (new TextEncoder().encode(serialized).byteLength > MAX_BACKUP_RECORD_BYTES) {
      return { valid: false, error: `${label} contains an oversized record.` };
    }
    records.push(JSON.parse(serialized));
  }
  return { valid: true, value: records };
}

/** Pinned quick actions are bounded, deduplicated string instruction IDs. */
function normalizePinArray(value, label) {
  if (!Array.isArray(value) || value.length > MAX_BACKUP_ARRAY_ITEMS) {
    return { valid: false, error: `${label} must be a bounded array.` };
  }
  const ids = [];
  const seen = new Set();
  for (const pin of value) {
    if (typeof pin !== 'string' || !pin.trim() || pin.length > 256 || seen.has(pin)) {
      continue;
    }
    seen.add(pin);
    ids.push(pin);
  }
  return { valid: true, value: ids };
}

function normalizeStorageArea(area, allowedKeys, areaName) {
  if (!area || typeof area !== 'object' || Array.isArray(area)) {
    return { valid: false, error: `${areaName} storage must be an object.` };
  }

  const result = {};
  const warnings = [];
  for (const key of Object.keys(area)) {
    if (!allowedKeys.includes(key)) {
      warnings.push(`Skipped unsupported ${areaName} key '${key}'.`);
      continue;
    }

    const value = area[key];
    if (key === 'profiles') {
      if (!Array.isArray(value)) return { valid: false, error: 'Profiles must be an array.' };
      const profiles = value.map((profile) => normalizeProfileRecord({ ...profile, apiKey: '' }));
      const invalid = profiles.find((entry) => !entry.valid);
      if (invalid) return { valid: false, error: invalid.error };
      result[key] = profiles.map((entry) => entry.value);
    } else if (key === 'promptPaulTools') {
      if (!Array.isArray(value)) return { valid: false, error: 'Tools must be an array.' };
      const tools = value.map(normalizeToolDefinition);
      const invalid = tools.find((entry) => !entry.valid);
      if (invalid) return { valid: false, error: invalid.error };
      result[key] = tools.map((entry) => entry.value);
    } else if (['instructions', 'customSkills', 'customSiteSuggestions'].includes(key)) {
      const records = normalizeRecordArray(value, key);
      if (!records.valid) return records;
      result[key] = records.value;
    } else if (key === 'pinnedQuickActions') {
      const pins = normalizePinArray(value, key);
      if (!pins.valid) return pins;
      result[key] = pins.value;
    } else if (
      [
        'analyticsConsent',
        'voiceInputEnabled',
        'webSearchEnabled',
        'pageActionsEnabled',
        'notchEnabled',
        'pageActionsTrustedMode',
        'pageActionsMultiTabEnabled',
        'darkTheme',
      ].includes(key)
    ) {
      if (typeof value !== 'boolean') return { valid: false, error: `${key} must be boolean.` };
      result[key] = value;
    } else if (key === 'themePreference') {
      if (!['light', 'dark', 'system'].includes(value)) {
        return { valid: false, error: 'themePreference must be light, dark, or system.' };
      }
      result[key] = value;
    } else if (key === 'notchPosition') {
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        return { valid: false, error: 'notchPosition must be a number from 0 to 100.' };
      }
      result[key] = value;
    } else if (key === 'notchPlacement') {
      if (!['top', 'right', 'bottom', 'left'].includes(value)) {
        return { valid: false, error: 'notchPlacement must be top, right, bottom, or left.' };
      }
      result[key] = value;
    } else if (['analyticsRotateAt', 'voiceInputPermissionLastChecked'].includes(key)) {
      if (!Number.isFinite(value)) return { valid: false, error: `${key} must be numeric.` };
      result[key] = value;
    } else {
      if (typeof value !== 'string' || value.length > MAX_API_KEY_LENGTH) {
        return { valid: false, error: `${key} must be a bounded string.` };
      }
      result[key] = value;
    }
  }

  return { valid: true, value: result, warnings };
}

/**
 * Validate and normalize a complete backup before writing it to Chrome storage.
 * Unknown keys are dropped and reported so future storage additions do not become
 * an unbounded import surface.
 * @param {object} backup - Parsed backup file.
 * @returns {{valid: boolean, value?: object, warnings?: string[], error?: string}}
 */
export function normalizeBackupPayload(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    return { valid: false, error: 'Backup must be a JSON object.' };
  }
  if (!backup.local && !backup.sync) {
    return { valid: false, error: 'Invalid backup format: missing storage data.' };
  }

  const local = backup.local
    ? normalizeStorageArea(backup.local, BACKUP_LOCAL_KEYS, 'local')
    : { valid: true, value: {}, warnings: [] };
  if (!local.valid) return local;

  const sync = backup.sync
    ? normalizeStorageArea(backup.sync, BACKUP_SYNC_KEYS, 'sync')
    : { valid: true, value: {}, warnings: [] };
  if (!sync.valid) return sync;

  return {
    valid: true,
    value: { timestamp: String(backup.timestamp || ''), local: local.value, sync: sync.value },
    warnings: [...(local.warnings || []), ...(sync.warnings || [])],
  };
}
