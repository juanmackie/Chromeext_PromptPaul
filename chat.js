import { setupThemeToggle } from './themeUtils.js';
import { loadingManager } from './loadingManager.js';
import { ChatCoordinator } from './classes/coordinators/ChatCoordinator.js';

// Initialize the chat coordinator
const chatCoordinator = new ChatCoordinator();

document.addEventListener('DOMContentLoaded', () => {
    // Configure markdown renderer if available
    try {
        const m = (globalThis && globalThis.marked) || (typeof window !== 'undefined' && window.marked);
        if (m && typeof m.setOptions === 'function') {
            m.setOptions({ gfm: true, breaks: true, smartLists: true });
        }
    } catch (e) {
        console.warn('Could not configure marked options:', e);
    }
    console.log("DOMContentLoaded event fired in chat.js");
    
    // Start the chat coordinator
    chatCoordinator.start().catch(error => {
        console.error('Failed to start ChatCoordinator:', error);
    });
    
    const chatArea = document.getElementById('chat-area');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const selectedTextDiv = document.getElementById('selectedText');
    const instructionInput = document.getElementById('instructionInput');
    const submitBtn = document.getElementById('submitBtn');
    const chatMainArea = document.getElementById('chat-main-area');
    const oneoffInstructionArea = document.getElementById('oneoff-instruction-area');
    const inputArea = document.getElementById('input-area');
    
    // Helper to avoid unnecessary style writes
    function setStyle(el, prop, value) {
        try {
            if (el && el.style[prop] !== value) {
                el.style[prop] = value;
            }
        } catch {}
    }

    function adjustChatPadding() {
        try {
            if (!chatArea || !inputArea) return;
            const extra = 16; // additional spacing
            const h = inputArea.offsetHeight || 0;
            setStyle(chatArea, 'paddingBottom', `${h + extra}px`);
        } catch (e) {
            console.warn('adjustChatPadding failed:', e);
        }
    }

    // Subscribe to view model changes to update the UI
    chatCoordinator.viewModel.subscribe((state) => {
        console.log('🎯 View model state updated:', state);
        updateChatUI(state);
    });

    /**
     * Update the chat UI based on view model state
     * @param {Object} state - Current view model state
     */
    function updateChatUI(state) {
        // Helper: remove uniform leading indentation that can break Markdown parsing
        function dedentMarkdown(input) {
            try {
                if (!input) return input;
                const lines = String(input).replace(/^\s*\n/, '').split('\n');
                // Ignore fenced code blocks when computing indent
                let inFence = false;
                const indents = [];
                for (const line of lines) {
                    const fenceMatch = line.match(/^\s*```/);
                    if (fenceMatch) { inFence = !inFence; continue; }
                    if (inFence) continue;
                    if (line.trim() === '') continue;
                    const m = line.match(/^(\s+)/);
                    if (m) indents.push(m[1].length); else indents.push(0);
                }
                const minIndent = indents.length ? Math.min(...indents) : 0;
                if (minIndent > 0) {
                    return lines.map(l => l.startsWith(' '.repeat(minIndent)) ? l.slice(minIndent) : l).join('\n');
                }
                return lines.join('\n');
            } catch { return input; }
        }

        const chatArea = document.getElementById('chat-area');
        if (!chatArea) return;

        // Clear current messages
        chatArea.innerHTML = '';

        // Render conversation history
        state.conversationHistory.forEach(message => {
            renderMessage(message);
        });

        // Render current streaming message if active
        if (state.currentStreamingMessage && state.accumulatedStreamedText) {
            renderStreamingMessage(state.currentStreamingMessage, state.accumulatedStreamedText);
        }

        // Clean up streaming elements when streaming finishes
        if (!state.currentStreamingMessage) {
            // Remove any remaining streaming indicators and show copy buttons
            const streamingMessages = chatArea.querySelectorAll('.message.streaming');
            streamingMessages.forEach(msgDiv => {
                msgDiv.classList.remove('streaming');
                // Show copy buttons by removing streaming-hidden class
                const copyButtons = msgDiv.querySelector('.message-copy-buttons.streaming-hidden');
                if (copyButtons) {
                    copyButtons.classList.remove('streaming-hidden');
                }
                // Remove streaming indicator
                const streamingIndicator = msgDiv.querySelector('.streaming-indicator');
                if (streamingIndicator) {
                    streamingIndicator.remove();
                }
            });
        }

        // Update input state
        const userInput = document.getElementById('user-input');
        const sendButton = document.getElementById('send-button');
        
        if (userInput) {
            userInput.disabled = state.userInputDisabled;
        }
        if (sendButton) {
            sendButton.disabled = state.sendButtonDisabled;
        }

        // Auto-adjust padding then auto-scroll to bottom
        adjustChatPadding();
        // Use requestAnimationFrame to ensure DOM updates before scrolling
        requestAnimationFrame(() => {
            chatArea.scrollTop = chatArea.scrollHeight;
        });
    }

    /**
     * Render a single message in the chat
     * @param {Object} message - Message object
     */
    function renderMessage(message) {
        const chatArea = document.getElementById('chat-area');
        const messageDiv = document.createElement('div');
        // Determine role and whether it's an assistant/model message
        const role = (message.sender || '').toLowerCase();
        const isAssistant = role === 'assistant' || role === 'model' || role === 'llm';
        const isMarkdown = role !== 'user' && role !== 'system' && role !== 'tool';
        // Add llm-message class for assistant/model so styling and copy controls target exactly those
        messageDiv.className = `message ${isAssistant ? 'llm-message ' : ''}${message.sender.toLowerCase()}-message`;
        
        // Parse markdown content for assistant/model messages, escape HTML for user messages
        
        function renderMarkdown(text) {
            try {
                const m = (globalThis && globalThis.marked) || (typeof window !== 'undefined' && window.marked);
                if (m) {
                    if (typeof m.parse === 'function') return m.parse(text);
                    if (typeof m === 'function') return m(text);
                    if (typeof m.marked === 'function') return m.marked(text);
                }
            } catch (err) {
                console.warn('Markdown render failed, falling back to escaped text:', err);
            }
            // Fallback: escape and keep line breaks minimally
            return escapeHtml(text).replace(/\n/g, '<br>');
        }
        
        const messageContent = isMarkdown
            ? renderMarkdown(message.content)
            : escapeHtml(message.content);
        
        // Add copy buttons for assistant messages
        const copyButtonsHtml = isAssistant ? `
            <div class="message-copy-buttons" style="display: flex !important; visibility: visible !important;">
                <button class="copy-button copy-formatted" title="Copy formatted response" data-type="formatted" style="display: flex !important; visibility: visible !important;">
                    <img class="copy-icon copy-formatted-icon" src="icons/copy formatted.png" alt="Copy formatted" width="16" height="16" style="display: block !important; visibility: visible !important; opacity: 1 !important;" onerror="this.src='icons/icon16.png'; this.width='16'; this.height='16'; this.style.display='block'; this.style.visibility='visible';">
                </button>
                <button class="copy-button copy-markdown" title="Copy raw markdown" data-type="markdown" style="display: flex !important; visibility: visible !important;">
                    <img class="copy-icon copy-markdown-icon" src="icons/copy markdown.png" alt="Copy markdown" width="16" height="16" style="display: block !important; visibility: visible !important; opacity: 1 !important;" onerror="this.src='icons/icon16.png'; this.width='16'; this.height='16'; this.style.display='block'; this.style.visibility='visible';">
                </button>
            </div>
        ` : '';
            
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="sender">${message.sender}</span>
                <span class="timestamp">${new Date(message.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="message-content">${messageContent}</div>
            ${copyButtonsHtml}
        `;
        
        // Add event listeners for copy buttons and store content
        if (isAssistant) {
            const copyButtons = messageDiv.querySelectorAll('.copy-button');
            copyButtons.forEach(button => {
                // Store the original message content for copying
                messageDiv.dataset.originalContent = message.content;
                button.addEventListener('click', handleCopyClick);
            });
        }
        
        chatArea.appendChild(messageDiv);
        
        // Ensure scrolling after message is added
        scrollToBottom();
    }

    /**
     * Scroll chat area to bottom
     */
    function scrollToBottom() {
        const chatArea = document.getElementById('chat-area');
        if (chatArea) {
            requestAnimationFrame(() => {
                chatArea.scrollTop = chatArea.scrollHeight;
            });
        }
    }

    /**
     * Render a streaming message in the chat
     * @param {Object} message - Message object
     * @param {String} streamingContent - Current streaming content
     */
    function renderStreamingMessage(message, streamingContent) {
        const chatArea = document.getElementById('chat-area');
        let messageDiv = document.getElementById(`streaming-message-${message.id}`);
        
        if (!messageDiv) {
            messageDiv = document.createElement('div');
            // Determine role and whether it's an assistant/model message to add llm-message class
            const roleInit = (message.sender || '').toLowerCase();
            const isAssistantInit = roleInit === 'assistant' || roleInit === 'model' || roleInit === 'llm';
            messageDiv.className = `message ${isAssistantInit ? 'llm-message ' : ''}${message.sender.toLowerCase()}-message streaming`;
            messageDiv.id = `streaming-message-${message.id}`;
            chatArea.appendChild(messageDiv);
        }
        
        // Parse markdown content for assistant/model messages, escape HTML for user messages
        const role = (message.sender || '').toLowerCase();
        const isMarkdown = role !== 'user' && role !== 'system' && role !== 'tool';
        const isAssistant = role === 'assistant' || role === 'model';

        function renderMarkdown(text) {
            try {
                const m = (globalThis && globalThis.marked) || (typeof window !== 'undefined' && window.marked);
                if (m) {
                    if (typeof m.parse === 'function') return m.parse(text);
                    if (typeof m === 'function') return m(text);
                    if (typeof m.marked === 'function') return m.marked(text);
                }
            } catch (err) {
                console.warn('Markdown render failed, falling back to escaped text:', err);
            }
            // Fallback: escape and keep line breaks minimally
            return escapeHtml(text).replace(/\n/g, '<br>');
        }

        const messageContent = isMarkdown
            ? renderMarkdown(streamingContent)
            : escapeHtml(streamingContent);
        
        // Add copy buttons for assistant messages (but hide during streaming)
        const copyButtonsHtml = isAssistant ? `
            <div class="message-copy-buttons streaming-hidden" style="visibility: visible !important;">
                <button class="copy-button copy-formatted" title="Copy formatted response" data-type="formatted" style="display: flex !important; visibility: visible !important;">
                    <img class="copy-icon copy-formatted-icon" src="icons/copy formatted.png" alt="Copy formatted" width="16" height="16" style="display: block !important; visibility: visible !important; opacity: 1 !important;" onerror="this.src='icons/icon16.png'; this.width='16'; this.height='16'; this.style.display='block'; this.style.visibility='visible';">
                </button>
                <button class="copy-button copy-markdown" title="Copy raw markdown" data-type="markdown" style="display: flex !important; visibility: visible !important;">
                    <img class="copy-icon copy-markdown-icon" src="icons/copy markdown.png" alt="Copy markdown" width="16" height="16" style="display: block !important; visibility: visible !important; opacity: 1 !important;" onerror="this.src='icons/icon16.png'; this.width='16'; this.height='16'; this.style.display='block'; this.style.visibility='visible';">
                </button>
            </div>
        ` : '';
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="sender">${message.sender}</span>
                <span class="timestamp">${new Date(message.timestamp).toLocaleTimeString()}</span>
                <span class="streaming-indicator">●</span>
            </div>
            <div class="message-content">${messageContent}</div>
            ${copyButtonsHtml}
        `;
        
        // Update copy button event listeners and store content during streaming
        if (isAssistant) {
            // Store the current streaming content for copying
            messageDiv.dataset.originalContent = streamingContent;
            const copyButtons = messageDiv.querySelectorAll('.copy-button');
            copyButtons.forEach(button => {
                button.removeEventListener('click', handleCopyClick);
                button.addEventListener('click', handleCopyClick);
            });
        }
        
        // Keep scrolling to bottom during streaming
        scrollToBottom();
    }

    /**
     * Escape HTML to prevent XSS
     * @param {String} text - Text to escape
     * @returns {String} - Escaped text
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Handle copy button clicks
     * @param {Event} event - Click event
     */
    function handleCopyClick(event) {
        event.preventDefault();
        event.stopPropagation();
        
        const button = event.currentTarget;
        const type = button.dataset.type;
        const messageDiv = button.closest('.message');
        
        if (!messageDiv) return;
        
        let textToCopy = '';
        
        if (type === 'formatted') {
            // Get the rendered content (without HTML tags)
            const messageContent = messageDiv.querySelector('.message-content');
            if (messageContent) {
                textToCopy = messageContent.textContent || messageContent.innerText || '';
            }
        } else if (type === 'markdown') {
            // Get the original markdown content
            textToCopy = messageDiv.dataset.originalContent || '';
        }
        
        if (!textToCopy) return;
        
        // Copy to clipboard
        navigator.clipboard.writeText(textToCopy).then(() => {
            // Show visual feedback
            const originalTitle = button.title;
            button.title = `Copied ${type === 'formatted' ? 'formatted text' : 'markdown'}!`;
            button.style.opacity = '0.6';
            
            setTimeout(() => {
                button.title = originalTitle;
                button.style.opacity = '1';
            }, 1000);
            
            showToast(`Copied ${type === 'formatted' ? 'formatted response' : 'raw markdown'}!`);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            showToast('Failed to copy text to clipboard');
        });
    }

    // Quick Actions Sidebar Elements
    const summarizeTabButton = document.getElementById('summarize-tab-button');
    const pinnedActionsContainer = document.getElementById('pinned-actions-container');
    
    // Add event listeners for quick action buttons
    const explainBtn = document.getElementById('explain-button');
    if (explainBtn) {
        explainBtn.addEventListener('click', () => {
            showToast('Requesting tab content for explanation...');
            chrome.runtime.sendMessage({ action: 'getExplainContent' }, (response) => {
                console.log("Chat.js: Explain button - received response from background:", response);
                if (chrome.runtime.lastError) {
                    console.error("Chat.js: Explain button - Error sending getExplainContent message:", chrome.runtime.lastError.message);
                    showToast(`Error: ${chrome.runtime.lastError.message}`);
                    return;
                }

                if (response && response.action === 'explainContentResponse') {
                    if (response.success && response.content) {
                        console.log("Chat.js: Explain button - Content received, length:", response.content.length);
                        const prompt = "Explain the following text:\n\n" + response.content;
                        chatMainArea.style.display = 'block';
                        oneoffInstructionArea.style.display = 'none';
                        console.log("Chat.js: Explain button - About to call makeApiCall. Prompt length:", prompt.length);
                        // Delegate to chat coordinator
                        chatCoordinator.sendMessage(prompt);
                        showToast('Tab content received, explaining...');
                    } else {
                        console.error("Chat.js: Explain button - Failed to get content or content missing. Success:", response.success, "Error:", response.error);
                        showToast('No content received for explanation: ' + (response.error || 'Content not available'));
                    }
                } else {
                    console.warn("Chat.js: Explain button - Received unexpected response action or missing action. Response:", response);
                    showToast('Received an unexpected response for explain action.');
                }
            });
        });
    }

    const darkThemeToggle = document.getElementById('darkThemeToggle');
    if (darkThemeToggle) {
        setupThemeToggle(darkThemeToggle);
    }

    // Handle theme changes for copy button icons
    function updateCopyButtonIcons() {
        const isDark = document.body.classList.contains('dark-theme') ||
                      document.documentElement.getAttribute('data-theme') === 'dark';
        const copyIcons = document.querySelectorAll('.copy-icon');

        copyIcons.forEach(icon => {
            // Force visibility and styling for Windows compatibility
            icon.style.display = 'block';
            icon.style.visibility = 'visible';
            icon.style.opacity = '1';
            icon.style.width = '16px';
            icon.style.height = '16px';
            
            if (icon.classList.contains('copy-formatted-icon')) {
                icon.src = isDark ? 'icons/copy formatted.png' : 'icons/light_copy formatted.png';
            } else if (icon.classList.contains('copy-markdown-icon')) {
                icon.src = isDark ? 'icons/copy markdown.png' : 'icons/light_copy markdown.png';
            }
            
            // Enhanced error handling for Windows
            icon.onerror = function() {
                console.warn('Copy icon failed to load:', this.src);
                this.src = 'icons/icon16.png';
                this.width = '16';
                this.height = '16';
                this.style.display = 'block';
                this.style.visibility = 'visible';
                this.style.opacity = '1';
                // If fallback also fails, create a text-based button
                this.onerror = function() {
                    const button = this.parentElement;
                    if (button && button.classList.contains('copy-button')) {
                        button.innerHTML = this.alt === 'Copy formatted' ? '📋' : '📄';
                        button.style.fontSize = '14px';
                    }
                };
            };
        });
    }

    // Update icons when theme changes
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' &&
                (mutation.attributeName === 'class' || mutation.attributeName === 'data-theme')) {
                updateCopyButtonIcons();
            }
        });
    });

    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Force copy button visibility function for Windows compatibility
    function forceCopyButtonVisibility() {
        const copyButtonContainers = document.querySelectorAll('.message-copy-buttons');
        const copyButtons = document.querySelectorAll('.copy-button');
        const copyIcons = document.querySelectorAll('.copy-icon');
        
        // Force container visibility
        copyButtonContainers.forEach(container => {
            container.style.display = 'flex';
            container.style.visibility = 'visible';
            container.style.opacity = '0.7';
            container.style.position = 'relative';
            container.style.zIndex = '150';
        });
        
        // Force button visibility
        copyButtons.forEach(button => {
            button.style.display = 'flex';
            button.style.visibility = 'visible';
            button.style.opacity = '0.8';
            button.style.minWidth = '24px';
            button.style.minHeight = '24px';
        });
        
        // Force icon visibility
        copyIcons.forEach(icon => {
            icon.style.display = 'block';
            icon.style.visibility = 'visible';
            icon.style.opacity = '1';
            icon.style.width = '16px';
            icon.style.height = '16px';
        });
    }

    // Initial icon update and visibility check
    updateCopyButtonIcons();
    
    // Force visibility on Windows
    setTimeout(forceCopyButtonVisibility, 100);
    setTimeout(forceCopyButtonVisibility, 500);
    
    // Re-check visibility when new messages are added
    const chatObserver = new MutationObserver((mutations) => {
        let hasNewMessages = false;
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE && 
                        (node.classList?.contains('message') || 
                         node.querySelector?.('.message'))) {
                        hasNewMessages = true;
                    }
                });
            }
        });
        
        if (hasNewMessages) {
            setTimeout(() => {
                updateCopyButtonIcons();
                forceCopyButtonVisibility();
            }, 50);
        }
    });
    
    // Use the chatArea variable already declared at the top of the function
    if (chatArea) {
        chatObserver.observe(chatArea, { childList: true, subtree: true });
    }
    
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.pinnedQuickActions || changes.instructions)) {
            renderPinnedActions();
        }
    });

    // Removed local showToast; route all toast notifications through loadingManager.showToast
    const showToast = (...args) => loadingManager.showToast(...args);

    // Handle messages from background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'setSelectedText') {
            // Handle setSelectedText message
            // Implementation would go here
        } else if (request.action === 'setMediaForAnalysis') {
            // Handle setMediaForAnalysis message
            // Implementation would go here
        } else if (request.action === 'setApiResponse') {
            // Handle setApiResponse message
            // Implementation would go here
        } else if (request.action === 'streamApiStart') {
            // Handle streamApiStart message
            // Implementation would go here
        } else if (request.action === 'streamApiResponseChunk') {
            // Handle streamApiResponseChunk message
            // Implementation would go here
        } else if (request.action === 'streamApiEnd') {
            // Handle streamApiEnd message
            // Implementation would go here
        } else if (request.action === 'streamApiToolCallChunk') {
            // Handle streamApiToolCallChunk message
            // Implementation would go here
        } else if (request.action === 'streamApiAnthropicContentBlockStart') {
            // Handle streamApiAnthropicContentBlockStart message
            // Implementation would go here
        } else if (request.action === 'streamApiAnthropicMessageStop') {
            // Handle streamApiAnthropicMessageStop message
            // Implementation would go here
        } else if (request.action === 'handleToolCallResponse') {
            // Handle handleToolCallResponse message
            // Implementation would go here
        } else if (request.action === 'executeLlmApiRequest') {
            // Handle executeLlmApiRequest message from context menu
            console.log("Chat.js: Received executeLlmApiRequest message:", request);
            // Ensure chat area is visible
            const chatMainArea = document.getElementById('chat-main-area');
            const oneoffInstructionArea = document.getElementById('oneoff-instruction-area');
            if (chatMainArea && oneoffInstructionArea) {
                chatMainArea.style.display = 'block';
                oneoffInstructionArea.style.display = 'none';
            }
            // Send the prompt to the chat coordinator
            chatCoordinator.sendMessage(request.promptContent);
            // Send response back
            sendResponse({ success: true, message: 'Request processed' });
            return true; // Indicates async response
        }
    });

    // Event listeners for UI elements
    sendButton.addEventListener('click', sendMessage);

    // Adjust layout on resize and after DOM ready
    function positionInputBar() {
        try {
            if (!inputArea) return;
            const sidebar = document.getElementById('quick-actions-sidebar');
            const left = sidebar ? (sidebar.getBoundingClientRect().width || 0) : 0;
            setStyle(inputArea, 'position', 'fixed');
            setStyle(inputArea, 'bottom', '0px');
            setStyle(inputArea, 'left', `${left}px`);
            setStyle(inputArea, 'right', '0px');
            setStyle(inputArea, 'zIndex', '500');
        } catch (e) {
            console.warn('positionInputBar failed:', e);
        }
    }

    function refreshLayout() {
        positionInputBar();
        adjustChatPadding();
    }

    // Throttle layout changes to next animation frame to avoid ResizeObserver loops
    let _layoutRafId = null;
    function scheduleLayoutRefresh() {
        if (_layoutRafId !== null) return;
        _layoutRafId = requestAnimationFrame(() => {
            _layoutRafId = null;
            refreshLayout();
        });
    }

    window.addEventListener('resize', scheduleLayoutRefresh);
    setTimeout(scheduleLayoutRefresh, 0);
    setTimeout(scheduleLayoutRefresh, 100);
    setTimeout(scheduleLayoutRefresh, 300);
    const ro = new ResizeObserver(() => scheduleLayoutRefresh());
    // Avoid observing inputArea to reduce feedback loops
    // if (inputArea) ro.observe(inputArea);
    // Avoid observing chatArea to prevent feedback loops that trigger ResizeObserver warnings
    // if (chatArea) ro.observe(chatArea);
    const sidebar = document.getElementById('quick-actions-sidebar');
    if (sidebar) ro.observe(sidebar);
    const clearButton = document.getElementById('clear-button');

    // Cleanup on unload
    window.addEventListener('beforeunload', () => {
        try {
            if (ro) ro.disconnect();
        } catch {}
        try {
            if (_layoutRafId !== null) {
                cancelAnimationFrame(_layoutRafId);
                _layoutRafId = null;
            }
        } catch {}
    });
    clearButton.addEventListener('click', () => {
        if (clearButton.textContent === 'Stop') {
            chatCoordinator.stopRequest();
        } else {
            chatCoordinator.clearChat();
        }
    });
    
    userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !userInput.disabled) {
            event.preventDefault();
            sendMessage();
        }
    });

    // Function to send a message
    function sendMessage() {
        const message = userInput.value;
        if (message.trim() && !userInput.disabled) {
            // Delegate to chat coordinator
            chatCoordinator.sendMessage(message);
            userInput.value = '';
        }
    }
    
    // Submit button event listener for one-off instructions
    submitBtn.addEventListener('click', async () => {
        const instruction = instructionInput.value || '';
        if (!instruction.trim()) {
            showToast('Please enter an instruction');
            return;
        }
        
        // Include selected context if available, joined with a colon
        const context = (window.__oneOffSelectedContent || '').toString().trim();
        const trimmedInstruction = instruction.trim();
        const message = (trimmedInstruction && context)
            ? `${trimmedInstruction}: ${context}`
            : (trimmedInstruction || context);
        
        // Delegate to chat coordinator
        chatCoordinator.sendMessage(message);
    });

    // Summarize tab button event listener
    if (summarizeTabButton) {
        summarizeTabButton.addEventListener('click', () => {
            showToast('Requesting tab content for summary...');
            chrome.runtime.sendMessage({ action: 'getTabContent' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error sending getTabContent message:", chrome.runtime.lastError.message);
                    showToast(`Error: ${chrome.runtime.lastError.message}`);
                    return;
                }
                if (response && response.action === 'tabContentResponse') {
                    if (response.content) {
                        const prompt = "Summarize the following text:\n\n" + response.content;
                        // Ensure chat area is visible
                        chatMainArea.style.display = 'block';
                        oneoffInstructionArea.style.display = 'none';
                        // Delegate to chat coordinator
                        chatCoordinator.sendMessage(prompt);
                        showToast('Tab content received, summarizing...');
                    } else {
                        showToast('No content received from tab.');
                    }
                } else if (response && response.action === 'error') {
                    showToast(`Error getting tab content: ${response.message}`);
                } else {
                    showToast('Failed to get tab content. Unknown response.');
                }
            });
        });
    }

    // Function to render pinned actions
    async function renderPinnedActions() {
        if (!pinnedActionsContainer) return;
        pinnedActionsContainer.innerHTML = ''; // Clear existing pinned actions

        try {
            const { pinnedQuickActions, instructions } = await new Promise((resolve, reject) => {
                chrome.storage.local.get(['pinnedQuickActions', 'instructions'], (result) => {
                    if (chrome.runtime.lastError) {
                        return reject(chrome.runtime.lastError);
                    }
                    resolve(result);
                });
            });

            const currentPins = pinnedQuickActions || [];
            const allInstructions = instructions || [];

            if (currentPins.length === 0) {
                return;
            }

            currentPins.forEach(pinId => {
                const instruction = allInstructions.find(inst => inst.id === pinId);
                if (instruction) {
                    const button = document.createElement('button');
                    const iconLetter = instruction.name ? instruction.name[0].toUpperCase() : '?';
                    button.textContent = iconLetter;
                    button.title = instruction.name; // Set full instruction name as tooltip
                    button.classList.add('quick-action-button', 'pinned-action-item');
                    button.dataset.instructionId = instruction.id; // Store ID

                    button.addEventListener('click', () => {
                        // Ensure chat area is visible
                        chatMainArea.style.display = 'block';
                        oneoffInstructionArea.style.display = 'none';

                        // Retrieve the instruction object
                        const instructionToExecute = allInstructions.find(inst => inst.id === button.dataset.instructionId);
                        if (!instructionToExecute) {
                            showToast("Error: Could not find instruction details.");
                            return;
                        }

                        // Send a message to background.js to get tab content
                        chrome.runtime.sendMessage(
                            {
                                action: 'getPinnedActionTabContent',
                                instruction: { // Pass necessary instruction details
                                    id: instructionToExecute.id, // Keep track of the instruction
                                    name: instructionToExecute.name,
                                    content: instructionToExecute.content,
                                    tool_choice: instructionToExecute.tool_choice // Assuming tool_choice might be needed later
                                }
                            },
                            (response) => {
                                if (chrome.runtime.lastError) {
                                    console.error("Error sending getPinnedActionTabContent message:", chrome.runtime.lastError.message);
                                    showToast(`Error: ${chrome.runtime.lastError.message}`);
                                    // Fallback or error handling: maybe execute with just selected text or show error
                                    // For now, we'll just show an error and not proceed.
                                    return;
                                }

                                // response.instruction should contain the instruction object passed back from background.js
                                const originalInstruction = response.instruction;
                                if (!originalInstruction) {
                                    showToast("Error: Instruction details not returned from background script.");
                                    return;
                                }

                                let tabContent = "";
                                if (response && response.success && response.content) {
                                    tabContent = response.content;
                                    showToast(`Executing: ${originalInstruction.name} with tab content...`);
                                } else if (response && !response.success) {
                                    showToast(`Note: Could not get tab content for ${originalInstruction.name}. Error: ${response.content || 'Unknown error'}`);
                                } else {
                                    showToast(`Note: No tab content received for ${originalInstruction.name}. Executing without it.`);
                                }

                                let prompt = (originalInstruction.content || '').trim();

                                if (prompt && tabContent && tabContent.trim() !== "") {
                                    prompt = `${prompt}: ${tabContent}`;
                                } else if (!prompt && tabContent && tabContent.trim() !== "") {
                                    prompt = tabContent;
                                }

                                // Pass the tool_choice from the original instruction
                                // Delegate to chat coordinator
                                chatCoordinator.sendMessage(prompt, null, originalInstruction.tool_choice);
                            }
                        );
                    });
                    pinnedActionsContainer.appendChild(button);
                }
            });
        } catch (error) {
            console.error("Error rendering pinned actions:", error);
            showToast("Error loading pinned actions.");
        }
    }

    // Initial rendering of pinned actions
    renderPinnedActions();

    // Listen for custom events from the action handler
    document.addEventListener('showOneOffInstruction', (event) => {
        console.log('📝 Showing one-off instruction interface:', event.detail);
        
        // Show the one-off instruction area
        if (chatMainArea && oneoffInstructionArea) {
            chatMainArea.style.display = 'none';
            oneoffInstructionArea.style.display = 'block';
        }
        
        // Store full selected content for later submission
        window.__oneOffSelectedContent = event.detail.content || '';

        // Pre-fill the selected text area if available
        if (selectedTextDiv && event.detail.content) {
            selectedTextDiv.textContent = event.detail.content.substring(0, 200) + 
                (event.detail.content.length > 200 ? '...' : '');
        }
        
        // Focus on the instruction input
        if (instructionInput) {
            instructionInput.focus();
        }
        
        showToast('Ready for your instruction!');
    });

    document.addEventListener('startChatWithContent', (event) => {
        console.log('💬 Starting chat with content:', event.detail);
        
        // Show the chat area
        if (chatMainArea && oneoffInstructionArea) {
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
        }
        
        // Pre-fill the user input with context about the content
        if (userInput && event.detail.content) {
            const contextMessage = `Context from ${event.detail.title || 'current page'}:\n\n${event.detail.content}`;
            userInput.value = contextMessage;
        }
        
        // Focus on the input
        if (userInput) {
            userInput.focus();
        }
        
        showToast('Chat started with page content!');
    });
});