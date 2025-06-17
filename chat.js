import { setupThemeToggle } from './themeUtils.js';

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

    // Quick Actions Sidebar Elements
    const summarizeTabButton = document.getElementById('summarize-tab-button');
    const pinnedActionsContainer = document.getElementById('pinned-actions-container');
    // const managePinnedActionsButton = document.getElementById('manage-pinned-actions-button'); // Removed

    // Add event listeners for quick action buttons
    // summarizeTabButton listener moved to lines 878-905 to consolidate logic
    // and prevent duplicate message sending.
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
                        makeApiCall(prompt);
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

    async function getApiConfig() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
                const profiles = result.profiles || [];
                const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
                const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId) || profiles.find(p => p.id === 'default');
                
                if (!selectedProfile || !selectedProfile.llmEndpoint || !selectedProfile.apiKey || !selectedProfile.modelName) {
                    console.error("Chat: Configuration is incomplete or missing.");
                    reject(new Error('Configuration is incomplete. Please set up the API endpoint, API key, and model name in the options page.'));
                } else {
                    resolve(selectedProfile);
                }
            });
        });
    }

    function showToast(message) {
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            document.body.appendChild(toastContainer);
        }
        const toast = document.createElement('div');
        toast.classList.add('toast');
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => {
                if (toast.parentNode === toastContainer) {
                    toastContainer.removeChild(toast);
                }
                if (toastContainer.children.length === 0 && toastContainer.parentNode) {
                     toastContainer.parentNode.removeChild(toastContainer);
                }
            }, 500);
        }, 2500);
    }

    function attachCopyListeners(rawMessage, contentElement, copyIconElement, copyFormattedIconElement) {
        const newCopyIcon = copyIconElement.cloneNode(true);
        if (copyIconElement.parentNode) {
            copyIconElement.parentNode.replaceChild(newCopyIcon, copyIconElement);
        }
        const newFormattedCopyIcon = copyFormattedIconElement.cloneNode(true);
        if (copyFormattedIconElement.parentNode) {
            copyFormattedIconElement.parentNode.replaceChild(newFormattedCopyIcon, copyFormattedIconElement);
        }
        newCopyIcon.addEventListener('click', function(event) {
            event.stopPropagation();
            navigator.clipboard.writeText(rawMessage).then(() => showToast('Copied raw text to clipboard'))
                .catch(err => { console.error('Failed to copy raw text: ', err); showToast('Error copying raw text.'); });
        });
        newFormattedCopyIcon.addEventListener('click', function(event) {
            event.stopPropagation();
            const htmlContent = contentElement.innerHTML;
            navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([htmlContent], { type: 'text/html' }),
                    'text/plain': new Blob([rawMessage], { type: 'text/plain' })
                })
            ]).then(() => showToast('Copied formatted text to clipboard'))
              .catch(err => {
                console.error('Failed to copy formatted text: ', err);
                navigator.clipboard.writeText(rawMessage).then(() => showToast('Copied (plain text fallback) to clipboard'))
                    .catch(errFallback => { console.error('Failed to copy plain text fallback: ', errFallback); showToast('Error copying text.'); });
            });
        });
    }

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
        copyIcon.src = 'icons\\copy markdown.png';
        copyIcon.alt = "Copy Raw";
        copyIcon.style.cssText = "cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;";
        messageDiv.appendChild(copyIcon);

        // --- Icon for copying formatted text ---
        const copyFormattedIcon = document.createElement('img');
        copyFormattedIcon.id = `copy-formatted-icon-${uniqueIdString}`;
        // Replaced base64 string with a file path
        const formattedIconSrc = 'icons/copy formatted.png';
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
        // if (request.action === 'explainContentResponse') {
        //     // This logic is now moved directly into the explainBtn's sendMessage callback (around lines 26-45)
        //     // to ensure it's handled there.
        //     console.log("Chat.js: General onMessage listener processing 'explainContentResponse'", request);
        //     if (request.content) {
        //         const prompt = "Explain the following text:\n\n" + request.content;
        //         chatMainArea.style.display = 'block';
        //         oneoffInstructionArea.style.display = 'none';
        //         console.log("Chat.js: General onMessage - About to call makeApiCall for explain. Prompt length:", prompt.length);
        //         makeApiCall(prompt);
        //         showToast('Tab content received, explaining...');
        //     } else {
        //         console.log("Chat.js: General onMessage - 'explainContentResponse' received but no content.");
        //         showToast('No content received from tab.');
        //     }
        // } else
        if (request.action === 'setSelectedText') {
            selectedText = request.selectedText;
            tabId = request.tabId;
            if (request.fromStartChat) {
                chatMainArea.style.display = 'block';
                oneoffInstructionArea.style.display = 'none';
                conversationHistory = [];
            } else {
                selectedTextDiv.textContent = selectedText;
                chatMainArea.style.display = 'none';
                oneoffInstructionArea.style.display = 'block';
            }
        } else if (request.action === 'setApiResponse') {
            console.log("Chat: setApiResponse received", request);
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
            if (request.apiResponse) {
                if (request.prompt) { // For setApiResponse, prompt is usually the full original prompt
                    const lastMessage = conversationHistory[conversationHistory.length - 1];
                    if (!lastMessage || !(lastMessage.role === 'user' && lastMessage.content === request.prompt)) {
                         addMessage('User', request.prompt.split('\n')[0]);
                         conversationHistory.push({ role: 'user', content: request.prompt });
                    }
                }
                addMessage('LLM', request.apiResponse);
                // Ensure not to add duplicate assistant message if it's already the last one
                const lastAssistantMessage = conversationHistory.length > 0 && conversationHistory[conversationHistory.length -1].role === 'assistant' ? conversationHistory[conversationHistory.length -1].content : null;
                if(lastAssistantMessage !== request.apiResponse){
                    conversationHistory.push({ role: 'assistant', content: request.apiResponse });
                }
            }
        } else if (request.action === 'streamApiStart') {
            console.log("Chat: streamApiStart received", request);
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
            console.log("Chat: streamApiStart - Values set: ", {
                currentStreamingMessageDivExists: !!currentStreamingMessageDiv,
                currentStreamingContentElementExists: !!currentStreamingContentElement
            });
        } else if (request.action === 'streamApiResponseChunk') {
            if (activeStreamingToolCall) return; // If a tool call is active, don't process further text chunks for this bubble
            if (currentStreamingContentElement && request.chunk != null) {
                accumulatedStreamedText += request.chunk;
                currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
                chatArea.scrollTop = chatArea.scrollHeight;
            }
        } else if (request.action === 'streamApiEnd') {
            console.log("Chat: streamApiEnd handler invoked.", request);
            console.log("Chat: Current activeStreamingToolCall (at start of streamApiEnd):", activeStreamingToolCall);
            console.log("Chat: Current accumulatedStreamedText (at start of streamApiEnd):", accumulatedStreamedText);
            // console.log("Chat: streamApiEnd received", request); // Duplicative of the first log.
            let toolCallWasHandledInThisStream = false;

            // Tool call execution logic STARTS HERE (moved before UI finalization for current bubble)
            if (activeStreamingToolCall) {
                console.log("Chat: streamApiEnd - activeStreamingToolCall is TRUE.");
                toolCallWasHandledInThisStream = true; // Mark that a tool call is being handled in this stream event
                const toolCall = activeStreamingToolCall; // Clarity
                console.log("Chat: streamApiEnd - toolCall variable set to:", toolCall);

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
                    console.log("Chat: streamApiEnd - Pushing assistantMessageWithToolCall to history:", assistantMessageWithToolCall);
                    conversationHistory.push(assistantMessageWithToolCall);
                }

                console.log("Chat: streamApiEnd - ABOUT TO SEND executePromptPaulTool message. ToolCall details:", { id: toolCall.id, name: toolCall.function.name, arguments: toolCall.function.arguments });
                chrome.runtime.sendMessage({
                    action: 'executePromptPaulTool',
                    toolCall: {
                        id: toolCall.id,
                        name: toolCall.function.name,
                        arguments: toolCall.function.arguments
                    }
                }, (response) => {
                    console.log("Chat: streamApiEnd - In callback of executePromptPaulTool. Response:", response);
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
                        console.log("Chat: Preparing to call makeApiCall after tool execution (streamApiEnd). Current conversationHistory (last 3 messages):");
                        console.log(conversationHistory.slice(-3));
                        console.log("Chat: streamApiEnd - Tool execution successful, proceeding to call makeApiCall() for LLM follow-up.");
                        makeApiCall();
                    }
                });

                activeStreamingToolCall = null; // Reset immediately as it's being processed now
                console.log("Chat: streamApiEnd - activeStreamingToolCall has been reset to null.");
            } else {
                console.log("Chat: streamApiEnd - activeStreamingToolCall is FALSE or null.");
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
            console.log("Chat: streamApiToolCallChunk handler invoked.", request);
            // console.log("Chat: Received streamApiToolCallChunk:", request.toolCallChunk); // This is duplicative of the log above
            console.log("Chat: streamApiToolCallChunk - Pre-condition check:", {
                currentStreamingMessageDivExists: !!currentStreamingMessageDiv,
                currentStreamingContentElementExists: !!currentStreamingContentElement,
                requestToolCallChunk: request.toolCallChunk, // Keep this for visual inspection
                isToolCallChunkArray: Array.isArray(request.toolCallChunk),
                typeofToolCallChunk: typeof request.toolCallChunk,
                toolCallChunkLength: (request.toolCallChunk && typeof request.toolCallChunk.length !== 'undefined') ? request.toolCallChunk.length : 'length property is undefined or chunk is null',
                condition_currentStreamingMessageDiv: !!currentStreamingMessageDiv,
                condition_currentStreamingContentElement: !!currentStreamingContentElement,
                condition_requestToolCallChunk: !!request.toolCallChunk,
                condition_requestToolCallChunkLengthGreaterThanZero: !!(request.toolCallChunk && request.toolCallChunk.length > 0)
            });
            if (currentStreamingMessageDiv && currentStreamingContentElement && request.toolCallChunk && request.toolCallChunk.length > 0) {
                console.log("Chat: streamApiToolCallChunk - DEBUG: Entered 'if' block for processing toolCallChunk.");
                const toolCall = request.toolCallChunk[0]; // Assuming the chunk contains the full tool call info as sent by background
                console.log("Chat: Extracted toolCall from chunk:", toolCall);
                activeStreamingToolCall = toolCall; // Store the active tool call
                console.log("Chat: activeStreamingToolCall has been set to:", activeStreamingToolCall);

                // Clear previous accumulated text from display
                // accumulatedStreamedText = ""; // Preserve accumulated text
                currentStreamingContentElement.innerHTML = ''; // Clear the display for "Using tool..."

                // Asynchronously fetch tool definition to update UI for MCP tool
                (async () => {
                    const allToolsStream = await getTools();
                    const currentToolDefStream = allToolsStream.find(t => t.name === toolCall.function.name);
                    if (currentStreamingContentElement) { // Check if element still exists
                        if (currentToolDefStream && currentToolDefStream.mcpProxyUrl) {
                            currentStreamingContentElement.innerHTML = marked.parse(`⚙️ Using MCP tool: **${toolCall.function.name}**`);
                        } else {
                            currentStreamingContentElement.innerHTML = marked.parse(`⚙️ Using tool: **${toolCall.function.name}**`);
                        }
                        // chatArea.scrollTop = chatArea.scrollHeight; // Already present after this block
                    }
                })();
                console.log("Chat: UI updated to show 'Using tool' message.");

                // Potentially, actual arguments could be streamed. For now, just the name.
                // If toolCall.function.arguments is a string of streamed arguments, append it:
                // currentStreamingContentElement.innerHTML += marked.parse("```\n" + toolCall.function.arguments + "\n```");

                chatArea.scrollTop = chatArea.scrollHeight;
            }
        } else if (request.action === 'handleToolCallResponse') {
            console.log("Chat: handleToolCallResponse received", request);
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            userInput.disabled = false;
            sendButton.disabled = false;
            const { responseMessage, prompt: originalPrompt } = request;

            // For context menu tool calls, history is usually fresh or should be reset
             if (conversationHistory.length === 0 && originalPrompt) {
                 addMessage('User', originalPrompt.split('\n')[0]);
                 conversationHistory.push({ role: 'user', content: originalPrompt });
            } // If continuing a chat, user prompt might already be in history.

            conversationHistory.push(responseMessage);

            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                const toolCall = responseMessage.tool_calls[0];
                // Fetch tool definition to check if it's an MCP tool
                (async () => {
                    const allToolsNonStream = await getTools(); // Already async
                    const toolDefinitionNonStream = allToolsNonStream.find(t => t.name === toolCall.function.name);

                    if (toolDefinitionNonStream && toolDefinitionNonStream.mcpProxyUrl) {
                        addMessage('System', `⚙️ Requesting execution for MCP tool: **${toolCall.function.name}**...`);
                    } else {
                        addMessage('System', `⚙️ Requesting execution for tool: **${toolCall.function.name}**...`);
                    }
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
                })();
            } else {
                 addMessage('System', "Error: Tool call instruction received without tool_calls.");
            }
        }
    });

    sendButton.addEventListener('click', sendMessage);
    const clearButton = document.getElementById('clear-button');
    clearButton.addEventListener('click', clearChat);
    userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !userInput.disabled) {
            sendMessage();
        }
    });

    let conversationHistory = [];

    function clearChat() {
            chatArea.innerHTML = '';
            conversationHistory = [];
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            showToast('Chat history cleared');
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
            makeApiCall(message);
            userInput.value = '';
        }
    }
    
    async function getTools() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['promptPaulTools'], (result) => {
                resolve(result.promptPaulTools || []);
            });
        });
    }

    async function makeApiCall(userMessage = null, tool_choice = 'none') { // Added tool_choice, default to 'none'
        try {
            const config = await getApiConfig();
            const allAvailableTools = await getTools(); // Renamed for clarity

            if (userMessage) {
                addMessage('User', userMessage);
                conversationHistory.push({ role: 'user', content: userMessage });
            }
            
            // START SHARED API REQUEST PREP LOGIC (manual sync with background.js)
            const formattedTools = allAvailableTools.map(tool => {
                try {
                    return {
                        type: 'function',
                        function: { name: tool.name, description: tool.description, parameters: JSON.parse(tool.parameters || '{}') }
                    };
                } catch (e) {
                    addMessage('System', `Error: Invalid JSON Schema for tool '${tool.name}'.`); // Context-specific error
                    return null;
                }
            }).filter(tool => tool !== null);

            let toolChoicePayload = {};
            const current_tool_choice_option = tool_choice; // Parameter to this function

            if (current_tool_choice_option === 'none' || formattedTools.length === 0) {
                toolChoicePayload = {};
                if (formattedTools.length === 0 && current_tool_choice_option !== 'none') {
                    console.log("Chat: makeApiCall - No tools available, though choice was not 'none'. Sending request without tools.");
                } else {
                    console.log("Chat: makeApiCall - Tool choice is 'none' or no tools available. Sending request without tools.");
                }
            } else if (current_tool_choice_option === 'auto') {
                toolChoicePayload = { tools: formattedTools, tool_choice: "auto" };
                console.log("Chat: makeApiCall - Tool choice is 'auto'. Sending with all available tools.");
            } else if (typeof current_tool_choice_option === 'string') { // Specific tool name
                const specificTool = formattedTools.find(t => t.function.name === current_tool_choice_option);
                if (specificTool) {
                    toolChoicePayload = { tools: [specificTool], tool_choice: { type: "function", function: { name: current_tool_choice_option } } };
                    console.log(`Chat: makeApiCall - Tool choice is specific: '${current_tool_choice_option}'. Sending with this tool.`);
                } else {
                    addMessage('System', `Warning: Specified tool "${current_tool_choice_option}" not found. No tools will be sent.`); // Context-specific error
                    console.log(`Chat: makeApiCall - Specified tool "${current_tool_choice_option}" not found. Sending request without tools.`);
                    toolChoicePayload = {};
                }
            }
            // END SHARED API REQUEST PREP LOGIC

            const requestBody = {
                model: config.modelName,
                messages: conversationHistory,
                max_tokens: parseInt(config.maxTokens) || 2048,
                ...toolChoicePayload // Spread the payload
            };

            console.log("Chat: makeApiCall - Final requestBody before sending:", JSON.stringify(requestBody, null, 2));

            const { enableStreaming } = await new Promise(resolve => chrome.storage.sync.get({ enableStreaming: false }, resolve));

            let effectiveEnableStreaming = enableStreaming;
            const hasToolMessage = conversationHistory.some(msg => msg.role === 'tool');

            if (hasToolMessage && enableStreaming) {
                effectiveEnableStreaming = false;
                console.log("Chat: Tool result detected in history, temporarily disabling streaming for this call.");
            }

            if (effectiveEnableStreaming) {
                requestBody.stream = true;
                userInput.disabled = true;
                sendButton.disabled = true;

                const { messageDiv, contentElement, uniqueIdString } = addMessage('LLM', '');
                currentStreamingMessageDiv = messageDiv;
                currentStreamingContentElement = contentElement;
                currentStreamingUniqueId = uniqueIdString;
                accumulatedStreamedText = ""; // Reset for this new stream

                const apiResponse = await fetch(config.llmEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey },
                    body: JSON.stringify(requestBody),
                });

                if (!apiResponse.ok) {
                    const errorText = await apiResponse.text();
                    let errorDetail = errorText;
                    try { const errorJson = JSON.parse(errorText); errorDetail = errorJson.error ? errorJson.error.message : errorText;} catch (e) { /* ignore */ }
                    throw new Error(`API request failed: ${apiResponse.status} ${apiResponse.statusText} - ${errorDetail}`);
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
                const apiResponse = await fetch(config.llmEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey },
                    body: JSON.stringify(requestBody),
                });

                if (!apiResponse.ok) {
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
                    // Fetch tool definition to check if it's an MCP tool
                    (async () => {
                        const allToolsNonStream = await getTools(); // Already async
                        const toolDefinitionNonStream = allToolsNonStream.find(t => t.name === toolCall.function.name);

                        if (toolDefinitionNonStream && toolDefinitionNonStream.mcpProxyUrl) {
                            addMessage('System', `⚙️ Requesting execution for MCP tool: **${toolCall.function.name}**...`);
                        } else {
                            addMessage('System', `⚙️ Requesting execution for tool: **${toolCall.function.name}**...`);
                        }
                        const toolCallForLog = responseMessage.tool_calls[0]; // This was defined before but not used. Keeping it in case it's for logging.
                        chrome.runtime.sendMessage({
                            action: 'executePromptPaulTool',
                            toolCall: { id: toolCall.id, name: toolCall.function.name, arguments: toolCall.function.arguments }
                        }, (response) => {
                             if (chrome.runtime.lastError) { addMessage('System', `Error: ${chrome.runtime.lastError.message}`); return; }
                             if (response.error) {
                                addMessage('System', `Error executing tool ${toolCall.function.name}: ${response.error}`);
                                conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: `Error: ${response.error}` });
                             } else {
                                addMessage('System', `✅ Tool ${toolCall.function.name} executed.`);
                                conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: JSON.stringify(response.result) });
                                console.log("Chat: Preparing to call makeApiCall after tool execution (makeApiCall non-streaming). Current conversationHistory (last 3 messages):");
                                console.log(conversationHistory.slice(-3));
                                makeApiCall();
                             }
                        });
                    })();
                } else if (responseMessage.content) {
                    addMessage('LLM', responseMessage.content);
                } else {
                     addMessage('System', "Received an empty or unexpected response from LLM.");
                }
            }
        } catch (error) {
            console.error("makeApiCall Error:", error);
            addMessage('System', 'Error: ' + error.message);
            userInput.disabled = false;
            sendButton.disabled = false;
            userInput.focus();
        }
    }

    submitBtn.addEventListener('click', async () => {
        activeStreamingToolCall = null; // Reset active tool call
        const instruction = instructionInput.value;
        if (!instruction.trim()) {
            showToast('Please enter an instruction');
            return;
        }
        try {
            const config = await getApiConfig();
            const prompt = instruction + '\n\n' + selectedText;
            let oneOffHistory = [{ role: 'user', content: prompt }];

            const requestBody = {
                model: config.modelName,
                messages: oneOffHistory,
                max_tokens: parseInt(config.maxTokens) || 2048,
            };
            
            const { enableStreaming } = await new Promise(resolve => chrome.storage.sync.get({ enableStreaming: false }, resolve));

            // Display user message in main chat UI
            addMessage('User', instruction + "\n\n[Selected text: " + selectedText.substring(0, 50) + (selectedText.length > 50 ? "..." : "") + "]");
            // Also add to main conversation history for context
            conversationHistory.push({role: 'user', content: prompt});

            let effectiveEnableStreaming = enableStreaming;
            // As per subtask, check global conversationHistory, not oneOffHistory for tool messages.
            const hasToolMessage = conversationHistory.some(msg => msg.role === 'tool');

            if (hasToolMessage && enableStreaming) {
                effectiveEnableStreaming = false;
                console.log("Chat (one-off): Tool result detected in global history, temporarily disabling streaming for this call.");
            }

            if (effectiveEnableStreaming) {
                requestBody.stream = true;
                oneoffInstructionArea.style.display = 'none';
                chatMainArea.style.display = 'block';
                userInput.disabled = true; sendButton.disabled = true;

                const { messageDiv, contentElement, uniqueIdString } = addMessage('LLM', '');
                currentStreamingMessageDiv = messageDiv;
                currentStreamingContentElement = contentElement;
                currentStreamingUniqueId = uniqueIdString;
                accumulatedStreamedText = "";

                const apiResponse = await fetch(config.llmEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey },
                    body: JSON.stringify(requestBody),
                });
                 if (!apiResponse.ok) {
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
                        instructionInput.value = ''; selectedTextDiv.textContent = ''; selectedText = null;
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
                const apiResponse = await fetch(config.llmEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey },
                    body: JSON.stringify(requestBody),
                });
                if (!apiResponse.ok) {
                    const errorText = await apiResponse.text();
                    let errorDetail = errorText;
                    try { const errorJson = JSON.parse(errorText); errorDetail = errorJson.error ? errorJson.error.message : errorText; } catch (e) { /* ignore */ }
                    throw new Error(`API request failed: ${apiResponse.status} ${apiResponse.statusText} - ${errorDetail}`);
                }
                const responseData = await apiResponse.json();
                if (!responseData.choices || !responseData.choices[0] || !responseData.choices[0].message || !responseData.choices[0].message.content) {
                    throw new Error('Invalid response format from API');
                }
                const responseContent = responseData.choices[0].message.content;
                conversationHistory.push({ role: 'assistant', content: responseContent });
                addMessage('LLM', responseContent);

                instructionInput.value = '';
                selectedTextDiv.textContent = '';
                selectedText = null;
                oneoffInstructionArea.style.display = 'none';
                chatMainArea.style.display = 'block';
            }
        } catch (error) {
            showToast('Error: ' + error.message);
            console.error("Error in one-off instruction submission:", error);
            userInput.disabled = false;
            sendButton.disabled = false;
        }
    });

    // --- Summarize Tab Button Functionality ---
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
                        makeApiCall(prompt);
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
                // Optionally, display a message like "No pinned actions yet."
                // For now, just leave it empty or add a placeholder if desired.
                // const placeholder = document.createElement('p');
                // placeholder.textContent = 'No pins';
                // placeholder.style.fontSize = '0.7em';
                // placeholder.style.textAlign = 'center';
                // placeholder.style.color = '#888';
                // pinnedActionsContainer.appendChild(placeholder);
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

                                let prompt = originalInstruction.content;

                                if (tabContent && tabContent.trim() !== "") {
                                    prompt += '\n\nActive Tab Content:\n' + tabContent;
                                }

                                if (selectedText && selectedText.trim() !== "") {
                                    prompt += '\n\nSelected Text:\n' + selectedText;
                                }

                                // Pass the tool_choice from the original instruction
                                makeApiCall(prompt, originalInstruction.tool_choice);
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

    // Initial call to render and listener for changes will be added later.
    // The block for managePinnedActionsButton listener has been removed.

    // Initial rendering of pinned actions
    renderPinnedActions();

    // The chrome.storage.onChanged listener above has been updated to include this logic.
    // No need for a separate listener here.
});
