/**
 * @fileoverview Options Page for Prompt Paul Chrome Extension
 *
 * This module handles the options/configuration page including:
 * - API endpoint and key configuration
 * - Profile management (multiple API configurations)
 * - Custom instructions management
 * - Analytics consent settings
 *
 * @module options
 * @requires ./loadingManager.js
 * @requires ./src/utils/validation.js
 */

import { loadingManager } from './loadingManager.js';
import { setupPageActionSitePolicies } from './src/options/OptionsPageActions.js';
import { setupSkillHandlers } from './src/options/OptionsSkills.js';
import { setupInstructionHandlers as setupOptionsInstructionHandlers } from './src/options/OptionsInstructions.js';
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORTED_RECORDS } from './src/options/OptionsLimits.js';
import {
  BACKUP_LOCAL_KEYS,
  BACKUP_SYNC_KEYS,
  isValidHttpUrl,
  normalizeBackupPayload,
  normalizeProfileRecord,
  normalizeToolDefinition,
} from './src/utils/validation.js';
import { setupThemeToggle } from './themeUtils.js';
import { escapeHtml } from './src/utils/domSanitizer.js';
import { createUniqueId } from './src/utils/ids.js';
import { getHermesEndpoint, resolvePreferredProfile } from './src/utils/profileRouting.js';
import {
  applyCredentialMask,
  createDirtyTracker,
  initUnsavedGuard,
  announceDirtyChange,
  resolveCredentialValue,
  flashSaveFeedback,
  runErrorAwareSave,
  renderSetupStatus,
  endpointHost,
} from './src/options/OptionsUI.js';
import {
  getVoiceInputSettings as getStoredVoiceInputSettings,
  setVoiceInputSettings as setStoredVoiceInputSettings,
  isMicrophonePermissionDenied,
} from './src/chat/ChatVoice.js';
import {
  initializeDevDiagnostics,
  installDevErrorHandlers,
  recordDevDiagnostic,
} from './src/utils/devDiagnostics.js';

void initializeDevDiagnostics('options');
installDevErrorHandlers('options');

const VOICE_INPUT_ENABLED_KEY = 'voiceInputEnabled';
const VOICE_INPUT_PERMISSION_STATE_KEY = 'voiceInputPermissionState';
const VOICE_INPUT_PERMISSION_LAST_CHECKED_KEY = 'voiceInputPermissionLastChecked';

recordDevDiagnostic('options_loaded', {
  href: window.location.href,
  userAgent: navigator.userAgent,
});

// Starter configuration for first-time users. OpenRouter's free router provides
// a quick start, but users must configure their own API key.
const STARTER_OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const STARTER_OPENROUTER_API_KEY = '';
const STARTER_OPENROUTER_MODEL = 'openrouter/free';
const STARTER_SYSTEM_PROMPT = 'You are a helpful assistant.';

// Assigned in DOMContentLoaded; invoked from async load/save flows so the
// dirty trackers re-baseline after storage-backed fields are populated.
let markConnectionTrackerClean = null;
let markPrivacyTrackerClean = null;
let markGroundingTrackerClean = null;
let markPageActionsTrackerClean = null;
let markNotchTrackerClean = null;
let refreshSetupStatus = null;
let pendingDefaultApiKey = null;
let connectionStatusDirty = false;
let codexLoginPollTimer = null;
let modelLoadSequence = 0;
const modelMetadataByProfile = new Map();
const CUSTOM_MODEL_VALUE = '__custom__';
const DEFAULT_CODEX_REASONING_LEVEL = 'medium';

/**
 * Shows the Bootstrap confirmation modal and returns a promise that resolves to true/false.
 * @param {string} message - The message to display.
 * @param {string} [title='Confirm'] - The modal title.
 * @param {string} [confirmText='Confirm'] - The confirm button text.
 * @returns {Promise<boolean>}
 */
function showConfirmModal(message, title = 'Confirm', confirmText = 'Confirm') {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirm-modal-title');
    const messageEl = document.getElementById('confirm-modal-message');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    const Modal = window.bootstrap?.Modal;

    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn || !Modal) {
      console.error('Options: Confirmation modal is unavailable.');
      resolve(false);
      return;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = confirmText;

    let modalInstance = null;
    let settled = false;

    function cleanup() {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('hidden.bs.modal', onHidden);
    }

    function finish(confirmed) {
      if (settled) return;
      settled = true;
      cleanup();
      modalInstance.hide();
      resolve(confirmed);
    }

    function onOk() {
      finish(true);
    }

    function onCancel() {
      finish(false);
    }

    function onHidden() {
      finish(false);
    }

    try {
      modalInstance = Modal.getOrCreateInstance(modal);
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('hidden.bs.modal', onHidden);
      modalInstance.show();
    } catch (error) {
      console.error('Options: Unable to show confirmation modal:', error);
      cleanup();
      resolve(false);
    }
  });
}

function setChromeStorage(storageArea, values) {
  return new Promise((resolve, reject) => {
    storageArea.set(values, () => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message || 'Storage write failed.'));
      else resolve();
    });
  });
}

/**
 * Displays a status message to the user.
 * @param {string} message - The message to display.
 * @param {boolean} [isError=false] - Whether the message is an error.
 * @param {boolean} [isToast=false] - Whether to show as a toast notification.
 */
function showStatus(message, isError = false, isToast = false) {
  if (isToast) {
    // Only show toast notification when isToast is true
    if (isError) {
      loadingManager.showToast(message, 'error');
    } else {
      loadingManager.showToast(message, 'success');
    }
  } else {
    // Show status div message when isToast is false
    const status = document.getElementById('status');
    if (!status) {
      // No inline status element on this page. Fall back to a toast so the
      // message is still surfaced instead of throwing on a null element.
      loadingManager.showToast(message, isError ? 'error' : 'success');
      return;
    }
    status.textContent = message;
    status.className = `status ${isError ? 'error' : 'success'}`;
    status.style.display = 'block';

    let timeoutDuration = 2000; // Default timeout
    if (!isError) {
      // Apply timeout for success messages, but not errors
      setTimeout(() => {
        status.style.display = 'none';
      }, timeoutDuration);
    }
  }
}

function updateCurrentConfig(endpoint, key, model, timestamp, systemPrompt, profile) {
  document.getElementById('currentEndpoint').textContent = endpoint || 'Not set';
  document.getElementById('currentApiKey').textContent = key
    ? '********' + key.slice(-4)
    : 'Not set';
  document.getElementById('currentModelName').textContent = model || 'Not set';
  document.getElementById('lastUpdated').textContent = timestamp || 'Not set';
  document.getElementById('currentSystemPrompt').textContent = systemPrompt || 'Not set';
  const currentProfileElement = document.getElementById('currentProfile');
  if (currentProfileElement) {
    currentProfileElement.textContent = profile || 'Default'; // Display profile
  }
}

function getStoredProfiles() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['profiles'], (result) => resolve(result.profiles || []));
  });
}

async function resolveCodexProfileId() {
  const profiles = await getStoredProfiles();
  const existing = profiles.find((profile) => profile.provider === 'codex');
  if (existing) return existing.id;

  let profileId = 'codex';
  while (profiles.some((profile) => profile.id === profileId)) {
    profileId = `codex_${Date.now()}`;
  }
  return profileId;
}

async function ensureCodexProfile(profileId) {
  let profiles = await getStoredProfiles();
  let profile = profiles.find((entry) => entry.id === profileId);
  if (!profile) {
    profile = {
      id: profileId,
      name: 'Codex',
      provider: 'codex',
      llmEndpoint: '',
      apiKey: '',
      modelName: '',
      reasoningLevel: DEFAULT_CODEX_REASONING_LEVEL,
      systemPrompt: STARTER_SYSTEM_PROMPT,
      lastUpdated: new Date().toLocaleString(),
    };
    profiles.push(profile);
  } else {
    profile.provider = 'codex';
    profile.name = 'Codex';
    profile.llmEndpoint = '';
    profile.apiKey = '';
    if (!profile.reasoningLevel) profile.reasoningLevel = DEFAULT_CODEX_REASONING_LEVEL;
    profile.lastUpdated = new Date().toLocaleString();
  }

  // P2-07: keep the profiles write-back capped at the same bound restore accepts.
  profiles = profiles.slice(0, MAX_IMPORTED_RECORDS);
  await new Promise((resolve, reject) => {
    chrome.storage.local.set({ profiles, lastSelectedProfileId: profileId }, () =>
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()
    );
  });
  return profile;
}

function selectedModelValue() {
  const modelSelect = document.getElementById('modelName');
  if (!modelSelect) return '';
  if (modelSelect.value === CUSTOM_MODEL_VALUE) {
    return document.getElementById('customModelName')?.value.trim() || '';
  }
  return modelSelect.value.trim();
}

function setCustomModelVisibility(show) {
  const input = document.getElementById('customModelName');
  if (input) input.classList.toggle('d-none', !show);
}

function setModelSelection(modelName) {
  const modelSelect = document.getElementById('modelName');
  if (!modelSelect) return;
  const value = String(modelName || '').trim();
  const option = Array.from(modelSelect.options || []).find((entry) => entry.value === value);
  if (value && option) {
    modelSelect.value = value;
    setCustomModelVisibility(false);
    return;
  }
  const customOption = Array.from(modelSelect.options || []).find(
    (entry) => entry.value === CUSTOM_MODEL_VALUE
  );
  if (customOption) {
    modelSelect.value = CUSTOM_MODEL_VALUE;
    const input = document.getElementById('customModelName');
    if (input) input.value = value;
    setCustomModelVisibility(true);
  } else if (value) {
    const savedOption = document.createElement('option');
    savedOption.value = value;
    savedOption.textContent = `${value} (saved)`;
    modelSelect.appendChild(savedOption);
    modelSelect.value = value;
    setCustomModelVisibility(false);
  }
}

function updateReasoningOptions(profileId, modelId, savedLevel = '') {
  const group = document.getElementById('reasoningLevelGroup');
  const select = document.getElementById('reasoningLevel');
  if (document.getElementById('providerSelect')?.value !== 'codex') {
    if (group) group.classList.add('d-none');
    return;
  }
  const metadata = modelMetadataByProfile.get(profileId)?.get(modelId);
  const levels = metadata?.reasoningLevels || [];
  if (!group || !select || !levels.length) {
    if (group) group.classList.add('d-none');
    return;
  }

  const current = String(savedLevel || select.value || metadata.defaultReasoningLevel || '').trim();
  select.innerHTML = '';
  levels.forEach((level) => {
    const option = document.createElement('option');
    option.value = level.value;
    option.textContent = level.description ? `${level.label}: ${level.description}` : level.label;
    select.appendChild(option);
  });
  select.value = levels.some((level) => level.value === current)
    ? current
    : metadata.defaultReasoningLevel || levels[0].value;
  group.classList.remove('d-none');
}

function showSavedModelFallback(profile, label = 'Model list unavailable') {
  const modelSelect = document.getElementById('modelName');
  if (!modelSelect) return;
  document.getElementById('reasoningLevelGroup')?.classList.add('d-none');
  modelSelect.innerHTML = `<option value="">${label}</option>`;
  const customOption = document.createElement('option');
  customOption.value = CUSTOM_MODEL_VALUE;
  customOption.textContent = 'Enter model ID manually…';
  modelSelect.appendChild(customOption);
  if (profile.modelName) {
    const savedOption = document.createElement('option');
    savedOption.value = profile.modelName;
    savedOption.textContent = `${profile.modelName} (saved)`;
    modelSelect.appendChild(savedOption);
  }
  setModelSelection(profile.modelName || '');
}

async function persistProfileModelSettings(profileId, modelName, reasoningLevel) {
  const profiles = await getStoredProfiles();
  const profile = profiles.find((entry) => entry.id === profileId);
  if (!profile) return;
  profile.modelName = modelName;
  if (reasoningLevel) profile.reasoningLevel = reasoningLevel;
  profile.lastUpdated = new Date().toLocaleString();
  await new Promise((resolve) => chrome.storage.local.set({ profiles }, resolve));
}

