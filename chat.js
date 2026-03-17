/**
 * @fileoverview Chat Interface for Prompt Paul Chrome Extension
 *
 * This module handles the side panel chat interface including:
 * - Message sending and receiving
 * - Streaming API response handling
 * - Quick actions (load content, summarize, explain)
 * - Pinned custom instructions
 * - Copy functionality for messages
 * - Voice input support
 *
 * @module chat
 * @requires ./themeUtils.js
 * @requires ./loadingManager.js
 */

import { setupThemeToggle } from './themeUtils.js';
import { loadingManager } from './loadingManager.js';

document.addEventListener('DOMContentLoaded', () => {
    const chatArea = document.getElementById('chat-area');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const selectedTextDiv = document.getElementById('selectedText');
    const instructionInput = document.getElementById('instructionInput');
    const submitBtn = document.getElementById('submitBtn');
    const chatMainArea = document.getElementById('chat-main-area');
    const oneoffInstructionArea = document.getElementById('oneoff-instruction-area');

    // Quick Actions Sidebar Elements
    const addPageButton = document.getElementById('add-page-button');
    const analyzeButton = document.getElementById('analyze-button');
    const analyzeDropdown = document.getElementById('analyze-dropdown');
    const explainButton = document.getElementById('explain-button');
    const pinnedActionsContainer = document.getElementById('pinned-actions-container');

    // Preset registry for analysis modes
    const PRESET_MODES = {
        summary: {
            key: 'summary',
            label: 'Summary',
            icon: 'auto_awesome',
            prompt: 'Please summarize the following content into a bullet list of key points.'
        },
        tldr: {
            key: 'tldr',
            label: 'TL;DR',
            icon: 'short_text',
            prompt: 'Provide a very brief TL;DR (3-4 sentences) of this content.'
        },
        technical: {
            key: 'technical',
            label: 'Technical',
            icon: 'code',
            prompt: 'Provide a technical deep dive of this content.'
        },
        executive: {
            key: 'executive',
            label: 'Executive',
            icon: 'assignment',
            prompt: 'Provide an executive summary of this content.'
        }
    };

    let lastUsedPreset = 'summary'; // Default preset mode

    /**
     * Helper to execute a preset analysis.
     */
    async function executePreset(presetKey, loadingText, successText) {
        try {
            loadingManager.showToast(loadingText, 'info');
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ action: 'getTabContent' }, (res) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(res);
                    }
                });
            });

            if (response && response.action === 'tabContentResponse') {
                if (response.content) {
                    const metadata = {
                        title: response.title,
                        siteName: response.siteName,
                        byline: response.byline,
                        url: response.url,
                        type: response.type
                    };
                    const prompt = buildSmartPrompt(presetKey, response.content, metadata);

                    chatMainArea.style.display = 'block';
                    oneoffInstructionArea.style.display = 'none';
                    makeApiCall(prompt);
                    loadingManager.showToast(successText, 'success');

                    if (metadata.siteName === 'YouTube' || response.type?.includes('youtube')) {
                        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                            if (tabs[0]) {
                                chrome.tabs.sendMessage(tabs[0].id, { action: 'captureVideoFrames' }, (frameRes) => {
                                    if (frameRes && frameRes.success && frameRes.frame) {
                                        addMessage('System', "📸 Visual context captured from video:");
                                        addMediaPreview({
                                            type: 'image',
                                            mimeType: 'image/jpeg',
                                            base64: frameRes.frame.split(',')[1]
                                        });
                                    }
                                });
                            }
                        });
                    }
                } else {
                    loadingManager.showToast('No content received from tab.', 'error');
                }
            } else {
                loadingManager.showToast('Unexpected response from background script', 'error');
            }
        } catch (error) {
            console.error("Chat.js: Execute preset error:", error.message);
            loadingManager.showToast(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Helper to execute a specific preset mode.
     */
    async function executePresetMode(modeKey) {
        const preset = PRESET_MODES[modeKey];
        if (!preset) {
            console.warn('Unknown preset mode:', modeKey);
            return;
        }
        lastUsedPreset = modeKey;
        executePreset(modeKey, `Generating ${preset.label}...`, `${preset.label} started`);
    }

    /**
     * Builds a smart prompt with dynamic context injection based on content type.
     */
    function buildSmartPrompt(presetKey, content, metadata) {
        const preset = PRESET_MODES[presetKey] || PRESET_MODES.summary;
        let prompt = preset.prompt;

        if (metadata.siteName === 'YouTube' || metadata.type?.includes('youtube')) {
            prompt += `\n\nThis is a video titled "${metadata.title}" from channel "${metadata.byline}".`;
        } else if (metadata.url?.includes('github.com') || metadata.url?.includes('gitlab.com')) {
            prompt += `\n\nThis is code from "${metadata.title}".`;
        } else if (metadata.byline) {
            prompt += `\n\nThis is an article titled "${metadata.title}" by ${metadata.byline}.`;
        }

        return prompt + `\n\nContent:\n${content}`;
    }

    // Add event listeners for quick action buttons
    if (addPageButton) {
        addPageButton.addEventListener('click', async () => {
            try {
                loadingManager.showToast('Loading tab content...', 'info');

                const response = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({ action: 'getLoadContent' }, (res) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(res);
                        }
                    });
                });

                if (response && response.action === 'loadContentResponse') {
                    if (response.success && response.content) {
                        let sourceInfo = response.title;
                        if (response.siteName) sourceInfo = `${response.title} (${response.siteName})`;
                        if (response.byline) sourceInfo += ` by ${response.byline}`;

                        addLoadedContentMessage(sourceInfo, response.content);

                        conversationHistory.push({
                            role: 'user',
                            content: `I have loaded the content from the page "${response.title}" (${response.url}).\nSource: ${response.siteName || 'Unknown'}\nAuthor: ${response.byline || 'Unknown'}\n\nHere is the content:\n\n${response.content}`
                        });

                        chatMainArea.style.display = 'block';
                        oneoffInstructionArea.style.display = 'none';
                        userInput.focus();
                        loadingManager.showToast('Content loaded! You can now ask questions about it.', 'success');
                    } else {
                        const errorMsg = response.error || 'Content not available';
                        console.error("Chat.js: Add page button - Failed:", errorMsg);
                        loadingManager.showToast('No content received: ' + errorMsg, 'error');
                    }
                } else {
                    loadingManager.showToast('Unexpected response from background script', 'error');
                }
            } catch (error) {
                console.error("Chat.js: Add page button - Error:", error.message);
                loadingManager.showToast(`Error: ${error.message}`, 'error');
            }
        });
    }

    // Analyze button - runs last used preset mode
    if (analyzeButton) {
        analyzeButton.addEventListener('click', () => {
            executePresetMode(lastUsedPreset);
        });
    }

    // Analyze dropdown - shows preset menu
    let presetMenuVisible = false;
    let presetMenu = null;

    function createPresetMenu() {
        if (presetMenu) return presetMenu;
        
        presetMenu = document.createElement('div');
        presetMenu.id = 'preset-menu';

        Object.values(PRESET_MODES).forEach(preset => {
            const item = document.createElement('button');
            item.className = 'preset-menu-item';
            item.dataset.mode = preset.key;
            item.innerHTML = `<span class="material-icons">${preset.icon}</span>${preset.label}`;
            
            item.addEventListener('click', () => {
                lastUsedPreset = preset.key;
                hidePresetMenu();
                executePresetMode(preset.key);
            });

            presetMenu.appendChild(item);
        });

        document.body.appendChild(presetMenu);
        return presetMenu;
    }

    function showPresetMenu() {
        const menu = createPresetMenu();
        const btn = analyzeDropdown.getBoundingClientRect();
        menu.style.left = `${btn.left}px`;
        menu.style.top = `${btn.bottom + 4}px`;
        menu.style.display = 'block';
        presetMenuVisible = true;
    }

    function hidePresetMenu() {
        if (presetMenu) {
            presetMenu.style.display = 'none';
        }
        presetMenuVisible = false;
    }

    if (analyzeDropdown) {
        analyzeDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
            if (presetMenuVisible) {
                hidePresetMenu();
            } else {
                showPresetMenu();
            }
        });
    }

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (presetMenuVisible && !presetMenu?.contains(e.target)) {
            hidePresetMenu();
        }
    });

    if (explainButton) {
        explainButton.addEventListener('click', async () => {
            try {
                loadingManager.showToast('Requesting tab content for explanation...', 'info');

                const response = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({ action: 'getExplainContent' }, (res) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(res);
                        }
                    });
                });

                if (response && response.action === 'explainContentResponse') {
                    if (response.success && response.content) {
                        const prompt = "Explain the following text:\n\n" + response.content;
                        chatMainArea.style.display = 'block';
                        oneoffInstructionArea.style.display = 'none';
                        makeApiCall(prompt);
                        loadingManager.showToast('Tab content received, explaining...', 'success');
                    } else {
                        const errorMsg = response.error || 'Content not available';
                        console.error("Chat.js: Explain button - Failed to get content:", errorMsg);
                        loadingManager.showToast('No content received for explanation: ' + errorMsg, 'error');
                    }
                } else {
                    console.warn("Chat.js: Explain button - Received unexpected response:", response);
                    loadingManager.showToast('Received an unexpected response for explain action.', 'warning');
                }
            } catch (error) {
                console.error("Chat.js: Explain button - Error:", error.message);
                loadingManager.showToast(`Error: ${error.message}`, 'error');
            }
        });
    }

     const darkThemeToggle = document.getElementById('darkThemeToggle');
     if (darkThemeToggle) {
         setupThemeToggle(darkThemeToggle);
     }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.pinnedQuickActions || changes.instructions)) {
            renderPinnedActions();
        }
    });

    const PENDING_PANEL_ACTION_KEY = 'pendingPanelAction';

    let selectedText = null;
    let tabId = null;
    let currentRunId = null; // Track active orchestrator run
    let currentStreamingMessageDiv = null;
    let currentStreamingContentElement = null;
    let currentStreamingUniqueId = null;
    let accumulatedStreamedText = "";
    let activeStreamingToolCall = null;
    let currentAbortController = null;
    let currentMediaData = null; // Store media data for analysis
    let conversationHistory = [];
    let lastProcessedPanelActionId = null;

    /**
     * Stops the current API request by aborting the orchestrator run.
     */
    function stopApiRequest() {
        if (currentRunId) {
            chrome.runtime.sendMessage({
                action: 'abortRun',
                runId: currentRunId
            });
        }
    }

    /**
     * Retrieves the API configuration from Chrome storage.
     * @returns {Promise<Object>} The selected profile configuration.
     * @throws {Error} If configuration is incomplete or cannot be read.
     */
    async function getApiConfig() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
                if (chrome.runtime.lastError) {
                    const error = new Error(`Failed to read configuration: ${chrome.runtime.lastError.message}`);
                    console.error("Chat: Storage read error:", chrome.runtime.lastError.message);
                    loadingManager.showToast('Error reading configuration', 'error');
                    reject(error);
                    return;
                }

                const profiles = result.profiles || [];
                const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
                const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId) || profiles.find(p => p.id === 'default');

                if (!selectedProfile || !selectedProfile.llmEndpoint || !selectedProfile.apiKey || !selectedProfile.modelName) {
                    console.error("Chat: Configuration is incomplete or missing.");
                    const error = new Error('Configuration is incomplete. Please set up the API endpoint, API key, and model name in the options page.');
                    loadingManager.showToast('Please configure API settings in options', 'error');
                    reject(error);
                } else {
                    resolve(selectedProfile);
                }
            });
        });
    }

    /**
     * Attaches click event listeners to copy icons for copying message content.
     * @param {string} rawMessage - The raw text message to copy.
     * @param {HTMLElement} contentElement - The element containing the formatted content.
     * @param {HTMLElement} copyIconElement - The copy icon element for plain text.
     * @param {HTMLElement} copyFormattedIconElement - The copy icon element for formatted text.
     */
    function attachCopyListeners(rawMessage, contentElement, copyIconElement, copyFormattedIconElement) {
        const newCopyIcon = copyIconElement.cloneNode(true);
        if (copyIconElement.parentNode) {
            copyIconElement.parentNode.replaceChild(newCopyIcon, copyIconElement);
        }
        const newFormattedCopyIcon = copyFormattedIconElement.cloneNode(true);
        if (copyFormattedIconElement.parentNode) {
            copyFormattedIconElement.parentNode.replaceChild(newFormattedCopyIcon, copyFormattedIconElement);
        }
        newCopyIcon.addEventListener('click', async function(event) {
            event.stopPropagation();
            try {
                await navigator.clipboard.writeText(rawMessage);
                loadingManager.showToast('Copied raw text to clipboard', 'success');
            } catch (err) {
                console.error('Failed to copy raw text: ', err);
                loadingManager.showToast('Error copying raw text.', 'error');
            }
        });
        newFormattedCopyIcon.addEventListener('click', async function(event) {
            event.stopPropagation();
            const htmlContent = contentElement.innerHTML;
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': new Blob([htmlContent], { type: 'text/html' }),
                        'text/plain': new Blob([rawMessage], { type: 'text/plain' })
                    })
                ]);
                loadingManager.showToast('Copied formatted text to clipboard', 'success');
            } catch (err) {
                console.error('Failed to copy formatted text: ', err);
                try {
                    await navigator.clipboard.writeText(rawMessage);
                    loadingManager.showToast('Copied (plain text fallback) to clipboard', 'success');
                } catch (errFallback) {
                    console.error('Failed to copy plain text fallback: ', errFallback);
                    loadingManager.showToast('Error copying text.', 'error');
                }
            }
        });
    }

    /**
     * Adds a message to the chat area.
     * @param {string} sender - The sender name ('User', 'Assistant', or 'System').
     * @param {string} message - The message content (can contain Markdown).
     * @returns {void}
     */
    function addMessage(sender, message) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    let contentElement = messageDiv;
    let uniqueIdString = '';

    if (sender === 'User') {
        messageDiv.classList.add('user-message');
        messageDiv.textContent = 'You: ' + message;
    } else if (sender === 'System') {
        messageDiv.classList.add('system-message');
        messageDiv.textContent = 'System: ' + message;
    } else if (sender === 'LLM') {
        messageDiv.classList.add('llm-message');
        const llmContentSpan = document.createElement('span');
        llmContentSpan.classList.add('llm-content-area');
        // Ensure marked.parse is available or handle potential errors
        if (typeof marked !== 'undefined') {
            llmContentSpan.innerHTML = marked.parse(message || "");
        } else {
            llmContentSpan.textContent = message || "";
        }
        messageDiv.appendChild(llmContentSpan);
        contentElement = llmContentSpan;
        uniqueIdString = Date.now() + '_' + Math.random().toString(36).substring(2, 9);

        // --- Icon for copying raw text ---
        const copyIcon = document.createElement('img');
        copyIcon.id = `copy-icon-${uniqueIdString}`;
        // Replaced base64 string with a file path
        copyIcon.src = document.body.classList.contains('dark-theme') ? 'icons/light-copy-markdown.png' : 'icons/copy-markdown.png';
        copyIcon.alt = "Copy Raw";
        copyIcon.style.cssText = "cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;";
        messageDiv.appendChild(copyIcon);

        // --- Icon for copying formatted text ---
        const copyFormattedIcon = document.createElement('img');
        copyFormattedIcon.id = `copy-formatted-icon-${uniqueIdString}`;
        // Replaced base64 string with a file path
        const formattedIconSrc = document.body.classList.contains('dark-theme') ? 'icons/light-copy-formatted.png' : 'icons/copy-formatted.png';
        copyFormattedIcon.src = formattedIconSrc;
        copyFormattedIcon.alt = "Copy Formatted";
        copyFormattedIcon.style.cssText = "cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;";
        messageDiv.appendChild(copyFormattedIcon);

        if (message) {
            attachCopyListeners(message, contentElement, copyIcon, copyFormattedIcon);
        }
    } else {
        messageDiv.textContent = message; // Should not happen if sender is always User, System, or LLM
    }
    chatArea.appendChild(messageDiv);

    setTimeout(() => {
        chatArea.scrollTop = chatArea.scrollHeight;
    }, 10);
    return { messageDiv, contentElement, uniqueIdString };
}

    /**
     * Creates an expandable message for loaded tab content.
     * @param {string} sourceInfo - Formatted source information (title, site, author)
     * @param {string} fullContent - The complete extracted content
     * @returns {HTMLElement} The created container element
     */
    function addLoadedContentMessage(sourceInfo, fullContent) {
        const container = document.createElement('div');
        container.className = 'message system-message loaded-content-container';
        
        const header = document.createElement('div');
        header.className = 'loaded-content-header';
        header.innerHTML = `
            <div class="loaded-content-info">
                📄 <strong>Content loaded from:</strong> ${sourceInfo}
            </div>
            <div class="loaded-content-actions">
                <button class="copy-content-btn" title="Copy full content">
                    <span class="material-icons" style="font-size: 14px;">content_copy</span>
                    <span class="copy-label">Copy</span>
                </button>
                <button class="expand-toggle-btn">
                    <span class="material-icons" style="font-size: 16px;">expand_more</span>
                    <span class="expand-label">Expand</span>
                </button>
            </div>
        `;
        
        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'loaded-content-body';
        bodyDiv.textContent = fullContent;
        
        container.appendChild(header);
        container.appendChild(bodyDiv);
        
        const expandBtn = header.querySelector('.expand-toggle-btn');
        const expandLabel = expandBtn.querySelector('.expand-label');
        const expandIcon = expandBtn.querySelector('.material-icons');
        
        let isExpanded = false;
        
        expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isExpanded = !isExpanded;
            
            if (isExpanded) {
                bodyDiv.classList.add('expanded');
                expandLabel.textContent = 'Collapse';
                expandIcon.textContent = 'expand_less';
            } else {
                bodyDiv.classList.remove('expanded');
                expandLabel.textContent = 'Expand';
                expandIcon.textContent = 'expand_more';
            }
            
            setTimeout(() => {
                chatArea.scrollTop = chatArea.scrollHeight;
            }, 10);
        });
        
        const copyBtn = header.querySelector('.copy-content-btn');
        const copyLabel = copyBtn.querySelector('.copy-label');
        
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(fullContent).then(() => {
                copyBtn.classList.add('copied');
                copyLabel.textContent = 'Copied!';
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyLabel.textContent = 'Copy';
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy:', err);
                copyLabel.textContent = 'Error';
                setTimeout(() => {
                    copyLabel.textContent = 'Copy';
                }, 2000);
            });
        });
        
        header.addEventListener('click', () => {
            expandBtn.click();
        });
        
        chatArea.appendChild(container);
        
        setTimeout(() => {
            chatArea.scrollTop = chatArea.scrollHeight;
        }, 10);
        
        return container;
    }

    function applySetSelectedTextAction(request) {
        if (request.actionId && request.actionId === lastProcessedPanelActionId) {
            return;
        }

        if (request.actionId) {
            lastProcessedPanelActionId = request.actionId;
        }

        selectedText = request.selectedText || '';
        tabId = request.tabId;

        // Handle media data from context menu
        if (request.mediaData) {
            currentMediaData = request.mediaData;

            // Show chat area with media preview
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';

            if (currentMediaData.error) {
                addMessage('System', `❌ Error loading ${currentMediaData.type}: ${currentMediaData.error}`);
            } else if (currentMediaData.base64) {
                addMediaPreview(currentMediaData);
            }
        } else if (request.fromStartChat) {
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            conversationHistory = [];
        } else {
            selectedTextDiv.textContent = selectedText;
            chatMainArea.style.display = 'none';
            oneoffInstructionArea.style.display = 'block';
        }
    }

    function consumePendingPanelAction(pendingAction) {
        if (!pendingAction || pendingAction.action !== 'setSelectedText') {
            return;
        }

        applySetSelectedTextAction(pendingAction);

        if (!chrome.storage?.session) {
            return;
        }

        chrome.storage.session.get([PENDING_PANEL_ACTION_KEY], (result) => {
            const storedAction = result?.[PENDING_PANEL_ACTION_KEY];
            if (!storedAction) {
                return;
            }

            if (!pendingAction.actionId || !storedAction.actionId || storedAction.actionId === pendingAction.actionId) {
                chrome.storage.session.remove([PENDING_PANEL_ACTION_KEY]);
            }
        });
    }

    function consumePendingPanelActionOnLoad() {
        if (!chrome.storage?.session) {
            return;
        }

        chrome.storage.session.get([PENDING_PANEL_ACTION_KEY], (result) => {
            const pendingAction = result?.[PENDING_PANEL_ACTION_KEY];
            consumePendingPanelAction(pendingAction);
        });
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'session') {
            return;
        }

        const pendingActionChange = changes[PENDING_PANEL_ACTION_KEY];
        if (pendingActionChange?.newValue) {
            consumePendingPanelAction(pendingActionChange.newValue);
        }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'setSelectedText') {
            applySetSelectedTextAction(request);
            if (sendResponse) sendResponse({ success: true });
            return true;
        } else if (request.action === 'setMediaForAnalysis') {
            // Handle media data from context menu
            const mediaData = request.mediaData;
            tabId = request.tabId;

            // Show chat area
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';

            if (mediaData.loading) {
                // Show loading state
                addMessage('System', `📥 Loading ${mediaData.type} for analysis...`);
            } else if (mediaData.error) {
                // Show error
                addMessage('System', `❌ Error loading ${mediaData.type}: ${mediaData.error}`);
            } else if (mediaData.base64 || mediaData.textPrompt) {
                // Media loaded successfully OR text-only from context menu
                if (mediaData.base64) {
                    currentMediaData = mediaData;
                    addMediaPreview(currentMediaData);
                }

                // Use textPrompt if provided (from text-only context menu)
                const promptText = mediaData.textPrompt || mediaData.prompt;
                
                // Generate prompt based on action type
                let analysisPrompt;
                if (mediaData.actionType === "custom" && mediaData.instructionId) {
                    // Handle custom instruction
                    chrome.storage.local.get(['instructions'], (result) => {
                        const instructions = result.instructions || [];
                        const instruction = instructions.find(i => i.id === mediaData.instructionId);
                        let instructionToolChoice = 'auto';
                        if (instruction) {
                            analysisPrompt = mediaData.textPrompt || instruction.content;
                            instructionToolChoice = instruction.tool_choice || 'auto';
                            addMessage('System', `🎯 Using custom instruction: "${instruction.name}"`);
                        } else {
                            analysisPrompt = mediaData.textPrompt || `Please analyze this ${currentMediaData?.type || 'content'}. Describe what you see and provide any relevant insights.`;
                        }

                        if (currentMediaData) {
                            makeApiCallWithMedia(analysisPrompt, currentMediaData, instructionToolChoice);
                        } else {
                            makeApiCall(analysisPrompt, instructionToolChoice);
                        }
                    });
                    return; // Exit early for async custom instruction handling
                } else if (mediaData.actionType === "summarize") {
                    analysisPrompt = mediaData.textPrompt || `Please summarize this ${currentMediaData?.type || 'content'} into a bullet list of key points. Focus on the main elements, text, objects, and overall message or purpose.`;
                    addMessage('System', `📝 Summarizing...`);
                } else if (mediaData.actionType === "explain") {
                    analysisPrompt = mediaData.textPrompt || `Explain this ${currentMediaData?.type || 'content'} to me in a short concise MECE approach. Break down what you see into clear, structured categories.`;
                    addMessage('System', `💡 Explaining...`);
                } else {
                    // Default analysis
                    analysisPrompt = mediaData.textPrompt || `Please analyze this ${currentMediaData?.type || 'content'}. Describe what you see and provide any relevant insights.`;
                    addMessage('System', `🔍 Analyzing...`);
                }

                if (currentMediaData) {
                    makeApiCallWithMedia(analysisPrompt, currentMediaData);
                } else {
                    makeApiCall(analysisPrompt);
                }
            }
            if (sendResponse) sendResponse({ success: true });
            return true;
        } else if (request.action === 'setApiResponse') {
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            userInput.disabled = false;
            sendButton.disabled = false;
            if (currentStreamingMessageDiv) {
                currentStreamingMessageDiv = null;
                currentStreamingContentElement = null;
                currentStreamingUniqueId = null;
                accumulatedStreamedText = "";
            }
            if (request.prompt) { // Add user prompt to history if not already there
                const lastMessage = conversationHistory[conversationHistory.length - 1];
                if (!lastMessage || !(lastMessage.role === 'user' && lastMessage.content === request.prompt)) {
                    addMessage('User', request.prompt.split('\n')[0]); // Display shortened prompt
                    conversationHistory.push({ role: 'user', content: request.prompt });
                }
            }

            if (request.apiResponse && typeof request.apiResponse === 'string') {
                // Standard text response (OpenAI, or Anthropic, or error string)
                addMessage('LLM', request.apiResponse);
                const lastAssistantMessage = conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'assistant' ? conversationHistory[conversationHistory.length - 1].content : null;
                if (lastAssistantMessage !== request.apiResponse) {
                    conversationHistory.push({ role: 'assistant', content: request.apiResponse });
                }
            } else if (request.apiResponse) { // Fallback for unexpected structure
                 console.warn("Chat: setApiResponse received apiResponse in unexpected format:", request.apiResponse);
                 addMessage('LLM', JSON.stringify(request.apiResponse));
                  conversationHistory.push({ role: 'assistant', content: JSON.stringify(request.apiResponse) });
            }
            if (sendResponse) sendResponse({ success: true });
            return true;
        } else if (request.action === 'streamApiStart') {
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            userInput.disabled = true;
            sendButton.disabled = true;
            if (request.prompt) {
                const lastMessage = conversationHistory[conversationHistory.length - 1];
                 if (!lastMessage || !(lastMessage.role === 'user' && lastMessage.content === request.prompt)) {
                    addMessage('User', request.prompt.split('\n')[0]);
                    conversationHistory.push({ role: 'user', content: request.prompt });
                }
            }
            accumulatedStreamedText = "";
            const { messageDiv, contentElement, uniqueIdString } = addMessage('LLM', '');
            currentStreamingMessageDiv = messageDiv;
            currentStreamingContentElement = contentElement;
            currentStreamingUniqueId = uniqueIdString;
            if (sendResponse) sendResponse({ success: true });
            return true;
        } else if (request.action === 'streamApiResponseChunk') {
            if (activeStreamingToolCall) return; // If a tool call is active, don't process further text chunks for this bubble
            if (currentStreamingContentElement && request.chunk != null) {
                accumulatedStreamedText += request.chunk;
                currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
                chatArea.scrollTop = chatArea.scrollHeight;
            }
        } else if (request.action === 'orchestratorEvent') {
            // NEW: Handle events from orchestrator
            const { runId, event } = request;
            
            // Ignore events from other runs
            if (currentRunId && runId !== currentRunId) {
                if (sendResponse) sendResponse({ success: true, ignored: true });
                return true;
            }
            
            if (!currentRunId) currentRunId = runId;
            
            switch (event.type) {
                case 'content':
                    if (currentStreamingContentElement && event.data) {
                        accumulatedStreamedText += event.data;
                        currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
                        chatArea.scrollTop = chatArea.scrollHeight;
                    }
                    break;
                    
                case 'tool_start':
                    activeStreamingToolCall = event.toolCall;
                    if (currentStreamingContentElement) {
                        currentStreamingContentElement.innerHTML = marked.parse(`⚙️ Using tool: **${event.toolCall.function.name}**`);
                    }
                    break;
                    
                case 'tool_ready':
                    addMessage('System', `⚙️ Executing tool: **${event.toolCall.function.name}**...`);
                    break;
                    
                case 'tool_complete':
                    addMessage('System', `✅ Tool ${event.toolCall.function.name} executed.`);
                    
                    // Add traceability for skill usage
                    if (event.toolCall.function.name === 'load_skill') {
                        try {
                            const args = JSON.parse(event.toolCall.function.arguments);
                            addMessage('System', `📚 Loaded skill: **${args.name}**`);
                            const skillContent = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
                            const contentPreview = skillContent.substring(0, 200) + (skillContent.length > 200 ? '...' : '');
                            addMessage('System', `📝 Skill instructions preview:\n\`\`\`\n${contentPreview}\n\`\`\``);
                        } catch (e) {
                            console.warn('Could not parse load_skill arguments for traceability');
                        }
                    }
                    
                    // Add tool result to history
                    conversationHistory.push({
                        role: 'tool',
                        tool_call_id: event.toolCall.id,
                        name: event.toolCall.function.name,
                        content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result)
                    });
                    break;
                    
                case 'tool_error':
                    addMessage('System', `❌ Error executing tool ${event.toolCall.function.name}: ${event.error}`);
                    conversationHistory.push({
                        role: 'tool',
                        tool_call_id: event.toolCall.id,
                        name: event.toolCall.function.name,
                        content: `Error: ${event.error}`
                    });
                    break;
                    
                case 'complete':
                    // Finalize the existing streaming bubble instead of creating a duplicate
                    if (currentStreamingContentElement) {
                        const finalContent = event.content || accumulatedStreamedText || '';
                        currentStreamingContentElement.innerHTML = marked.parse(finalContent);
                        
                        // Attach copy listeners to existing bubble
                        const copyIcon = document.getElementById(`copy-icon-${currentStreamingUniqueId}`);
                        const copyFormattedIcon = document.getElementById(`copy-formatted-icon-${currentStreamingUniqueId}`);
                        if (copyIcon && copyFormattedIcon) {
                            attachCopyListeners(finalContent, currentStreamingContentElement, copyIcon, copyFormattedIcon);
                        }
                    } else {
                        // Fallback: create new bubble if no streaming element exists
                        addMessage('LLM', event.content || '');
                    }
                    
                    // Reset UI state
                    userInput.disabled = false;
                    sendButton.disabled = false;
                    clearButton.textContent = 'Clear';
                    userInput.focus();
                    
                    // Reset streaming variables
                    currentStreamingMessageDiv = null;
                    currentStreamingContentElement = null;
                    currentStreamingUniqueId = null;
                    accumulatedStreamedText = '';
                    activeStreamingToolCall = null;
                    currentRunId = null;
                    break;
                    
                case 'error':
                    addMessage('System', `❌ Error: ${event.error}`);
                    userInput.disabled = false;
                    sendButton.disabled = false;
                    clearButton.textContent = 'Clear';
                    userInput.focus();
                    currentRunId = null;
                    break;
            }
            
            if (sendResponse) sendResponse({ success: true });
            return true;
        } else if (request.action === 'streamApiEnd') {
            // DEPRECATED: This handler is replaced by orchestratorEvent handling
            // Kept for backward compatibility but does minimal work
            if (sendResponse) sendResponse({ success: true });
            
            // Only reset UI if not already handled by orchestrator
            if (!currentRunId) {
                userInput.disabled = false;
                sendButton.disabled = false;
                clearButton.textContent = 'Clear';
                userInput.focus();
                
                currentStreamingMessageDiv = null;
                currentStreamingContentElement = null;
                currentStreamingUniqueId = null;
                accumulatedStreamedText = "";
                activeStreamingToolCall = null;
            }
            return true;
        } else if (request.action === 'streamApiToolCallChunk') {
            // DEPRECATED: This handler is replaced by orchestratorEvent handling
            // Kept for backward compatibility
            if (sendResponse) sendResponse({ success: true });
            return true;
        } else if (request.action === 'streamApiAnthropicContentBlockStart' || request.action === 'streamApiAnthropicMessageStop') {
            // DEPRECATED: These handlers are replaced by orchestratorEvent handling
            // Kept for backward compatibility
            if (sendResponse) sendResponse({ success: true });
            return true;

        } else if (request.action === 'handleToolCallResponse') {
            // DEPRECATED: This handler is replaced by orchestratorEvent handling
            // Kept for backward compatibility
            const { responseMessage } = request;
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            userInput.disabled = false;
            sendButton.disabled = false;
            
            // If responseMessage contains tool_calls, we need to start a new orchestrator run
            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                const toolCall = responseMessage.tool_calls[0];
                addMessage('System', `⚙️ Requesting execution for tool: **${toolCall.function.name}**...`);
                
                // Use orchestrator to execute the tool
                chrome.runtime.sendMessage({
                    action: 'executeTool',
                    runId: currentRunId, // Use current run or null for legacy
                    toolCall: toolCall
                }, (response) => {
                    if (response?.error) {
                        addMessage('System', `❌ Error executing tool ${toolCall.function.name}: ${response.error}`);
                    } else {
                        addMessage('System', `✅ Tool ${toolCall.function.name} executed.`);
                    }
                });
            } else {
                conversationHistory.push(responseMessage);
            }
            
            if (sendResponse) sendResponse({ success: true });
            return true;
        }
    });

    sendButton.addEventListener('click', sendMessage);
    const clearButton = document.getElementById('clear-button');
    clearButton.addEventListener('click', () => {
        if (clearButton.textContent === 'Stop') {
            stopApiRequest();
        } else {
            clearChat();
        }
    });
    userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !userInput.disabled) {
            event.preventDefault();
            sendMessage();
        }
    });

    consumePendingPanelActionOnLoad();

    function clearChat() {
            chatArea.innerHTML = '';
            conversationHistory = [];
            currentMediaData = null; // Clear media data
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            loadingManager.showToast('Chat history cleared', 'info');
    }

    function addMediaPreview(mediaData) {
        const previewDiv = document.createElement('div');
        previewDiv.classList.add('message', 'system-message');
        previewDiv.style.cssText = 'background: var(--ext-muted); border-left: 4px solid var(--ext-primary); margin-bottom: 10px; color: var(--ext-muted-foreground);';

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

        chatArea.appendChild(previewDiv);
        chatArea.scrollTop = chatArea.scrollHeight;
    }

     /**
     * Makes an API call with media content (images, video, audio).
     * @param {string} userMessage - The user's message/prompt.
     * @param {Object} mediaData - The media data object containing base64, mimeType, etc.
     * @param {string} [tool_choice='auto'] - The tool choice strategy ('none', 'auto', or specific tool name).
     * @param {string|null} [requestedSkill=null] - Name of skill to force-load via load_skill tool.
     * @returns {Promise<void>}
     */
    async function makeApiCallWithMedia(userMessage, mediaData, tool_choice = 'auto', requestedSkill = null) {
        try {
            const config = await getApiConfig();
            
            // If a specific skill is requested, force tool mode
            const requestedToolChoice = requestedSkill ? 'load_skill' : tool_choice;
            const effectiveToolChoice =
                requestedToolChoice === undefined || requestedToolChoice === null || requestedToolChoice === ''
                    ? 'auto'
                    : requestedToolChoice;

            // Store media data for the run
            currentMediaData = mediaData;

            // Add user message to history if provided
            if (userMessage) {
                addMessage('User', userMessage);

                // Create message content with media
                const messageContent = [{ type: 'text', text: userMessage }];

                // Add media content for vision models
                if (mediaData.type === 'image') {
                    messageContent.push({
                        type: 'image_url',
                        image_url: { url: `data:${mediaData.mimeType};base64,${mediaData.base64}` }
                    });
                }

                conversationHistory.push({
                    role: 'user',
                    content: messageContent
                });
            }

            // Create UI elements for streaming
            const { messageDiv, contentElement, uniqueIdString } = addMessage('LLM', '');
            currentStreamingMessageDiv = messageDiv;
            currentStreamingContentElement = contentElement;
            currentStreamingUniqueId = uniqueIdString;
            accumulatedStreamedText = '';
            userInput.disabled = true;
            sendButton.disabled = true;
            clearButton.textContent = 'Stop';

            // Prepare run configuration with media
            const runConfig = {
                llmEndpoint: config.llmEndpoint,
                apiKey: config.apiKey,
                modelName: config.modelName,
                systemPrompt: config.systemPrompt,
                tool_choice: effectiveToolChoice,
                tools: await getTools(),
                mediaData: mediaData
            };

            // Start orchestrator run
            const startResponse = await chrome.runtime.sendMessage({
                action: 'startRun',
                config: runConfig
            });

            if (startResponse.error) {
                throw new Error(startResponse.error);
            }

            currentRunId = startResponse.runId;

            // Execute the run
            await chrome.runtime.sendMessage({
                action: 'executeRun',
                runId: currentRunId,
                requestConfig: {
                    messages: conversationHistory
                }
            });

        } catch (error) {
            console.error('makeApiCallWithMedia Error:', error);
            addMessage('System', 'Error: ' + error.message);
            userInput.disabled = false;
            sendButton.disabled = false;
            clearButton.textContent = 'Clear';
            userInput.focus();
            
            // Reset state
            currentMediaData = null;
            currentStreamingMessageDiv = null;
            currentStreamingContentElement = null;
            currentStreamingUniqueId = null;
            accumulatedStreamedText = '';
            activeStreamingToolCall = null;
            currentRunId = null;
        }
    }

    // Removed handleSummarizeTabButtonClick as its logic is now consolidated
    // in the event listener at lines 878-905.
    // Removed handleExplainButtonClick as its logic is now consolidated
    // in the event listener for explainBtn (lines 24-40 approx).
    // The new listener directly sends 'getExplainContent'.

    /**
     * Detects if user wants to use a specific skill.
     * Patterns: "use <skill> skill", "apply <skill> skill", "with <skill> skill"
     * @param {string} message - User message
     * @param {Array} availableSkills - List of available skills
     * @returns {string|null} - Skill name if detected, null otherwise
     */
    function detectSkillIntent(message, availableSkills) {
        if (!availableSkills || availableSkills.length === 0) return null;

        const lowerMessage = message.toLowerCase();

        // Pattern: "use <skill> skill", "apply <skill> skill", "with <skill> skill"
        const skillPatterns = [
            /(?:use|apply|with)\s+(\w[\w-]*)\s+skill/i,
            /(?:using|applying)\s+(\w[\w-]*)\s+skill/i
        ];

        for (const pattern of skillPatterns) {
            const match = lowerMessage.match(pattern);
            if (match) {
                const requestedSkill = match[1].toLowerCase();
                // Check if requested skill exists in available skills
                const foundSkill = availableSkills.find(s =>
                    s.name.toLowerCase() === requestedSkill ||
                    s.name.toLowerCase().replace(/-/g, '') === requestedSkill.replace(/-/g, '')
                );
                if (foundSkill) {
                    console.log(`Chat: Detected skill intent for '${foundSkill.name}'`);
                    return foundSkill.name;
                }
            }
        }

        return null;
    }

    async function sendMessage() {
        activeStreamingToolCall = null; // Reset active tool call
        const message = userInput.value;
        if (message.trim() && !userInput.disabled) {
            // Check for skill intent
            const skillsResp = await new Promise(resolve => {
                chrome.runtime.sendMessage({ action: 'getSkills' }, (response) => {
                    if (chrome.runtime.lastError) resolve({ skills: [] });
                    else resolve(response || { skills: [] });
                });
            });
            const availableSkills = (skillsResp && skillsResp.skills) ? skillsResp.skills : [];
            const requestedSkill = detectSkillIntent(message, availableSkills);

            if (requestedSkill) {
                addMessage('System', `🎯 Skill detected: **${requestedSkill}**. Loading skill instructions...`);
            }

            if (currentMediaData) {
                makeApiCallWithMedia(message, currentMediaData, 'auto', requestedSkill);
                currentMediaData = null; // Clear media after use
            } else {
                makeApiCall(message, 'auto', requestedSkill);
            }
            userInput.value = '';
        }
    }

    /**
     * Get user-defined tools from storage.
     * The orchestrator will inject load_skill tool automatically if skills are available.
     */
    async function getTools() {
        const { promptPaulTools: definedTools = [] } = await new Promise((resolve) => {
            chrome.storage.local.get(['promptPaulTools'], resolve);
        });

        return definedTools.filter(tool => {
            if (tool.name === 'load_skill') {
                console.warn("Chat: Skipping user-defined tool named 'load_skill' because it is reserved.");
                return false;
            }
            return true;
        });
    }

    /**
     * Makes an API call to the LLM endpoint using the orchestrator.
     * @param {string|null} [userMessage=null] - The user's message/prompt.
     * @param {string} [tool_choice='auto'] - The tool choice strategy ('none', 'auto', or specific tool name).
     * @param {string|null} [requestedSkill=null] - Name of skill to force-load via load_skill tool.
     * @returns {Promise<void>}
     */
    async function makeApiCall(userMessage = null, tool_choice = 'auto', requestedSkill = null) {
        try {
            const config = await getApiConfig();
            
            // If a specific skill is requested, force tool mode
            const requestedToolChoice = requestedSkill ? 'load_skill' : tool_choice;
            const effectiveToolChoice =
                requestedToolChoice === undefined || requestedToolChoice === null || requestedToolChoice === ''
                    ? 'auto'
                    : requestedToolChoice;

            // Add user message to history if provided
            if (userMessage) {
                addMessage('User', userMessage);
                
                if (currentMediaData && currentMediaData.type === 'image') {
                    const messageContent = [
                        { type: 'text', text: userMessage },
                        {
                            type: 'image_url',
                            image_url: { url: `data:${currentMediaData.mimeType};base64,${currentMediaData.base64}` }
                        }
                    ];
                    conversationHistory.push({ role: 'user', content: messageContent });
                } else {
                    conversationHistory.push({ role: 'user', content: userMessage });
                }
                
                currentMediaData = null; // Clear after use
            }

            // Prepare run configuration
            const runConfig = {
                llmEndpoint: config.llmEndpoint,
                apiKey: config.apiKey,
                modelName: config.modelName,
                systemPrompt: config.systemPrompt,
                tool_choice: effectiveToolChoice,
                tools: await getTools()
            };

            // Create UI elements for streaming
            const { messageDiv, contentElement, uniqueIdString } = addMessage('LLM', '');
            currentStreamingMessageDiv = messageDiv;
            currentStreamingContentElement = contentElement;
            currentStreamingUniqueId = uniqueIdString;
            accumulatedStreamedText = '';
            userInput.disabled = true;
            sendButton.disabled = true;
            clearButton.textContent = 'Stop';

            // Start orchestrator run
            const startResponse = await chrome.runtime.sendMessage({
                action: 'startRun',
                config: runConfig
            });

            if (startResponse.error) {
                throw new Error(startResponse.error);
            }

            currentRunId = startResponse.runId;

            // Execute the run
            await chrome.runtime.sendMessage({
                action: 'executeRun',
                runId: currentRunId,
                requestConfig: {
                    messages: conversationHistory
                }
            });

        } catch (error) {
            console.error('makeApiCall Error:', error);
            addMessage('System', 'Error: ' + error.message);
            userInput.disabled = false;
            sendButton.disabled = false;
            clearButton.textContent = 'Clear';
            userInput.focus();
            
            // Reset streaming state
            currentStreamingMessageDiv = null;
            currentStreamingContentElement = null;
            currentStreamingUniqueId = null;
            accumulatedStreamedText = '';
            activeStreamingToolCall = null;
            currentRunId = null;
        }
    }

    // Legacy function that mimics old streaming behavior for compatibility
    async function makeApiCallLegacy(userMessage = null, tool_choice = 'auto', requestedSkill = null) {
        // This is now handled by makeApiCall with orchestrator
        return makeApiCall(userMessage, tool_choice, requestedSkill);
    }

    submitBtn.addEventListener('click', async () => {
        activeStreamingToolCall = null;
        const instruction = instructionInput.value;
        if (!instruction.trim()) {
            loadingManager.showToast('Please enter an instruction', 'warning');
            return;
        }
        
        try {
            let prompt;
            
            if (currentMediaData && currentMediaData.base64) {
                // Media + instruction
                const mediaInfo = `[${currentMediaData.type.toUpperCase()} loaded]`;
                prompt = instruction + '\n\n' + mediaInfo;
                
                // Show chat area and hide one-off instruction area
                oneoffInstructionArea.style.display = 'none';
                chatMainArea.style.display = 'block';
                addMessage('User', `${instruction}\n\n[${mediaInfo}]`);
                
                // Use orchestrator with media
                await makeApiCallWithMedia(instruction, currentMediaData);
                
                instructionInput.value = '';
                selectedTextDiv.textContent = '';
                selectedText = null;
                currentMediaData = null;
            } else if (selectedText && selectedText.trim()) {
                // Text-only instruction
                prompt = instruction + '\n\n' + selectedText;
                
                // Show chat area and hide one-off instruction area
                oneoffInstructionArea.style.display = 'none';
                chatMainArea.style.display = 'block';
                addMessage('User', `${instruction}\n\n[Selected text: ${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}]`);
                
                await makeApiCall(prompt, 'auto');
                instructionInput.value = '';
                selectedTextDiv.textContent = '';
                selectedText = null;
            } else {
                loadingManager.showToast('Please select text or load media first', 'warning');
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                addMessage('System', 'Response stopped');
            } else {
                let errorMsg = error.message;
                if (error.details) {
                    errorMsg += ` (Details: ${JSON.stringify(error.details)})`;
                }
                loadingManager.showToast('Error: ' + errorMsg, 'error');
                console.error("Error in one-off instruction submission:", error);
            }
            userInput.disabled = false;
            sendButton.disabled = false;
            clearButton.textContent = 'Clear';
            currentAbortController = null;
        }
    });

    // --- Pinned Instructions Functionality ---
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
                    // button.dataset.instructionContent = instruction.content; // Or store full content

                    button.addEventListener('click', () => {
                        // Ensure chat area is visible
                        chatMainArea.style.display = 'block';
                        oneoffInstructionArea.style.display = 'none';

                        // Retrieve the instruction object
                        const instructionToExecute = allInstructions.find(inst => inst.id === button.dataset.instructionId);
                        if (!instructionToExecute) {
                            loadingManager.showToast("Error: Could not find instruction details.", 'error');
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
                                    loadingManager.showToast(`Error: ${chrome.runtime.lastError.message}`, 'error');
                                    // Fallback or error handling: maybe execute with just selected text or show error
                                    // For now, we'll just show an error and not proceed.
                                    return;
                                }

                                // response.instruction should contain the instruction object passed back from background.js
                                const originalInstruction = response.instruction;
                                if (!originalInstruction) {
                                    loadingManager.showToast("Error: Instruction details not returned from background script.", 'error');
                                    return;
                                }

                                let tabContent = "";
                                if (response && response.success && response.content) {
                                    tabContent = response.content;
                                    loadingManager.showToast(`Executing: ${originalInstruction.name} with tab content...`, 'info');
                                } else if (response && !response.success) {
                                    loadingManager.showToast(`Note: Could not get tab content for ${originalInstruction.name}. Error: ${response.content || 'Unknown error'}`, 'warning');
                                } else {
                                    loadingManager.showToast(`Note: No tab content received for ${originalInstruction.name}. Executing without it.`, 'warning');
                                }

                                let prompt = originalInstruction.content;

                                if (tabContent && tabContent.trim() !== "") {
                                    prompt += '\n\nActive Tab Content:\n' + tabContent;
                                }

                                if (selectedText && selectedText.trim() !== "") {
                                    prompt += '\n\nSelected Text:\n' + selectedText;
                                }

                                // Pass the tool_choice from the original instruction
                                //makeApiCall(prompt, originalInstruction.tool_choice);
                                chrome.runtime.sendMessage({
                                    action: 'executeLlmApiRequest',
                                    prompt: prompt,
                                    tool_choice: originalInstruction.tool_choice
                                });
                            }
                        );
                    });
                    pinnedActionsContainer.appendChild(button);
                }
            });
        } catch (error) {
            console.error("Error rendering pinned actions:", error);
            loadingManager.showToast("Error loading pinned actions.", 'error');
        }
    }

    // Initial call to render and listener for changes will be added later.
    // The block for managePinnedActionsButton listener has been removed.

    // Initial rendering of pinned actions
    renderPinnedActions();

    // The chrome.storage.onChanged listener above has been updated to include this logic.
    // No need for a separate listener here.

    // Voice input functionality
    const voiceToggleButton = document.getElementById('voice-toggle-button');
    let speechRecognition = null;
    let isListening = false;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const isSpeechRecognitionSupported = !!SpeechRecognition;
    let firstPermissionDenial = true;

    function toggleVoiceInput() {
        if (!isSpeechRecognitionSupported) {
            loadingManager.showToast('Voice input not supported in this browser', 'error');
            return;
        }

        if (isListening) {
            stopVoiceInput();
        } else {
            startVoiceInput();
        }
    }

    async function startVoiceInput() {
        try {
            // Explicitly request permission via getUserMedia to ensure persistence
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
            } catch (e) {
                console.warn('getUserMedia check failed, falling back to SpeechRecognition:', e);
            }

            speechRecognition = new SpeechRecognition();
            speechRecognition.continuous = true;
            speechRecognition.interimResults = true;
            speechRecognition.lang = 'en-US';

            speechRecognition.onstart = function() {
                isListening = true;
                voiceToggleButton.classList.add('active', 'listening');
                userInput.placeholder = 'Listening... Speak now';
                loadingManager.showToast('Listening... Click mic again to stop', 'info');
            };

            speechRecognition.onresult = function(event) {
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

            speechRecognition.onerror = function(event) {
                console.error('Speech recognition error:', event.error);

                if (event.error === 'not-allowed') {
                    if (firstPermissionDenial) {
                        loadingManager.showToast(
                            'Microphone access required. Click the lock icon 🔒 in your browser address bar and select \'Allow\' next to Microphone to use voice input.',
                            'error',
                            8000
                        );
                        firstPermissionDenial = false;
                    } else {
                        loadingManager.showToast('Microphone access denied', 'error');
                    }
                    stopVoiceInput();
                } else if (event.error === 'no-speech') {
                    // Ignore no-speech error to allow auto-restart in onend
                    console.warn('Speech recognition: No speech detected (will restart)');
                } else {
                    loadingManager.showToast('Voice error: ' + event.error, 'error');
                    stopVoiceInput();
                }
            };

            speechRecognition.onend = function() {
                if (isListening) {
                    speechRecognition.start();
                }
            };

            speechRecognition.start();

        } catch (error) {
            console.error('Failed to start voice input:', error);
            loadingManager.showToast('Failed to start voice input', 'error');
            stopVoiceInput();
        }
    }

    function stopVoiceInput() {
        if (speechRecognition) {
            speechRecognition.stop();
            speechRecognition = null;
        }

        isListening = false;
        if (voiceToggleButton) {
            voiceToggleButton.classList.remove('active', 'listening');
        }
        userInput.placeholder = 'Type your message here (or right-click on images/media to analyze)';
    }

    // Clean up voice input on page unload
    window.addEventListener('beforeunload', function() {
        if (isListening) {
            stopVoiceInput();
        }
    });

    // Initialize voice input button
    if (voiceToggleButton && isSpeechRecognitionSupported) {
        voiceToggleButton.addEventListener('click', toggleVoiceInput);
        voiceToggleButton.title = 'Voice Input';
    } else if (voiceToggleButton) {
        voiceToggleButton.title = 'Voice Input not supported';
        voiceToggleButton.style.opacity = '0.5';
        voiceToggleButton.style.cursor = 'not-allowed';
    }
});
