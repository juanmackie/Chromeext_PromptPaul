/**
 * @fileoverview Options UI Module - setup status, per-section saves,
 * credential masking, and unsaved-change protection for the Options page.
 *
 * Keeps options.js growth minimal and makes the new setup/management logic
 * unit-testable without a browser.
 *
 * @module OptionsUI
 */

/** Masked placeholder shown in credential fields when a key is configured. */
export const MASKED_KEY_PLACEHOLDER = '•••••••••••••• (configured; leave blank to keep)';

/**
 * Creates a dirty tracker over a set of form fields.
 *
 * Each field descriptor is { element, getValue }. The tracker snapshots the
 * baseline on creation and after markClean(), and reports dirty when any
 * field's current value differs from the baseline.
 *
 * @param {Array} fields - Field descriptors.
 * @param {Object} [options] - Options.
 * @param {Function} [options.onChange] - Called with (isDirty, dirtyFields).
 * @returns {Object} Dirty tracker API.
 */
export function createDirtyTracker(fields, options = {}) {
  const descriptors = Array.isArray(fields) ? fields : [];
  let baseline = new Map();
  let dirtyFields = new Set();

  function readValue(descriptor) {
    if (!descriptor || !descriptor.element) return null;
    if (typeof descriptor.getValue === 'function') {
      return descriptor.getValue(descriptor.element);
    }
    return descriptor.element.value !== undefined ? descriptor.element.value : null;
  }

  function snapshot() {
    baseline = new Map();
    for (const descriptor of descriptors) {
      baseline.set(descriptor, readValue(descriptor));
    }
  }

  function computeDirty() {
    dirtyFields = new Set();
    for (const descriptor of descriptors) {
      if (readValue(descriptor) !== baseline.get(descriptor)) {
        dirtyFields.add(descriptor);
      }
    }
    return dirtyFields;
  }

  function emit() {
    const dirty = computeDirty();
    if (typeof options.onChange === 'function') {
      options.onChange(dirty.size > 0, Array.from(dirty));
    }
    return dirty.size > 0;
  }

  function isDirty() {
    return computeDirty().size > 0;
  }

  function getDirtyCount() {
    return computeDirty().size;
  }

  function markClean() {
    snapshot();
    dirtyFields = new Set();
    if (typeof options.onChange === 'function') {
      options.onChange(false, []);
    }
  }

  function attachEvents(root) {
    const eventRoot = root || (descriptors[0] && descriptors[0].element);
    if (!eventRoot || typeof eventRoot.addEventListener !== 'function') {
      return () => {};
    }
    const listener = () => emit();
    eventRoot.addEventListener('input', listener, true);
    eventRoot.addEventListener('change', listener, true);
    return () => {
      eventRoot.removeEventListener('input', listener, true);
      eventRoot.removeEventListener('change', listener, true);
    };
  }

  snapshot();

  return {
    isDirty,
    getDirtyCount,
    getDirtyFields: () => Array.from(dirtyFields),
    markClean,
    attachEvents,
  };
}

/**
 * Installs an unsaved-changes guard: a beforeunload prompt plus a visible
 * warning banner toggled by the dirty tracker.
 * @param {Object} tracker - Dirty tracker from createDirtyTracker().
 * @param {Object} [options] - Options.
 * @param {Object} [options.banner] - Banner element to show/hide.
 * @param {boolean} [options.confirmBeforeUnload=true] - Use beforeunload.
 * @returns {Function} Teardown function.
 */
export function initUnsavedGuard(tracker, options = {}) {
  const { banner, confirmBeforeUnload = true } = options || {};
  const isBrowser = typeof window !== 'undefined' && typeof window.addEventListener === 'function';

  function syncBanner(isDirty) {
    if (!banner) return;
    banner.hidden = !isDirty;
  }

  function onBeforeUnload(event) {
    if (tracker && tracker.isDirty()) {
      if (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === false) {
        return undefined;
      }
      event.preventDefault();
      event.returnValue = '';
      return '';
    }
    return undefined;
  }

  if (banner) {
    banner.hidden = true;
    if (isBrowser) {
      syncBanner(tracker ? tracker.isDirty() : false);
    }
  }

  const teardownFns = [];
  if (isBrowser) {
    if (tracker && typeof tracker.attachEvents === 'function') {
      const detach = tracker.attachEvents(document);
      teardownFns.push(detach);
    }
    if (tracker && typeof tracker.isDirty === 'function') {
      const refresh = () => syncBanner(tracker.isDirty());
      window.addEventListener('optionsDirtyChange', refresh);
      teardownFns.push(() => window.removeEventListener('optionsDirtyChange', refresh));
    }
    if (confirmBeforeUnload) {
      window.addEventListener('beforeunload', onBeforeUnload);
      teardownFns.push(() => window.removeEventListener('beforeunload', onBeforeUnload));
    }
  }

  return () => {
    for (const fn of teardownFns) {
      if (typeof fn === 'function') fn();
    }
  };
}

