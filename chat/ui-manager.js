/**
 * UI Manager
 * Handles DOM manipulation, UI state management, and user interactions
 * Manages loading states, media previews, and UI transitions
 */
export class UIManager {
    constructor(chatArea, showToast, loadingManager) {
        this.chatArea = chatArea;
        this.showToast = showToast;
        this.loadingManager = loadingManager;
        this.currentLoadingMessage = null;
        this.selectedText = null;
        this.tabId = null;
        this.currentMediaData = null;
    }

    /**
     * Add a loading message to the chat area
     * @returns {HTMLElement} Loading message element
     */
    addLoadingMessage() {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message message-loading llm-loading';
        loadingDiv.innerHTML = `
            <div class="message-loading-content">
                <div class="loading-spinner"></div>
                <div class="message-loading-text">AI is thinking</div>
                <div class="message-loading-dots">
                    <div class="message-loading-dot"></div>
                    <div class="message-loading-dot"></div>
                    <div class="message-loading-dot"></div>
                </div>
            </div>
        `;

        this.chatArea.appendChild(loadingDiv);
        this.ensureScrollable();
        this.scrollToBottom();
        this.currentLoadingMessage = loadingDiv;

        return loadingDiv;
    }

    /**
     * Remove a loading message from the chat area
     * @param {HTMLElement} loadingElement - Loading element to remove
     */
    removeLoadingMessage(loadingElement) {
        if (loadingElement && loadingElement.parentNode) {
            loadingElement.parentNode.removeChild(loadingElement);
        }

        if (this.currentLoadingMessage === loadingElement) {
            this.currentLoadingMessage = null;
        }
    }

    /**
     * Remove current loading message if exists
     */
    removeCurrentLoadingMessage() {
        if (this.currentLoadingMessage) {
            this.removeLoadingMessage(this.currentLoadingMessage);
        }
    }