async function loadAvailableModels(profile) {
  const sequence = ++modelLoadSequence;
  const modelSelect = document.getElementById('modelName');
  if (!modelSelect || !profile?.id) return;
  modelSelect.disabled = true;
  modelSelect.innerHTML = '<option value="">Loading models…</option>';
  setCustomModelVisibility(false);
  if (profile.provider === 'hermes') {
    modelSelect.innerHTML = '<option value="">Hermes gateway default model</option>';
    modelSelect.value = '';
    modelSelect.disabled = false;
    updateReasoningOptions(profile.id, '', '');
    return;
  }

  try {
    if (profile.provider === 'codex') {
      const status = await chrome.runtime.sendMessage({
        action: 'codexAuthStatus',
        profileId: profile.id,
      });
      if (!status?.status?.connected) {
        showSavedModelFallback(profile, 'Sign in to load models');
        return;
      }
    } else if (!profile.apiKey || !profile.llmEndpoint) {
      showSavedModelFallback(profile, 'Save API settings to load models');
      return;
    }
    const response = await chrome.runtime.sendMessage({
      action: 'getAvailableModels',
      profileId: profile.id,
    });
    if (sequence !== modelLoadSequence) return;
    if (!response?.success) throw new Error(response?.error || 'Unable to load models.');

    const models = response.models || [];
    if (!models.length) {
      throw new Error(
        profile.provider === 'codex'
          ? 'No visible Codex models were returned for this account.'
          : 'No models were returned by this endpoint.'
      );
    }
    const metadata = new Map(
      models.map((model) => [model.id, { ...model, endpoint: profile.llmEndpoint }])
    );
    modelMetadataByProfile.set(profile.id, metadata);
    modelSelect.innerHTML = '';
    models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent =
        model.displayName === model.id ? model.id : `${model.displayName} (${model.id})`;
      modelSelect.appendChild(option);
    });
    if (profile.provider !== 'codex') {
      const customOption = document.createElement('option');
      customOption.value = CUSTOM_MODEL_VALUE;
      customOption.textContent = 'Custom model ID…';
      modelSelect.appendChild(customOption);
    }
    setModelSelection(profile.modelName || models[0]?.id || '');
    const selected = selectedModelValue();
    const selectedMetadata = metadata.get(selected);
    updateReasoningOptions(profile.id, selected, profile.reasoningLevel);
    if (profile.provider === 'codex' && selected && selected !== profile.modelName) {
      await persistProfileModelSettings(
        profile.id,
        selected,
        selectedMetadata?.defaultReasoningLevel ||
          profile.reasoningLevel ||
          DEFAULT_CODEX_REASONING_LEVEL
      );
    }
  } catch (error) {
    if (sequence !== modelLoadSequence) return;
    showSavedModelFallback(profile);
    updateReasoningOptions(profile.id, profile.modelName, profile.reasoningLevel);
    showStatus(
      `${error.message} Select “Enter model ID manually…” to continue, or reconnect Codex and refresh.`,
      true
    );
  } finally {
    if (sequence === modelLoadSequence) modelSelect.disabled = false;
  }
}

function syncDeleteProfileButtonState(selectedProfileId = null) {
  const profileSelectElement = document.getElementById('profileSelect');
  const deleteProfileButton = document.getElementById('deleteProfileButton');

  if (!profileSelectElement || !deleteProfileButton) {
    return;
  }

  const selectedId = selectedProfileId || profileSelectElement.value;
  deleteProfileButton.disabled = selectedId === 'default' || selectedId === 'add_new_profile';
}

function providerLabel(provider) {
  return (
    {
      api: 'API connection',
      codex: 'ChatGPT subscription',
      hermes: 'Hermes gateway',
    }[provider] || 'Connection'
  );
}

function updateProfileSummary(profile) {
  const badge = document.getElementById('profileProviderBadge');
  const state = document.getElementById('profileStateText');
  const provider = profile?.provider || 'api';
  if (badge) {
    badge.textContent = providerLabel(provider);
    badge.className = `ext-badge ${provider === 'hermes' ? 'ext-badge--warning' : 'ext-badge--info'}`;
  }
  if (state) {
    state.textContent = `${providerLabel(provider)} settings are saved per profile.`;
  }
}

function requestNewProfile(defaultName = 'New connection') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'profile-name-dialog-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'profile-name-dialog';
    dialog.innerHTML = `
      <h3>Create connection profile</h3>
      <label for="newProfileNameInput">Profile name</label>
      <input id="newProfileNameInput" class="form-control" value="${escapeHtml(defaultName)}" />
      <label for="newProfileProviderInput" class="mt-3">Connection type</label>
      <select id="newProfileProviderInput" class="form-select">
        <option value="api">API key / compatible endpoint</option>
        <option value="codex">ChatGPT subscription</option>
        <option value="hermes">Hermes Agent gateway</option>
      </select>
      <div class="profile-name-dialog-actions">
        <button type="button" class="btn btn-outline-secondary profile-name-cancel">Cancel</button>
        <button type="button" class="btn btn-primary profile-name-confirm">Create</button>
      </div>
    `;
    const input = dialog.querySelector('#newProfileNameInput');
    const providerInput = dialog.querySelector('#newProfileProviderInput');
    const confirm = dialog.querySelector('.profile-name-confirm');
    const cancel = dialog.querySelector('.profile-name-cancel');

    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    input.focus();
    input.select();

    confirm.addEventListener('click', () =>
      finish({ name: input.value, provider: providerInput.value })
    );
    cancel.addEventListener('click', () => finish({ name: '', provider: '' }));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish({ name: input.value, provider: providerInput.value });
      if (event.key === 'Escape') finish({ name: '', provider: '' });
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish({ name: '', provider: '' });
    });
  });
}

/**
 * Validates the required API configuration inputs.
 * @param {string} endpoint - The LLM API endpoint URL.
 * @param {string} key - The API key.
 * @param {string} model - The model name.
 * @returns {boolean} True if all inputs are valid, false otherwise.
 */
function validateInputs(endpoint, key, model) {
  let isValid = true;
  const errors = [];

  // Clear previous error states
  clearFieldErrors();

  // Validate endpoint
  if (!endpoint) {
    errors.push('API endpoint is required');
    setFieldError('llmEndpoint', 'API endpoint is required');
    isValid = false;
  } else {
    if (!isValidHttpUrl(endpoint)) {
      errors.push('Please enter a valid HTTP(S) URL for the API endpoint');
      setFieldError('llmEndpoint', 'Endpoint must use http or https');
      isValid = false;
    }
  }

  // Validate API key
  if (!key) {
    errors.push('API key is required');
    setFieldError('apiKey', 'API key is required');
    isValid = false;
  }

  // Validate model name
  if (!model) {
    errors.push('Model name is required');
    setFieldError('modelName', 'Model name is required');
    isValid = false;
  }

  if (!isValid) {
    showStatus(errors.join('. '), true);
  }

  return isValid;
}

function updateCodexConnectionControls(provider, profileId) {
  const isCodex = provider === 'codex';
  const isHermes = provider === 'hermes';
  const providerSelect = document.getElementById('providerSelect');
  const panel = document.getElementById('codexConnectionPanel');
  const apiFields = document.getElementById('apiConnectionFields');
  const hermesPanel = document.getElementById('hermesConnectionPanel');
  const hermesRemote = document.getElementById('hermesRemoteConfirmed');
  const endpoint = document.getElementById('llmEndpoint');
  const apiKey = document.getElementById('apiKey');
  const apiKeyLabelText = document.getElementById('apiKeyLabelText');
  const apiKeyHint = document.getElementById('apiKeyHint');
  if (panel) panel.classList.toggle('d-none', !isCodex);
  if (apiFields) apiFields.classList.toggle('d-none', isCodex);
  if (hermesPanel) hermesPanel.classList.toggle('d-none', !isHermes);
  if (hermesRemote && !isHermes) hermesRemote.checked = false;
  if (endpoint) endpoint.required = !isCodex;
  if (apiKey) apiKey.required = provider === 'api' && apiKey.dataset.configured !== 'true';
  if (endpoint) {
    endpoint.placeholder = isHermes
      ? 'http://127.0.0.1:8642'
      : 'https://your-llm-provider.example/v1/chat/completions';
  }
  if (apiKey) apiKey.placeholder = isHermes ? 'Optional Hermes API key' : 'sk-...';
  if (apiKeyLabelText) apiKeyLabelText.textContent = isHermes ? 'API Key (optional)' : 'API Key';
  if (apiKeyHint) apiKeyHint.classList.toggle('d-none', !isHermes);
  const modelSelect = document.getElementById('modelName');
  if (modelSelect) modelSelect.required = !isCodex && !isHermes;
  const modelControls = document.getElementById('providerModelControls');
  if (modelControls) modelControls.classList.toggle('d-none', isHermes);
  const refreshButton = document.getElementById('refreshModelsButton');
  if (refreshButton) refreshButton.disabled = isHermes;
  const revertButton = document.getElementById('revertDefaultsButton');
  if (revertButton) {
    revertButton.classList.toggle('d-none', !(!isCodex && !isHermes));
  }
  if (providerSelect) {
    providerSelect.disabled = Boolean(profileId && profileId !== 'add_new_profile');
    providerSelect.title = providerSelect.disabled
      ? 'Create a new connection profile to use another connection type.'
      : '';
  }
  if (!isCodex || !profileId) return;

  chrome.runtime
    .sendMessage({ action: 'codexAuthStatus', profileId })
    .then((response) => {
      const status = response?.status || {};
      const text = document.getElementById('codexConnectionStatus');
      const connect = document.getElementById('connectCodexButton');
      const disconnect = document.getElementById('disconnectCodexButton');
      if (text) {
        text.textContent = status.connected
          ? `Connected${status.email ? ` as ${status.email}` : ''}${status.planType ? ` (${status.planType})` : ''}.`
          : 'Not connected.';
      }
      if (connect) connect.textContent = status.connected ? 'Reconnect' : 'Sign in with ChatGPT';
      if (disconnect) disconnect.classList.toggle('d-none', !status.connected);
    })
    .catch(() => {});
}

async function startCodexLogin() {
  const profileId = await resolveCodexProfileId();
  const response = await chrome.runtime.sendMessage({ action: 'codexLoginStart', profileId });
  if (!response?.success) throw new Error(response?.error || 'Unable to start Codex sign-in.');
  const code = document.getElementById('codexDeviceCode');
  if (code) {
    code.textContent = `Enter ${response.login.userCode} at ${response.login.verificationUrl}. Waiting for approval...`;
    code.classList.remove('d-none');
  }
  if (codexLoginPollTimer) clearInterval(codexLoginPollTimer);
  const poll = async () => {
    const result = await chrome.runtime.sendMessage({ action: 'codexLoginPoll', profileId });
    if (!result?.success) throw new Error(result?.error || 'Codex sign-in failed.');
    if (result.pending) return;
    clearInterval(codexLoginPollTimer);
    codexLoginPollTimer = null;
    if (code) code.classList.add('d-none');
    await ensureCodexProfile(profileId);
    loadOptions();
    updateCodexConnectionControls('codex', profileId);
    showStatus('Codex subscription connected.', false, true);
  };
  codexLoginPollTimer = setInterval(
    () =>
      poll().catch((error) => {
        clearInterval(codexLoginPollTimer);
        codexLoginPollTimer = null;
        showStatus(error.message, true);
      }),
    Math.max(response.login.intervalSeconds, 1) * 1000
  );
  await poll();
}

/**
 * Sets visual error state on a specific field.
 * @param {string} fieldId - The ID of the input field.
 * @param {string} message - The error message to display.
 */
function setFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (field) {
    field.classList.add('error');
    field.setAttribute('aria-invalid', 'true');

    // Create or update error message element
    let errorEl = document.getElementById(`${fieldId}Error`);
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
  }
}

/**
 * Clears all field error states.
 */
function clearFieldErrors() {
  const fields = ['llmEndpoint', 'apiKey', 'modelName'];
  fields.forEach((fieldId) => {
    const field = document.getElementById(fieldId);
    if (field) {
      field.classList.remove('error');
      field.removeAttribute('aria-invalid');
    }
    const errorEl = document.getElementById(`${fieldId}Error`);
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
  });
}

/**
 * Saves the current options to Chrome storage.
 * @param {Event} e - The form submit event.
 * @returns {void}
 */
function saveOptions(e) {
  e.preventDefault();

  const profileSelectElement = document.getElementById('profileSelect');
  if (!profileSelectElement) {
    console.error('profileSelect element is missing in the DOM.');
    showStatus('Error: profileSelect element is missing. Please reload the page.', true);
    return;
  }
  const selectedProfileId = profileSelectElement.value; // No trim, could be 'add_new_profile'
  const provider = document.getElementById('providerSelect')?.value || 'api';

  const llmEndpoint = document.getElementById('llmEndpoint');
  if (!llmEndpoint) {
    console.error('llmEndpoint element is missing in the DOM.');
    showStatus('Error: llmEndpoint element is missing. Please reload the page.', true);
    return;
  }
  const llmEndpointValue = llmEndpoint.value.trim();

  const apiKey = document.getElementById('apiKey');
  if (!apiKey) {
    console.error('apiKey element is missing in the DOM.');
    showStatus('Error: apiKey element is missing. Please reload the page.', true);
    return;
  }
  const apiKeyValue = apiKey.value.trim();
  const apiKeyIsMaskedConfigured = apiKey.dataset.configured === 'true';
  const hasConfiguredCredential = apiKeyIsMaskedConfigured || Boolean(pendingDefaultApiKey);
  const hermesProfileValue = document.getElementById('hermesProfile')?.value.trim() || '';
  const hermesRemoteConfirmed = document.getElementById('hermesRemoteConfirmed')?.checked === true;

  const modelName = document.getElementById('modelName');
  if (!modelName) {
    console.error('modelName element is missing in the DOM.');
    showStatus('Error: modelName element is missing. Please reload the page.', true);
    return;
  }
  const modelNameValue = selectedModelValue();
  const reasoningLevelValue = document.getElementById('reasoningLevel')?.value || '';

  const systemPrompt = document.getElementById('systemPrompt');
  if (!systemPrompt) {
    console.error('systemPrompt element is missing in the DOM.');
    showStatus('Error: systemPrompt element is missing. Please reload the page.', true);
    return;
  }
  const systemPromptValue = systemPrompt.value.trim();

  if (
    provider === 'api' &&
    !validateInputs(
      llmEndpointValue,
      apiKeyValue || (hasConfiguredCredential ? 'configured' : ''),
      modelNameValue
    )
  ) {
    return;
  }
  if (provider === 'hermes' && (!llmEndpointValue || !isValidHttpUrl(llmEndpointValue))) {
    setFieldError('llmEndpoint', 'Enter the Hermes gateway URL.');
    showStatus('Hermes gateway endpoint is required.', true);
    return;
  }
  if (
    provider === 'hermes' &&
    hermesProfileValue &&
    !/^[A-Za-z0-9._-]{1,64}$/.test(hermesProfileValue)
  ) {
    showStatus('Hermes profile must use letters, numbers, dots, underscores, or hyphens.', true);
    return;
  }

  // Disable save button while saving
  const saveButton = document.getElementById('save');
  saveButton.disabled = true;

  // Save to local storage profiles. Hermes credentials are background-owned
  // and written via the background worker, never read or written here.
  chrome.storage.local.get(['profiles'], (result) => {
    let profiles = result.profiles || [];
    let profileToUpdate = profiles.find((p) => p.id === selectedProfileId);
    const storedApiKey = profileToUpdate?.apiKey || '';
    const effectiveStoredApiKey =
      provider === 'hermes' ? '' : pendingDefaultApiKey || storedApiKey || '';
    const credentialIsConfigured = apiKeyIsMaskedConfigured || Boolean(effectiveStoredApiKey);
    const resolvedCredential = resolveCredentialValue(
      apiKeyValue,
      credentialIsConfigured,
      effectiveStoredApiKey
    );
    profileToUpdate = profileToUpdate ? { ...profileToUpdate } : null;
    if (!profileToUpdate) {
      profileToUpdate = {
        id: selectedProfileId,
        name: selectedProfileId === 'default' ? 'Default' : 'New Profile ' + Date.now(),
        provider,
        llmEndpoint: provider === 'api' ? llmEndpointValue : '',
        apiKey: provider === 'api' ? resolvedCredential : '',
        hermesEndpoint: provider === 'hermes' ? llmEndpointValue : '',
        hermesProfile: provider === 'hermes' ? hermesProfileValue : '',
        hermesRemoteConfirmed: provider === 'hermes' && hermesRemoteConfirmed,
        modelName: provider === 'hermes' ? '' : modelNameValue,
        reasoningLevel: reasoningLevelValue,
        systemPrompt: systemPromptValue,
        lastUpdated: new Date().toLocaleString(),
      };
      profiles.push(profileToUpdate);
    } else {
      profileToUpdate.provider = provider;
      profileToUpdate.llmEndpoint = provider === 'api' ? llmEndpointValue : '';
      profileToUpdate.apiKey = provider === 'api' ? resolvedCredential : '';
      profileToUpdate.hermesEndpoint = provider === 'hermes' ? llmEndpointValue : '';
      profileToUpdate.hermesProfile = provider === 'hermes' ? hermesProfileValue : '';
      profileToUpdate.hermesRemoteConfirmed = provider === 'hermes' && hermesRemoteConfirmed;
      profileToUpdate.modelName = provider === 'hermes' ? '' : modelNameValue;
      profileToUpdate.reasoningLevel = reasoningLevelValue;
      profileToUpdate.systemPrompt = systemPromptValue;
      profileToUpdate.lastUpdated = new Date().toLocaleString();
    }

    const discoveredModel = modelMetadataByProfile.get(selectedProfileId)?.get(modelNameValue);
    if (
      discoveredModel?.endpoint === profileToUpdate.llmEndpoint &&
      typeof discoveredModel?.supportsTools === 'boolean'
    ) {
      profileToUpdate.modelToolSupport = {
        modelName: modelNameValue,
        endpoint: profileToUpdate.llmEndpoint,
        supportsTools: discoveredModel.supportsTools,
      };
    } else if (
      profileToUpdate.modelToolSupport?.modelName !== modelNameValue ||
      profileToUpdate.modelToolSupport?.endpoint !== profileToUpdate.llmEndpoint
    ) {
      delete profileToUpdate.modelToolSupport;
    }
    const normalizedProfile = normalizeProfileRecord(profileToUpdate);
    if (!normalizedProfile.valid) {
      saveButton.disabled = false;
      showStatus(`Unable to save profile: ${normalizedProfile.error}`, true);
      return;
    }
    const profileIndex = profiles.findIndex((profile) => profile.id === selectedProfileId);
    if (profileIndex < 0) {
      saveButton.disabled = false;
      showStatus('Unable to save profile: the selected profile was not found.', true);
      return;
    }
    profiles[profileIndex] = normalizedProfile.value;
    profileToUpdate = normalizedProfile.value;
    // P2-07: keep the profiles write-back capped at the same bound restore accepts.
    profiles = profiles.slice(0, MAX_IMPORTED_RECORDS);

    chrome.storage.local.set(
      {
        profiles: profiles,
        lastSelectedProfileId: selectedProfileId,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error(
            'Options: Error saving profile settings to local storage:',
            chrome.runtime.lastError
          );
          showStatus('Error saving profile settings: ' + chrome.runtime.lastError.message, true);
        } else {
          showStatus(`Settings for profile '${profileToUpdate.name}' saved.`);
          flashSaveFeedback(saveButton, false);
          // P2-10: keep Hermes credential writes background-owned. A nonempty
          // typed key is stored; an explicitly cleared field removes the key;
          // a masked (unchanged) field leaves the existing key in place.
          let hermesKeyAction = Promise.resolve();
          if (provider === 'hermes') {
            if (apiKeyValue) {
              hermesKeyAction = chrome.runtime
                .sendMessage({
                  action: 'hermesKeySet',
                  profileId: selectedProfileId,
                  value: apiKeyValue,
                })
                .then((res) => {
                  if (!res?.success) throw new Error(res?.error || 'Failed to store Hermes key.');
                });
            } else if (!apiKeyIsMaskedConfigured) {
              hermesKeyAction = chrome.runtime
                .sendMessage({ action: 'hermesKeyRemove', profileId: selectedProfileId })
                .then((res) => {
                  if (!res?.success) throw new Error(res?.error || 'Failed to clear Hermes key.');
                });
            }
          } else {
            hermesKeyAction = chrome.runtime
              .sendMessage({ action: 'hermesKeyRemove', profileId: selectedProfileId })
              .then((res) => {
                if (!res?.success) throw new Error(res?.error || 'Failed to clear Hermes key.');
              });
          }
          // Hermes key sync runs after the profile record saves so the profile
          // and its credential stay consistent even across slow storage writes.
          hermesKeyAction.catch((error) => {
            console.error('Options: Error syncing Hermes credential:', error);
          });
          // Reload options to reflect changes, especially if it was a new profile or name changed
          pendingDefaultApiKey = null;
          loadOptions();
          if (markConnectionTrackerClean) markConnectionTrackerClean();
          if (refreshSetupStatus) refreshSetupStatus();
        }
        saveButton.disabled = false;
      }
    );
  });
}

/**
 * Loads settings for a specific profile from Chrome storage.
 * @param {string} profileId - The ID of the profile to load.
 * @returns {void}
 */
function loadProfileSettings(profileId) {
  pendingDefaultApiKey = null;
  chrome.storage.local.get(['profiles'], (result) => {
    const profiles = result.profiles || [];
    const selectedProfile =
      profiles.find((p) => p.id === profileId) || profiles.find((p) => p.id === 'default');

    if (selectedProfile) {
      const providerSelect = document.getElementById('providerSelect');
      if (providerSelect) providerSelect.value = selectedProfile.provider || 'api';
      updateProfileSummary(selectedProfile);
      document.getElementById('llmEndpoint').value =
        selectedProfile.provider === 'hermes'
          ? getHermesEndpoint(selectedProfile)
          : selectedProfile.llmEndpoint || '';
      const hermesProfileInput = document.getElementById('hermesProfile');
      if (hermesProfileInput) hermesProfileInput.value = selectedProfile.hermesProfile || '';
      const hermesRemoteInput = document.getElementById('hermesRemoteConfirmed');
      if (hermesRemoteInput) {
        hermesRemoteInput.checked = selectedProfile.hermesRemoteConfirmed === true;
      }
      const configuredCredential =
        selectedProfile.provider === 'hermes' ? false : Boolean(selectedProfile.apiKey);
      applyCredentialMask(document.getElementById('apiKey'), configuredCredential);
      // P2-10: Hermes credential status is queried from the background worker
      // (which owns the key store) and never read from the storage map here.
      if (selectedProfile.provider === 'hermes') {
        chrome.runtime
          .sendMessage({ action: 'hermesKeyStatus', profileId: selectedProfile.id })
          .then((response) => {
            applyCredentialMask(
              document.getElementById('apiKey'),
              response?.success && response.configured === true
            );
          })
          .catch(() => {});
      }
      const modelSelect = document.getElementById('modelName');
      if (modelSelect) {
        modelSelect.innerHTML = '<option value="">Loading models…</option>';
        modelSelect.value = '';
      }
      const customModelInput = document.getElementById('customModelName');
      if (customModelInput) customModelInput.value = '';
      const reasoningSelect = document.getElementById('reasoningLevel');
      if (reasoningSelect) reasoningSelect.value = selectedProfile.reasoningLevel || '';
      document.getElementById('systemPrompt').value = selectedProfile.systemPrompt || '';

      updateCurrentConfig(
        selectedProfile.provider === 'hermes'
          ? getHermesEndpoint(selectedProfile)
          : selectedProfile.llmEndpoint,
        configuredCredential ? 'configured' : selectedProfile.apiKey,
        selectedProfile.modelName,
        selectedProfile.lastUpdated || new Date().toLocaleString(),
        selectedProfile.systemPrompt,
        selectedProfile.name
      );
      updateCodexConnectionControls(selectedProfile.provider || 'api', selectedProfile.id);
      loadAvailableModels(selectedProfile).then(() => {
        // Establish the connection baseline only after its own async load
        // (profile fields + delayed model list) settles.
        if (markConnectionTrackerClean) markConnectionTrackerClean();
      });
    }
  });
}

