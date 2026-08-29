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
import {
  BACKUP_LOCAL_KEYS,
  BACKUP_SYNC_KEYS,
  isValidHttpUrl,
  normalizeBackupPayload,
  normalizeProfileRecord,
  normalizeToolDefinition,
} from './src/utils/validation.js';
import {
  generateSkillMarkdown,
  parseSkillMarkdown,
  validateMetadata,
} from './src/utils/skillParser.js';
import { setupThemeToggle } from './themeUtils.js';
import { escapeHtml } from './src/utils/domSanitizer.js';
import { getHermesEndpoint, resolvePreferredProfile } from './src/utils/profileRouting.js';
import {
  applyCredentialMask,
  createDirtyTracker,
  initUnsavedGuard,
  announceDirtyChange,
  resolveCredentialValue,
  flashSaveFeedback,
  renderSetupStatus,
  endpointHost,
} from './src/options/OptionsUI.js';
import {
  getVoiceInputSettings as getStoredVoiceInputSettings,
  setVoiceInputSettings as setStoredVoiceInputSettings,
  isMicrophonePermissionDenied,
} from './src/chat/ChatVoice.js';

const VOICE_INPUT_ENABLED_KEY = 'voiceInputEnabled';
const VOICE_INPUT_PERMISSION_STATE_KEY = 'voiceInputPermissionState';
const VOICE_INPUT_PERMISSION_LAST_CHECKED_KEY = 'voiceInputPermissionLastChecked';

// Starter configuration for first-time users. OpenRouter's free router provides
// a quick start, but users must configure their own API key.
const STARTER_OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const STARTER_OPENROUTER_API_KEY = '';
const STARTER_OPENROUTER_MODEL = 'openrouter/free';
const STARTER_SYSTEM_PROMPT = 'You are a helpful assistant.';

// Assigned in DOMContentLoaded; invoked from async load/save flows so the
// dirty trackers re-baseline after storage-backed fields are populated.
let markAllTrackersClean = null;
let markGroundingTrackerClean = null;
let markPageActionsTrackerClean = null;
let refreshSetupStatus = null;
let pendingDefaultApiKey = null;
let codexLoginPollTimer = null;
let modelLoadSequence = 0;
const modelMetadataByProfile = new Map();
const CUSTOM_MODEL_VALUE = '__custom__';
const DEFAULT_CODEX_REASONING_LEVEL = 'medium';
const HERMES_API_KEYS_KEY = 'hermesApiKeys';

