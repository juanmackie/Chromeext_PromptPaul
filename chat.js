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
    const loadContentButton = document.getElementById('load-content-button');
    const summarizeTabButton = document.getElementById('summarize-tab-button');
    const tldrPresetButton = document.getElementById('tldr-preset-button');
    const techPresetButton = document.getElementById('tech-preset-button');
    const execPresetButton = document.getElementById('exec-preset-button');
    const pinnedActionsContainer = document.getElementById('pinned-actions-container');

    // --- specialized prompt map ---
    const SMART_PROMPTS = {
        summarize: {
            generic: "Please summarize the following content into a bullet list of key points.",
            article: "Summarize this article. Focus on the main facts, key people, important dates, and the final outcome or conclusion.",
            youtube: "Summarize this video. Focus on the main topics discussed, the speaker's key arguments, and any important timestamps or sections.",
            code: "Summarize this code/repository. Explain its purpose, key components, dependencies, and provide a brief usage example if possible."
        },
        tldr: {
            generic: "Provide a very brief TL;DR (3-4 sentences) of this content.",
            article: "TL;DR this article: what is the single most important takeaway?",
            youtube: "TL;DR this video: what is the main message in 2 sentences?",
            code: "TL;DR: What does this code do and why should I care?"
        },
        technical: {
            generic: "Provide a technical deep dive of this content.",
            article: "Analyze this article from a technical perspective. What are the underlying mechanisms or systems discussed?",
            youtube: "Technical breakdown: What tools, technologies, or methodologies are mentioned in this video?",
            code: "Deep dive into this code: Analyze the architecture, design patterns, and potential optimizations."
        },
        executive: {
            generic: "Provide an executive summary of this content.",
            article: "Executive Summary: What are the strategic implications and key decision points in this article?",
            youtube: "Executive Summary: What are the high-level takeaways and business value discussed in this video?",
            code: "Executive Summary: What problem does this codebase solve and what is its business or functional impact?"
        }
    };

    /**
     * Helper to determine content type from response
     */
    function determineContentType(response) {
        if (!response) return 'generic';
        if (response.url && response.url.includes('youtube.com/watch')) return 'youtube';
        if (response.type === 'youtube-transcript' || response.type === 'youtube-error') return 'youtube';
        // Generic heuristics for code-like pages (Github, Gists, etc.)
        if (response.url && (response.url.includes('github.com') || response.url.includes('gitlab.com'))) return 'code';
        // If it's a blog or news site
        if (response.siteName && (response.siteName.toLowerCase().includes('news') || response.siteName.toLowerCase().includes('blog'))) return 'article';

        return 'generic';
    }

    /**
     * Helper to execute a summarization preset.
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
                    const contentType = determineContentType(response);
                    const promptPrefix = SMART_PROMPTS[presetKey]?.[contentType] || SMART_PROMPTS[presetKey]?.generic || "Summarize this:";

                    let sourceContext = "";
                    if (response.title) sourceContext += `Title: ${response.title}\n`;
                    if (response.siteName) sourceContext += `Source: ${response.siteName}\n`;
                    if (response.byline) sourceContext += `Author: ${response.byline}\n`;

                    const prompt = `${promptPrefix}\n\n${sourceContext}\nContent:\n${response.content}`;
                    chatMainArea.style.display = 'block';
                    oneoffInstructionArea.style.display = 'none';
                    makeApiCall(prompt);
                    loadingManager.showToast(successText, 'success');

                    // --- YouTube Visual Enhancement ---
                    if (contentType === 'youtube') {
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
                loadingManager.showToast('Failed to get tab content.', 'error');
            }
        } catch (error) {
            console.error("Chat.js: Execute preset error:", error.message);
            loadingManager.showToast(`Error: ${error.message}`, 'error');
        }
    }

    // Add event listeners for quick action buttons
    if (loadContentButton) {
        loadContentButton.addEventListener('click', async () => {
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
                        const previewLength = 500;
                        const preview = response.content.substring(0, previewLength) + (response.content.length > previewLength ? '...' : '');

                        let sourceInfo = response.title;
                        if (response.siteName) sourceInfo = `${response.title} (${response.siteName})`;
                        if (response.byline) sourceInfo += ` by ${response.byline}`;

                        // Show system message
                        addMessage('System', `📄 **Content loaded from:** ${sourceInfo}\n\n**Preview:**\n${preview}`);

                        // Add to history as user message so LLM sees it in context
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
                        console.error("Chat.js: Load content button - Failed:", errorMsg);
                        loadingManager.showToast('No content received: ' + errorMsg, 'error');
                    }
                } else {
                    loadingManager.showToast('Unexpected response from background script', 'error');
                }
            } catch (error) {
                console.error("Chat.js: Load content button - Error:", error.message);
                loadingManager.showToast(`Error: ${error.message}`, 'error');
            }
        });
    }

    if (summarizeTabButton) {
        summarizeTabButton.addEventListener('click', () => {
            executePreset('summarize', 'Generating smart summary...', 'Smart summary started');
        });
    }

    if (tldrPresetButton) {
        tldrPresetButton.addEventListener('click', () => {
            executePreset('tldr', 'Generating TL;DR...', 'TL;DR started');
        });
    }

    if (techPresetButton) {
        techPresetButton.addEventListener('click', () => {
            executePreset('technical', 'Generating technical deep dive...', 'Technical dive started');
        });
    }

    if (execPresetButton) {
        execPresetButton.addEventListener('click', () => {
            executePreset('executive', 'Generating executive summary...', 'Executive summary started');
        });
    }
    const explainBtn = document.getElementById('explain-button');
    if (explainBtn) {
        explainBtn.addEventListener('click', async () => {
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

    let selectedText = null;
    let tabId = null;
    let currentStreamingMessageDiv = null;
    let currentStreamingContentElement = null;
    let currentStreamingUniqueId = null;
    let accumulatedStreamedText = "";
    let activeStreamingToolCall = null;
    let currentAbortController = null;
    let currentMediaData = null; // Store media data for analysis

    /**
     * Stops the current API request by aborting the AbortController.
     */
    function stopApiRequest() {
        if (currentAbortController) {
            currentAbortController.abort();
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

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'setSelectedText') {
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
            } else if (mediaData.base64) {
                // Media loaded successfully
                currentMediaData = mediaData;

                // Add media preview to chat
                addMediaPreview(currentMediaData);

                // Generate prompt based on action type
                let analysisPrompt;
                if (mediaData.actionType === "custom" && mediaData.instructionId) {
                    // Handle custom instruction
                    chrome.storage.local.get(['instructions'], (result) => {
                        const instructions = result.instructions || [];
                        const instruction = instructions.find(i => i.id === mediaData.instructionId);
                        if (instruction) {
                            analysisPrompt = instruction.content;
                            addMessage('System', `🎯 Using custom instruction: "${instruction.name}"`);
                        } else {
                            analysisPrompt = `Please analyze this ${currentMediaData.type}. Describe what you see and provide any relevant insights.`;
                        }

                        makeApiCallWithMedia(analysisPrompt, currentMediaData);
                    });
                    return; // Exit early for async custom instruction handling
                } else if (mediaData.actionType === "summarize") {
                    analysisPrompt = `Please summarize this ${currentMediaData.type} into a bullet list of key points. Focus on the main elements, text, objects, and overall message or purpose.`;
                    addMessage('System', `📝 Summarizing ${currentMediaData.type}...`);
                } else if (mediaData.actionType === "explain") {
                    analysisPrompt = `Explain this ${currentMediaData.type} to me in a short concise MECE approach. Break down what you see into clear, structured categories.`;
                    addMessage('System', `💡 Explaining ${currentMediaData.type}...`);
                } else {
                    // Default analysis
                    analysisPrompt = `Please analyze this ${currentMediaData.type}. Describe what you see and provide any relevant insights.`;
                    addMessage('System', `🔍 Analyzing ${currentMediaData.type}...`);
                }

                makeApiCallWithMedia(analysisPrompt, currentMediaData);
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
        } else if (request.action === 'streamApiEnd') {
            if (sendResponse) sendResponse({ success: true });
            // Check if Anthropic stream was already finalized by 'streamApiAnthropicMessageStop'
            // This flag is set by the streamApiAnthropicMessageStop handler to prevent this streamApiEnd handler
            // from duplicating UI resets and history additions for Anthropic streams.
            if (window.anthropicStreamFinalizedByStopEvent) {
                window.anthropicStreamFinalizedByStopEvent = false; // Reset flag for the next stream.

                // Perform only minimal, truly shared cleanup if any.
                // Most UI resets and history additions are handled by streamApiAnthropicMessageStop.
                // Ensure these are not redundantly called.
                userInput.disabled = false;
                sendButton.disabled = false;
                clearButton.textContent = 'Clear';
                userInput.focus();

                // Reset streaming variables, though streamApiAnthropicMessageStop should also do this.
                currentStreamingMessageDiv = null;
                currentStreamingContentElement = null;
                currentStreamingUniqueId = null;
                accumulatedStreamedText = "";
                activeStreamingToolCall = null;
                return; // Exit early
            }

            let toolCallWasHandledInThisStream = false; // Specific to OpenAI-style tool calls

            // Tool call execution logic (FOR OPENAI-STYLE Client-Managed tools)
            if (activeStreamingToolCall) { // This implies it's an OpenAI-style tool call
                toolCallWasHandledInThisStream = true; // Mark that a tool call is being handled in this stream event
                const toolCall = activeStreamingToolCall; // Clarity

                const assistantMessageWithToolCall = {
                    role: 'assistant',
                    content: accumulatedStreamedText.trim(), // Capture pre-tool call text
                    tool_calls: [toolCall]
                };

                const lastHistoryMessage = conversationHistory[conversationHistory.length - 1];
                if (!lastHistoryMessage ||
                    !(lastHistoryMessage.role === 'assistant' &&
                      lastHistoryMessage.tool_calls &&
                      lastHistoryMessage.tool_calls[0] &&
                      lastHistoryMessage.tool_calls[0].id === toolCall.id
                     )) {
                    conversationHistory.push(assistantMessageWithToolCall);
                }

                chrome.runtime.sendMessage({
                    action: 'executePromptPaulTool',
                    toolCall: {
                        id: toolCall.id,
                        name: toolCall.function.name,
                        arguments: toolCall.function.arguments
                    }
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("Chat: streamApiEnd - chrome.runtime.lastError in executePromptPaulTool callback:", chrome.runtime.lastError);
                        addMessage('System', `Error: ${chrome.runtime.lastError.message}`);
                        conversationHistory.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: toolCall.function.name,
                            content: `Error: ${chrome.runtime.lastError.message}`
                        });
                        userInput.disabled = false;
                        sendButton.disabled = false;
                        userInput.focus();
                        return;
                    }

                    if (response.error) {
                        console.error("Chat: streamApiEnd - response.error in executePromptPaulTool callback:", response.error);
                        addMessage('System', `❌ Error executing tool ${toolCall.function.name}: ${response.error}`);
                        conversationHistory.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: toolCall.function.name,
                            content: `Error: ${response.error}`
                        });
                        userInput.disabled = false;
                        sendButton.disabled = false;
                        userInput.focus();
                    } else {
                        addMessage('System', `✅ Tool ${toolCall.function.name} executed.`);
                        conversationHistory.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: toolCall.function.name,
                            content: JSON.stringify(response.result)
                        });
                        makeApiCall();
                    }
                });

                activeStreamingToolCall = null; // Reset immediately as it's being processed now
            } else {
                // Original path for non-tool-call streaming responses: re-enable inputs
                userInput.disabled = false;
                sendButton.disabled = false;
                userInput.focus();
            }
            // Tool call execution logic ENDS HERE


            // Finalize the original LLM message bubble based on whether a tool was called
            if (currentStreamingMessageDiv && currentStreamingContentElement && currentStreamingUniqueId) {
                const copyIconElem = document.getElementById(`copy-icon-${currentStreamingUniqueId}`);
                const copyFormattedIconElem = document.getElementById(`copy-formatted-icon-${currentStreamingUniqueId}`);

                if (toolCallWasHandledInThisStream) {
                    // The content of currentStreamingContentElement is "⚙️ Using tool: ..."
                    // It was set by streamApiToolCallChunk. We just need to attach copy listeners.
                    if (currentStreamingContentElement.innerHTML && copyIconElem && copyFormattedIconElem) { // Ensure content and icons exist
                        const toolMessageContent = currentStreamingContentElement.innerText;
                        attachCopyListeners(toolMessageContent, currentStreamingContentElement, copyIconElem, copyFormattedIconElem);
                    }
                    // History for assistant *requesting* the tool is already added within the toolCallWasHandledInThisStream block.
                } else {
                    // This is the original path: finalize with accumulatedStreamedText
                const finalContent = accumulatedStreamedText;
                if (finalContent.trim() || currentStreamingContentElement.innerHTML) { // only update if there is new content or it was previously populated
                    currentStreamingContentElement.innerHTML = marked.parse(finalContent);
                     if (copyIconElem && copyFormattedIconElem) {
                        attachCopyListeners(finalContent, currentStreamingContentElement, copyIconElem, copyFormattedIconElem);
                    }
                }

                    // Add to history if there's actual content and it wasn't a tool call
                    if (finalContent.trim()) {
                        const lastMessage = conversationHistory[conversationHistory.length - 1];
                        // Check if the last message is not the same text content from the same assistant
                        if (!lastMessage || !(lastMessage.role === 'assistant' && lastMessage.content === finalContent)) {
                             // Also ensure the last message wasn't an assistant message that just made a tool call (avoid double history)
                             let lastMessageWasToolCallRequest = false;
                             if(lastMessage && lastMessage.role === 'assistant' && lastMessage.tool_calls && lastMessage.tool_calls.length > 0){
                                 lastMessageWasToolCallRequest = true;
                             }
                             if(!lastMessageWasToolCallRequest){
                                conversationHistory.push({ role: 'assistant', content: finalContent });
                             }
                        }
                    }
                }
            }

            // Reset global streaming variables
            currentStreamingMessageDiv = null;
            currentStreamingContentElement = null;
            currentStreamingUniqueId = null;
            accumulatedStreamedText = "";
            // activeStreamingToolCall is already null if it was processed earlier in this function.
            // toolCallWasHandledInThisStream is a local var and will be gone.

        } else if (request.action === 'streamApiToolCallChunk') {
            if (currentStreamingMessageDiv && currentStreamingContentElement && request.toolCallChunk && request.toolCallChunk.length > 0) {
                const toolCall = request.toolCallChunk[0]; // Assuming the chunk contains the full tool call info as sent by background
                activeStreamingToolCall = toolCall; // Store the active tool call

                // Clear previous accumulated text from display
                // accumulatedStreamedText = ""; // Preserve accumulated text
                currentStreamingContentElement.innerHTML = ''; // Clear the display for "Using tool..."

                if (currentStreamingContentElement) {
                    currentStreamingContentElement.innerHTML = marked.parse(`⚙️ Using tool: **${toolCall.function.name}**`);
                }

                // Potentially, actual arguments could be streamed. For now, just the name.
                // If toolCall.function.arguments is a string of streamed arguments, append it:
                // currentStreamingContentElement.innerHTML += marked.parse("```\n" + toolCall.function.arguments + "\n```");

                chatArea.scrollTop = chatArea.scrollHeight;
            }
        } else if (request.action === 'streamApiAnthropicContentBlockStart') {
            if (currentStreamingContentElement && request.contentBlock) {
                const block = request.contentBlock;
                if (block.type === 'text') {
                    // If a text block starts, we can append its initial content if any.
                    // However, 'content_block_delta' for text is usually handled by 'streamApiResponseChunk'.
                    // This handler is more for non-text blocks or initial setup of a text block if needed.
                }
                 chatArea.scrollTop = chatArea.scrollHeight;
            }
        } else if (request.action === 'streamApiAnthropicMessageStop') {
            if (sendResponse) sendResponse({ success: true });
            // This handler is called when background.js receives a 'message_stop' event from an Anthropic stream,
            // indicating end of message. request.anthropicMessage contains complete final message object.
            if (currentStreamingMessageDiv && currentStreamingContentElement && currentStreamingUniqueId) {
                // The accumulatedStreamedText should reflect the text parts.
                // The full message from Anthropic (request.anthropicMessage) contains all blocks.
                // Finalize the display with accumulatedStreamedText (which should be text part)
                currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
                const copyIconElem = document.getElementById(`copy-icon-${currentStreamingUniqueId}`);
                const copyFormattedIconElem = document.getElementById(`copy-formatted-icon-${currentStreamingUniqueId}`);
                if (copyIconElem && copyFormattedIconElem) {
                    attachCopyListeners(accumulatedStreamedText, currentStreamingContentElement, copyIconElem, copyFormattedIconElem);
                }
            }

            // Add the complete Anthropic message object to history
            if (request.anthropicMessage) {
                conversationHistory.push(request.anthropicMessage); // This is the assistant's message object
            }

            // Reset UI
            userInput.disabled = false;
            sendButton.disabled = false;
            clearButton.textContent = 'Clear'; // Assuming 'Stop' was set at streamApiStart
            userInput.focus();

            // Reset streaming variables
            currentStreamingMessageDiv = null;
            currentStreamingContentElement = null;
            currentStreamingUniqueId = null;
            accumulatedStreamedText = "";
            activeStreamingToolCall = null;

            // Set a flag to prevent streamApiEnd from duplicating actions
            window.anthropicStreamFinalizedByStopEvent = true;
            return true;

        } else if (request.action === 'handleToolCallResponse') { // This handles OpenAI-style non-streaming tool calls
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            userInput.disabled = false;
            sendButton.disabled = false;
            const { responseMessage, prompt: originalPrompt } = request;
            if (sendResponse) sendResponse({ success: true });
            return true;

            // For context menu tool calls, history is usually fresh or should be reset
             if (conversationHistory.length === 0 && originalPrompt) {
                 addMessage('User', originalPrompt.split('\n')[0]);
                 conversationHistory.push({ role: 'user', content: originalPrompt });
            } // If continuing a chat, user prompt might already be in history.

            conversationHistory.push(responseMessage);

            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                const toolCall = responseMessage.tool_calls[0];
                    addMessage('System', `⚙️ Requesting execution for tool: **${toolCall.function.name}**...`);
                    chrome.runtime.sendMessage({
                        action: 'executePromptPaulTool',
                        toolCall: { id: toolCall.id, name: toolCall.function.name, arguments: toolCall.function.arguments }
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                             addMessage('System', `Error: ${chrome.runtime.lastError.message}`); return;
                        }
                        if (response.error) {
                            addMessage('System', `Error executing tool ${toolCall.function.name}: ${response.error}`);
                            conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: `Error: ${response.error}` });
                        } else {
                            addMessage('System', `✅ Tool ${toolCall.function.name} executed.`);
                            conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: JSON.stringify(response.result) });
                            makeApiCall();
                        }
                    });
            } else {
                 addMessage('System', "Error: Tool call instruction received without tool_calls.");
            }
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

    let conversationHistory = [];

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
     * @param {string} [tool_choice='none'] - The tool choice strategy ('none', 'auto', or specific tool name).
     * @returns {Promise<void>}
     */
    async function makeApiCallWithMedia(userMessage, mediaData, tool_choice = 'none') {
        try {
            const config = await getApiConfig();
            const allAvailableTools = await getTools();

            if (userMessage) {
                addMessage('User', userMessage);

                // Create message content with media
                const messageContent = [];

                // Add text content
                messageContent.push({
                    type: 'text',
                    text: userMessage
                });

                // Add media content for vision models (OpenAI format)
                if (mediaData.type === 'image') {
                    messageContent.push({
                        type: 'image_url',
                        image_url: {
                            url: `data:${mediaData.mimeType};base64,${mediaData.base64}`
                            // Note: "detail" parameter is optional for OpenAI, removed for compatibility
                        }
                    });
                }

                conversationHistory.push({
                    role: 'user',
                    content: messageContent
                });
            }

            const now = new Date();
            const dateTimeString = `Date: ${now.toLocaleDateString()} Time: ${now.toLocaleTimeString()}`;
            let systemPromptContent = dateTimeString;
            if (config.systemPrompt && config.systemPrompt.trim() !== '') {
                systemPromptContent += `\n\n${config.systemPrompt}`;
            }
            // Inject AVAILABLE SKILLS into system prompt
            const skillsResp = await new Promise(resolve => {
                chrome.runtime.sendMessage({ action: 'getSkills' }, (response) => {
                    if (chrome.runtime.lastError) resolve({ skills: [] });
                    else resolve(response || { skills: [] });
                });
            });
            const chatSkills = (skillsResp && skillsResp.skills) ? skillsResp.skills : [];
            if (chatSkills.length > 0) {
                const skillsDescription = chatSkills.map(s => `- ${s.name}: ${s.description}`).join('\n');
                systemPromptContent += `\n\nAVAILABLE SKILLS:\nYou have access to the following skills. Use the 'load_skill' tool to retrieve their instructions if needed:\n${skillsDescription}`;
            }

            const messagesForRequest = [{ role: 'system', content: systemPromptContent }, ...conversationHistory];

            // Use existing tool preparation logic
            const formattedTools = allAvailableTools.map(tool => {
                return {
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.parametersForLlm
                    }
                };
            }).filter(tool => tool !== null);

            let toolChoicePayload = {};
            if (tool_choice === 'none' || formattedTools.length === 0) {
                toolChoicePayload = {};
            } else if (tool_choice === 'auto') {
                toolChoicePayload = { tools: formattedTools, tool_choice: "auto" };
            }

            const requestBody = {
                model: config.modelName,
                messages: messagesForRequest,
                ...toolChoicePayload
            };

            // Check if this is an Anthropic endpoint and format accordingly
            const isAnthropicEndpoint = config.llmEndpoint.includes('api.anthropic.com');
            if (isAnthropicEndpoint && mediaData && mediaData.type === 'image') {
                // Anthropic Claude format for images
                const lastUserMessage = messagesForRequest[messagesForRequest.length - 1];
                if (lastUserMessage && lastUserMessage.role === 'user' && Array.isArray(lastUserMessage.content)) {
                    // Convert to Anthropic format
                    lastUserMessage.content = lastUserMessage.content.map(content => {
                        if (content.type === 'image_url') {
                            return {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: mediaData.mimeType,
                                    data: mediaData.base64
                                }
                            };
                        }
                        return content;
                    });
                }
            }

            const fetchHeaders = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + config.apiKey,
            };

            // Use non-streaming for media analysis to ensure proper handling
            userInput.disabled = true;
            sendButton.disabled = true;
            clearButton.textContent = 'Stop';
            currentAbortController = new AbortController();
            const signal = currentAbortController.signal;

            const apiResponse = await fetch(config.llmEndpoint, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify(requestBody),
                signal,
            });

            if (!apiResponse.ok) {
                if (apiResponse.status === 429) {
                     throw new Error('API Rate Limit Exceeded. Please check your provider\'s plan or try again later.');
                }
                const errorText = await apiResponse.text();
                let errorDetail = errorText;
                try {
                    const errorJson = JSON.parse(errorText);
                    errorDetail = errorJson.error ? errorJson.error.message : errorText;
                } catch (e) { /* ignore */ }
                throw new Error(`API request failed: ${apiResponse.status} ${apiResponse.statusText} - ${errorDetail}`);
            }

            const responseData = await apiResponse.json();
            if (!responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
                throw new Error('Invalid response format from API (no choices or message)');
            }

            const responseMessage = responseData.choices[0].message;
            conversationHistory.push(responseMessage);

            if (responseMessage.content) {
                addMessage('LLM', responseMessage.content);
            }

            userInput.disabled = false;
            sendButton.disabled = false;
            clearButton.textContent = 'Clear';
            currentAbortController = null;
            userInput.focus();

        } catch (error) {
            if (error.name === 'AbortError') {
                addMessage('System', 'Response stopped');
            } else {
                console.error("makeApiCallWithMedia Error:", error);
                addMessage('System', 'Error: ' + error.message);
            }
            userInput.disabled = false;
            sendButton.disabled = false;
            clearButton.textContent = 'Clear';
            currentAbortController = null;
            userInput.focus();
        }
    }

    // Removed handleSummarizeTabButtonClick as its logic is now consolidated
    // in the event listener at lines 878-905.
    // Removed handleExplainButtonClick as its logic is now consolidated
    // in the event listener for explainBtn (lines 24-40 approx).
    // The new listener directly sends 'getExplainContent'.
    function sendMessage() {
        activeStreamingToolCall = null; // Reset active tool call
        const message = userInput.value;
        if (message.trim() && !userInput.disabled) {
            if (currentMediaData) {
                makeApiCallWithMedia(message, currentMediaData);
                currentMediaData = null; // Clear media after use
            } else {
                makeApiCall(message);
            }
            userInput.value = '';
        }
    }

    async function getTools() {
        const { promptPaulTools: definedTools = [] } = await new Promise((resolve) => {
            chrome.storage.local.get(['promptPaulTools'], resolve);
        });

        const processedTools = [];

        for (const tool of definedTools) {
            let parametersForLlm = {};
            let source = 'manual'; // Default source

            if (tool.parameters) {
                try {
                    parametersForLlm = JSON.parse(tool.parameters);
                } catch (e) {
                    console.error(`Chat: getTools - Error parsing parameters for manual tool ${tool.name}:`, e);
                    addMessage('System', `Error: Invalid JSON Schema for tool '${tool.name}'. Tool will be excluded or have empty schema.`);
                    parametersForLlm = {}; // Keep it an empty object if parsing fails
                }
            }

            processedTools.push({
                ...tool, // Spread original tool properties
                parametersForLlm: parametersForLlm, // Add the processed parameters
                source: source // Add the source for debugging/info
            });
        }

        // Inject load_skill tool if skills are available
        const { skills = [] } = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: 'getSkills' }, resolve);
        });

        if (skills.length > 0) {
            processedTools.push({
                name: 'load_skill',
                description: 'Loads the instructions for a specific skill. Use this when the user asks for a task that matches one of the Available Skills in your system prompt.',
                parametersForLlm: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'The name of the skill to load' }
                    },
                    required: ['name']
                },
                source: 'built-in'
            });
        }

        return processedTools;
    }

    /**
     * Makes an API call to the LLM endpoint.
     * @param {string|null} [userMessage=null] - The user's message/prompt.
     * @param {string} [tool_choice='none'] - The tool choice strategy ('none', 'auto', or specific tool name).
     * @returns {Promise<void>}
     */
    async function makeApiCall(userMessage = null, tool_choice = 'none') { // Added tool_choice, default to 'none'
        try {
            const config = await getApiConfig();
            const allAvailableTools = await getTools();

            if (userMessage) {
                addMessage('User', userMessage);

                // Check if we have media data to include
                if (currentMediaData && currentMediaData.type === 'image') {
                    const messageContent = [
                        {
                            type: 'text',
                            text: userMessage
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${currentMediaData.mimeType};base64,${currentMediaData.base64}`
                            }
                        }
                    ];
                    conversationHistory.push({ role: 'user', content: messageContent });
                } else {
                    conversationHistory.push({ role: 'user', content: userMessage });
                }
            }

            const now = new Date();
            const dateTimeString = `Date: ${now.toLocaleDateString()} Time: ${now.toLocaleTimeString()}`;
            let systemPromptContent = dateTimeString;
            if (config.systemPrompt && config.systemPrompt.trim() !== '') {
                systemPromptContent += `\n\n${config.systemPrompt}`;
            }
            // Inject AVAILABLE SKILLS into system prompt
            const skillsRespMain = await new Promise(resolve => {
                chrome.runtime.sendMessage({ action: 'getSkills' }, (response) => {
                    if (chrome.runtime.lastError) resolve({ skills: [] });
                    else resolve(response || { skills: [] });
                });
            });
            const chatSkillsMain = (skillsRespMain && skillsRespMain.skills) ? skillsRespMain.skills : [];
            if (chatSkillsMain.length > 0) {
                const skillsDescription = chatSkillsMain.map(s => `- ${s.name}: ${s.description}`).join('\n');
                systemPromptContent += `\n\nAVAILABLE SKILLS:\nYou have access to the following skills. Use the 'load_skill' tool to retrieve their instructions if needed:\n${skillsDescription}`;
            }

            const messagesForRequest = [{ role: 'system', content: systemPromptContent }, ...conversationHistory];

            // START SHARED API REQUEST PREP LOGIC
            // Now uses parametersForLlm from getTools()
            const formattedTools = allAvailableTools.map(tool => {
                // parametersForLlm should already be a valid JSON object or an empty object {}
                // as processed by getTools()
                return {
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.parametersForLlm // Directly use the pre-processed parameters
                    }
                };
            }).filter(tool => tool !== null); // filter might not be strictly necessary if getTools ensures valid entries or empty schemas

            let toolChoicePayload = {};
            const current_tool_choice_option = tool_choice; // Parameter to this function

            if (current_tool_choice_option === 'none' || formattedTools.length === 0) {
                toolChoicePayload = {};
                if (formattedTools.length === 0 && current_tool_choice_option !== 'none') {
                } else {
                }
            } else if (current_tool_choice_option === 'auto') {
                toolChoicePayload = { tools: formattedTools, tool_choice: "auto" };
            } else if (typeof current_tool_choice_option === 'string') { // Specific tool name
                const specificTool = formattedTools.find(t => t.function.name === current_tool_choice_option);
                if (specificTool) {
                    toolChoicePayload = { tools: [specificTool], tool_choice: { type: "function", function: { name: current_tool_choice_option } } };
                } else {
                    addMessage('System', `Warning: Specified tool "${current_tool_choice_option}" not found. No tools will be sent.`); // Context-specific error
                    toolChoicePayload = {};
                }
            }
            // END SHARED API REQUEST PREP LOGIC

            const requestBody = {
                model: config.modelName,
                messages: messagesForRequest,
                ...toolChoicePayload
            };

            const fetchHeaders = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + config.apiKey,
            };

            // --- Handle media data formatting for different providers ---
            const isAnthropicEndpoint = config.llmEndpoint.includes('api.anthropic.com');
            const isOpenAIEndpoint = config.llmEndpoint.includes('api.openai.com') || config.llmEndpoint.includes('openai');

            // Convert image format for Anthropic if needed
            if (isAnthropicEndpoint && currentMediaData && currentMediaData.type === 'image') {
                const lastUserMessage = messagesForRequest[messagesForRequest.length - 1];
                if (lastUserMessage && lastUserMessage.role === 'user' && Array.isArray(lastUserMessage.content)) {
                    lastUserMessage.content = lastUserMessage.content.map(content => {
                        if (content.type === 'image_url') {
                            return {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: currentMediaData.mimeType,
                                    data: currentMediaData.base64
                                }
                            };
                        }
                        return content;
                    });
                }
            }

            // Apply tool choice
            Object.assign(requestBody, toolChoicePayload);



            const { enableStreaming } = await new Promise(resolve => chrome.storage.sync.get({ enableStreaming: false }, resolve));

            const hasToolMessage = Array.isArray(conversationHistory) && conversationHistory.some(msg => msg.role === 'tool');
            let effectiveEnableStreaming = enableStreaming;
            // For now, keeping the existing logic for disabling streaming if a 'tool' role message is in history.
            if (hasToolMessage && enableStreaming) {
                effectiveEnableStreaming = false;
            }


            if (effectiveEnableStreaming) { // This includes streaming
                requestBody.stream = true;
                userInput.disabled = true;
                sendButton.disabled = true;
                clearButton.textContent = 'Stop';

                const { messageDiv, contentElement, uniqueIdString } = addMessage('LLM', '');
                currentStreamingMessageDiv = messageDiv;
                currentStreamingContentElement = contentElement;
                currentStreamingUniqueId = uniqueIdString;
                accumulatedStreamedText = ""; // Reset for this new stream

                currentAbortController = new AbortController();
                const signal = currentAbortController.signal;

                // Show loading state
                const loaderId = loadingManager.showLoading('#chat-area', 'Processing your request...');
                loadingManager.showConnectionStatus('#chat-area', 'connecting');

                const apiResponse = await fetch(config.llmEndpoint, {
                    method: 'POST',
                    headers: fetchHeaders, // Use potentially modified headers
                    body: JSON.stringify(requestBody),
                    signal,
                });

                // Hide loading state
                loadingManager.hideLoading(loaderId);
                loadingManager.showConnectionStatus('#chat-area', 'connected');

                if (!apiResponse.ok) {
                    if (apiResponse.status === 429) {
                         const error = new Error('API Rate Limit Exceeded. Please check your provider\'s plan or try again later.');
                         loadingManager.showToast('API Rate Limit Exceeded', 'error');
                         loadingManager.showConnectionStatus('#chat-area', 'disconnected');
                         throw error;
                    }
                    const errorText = await apiResponse.text();
                    let errorDetail = errorText;
                    try { const errorJson = JSON.parse(errorText); errorDetail = errorJson.error ? errorJson.error.message : errorText;} catch (e) { /* ignore */ }
                    const error = new Error(`API request failed: ${apiResponse.status} ${apiResponse.statusText} - ${errorDetail}`);
                    loadingManager.showToast(`API Error: ${apiResponse.status} ${apiResponse.statusText}`, 'error');
                    loadingManager.showConnectionStatus('#chat-area', 'disconnected');
                    throw error;
                }

                const reader = apiResponse.body.getReader();
                const decoder = new TextDecoder();
                let sseBuffer = ""; // Buffer for incomplete SSE lines

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        // Final attachment of copy listeners for the fully accumulated message
                        if (currentStreamingContentElement && currentStreamingUniqueId) {
                             const copyIconElem = document.getElementById(`copy-icon-${currentStreamingUniqueId}`);
                             const copyFormattedIconElem = document.getElementById(`copy-formatted-icon-${currentStreamingUniqueId}`);
                             if (copyIconElem && copyFormattedIconElem) { // Ensure icons exist
                                attachCopyListeners(accumulatedStreamedText, currentStreamingContentElement, copyIconElem, copyFormattedIconElem);
                             }
                        }
                        // Add the fully accumulated message to history
                        if (accumulatedStreamedText.trim()) {
                           const lastMessage = conversationHistory[conversationHistory.length - 1];
                           // Avoid adding if it's effectively a duplicate of the last message
                           if (!lastMessage || !(lastMessage.role === 'assistant' && lastMessage.content === accumulatedStreamedText)) {
                               conversationHistory.push({ role: 'assistant', content: accumulatedStreamedText });
                           }
                        }
                        // Reset UI and state
                        userInput.disabled = false;
                        sendButton.disabled = false;
                        clearButton.textContent = 'Clear';
                        currentStreamingMessageDiv = null; currentStreamingContentElement = null; currentStreamingUniqueId = null; accumulatedStreamedText = "";
                        userInput.focus();
                        break;
                    }
                    sseBuffer += decoder.decode(value, { stream: true });
                    let eolIndex;
                    // Process all complete lines in the buffer
                    while ((eolIndex = sseBuffer.indexOf('\n')) >= 0) {
                        const line = sseBuffer.substring(0, eolIndex).trim();
                        sseBuffer = sseBuffer.substring(eolIndex + 1);

                        if (line.startsWith('data:')) {
                            let jsonData = line.substring(5).trim();
                            if (jsonData.startsWith('data:')) { // Handle potential double prefix
                                jsonData = jsonData.substring(5).trim();
                            }
                            if (jsonData === '[DONE]') { // OpenAI specific end signal
                                continue;
                            }
                            if (jsonData) {
                                try {
                                    const parsed = JSON.parse(jsonData);
                                    if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                                        accumulatedStreamedText += parsed.choices[0].delta.content;
                                        if(currentStreamingContentElement) {
                                            currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
                                        }
                                        chatArea.scrollTop = chatArea.scrollHeight;
                                    }
                                } catch (e) {
                                    // Log benignly, as some chunks might not be full JSON objects if stream is interrupted or malformed.
                                    console.warn("SSE JSON Parse Error in makeApiCall (chat.js):", e, "Problematic JSON string:", jsonData);
                                }
                            }
                        }
                    }
                }
            } else { // Non-streaming for chat input
                userInput.disabled = true;
                sendButton.disabled = true;
                clearButton.textContent = 'Stop';
                currentAbortController = new AbortController();
                const signal = currentAbortController.signal;

                const apiResponse = await fetch(config.llmEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey },
                    body: JSON.stringify(requestBody),
                    signal,
                });

                if (!apiResponse.ok) {
                    if (apiResponse.status === 429) {
                         throw new Error('API Rate Limit Exceeded. Please check your provider\'s plan or try again later.');
                    }
                    const errorText = await apiResponse.text();
                    let errorDetail = errorText;
                     try { const errorJson = JSON.parse(errorText); errorDetail = errorJson.error ? errorJson.error.message : errorText; } catch (e) { /* ignore */ }
                    throw new Error( `API request failed: ${apiResponse.status} ${apiResponse.statusText} - ${errorDetail}`);
                }
                const responseData = await apiResponse.json();
                if (!responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
                    throw new Error('Invalid response format from API (no choices or message)');
                }
                const responseMessage = responseData.choices[0].message;
                conversationHistory.push(responseMessage);

                if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                    const toolCall = responseMessage.tool_calls[0];
                        addMessage('System', `⚙️ Requesting execution for tool: **${toolCall.function.name}**...`);
                        const toolCallForLog = responseMessage.tool_calls[0]; // This was defined before but not used. Keeping it in case it's for logging.
                        chrome.runtime.sendMessage({
                            action: 'executePromptPaulTool',
                            toolCall: { id: toolCall.id, name: toolCall.function.name, arguments: toolCall.function.arguments }
                        }, (response) => {
                             if (chrome.runtime.lastError) {
                                 addMessage('System', `Error: ${chrome.runtime.lastError.message}`);
                                 userInput.disabled = false;
                                 sendButton.disabled = false;
                                 clearButton.textContent = 'Clear';
                                 currentAbortController = null;
                                 userInput.focus();
                                 return;
                             }
                             if (response.error) {
                                addMessage('System', `Error executing tool ${toolCall.function.name}: ${response.error}`);
                                conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: `Error: ${response.error}` });
                                userInput.disabled = false;
                                sendButton.disabled = false;
                                clearButton.textContent = 'Clear';
                                currentAbortController = null;
                                userInput.focus();
                             } else {
                                addMessage('System', `✅ Tool ${toolCall.function.name} executed.`);
                                conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: typeof response.result === 'string' ? response.result : JSON.stringify(response.result || response) });
                                makeApiCall();
                             }
                        });
                } else if (responseMessage.content) {
                    addMessage('LLM', responseMessage.content);
                    userInput.disabled = false;
                    sendButton.disabled = false;
                    clearButton.textContent = 'Clear';
                    currentAbortController = null;
                } else {
                     addMessage('System', "Received an empty or unexpected response from LLM.");
                    userInput.disabled = false;
                    sendButton.disabled = false;
                    clearButton.textContent = 'Clear';
                    currentAbortController = null;
                }
            }
        } catch (error) {
            loadingManager.hideLoading('#chat-area');
            loadingManager.showConnectionStatus('#chat-area', 'disconnected');

            if (error.name === 'AbortError') {
                addMessage('System', 'Response stopped');
                loadingManager.showToast('Request stopped by user', 'warning');
            } else {
                console.error("makeApiCall Error:", error);
                addMessage('System', 'Error: ' + error.message);

                // Show user-friendly error with retry option
                loadingManager.showError('#chat-area', error, {
                    title: 'API Request Failed',
                    retry: () => {
                        // Retry the same request
                        makeApiCall(userMessage, tool_choice);
                    }
                });
            }
            userInput.disabled = false;
            sendButton.disabled = false;
            clearButton.textContent = 'Clear';
            currentAbortController = null;
            userInput.focus();
        }
    }

    submitBtn.addEventListener('click', async () => {
        activeStreamingToolCall = null;
        const instruction = instructionInput.value;
        if (!instruction.trim()) {
            loadingManager.showToast('Please enter an instruction', 'warning');
            return;
        }
        try {
            const config = await getApiConfig();

            // Build prompt based on available content (text or media)
            let prompt;
            let contentSummary = '';

            if (currentMediaData && currentMediaData.base64) {
                // Have media loaded - include compatibility mode info
                const mediaInfo = `[${currentMediaData.type.toUpperCase()} loaded: ${currentMediaData.mimeType}, URL: ${currentMediaData.url || 'embedded'}]`;
                contentSummary = mediaInfo;
                prompt = instruction + '\n\n' + contentSummary;

                // Add user message with media context
                addMessage('User', `${instruction}\n\n[${contentSummary}]`);

                // Use media API call
                const allAvailableTools = await getTools();
                const formattedTools = allAvailableTools.map(tool => {
                    return {
                        type: 'function',
                        function: {
                            name: tool.name,
                            description: tool.description,
                            parameters: tool.parametersForLlm
                        }
                    };
                }).filter(tool => tool !== null);

                let toolChoicePayload = {};
                if (formattedTools.length > 0) {
                    toolChoicePayload = { tools: formattedTools, tool_choice: "auto" };
                }

                // Build system prompt
                const now = new Date();
                const dateTimeString = `Date: ${now.toLocaleDateString()} Time: ${now.toLocaleTimeString()}`;
                let systemPromptContent = dateTimeString;
                if (config.systemPrompt && config.systemPrompt.trim() !== '') {
                    systemPromptContent += `\n\n${config.systemPrompt}`;
                }

                // Inject AVAILABLE SKILLS into system prompt
                const skillsResp = await new Promise(resolve => {
                    chrome.runtime.sendMessage({ action: 'getSkills' }, (response) => {
                        if (chrome.runtime.lastError) resolve({ skills: [] });
                        else resolve(response || { skills: [] });
                    });
                });
                const chatSkills = (skillsResp && skillsResp.skills) ? skillsResp.skills : [];
                if (chatSkills.length > 0) {
                    const skillsDescription = chatSkills.map(s => `- ${s.name}: ${s.description}`).join('\n');
                    systemPromptContent += `\n\nAVAILABLE SKILLS:\nYou have access to the following skills. Use the 'load_skill' tool to retrieve their instructions if needed:\n${skillsDescription}`;
                }

                // Prepare messages
                let messageContent = [{ type: 'text', text: prompt }];

                // For images, attach as multimodal content
                if (currentMediaData.type === 'image' && currentMediaData.base64) {
                    messageContent.push({
                        type: 'image_url',
                        image_url: {
                            url: `data:${currentMediaData.mimeType};base64,${currentMediaData.base64}`
                        }
                    });
                }

                const messagesForRequest = [{ role: 'system', content: systemPromptContent }, { role: 'user', content: messageContent }];

                const requestBody = {
                    model: config.modelName,
                    messages: messagesForRequest,
                    ...toolChoicePayload
                };

                // Convert for Anthropic if needed
                const isAnthropicEndpoint = config.llmEndpoint.includes('api.anthropic.com');
                if (isAnthropicEndpoint && currentMediaData.type === 'image' && currentMediaData.base64) {
                    const lastUserMessage = messagesForRequest[messagesForRequest.length - 1];
                    if (lastUserMessage && lastUserMessage.role === 'user' && Array.isArray(lastUserMessage.content)) {
                        lastUserMessage.content = lastUserMessage.content.map(content => {
                            if (content.type === 'image_url') {
                                return {
                                    type: 'image',
                                    source: {
                                        type: 'base64',
                                        media_type: currentMediaData.mimeType,
                                        data: currentMediaData.base64
                                    }
                                };
                            }
                            return content;
                        });
                    }
                }

                const { enableStreaming } = await new Promise(resolve => chrome.storage.sync.get({ enableStreaming: false }, resolve));
                let effectiveEnableStreaming = enableStreaming;
                const hasToolMessage = Array.isArray(conversationHistory) && conversationHistory.some(msg => msg.role === 'tool');

                if (hasToolMessage && enableStreaming) {
                    effectiveEnableStreaming = false;
                }

                // Disable streaming for media in compatibility mode
                if (currentMediaData && !enableStreaming) {
                    effectiveEnableStreaming = false;
                }

                if (effectiveEnableStreaming) {
                    requestBody.stream = true;
                    oneoffInstructionArea.style.display = 'none';
                    chatMainArea.style.display = 'block';
                    userInput.disabled = true;
                    sendButton.disabled = true;
                    clearButton.textContent = 'Stop';

                    const { messageDiv, contentElement, uniqueIdString } = addMessage('LLM', '');
                    currentStreamingMessageDiv = messageDiv;
                    currentStreamingContentElement = contentElement;
                    currentStreamingUniqueId = uniqueIdString;
                    accumulatedStreamedText = "";

                    currentAbortController = new AbortController();
                    const signal = currentAbortController.signal;

                    const apiResponse = await fetch(config.llmEndpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey },
                        body: JSON.stringify(requestBody),
                        signal,
                    });
                    if (!apiResponse.ok) {
                        if (apiResponse.status === 429) {
                             throw new Error('API Rate Limit Exceeded. Please check your provider\'s plan or try again later.');
                        }
                        const errorText = await apiResponse.text();
                        let errorDetail = errorText;
                        try { const errorJson = JSON.parse(errorText); errorDetail = errorJson.error ? errorJson.error.message : errorText;} catch (e) { /* ignore */ }
                        throw new Error(`API request failed: ${apiResponse.status} ${apiResponse.statusText} - ${errorDetail}`);
                    }
                    const reader = apiResponse.body.getReader();
                    const decoder = new TextDecoder();
                    let sseBuffer = "";
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            if (currentStreamingContentElement && currentStreamingUniqueId) {
                               const copyIconElem = document.getElementById(`copy-icon-${currentStreamingUniqueId}`);
                               const copyFormattedIconElem = document.getElementById(`copy-formatted-icon-${currentStreamingUniqueId}`);
                               if (copyIconElem && copyFormattedIconElem) {
                                 attachCopyListeners(accumulatedStreamedText, currentStreamingContentElement, copyIconElem, copyFormattedIconElem);
                                }
                            }
                            conversationHistory.push({ role: 'assistant', content: accumulatedStreamedText });
                            currentStreamingMessageDiv = null; currentStreamingContentElement = null; currentStreamingUniqueId = null; accumulatedStreamedText = "";
                            userInput.disabled = false; sendButton.disabled = false;
                            clearButton.textContent = 'Clear';
                            instructionInput.value = ''; selectedTextDiv.textContent = ''; selectedText = null;
                            currentMediaData = null;
                            oneoffInstructionArea.style.display = 'none';
                            chatMainArea.style.display = 'block';
                            userInput.focus();
                            break;
                        }
                        sseBuffer += decoder.decode(value, { stream: true });
                        let eolIndex;
                        while ((eolIndex = sseBuffer.indexOf('\n')) >= 0) {
                            const line = sseBuffer.substring(0, eolIndex).trim();
                            sseBuffer = sseBuffer.substring(eolIndex + 1);
                            if (line.startsWith('data:')) {
                                let jsonData = line.substring(5).trim();
                                if (jsonData.startsWith('data:')) { jsonData = jsonData.substring(5).trim(); }
                                if (jsonData === '[DONE]') continue;
                                if (jsonData) {
                                    try {
                                        const parsed = JSON.parse(jsonData);
                                        if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                                            accumulatedStreamedText += parsed.choices[0].delta.content;
                                            if(currentStreamingContentElement) {
                                                currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
                                            }
                                            chatArea.scrollTop = chatArea.scrollHeight;
                                        }
                                    } catch (e) { console.warn("SSE JSON Parse Error (one-off submit):", e, jsonData); }
                                }
                            }
                        }
                    }
                } else {
                    userInput.disabled = true;
                    sendButton.disabled = true;
                    clearButton.textContent = 'Stop';
                    currentAbortController = new AbortController();
                    const signal = currentAbortController.signal;

                    const apiResponse = await fetch(config.llmEndpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey },
                        body: JSON.stringify(requestBody),
                        signal,
                    });
                    if (!apiResponse.ok) {
                        if (apiResponse.status === 429) {
                             throw new Error('API Rate Limit Exceeded. Please check your provider\'s plan or try again later.');
                        }
                        const errorText = await apiResponse.text();
                        let errorDetail = errorText;
                        try { const errorJson = JSON.parse(errorText); errorDetail = errorJson.error ? errorJson.error.message : errorText; } catch (e) { /* ignore */ }
                        throw new Error(`API request failed: ${apiResponse.status} ${apiResponse.statusText} - ${errorDetail}`);
                    }
                    const responseData = await apiResponse.json();
                    if (!responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
                        throw new Error('Invalid response format from API');
                    }
                    const responseMessage = responseData.choices[0].message;
                    conversationHistory.push(responseMessage);

                    if (responseMessage.content) {
                        addMessage('LLM', responseMessage.content);
                    }

                    instructionInput.value = '';
                    selectedTextDiv.textContent = '';
                    selectedText = null;
                    currentMediaData = null;
                    oneoffInstructionArea.style.display = 'none';
                    chatMainArea.style.display = 'block';

                    userInput.disabled = false;
                    sendButton.disabled = false;
                    clearButton.textContent = 'Clear';
                    currentAbortController = null;
                }
            } else if (selectedText && selectedText.trim()) {
                // Text-only one-off - use shared makeApiCall
                prompt = instruction + '\n\n' + selectedText;
                // Show chat area and hide one-off instruction area before adding message
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

    // --- Summarize Tab Button Functionality ---
    if (summarizeTabButton) {
        summarizeTabButton.addEventListener('click', () => {
            executePreset('Requesting tab content for summary...', 'Tab content received, summarizing...', 'Summarize the following text:');
        });
    }

    // --- Phase 3: Summary Presets ---
    if (tldrPresetButton) {
        tldrPresetButton.addEventListener('click', () => {
            executePreset('Generating TL;DR...', 'Content received, generating TL;DR...', 'Provide a 1-sentence TL;DR of the following content:');
        });
    }

    if (techPresetButton) {
        techPresetButton.addEventListener('click', () => {
            executePreset('Generating Technical Analysis...', 'Content received, analyzing technically...', 'Analyze the following content from a technical perspective. Focus on architecture, code, and implementation details:');
        });
    }

    if (execPresetButton) {
        execPresetButton.addEventListener('click', () => {
            executePreset('Generating Executive Summary...', 'Content received, generating report...', 'Provide an executive summary of the following content. Focus on high-level takeaways, business impact, and action items:');
        });
    }

    // --- Explain Tab Button Functionality --- (duplicate declaration removed)

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