// Load saved options
function loadOptions() {
  const profileSelectElement = document.getElementById('profileSelect');

  // Function to populate profile dropdown
  function populateProfileDropdown(profiles, selectedProfileId) {
    profileSelectElement.innerHTML = ''; // Clear existing options

    // Add a "Add New Profile" option
    const addNewOption = document.createElement('option');
    addNewOption.value = 'add_new_profile';
    addNewOption.textContent = '+ Add New Profile...';
    profileSelectElement.appendChild(addNewOption);

    const defaultProfile = profiles.find((profile) => profile.id === 'default');
    const defaultOption = document.createElement('option');
    defaultOption.value = 'default';
    defaultOption.textContent = `Default · ${providerLabel(defaultProfile?.provider || 'api')}`;
    profileSelectElement.appendChild(defaultOption);

    if (profiles && profiles.length > 0) {
      profiles.forEach((profile) => {
        if (profile.id === 'default') return; // Skip default if already added
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = `${profile.name} · ${providerLabel(profile.provider)}`;
        profileSelectElement.appendChild(option);
      });
    }
    profileSelectElement.value = selectedProfileId || 'default';
    syncDeleteProfileButtonState(profileSelectElement.value);
  }

  // Load profiles and the last selected profile ID from storage
  chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
    let profiles = result.profiles || [];
    const lastSelectedProfileId = result.lastSelectedProfileId || 'default';

    // Ensure default profile exists
    if (!profiles.find((p) => p.id === 'default')) {
      const defaultProfile = {
        id: 'default',
        name: 'Default',
        provider: 'api',
        llmEndpoint: STARTER_OPENROUTER_ENDPOINT,
        apiKey: STARTER_OPENROUTER_API_KEY,
        modelName: STARTER_OPENROUTER_MODEL,
        systemPrompt: STARTER_SYSTEM_PROMPT,
        lastUpdated: new Date().toLocaleString(),
      };
      const normalizedDefaultProfile = normalizeProfileRecord(defaultProfile);
      if (normalizedDefaultProfile.valid) profiles.push(normalizedDefaultProfile.value);
      chrome.storage.local.set({ profiles: profiles }, () => {
        if (chrome.runtime.lastError) {
          console.error('Options: Error saving default profile:', chrome.runtime.lastError);
        }
      }); // Save updated profiles array
    }

    populateProfileDropdown(profiles, lastSelectedProfileId);
    loadProfileSettings(lastSelectedProfileId); // Load settings for the last selected or default profile
  });
}