    /**
     * Add a media preview to the chat area
     * @param {Object} mediaData - Media data object
     */
    addMediaPreview(mediaData) {
        const previewDiv = document.createElement('div');
        previewDiv.classList.add('message', 'system-message');
        previewDiv.style.cssText = 'background: #e3f2fd; border-left: 4px solid #2196f3; margin-bottom: 10px; overflow: visible;';

        if (mediaData.type === 'image') {
            previewDiv.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <img src="data:${mediaData.mimeType};base64,${mediaData.base64}"
                         style="max-width: 200px; max-height: 150px; border-radius: 4px;"
                         alt="Image for analysis">
                    <div>
                        <strong>📷 Image Analysis</strong><br>
                        <small>Right-clicked image ready for analysis</small>
                    </div>
                </div>
            `;
        } else if (mediaData.type === 'video') {
            previewDiv.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <video src="data:${mediaData.mimeType};base64,${mediaData.base64}"
                           style="max-width: 200px; max-height: 150px; border-radius: 4px;"
                           controls>
                    </video>
                    <div>
                        <strong>🎥 Video Analysis</strong><br>
                        <small>Right-clicked video ready for analysis</small>
                    </div>
                </div>
            `;
        } else if (mediaData.type === 'audio') {
            previewDiv.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <audio src="data:${mediaData.mimeType};base64,${mediaData.base64}"
                           style="width: 200px;"
                           controls>
                    </audio>
                    <div>
                        <strong>🎵 Audio Analysis</strong><br>
                        <small>Right-clicked audio ready for analysis</small>
                    </div>
                </div>
            `;
        }

        this.chatArea.appendChild(previewDiv);
        this.ensureScrollable();
        this.scrollToBottom();
    }

    /**
     * Show loading state for media
     * @param {Object} mediaData - Media data object
     */
    showMediaLoading(mediaData) {
        if (mediaData && mediaData.loading) {
            this.addLoadingMessage();
        }
    }

    /**
     * Show error state for media
     * @param {Object} mediaData - Media data object with error
     */
    showMediaError(mediaData) {
        if (mediaData && mediaData.error) {
            const errorDiv = document.createElement('div');
            errorDiv.classList.add('message', 'system-message');
            errorDiv.style.cssText = 'background: #ffebee; border-left: 4px solid #f44336; margin-bottom: 10px;';
            errorDiv.innerHTML = `
                <div>
                    <strong>❌ Media Error</strong><br>
                    <small>${mediaData.error}</small>
                </div>
            `;

            this.chatArea.appendChild(errorDiv);
            this.scrollToBottom();
        }
    }

    /**
     * Auto-expand textarea based on content
     * @param {HTMLTextAreaElement} textarea - Textarea element
     */
    autoExpandTextarea(textarea) {
        if (!textarea) return;

        // Reset height to auto to get the correct scrollHeight
        textarea.style.height = 'auto';

        // Set the height to match the content (with max height limit)
        const maxHeight = 200; // Maximum height in pixels
        const newHeight = Math.min(textarea.scrollHeight, maxHeight);
        textarea.style.height = newHeight + 'px';

        // Scroll chat area to bottom if textarea is expanded
        if (newHeight > 50) {
            setTimeout(() => this.scrollToBottom(), 100);
        }
    }

    /**
     * Clear the chat area and reset state
     */
    clearChat() {
        this.chatArea.innerHTML = '';
        this.currentMediaData = null;
        this.currentLoadingMessage = null;
        this.showToast('Chat history cleared');
    }

    /**
     * Set selected text and tab ID
     * @param {string} selectedText - Selected text content
     * @param {string} tabId - Tab ID
     */
    setSelectedText(selectedText, tabId) {
        this.selectedText = selectedText;
        this.tabId = tabId;
    }

    /**
     * Get selected text
     * @returns {string} Selected text
     */
    getSelectedText() {
        return this.selectedText;
    }

    /**
     * Get tab ID
     * @returns {string} Tab ID
     */
    getTabId() {
        return this.tabId;
    }

    /**
     * Set current media data
     * @param {Object} mediaData - Media data object
     */
    setCurrentMediaData(mediaData) {
        this.currentMediaData = mediaData;
    }

    /**
     * Get current media data
     * @returns {Object} Current media data
     */
    getCurrentMediaData() {
        return this.currentMediaData;
    }

    /**
     * Show toast notification
     * @param {string} message - Toast message
     * @param {string} type - Toast type (success, error, warning, info)
     * @param {number} duration - Duration in milliseconds
     * @param {Object} options - Additional options
     */
    showToast(message, type = 'success', duration = 3000, options = {}) {
        if (this.loadingManager && this.loadingManager.showToast) {
            this.loadingManager.showToast(message, type, duration, options);
        } else {
            console.log(`Toast (${type}): ${message}`);
        }
    }

    /**
     * Scroll chat area to bottom
     * @param {number} delay - Delay before scrolling in milliseconds
     */
    scrollToBottom(delay = 0) {
        setTimeout(() => {
            if (this.chatArea) {
                // Ensure smooth scrolling to bottom
                this.chatArea.scrollTo({
                    top: this.chatArea.scrollHeight,
                    behavior: 'smooth'
                });
            }
        }, delay);
    }

    /**
     * Check if chat area is scrolled to bottom
     * @returns {boolean} True if scrolled to bottom
     */
    isScrolledToBottom() {
        if (!this.chatArea) return false;

        const threshold = 50; // pixels from bottom
        return this.chatArea.scrollHeight - this.chatArea.scrollTop <= this.chatArea.clientHeight + threshold;
    }

    /**
     * Ensure chat area is scrollable and properly configured
     */
    ensureScrollable() {
        if (!this.chatArea) {
            console.warn('[UIManager.ensureScrollable] chatArea is not defined');
            return;
        }

        // Force reflow to ensure proper dimensions
        this.chatArea.style.display = 'none';
        this.chatArea.offsetHeight; // Trigger reflow
        this.chatArea.style.display = '';

        // Ensure scroll properties are set correctly
        this.chatArea.style.overflowY = 'auto';
        this.chatArea.style.overflowX = 'hidden';

        try {
            const computed = window.getComputedStyle(this.chatArea);
            console.log('[UIManager.ensureScrollable] metrics', {
                clientHeight: this.chatArea.clientHeight,
                scrollHeight: this.chatArea.scrollHeight,
                overflowYInline: this.chatArea.style.overflowY,
                overflowYComputed: computed.overflowY
            });
        } catch (e) {
            console.warn('[UIManager.ensureScrollable] failed to read computed style', e);
        }
        
        // Scroll to bottom if needed
        if (this.isScrolledToBottom()) {
            this.scrollToBottom(100);
        }
    }

    /**
     * Toggle UI areas visibility
     * @param {Object} areas - Area visibility settings
     */
    toggleAreas(areas) {
        const { chatMainArea, oneoffInstructionArea } = areas;

        if (chatMainArea && chatMainArea.element) {
            chatMainArea.element.style.display = chatMainArea.visible ? 'block' : 'none';
        }

        if (oneoffInstructionArea && oneoffInstructionArea.element) {
            oneoffInstructionArea.element.style.display = oneoffInstructionArea.visible ? 'block' : 'none';
        }
    }

    /**
     * Update selected text display
     * @param {HTMLElement} selectedTextDiv - Element to display selected text
     */
    updateSelectedTextDisplay(selectedTextDiv) {
        if (selectedTextDiv && this.selectedText) {
            selectedTextDiv.textContent = this.selectedText;
        }
    }

    /**
     * Focus input element
     * @param {HTMLElement} inputElement - Input element to focus
     */
    focusInput(inputElement) {
        if (inputElement) {
            setTimeout(() => {
                inputElement.focus();
            }, 100);
        }
    }

    /**
     * Get current loading state
     * @returns {boolean} True if currently loading
     */
    isLoading() {
        return this.currentLoadingMessage !== null;
    }

    /**
     * Update theme-dependent UI elements
     * @param {boolean} isDarkTheme - Whether dark theme is active
     */
    updateTheme(isDarkTheme) {
        // Update any theme-dependent UI elements here
        // This method can be expanded as needed
        document.body.classList.toggle('dark-theme', isDarkTheme);
    }

    /**
     * Disable UI interactions during loading
     * @param {HTMLElement} inputElement - Input element to disable
     * @param {HTMLElement} sendButton - Send button to disable
     */
    disableInteractions(inputElement, sendButton) {
        if (inputElement) {
            inputElement.disabled = true;
            inputElement.style.opacity = '0.6';
        }

        if (sendButton) {
            sendButton.disabled = true;
            sendButton.style.opacity = '0.6';
        }
    }

    /**
     * Enable UI interactions after loading
     * @param {HTMLElement} inputElement - Input element to enable
     * @param {HTMLElement} sendButton - Send button to enable
     */
    enableInteractions(inputElement, sendButton) {
        if (inputElement) {
            inputElement.disabled = false;
            inputElement.style.opacity = '1';
        }

        if (sendButton) {
            sendButton.disabled = false;
            sendButton.style.opacity = '1';
        }
    }

    /**
     * Add keyboard shortcut handler
     * @param {HTMLElement} element - Element to add handler to
     * @param {Function} callback - Callback function
     */
    addKeyboardHandler(element, callback) {
        if (element) {
            element.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    callback(event);
                }
            });
        }
    }

    /**
     * Get UI state information
     * @returns {Object} Current UI state
     */
    getUIState() {
        return {
            isLoading: this.isLoading(),
            hasSelectedText: !!this.selectedText,
            hasMediaData: !!this.currentMediaData,
            isScrolledToBottom: this.isScrolledToBottom(),
            mediaType: this.currentMediaData?.type || null
        };
    }

    /**
     * Reset UI to initial state
     */
    reset() {
        this.clearChat();
        this.selectedText = null;
        this.tabId = null;
        this.currentMediaData = null;
        this.removeCurrentLoadingMessage();
    }
}