function createUniqueId(prefix) {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${id}`;
}

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
      // No inline status element on this page — fall back to a toast so the
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
  const profiles = await getStoredProfiles();
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
    option.textContent = level.description ? `${level.label} — ${level.description}` : level.label;
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
    const metadata = new Map(models.map((model) => [model.id, model]));
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

  // Save to local storage profiles
  chrome.storage.local.get(['profiles', HERMES_API_KEYS_KEY], (result) => {
    let profiles = result.profiles || [];
    const hermesApiKeys = result[HERMES_API_KEYS_KEY] || {};
    let profileToUpdate = profiles.find((p) => p.id === selectedProfileId);
    const storedApiKey = profileToUpdate?.apiKey || '';
    const storedHermesKey = hermesApiKeys[selectedProfileId] || '';
    const effectiveStoredApiKey =
      provider === 'hermes' ? storedHermesKey : pendingDefaultApiKey || storedApiKey || '';
    const credentialIsConfigured = apiKeyIsMaskedConfigured || Boolean(effectiveStoredApiKey);
    const resolvedCredential = resolveCredentialValue(
      apiKeyValue,
      credentialIsConfigured,
      effectiveStoredApiKey
    );
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

    if (provider === 'hermes') {
      if (resolvedCredential) hermesApiKeys[selectedProfileId] = resolvedCredential;
    } else {
      delete hermesApiKeys[selectedProfileId];
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

    chrome.storage.local.set(
      {
        profiles: profiles,
        [HERMES_API_KEYS_KEY]: hermesApiKeys,
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
          // Reload options to reflect changes, especially if it was a new profile or name changed
          pendingDefaultApiKey = null;
          loadOptions();
          if (markAllTrackersClean) markAllTrackersClean();
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
  chrome.storage.local.get(['profiles', HERMES_API_KEYS_KEY], (result) => {
    const profiles = result.profiles || [];
    const hermesApiKeys = result[HERMES_API_KEYS_KEY] || {};
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
        selectedProfile.provider === 'hermes'
          ? Boolean(hermesApiKeys[selectedProfile.id])
          : Boolean(selectedProfile.apiKey);
      applyCredentialMask(document.getElementById('apiKey'), configuredCredential);
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
      loadAvailableModels(selectedProfile);
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
  refreshSetupStatus = () => {
    chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
      const profiles = result.profiles || [];
      const selectedId = result.lastSelectedProfileId || 'default';
      const profile =
        resolvePreferredProfile({
          selectedProfile: profiles.find((p) => p.id === selectedId),
          defaultProfile: profiles.find((p) => p.id === 'default'),
        }) || {};
      renderSetupStatus(setupStatusText, setupStatusIcon, {
        connected:
          profile.provider === 'codex'
            ? false
            : profile.provider === 'hermes'
              ? Boolean(getHermesEndpoint(profile))
              : Boolean(profile.llmEndpoint && profile.apiKey && profile.modelName),
        model: profile.modelName,
        endpointHost: endpointHost(
          profile.provider === 'hermes' ? getHermesEndpoint(profile) : profile.llmEndpoint
        ),
      });
      if (profile.provider === 'codex') {
        chrome.runtime
          .sendMessage({ action: 'codexAuthStatus', profileId: profile.id })
          .then((response) => {
            renderSetupStatus(setupStatusText, setupStatusIcon, {
              connected: response?.status?.connected === true,
              model: profile.modelName,
              endpointHost: 'ChatGPT subscription',
            });
          })
          .catch(() => {});
      }
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
      { element: document.getElementById('profileSelect') },
      {
        element: document.getElementById('enableStreamingToggle'),
        getValue: (el) => String(Boolean(el && el.checked)),
      },
      {
        element: document.getElementById('darkThemeToggle'),
        getValue: (el) => String(Boolean(el && el.checked)),
      },
    ],
    { onChange: () => syncDirtyBanner() }
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
    [{ element: document.getElementById('braveSearchApiKey') }],
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
  const allTrackers = [connectionTracker, privacyTracker, groundingTracker, pageActionsTracker];
  markGroundingTrackerClean = () => groundingTracker.markClean();
  markPageActionsTrackerClean = () => pageActionsTracker.markClean();
  function syncDirtyBanner() {
    const dirty = allTrackers.some((tracker) => tracker.isDirty());
    if (unsavedBanner) unsavedBanner.hidden = !dirty;
  }
  markAllTrackersClean = () => allTrackers.forEach((tracker) => tracker.markClean());
  allTrackers.forEach((tracker) => tracker.attachEvents(document));
  // beforeunload must cover every tracker, not just the connection form.
  initUnsavedGuard(
    { isDirty: () => allTrackers.some((tracker) => tracker.isDirty()) },
    { confirmBeforeUnload: true }
  );
  // Re-baseline once async storage loads finish so the banner is not shown on
  // first paint; user edits after that flip the guard on again.
  setTimeout(() => {
    if (markAllTrackersClean) markAllTrackersClean();
  }, 1000);

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
  if (analyticsConsentToggle) {
    // Initialize from storage (default true when missing)
    chrome.storage.local.get(['analyticsConsent'], (res) => {
      const consent =
        res && Object.prototype.hasOwnProperty.call(res, 'analyticsConsent')
          ? !!res.analyticsConsent
          : false;
      analyticsConsentToggle.checked = consent;
    });
    // Persist on explicit save (Save Privacy Settings button)
    analyticsConsentToggle.addEventListener('change', () => {
      announceDirtyChange(true);
      showStatus('Privacy changes are pending — click Save Privacy Settings.', false, true);
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

    refreshVoiceInputControls();

    voiceInputEnabledToggle.addEventListener('change', () => {
      announceDirtyChange(true);
      showStatus('Voice input changes are pending — click Save Privacy Settings.', false, true);
    });

    const savePrivacyButton = document.getElementById('savePrivacy');
    if (savePrivacyButton) {
      savePrivacyButton.addEventListener('click', async () => {
        try {
          const consent = !!analyticsConsentToggle.checked;
          await new Promise((resolve, reject) => {
            chrome.storage.local.set({ analyticsConsent: consent }, () => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve();
            });
          });
          await setStoredVoiceInputSettings({
            [VOICE_INPUT_ENABLED_KEY]: !!voiceInputEnabledToggle.checked,
          });
          const status = document.getElementById('privacySaveStatus');
          if (status) status.textContent = 'Privacy settings saved.';
          flashSaveFeedback(savePrivacyButton, false);
          if (typeof markAllTrackersClean === 'function') markAllTrackersClean();
          announceDirtyChange(false);
        } catch (error) {
          showStatus('Failed to save privacy settings: ' + error.message, true, true);
          flashSaveFeedback(savePrivacyButton, true);
        }
      });
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
      });
    });
  }
  setupInstructionHandlers();
  setupToolHandlers(); // Add call to setup tool handlers
  setupSkillHandlers(); // Add call to setup skill handlers
  setupBackupHandlers(); // Add call to setup backup handlers
  setupGroundingHandlers(); // Brave web search key
  setupPageActionHandlers();

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
            chrome.storage.local.set(
              { profiles: profiles, lastSelectedProfileId: newProfileId },
              () => {
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
              }
            );
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
        chrome.storage.local.set({ lastSelectedProfileId: selectedProfileId });
        loadProfileSettings(selectedProfileId);
        if (refreshSetupStatus) refreshSetupStatus();
      }
    });
  }

  // ============================================================
  // SECTION 2: Theme Settings (Sync Storage)
  // ============================================================

  // Dark Theme Toggle
  const darkThemeToggle = document.getElementById('darkThemeToggle');
  if (darkThemeToggle) {
    setupThemeToggle(darkThemeToggle);
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
    if (status) {
      status.textContent = healthWarning
        ? `Connected to Hermes. ${healthWarning}`
        : 'Connected to Hermes.';
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

// Setup instruction management handlers
function setupInstructionHandlers() {
  const saveInstructionBtn = document.getElementById('saveInstruction');
  const clearFormBtn = document.getElementById('clearForm');
  const instructionSearchInput = document.getElementById('instructionSearch');
  const instructionsCount = document.getElementById('instructionsCount');

  let currentInstructions = [];
  let currentPinnedQuickActions = new Set();
  let instructionSearchQuery = '';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeInstructionId(value, fallback) {
    const cleaned = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    if (cleaned) return cleaned;
    return fallback;
  }

  function hashString(value) {
    let hash = 5381;
    for (const character of String(value || '')) {
      hash = (hash * 33) ^ character.codePointAt(0);
    }
    return (hash >>> 0).toString(36);
  }

  function parseTags(value) {
    if (Array.isArray(value)) {
      return value.map((tag) => String(tag || '').trim()).filter(Boolean);
    }

    return String(value || '')
      .split(/[,;\n|]+/g)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  function normalizeInstructionTags(value) {
    const seen = new Set();
    const tags = [];
    for (const tag of parseTags(value)) {
      const normalized = tag.replace(/\s+/g, ' ');
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(normalized.slice(0, 40));
      if (tags.length >= 12) break;
    }
    return tags;
  }

  function normalizeInstructionRecord(instruction) {
    if (!instruction || typeof instruction !== 'object') return null;
    const name = String(instruction.name || '').trim();
    const content = String(instruction.content || '').trim();
    if (!name || !content) return null;
    const tags = normalizeInstructionTags(instruction.tags || []);
    const modalities =
      Array.isArray(instruction.modalities) && instruction.modalities.length > 0
        ? instruction.modalities
        : ['text'];
    const createdAt = instruction.createdAt || instruction.lastUpdated || new Date().toISOString();
    const fallbackId = `inst_${hashString(`${name}\n${content}\n${createdAt}`)}`;
    return {
      ...instruction,
      id: normalizeInstructionId(instruction.id, fallbackId),
      name,
      content,
      tags,
      tool_choice: instruction.tool_choice || 'none',
      modalities,
      createdAt,
      lastUpdated: instruction.lastUpdated || createdAt,
    };
  }

  function formatToolChoiceDisplay(toolChoice) {
    if (!toolChoice) return 'None';
    if (Array.isArray(toolChoice)) {
      if (toolChoice.length === 0 || toolChoice.includes('none')) return 'None';
      if (toolChoice.includes('auto')) return 'Auto';
      return toolChoice.join(', ');
    }
    return String(toolChoice).charAt(0).toUpperCase() + String(toolChoice).slice(1);
  }

  function getInstructionSearchTerms(query) {
    return String(query || '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  function matchesInstructionSearch(instruction, queryTerms) {
    if (queryTerms.length === 0) return true;
    const haystack = [
      instruction.name,
      instruction.content,
      formatToolChoiceDisplay(instruction.tool_choice),
      (instruction.tags || []).join(' '),
    ]
      .join(' ')
      .toLowerCase();
    return queryTerms.every((term) => haystack.includes(term));
  }

  function renderTagChips(tags) {
    if (!tags || tags.length === 0) {
      return '<span class="instruction-tag-chip" style="opacity: 0.72;">No tags</span>';
    }
    return tags
      .map((tag) => `<span class="instruction-tag-chip">${escapeHtml(tag)}</span>`)
      .join('');
  }

  function updateInstructionsCount(visibleCount, totalCount) {
    if (!instructionsCount) return;
    instructionsCount.textContent =
      visibleCount === totalCount
        ? `${totalCount} instruction${totalCount === 1 ? '' : 's'}`
        : `${visibleCount} of ${totalCount} instructions`;
  }

  function renderInstructions() {
    const tableBody = document.querySelector('#instructionsTable tbody');
    if (!tableBody) return;

    const queryTerms = getInstructionSearchTerms(instructionSearchQuery);
    const visibleInstructions = currentInstructions
      .filter((instruction) => matchesInstructionSearch(instruction, queryTerms))
      .sort((a, b) => {
        const aPinned = currentPinnedQuickActions.has(a.id);
        const bPinned = currentPinnedQuickActions.has(b.id);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });

    tableBody.innerHTML = '';

    if (visibleInstructions.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = `
        <td colspan="6" style="text-align:center;color:var(--ext-muted-foreground);padding:1.5rem;">
          ${currentInstructions.length === 0 ? 'No instructions yet.' : 'No instructions match your search.'}
        </td>
      `;
      tableBody.appendChild(emptyRow);
      updateInstructionsCount(0, currentInstructions.length);
      return;
    }

    visibleInstructions.forEach((instruction) => {
      const row = document.createElement('tr');
      const toolChoiceDisplay = formatToolChoiceDisplay(instruction.tool_choice);
      const tagsHtml = renderTagChips(instruction.tags || []);
      row.innerHTML = `
        <td data-label="Name">${escapeHtml(instruction.name)}</td>
        <td data-label="Tags"><div class="instruction-tags-cell">${tagsHtml}</div></td>
        <td data-label="Content">${escapeHtml(instruction.content)}</td>
        <td data-label="Tool Choice">${escapeHtml(toolChoiceDisplay)}</td>
        <td data-label="Pin"><button class="pin-btn${currentPinnedQuickActions.has(instruction.id) ? ' pinned' : ''}" data-id="${escapeHtml(instruction.id)}" title="${currentPinnedQuickActions.has(instruction.id) ? 'Unpin from Quick Actions' : 'Pin to Quick Actions'}"><span class="material-symbols-outlined">${currentPinnedQuickActions.has(instruction.id) ? 'keep_off' : 'push_pin'}</span></button></td>
        <td data-label="Actions">
          <div class="instruction-actions">
            <button class="edit-btn" data-id="${escapeHtml(instruction.id)}">Edit</button>
            <button class="improve-btn" data-id="${escapeHtml(instruction.id)}">Improve</button>
            <button class="delete-btn" data-id="${escapeHtml(instruction.id)}">Delete</button>
          </div>
        </td>
      `;
      tableBody.appendChild(row);
    });

    updateInstructionsCount(visibleInstructions.length, currentInstructions.length);

    document.querySelectorAll('.pin-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const button = e.currentTarget;
        const instructionId = button.dataset.id;
        chrome.storage.local.get(['pinnedQuickActions'], (result) => {
          let pinnedQuickActions = result.pinnedQuickActions || [];
          const isPinned = pinnedQuickActions.includes(instructionId);

          if (isPinned) {
            pinnedQuickActions = pinnedQuickActions.filter((id) => id !== instructionId);
            showStatus('Instruction unpinned from Quick Actions.');
          } else {
            pinnedQuickActions.push(instructionId);
            showStatus('Instruction pinned to Quick Actions.');
          }

          chrome.storage.local.set({ pinnedQuickActions }, () => {
            currentPinnedQuickActions = new Set(pinnedQuickActions);
            renderInstructions();
          });
        });
      });
    });

    document.querySelectorAll('.edit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const instructionId = e.currentTarget.dataset.id;
        const instruction = currentInstructions.find((item) => item.id === instructionId);
        if (instruction) {
          document.getElementById('instructionName').value = instruction.name;
          document.getElementById('instructionContent').value = instruction.content;
          document.getElementById('instructionTags').value = (instruction.tags || []).join(', ');
          document.getElementById('instructionId').value = instruction.id;

          const toolChoiceInput = document.getElementById('instructionToolChoice');
          if (toolChoiceInput) {
            if (Array.isArray(instruction.tool_choice)) {
              toolChoiceInput.value = instruction.tool_choice.join(', ');
            } else if (instruction.tool_choice) {
              toolChoiceInput.value = instruction.tool_choice;
            } else {
              toolChoiceInput.value = 'none';
            }
          }

          const modalities = instruction.modalities || ['text'];
          document.getElementById('modalityText').checked = modalities.includes('text');
          document.getElementById('modalityImage').checked = modalities.includes('image');
          document.getElementById('modalityVideo').checked = modalities.includes('video');
          document.getElementById('modalityAudio').checked = modalities.includes('audio');
        }
      });
    });

    document.querySelectorAll('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const instructionId = e.currentTarget.dataset.id;
        if (confirm('Are you sure you want to delete this instruction?')) {
          chrome.storage.local.get(['instructions'], (result) => {
            let instructions = result.instructions || [];
            instructions = instructions.filter((item) => item.id !== instructionId);
            chrome.storage.local.set({ instructions }, () => {
              showStatus('Instruction deleted.');
              refreshInstructions();
              if (document.getElementById('instructionId').value === instructionId) {
                clearForm();
              }
            });
          });
        }
      });
    });

    document.querySelectorAll('.improve-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const instructionId = e.currentTarget.dataset.id;
        const instruction = currentInstructions.find((item) => item.id === instructionId);
        if (instruction) {
          showStatus('Improving instruction...', false, true);
          try {
            const config = await new Promise((resolve, reject) => {
              chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
                const profiles = result.profiles || [];
                const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
                const selectedProfile = profiles.find((p) => p.id === lastSelectedProfileId);
                if (
                  selectedProfile &&
                  selectedProfile.llmEndpoint &&
                  selectedProfile.apiKey &&
                  selectedProfile.modelName
                ) {
                  resolve(selectedProfile);
                } else {
                  reject(
                    new Error('API configuration is incomplete. Please set it up in settings.')
                  );
                }
              });
            });

            const improvedContent = await improvePromptAPI(
              config.llmEndpoint,
              config.apiKey,
              config.modelName,
              instruction.content
            );

            document.getElementById('instructionName').value = instruction.name;
            document.getElementById('instructionContent').value = improvedContent;
            document.getElementById('instructionTags').value = (instruction.tags || []).join(', ');
            document.getElementById('instructionId').value = instruction.id;

            showStatus('Instruction improved. Review and save.', false, true);
          } catch (error) {
            console.error('Error improving instruction:', error);
            showStatus('Failed to improve instruction: ' + error.message, true);
          }
        }
      });
    });
  }

  function refreshInstructions() {
    chrome.storage.local.get(['instructions', 'pinnedQuickActions'], (result) => {
      currentInstructions = (result.instructions || [])
        .map(normalizeInstructionRecord)
        .filter(Boolean);
      currentPinnedQuickActions = new Set(result.pinnedQuickActions || []);
      renderInstructions();
    });
  }

  // Save instruction handler
  if (saveInstructionBtn) {
    saveInstructionBtn.addEventListener('click', () => {
      const instructionName = document.getElementById('instructionName').value.trim();
      const instructionContent = document.getElementById('instructionContent').value.trim();
      const instructionTags = document.getElementById('instructionTags').value.trim();
      const instructionId = document.getElementById('instructionId').value;
      const toolChoiceInput = document.getElementById('instructionToolChoice');
      const toolChoiceValue = toolChoiceInput.value.trim();
      const tags = normalizeInstructionTags(instructionTags);

      // Get selected modalities
      const modalities = [];
      if (document.getElementById('modalityText').checked) modalities.push('text');
      if (document.getElementById('modalityImage').checked) modalities.push('image');
      if (document.getElementById('modalityVideo').checked) modalities.push('video');
      if (document.getElementById('modalityAudio').checked) modalities.push('audio');

      if (!instructionName || !instructionContent) {
        showStatus('Instruction name and content are required.', true);
        return;
      }

      chrome.storage.local.get(['instructions'], (result) => {
        let instructions = result.instructions || [];
        const now = new Date().toISOString();

        if (instructionId) {
          // Update existing instruction
          instructions = instructions.map((inst) => {
            if (inst.id === instructionId) {
              return {
                ...inst,
                name: instructionName,
                content: instructionContent,
                tags,
                tool_choice: toolChoiceValue || 'none', // Save as string
                modalities: modalities.length > 0 ? modalities : ['text'], // Default to text
                lastUpdated: now,
              };
            }
            return inst;
          });
          showStatus('Instruction updated.');
        } else {
          // Add new instruction
          const newInstruction = {
            id: createUniqueId('inst'),
            name: instructionName,
            content: instructionContent,
            tags,
            tool_choice: toolChoiceValue || 'none', // Save as string
            modalities: modalities.length > 0 ? modalities : ['text'], // Default to text
            createdAt: now,
            lastUpdated: now,
          };
          instructions.push(newInstruction);
          showStatus('Instruction added.');
        }

        chrome.storage.local.set({ instructions: instructions }, () => {
          refreshInstructions(); // Reload the table
          resetInstructionForm(); // Clear the form after saving without confirmation
        });
      });
    });
  }

  // Clear form handler
  if (clearFormBtn) {
    clearFormBtn.addEventListener('click', clearForm);
  }

  function resetInstructionForm() {
    document.getElementById('instructionName').value = '';
    document.getElementById('instructionContent').value = '';
    document.getElementById('instructionTags').value = '';
    document.getElementById('instructionId').value = '';
    document.getElementById('instructionToolChoice').value = '';

    // Reset modality checkboxes - Text checked by default, others unchecked
    document.getElementById('modalityText').checked = true;
    document.getElementById('modalityImage').checked = false;
    document.getElementById('modalityVideo').checked = false;
    document.getElementById('modalityAudio').checked = false;
  }
  async function clearForm() {
    // Check if form has any content that would be lost
    const name = document.getElementById('instructionName').value;
    const content = document.getElementById('instructionContent').value;
    const hasContent = name.trim() !== '' || content.trim() !== '';

    // Only confirm if there's actual content to clear
    if (hasContent) {
      const confirmed = await showConfirmModal(
        'Clear the form? Unsaved changes will be lost.',
        'Clear Form',
        'Clear'
      );
      if (!confirmed) {
        return; // User cancelled
      }
    }

    resetInstructionForm();

    showStatus('Form cleared.');
  }

  // Export instructions handler
  document.getElementById('exportInstructions').addEventListener('click', () => {
    chrome.storage.local.get(['instructions'], (result) => {
      const instructions = result.instructions || [];
      const exportData = {
        version: 1, // Versioning for future compatibility
        instructions: instructions,
      };
      const dataStr =
        'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute('href', dataStr);
      downloadAnchorNode.setAttribute('download', 'prompt_paul_instructions.json');
      document.body.appendChild(downloadAnchorNode); // Required for Firefox
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    });
  });

  // Import instructions handler
  document.getElementById('importInstructions').addEventListener('click', () => {
    document.getElementById('importFile').click(); // Trigger the hidden file input
  });

  document.getElementById('importFile').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        if (importData.version === 1 && Array.isArray(importData.instructions)) {
          // Simple merge strategy: add new instructions, update existing by ID
          chrome.storage.local.get(['instructions'], (result) => {
            let existingInstructions = result.instructions || [];
            const importedInstructions = importData.instructions;

            importedInstructions.forEach((importedInst) => {
              const existingIndex = existingInstructions.findIndex(
                (inst) => inst.id === importedInst.id
              );
              if (existingIndex > -1) {
                // Update existing instruction
                existingInstructions[existingIndex] = {
                  ...existingInstructions[existingIndex],
                  ...importedInst,
                  lastUpdated: new Date().toISOString(),
                };
              } else {
                // Add new instruction
                existingInstructions.push({
                  ...importedInst,
                  id: importedInst.id || createUniqueId('inst'),
                  createdAt: importedInst.createdAt || new Date().toISOString(),
                  lastUpdated: new Date().toISOString(),
                });
              }
            });

            chrome.storage.local.set({ instructions: existingInstructions }, () => {
              showStatus('Instructions imported successfully.');
              refreshInstructions(); // Reload the table
            });
          });
        } else {
          showStatus('Invalid import file format.', true);
        }
      } catch (error) {
        console.error('Error importing instructions:', error);
        showStatus('Error reading or parsing import file.', true);
      }
    };
    reader.readAsText(file);
  });

  // Initial load of instructions and tools
  refreshInstructions();
  populateToolDropdown(); // Populate tool dropdown on load

  if (instructionSearchInput) {
    instructionSearchInput.addEventListener('input', (event) => {
      instructionSearchQuery = event.target.value || '';
      renderInstructions();
    });

    instructionSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && instructionSearchInput.value) {
        instructionSearchInput.value = '';
        instructionSearchQuery = '';
        renderInstructions();
        event.preventDefault();
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    const isSearchShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    if (!isSearchShortcut) return;
    event.preventDefault();
    if (instructionSearchInput) {
      instructionSearchInput.focus();
      instructionSearchInput.select();
    }
  });

  window.setupInstructionHandlers = setupInstructionHandlers;
  window.loadInstructions = refreshInstructions;
}

// Function to call the API for prompt improvement
async function improvePromptAPI(endpoint, apiKey, modelName, prompt) {
  const messages = [
    {
      role: 'system',
      content:
        'You are an expert prompt engineer. Improve the following prompt for a large language model to be clearer, more concise, and more effective. Only return the improved prompt text, nothing else.',
    },
    { role: 'user', content: prompt },
  ];

  const apiResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages: messages,
      temperature: 0.7,
    }),
  });

  if (!apiResponse.ok) {
    const errorData = await apiResponse.json().catch(() => null);
    throw new Error(
      `API request failed with status ${apiResponse.status}: ${
        errorData ? JSON.stringify(errorData) : apiResponse.statusText
      }`
    );
  }

  const responseData = await apiResponse.json();
  if (
    !responseData ||
    !responseData.choices ||
    !responseData.choices[0] ||
    !responseData.choices[0].message ||
    !responseData.choices[0].message.content
  ) {
    throw new Error('Invalid response format from API: Missing message content.');
  }

  return responseData.choices[0].message.content.trim();
}

function isValidJson(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
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
          showStatus('Tool updated.');
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
          showStatus('Tool added.');
        }

        chrome.storage.local.set({ promptPaulTools: tools }, () => {
          loadTools(); // Reload the table
          populateToolDropdown(); // Update tool dropdown
          clearToolForm(); // Clear the form after saving
          loadingManager.setButtonLoading(saveToolBtn, false);
        });
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
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        if (importData.version === 1 && Array.isArray(importData.tools)) {
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

// Setup skill management handlers
function setupSkillHandlers() {
  const saveSkillBtn = document.getElementById('saveSkill');
  const clearSkillFormBtn = document.getElementById('clearSkillForm');

  // Load and display skills
  function loadSkills() {
    // Load built-in skills first
    const builtInSkillsPromise = fetch(chrome.runtime.getURL('skills/skills.json'))
      .then((response) => response.json())
      .catch((e) => {
        console.warn('Failed to load built-in skills:', e);
        return [];
      });

    // Load custom skills
    const customSkillsPromise = new Promise((resolve) => {
      chrome.storage.local.get(['customSkills'], (result) => {
        resolve(result.customSkills || []);
      });
    });

    Promise.all([builtInSkillsPromise, customSkillsPromise]).then(([builtIn, custom]) => {
      const skillsMap = new Map();
      // Built-in first
      builtIn.forEach((s) => skillsMap.set(s.name, { ...s, source: 'Built-in' }));
      // Custom overrides built-in (or adds new)
      custom.forEach((s) => {
        const parsed = typeof s.skillMd === 'string' ? parseSkillMarkdown(s.skillMd) : null;
        const description = parsed?.valid
          ? parsed.metadata.description
          : `Invalid SKILL.md (${parsed?.error || 'canonical skillMd is required'})`;
        skillsMap.set(s.name, { ...s, description, source: 'Custom' });
      });

      const skills = Array.from(skillsMap.values());
      const tableBody = document.querySelector('#skillsTable tbody');
      if (tableBody) {
        tableBody.innerHTML = '';

        skills.forEach((skill) => {
          const row = document.createElement('tr');
          const isCustom = skill.source === 'Custom';
          const actions = isCustom
            ? `<button class="edit-skill-btn" data-name="${escapeHtml(skill.name)}">Edit</button>
                  <button class="delete-skill-btn" data-name="${escapeHtml(skill.name)}">Delete</button>`
            : `<span class="text-muted" style="color: grey; font-style: italic;">Built-in (Read-only)</span>`;

          row.innerHTML = `
              <td data-label="Name">${escapeHtml(skill.name)}</td>
              <td data-label="Description">${escapeHtml(skill.description)}</td>
              <td data-label="Source">${escapeHtml(skill.source)}</td>
              <td data-label="Actions">${actions}</td>
            `;
          tableBody.appendChild(row);
        });
      }

      // Add edit/delete handlers
      document.querySelectorAll('.edit-skill-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const skillName = e.target.dataset.name;
          const skill = custom.find((s) => s.name === skillName);
          if (skill) {
            document.getElementById('skillName').value = skill.name;
            document.getElementById('skillName').disabled = true; // Cannot change ID of existing skill

            if (typeof skill.skillMd !== 'string') {
              showStatus(`Skill '${skillName}' is not in canonical SKILL.md format.`, true);
              return;
            }

            const parsed = parseSkillMarkdown(skill.skillMd);
            if (!parsed.valid) {
              showStatus(`Skill '${skillName}' could not be parsed: ${parsed.error}`, true);
              return;
            }

            document.getElementById('skillDescription').value = parsed.metadata.description;
            document.getElementById('skillContent').value = parsed.instructions;

            const licenseInput = document.getElementById('skillLicense');
            const compatibilityInput = document.getElementById('skillCompatibility');
            const allowedToolsInput = document.getElementById('skillAllowedTools');
            const metadataInput = document.getElementById('skillMetadata');

            if (licenseInput) licenseInput.value = parsed.metadata.license || '';
            if (compatibilityInput) compatibilityInput.value = parsed.metadata.compatibility || '';
            if (allowedToolsInput) allowedToolsInput.value = parsed.metadata['allowed-tools'] || '';
            if (metadataInput) {
              metadataInput.value = parsed.metadata.metadata
                ? JSON.stringify(parsed.metadata.metadata, null, 2)
                : '';
            }
          }
        });
      });

      document.querySelectorAll('.delete-skill-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const skillName = e.target.dataset.name;
          if (confirm(`Delete skill '${skillName}'?`)) {
            chrome.storage.local.get(['customSkills'], (result) => {
              let customSkills = result.customSkills || [];
              customSkills = customSkills.filter((s) => s.name !== skillName);
              chrome.storage.local.set({ customSkills }, () => {
                showStatus('Skill deleted.');
                loadSkills();
                clearSkillForm();
              });
            });
          }
        });
      });
    });
  }

  // Save skill handler - generates canonical SKILL.md format
  if (saveSkillBtn) {
    saveSkillBtn.addEventListener('click', () => {
      const nameInput = document.getElementById('skillName');
      const name = nameInput.value.trim();
      const description = document.getElementById('skillDescription').value.trim();
      const content = document.getElementById('skillContent').value.trim();

      // Optional fields (Agent Skills spec)
      const licenseInput = document.getElementById('skillLicense');
      const compatibilityInput = document.getElementById('skillCompatibility');
      const allowedToolsInput = document.getElementById('skillAllowedTools');
      const userInvocableInput = document.getElementById('skillUserInvocable');
      const disableModelInvocationInput = document.getElementById('skillDisableModelInvocation');

      const license = licenseInput ? licenseInput.value.trim() : '';
      const compatibility = compatibilityInput ? compatibilityInput.value.trim() : '';
      const allowedTools = allowedToolsInput ? allowedToolsInput.value.trim() : '';
      const userInvocable = userInvocableInput ? userInvocableInput.checked : true;
      const disableModelInvocation = disableModelInvocationInput
        ? disableModelInvocationInput.checked
        : false;

      let customMetadata = null;
      const metadataInput = document.getElementById('skillMetadata');
      if (metadataInput && metadataInput.value.trim()) {
        if (!isValidJson(metadataInput.value.trim())) {
          showStatus('Metadata must be valid JSON object.', true);
          return;
        }

        const parsedMetadata = JSON.parse(metadataInput.value.trim());
        if (
          !parsedMetadata ||
          typeof parsedMetadata !== 'object' ||
          Array.isArray(parsedMetadata)
        ) {
          showStatus('Metadata must be a JSON object.', true);
          return;
        }
        customMetadata = parsedMetadata;
      }

      if (!name || !description || !content) {
        showStatus('All fields are required.', true);
        return;
      }

      const validation = validateMetadata({
        name,
        description,
        ...(license ? { license } : {}),
        ...(compatibility ? { compatibility } : {}),
        ...(allowedTools ? { 'allowed-tools': allowedTools } : {}),
        ...(customMetadata ? { metadata: customMetadata } : {}),
        'user-invocable': userInvocable,
        'disable-model-invocation': disableModelInvocation,
      });

      if (!validation.valid) {
        showStatus(validation.error, true);
        return;
      }

      // Generate canonical SKILL.md content
      const skillMd = generateSkillMarkdown({
        name,
        description,
        instructions: content,
        options: {
          ...(license ? { license } : {}),
          ...(compatibility ? { compatibility } : {}),
          ...(allowedTools ? { 'allowed-tools': allowedTools } : {}),
          ...(customMetadata ? { metadata: customMetadata } : {}),
          userInvocable,
          disableModelInvocation,
        },
      });

      chrome.storage.local.get(['customSkills'], (result) => {
        let customSkills = result.customSkills || [];
        // Check if updating
        const existingIndex = customSkills.findIndex((s) => s.name === name);

        // Store in canonical format with skillMd field
        const newSkill = {
          name,
          skillMd,
          lastUpdated: new Date().toISOString(),
        };

        if (existingIndex > -1) {
          customSkills[existingIndex] = newSkill;
          showStatus('Skill updated.');
        } else {
          customSkills.push(newSkill);
          showStatus('Skill added.');
        }

        chrome.storage.local.set({ customSkills }, () => {
          loadSkills();
          clearSkillForm();
        });
      });
    });
  }

  // Clear skill form handler
  if (clearSkillFormBtn) {
    clearSkillFormBtn.addEventListener('click', clearSkillForm);
  }

  function clearSkillForm() {
    const nameInput = document.getElementById('skillName');
    if (nameInput) {
      nameInput.value = '';
      nameInput.disabled = false;
    }
    const descInput = document.getElementById('skillDescription');
    if (descInput) descInput.value = '';
    const contentInput = document.getElementById('skillContent');
    if (contentInput) contentInput.value = '';

    const optionalInputs = [
      'skillLicense',
      'skillCompatibility',
      'skillAllowedTools',
      'skillMetadata',
    ];
    optionalInputs.forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });

    // Reset checkbox fields
    const userInvocableInput = document.getElementById('skillUserInvocable');
    if (userInvocableInput) userInvocableInput.checked = true;

    const disableModelInvocationInput = document.getElementById('skillDisableModelInvocation');
    if (disableModelInvocationInput) disableModelInvocationInput.checked = false;

    showStatus('Skill form cleared.');
  }

  // Export skills handler - v2 format with canonical SKILL.md
  const exportBtn = document.getElementById('exportSkills');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      chrome.storage.local.get(['customSkills'], (result) => {
        const customSkills = result.customSkills || [];
        // v2 format with spec version
        const exportData = {
          version: '2.0',
          spec: 'agentskills.io',
          exportedAt: new Date().toISOString(),
          skills: customSkills,
        };
        const dataStr =
          'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute('href', dataStr);
        downloadAnchorNode.setAttribute('download', 'prompt_paul_skills.json');
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
      });
    });
  }

  // Import canonical Agent Skills export format.
  const importBtn = document.getElementById('importSkills');
  if (importBtn) {
    importBtn.addEventListener('click', () => {
      document.getElementById('importSkillsFile').click();
    });
  }

  const importFile = document.getElementById('importSkillsFile');
  if (importFile) {
    importFile.addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          let skillsToImport = [];

          if (imported.version !== '2.0' || !Array.isArray(imported.skills)) {
            showStatus('Invalid skill file format. Expected a v2 skills export.', true);
            return;
          }
          skillsToImport = imported.skills;

          chrome.storage.local.get(['customSkills'], (result) => {
            let customSkills = result.customSkills || [];
            let importCount = 0;
            let invalidCount = 0;

            skillsToImport.forEach((newSkill) => {
              if (typeof newSkill.skillMd !== 'string' || newSkill.skillMd.trim() === '') {
                invalidCount++;
                return;
              }
              const canonicalMarkdown = newSkill.skillMd;

              const parsed = parseSkillMarkdown(canonicalMarkdown);
              if (!parsed.valid) {
                invalidCount++;
                return;
              }

              const skillToSave = {
                name: parsed.metadata.name,
                skillMd: canonicalMarkdown,
                lastUpdated: newSkill.lastUpdated || new Date().toISOString(),
              };

              const idx = customSkills.findIndex((s) => s.name === skillToSave.name);
              if (idx > -1) {
                customSkills[idx] = skillToSave;
              } else {
                customSkills.push(skillToSave);
              }
              importCount++;
            });

            chrome.storage.local.set({ customSkills }, () => {
              const invalidMsg = invalidCount > 0 ? ` (${invalidCount} skipped as invalid)` : '';
              showStatus(`Imported ${importCount} skills${invalidMsg}.`);
              loadSkills();
            });
          });
        } catch (err) {
          console.error(err);
          showStatus('Error parsing skill file.', true);
        }
      };
      reader.readAsText(file);
    });
  }

  // Skills.sh Import Handler
  function setupSkillsShImport() {
    const urlInput = document.getElementById('skillsShUrl');
    const importBtn = document.getElementById('importSkillsShBtn');
    const findBtn = document.getElementById('findSkillsShBtn');
    const statusEl = document.getElementById('skillsShStatus');

    if (!urlInput || !importBtn || !findBtn || !statusEl) {
      return;
    }

    // Helper function to fetch skill from GitHub with multiple path/branch fallback
    async function fetchSkillFromGitHub(owner, repo, skillName) {
      const branches = ['main', 'master'];
      const pathPatterns = [`skills/${skillName}/SKILL.md`, `${skillName}/SKILL.md`];

      // Try common paths first
      for (const branch of branches) {
        for (const path of pathPatterns) {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
          try {
            const response = await fetch(rawUrl);
            if (response.ok) {
              const skillMd = await response.text();
              if (skillMd && skillMd.trim().length > 0) {
                console.log(`[Skills Import] Found skill at: ${rawUrl}`);
                return { skillMd, url: rawUrl };
              }
            }
          } catch (e) {
            // Continue to next path
          }
        }
      }

      // Fallback: Use GitHub API to search for skill by name
      console.log('[Skills Import] Falling back to GitHub API search...');
      return await searchSkillViaGitHubAPI(owner, repo, skillName);
    }

    // Search for skill by name using GitHub API
    async function searchSkillViaGitHubAPI(owner, repo, skillName) {
      try {
        // Fetch repository tree (recursive)
        const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
        const treeResponse = await fetch(treeUrl);

        if (!treeResponse.ok) {
          // Try master branch if main fails
          const masterTreeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`;
          const masterResponse = await fetch(masterTreeUrl);
          if (!masterResponse.ok) return null;
          const masterTree = await masterResponse.json();
          return await findSkillInTree(owner, repo, masterTree, skillName, 'master');
        }

        const tree = await treeResponse.json();
        return await findSkillInTree(owner, repo, tree, skillName, 'main');
      } catch (e) {
        console.error('[Skills Import] API search failed:', e);
        return null;
      }
    }

    // Find skill in GitHub tree by parsing SKILL.md files
    async function findSkillInTree(owner, repo, tree, skillName, branch) {
      const skillMdFiles = tree.tree.filter((item) => item.path && item.path.endsWith('SKILL.md'));

      for (const file of skillMdFiles) {
        try {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
          const response = await fetch(rawUrl);
          if (!response.ok) continue;

          const content = await response.text();

          // Parse frontmatter to get skill name
          const nameMatch = content.match(/^---\s*\n[\s\S]*?name:\s*(.+?)\s*\n/);
          if (nameMatch) {
            const foundName = nameMatch[1].trim().replace(/^["']|["']$/g, '');
            if (foundName === skillName || foundName.toLowerCase() === skillName.toLowerCase()) {
              console.log(`[Skills Import] Found skill via API: ${file.path} (name: ${foundName})`);
              return { skillMd: content, url: rawUrl };
            }
          }
        } catch (e) {
          // Continue to next file
        }
      }

      return null;
    }

    // Find Skills button - opens skills.sh in new tab
    findBtn.addEventListener('click', () => {
      window.open('https://skills.sh', '_blank');
    });

    // Import button handler
    importBtn.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) {
        statusEl.textContent =
          '<span style="color: var(--ext-destructive);">Please enter a skills.sh URL</span>';
        return;
      }

      // Parse skills.sh URL: https://skills.sh/{owner}/{repo}/{skill-name}
      // Also support: https://skills.sh/{owner}/{repo}/{skill-name}/
      const urlMatch = url.match(/^https?:\/\/skills\.sh\/([^/]+)\/([^/]+)\/([^/]+)\/?$/);
      if (!urlMatch) {
        statusEl.textContent =
          '<span style="color: var(--ext-destructive);">Invalid URL format. Use: https://skills.sh/owner/repo/skill-name</span>';
        return;
      }

      const [, owner, repo, skillName] = urlMatch;

      // Show loading state
      importBtn.disabled = true;
      importBtn.innerHTML =
        '<span class="material-symbols-outlined sync-spin">sync</span> Importing...';
      statusEl.textContent = 'Fetching skill from GitHub...';

      try {
        // Fetch skill with multiple path/branch fallback strategies
        const fetchResult = await fetchSkillFromGitHub(owner, repo, skillName);

        if (!fetchResult) {
          throw new Error(
            `Skill "${skillName}" not found in ${owner}/${repo}. The skill may be in a different location or use a different name.`
          );
        }

        const { skillMd } = fetchResult;

        statusEl.textContent =
          '<span style="color: var(--ext-muted-foreground);">Found skill, saving...</span>';

        // Parse the skill markdown
        const parsed = parseSkillMarkdown(skillMd);
        if (!parsed.valid) {
          throw new Error(`Invalid SKILL.md: ${parsed.error}`);
        }

        // Check for duplicate
        const customSkillsResult = await new Promise((resolve) => {
          chrome.storage.local.get(['customSkills'], resolve);
        });
        const existingCustomSkills = customSkillsResult.customSkills || [];
        const existingIndex = existingCustomSkills.findIndex(
          (s) => s.name === parsed.metadata.name
        );

        if (existingIndex > -1) {
          const overwrite = confirm(`Skill '${parsed.metadata.name}' already exists. Overwrite?`);
          if (!overwrite) {
            resetButton();
            return;
          }
        }

        // Save the skill
        const newSkill = {
          name: parsed.metadata.name,
          skillMd: skillMd,
          lastUpdated: new Date().toISOString(),
        };

        if (existingIndex > -1) {
          existingCustomSkills[existingIndex] = newSkill;
        } else {
          existingCustomSkills.push(newSkill);
        }

        await new Promise((resolve) => {
          chrome.storage.local.set({ customSkills: existingCustomSkills }, resolve);
        });

        statusEl.innerHTML =
          '<span class="ext-text-primary">✓ Successfully imported "' +
          escapeHtml(parsed.metadata.name) +
          '"</span>';
        urlInput.value = '';
        loadSkills(); // Reload the skills table

        setTimeout(() => {
          statusEl.textContent = '';
        }, 3000);
      } catch (error) {
        statusEl.textContent = `Error: ${error?.message || 'Could not import the skill.'}`;
      } finally {
        resetButton();
      }

      function resetButton() {
        importBtn.disabled = false;
        importBtn.innerHTML = '<span class="material-symbols-outlined">add</span> Import';
      }
    });

    // Enter key to import
    urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        importBtn.click();
      }
    });
  }

  // Initialize skills.sh import
  setupSkillsShImport();

  // Initial load
  loadSkills();
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
            await new Promise((resolve) =>
              chrome.storage.local.set(normalizedBackup.value.local, resolve)
            );
          }
          if (Object.keys(normalizedBackup.value.sync).length > 0) {
            await new Promise((resolve) =>
              chrome.storage.sync.set(normalizedBackup.value.sync, resolve)
            );
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
 * Setup handlers for the Web Search Grounding (Brave) configuration.
 */
function setupGroundingHandlers() {
  const keyInput = document.getElementById('braveSearchApiKey');
  const keyToggle = document.getElementById('braveSearchKeyToggle');
  const keyRemove = document.getElementById('braveSearchKeyRemove');
  const keyStatus = document.getElementById('braveSearchKeyStatus');

  function updateKeyStatus() {
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

  // Explicit save for the Brave key (replaces debounced auto-save)
  const saveGroundingButton = document.getElementById('saveGrounding');
  if (saveGroundingButton && keyInput) {
    saveGroundingButton.addEventListener('click', () => {
      const value = keyInput.value.trim();
      const wasConfigured = keyInput.dataset.configured === 'true';
      const finish = (error) => {
        if (error) {
          showStatus('Failed to save Brave key: ' + error.message, true, true);
          flashSaveFeedback(saveGroundingButton, true);
          return;
        }
        updateKeyStatus();
        showStatus('Brave Search API key saved.', false, true);
        flashSaveFeedback(saveGroundingButton, false);
        if (markGroundingTrackerClean) markGroundingTrackerClean();
        announceDirtyChange(false);
      };
      if (value) {
        chrome.storage.local.set({ braveSearchApiKey: value }, () =>
          finish(chrome.runtime.lastError)
        );
      } else if (wasConfigured) {
        // Masked field with no new value — keep the existing stored key.
        finish(null);
      } else {
        showStatus('Enter a Brave Search API key or remove the existing one.', true, true);
        flashSaveFeedback(saveGroundingButton, true);
      }
    });
  }

  // Mark dirty on input; persist only via the explicit save button.
  if (keyInput) {
    keyInput.addEventListener('input', () => {
      if (keyInput.dataset.configured === 'true') delete keyInput.dataset.configured;
      if (keyStatus) {
        keyStatus.textContent = 'Unsaved changes — click Save Web Search Settings.';
      }
      announceDirtyChange(true);
    });
  }

  // Load initial state
  updateKeyStatus();
}

/**
 * Setup the trusted current-page action preference.
 */
function setupPageActionHandlers() {
  const toggle = document.getElementById('pageActionsTrustedMode');
  const saveButton = document.getElementById('savePageActions');
  const status = document.getElementById('pageActionsSaveStatus');
  if (!toggle) return;

  chrome.storage.local.get(['pageActionsTrustedMode'], (result) => {
    toggle.checked = result.pageActionsTrustedMode === true;
    if (status)
      status.textContent = toggle.checked ? 'Trusted mode is on.' : 'Trusted mode is off.';
  });

  toggle.addEventListener('change', () => {
    announceDirtyChange(true);
    if (status) status.textContent = 'Unsaved changes — click Save Page Action Settings.';
  });

  saveButton?.addEventListener('click', () => {
    chrome.storage.local.set({ pageActionsTrustedMode: toggle.checked }, () => {
      if (chrome.runtime.lastError) {
        showStatus(
          'Failed to save page-action settings: ' + chrome.runtime.lastError.message,
          true,
          true
        );
        flashSaveFeedback(saveButton, true);
        return;
      }
      if (status)
        status.textContent = toggle.checked ? 'Trusted mode is on.' : 'Trusted mode is off.';
      showStatus('Page-action settings saved.', false, true);
      flashSaveFeedback(saveButton, false);
      markPageActionsTrackerClean?.();
      announceDirtyChange(false);
    });
  });
}