// Add event listeners
document.addEventListener('DOMContentLoaded', () => {
  loadOptions(); // This will now also populate profiles and set up listener

  // Chat-led setup status (Get Started banner)
  const setupStatusText = document.getElementById('setup-status-text');
  const setupStatusIcon = document.getElementById('setup-status-icon');
  const setupStatusAction = document.getElementById('setup-status-action');
  // P2-16: run a bounded Hermes connection check and only report Connected on
  // a successful result. Never infer a verified connection from fields/endpoint
  // alone; untested saved settings are labelled Configured instead.
  const runHermesConnectionCheck = (profile) => {
    renderSetupStatus(
      setupStatusText,
      setupStatusIcon,
      {
        configured: true,
        provider: 'hermes',
        model: profile.modelName,
        endpointHost: endpointHost(getHermesEndpoint(profile)),
        onRetry: () => runHermesConnectionCheck(profile),
        retryLabel: 'Testing…',
      },
      setupStatusAction
    );
    chrome.runtime
      .sendMessage({ action: 'testHermesConnection', profileId: profile.id })
      .then((response) => {
        if (response?.success) {
          renderSetupStatus(
            setupStatusText,
            setupStatusIcon,
            {
              connected: true,
              provider: 'hermes',
              model: profile.modelName,
              endpointHost: endpointHost(getHermesEndpoint(profile)),
            },
            setupStatusAction
          );
        } else {
          renderSetupStatus(
            setupStatusText,
            setupStatusIcon,
            {
              configured: true,
              error: response?.error || 'The Hermes gateway did not respond.',
              provider: 'hermes',
              model: profile.modelName,
              endpointHost: endpointHost(getHermesEndpoint(profile)),
              onRetry: () => runHermesConnectionCheck(profile),
              retryLabel: 'Retry',
            },
            setupStatusAction
          );
        }
      })
      .catch(() => {
        renderSetupStatus(
          setupStatusText,
          setupStatusIcon,
          {
            configured: true,
            error: 'Could not reach the Hermes gateway.',
            provider: 'hermes',
            model: profile.modelName,
            endpointHost: endpointHost(getHermesEndpoint(profile)),
            onRetry: () => runHermesConnectionCheck(profile),
            retryLabel: 'Retry',
          },
          setupStatusAction
        );
      });
  };
  refreshSetupStatus = () => {
    chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
      const profiles = result.profiles || [];
      const selectedId = result.lastSelectedProfileId || 'default';
      const profile =
        resolvePreferredProfile({
          selectedProfile: profiles.find((p) => p.id === selectedId),
          defaultProfile: profiles.find((p) => p.id === 'default'),
        }) || {};
      const provider = profile.provider;
      const endpoint = provider === 'hermes' ? getHermesEndpoint(profile) : profile.llmEndpoint;
      const configured =
        provider === 'codex'
          ? false
          : provider === 'hermes'
            ? Boolean(endpoint)
            : Boolean(profile.llmEndpoint && profile.apiKey && profile.modelName);
      const base = {
        configured,
        provider,
        model: profile.modelName,
        endpointHost: endpointHost(endpoint),
      };
      if (provider === 'codex') {
        chrome.runtime
          .sendMessage({ action: 'codexAuthStatus', profileId: profile.id })
          .then((response) => {
            renderSetupStatus(
              setupStatusText,
              setupStatusIcon,
              {
                connected: response?.status?.connected === true,
                configured: false,
                provider: 'codex',
                model: profile.modelName,
                endpointHost: 'ChatGPT subscription',
              },
              setupStatusAction
            );
          })
          .catch(() =>
            renderSetupStatus(setupStatusText, setupStatusIcon, base, setupStatusAction)
          );
        return;
      }
      if (provider === 'hermes' && configured && !connectionStatusDirty) {
        runHermesConnectionCheck(profile);
        return;
      }
      // API profiles (no bounded check) and dirty/unsaved settings stay
      // Configured; they never show a verified Connected state.
      renderSetupStatus(setupStatusText, setupStatusIcon, base, setupStatusAction);
    });
  };
  refreshSetupStatus();

  const openChatButton = document.getElementById('openChatButton');
  if (openChatButton) {
    openChatButton.addEventListener('click', () => {
      try {
        chrome.sidePanel
          .open({ windowId: chrome.windows.WINDOW_ID_CURRENT })
          .catch((error) => showStatus('Could not open chat: ' + error.message, true, true));
      } catch (err) {
        showStatus('Could not open chat: ' + err.message, true, true);
      }
    });
  }

  // Dirty tracking + unsaved-changes protection
  const unsavedBanner = document.getElementById('unsaved-banner');
  const connectionTracker = createDirtyTracker(
    [
      { element: document.getElementById('providerSelect') },
      { element: document.getElementById('llmEndpoint') },
      { element: document.getElementById('apiKey') },
      { element: document.getElementById('hermesProfile') },
      {
        element: document.getElementById('hermesRemoteConfirmed'),
        getValue: (el) => String(Boolean(el && el.checked)),
      },
      { element: document.getElementById('modelName') },
      { element: document.getElementById('customModelName') },
      { element: document.getElementById('reasoningLevel') },
      { element: document.getElementById('systemPrompt') },
      // NOTE: the profile selector is intentionally NOT tracked here. Selecting a
      // profile is the switch action itself, not an unsaved draft; including it
      // made every switch look dirty and fire the discard prompt with no edits.
      {
        element: document.getElementById('enableStreamingToggle'),
        getValue: (el) => String(Boolean(el && el.checked)),
      },
      {
        element: document.getElementById('themePreference'),
      },
    ],
    {
      onChange: () => {
        if (refreshSetupStatus) {
          connectionStatusDirty = connectionTracker.isDirty();
          // Revert any stale Connected result as soon as connection settings
          // change; the saved profile no longer matches the edited fields.
          if (connectionStatusDirty) refreshSetupStatus();
        }
        syncDirtyBanner();
      },
    }
  );
  const privacyTracker = createDirtyTracker(
    [
      {
        element: document.getElementById('analyticsConsentToggle'),
        getValue: (el) => String(Boolean(el && el.checked)),
      },
      {
        element: document.getElementById('voiceInputEnabledToggle'),
        getValue: (el) => String(Boolean(el && el.checked)),
      },
    ],
    { onChange: () => syncDirtyBanner() }
  );
  const groundingTracker = createDirtyTracker(
    [
      { element: document.getElementById('braveSearchApiKey') },
      { element: document.getElementById('exaSearchApiKey') },
      {
        element: document.getElementById('searchProviderGroup'),
        getValue: (el) =>
          el && el.querySelector('input[name="searchProviderRadio"]:checked')
            ? el.querySelector('input[name="searchProviderRadio"]:checked').value
            : '',
      },
    ],
    { onChange: () => syncDirtyBanner() }
  );
  const pageActionsTracker = createDirtyTracker(
    [
      {
        element: document.getElementById('pageActionsTrustedMode'),
        getValue: (el) => String(Boolean(el && el.checked)),
      },
    ],
    { onChange: () => syncDirtyBanner() }
  );
  const notchTracker = createDirtyTracker(
    [
      {
        element: document.getElementById('notchEnabledToggle'),
        getValue: (el) => String(Boolean(el && el.checked)),
      },
      {
        element: document.getElementById('notchPlacementSelect'),
        getValue: (el) => el?.value || 'top',
      },
    ],
    { onChange: () => syncDirtyBanner() }
  );
  const editorDraftsTracker = createDirtyTracker(
    [
      { element: document.getElementById('instructionName') },
      { element: document.getElementById('instructionContent') },
      { element: document.getElementById('instructionTags') },
      { element: document.getElementById('toolName') },
      { element: document.getElementById('toolDescription') },
      { element: document.getElementById('toolParameters') },
      { element: document.getElementById('toolEndpointUrl') },
      { element: document.getElementById('toolHttpMethod') },
      { element: document.getElementById('skillName') },
      { element: document.getElementById('skillDescription') },
      { element: document.getElementById('skillContent') },
      { element: document.getElementById('skillLicense') },
      { element: document.getElementById('skillCompatibility') },
      { element: document.getElementById('skillMetadata') },
    ],
    { onChange: () => syncDirtyBanner() }
  );
  const allTrackers = [
    connectionTracker,
    privacyTracker,
    groundingTracker,
    pageActionsTracker,
    notchTracker,
    editorDraftsTracker,
  ];
  markConnectionTrackerClean = () => {
    connectionStatusDirty = false;
    connectionTracker.markClean();
  };
  markPrivacyTrackerClean = () => privacyTracker.markClean();
  markGroundingTrackerClean = () => groundingTracker.markClean();
  markPageActionsTrackerClean = () => pageActionsTracker.markClean();
  markNotchTrackerClean = () => notchTracker.markClean();
  function syncDirtyBanner() {
    const dirty = allTrackers.some((tracker) => tracker.isDirty());
    if (unsavedBanner) unsavedBanner.hidden = !dirty;
  }
  allTrackers.forEach((tracker) => tracker.attachEvents(document));
  // beforeunload must cover every tracker, not just the connection form.
  initUnsavedGuard(
    { isDirty: () => allTrackers.some((tracker) => tracker.isDirty()) },
    { confirmBeforeUnload: true }
  );
  // Each section re-baselines after its own storage load (not a global timer)
  // so a real early edit is never wiped and saving one section never clears
  // another section's unsaved state.

  // Expose each help tooltip's text to assistive tech (the CSS `content`
  // tooltip isn't announced), so keyboard + screen-reader users hear the
  // actual help instead of a generic "Help".
  document.querySelectorAll('.help-tooltip[data-tooltip]').forEach((el) => {
    el.setAttribute('aria-label', el.getAttribute('data-tooltip'));
  });
  const addProfileButton = document.getElementById('addProfileButton');
  const deleteProfileButton = document.getElementById('deleteProfileButton');

  // Analytics consent toggle (opt-in, default OFF)
  const analyticsConsentToggle = document.getElementById('analyticsConsentToggle');
  // Privacy fields load across two async reads (consent + voice input); only
  // re-baseline the privacy tracker after both settle so first paint is not
  // falsely flagged dirty.
  let privacyBaselinePending = 0;
  const settlePrivacyBaseline = () => {
    privacyBaselinePending -= 1;
    if (privacyBaselinePending <= 0 && markPrivacyTrackerClean) markPrivacyTrackerClean();
  };
  if (analyticsConsentToggle) {
    privacyBaselinePending += 1;
    // Initialize from storage (default true when missing)
    chrome.storage.local.get(['analyticsConsent'], (res) => {
      const consent =
        res && Object.prototype.hasOwnProperty.call(res, 'analyticsConsent')
          ? !!res.analyticsConsent
          : false;
      analyticsConsentToggle.checked = consent;
      settlePrivacyBaseline();
    });
    // Persist on explicit save (Save Privacy Settings button)
    analyticsConsentToggle.addEventListener('change', () => {
      announceDirtyChange(true);
      showStatus('Privacy changes are pending. Click Save Privacy Settings.', false, true);
    });
  }

  // Microphone Permission Test
  const voiceInputEnabledToggle = document.getElementById('voiceInputEnabledToggle');
  const testMicPermissionBtn = document.getElementById('testMicPermissionBtn');
  const micPermissionStatus = document.getElementById('micPermissionStatus');
  const isVoiceInputSupported =
    !!(window.SpeechRecognition || window.webkitSpeechRecognition) &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  if (voiceInputEnabledToggle && testMicPermissionBtn && micPermissionStatus) {
    const getMicStatusPresentation = (settings) => {
      if (!isVoiceInputSupported) {
        return {
          text: 'Not supported in this browser',
          color: 'var(--ext-destructive)',
        };
      }

      if (settings.voiceInputPermissionState === 'denied') {
        return {
          text: 'Permission denied',
          color: 'var(--ext-destructive)',
        };
      }

      if (!settings.voiceInputEnabled) {
        return {
          text: 'Off',
          color: 'var(--ext-muted-foreground)',
        };
      }

      if (settings.voiceInputPermissionState === 'granted') {
        return {
          text: 'Permission granted',
          color: 'var(--ext-primary)',
        };
      }

      return {
        text: 'Not yet requested',
        color: 'var(--ext-muted-foreground)',
      };
    };

    const renderVoiceInputControls = (settings, overrides = {}) => {
      const status = overrides.status || getMicStatusPresentation(settings);
      const isTesting = !!overrides.isTesting;

      voiceInputEnabledToggle.checked = !!settings.voiceInputEnabled;
      micPermissionStatus.textContent = status.text;
      micPermissionStatus.style.color = status.color;

      testMicPermissionBtn.disabled =
        isTesting || !isVoiceInputSupported || !settings.voiceInputEnabled;

      if (isTesting) {
        testMicPermissionBtn.title = 'Requesting microphone access...';
      } else if (!isVoiceInputSupported) {
        testMicPermissionBtn.title = 'Voice input is not supported in this browser';
      } else if (!settings.voiceInputEnabled) {
        testMicPermissionBtn.title = 'Enable voice input to test microphone access';
      } else {
        testMicPermissionBtn.title = 'Request or verify microphone access';
      }
    };

    const refreshVoiceInputControls = async () => {
      const settings = await getStoredVoiceInputSettings();
      renderVoiceInputControls(settings);
      return settings;
    };

    const testMicrophonePermission = async () => {
      const settings = await getStoredVoiceInputSettings();

      if (!isVoiceInputSupported) {
        renderVoiceInputControls(settings);
        return;
      }

      if (!settings.voiceInputEnabled) {
        renderVoiceInputControls(settings);
        showStatus('Enable voice input before testing microphone access.', true, true);
        return;
      }

      renderVoiceInputControls(settings, {
        status: {
          text: 'Testing...',
          color: 'var(--ext-muted-foreground)',
        },
        isTesting: true,
      });

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());

        await setStoredVoiceInputSettings({
          [VOICE_INPUT_ENABLED_KEY]: true,
          [VOICE_INPUT_PERMISSION_STATE_KEY]: 'granted',
          [VOICE_INPUT_PERMISSION_LAST_CHECKED_KEY]: Date.now(),
        });

        await refreshVoiceInputControls();
        showStatus('Microphone permission granted.', false, true);
      } catch (error) {
        if (isMicrophonePermissionDenied(error)) {
          await setStoredVoiceInputSettings({
            [VOICE_INPUT_ENABLED_KEY]: false,
            [VOICE_INPUT_PERMISSION_STATE_KEY]: 'denied',
            [VOICE_INPUT_PERMISSION_LAST_CHECKED_KEY]: Date.now(),
          });

          await refreshVoiceInputControls();
          showStatus(
            'Microphone access denied. Re-enable voice input here after updating the browser mic permission to try again.',
            true,
            true
          );
          return;
        }

        await refreshVoiceInputControls();
        micPermissionStatus.textContent = 'Test failed';
        micPermissionStatus.style.color = 'var(--ext-destructive)';
        showStatus('Failed to test microphone: ' + error.message, true, true);
      }
    };

    privacyBaselinePending += 1;
    refreshVoiceInputControls().then(() => settlePrivacyBaseline());

    voiceInputEnabledToggle.addEventListener('change', () => {
      announceDirtyChange(true);
      showStatus('Voice input changes are pending. Click Save Privacy Settings.', false, true);
    });

    const savePrivacyButton = document.getElementById('savePrivacy');
    if (savePrivacyButton) {
      savePrivacyButton.addEventListener(
        'click',
        runErrorAwareSave({
          button: savePrivacyButton,
          successMessage: 'Privacy settings saved.',
          errorLabel: 'Failed to save privacy settings',
          notify: showStatus,
          onSuccess: () => {
            const status = document.getElementById('privacySaveStatus');
            if (status) status.textContent = 'Privacy settings saved.';
          },
          markClean: markPrivacyTrackerClean,
          write: async () => {
            const consent = !!analyticsConsentToggle.checked;
            await setChromeStorage(chrome.storage.local, { analyticsConsent: consent });
            await setStoredVoiceInputSettings({
              [VOICE_INPUT_ENABLED_KEY]: !!voiceInputEnabledToggle.checked,
            });
          },
        })
      );
    }

    testMicPermissionBtn.addEventListener('click', testMicrophonePermission);
  }

  if (deleteProfileButton) {
    deleteProfileButton.addEventListener('click', () => {
      const profileSelectElement = document.getElementById('profileSelect');
      if (!profileSelectElement) {
        showStatus('Profile select dropdown not found.', true);
        return;
      }
      const selectedProfileId = profileSelectElement.value;

      if (selectedProfileId === 'default') {
        showStatus('The "Default" profile cannot be deleted.', true);
        return;
      }

      if (selectedProfileId === 'add_new_profile') {
        showStatus('Please select a profile to delete.', true);
        return;
      }

      // Confirm with the user
      chrome.storage.local.get(['profiles'], async (result) => {
        const profiles = result.profiles || [];
        const profileToDelete = profiles.find((p) => p.id === selectedProfileId);
        const profileName = profileToDelete ? profileToDelete.name : 'the selected profile';

        const confirmed = await showConfirmModal(
          `Delete profile "${profileName}"? This cannot be undone.`,
          'Delete Profile',
          'Delete'
        );
        if (confirmed) {
          const updatedProfiles = profiles.filter((p) => p.id !== selectedProfileId);
          // P2-10: profile delete also clears the background-owned Hermes
          // credential + session + session-key records for this profile id.
          // The secret value is never sent through this message; the background
          // owner drops every keyed record for the deleted profile.
          chrome.runtime.sendMessage(
            { action: 'hermesProfileDeleted', profileId: selectedProfileId },
            () => {
              chrome.storage.local.set(
                { profiles: updatedProfiles, lastSelectedProfileId: 'default' },
                () => {
                  if (chrome.runtime.lastError) {
                    console.error('Error deleting profile:', chrome.runtime.lastError);
                    showStatus('Error deleting profile: ' + chrome.runtime.lastError.message, true);
                  } else {
                    showStatus(
                      `Profile "${profileName}" deleted successfully. Switched to Default profile.`,
                      false,
                      true
                    );
                    loadOptions(); // This will repopulate dropdown and load default profile settings.
                  }
                }
              );
            }
          ); // profile delete
        }
      });
    });
  }
  setupInstructionHandlers();
  setupToolHandlers(); // Add call to setup tool handlers
  setupSkillHandlers({ showStatus, setChromeStorage });
  setupBackupHandlers(); // Add call to setup backup handlers
  setupGroundingHandlers(); // Brave web search key
  setupPageActionHandlers();
  setupNotchHandlers();

  // Add event listener for the Revert button
  const revertButton = document.getElementById('revertDefaultsButton');
  if (revertButton) {
    revertButton.addEventListener('click', () => {
      // Get default values (these are defined in loadOptions)
      const defaultEndpoint = STARTER_OPENROUTER_ENDPOINT;
      const defaultModelName = STARTER_OPENROUTER_MODEL;
      pendingDefaultApiKey = STARTER_OPENROUTER_API_KEY;

      // Set default values in the input fields
      document.getElementById('llmEndpoint').value = defaultEndpoint;
      const apiKeyInput = document.getElementById('apiKey');
      apiKeyInput.value = '';
      applyCredentialMask(apiKeyInput, true);
      setModelSelection(defaultModelName);

      // document.getElementById('systemPrompt').value = ''; // Default system prompt

      showStatus('Settings reverted to defaults. Click "Save Settings" to apply.', false, true); // Show as a toast
    });
  }

  // Event listener for profile selection change
  const profileSelectElement = document.getElementById('profileSelect');
  if (addProfileButton && profileSelectElement) {
    addProfileButton.addEventListener('click', () => {
      profileSelectElement.dataset.cloneFromProfileId = profileSelectElement.value;
      profileSelectElement.value = 'add_new_profile';
      profileSelectElement.dispatchEvent(new Event('change'));
    });
  }

  if (profileSelectElement) {
    profileSelectElement.addEventListener('change', async (event) => {
      const selectedProfileId = event.target.value;
      syncDeleteProfileButtonState(selectedProfileId);

      if (selectedProfileId === 'add_new_profile') {
        const newProfileChoice = await requestNewProfile();
        if (newProfileChoice?.name && newProfileChoice.name.trim() !== '') {
          chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
            let profiles = result.profiles || [];
            const currentProfileId =
              profileSelectElement?.dataset.cloneFromProfileId ||
              result.lastSelectedProfileId ||
              'default';
            const currentProfile =
              profiles.find((p) => p.id === currentProfileId) ||
              profiles.find((p) => p.id === 'default') ||
              {};
            if (profileSelectElement?.dataset.cloneFromProfileId) {
              delete profileSelectElement.dataset.cloneFromProfileId;
            }

            const newProfileId = 'profile_' + Date.now(); // Unique ID for the new profile
            const provider = newProfileChoice.provider || 'api';
            const sameProvider = currentProfile.provider === provider;
            const newProfile = {
              id: newProfileId,
              name: newProfileChoice.name.trim(),
              provider,
              llmEndpoint:
                provider !== 'api'
                  ? ''
                  : sameProvider
                    ? document.getElementById('llmEndpoint').value.trim() ||
                      currentProfile.llmEndpoint
                    : '',
              apiKey: '',
              hermesEndpoint:
                provider === 'hermes' && sameProvider
                  ? document.getElementById('llmEndpoint').value.trim() ||
                    getHermesEndpoint(currentProfile)
                  : '',
              hermesProfile:
                provider === 'hermes' && sameProvider
                  ? document.getElementById('hermesProfile')?.value.trim() ||
                    currentProfile.hermesProfile ||
                    ''
                  : '',
              hermesRemoteConfirmed:
                provider === 'hermes' &&
                sameProvider &&
                document.getElementById('hermesRemoteConfirmed')?.checked === true,
              modelName:
                provider === 'hermes'
                  ? ''
                  : sameProvider
                    ? selectedModelValue() || currentProfile.modelName
                    : '',
              reasoningLevel:
                provider === 'codex' && sameProvider
                  ? document.getElementById('reasoningLevel')?.value ||
                    currentProfile.reasoningLevel ||
                    ''
                  : '',
              systemPrompt:
                document.getElementById('systemPrompt').value.trim() || currentProfile.systemPrompt,
              lastUpdated: new Date().toLocaleString(),
            };
            const normalizedNewProfile = normalizeProfileRecord(newProfile);
            if (!normalizedNewProfile.valid) {
              showStatus(`Unable to create profile: ${normalizedNewProfile.error}`, true, true);
              return;
            }
            profiles.push(normalizedNewProfile.value);
            profiles = profiles.slice(0, MAX_IMPORTED_RECORDS);
            setChromeStorage(chrome.storage.local, {
              profiles: profiles,
              lastSelectedProfileId: newProfileId,
            })
              .then(() => {
                // populateProfileDropdown is called within loadOptions
                loadOptions(); // Reload options to correctly populate and select.
                // Explicitly set to new profile ID *after* loadOptions, as loadOptions might reset it.
                profileSelectElement.value = newProfileId;
                syncDeleteProfileButtonState(newProfileId);
                loadProfileSettings(newProfileId); // Load its settings into the form
                showStatus(
                  `Profile "${newProfile.name}" created. Add its credentials, then save settings.`,
                  false,
                  true
                );
              })
              .catch((error) => {
                showStatus(
                  `Profile could not be created: ${error.message}. Your new-profile inputs were not saved.`,
                  true,
                  true
                );
                loadOptions(); // Drop the phantom in-memory profile; storage was untouched.
              });
          });
        } else {
          // User cancelled or entered empty name, revert to last selected
          chrome.storage.local.get(['lastSelectedProfileId'], (res) => {
            if (profileSelectElement) {
              profileSelectElement.value = res.lastSelectedProfileId || 'default';
              syncDeleteProfileButtonState(profileSelectElement.value);
            }
          });
        }
      } else {
        // P2-05: never silently discard unsaved connection or editor drafts
        // when switching profiles in-page. Require an explicit discard.
        const hasUnsaved = allTrackers.some((tracker) => tracker.isDirty());
        if (hasUnsaved) {
          const confirmSwitch = window.confirm(
            'You have unsaved changes in this Options section. Switch profiles and discard them?'
          );
          if (!confirmSwitch) {
            // Revert the dropdown to the previously selected profile.
            chrome.storage.local.get(['lastSelectedProfileId'], (res) => {
              if (profileSelectElement) {
                profileSelectElement.value = res.lastSelectedProfileId || 'default';
                syncDeleteProfileButtonState(profileSelectElement.value);
              }
            });
            return;
          }
        }
        chrome.storage.local.set({ lastSelectedProfileId: selectedProfileId });
        loadProfileSettings(selectedProfileId);
        if (refreshSetupStatus) refreshSetupStatus();
      }
    });
  }

  // ============================================================
  // SECTION 2: Theme Settings (Sync Storage)
  // ============================================================

  // Theme preference selector
  const themePreference = document.getElementById('themePreference');
  if (themePreference) {
    setupThemeToggle(themePreference);
  }

  // Listen for storage changes
  chrome.storage.onChanged.addListener(() => {
    // Storage sync changes are handled by the theme toggle module.
  });
});

