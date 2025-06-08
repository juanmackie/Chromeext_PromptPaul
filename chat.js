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

    const darkThemeToggle = document.getElementById('darkThemeToggle');
    function applyDarkTheme(isDark) {
        if (isDark) {
            document.body.classList.add('dark-theme');
            if (document.getElementById('darkThemeIcon')) {
                document.getElementById('darkThemeIcon').textContent = 'wb_sunny'; // Sun icon for dark theme
            }
        } else {
            document.body.classList.remove('dark-theme');
            if (document.getElementById('darkThemeIcon')) {
                document.getElementById('darkThemeIcon').textContent = 'brightness_2'; // Moon icon for light theme
            }
        }
    }
    chrome.storage.sync.get({ darkTheme: false }, (result) => {
        if (darkThemeToggle) {
            darkThemeToggle.checked = !!result.darkTheme;
        }
        applyDarkTheme(!!result.darkTheme);
    });
    if (darkThemeToggle) {
        darkThemeToggle.addEventListener('change', (e) => {
            const isDark = darkThemeToggle.checked;
            chrome.storage.sync.set({ darkTheme: isDark });
            applyDarkTheme(isDark);
        });
    }
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.darkTheme) {
            const isDark = changes.darkTheme.newValue;
            if (darkThemeToggle) darkThemeToggle.checked = !!isDark;
            applyDarkTheme(!!isDark);
        }
        // Added conditions for pinned actions and instructions
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

    // Consolidated function to handle streaming responses
    async function handleStreamingResponse(reader, currentStreamingContentElement, currentStreamingUniqueId, isOneOff = false) {
        const decoder = new TextDecoder();
        let sseBuffer = "";
        accumulatedStreamedText = ""; // Reset for each new stream

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
                if (!isOneOff) { // For regular chat, add to main history
                    if (accumulatedStreamedText.trim()) {
                        const lastMessage = conversationHistory[conversationHistory.length - 1];
                        if (!lastMessage || !(lastMessage.role === 'assistant' && lastMessage.content === accumulatedStreamedText)) {
                            conversationHistory.push({ role: 'assistant', content: accumulatedStreamedText });
                        }
                    }
                } else { // For one-off, add to main history as well, as per existing logic
                     conversationHistory.push({ role: 'assistant', content: accumulatedStreamedText });
                }

                // Reset UI and state (common parts)
                currentStreamingMessageDiv = null;
                currentStreamingContentElement = null;
                currentStreamingUniqueId = null;
                // accumulatedStreamedText is reset at the start of this function for the next stream

                userInput.disabled = false;
                sendButton.disabled = false;
                userInput.focus();

                if (isOneOff) {
                    instructionInput.value = '';
                    selectedTextDiv.textContent = '';
                    selectedText = null;
                    oneoffInstructionArea.style.display = 'none';
                    chatMainArea.style.display = 'block';
                }
                break;
            }
            sseBuffer += decoder.decode(value, { stream: true });
            let eolIndex;
            while ((eolIndex = sseBuffer.indexOf('\n')) >= 0) {
                const line = sseBuffer.substring(0, eolIndex).trim();
                sseBuffer = sseBuffer.substring(eolIndex + 1);

                if (line.startsWith('data:')) {
                    let jsonData = line.substring(5).trim();
                    if (jsonData.startsWith('data:')) {
                        jsonData = jsonData.substring(5).trim();
                    }
                    if (jsonData === '[DONE]') {
                        continue;
                    }
                    if (jsonData) {
                        try {
                            const parsed = JSON.parse(jsonData);
                            if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                                accumulatedStreamedText += parsed.choices[0].delta.content;
                                if(currentStreamingContentElement) { // Check if element still exists (might be cleared by other logic)
                                    currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
                                }
                                chatArea.scrollTop = chatArea.scrollHeight;
                            }
                        } catch (e) {
                            console.warn(`SSE JSON Parse Error in handleStreamingResponse (isOneOff: ${isOneOff}):`, e, "Problematic JSON string:", jsonData);
                        }
                    }
                }
            }
        }
    }


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
            llmContentSpan.innerHTML = marked.parse(message || "");
            messageDiv.appendChild(llmContentSpan);
            contentElement = llmContentSpan;
            uniqueIdString = Date.now() + '_' + Math.random().toString(36).substring(2, 9);

            const copyIcon = document.createElement('img');
            copyIcon.id = `copy-icon-${uniqueIdString}`;
            copyIcon.src = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgMjQgMjQiPgogIDxnIGZpbGw9Im5vbmUiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIHN0cm9rZS13aWR0aD0iMiI+CiAgICA8cGF0aCBkPSJNOCAxMGEyIDIgMCAwIDEgMi0yaDhhMiAyIDAgMCAxIDIgMnY4YTIgMiAwIDAgMS0yIDJoLThhMiAyIDAgMCAxLTItMnoiLz4KICAgIDxwYXRoIGQ9Ik0xNiA4VjZhMiAyIDAgMCAwLTItMkg2YTIgMiAwIDAgMC0yIDJ2OGEyIDIgMCAwIDAgMiAyaDIiLz4KICA8L2c+Cjwvc3ZnPg==";
            copyIcon.alt = "Copy Raw";
            copyIcon.style.cssText = "cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;";
            messageDiv.appendChild(copyIcon);

            const copyFormattedIcon = document.createElement('img');
            copyFormattedIcon.id = `copy-formatted-icon-${uniqueIdString}`;
            const formattedIconSrc = "data:image/png;base64,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";
            copyFormattedIcon.src = formattedIconSrc;
            copyFormattedIcon.alt = "Copy Formatted";
style="cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;";
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

                // Display tool usage
                currentStreamingContentElement.innerHTML = marked.parse("⚙️ Using tool: **" + toolCall.function.name + "**");
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
                addMessage('System', `⚙️ Requesting execution for tool: ${toolCall.function.name}...`);
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

    async function makeApiCall(userMessage = null) {
        try {
            const config = await getApiConfig();
            const tools = await getTools();

            if (userMessage) {
                addMessage('User', userMessage);
                conversationHistory.push({ role: 'user', content: userMessage });
            }
            
            const formattedTools = tools.map(tool => {
                try {
                    return {
                        type: 'function',
                        function: { name: tool.name, description: tool.description, parameters: JSON.parse(tool.parameters || '{}') }
                    };
                } catch (e) {
                    addMessage('System', `Error: Invalid JSON Schema for tool '${tool.name}'.`);
                    return null;
                }
            }).filter(tool => tool !== null);

            const requestBody = {
                model: config.modelName,
                messages: conversationHistory,
                max_tokens: parseInt(config.maxTokens) || 2048,
            };

            if (formattedTools.length > 0) {
                requestBody.tools = formattedTools;
            }

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
                await handleStreamingResponse(reader, currentStreamingContentElement, currentStreamingUniqueId, false);

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
                    addMessage('System', `⚙️ Requesting execution for tool: ${toolCall.function.name}...`);
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
                await handleStreamingResponse(reader, currentStreamingContentElement, currentStreamingUniqueId, true);

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

                        let prompt = instruction.content;
                        if (selectedText && selectedText.trim() !== "") {
                            prompt += '\n\nSelected Text:\n' + selectedText;
                        }
                        makeApiCall(prompt);
                        showToast(`Executing: ${instruction.name}`);
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