/**
 * Dispatches the optionsDirtyChange event so the guard's banner can update
 * when the tracker state changes without coupling modules.
 * @param {boolean} isDirty - Whether unsaved changes exist.
 */
export function announceDirtyChange(isDirty) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('optionsDirtyChange', { detail: { isDirty } }));
  }
}

/**
 * Applies credential masking to an input: never loads the raw value into the
 * field; instead marks it configured with a masked placeholder and disables
 * native required validation while configured, restoring it when unconfigured.
 * @param {Object} input - The password input element.
 * @param {boolean} configured - Whether a key is stored.
 * @param {string} [placeholder] - Masked placeholder text.
 */
export function applyCredentialMask(input, configured, placeholder = MASKED_KEY_PLACEHOLDER) {
  if (!input) return;
  input.value = '';
  input.required = !configured;
  if (configured) {
    input.placeholder = placeholder;
    input.dataset.configured = 'true';
  } else {
    input.placeholder = input.dataset.originalPlaceholder || placeholder;
    delete input.dataset.configured;
  }
}

/**
 * Resolves the effective credential value for saving: a new typed value wins;
 * otherwise the stored value is preserved when the field is masked.
 * @param {string} rawValue - Current input value.
 * @param {boolean} isMaskedConfigured - Field is masked with a stored key.
 * @param {string} storedValue - Previously stored value (may be empty).
 * @returns {string} The value to persist.
 */
export function resolveCredentialValue(rawValue, isMaskedConfigured, storedValue) {
  const value = String(rawValue || '').trim();
  if (value) return value;
  if (isMaskedConfigured) return String(storedValue || '');
  return '';
}

/**
 * Resolve a profile credential when the stored value may be masked or the
 * credential field's configured marker may be stale after profile switching.
 * @param {string} rawValue - Current input value.
 * @param {boolean} isMaskedConfigured - Whether the field is marked configured.
 * @param {string} storedValue - Existing profile credential.
 * @param {string} [pendingValue] - Pending default/release credential.
 * @returns {string} The credential to persist.
 */
export function resolveProfileCredentialValue(
  rawValue,
  isMaskedConfigured,
  storedValue,
  pendingValue = ''
) {
  const effectiveStoredValue = String(pendingValue || storedValue || '');
  return resolveCredentialValue(
    rawValue,
    isMaskedConfigured || Boolean(effectiveStoredValue),
    effectiveStoredValue
  );
}

/**
 * Flashes transient success/error feedback on a save button.
 * @param {Object} button - The button element.
 * @param {boolean} isError - Error vs success feedback.
 */
export function flashSaveFeedback(button, isError) {
  if (!button) return;
  button.classList.remove('is-success', 'is-error');
  void button.offsetWidth; // restart animation/transition
  button.classList.add(isError ? 'is-error' : 'is-success');
  if (typeof setTimeout === 'function') {
    setTimeout(() => button.classList.remove('is-success', 'is-error'), 1800);
  }
}

/**
 * Wraps an error-aware section save as a click handler.
 *
 * Centralizes the repeated Options section-save shape (privacy, grounding,
 * notch, page actions): run the storage write, surface success or error via
 * the page's status/toast and button feedback, then re-baseline the dirty
 * tracker and clear the dirty flag. The storage write itself stays in the
 * caller so each section keeps its own keys and schema.
 *
 * @param {Object} section - Save descriptor.
 * @param {Function} section.write - Async write returning a Promise; rejects on error.
 * @param {string} section.successMessage - Toast shown on success.
 * @param {string} section.errorLabel - Prefix for the error toast.
 * @param {Function} section.notify - (message, isError, isToast) page status reporter.
 * @param {Function} [section.onSuccess] - Optional page-specific post-save state update.
 * @param {Function} [section.markClean] - Optional tracker re-baseline.
 * @param {Object} [section.button] - Save button for transient feedback.
 * @returns {Function} Event handler for the section's save button.
 */