document.getElementById('providerSelect')?.addEventListener('change', (event) => {
  const profileId = document.getElementById('profileSelect')?.value;
  updateCodexConnectionControls(event.target.value, profileId);
  if (event.target.value === 'hermes') {
    const modelSelect = document.getElementById('modelName');
    if (modelSelect) {
      modelSelect.required = false;
      modelSelect.innerHTML = '<option value="">Hermes gateway default model</option>';
      modelSelect.value = '';
    }
  }
});
document.getElementById('modelName')?.addEventListener('change', (event) => {
  const profileId = document.getElementById('profileSelect')?.value;
  setCustomModelVisibility(event.target.value === CUSTOM_MODEL_VALUE);
  updateReasoningOptions(
    profileId,
    selectedModelValue(),
    document.getElementById('reasoningLevel')?.value
  );
});
document.getElementById('refreshModelsButton')?.addEventListener('click', () => {
  const profileId = document.getElementById('profileSelect')?.value;
  if (!profileId || profileId === 'add_new_profile') {
    showStatus('Select a profile before refreshing models.', true);
    return;
  }
  chrome.storage.local.get(['profiles'], (result) => {
    const profile = (result.profiles || []).find((entry) => entry.id === profileId);
    if (profile) loadAvailableModels(profile);
  });
});
document.getElementById('connectCodexButton')?.addEventListener('click', () => {
  startCodexLogin().catch((error) => showStatus(error.message, true));
});
document.getElementById('disconnectCodexButton')?.addEventListener('click', async () => {
  const profileId = document.getElementById('profileSelect')?.value;
  const response = await chrome.runtime.sendMessage({ action: 'codexLogout', profileId });
  if (!response?.success) showStatus(response?.error || 'Unable to disconnect Codex.', true);
  else updateCodexConnectionControls('codex', profileId);
});

document.getElementById('testHermesButton')?.addEventListener('click', async () => {
  const profileId = document.getElementById('profileSelect')?.value;
  const status = document.getElementById('hermesConnectionStatus');
  if (!profileId || profileId === 'add_new_profile') {
    if (status) status.textContent = 'Select and save a Hermes profile first.';
    return;
  }
  if (status) status.textContent = 'Testing…';
  try {
    const { profiles = [] } = await chrome.storage.local.get(['profiles']);
    const storedProfile = profiles.find((profile) => profile.id === profileId);
    if (storedProfile?.provider !== 'hermes') {
      throw new Error('Save this profile as Hermes before testing the connection.');
    }
    const savedEndpoint = getHermesEndpoint(storedProfile);
    const currentEndpoint = document.getElementById('llmEndpoint')?.value.trim() || '';
    if (!savedEndpoint || (currentEndpoint && currentEndpoint !== savedEndpoint)) {
      throw new Error('Save Settings before testing the Hermes connection.');
    }
    const response = await chrome.runtime.sendMessage({
      action: 'testHermesConnection',
      profileId,
    });
    if (!response?.success) throw new Error(response?.error || 'Hermes connection failed.');
    const healthWarning = response.result?.healthWarning?.message;
    const clientToolsAvailable = response.result?.clientToolsAvailable === true;
    if (status) {
      const actStatus = clientToolsAvailable
        ? ' Act is available.'
        : ' Act requires a Hermes gateway with client-tool support.';
      status.textContent = healthWarning
        ? `Connected to Hermes. ${healthWarning}${actStatus}`
        : `Connected to Hermes.${actStatus}`;
    }
  } catch (error) {
    if (status) status.textContent = error.message;
  }
});

document.getElementById('optionsForm').addEventListener('submit', saveOptions);

// --- Tool Dropdown Population ---
async function populateToolDropdown() {
  const toolChoiceSelect = document.getElementById('instructionToolChoice');
  if (!toolChoiceSelect) {
    console.error('instructionToolChoice dropdown not found!');
    return;
  }

  // Clear existing tool options (keep the first two: None and Auto)
  while (toolChoiceSelect.options.length > 2) {
    toolChoiceSelect.remove(toolChoiceSelect.options.length - 1);
  }

  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.local.get(['promptPaulTools'], (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(res);
        }
      });
    });
    const tools = result.promptPaulTools || [];

    if (tools.length > 0) {
      // Add a separator only if there are tools
      const separator = document.createElement('option');
      separator.disabled = true;
      separator.textContent = '------ Tools ------';
      toolChoiceSelect.appendChild(separator);

      // Add tools to the dropdown
      tools.forEach((tool) => {
        const option = document.createElement('option');
        option.value = tool.name; // Use tool name as value
        option.textContent = tool.name;
        toolChoiceSelect.appendChild(option);
      });
    }
    // Selection restoration will be handled in the edit handler (loadInstructions)
  } catch (error) {
    console.error('Error loading tools for dropdown:', error);
    showStatus('Error loading tools for dropdown: ' + error.message, true);
  }
}

// Custom instruction management is owned by src/options/OptionsInstructions.js.
function setupInstructionHandlers() {
  setupOptionsInstructionHandlers({
    showStatus,
    setChromeStorage,
    showConfirmModal,
    populateToolDropdown,
  });
}

