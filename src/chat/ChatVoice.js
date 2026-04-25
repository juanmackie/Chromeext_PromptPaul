/**
 * @fileoverview Chat Voice Module - Handles voice input functionality
 *
 * Responsibilities:
 * - Speech recognition setup and management
 * - Voice input settings persistence
 * - Microphone permission handling
 * - Voice toggle UI state
 *
 * @module ChatVoice
 * @requires ../../loadingManager.js
 */

import { loadingManager } from '../../loadingManager.js';

// Constants for storage keys
const VOICE_INPUT_ENABLED_KEY = 'voiceInputEnabled';
const VOICE_INPUT_PERMISSION_STATE_KEY = 'voiceInputPermissionState';
const VOICE_INPUT_PERMISSION_LAST_CHECKED_KEY = 'voiceInputPermissionLastChecked';

// Speech recognition support detection
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const isSpeechRecognitionSupported = !!SpeechRecognition;

// Module state
let speechRecognition = null;
let isListening = false;
let firstPermissionDenial = true;
let voiceInputSettings = {
  voiceInputEnabled: true,
  voiceInputPermissionState: 'unknown',
};

/**
 * Get voice input settings from storage
 * @returns {Promise<Object>} - Voice input settings
 */
export function getVoiceInputSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        VOICE_INPUT_ENABLED_KEY,
        VOICE_INPUT_PERMISSION_STATE_KEY,
        VOICE_INPUT_PERMISSION_LAST_CHECKED_KEY,
      ],
      (result) => {
        const voiceInputEnabled = Object.prototype.hasOwnProperty.call(
          result || {},
          VOICE_INPUT_ENABLED_KEY
        )
          ? !!result[VOICE_INPUT_ENABLED_KEY]
          : true;

        resolve({
          voiceInputEnabled,
          voiceInputPermissionState: result?.[VOICE_INPUT_PERMISSION_STATE_KEY] || 'unknown',
          voiceInputPermissionLastChecked:
            result?.[VOICE_INPUT_PERMISSION_LAST_CHECKED_KEY] || null,
        });
      }
    );
  });
}

/**
 * Set voice input settings in storage
 * @param {Object} updates - Settings to update
 * @returns {Promise<void>}
 */
