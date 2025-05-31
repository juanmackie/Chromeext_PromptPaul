document.addEventListener('DOMContentLoaded', () => {
    console.log("DOMContentLoaded event fired in chat.js");
    const chatArea = document.getElementById('chat-area');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const selectedTextDiv = document.getElementById('selectedText');
    const instructionInput = document.getElementById('instructionInput');
    const submitBtn = document.getElementById('submitBtn');
    const chatMainArea = document.getElementById('chat-main-area');
    const oneoffInstructionArea = document.getElementById('oneoff-instruction-area');

    // Global state for streaming
    let currentLlmMessageDiv = null;
    let currentLlmRawMarkdown = '';
    let currentLlmMessageId = null;

    // Request initialization data from background script for this tab context
    console.log("Chat: Requesting init data for my tab.");
    chrome.runtime.sendMessage({ action: 'requestInitDataForMyTab' });

// --- Dark Theme Toggle Logic ---
const darkThemeToggle = document.getElementById('darkThemeToggle');
function applyDarkTheme(isDark) {
    if (isDark) {
        document.body.classList.add('dark-theme');
    } else {
        document.body.classList.remove('dark-theme');
    }
}
// Load darkTheme from storage and set toggle/class
chrome.storage.sync.get({ darkTheme: false }, (result) => {
    if (darkThemeToggle) {
        darkThemeToggle.checked = !!result.darkTheme;
    }
    applyDarkTheme(!!result.darkTheme);
});
// Toggle event: update storage and class
if (darkThemeToggle) {
    darkThemeToggle.addEventListener('change', (e) => {
        const isDark = darkThemeToggle.checked;
        chrome.storage.sync.set({ darkTheme: isDark });
        applyDarkTheme(isDark);
    });
}
// Listen for storage changes to sync theme and invalidate API config cache
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.darkTheme) {
        const isDark = changes.darkTheme.newValue;
        if (darkThemeToggle) darkThemeToggle.checked = !!isDark;
        applyDarkTheme(!!isDark);
    }
    if (area === 'local' && (changes.profiles || changes.lastSelectedProfileId)) {
        console.log("Chat: API config changed in storage, invalidating cache.");
        cachedApiConfig = null;
    }
});