// Setup tool management handlers
function setupToolHandlers() {
  const saveToolBtn = document.getElementById('saveTool');
  const clearToolFormBtn = document.getElementById('clearToolForm');
  // Load and display tools
  function loadTools() {
    chrome.storage.local.get(['promptPaulTools'], (result) => {
      const tools = result.promptPaulTools || [];
      const tableBody = document.querySelector('#toolsTable tbody');
      tableBody.innerHTML = '';

      tools.forEach((tool) => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td data-label="Name">${escapeHtml(tool.name)}</td>
          <td data-label="Description">${escapeHtml(tool.description)}</td>
          <td data-label="Actions">
            <button class="edit-tool-btn" data-id="${escapeHtml(tool.id)}">Edit</button>
            <button class="delete-tool-btn" data-id="${escapeHtml(tool.id)}">Delete</button>
          </td>
        `;
        tableBody.appendChild(row);
      });

      // Add edit/delete handlers
      document.querySelectorAll('.edit-tool-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const toolId = e.target.dataset.id;
          chrome.storage.local.get(['promptPaulTools'], (result) => {
            if (chrome.runtime.lastError) {
              console.error('Error loading tool for edit:', chrome.runtime.lastError.message);
              showStatus('Error loading tool data.', true);
              return;
            }
            const tools = result.promptPaulTools || [];
            const tool = tools.find((t) => t.id === toolId);
            if (tool) {
              document.getElementById('toolName').value = tool.name;
              document.getElementById('toolDescription').value = tool.description;
              document.getElementById('toolParameters').value = tool.parameters || '';
              document.getElementById('toolEndpointUrl').value = tool.endpointUrl || '';
              document.getElementById('toolHttpMethod').value = tool.httpMethod || '';
              document.getElementById('toolId').value = tool.id;
            }
          });
        });
      });

      document.querySelectorAll('.delete-tool-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const toolId = e.target.dataset.id;
          if (confirm('Are you sure you want to delete this tool?')) {
            chrome.storage.local.get(['promptPaulTools'], (result) => {
              if (chrome.runtime.lastError) {
                console.error('Error loading tools for delete:', chrome.runtime.lastError.message);
                showStatus('Error loading tool data.', true);
                return;
              }
              let tools = result.promptPaulTools || [];
              tools = tools.filter((t) => t.id !== toolId);
              chrome.storage.local.set({ promptPaulTools: tools }, () => {
                if (chrome.runtime.lastError) {
                  console.error('Error deleting tool:', chrome.runtime.lastError.message);
                  showStatus('Error deleting tool.', true);
                  return;
                }
                showStatus('Tool deleted.');
                loadTools(); // Reload the table
                populateToolDropdown(); // Update tool dropdown
                // Clear the form if the deleted tool was being edited
                if (document.getElementById('toolId').value === toolId) {
                  clearToolForm();
                }
              });
            });
          }
        });
      });
    });
  }

  // Save tool handler
  if (saveToolBtn) {
    saveToolBtn.addEventListener('click', () => {
      loadingManager.setButtonLoading(saveToolBtn, true);
      const toolName = document.getElementById('toolName').value.trim();
      const toolDescription = document.getElementById('toolDescription').value.trim();
      const toolParameters = document.getElementById('toolParameters').value.trim();
      const toolEndpointUrl = document.getElementById('toolEndpointUrl').value.trim();
      const toolHttpMethod = document.getElementById('toolHttpMethod').value;
      const toolId = document.getElementById('toolId').value;

      const normalizedTool = normalizeToolDefinition({
        name: toolName,
        description: toolDescription,
        parameters: toolParameters,
        endpointUrl: toolEndpointUrl,
        httpMethod: toolHttpMethod,
      });
      if (!normalizedTool.valid) {
        showStatus(normalizedTool.error, true);
        loadingManager.setButtonLoading(saveToolBtn, false);
        return;
      }

      const normalizedToolValue = normalizedTool.value;

      chrome.storage.local.get(['promptPaulTools'], (result) => {
        let tools = result.promptPaulTools || [];
        const now = new Date().toISOString();

        if (toolId) {
          // Update existing tool
          tools = tools.map((tool) => {
            if (tool.id === toolId) {
              return {
                ...tool,
                name: normalizedToolValue.name,
                description: normalizedToolValue.description,
                parameters: normalizedToolValue.parameters,
                endpointUrl: normalizedToolValue.endpointUrl,
                httpMethod: normalizedToolValue.httpMethod,
                lastUpdated: now,
              };
            }
            return tool;
          });
          setChromeStorage(chrome.storage.local, { promptPaulTools: tools })
            .then(() => {
              showStatus('Tool updated.');
              loadTools(); // Reload the table
              populateToolDropdown(); // Update tool dropdown
              clearToolForm(); // Clear the form after saving
            })
            .catch((error) => {
              showStatus(
                `Tool could not be saved: ${error.message}. Your draft is preserved.`,
                true
              );
            })
            .finally(() => loadingManager.setButtonLoading(saveToolBtn, false));
        } else {
          // Add new tool
          const newTool = {
            id: createUniqueId('tool'),
            name: normalizedToolValue.name,
            description: normalizedToolValue.description,
            parameters: normalizedToolValue.parameters,
            endpointUrl: normalizedToolValue.endpointUrl,
            httpMethod: normalizedToolValue.httpMethod,
            createdAt: now,
            lastUpdated: now,
          };
          tools.push(newTool);
          tools = tools.slice(0, MAX_IMPORTED_RECORDS);
          setChromeStorage(chrome.storage.local, { promptPaulTools: tools })
            .then(() => {
              showStatus('Tool added.');
              loadTools(); // Reload the table
              populateToolDropdown(); // Update tool dropdown
              clearToolForm(); // Clear the form after saving
            })
            .catch((error) => {
              showStatus(
                `Tool could not be saved: ${error.message}. Your draft is preserved.`,
                true
              );
            })
            .finally(() => loadingManager.setButtonLoading(saveToolBtn, false));
        }
      });
    });
  }

  // Clear tool form handler
  if (clearToolFormBtn) {
    clearToolFormBtn.addEventListener('click', clearToolForm);
  }

  function clearToolForm() {
    document.getElementById('toolName').value = '';
    document.getElementById('toolDescription').value = '';
    document.getElementById('toolParameters').value = '';
    document.getElementById('toolEndpointUrl').value = '';
    document.getElementById('toolHttpMethod').value = '';
    document.getElementById('toolId').value = '';
    showStatus('Tool form cleared.');
  }

  // Export tools handler
  document.getElementById('exportTools').addEventListener('click', () => {
    chrome.storage.local.get(['promptPaulTools'], (result) => {
      const tools = result.promptPaulTools || [];
      const exportData = {
        version: 1, // Versioning for future compatibility
        tools: tools,
      };
      const dataStr =
        'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute('href', dataStr);
      downloadAnchorNode.setAttribute('download', 'prompt_paul_tools.json');
      document.body.appendChild(downloadAnchorNode); // Required for Firefox
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    });
  });

  // Import tools handler
  document.getElementById('importTools').addEventListener('click', () => {
    document.getElementById('importToolsFile').click(); // Trigger the hidden file input
  });

  document.getElementById('importToolsFile').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      showStatus('Tool import file is too large.', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        if (importData.version === 1 && Array.isArray(importData.tools)) {
          if (importData.tools.length > MAX_IMPORTED_RECORDS) {
            showStatus(`Import contains more than ${MAX_IMPORTED_RECORDS} tools.`, true);
            return;
          }
          // Simple merge strategy: add new tools, update existing by ID
          chrome.storage.local.get(['promptPaulTools'], (result) => {
            let existingTools = result.promptPaulTools || [];
            const importedTools = importData.tools;

            const normalizedImports = importedTools
              .map((tool) => normalizeToolDefinition(tool))
              .filter((entry) => entry.valid)
              .map((entry) => entry.value);
            if (normalizedImports.length !== importedTools.length) {
              const skipped = importedTools.length - normalizedImports.length;
              showStatus(`Skipped ${skipped} invalid or reserved tool(s).`, false, true);
            }
            normalizedImports.forEach((importedTool) => {
              const existingIndex = existingTools.findIndex((tool) => tool.id === importedTool.id);
              if (existingIndex > -1) {
                // Update existing tool
                existingTools[existingIndex] = {
                  ...existingTools[existingIndex],
                  ...importedTool,
                  lastUpdated: new Date().toISOString(),
                };
              } else {
                // Add new tool
                existingTools.push({
                  ...importedTool,
                  id: importedTool.id || createUniqueId('tool'),
                  createdAt: importedTool.createdAt || new Date().toISOString(),
                  lastUpdated: new Date().toISOString(),
                });
              }
            });

            existingTools = existingTools.slice(0, MAX_IMPORTED_RECORDS);
            chrome.storage.local.set({ promptPaulTools: existingTools }, () => {
              showStatus('Tools imported successfully.');
              loadTools(); // Reload the table
              populateToolDropdown(); // Update tool dropdown
            });
          });
        } else {
          showStatus('Invalid import file format.', true);
        }
      } catch (error) {
        console.error('Error importing tools:', error);
        showStatus('Error reading or parsing import file.', true);
      }
    };
    reader.readAsText(file);
  });

  // Initial load of tools
  loadTools();
}

/**
 * Setup handlers for the Full Backup & Restore system.
 */
function setupBackupHandlers() {
  const exportAllBtn = document.getElementById('exportAllData');
  const importAllBtn = document.getElementById('importAllDataBtn');
  const importAllFile = document.getElementById('importAllFile');

  if (exportAllBtn) {
    exportAllBtn.addEventListener('click', async () => {
      try {
        showStatus('Preparing full backup...', false, true);

        const localSnapshot = await new Promise((resolve) =>
          chrome.storage.local.get(null, resolve)
        );
        const syncSnapshot = await new Promise((resolve) => chrome.storage.sync.get(null, resolve));
        const localData = Object.fromEntries(
          BACKUP_LOCAL_KEYS.filter((key) =>
            Object.prototype.hasOwnProperty.call(localSnapshot, key)
          ).map((key) => [key, localSnapshot[key]])
        );
        const syncData = Object.fromEntries(
          BACKUP_SYNC_KEYS.filter((key) =>
            Object.prototype.hasOwnProperty.call(syncSnapshot, key)
          ).map((key) => [key, syncSnapshot[key]])
        );
        const normalizedBackup = normalizeBackupPayload({ local: localData, sync: syncData });
        if (!normalizedBackup.valid) throw new Error(normalizedBackup.error);

        const fullBackup = {
          timestamp: new Date().toISOString(),
          ...normalizedBackup.value,
        };

        const dataStr =
          'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(fullBackup, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute('href', dataStr);
        const filename = `prompt-paul-backup-${new Date().toISOString().split('T')[0]}.json`;
        downloadAnchorNode.setAttribute('download', filename);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();

        showStatus('Backup exported. Credentials are not included.', false, true);
      } catch (error) {
        console.error('Export error:', error);
        showStatus('Failed to export backup: ' + error.message, true, true);
      }
    });
  }

  if (importAllBtn) {
    importAllBtn.addEventListener('click', () => {
      importAllFile.click();
    });
  }

  if (importAllFile) {
    importAllFile.addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        showStatus('Backup file is too large.', true);
        importAllFile.value = '';
        return;
      }

      if (
        !confirm(
          'Are you sure you want to restore from this backup? This will overwrite ALL your current settings, profiles, skills, and tools.'
        )
      ) {
        importAllFile.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const backup = JSON.parse(e.target.result);

          const normalizedBackup = normalizeBackupPayload(backup);
          if (!normalizedBackup.valid) {
            throw new Error(normalizedBackup.error);
          }

          showStatus('Restoring data...', false, true);

          // Restore only validated, supported storage keys. Credentials are
          // intentionally removed by normalizeBackupPayload.
          if (Object.keys(normalizedBackup.value.local).length > 0) {
            await setChromeStorage(chrome.storage.local, normalizedBackup.value.local);
          }
          if (Object.keys(normalizedBackup.value.sync).length > 0) {
            await setChromeStorage(chrome.storage.sync, normalizedBackup.value.sync);
          }

          if (normalizedBackup.warnings?.length > 0) {
            showStatus(
              `Restore complete; skipped ${normalizedBackup.warnings.length} unsupported field(s).`,
              false,
              true
            );
          }
          showStatus('Restore complete. Reloading...', false, true);

          // Reload the page to reflect all changes
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } catch (err) {
          console.error('Import error:', err);
          showStatus('Failed to import backup: ' + err.message, true, true);
        }
      };
      reader.readAsText(file);
    });
  }
}

/**
 * Setup handlers for the Web Search Grounding configuration.
 */
function setupGroundingHandlers() {
  const keyInput = document.getElementById('braveSearchApiKey');
  const keyToggle = document.getElementById('braveSearchKeyToggle');
  const keyRemove = document.getElementById('braveSearchKeyRemove');
  const keyStatus = document.getElementById('braveSearchKeyStatus');
  const exaKeyInput = document.getElementById('exaSearchApiKey');
  const exaKeyToggle = document.getElementById('exaSearchKeyToggle');
  const exaKeyRemove = document.getElementById('exaSearchKeyRemove');
  const exaKeyStatus = document.getElementById('exaSearchKeyStatus');
  const exaKeyError = document.getElementById('exaSearchApiKeyError');
  const providerExa = document.getElementById('searchProviderExa');
  const providerBrave = document.getElementById('searchProviderBrave');
  const braveKeyGroup = document.getElementById('braveKeyGroup');
  const exaKeyGroup = document.getElementById('exaKeyGroup');

  const MAX_EXA_KEY_LENGTH = 256;
  const EXA_KEY_TOO_LONG = 'Exa API key must be 256 characters or fewer.';

  // Show/hide provider-specific key fields; the shared link row stays visible.
  function renderProviderUI(provider) {
    if (braveKeyGroup) braveKeyGroup.style.display = provider === 'brave' ? '' : 'none';
    if (exaKeyGroup) exaKeyGroup.style.display = provider === 'exa' ? '' : 'none';
  }

  // Resolve the stored provider, defaulting to Exa (keyless).
  // Legacy 'duckduckgo' (and any other stored value) normalizes to 'exa'.
  const readActiveProvider = (onDone) => {
    chrome.storage.local.get(['searchProvider'], (result) => {
      const provider = result.searchProvider === 'brave' ? 'brave' : 'exa';
      if (providerExa) providerExa.checked = provider !== 'brave';
      if (providerBrave) providerBrave.checked = provider === 'brave';
      renderProviderUI(provider);
      if (typeof onDone === 'function') onDone(provider);
    });
  };

  // Persist provider selection on change.
  function wireProviderRadios() {
    if (!providerExa || !providerBrave) return;
    for (const radio of [providerExa, providerBrave]) {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        const provider = radio.value;
        setChromeStorage(chrome.storage.local, { searchProvider: provider }).then(() => {
          renderProviderUI(provider);
        });
      });
    }
  }
  wireProviderRadios();

  function updateKeyStatus(onDone) {
    chrome.storage.local.get(['braveSearchApiKey'], (result) => {
      if (result.braveSearchApiKey) {
        const key = result.braveSearchApiKey;
        const masked =
          key.length > 8
            ? key.substring(0, 4) + '•'.repeat(key.length - 8) + key.substring(key.length - 4)
            : '•'.repeat(key.length);
        if (keyStatus) keyStatus.textContent = '✓ Saved: ' + masked;
        applyCredentialMask(keyInput, true);
      } else {
        if (keyStatus) keyStatus.textContent = 'No key configured.';
        applyCredentialMask(keyInput, false, 'Paste your Brave Search API key');
      }
      if (typeof onDone === 'function') onDone();
    });
  }

  // Password toggle
  if (keyToggle && keyInput) {
    keyToggle.addEventListener('click', () => {
      const isPassword = keyInput.type === 'password';
      keyInput.type = isPassword ? 'text' : 'password';
      keyToggle.querySelector('.material-symbols-outlined').textContent = isPassword
        ? 'visibility_off'
        : 'visibility';
    });
  }

  // Exa key status: masked display only; the raw key never leaves the password input.
  function updateExaKeyStatus(onDone) {
    chrome.storage.local.get(['exaSearchApiKey'], (result) => {
      if (result.exaSearchApiKey) {
        const key = result.exaSearchApiKey;
        const masked =
          key.length > 8
            ? key.substring(0, 4) + '•'.repeat(key.length - 8) + key.substring(key.length - 4)
            : '•'.repeat(key.length);
        if (exaKeyStatus) exaKeyStatus.textContent = '✓ Saved: ' + masked;
        applyCredentialMask(exaKeyInput, true);
      } else {
        if (exaKeyStatus) exaKeyStatus.textContent = 'No key configured (keyless is fine).';
        applyCredentialMask(exaKeyInput, false, 'Optional: paste your Exa API key');
      }
      if (typeof onDone === 'function') onDone();
    });
  }

  function setExaKeyTooLong(error) {
    if (exaKeyInput) exaKeyInput.classList.toggle('is-invalid', error);
    if (exaKeyError) exaKeyError.textContent = error ? EXA_KEY_TOO_LONG : '';
  }

  // Exa password toggle
  if (exaKeyToggle && exaKeyInput) {
    exaKeyToggle.addEventListener('click', () => {
      const isPassword = exaKeyInput.type === 'password';
      exaKeyInput.type = isPassword ? 'text' : 'password';
      exaKeyToggle.querySelector('.material-symbols-outlined').textContent = isPassword
        ? 'visibility_off'
        : 'visibility';
    });
  }

  // Remove Exa key (leaves keyless Exa available; web grounding stays as-is)
  if (exaKeyRemove) {
    exaKeyRemove.addEventListener('click', () => {
      chrome.storage.local.remove('exaSearchApiKey', () => {
        if (chrome.runtime.lastError) {
          showStatus('Failed to remove key: ' + chrome.runtime.lastError.message, true);
          return;
        }
        updateExaKeyStatus();
        showStatus('Exa API key removed; keyless Exa is still available.', false, true);
      });
    });
  }

  // Remove key
  if (keyRemove) {
    keyRemove.addEventListener('click', () => {
      chrome.storage.local.remove('braveSearchApiKey', () => {
        if (chrome.runtime.lastError) {
          showStatus('Failed to remove key: ' + chrome.runtime.lastError.message, true);
          return;
        }
        chrome.storage.local.set({ webSearchEnabled: false }, () => {
          updateKeyStatus();
          showStatus('Brave Search API key removed and web grounding disabled.', false, true);
        });
      });
    });
  }

  // Explicit save for the Brave key / Exa key (replaces debounced auto-save)
  const saveGroundingButton = document.getElementById('saveGrounding');
  if (saveGroundingButton && keyInput) {
    saveGroundingButton.addEventListener('click', () => {
      const isBrave = (providerBrave && providerBrave.checked) || (!providerExa && !providerBrave);
      if (!isBrave) {
        const value = exaKeyInput ? exaKeyInput.value.trim() : '';
        if (value.length > MAX_EXA_KEY_LENGTH) {
          setExaKeyTooLong(true);
          showStatus('Exa API key is too long (max 256 characters).', true, true);
          flashSaveFeedback(saveGroundingButton, true);
          return;
        }
        runErrorAwareSave({
          button: saveGroundingButton,
          successMessage: 'Web search settings saved.',
          errorLabel: 'Failed to save search settings',
          notify: showStatus,
          onSuccess: updateExaKeyStatus,
          markClean: markGroundingTrackerClean,
          write: () => {
            const typed = exaKeyInput.value.trim();
            if (typed) {
              return setChromeStorage(chrome.storage.local, { exaSearchApiKey: typed });
            }
            if (exaKeyInput.dataset.configured === 'true') {
              // Masked field with no new value. Keep the existing stored key.
              return Promise.resolve();
            }
            // Empty value clears any stored key.
            return new Promise((resolve, reject) =>
              chrome.storage.local.remove('exaSearchApiKey', () =>
                chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve()
              )
            );
          },
        })();
        return;
      }
      const value = keyInput.value.trim();
      const wasConfigured = keyInput.dataset.configured === 'true';
      if (!value && !wasConfigured) {
        showStatus('Enter a Brave Search API key or remove the existing one.', true, true);
        flashSaveFeedback(saveGroundingButton, true);
        return;
      }
      runErrorAwareSave({
        button: saveGroundingButton,
        successMessage: 'Brave Search API key saved.',
        errorLabel: 'Failed to save Brave key',
        notify: showStatus,
        onSuccess: updateKeyStatus,
        markClean: markGroundingTrackerClean,
        write: () => {
          const typed = keyInput.value.trim();
          if (typed) {
            return setChromeStorage(chrome.storage.local, { braveSearchApiKey: typed });
          }
          // Masked field with no new value. Keep the existing stored key.
          return Promise.resolve();
        },
      })();
    });
  }

  // Mark dirty on input; persist only via the explicit save button.
  if (keyInput) {
    keyInput.addEventListener('input', () => {
      if (keyInput.dataset.configured === 'true') delete keyInput.dataset.configured;
      if (keyStatus) {
        keyStatus.textContent = 'Unsaved changes. Click Save Web Search Settings.';
      }
      announceDirtyChange(true);
    });
  }

  if (exaKeyInput) {
    exaKeyInput.addEventListener('input', () => {
      if (exaKeyInput.dataset.configured === 'true') delete exaKeyInput.dataset.configured;
      setExaKeyTooLong(exaKeyInput.value.trim().length > MAX_EXA_KEY_LENGTH);
      if (exaKeyStatus) {
        exaKeyStatus.textContent = 'Unsaved changes. Click Save Web Search Settings.';
      }
      announceDirtyChange(true);
    });
  }

  // Load initial state
  readActiveProvider(() => {
    updateKeyStatus(() => {
      updateExaKeyStatus(() => markGroundingTrackerClean?.());
    });
  });
}

/**
 * Setup the persistent browser-page notch preference.
 */
function setupNotchHandlers() {
  const toggle = document.getElementById('notchEnabledToggle');
  const placementSelect = document.getElementById('notchPlacementSelect');
  const saveButton = document.getElementById('saveNotch');
  const status = document.getElementById('notchSaveStatus');
  if (!toggle) return;

  chrome.storage.local.get(['notchEnabled', 'notchPlacement'], (result) => {
    toggle.checked = result.notchEnabled === true;
    if (placementSelect) {
      placementSelect.value = ['top', 'right', 'bottom', 'left'].includes(result.notchPlacement)
        ? result.notchPlacement
        : 'top';
    }
    if (status) status.textContent = toggle.checked ? 'Notch is on.' : 'Notch is off.';
    markNotchTrackerClean?.();
  });

  toggle.addEventListener('change', () => {
    announceDirtyChange(true);
    if (status) status.textContent = 'Unsaved changes. Click Save Notch Settings.';
  });

  placementSelect?.addEventListener('change', () => {
    announceDirtyChange(true);
    if (status) status.textContent = 'Unsaved changes. Click Save Notch Settings.';
  });

  saveButton?.addEventListener(
    'click',
    runErrorAwareSave({
      button: saveButton,
      successMessage: 'Notch settings saved.',
      errorLabel: 'Failed to save notch settings',
      notify: showStatus,
      onSuccess: () => {
        if (status) status.textContent = toggle.checked ? 'Notch is on.' : 'Notch is off.';
      },
      markClean: markNotchTrackerClean,
      write: () => {
        const placement = placementSelect?.value || 'top';
        return setChromeStorage(chrome.storage.local, {
          notchEnabled: toggle.checked,
          notchPlacement: placement,
        });
      },
    })
  );
}

/**
 * Setup the trusted current-page action preference.
 */
function setupPageActionHandlers() {
  setupPageActionSitePolicies({
    list: document.getElementById('pageActionSitePoliciesList'),
    form: document.getElementById('pageActionSitePolicyForm'),
    originInput: document.getElementById('pageActionSitePolicyOrigin'),
    ruleInput: document.getElementById('pageActionSitePolicyRule'),
    notify: showStatus,
  });
  const toggle = document.getElementById('pageActionsTrustedMode');
  const saveButton = document.getElementById('savePageActions');
  const status = document.getElementById('pageActionsSaveStatus');
  if (!toggle) return;

  chrome.storage.local.get(['pageActionsTrustedMode'], (result) => {
    toggle.checked = result.pageActionsTrustedMode === true;
    if (status)
      status.textContent = toggle.checked ? 'Trusted mode is on.' : 'Trusted mode is off.';
    markPageActionsTrackerClean?.();
  });

  const markChanged = () => {
    announceDirtyChange(true);
    if (status) status.textContent = 'Unsaved changes. Click Save Page Action Settings.';
  };
  toggle.addEventListener('change', markChanged);

  saveButton?.addEventListener(
    'click',
    runErrorAwareSave({
      button: saveButton,
      successMessage: 'Page-action settings saved.',
      errorLabel: 'Failed to save page-action settings',
      notify: showStatus,
      onSuccess: () => {
        if (status) {
          const modeStatus = toggle.checked ? 'Trusted mode is on.' : 'Trusted mode is off.';
          status.textContent = modeStatus;
        }
      },
      markClean: markPageActionsTrackerClean,
      write: () =>
        setChromeStorage(chrome.storage.local, {
          pageActionsTrustedMode: toggle.checked,
        }),
    })
  );
}
