import logger from '../utils/logger.js';

/**
 * Speech Manager
 * Handles voice dictation using the Web Speech API
 * @class
 */
export class SpeechManager {
    /**
     * Create a new SpeechManager instance
     * @param {HTMLTextAreaElement} inputArea - The textarea to insert dictated text into
     * @param {HTMLElement} micButton - The microphone button element
     * @param {HTMLElement} micIcon - The microphone icon element
     * @param {Object} uiManager - UI Manager instance for showing toasts
     */
    constructor(inputArea, micButton, micIcon, uiManager) {
        this.inputArea = inputArea;
        this.micButton = micButton;
        this.micIcon = micIcon;
        this.uiManager = uiManager;
        this.recognition = null;
        this.isRecording = false;

        this.initRecognition();
    }

    /**
     * Initialize speech recognition
     */
    initRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            logger.warn('SpeechManager', 'Speech Recognition is not supported in this browser.');
            if (this.micButton) {
                this.micButton.style.display = 'none';
            }
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onstart = () => {
            this.isRecording = true;
            this.updateUI();
            logger.info('SpeechManager', 'Speech recognition started');
        };

        this.recognition.onend = () => {
            this.isRecording = false;
            this.updateUI();
            logger.info('SpeechManager', 'Speech recognition ended');
        };

        this.recognition.onerror = event => {
            logger.error('SpeechManager', 'Speech recognition error', event.error);
            this.isRecording = false;
            this.updateUI();

            if (event.error === 'not-allowed') {
                this.handlePermissionDenied();
            } else {
                this.uiManager.showToast(`Speech recognition error: ${event.error}`, 'error');
            }
        };

        this.recognition.onresult = event => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            if (finalTranscript) {
                this.insertText(finalTranscript);
            }
        };

        this.micButton.addEventListener('click', () => this.toggle());
    }

    /**
     * Toggle recording state
     */
    toggle() {
        if (!this.recognition) return;

        if (this.isRecording) {
            this.stop();
        } else {
            this.start();
        }
    }

    /**
     * Start recording
     */
    start() {
        if (this.recognition && !this.isRecording) {
            try {
                this.recognition.start();
            } catch (error) {
                logger.error('SpeechManager', 'Failed to start recognition', error);
            }
        }
    }

    /**
     * Stop recording
     */
    stop() {
        if (this.recognition && this.isRecording) {
            this.recognition.stop();
        }
    }

    /**
     * Update the UI state
     */
    updateUI() {
        if (this.micButton) {
            if (this.isRecording) {
                this.micButton.classList.add('recording');
                if (this.micIcon) this.micIcon.textContent = 'mic_off';
            } else {
                this.micButton.classList.remove('recording');
                if (this.micIcon) this.micIcon.textContent = 'mic';
            }
        }
    }

    /**
     * Insert text into the textarea
     * @param {string} text - Text to insert
     */
    insertText(text) {
        if (!this.inputArea) return;

        const start = this.inputArea.selectionStart;
        const end = this.inputArea.selectionEnd;
        const value = this.inputArea.value;

        // Add a space if needed
        const prefixedText =
            start > 0 && value.charAt(start - 1) !== ' ' && value.charAt(start - 1) !== '\n'
                ? ' ' + text
                : text;

        this.inputArea.value = value.substring(0, start) + prefixedText + value.substring(end);

        // Update cursor position
        const newCursorPos = start + prefixedText.length;
        this.inputArea.selectionStart = this.inputArea.selectionEnd = newCursorPos;

        // Trigger auto-expand if UI manager is available
        if (this.uiManager && this.uiManager.autoExpandTextarea) {
            this.uiManager.autoExpandTextarea(this.inputArea);
        }

        // Trigger input event to ensure other listeners respond to the change
        this.inputArea.dispatchEvent(new Event('input', { bubbles: true }));
        this.inputArea.focus();
    }

    /**
     * Handle microphone permission denied
     */
    handlePermissionDenied() {
        const message = 'Microphone access denied. Please grant permission in the extension options or browser settings.';
        this.uiManager.showToast(message, 'error', 8000);

        // Show a more detailed message in the chat area
        if (this.uiManager && this.uiManager.chatArea) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'message system-message';
            errorDiv.innerHTML = `
                <div style="color: var(--destructive); font-weight: bold; margin-bottom: 8px;">
                    <span class="material-icons" style="vertical-align: middle; margin-right: 4px;">mic_off</span>
                    Microphone Access Required
                </div>
                <div>
                    Voice dictation requires microphone access. Due to Chrome's security policy, you may need to grant this on a full extension page.
                </div>
                <button id="fix-mic-permission-btn" class="ext-btn hextaui-btn-primary" style="margin-top: 10px; width: 100%;">
                    Open Permission Settings
                </button>
            `;
            this.uiManager.chatArea.appendChild(errorDiv);
            this.uiManager.scrollToBottom();

            const fixBtn = errorDiv.querySelector('#fix-mic-permission-btn');
            if (fixBtn) {
                fixBtn.addEventListener('click', () => {
                    const optionsUrl = chrome.runtime.getURL('options.html') + '?requestMic=true';
                    chrome.tabs.create({ url: optionsUrl });
                });
            }
        }
    }
}