export function setVoiceInputSettings(updates) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(updates, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

/**
 * Check if microphone permission was denied
 * @param {Error} error - Error object
 * @returns {boolean} - True if permission was denied
 */
export function isMicrophonePermissionDenied(error) {
  if (!error) return false;

  const name = typeof error.name === 'string' ? error.name.toLowerCase() : '';
  const code = typeof error.error === 'string' ? error.error.toLowerCase() : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';

  return (
    name === 'notallowederror' ||
    name === 'permissiondeniederror' ||
    code === 'not-allowed' ||
    message.includes('permission denied') ||
    message.includes('permission dismissed') ||
    message.includes('not allowed')
  );
}

/**
 * Get the reason why voice toggle should be disabled
 * @param {Object} settings - Voice input settings
 * @returns {string|null} - Reason string or null if not disabled
 */
export function getVoiceToggleDisabledReason(settings = voiceInputSettings) {
  if (
    !isSpeechRecognitionSupported ||
    !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  ) {
    return 'unsupported';
  }

  if (!settings.voiceInputEnabled) {
    return 'disabled';
  }

  if (settings.voiceInputPermissionState === 'denied') {
    return 'denied';
  }

  return null;
}

/**
 * Update voice toggle button UI state
 * @param {HTMLElement} voiceToggleButton - The voice toggle button element
 */
export function updateVoiceToggleButtonState(voiceToggleButton) {
  if (!voiceToggleButton) {
    return;
  }

  const disabledReason = getVoiceToggleDisabledReason();
  const shouldDisable = !!disabledReason;

  if (shouldDisable && isListening) {
    stopVoiceInput();
  }

  voiceToggleButton.disabled = shouldDisable;

  if (disabledReason === 'unsupported') {
    voiceToggleButton.title = 'Voice input not supported';
  } else if (disabledReason === 'disabled') {
    voiceToggleButton.title = 'Voice input disabled in Settings';
  } else if (disabledReason === 'denied') {
    voiceToggleButton.title = 'Microphone permission denied - re-enable in Settings and test again';
  } else {
    voiceToggleButton.title = 'Voice Input';
  }
}

/**
 * Sync voice input settings from storage
 * @returns {Promise<Object>} - Updated voice input settings
 */
export async function syncVoiceInputSettings() {
  voiceInputSettings = await getVoiceInputSettings();
  return voiceInputSettings;
}

/**
 * Persist denied microphone permission state
 * @returns {Promise<void>}
 */
export async function persistDeniedVoiceInputState() {
  await setVoiceInputSettings({
    [VOICE_INPUT_ENABLED_KEY]: false,
    [VOICE_INPUT_PERMISSION_STATE_KEY]: 'denied',
    [VOICE_INPUT_PERMISSION_LAST_CHECKED_KEY]: Date.now(),
  });
  await syncVoiceInputSettings();
}

/**
 * Persist granted microphone permission state
 * @returns {Promise<void>}
 */
export async function persistGrantedVoiceInputState() {
  await setVoiceInputSettings({
    [VOICE_INPUT_ENABLED_KEY]: true,
    [VOICE_INPUT_PERMISSION_STATE_KEY]: 'granted',
    [VOICE_INPUT_PERMISSION_LAST_CHECKED_KEY]: Date.now(),
  });
  await syncVoiceInputSettings();
}

/**
 * Toggle voice input on/off
 * @param {HTMLElement} voiceToggleButton - The voice toggle button element
 * @param {HTMLElement} userInput - The user input element
 * @returns {Promise<void>}
 */
export async function toggleVoiceInput(voiceToggleButton, userInput) {
  if (!isSpeechRecognitionSupported) {
    loadingManager.showToast('Voice input not supported in this browser', 'error');
    return;
  }

  const disabledReason = getVoiceToggleDisabledReason();
  if (disabledReason === 'disabled') {
    loadingManager.showToast('Voice input is disabled in Settings', 'info');
    return;
  }

  if (disabledReason === 'denied') {
    loadingManager.showToast(
      'Microphone permission denied. Re-enable voice input in Settings and test access again.',
      'error'
    );
    return;
  }

  if (isListening) {
    stopVoiceInput(voiceToggleButton, userInput);
  } else {
    await startVoiceInput(voiceToggleButton, userInput);
  }
}

/**
 * Start voice input recognition
 * @param {HTMLElement} voiceToggleButton - The voice toggle button element
 * @param {HTMLElement} userInput - The user input element
 * @returns {Promise<void>}
 */
export async function startVoiceInput(voiceToggleButton, userInput) {
  try {
    const settings = await syncVoiceInputSettings();
    const disabledReason = getVoiceToggleDisabledReason(settings);

    if (disabledReason === 'disabled') {
      loadingManager.showToast('Voice input is disabled in Settings', 'info');
      return;
    }

    if (disabledReason === 'denied') {
      loadingManager.showToast(
        'Microphone permission denied. Re-enable voice input in Settings and test access again.',
        'error'
      );
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    await persistGrantedVoiceInputState();

    speechRecognition = new SpeechRecognition();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = 'en-US';

    speechRecognition.onstart = function () {
      isListening = true;
      if (voiceToggleButton) {
        voiceToggleButton.classList.add('active', 'listening');
      }
      userInput.placeholder = 'Listening... Speak now';
      loadingManager.showToast('Listening... Click mic again to stop', 'info');
    };

    speechRecognition.onresult = function (event) {
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        }
      }

      if (finalTranscript) {
        userInput.value += finalTranscript + ' ';
        userInput.focus();
        userInput.selectionStart = userInput.selectionEnd = userInput.value.length;
      }
    };

    speechRecognition.onerror = async function (event) {
      console.error('Speech recognition error:', event.error);

      if (event.error === 'not-allowed') {
        try {
          await persistDeniedVoiceInputState();
        } catch (storageError) {
          console.error('Failed to persist denied microphone state:', storageError);
        }

        if (firstPermissionDenial) {
          loadingManager.showToast(
            'Microphone access denied. Re-enable voice input in Settings after updating the browser microphone permission.',
            'error',
            8000
          );
          firstPermissionDenial = false;
        } else {
          loadingManager.showToast('Microphone access denied', 'error');
        }
        stopVoiceInput(voiceToggleButton, userInput);
      } else if (event.error === 'no-speech') {
        // Ignore no-speech error to allow auto-restart in onend
        console.warn('Speech recognition: No speech detected (will restart)');
      } else {
        loadingManager.showToast('Voice error: ' + event.error, 'error');
        stopVoiceInput(voiceToggleButton, userInput);
      }
    };

    speechRecognition.onend = function () {
      if (isListening) {
        speechRecognition.start();
      }
    };

    speechRecognition.start();
  } catch (error) {
    console.error('Failed to start voice input:', error);

    if (isMicrophonePermissionDenied(error)) {
      try {
        await persistDeniedVoiceInputState();
      } catch (storageError) {
        console.error('Failed to persist denied microphone state:', storageError);
      }

      if (firstPermissionDenial) {
        loadingManager.showToast(
          'Microphone access denied. Re-enable voice input in Settings after updating the browser microphone permission.',
          'error',
          8000
        );
        firstPermissionDenial = false;
      } else {
        loadingManager.showToast('Microphone access denied', 'error');
      }
    } else {
      loadingManager.showToast('Failed to start voice input', 'error');
    }

    stopVoiceInput(voiceToggleButton, userInput);
  }
}

/**
 * Stop voice input recognition
 * @param {HTMLElement} voiceToggleButton - The voice toggle button element
 * @param {HTMLElement} userInput - The user input element
 */
export function stopVoiceInput(voiceToggleButton, userInput) {
  if (speechRecognition) {
    speechRecognition.stop();
    speechRecognition = null;
  }

  isListening = false;
  if (voiceToggleButton) {
    voiceToggleButton.classList.remove('active', 'listening');
  }
  if (userInput) {
    userInput.placeholder = 'Type your message here (or right-click on images/media to analyze)';
  }
}

/**
 * Get current listening state
 * @returns {boolean} - True if currently listening
 */
export function getIsListening() {
  return isListening;
}

/**
 * Get speech recognition support state
 * @returns {boolean} - True if speech recognition is supported
 */
export function getIsSpeechRecognitionSupported() {
  return isSpeechRecognitionSupported;
}