let selectedText = null;
// let tabId = null; // Removed duplicate declaration
    let currentTabId = null; // Renamed from tabId for clarity and new purpose
    let cachedApiConfig = null; // Cache for API configuration

    // --- Helper functions for Copy Icons and Toast ---
    function getCopyIconsHTML(baseId) {
        return ` <img id="copy-icon-${baseId}" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgMjQgMjQiPgogIDxnIGZpbGw9Im5vbmUiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIHN0cm9rZS13aWR0aD0iMiI+CiAgICA8cGF0aCBkPSJNOCAxMGEyIDIgMCAwIDEgMi0yaDhhMiAyIDAgMCAxIDIgMnY4YTIgMiAwIDAgMS0yIDJoLThhMiAyIDAgMCAxLTItMnoiLz4KICAgIDxwYXRoIGQ9Ik0xNiA4VjZhMiAyIDAgMCAwLTItMkg2YTIgMiAwIDAgMC0yIDJ2OGEyIDIgMCAwIDAgMiAyaDIiLz4KICA8L2c+Cjwvc3ZnPg==" alt="Copy" style="cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;">` +
               ` <img id="copy-formatted-icon-${baseId}" src="data:image/png;base64,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" alt="Copy Formatted" style="cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;">`;
    }

    function attachCopyIconListeners(baseId, rawMessageContent) {
        const copyIcon = document.getElementById(`copy-icon-${baseId}`);
        const copyFormattedIcon = document.getElementById(`copy-formatted-icon-${baseId}`);
        const messageDiv = document.getElementById(baseId);

        if (copyIcon) {
            copyIcon.onclick = function() { // Use onclick to ensure it replaces old listeners if any
                navigator.clipboard.writeText(rawMessageContent);
                showToast('Copied markdown text to clipboard');
            };
        }
        if (copyFormattedIcon && messageDiv) {
            copyFormattedIcon.onclick = function() { // Use onclick
                const tempDiv = document.createElement('div');
                const contentToCopy = messageDiv.cloneNode(true);
                // Remove copy icons from the cloned content before copying
                contentToCopy.querySelectorAll('img[id^="copy-icon-"], img[id^="copy-formatted-icon-"]').forEach(img => img.remove());
                tempDiv.innerHTML = contentToCopy.innerHTML;

                navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': new Blob([tempDiv.innerHTML], { type: 'text/html' }),
                        'text/plain': new Blob([rawMessageContent], { type: 'text/plain' })
                    })
                ]).then(() => {
                    showToast('Copied formatted text to clipboard');
                }).catch(err => {
                    // Fallback to plain text if rich copy fails
                    navigator.clipboard.writeText(rawMessageContent);
                    showToast('Copied as plain text; rich copy failed.');
                    console.error('Failed to copy rich text: ', err);
                });
            };
        }
    }

    function showToast(message) {
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            // Append to chat-area or body, ensure it's styled to overlay correctly
            document.getElementById('chat-area').appendChild(toastContainer);
        }
        const toast = document.createElement('div');
        toast.classList.add('toast');
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => {
                toast.remove();
                if (toastContainer.children.length === 0) {
                    toastContainer.remove(); // Clean up container if empty
                }
            }, 500);
        }, 2500);
    }

    // --- Loading Indicator Logic ---
    const LOADING_INDICATOR_ID = 'loading-indicator-element';

    /**
     * Displays or hides a loading indicator message at the bottom of the chat area.
     * @param {boolean} show - True to show the indicator, false to hide it.
     * @param {string} [message='Thinking...'] - The message to display in the indicator.
     */
    function showLoadingIndicator(show, message = 'Thinking...') {
        const chatArea = document.getElementById('chat-area');
        let indicator = document.getElementById(LOADING_INDICATOR_ID);

        if (show) {
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = LOADING_INDICATOR_ID;
                indicator.classList.add('loading-indicator'); // Use the class for styling
                chatArea.appendChild(indicator);
            }
            indicator.textContent = message;
            indicator.style.display = 'block'; // Ensure it's visible
            chatArea.scrollTop = chatArea.scrollHeight; // Scroll to bottom
        } else {
            if (indicator) {
                indicator.style.display = 'none'; // Hide it
                // Optionally, remove it if you prefer:
                // indicator.remove();
            }
        }
    }


    /**
     * Retrieves API configuration for chat UI operations.
     * Uses an in-memory cache for the current session to speed up access.
     * Cache is invalidated if settings change in `chrome.storage.local`.
     */
    async function getApiConfig() {
        if (cachedApiConfig) {
            console.log("Chat: Returning cached API configuration", cachedApiConfig);
            return Promise.resolve(cachedApiConfig);
        }
        console.log("Chat: Getting API configuration from local storage (cache miss)");
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
                console.log("Chat: Storage get result:", result);
                const profiles = result.profiles || [];
                const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
                
                console.log("Chat: Profiles:", profiles);
                console.log("Chat: Last selected profile ID:", lastSelectedProfileId);
                
                const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId);
                
                if (selectedProfile && selectedProfile.llmEndpoint && selectedProfile.apiKey && selectedProfile.modelName) {
                    console.log("Chat: Using configuration from profile:", selectedProfile.name || selectedProfile.id);
                    cachedApiConfig = selectedProfile; // Cache it
                    resolve(cachedApiConfig);
                } else {
                    console.warn("Chat: Selected profile is missing or incomplete, trying fallback to default.");
                    // Try to fall back to default profile
                    const defaultProfile = profiles.find(p => p.id === 'default');
                    if (defaultProfile && defaultProfile.llmEndpoint && defaultProfile.apiKey && defaultProfile.modelName) {
                        console.log("Chat: Using default profile as fallback");
                        cachedApiConfig = defaultProfile; // Cache it
                        resolve(cachedApiConfig);
                    } else {
                        console.error("Chat: No valid configuration found (selected or default).");
                        cachedApiConfig = null; // Ensure cache is null on failure
                        reject(new Error('Configuration is incomplete. Please set up the API endpoint, API key, and model name in the options page.'));
                    }
                }
            });
        });
    }


    // Listen for messages from the background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        /**
         * Handles the 'initChat' message from the background script.
         * This message is sent when a tab is activated or a context menu is clicked,
         * signaling that the chat UI should initialize or re-initialize for the specified tab.
         * It sets the currentTabId, clears any existing chat messages, resets the
         * conversationHistory array, and then loads the persisted history for the given tab.
         */
        if (request.action === 'initChat') {
            console.log("Chat: Received initChat for tabId:", request.tabId);
            currentTabId = request.tabId; // Set currentTabId
            chatArea.innerHTML = ''; // Clear chat area before loading
            conversationHistory = []; // Reset history before loading

            // Reset streaming state variables as the chat is being re-initialized
            currentLlmMessageDiv = null;
            currentLlmRawMarkdown = '';
            currentLlmMessageId = null;
            showLoadingIndicator(false); // Hide any potentially stuck loading indicator

            loadConversationHistory(request.tabId);
            // Ensure chat area is visible and one-off instruction area is hidden
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            userInput.focus(); // Focus input on init
            return; // Message handled
        } else if (request.action === 'setSelectedText') {
            selectedText = request.selectedText;
            currentTabId = request.tabId; // Store the tab ID, ensuring currentTabId is set
            
            // If this is from the "start_chat" context menu option
            if (request.fromStartChat) {
                showLoadingIndicator(true, 'Processing selected text...'); // Show indicator for start_chat
                chatMainArea.style.display = 'block'; // Ensure chat area is visible
                oneoffInstructionArea.style.display = 'none'; // Hide one-off instruction area
                
                // Load existing history for this tab or start fresh
                loadConversationHistory(currentTabId); 
                // Note: The API call for 'start_chat' in background.js will eventually call setApiResponse,
                // which will add the prompt and response. We might not need to clear history here
                // if loadConversationHistory correctly sets it up.
                // For a "true" new chat, background.js might need to signal a history clear first,
                // or chat.js makes a decision based on existing history length after loading.
                // For now, loadConversationHistory will handle setting conversationHistory.
            } else {
                // For one-off instruction, show the instruction area
                selectedTextDiv.textContent = selectedText; // Update selected text display
                chatMainArea.style.display = 'none'; // Hide chat area
                oneoffInstructionArea.style.display = 'block'; // Show one-off instruction area
            }
        } else if (request.action === 'setApiResponse') {
            // Ensure chat area is visible when showing API response
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';

            if (request.streamState === 'start') {
                showLoadingIndicator(true, 'Receiving response...');
                // Display the initial prompt as a user message ONLY if the conversation history is currently empty.
                // This prevents re-displaying the prompt if background.js sends it again for multi-part streams.
                if (request.prompt && conversationHistory.length === 0) {
                    const promptLines = request.prompt.split('\n');
                    const instruction = promptLines[0];
                    addMessage('User', instruction);
                    conversationHistory.push({ role: 'user', content: request.prompt });
                    // saveConversationHistory(); // Intentionally deferred to 'end' or next user message
                }
                currentLlmRawMarkdown = request.apiResponse || '';
                currentLlmMessageDiv = addMessage('LLM', currentLlmRawMarkdown, true); // true for isStreamStart
                if (currentLlmMessageDiv) {
                    currentLlmMessageId = currentLlmMessageDiv.id;
                } else {
                    console.error("Failed to create message div for LLM stream start.");
                    addMessage('System', "Error: Could not initialize streaming display.");
                }
                chatArea.scrollTop = chatArea.scrollHeight;
            } else if (request.streamState === 'continue') {
                if (currentLlmMessageDiv && currentLlmMessageId) {
                    currentLlmRawMarkdown += request.apiResponse;
                    currentLlmMessageDiv.innerHTML = marked(currentLlmRawMarkdown) + getCopyIconsHTML(currentLlmMessageId);
                    attachCopyIconListeners(currentLlmMessageId, currentLlmRawMarkdown); // Re-attach for potentially new DOM
                    chatArea.scrollTop = chatArea.scrollHeight;
                } else {
                    // Stream desynchronization or message came without a 'start'
                    console.warn("Chat: Received 'continue' stream state without an active LLM message div. Adding as new message.");
                    const newMsgDiv = addMessage('LLM', request.apiResponse, true); // Treat as start of a new message visually
                    if(newMsgDiv) currentLlmMessageId = newMsgDiv.id; // Capture new ID
                    currentLlmRawMarkdown = request.apiResponse; // Reset raw markdown
                    currentLlmMessageDiv = newMsgDiv; // Track new div
                    // Avoid pushing partial history here, wait for 'end' or explicit save.
                }
            } else if (request.streamState === 'end') {
                showLoadingIndicator(false);
                if (currentLlmMessageDiv && currentLlmMessageId) {
                    if (request.apiResponse) { // Handle any final text part
                        currentLlmRawMarkdown += request.apiResponse;
                    }
                    currentLlmMessageDiv.innerHTML = marked(currentLlmRawMarkdown) + getCopyIconsHTML(currentLlmMessageId);
                    attachCopyIconListeners(currentLlmMessageId, currentLlmRawMarkdown);

                    if (currentLlmRawMarkdown.trim()) {
                        conversationHistory.push({ role: 'assistant', content: currentLlmRawMarkdown });
                        saveConversationHistory();
                    }
                } else if (request.apiResponse && request.apiResponse.trim()) { // If 'end' comes with data but no prior stream
                     addMessage('LLM', request.apiResponse); // Display it
                     conversationHistory.push({ role: 'assistant', content: request.apiResponse });
                     saveConversationHistory();
                }
                // Reset streaming state variables
                currentLlmMessageDiv = null;
                currentLlmRawMarkdown = '';
                currentLlmMessageId = null;
                chatArea.scrollTop = chatArea.scrollHeight;
            } else if (request.streamState === 'error') {
                showLoadingIndicator(false);
                addMessage('System', `Error: ${request.apiResponse}`);
                // Reset streaming state variables
                currentLlmMessageDiv = null;
                currentLlmRawMarkdown = '';
                currentLlmMessageId = null;
            } else if (request.streamState === 'tool_call_start') {
                showLoadingIndicator(true, `Assistant is using tool: ${request.toolCallInfo?.name || 'a tool'}...`);
                // If there was a text stream before tool call, finalize it.
                if (currentLlmMessageDiv && currentLlmMessageId && currentLlmRawMarkdown.trim()) {
                    currentLlmMessageDiv.innerHTML = marked(currentLlmRawMarkdown) + getCopyIconsHTML(currentLlmMessageId);
                    attachCopyIconListeners(currentLlmMessageId, currentLlmRawMarkdown);
                    conversationHistory.push({ role: 'assistant', content: currentLlmRawMarkdown });
                    saveConversationHistory();
                }
                currentLlmMessageDiv = null;
                currentLlmRawMarkdown = '';
                currentLlmMessageId = null;
            } else { // Fallback for non-streaming or 'complete' state (older background versions or non-streamed tools)
                showLoadingIndicator(false);
                if (request.prompt && (conversationHistory.length === 0 || conversationHistory[conversationHistory.length -1].role !== 'user')) {
                    const promptLines = request.prompt.split('\n');
                    const instruction = promptLines[0];
                    addMessage('User', instruction);
                    conversationHistory.push({ role: 'user', content: request.prompt });
                }
                addMessage('LLM', request.apiResponse);
                conversationHistory.push({ role: 'assistant', content: request.apiResponse });
                saveConversationHistory();
                currentLlmMessageDiv = null;
                currentLlmRawMarkdown = '';
                currentLlmMessageId = null;
            }
        } else if (request.action === 'handleToolCallResponse') {
            console.log("handleToolCallResponse message received", request);
            currentTabId = request.tabId; // Ensure currentTabId is set

            // If there's an active LLM text stream, finalize and save it before handling tool call.
            if (currentLlmMessageDiv && currentLlmMessageId && currentLlmRawMarkdown.trim()) {
                currentLlmMessageDiv.innerHTML = marked(currentLlmRawMarkdown) + getCopyIconsHTML(currentLlmMessageId);
                attachCopyIconListeners(currentLlmMessageId, currentLlmRawMarkdown);
                conversationHistory.push({ role: 'assistant', content: currentLlmRawMarkdown });
                // saveConversationHistory(); // History will be saved by later calls in this function
                currentLlmMessageDiv = null;
                currentLlmRawMarkdown = '';
                currentLlmMessageId = null;
            }

            // Ensure chat area is visible
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';

            const { responseMessage, prompt: originalPrompt } = request;

            // Ensure original user prompt for this interaction is in history
            if (originalPrompt && (conversationHistory.length === 0 || conversationHistory[conversationHistory.length - 1].role !== 'user')) {
                // This condition implies the prompt leading to this tool call isn't the last thing in history.
                // It's possible it's a new interaction.
                // Clearing history here might be too aggressive if it's a tool call within an ongoing chat.
                // Let's assume for now that if originalPrompt is passed, it should initiate this turn.
                // If conversationHistory is truly empty, then this is fine.
                // If not empty, and last message isn't this prompt, add it.
                // This avoids duplicate user messages if background.js already added it via a 'start' stream for text part.

                // A safer check: only add if the prompt isn't already in the immediate history.
                let promptAlreadyExists = false;
                if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length -1].role === 'user' && conversationHistory[conversationHistory.length -1].content === originalPrompt) {
                    promptAlreadyExists = true;
                }
                if (!promptAlreadyExists) {
                    const promptLines = originalPrompt.split('\n');
                    const instruction = promptLines[0];
                    addMessage('User', instruction); // Display it
                    conversationHistory.push({ role: 'user', content: originalPrompt });
                }
            }

            // Add assistant's message with tool_calls to history
            // Ensure this specific tool_call message isn't already the last item.
            if (responseMessage && responseMessage.tool_calls) {
                 if (conversationHistory.length === 0 || conversationHistory[conversationHistory.length - 1] !== responseMessage) {
                    // Check if a message with the same tool_call_id already exists to prevent duplicates if logic re-triggers
                    const existingToolCallMsg = conversationHistory.find(msg => msg.role === 'assistant' && msg.tool_calls && msg.tool_calls[0].id === responseMessage.tool_calls[0].id);
                    if(!existingToolCallMsg){
                        conversationHistory.push(responseMessage);
                    }
                }
            }
            saveConversationHistory(); // Save history before tool execution

            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                const toolCall = responseMessage.tool_calls[0];
                const toolName = toolCall.function.name;
                const toolArgs = toolCall.function.arguments;

                // addMessage('System', `⚙️ Requesting execution for tool: ${toolName}...`); // Replaced by loading indicator
                console.log("Tool call requested via handleToolCallResponse:", toolCall);
                showLoadingIndicator(true, `Executing tool: ${toolName}...`);

                // Send tool call details to background script for execution
                chrome.runtime.sendMessage({
                    action: 'executePromptPaulTool',
                    toolCall: {
                        id: toolCall.id,
                        name: toolName,
                        arguments: toolArgs
                    }
                }, (response) => {
                    // Callback function to handle the result from background.js
                    if (chrome.runtime.lastError) {
                         console.error("Error sending/receiving tool execution message:", chrome.runtime.lastError);
                         showLoadingIndicator(false);
                         addMessage('System', `Error communicating with background script: ${chrome.runtime.lastError.message}`);
                         return;
                    }

                    if (response.error) {
                        console.error(`Error executing tool ${toolName}:`, response.error);
                        showLoadingIndicator(false);
                        addMessage('System', `Error executing tool ${toolName}: ${response.error}`);
                        conversationHistory.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: `Error: ${response.error}`
                        });
                        saveConversationHistory(); // Save history
                        // Optionally call makeApiCall again to let the LLM handle the error
                        // makeApiCall();
                    } else {
                        console.log(`Tool ${toolName} executed successfully. Result:`, response.result);
                        addMessage('System', `✅ Tool ${toolName} executed.`);
                        conversationHistory.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: JSON.stringify(response.result) // Result needs to be stringified
                        });
                        saveConversationHistory(); // Save history
                        // Call makeApiCall again (without a new user message) to get final response
                        // makeApiCall will show its own "Processing tool response..."
                        makeApiCall();
                    }
                });
            } else {
                 console.error("handleToolCallResponse received message without tool_calls:", responseMessage);
                 showLoadingIndicator(false);
                 addMessage('System', "Error: Received tool call instruction but no tool calls found.");
            }
        }
    });

    sendButton.addEventListener('click', sendMessage);
    const clearButton = document.getElementById('clear-button');
    clearButton.addEventListener('click', clearChat);
    userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            sendMessage();
        }
    });

    // Store conversation history
    let conversationHistory = [];

    // --- Conversation History Persistence ---
    /**
     * Saves the current conversationHistory array to chrome.storage.local.
     * The history is stored using a key specific to the currentTabId,
     * allowing each tab to have its own persisted chat conversation.
     */
    async function saveConversationHistory() {
        if (currentTabId && conversationHistory) {
            const historyKey = 'chatHistory_tab_' + currentTabId;
            // Potential enhancement: Trim history if it's getting too large for storage.
            chrome.storage.local.set({ [historyKey]: conversationHistory }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Error saving conversation history:', chrome.runtime.lastError);
                } else {
                    console.log('Conversation history saved for tab:', currentTabId);
                }
            });
        }
    }

    /**
     * Loads the conversation history for a given tabId from chrome.storage.local.
     * If history is found, it populates the global conversationHistory array
     * and re-renders the chat messages in the UI. If no history is found,
     * it initializes an empty conversation.
     * @param {number} tabId - The ID of the tab for which to load history.
     */
    async function loadConversationHistory(tabId) {
        if (!tabId) return;
        currentTabId = tabId; // Ensure currentTabId is set
        const historyKey = 'chatHistory_tab_' + tabId;

        chrome.storage.local.get([historyKey], (result) => {
            if (chrome.runtime.lastError) {
                console.error('Error loading conversation history:', chrome.runtime.lastError);
                conversationHistory = [];
                chatArea.innerHTML = '';
                return;
            }

            if (result[historyKey]) {
                conversationHistory = result[historyKey];
                chatArea.innerHTML = ''; // Clear current messages
                conversationHistory.forEach(item => {
                    // Map role for display: 'assistant' -> 'LLM', 'user' -> 'User', others as 'System'
                    let senderType = 'System';
                    if (item.role === 'user') senderType = 'User';
                    else if (item.role === 'assistant') senderType = 'LLM';
                    // For tool role, the content is often an object/string not directly displayable as a chat message.
                    // You might want to display a summary or specific parts if item.role === 'tool'.
                    // For now, tool responses are added as 'System' messages directly by the logic that handles them.
                    // This loop primarily re-renders user and assistant messages.
                    // System messages from history (if any are stored that way) will also be rendered.
                    if (item.role === 'user' || item.role === 'assistant' || item.role === 'system') {
                         addMessage(senderType, item.content);
                    }
                });
                setTimeout(() => chatArea.scrollTop = chatArea.scrollHeight, 0); // Scroll to bottom
                console.log('Conversation history loaded for tab:', tabId);
            } else {
                conversationHistory = [];
                chatArea.innerHTML = ''; // Ensure chat area is clear for a new chat
                console.log('No conversation history found for tab:', tabId);
            }
        });
    }

    function clearChat() {
            chatArea.innerHTML = '';
            conversationHistory = [];
            if (currentTabId) {
                const historyKey = 'chatHistory_tab_' + currentTabId;
                chrome.storage.local.remove(historyKey, () => {
                    if (chrome.runtime.lastError) {
                        console.error('Error clearing history from storage:', chrome.runtime.lastError);
                    } else {
                        console.log('Chat history for tab', currentTabId, 'cleared from storage.');
                    }
                });
            }
            
            // Ensure chat-main-area is visible and oneoff-instruction-area is hidden
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            
            // Show a toast notification
            // Get or create toast container
            let toastContainer = document.getElementById('toast-container');
            if (!toastContainer) {
                toastContainer = document.createElement('div');
                toastContainer.id = 'toast-container';
                chatArea.appendChild(toastContainer);
            }
    
            const toast = document.createElement('div');
            toast.classList.add('toast');
            toast.textContent = 'Chat history cleared';
            toastContainer.appendChild(toast);
    
            setTimeout(() => {
                toast.classList.add('fade-out');
                setTimeout(() => {
                    toast.remove();
                    // Remove container if empty
                    if (toastContainer.children.length === 0) {
                        toastContainer.remove();
                    }
                }, 500);
            }, 2500);
    }
    
    function sendMessage() {
        const message = userInput.value;
        if (message.trim()) {
            addMessage('User', message);
            userInput.value = '';
            showLoadingIndicator(true); // Show indicator before making API call
            // Make API call with the message
            makeApiCall(message); // saveConversationHistory will be called within makeApiCall after history is updated
        }
    }
    
    // Function to make API call
    // Helper function to get tools from storage
    async function getTools() {
        console.log("Chat: Getting tools from local storage");
        return new Promise((resolve) => {
            chrome.storage.local.get(['promptPaulTools'], (result) => {
                console.log("Chat: Tools retrieved:", result.promptPaulTools);
                resolve(result.promptPaulTools || []);
            });
        });
    }

    // Function to make API call
    async function makeApiCall(message) {
        // If message is undefined/null, it's a follow-up call (e.g., after tool execution)
        if (!message) {
            showLoadingIndicator(true, 'Processing tool response...');
        }
        // If 'message' is present, showLoadingIndicator(true) was already called by sendMessage

        try {
            const config = await getApiConfig();
            const tools = await getTools(); // Fetch defined tools

            // Add user message to conversation history if message is provided
            // (This function might be called again after a tool result without a new user message)
            if (message) {
                conversationHistory.push({
                    role: 'user',
                    content: message
                });
                saveConversationHistory(); // Save after adding user message
            }
            
            // Format tools for the API request (OpenAI format example)
            const formattedTools = tools.map(tool => {
                try {
                    return {
                        type: 'function',
                        function: {
                            name: tool.name,
                            description: tool.description,
                            parameters: JSON.parse(tool.parameters) // Parse the stored JSON string
                        }
                    };
                } catch (e) {
                    console.error(`Error parsing parameters for tool ${tool.name}:`, e);
                    addMessage('System', `Error: Invalid JSON Schema for tool '${tool.name}'. Please fix it in options.`);
                    return null; // Skip invalid tools
                }
            }).filter(tool => tool !== null); // Filter out tools with parsing errors

            // Prepare the request body
            const requestBody = {
                model: config.modelName,
                messages: conversationHistory,
                max_tokens: parseInt(config.maxTokens) || 2048, // Use configured maxTokens
            };

            // Add tools to the request body if any are defined and valid
            if (formattedTools.length > 0) {
                requestBody.tools = formattedTools;
                requestBody.tool_choice = "none"; // Let the model decide whether to use tools
            }

            console.log("API Request Body:", requestBody); // Log for debugging

            showLoadingIndicator(true); // Show loading indicator

            try {
                // Make API call with conversation history and tools
                const apiResponse = await fetch(config.llmEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + config.apiKey,
                    },
                    body: JSON.stringify(requestBody),
                });
        
                if (!apiResponse.ok) {
                    const errorData = await apiResponse.json().catch(() => null);
                    throw new Error(
                        'API request failed with status ' + apiResponse.status + ': ' + (
                            errorData ? JSON.stringify(errorData) : apiResponse.statusText
                        )
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
                    throw new Error('Invalid response format from API');
                }
        
                showLoadingIndicator(false); // Hide loading indicator on success

                // --- Tool Call Handling Logic (Phase 2, Step 2) ---
                const responseMessage = responseData.choices[0].message;

                // Add the raw assistant message to history (might contain content or tool_calls)
                conversationHistory.push(responseMessage);
                // Note: If it's a tool_call, saveConversationHistory will be called again after the tool response.
                // If it's direct content, this save is important.
                saveConversationHistory();

            } catch (error) {
                console.error("API Call Error:", error);
                showLoadingIndicator(false); // Hide loading indicator on error
                addMessage('System', 'Error: ' + error.message); // Display error message
            }

            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                // Handle tool calls (assuming only one call for now, but API might return multiple)
                // TODO: Loop through responseMessage.tool_calls if multiple calls need sequential handling
                const toolCall = responseMessage.tool_calls[0]; // Process the first tool call
                const toolName = toolCall.function.name;
                const toolArgs = toolCall.function.arguments; // Arguments are usually a stringified JSON

                // addMessage('System', `⚙️ Requesting execution for tool: ${toolName}...`); // Replaced by loading indicator
                console.log("Tool call requested:", toolCall);
                showLoadingIndicator(true, `Executing tool: ${toolName}...`);

                // Send tool call details to background script for execution
                chrome.runtime.sendMessage({
                    action: 'executePromptPaulTool',
                    toolCall: {
                        id: toolCall.id, // Include the tool_call_id from the API response
                        name: toolName,
                        arguments: toolArgs
                    }
                }, (response) => {
                    // Callback function to handle the result from background.js
                    if (chrome.runtime.lastError) {
                         console.error("Error sending/receiving tool execution message:", chrome.runtime.lastError);
                         showLoadingIndicator(false);
                         addMessage('System', `Error communicating with background script: ${chrome.runtime.lastError.message}`);
                         // Potentially stop the flow here or try to recover
                         return;
                    }

                    if (response.error) {
                        console.error(`Error executing tool ${toolName}:`, response.error);
                        showLoadingIndicator(false);
                        addMessage('System', `Error executing tool ${toolName}: ${response.error}`);
                        // Add an error message to history? Or let the user retry?
                        // For now, we'll add an error message to history and let the LLM know.
                        conversationHistory.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: `Error: ${response.error}` // Inform LLM about the error
                        });
                        saveConversationHistory(); // Save history
                        // Optionally call makeApiCall again to let the LLM handle the error
                        // makeApiCall(); // Decide if AI should respond to the error

                    } else {
                        console.log(`Tool ${toolName} executed successfully. Result:`, response.result);
                        addMessage('System', `✅ Tool ${toolName} executed.`);

                        // Add the successful tool result to conversation history
                        conversationHistory.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: JSON.stringify(response.result) // Result needs to be stringified for the API
                        });
                        saveConversationHistory(); // Save history

                        // Call makeApiCall again (without a new user message)
                        // This sends the history including the tool result back to the LLM
                        // makeApiCall will show "Processing tool response..."
                        makeApiCall();
                    }
                });
            } else if (responseMessage.content) {
                // Handle regular text response
                // conversationHistory already updated and saved if this is a direct response
                const responseContent = responseMessage.content;
                showLoadingIndicator(false); // Hide indicator before showing response
                // Display the response
                addMessage('LLM', responseContent);
            } else {
                 // Handle cases where there's neither content nor tool_calls (should be rare)
                 console.error("API response message has neither content nor tool_calls:", responseMessage);
                 showLoadingIndicator(false);
                 addMessage('System', "Received an empty response from the AI.");
            }
        } catch (error) {
            showLoadingIndicator(false); // Hide indicator on error
            addMessage('LLM', 'Error: ' + error.message);
        }
    }

    function addMessage(sender, message, isStreamStart = false) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message');

        if (sender === 'User') {
            messageDiv.classList.add('user-message');
            messageDiv.textContent = 'You: ' + message; // User messages are plain text
        } else if (sender === 'LLM') {
            messageDiv.classList.add('llm-message');
            const messageId = 'llm-message-' + Date.now() + '-' + Math.random().toString(36).substring(2,7); // Add random for more uniqueness
            messageDiv.id = messageId;
            // Render markdown and add copy icons
            messageDiv.innerHTML = marked(message) + getCopyIconsHTML(messageId);
            // Attach listeners after element is in DOM or very soon to be.
            // For streaming, currentLlmRawMarkdown will be the full content up to that point.
            // When isStreamStart is true, 'message' is the first chunk.
            // When currentLlmMessageDiv is updated directly, attachCopyIconListeners is called again.
             setTimeout(() => attachCopyIconListeners(messageId, isStreamStart ? message : currentLlmRawMarkdown), 0);
        } else if (sender === 'System') {
            messageDiv.classList.add('system-message');
            messageDiv.textContent = message;
        } else {
            messageDiv.textContent = sender + ': ' + message; // Fallback
        }

        chatArea.appendChild(messageDiv);

        setTimeout(() => {
            chatArea.scrollTop = chatArea.scrollHeight;
        }, 10); // Delay to ensure content is rendered

        return messageDiv; // Return the created div
    }

    // Handle submit button click for one-off instruction
    submitBtn.addEventListener('click', async () => {
        showLoadingIndicator(true, 'Processing one-off instruction...');
        const instruction = instructionInput.value;
        if (!instruction.trim()) {
            alert('Please enter an instruction');
            return;
        }

        try {
            const config = await getApiConfig();

            // Prepare the prompt
            const prompt = instruction + '\\n\\n' + selectedText;
            
            // Reset conversation history for new instruction
            conversationHistory = [];
            
            // Add user message to conversation history
            conversationHistory.push({
                role: 'user',
                content: prompt
            });
            saveConversationHistory(); // Save history

            // Make API call
            const apiResponse = await fetch(config.llmEndpoint, {
                method: 'POST',
                headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + config.apiKey,
                },
                body: JSON.stringify({
                model: config.modelName,
                messages: conversationHistory,
                max_tokens: 2048,
                }),
            });

            if (!apiResponse.ok) {
                const errorData = await apiResponse.json().catch(() => null);
                throw new Error(
                'API request failed with status ' + apiResponse.status + ': ' + (
                    errorData ? JSON.stringify(errorData) : apiResponse.statusText
                )
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
                throw new Error('Invalid response format from API');
            }

            const responseContent = responseData.choices[0].message.content;
            
            // Add LLM response to conversation history
            conversationHistory.push({
                role: 'assistant',
                content: responseContent
            });
            saveConversationHistory(); // Save history

            // No longer showing response in the original tab as a popup overlay
            // Only showing in the sidebar

            // Also show the response in the side panel
            // Add the instruction as a user message and the response as an LLM message
            showLoadingIndicator(false);
            addMessage('User', instruction + "\\n\\n[Selected text: " + selectedText.substring(0, 50) + (selectedText.length > 50 ? "..." : "") + "]");
            addMessage('LLM', responseContent);

            // Clear the instruction input and selected text after processing and switch back to chat area
            instructionInput.value = '';
            selectedTextDiv.textContent = '';
            selectedText = null; // Reset selected text
            oneoffInstructionArea.style.display = 'none'; // Hide one-off instruction area
            chatMainArea.style.display = 'block'; // Show chat area


        } catch (error) {
            showLoadingIndicator(false);
            alert('Error: ' + error.message);
        }
    });
});