export function runErrorAwareSave(section) {
  const { write, successMessage, errorLabel, notify, button } = section;
  const onSuccess = section.onSuccess;
  const markClean = section.markClean;
  return async () => {
    try {
      await write();
      if (typeof onSuccess === 'function') onSuccess();
      notify(successMessage, false, true);
      flashSaveFeedback(button, false);
      announceDirtyChange(false);
      if (typeof markClean === 'function') markClean();
    } catch (err) {
      notify(`${errorLabel}: ${(err && err.message) || 'Storage write failed.'}`, true, true);
      flashSaveFeedback(button, true);
    }
  };
}

/**
 * Renders the chat-led setup status line.
 * @param {Object} statusText - Element to fill with the status message.
 * @param {Object} statusIcon - Optional icon element (material symbol text).
 * @param {Object} status - Status data: { connected, provider, model, endpointHost }.
 */
function applyStatusState(statusText, statusIcon, status, connected) {
  statusText.textContent = status.message;
  if (statusIcon) {
    statusIcon.textContent = status.icon || 'pending';
    statusIcon.classList.toggle('is-connected', connected);
  }
}

/**
 * Renders the chat-led setup status line.
 *
 * Distinguishes a verified connection from configured-but-untested settings:
 * `status.connected` is true only after a successful bounded connection check;
 * otherwise `status.configured` indicates saved settings that still need a
 * check and `status.error` surfaces a failed check with a retry action.
 *
 * @param {Object} statusText - Element to fill with the status message.
 * @param {Object} statusIcon - Optional icon element (material symbol text).
 * @param {Object} status - Status data: { connected, configured, error, provider, model, endpointHost, retryLabel, onRetry }.
 * @param {Object} [actionEl] - Optional button element shown for failed/untested states.
 */
export function renderSetupStatus(statusText, statusIcon, status, actionEl) {
  if (!statusText) return;
  const data = status || {};
  const provider = data.provider;
  let state;
  if (data.connected) {
    if (provider === 'codex') {
      state = {
        icon: 'check_circle',
        message: 'Connected to your ChatGPT subscription. Open the side panel and start chatting.',
      };
    } else if (provider === 'hermes') {
      state = {
        icon: 'check_circle',
        message: 'Connected to the Hermes gateway. Open the side panel and start chatting.',
      };
    } else {
      state = {
        icon: 'check_circle',
        message: `Connected: ${data.model || 'model'} via ${data.endpointHost || 'endpoint'}. Open the side panel and start chatting.`,
      };
    }
  } else if (data.error) {
    state = {
      icon: 'error',
      message: `Connection check failed: ${data.error}.`,
    };
  } else if (data.configured) {
    state = {
      icon: 'check',
      message:
        'Configured - saved settings are ready to verify. Run a connection check to confirm they work.',
    };
  } else if (provider === 'codex') {
    state = {
      icon: 'rocket_launch',
      message: 'Not connected yet. Sign in with ChatGPT below to start.',
    };
  } else if (provider === 'hermes') {
    state = {
      icon: 'rocket_launch',
      message: 'Not configured yet. Add and save a Hermes gateway URL below to start.',
    };
  } else {
    state = {
      icon: 'rocket_launch',
      message: 'Not configured yet. Add your LLM endpoint, API key, and model below to start.',
    };
  }
  applyStatusState(statusText, statusIcon, state, Boolean(data.connected));
  if (actionEl) {
    if (!data.connected && (data.error || data.configured) && typeof data.onRetry === 'function') {
      const label = data.retryLabel || (data.error ? 'Retry' : 'Check connection');
      actionEl.textContent = label;
      actionEl.classList.remove('d-none');
      actionEl.onclick = data.onRetry;
    } else {
      actionEl.classList.add('d-none');
      actionEl.onclick = null;
    }
  }
}

/**
 * Returns the hostname portion of an endpoint URL for display.
 * @param {string} endpoint - Full endpoint URL.
 * @returns {string} Hostname or the raw endpoint.
 */
export function endpointHost(endpoint) {
  if (!endpoint) return '';
  try {
    return new URL(endpoint).hostname;
  } catch (e) {
    return endpoint;
  }
}
