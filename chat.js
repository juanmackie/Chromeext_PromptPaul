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
    const summarizeTabButton = document.getElementById('summarize-tab-button');
    const pinnedActionsContainer = document.getElementById('pinned-actions-container');

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
        if (area === 'local' && (changes.pinnedQuickActions || changes.instructions)) {
            renderPinnedActions();
        }
    });

    let selectedText = null;
    let tabId = null; // Keep tabId as it might be used by other parts or future features.
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
        copyIconElement.addEventListener('click', function(event) {
            event.stopPropagation();
            navigator.clipboard.writeText(rawMessage).then(() => showToast('Copied raw text to clipboard'))
                .catch(err => { showToast('Error copying raw text.'); });
        });
        copyFormattedIconElement.addEventListener('click', function(event) {
            event.stopPropagation();
            const htmlContent = contentElement.innerHTML;
            navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([htmlContent], { type: 'text/html' }),
                    'text/plain': new Blob([rawMessage], { type: 'text/plain' })
                })
            ]).then(() => showToast('Copied formatted text to clipboard'))
              .catch(err => {
                navigator.clipboard.writeText(rawMessage).then(() => showToast('Copied (plain text fallback) to clipboard'))
                    .catch(errFallback => { showToast('Error copying text.'); });
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
            const llmContentDiv = document.createElement('div');
            llmContentDiv.classList.add('llm-content-area');

            const { thinkingContent, responseContent } = parseThinkTags(message);

            if (thinkingContent && thinkingContent.length > 0) {
                const thinkingSection = document.createElement('div');
                thinkingSection.classList.add('thinking-section');
                thinkingSection.innerHTML = marked.parse(thinkingContent);
                llmContentDiv.appendChild(thinkingSection);
            }

            const responseSection = document.createElement('div');
            responseSection.classList.add('response-section');
            responseSection.innerHTML = marked.parse(responseContent || "");
            llmContentDiv.appendChild(responseSection);

            messageDiv.appendChild(llmContentDiv);
            contentElement = llmContentDiv;
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
        messageDiv.textContent = message;
    }
    chatArea.appendChild(messageDiv);

    setTimeout(() => {
        chatArea.scrollTop = chatArea.scrollHeight;
    }, 10);
    return { messageDiv, contentElement, uniqueIdString };
}

function parseThinkTags(message) {
    const thinkTagStart = '◁think▷';
    const thinkTagEnd = '◁/think▷';
    const thinkStartIdx = message.indexOf(thinkTagStart);
    const thinkEndIdx = message.indexOf(thinkTagEnd);

    if (thinkStartIdx !== -1 && thinkEndIdx !== -1 && thinkEndIdx > thinkStartIdx) {
        const thinkingContent = message.substring(thinkStartIdx + thinkTagStart.length, thinkEndIdx).trim();
        const beforeThinking = message.substring(0, thinkStartIdx).trim();
        const afterThinking = message.substring(thinkEndIdx + thinkTagEnd.length).trim();
        const responseContent = [beforeThinking, afterThinking].filter(part => part.length > 0).join(' ');
        return { thinkingContent, responseContent };
    } else {
        return { thinkingContent: null, responseContent: message };
    }
}

// --- Message Handlers for chrome.runtime.onMessage ---

function handleSetSelectedText(request) {
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
}

function handleSetApiResponse(request) {
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
        if (request.prompt) {
            const lastMessage = conversationHistory[conversationHistory.length - 1];
            if (!lastMessage || !(lastMessage.role === 'user' && lastMessage.content === request.prompt)) {
                 addMessage('User', request.prompt.split('\n')[0]);
                 conversationHistory.push({ role: 'user', content: request.prompt });
            }
        }
        addMessage('LLM', request.apiResponse);
        const lastAssistantMessage = conversationHistory.length > 0 && conversationHistory[conversationHistory.length -1].role === 'assistant' ? conversationHistory[conversationHistory.length -1].content : null;
        if(lastAssistantMessage !== request.apiResponse){
            conversationHistory.push({ role: 'assistant', content: request.apiResponse });
        }
    }
}

function handleStreamApiStart(request) {
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
}

function handleStreamApiResponseChunk(request) {
    if (activeStreamingToolCall) return;
    if (currentStreamingContentElement && request.chunk != null) {
        accumulatedStreamedText += request.chunk;
        currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

function handleStreamApiEnd(request) {
    let toolCallWasHandledInThisStream = false;

    if (activeStreamingToolCall) {
        toolCallWasHandledInThisStream = true;
        const toolCall = activeStreamingToolCall;

        const assistantMessageWithToolCall = {
            role: 'assistant',
            content: accumulatedStreamedText.trim(),
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
            toolCall: { id: toolCall.id, name: toolCall.function.name, arguments: toolCall.function.arguments }
        }, (response) => {
            if (chrome.runtime.lastError) {
                addMessage('System', `Error: ${chrome.runtime.lastError.message}`);
                conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: `Error: ${chrome.runtime.lastError.message}` });
                userInput.disabled = false; sendButton.disabled = false; userInput.focus();
                return;
            }

            if (response.error) {
                addMessage('System', `❌ Error executing tool ${toolCall.function.name}: ${response.error}`);
                conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: `Error: ${response.error}` });
                userInput.disabled = false; sendButton.disabled = false; userInput.focus();
            } else {
                addMessage('System', `✅ Tool ${toolCall.function.name} executed.`);
                conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: JSON.stringify(response.result) });
                makeApiCall();
            }
        });
        activeStreamingToolCall = null;
    } else {
        userInput.disabled = false;
        sendButton.disabled = false;
        userInput.focus();
    }

    if (currentStreamingMessageDiv && currentStreamingContentElement && currentStreamingUniqueId) {
        const copyIconElem = document.getElementById(`copy-icon-${currentStreamingUniqueId}`);
        const copyFormattedIconElem = document.getElementById(`copy-formatted-icon-${currentStreamingUniqueId}`);

        if (toolCallWasHandledInThisStream) {
            if (currentStreamingContentElement.innerHTML && copyIconElem && copyFormattedIconElem) {
                const toolMessageContent = currentStreamingContentElement.innerText;
                attachCopyListeners(toolMessageContent, currentStreamingContentElement, copyIconElem, copyFormattedIconElem);
            }
        } else {
            const finalContent = accumulatedStreamedText;
            if (finalContent.trim() || currentStreamingContentElement.innerHTML) {
                currentStreamingContentElement.innerHTML = marked.parse(finalContent);
                 if (copyIconElem && copyFormattedIconElem) {
                    attachCopyListeners(finalContent, currentStreamingContentElement, copyIconElem, copyFormattedIconElem);
                }
            }
            if (finalContent.trim()) {
                const lastMessage = conversationHistory[conversationHistory.length - 1];
                if (!lastMessage || !(lastMessage.role === 'assistant' && lastMessage.content === finalContent)) {
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
    currentStreamingMessageDiv = null; currentStreamingContentElement = null; currentStreamingUniqueId = null; accumulatedStreamedText = "";
}

function handleStreamApiToolCallChunk(request) {
    if (currentStreamingMessageDiv && currentStreamingContentElement && request.toolCallChunk && request.toolCallChunk.length > 0) {
        const toolCall = request.toolCallChunk[0];
        activeStreamingToolCall = toolCall;
        currentStreamingContentElement.innerHTML = '';
        currentStreamingContentElement.innerHTML = marked.parse("⚙️ Using tool: **" + toolCall.function.name + "**");
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

function handleToolCallResponseMessage(request) {
    chatMainArea.style.display = 'block';
    oneoffInstructionArea.style.display = 'none';
    userInput.disabled = false;
    sendButton.disabled = false;
    const { responseMessage, prompt: originalPrompt } = request;

    if (conversationHistory.length === 0 && originalPrompt) {
         addMessage('User', originalPrompt.split('\n')[0]);
         conversationHistory.push({ role: 'user', content: originalPrompt });
    }
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


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case 'setSelectedText':
            handleSetSelectedText(request);
            break;
        case 'setApiResponse':
            handleSetApiResponse(request);
            break;
        case 'streamApiStart':
            handleStreamApiStart(request);
            break;
        case 'streamApiResponseChunk':
            handleStreamApiResponseChunk(request);
            break;
        case 'streamApiEnd':
            handleStreamApiEnd(request);
            break;
        case 'streamApiToolCallChunk':
            handleStreamApiToolCallChunk(request);
            break;
        case 'handleToolCallResponse':
            handleToolCallResponseMessage(request);
            break;
        // default:
        //     console.warn("Chat: Received unknown message action:", request.action);
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
        activeStreamingToolCall = null;
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

    async function makeApiCall(userMessage = null, toolChoice = 'none') {
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

            if (toolChoice !== 'none' && formattedTools.length > 0) {
                requestBody.tools = formattedTools;
            }

            const { enableStreaming } = await new Promise(resolve => chrome.storage.sync.get({ enableStreaming: false }, resolve));

            let effectiveEnableStreaming = enableStreaming;
            const hasToolMessage = conversationHistory.some(msg => msg.role === 'tool');

            if (hasToolMessage && enableStreaming) {
                effectiveEnableStreaming = false;
            }

            if (effectiveEnableStreaming) {
                requestBody.stream = true;
                if (toolChoice !== 'none' && formattedTools.length > 0) {
                    if (toolChoice !== 'auto' && toolChoice !== 'none') {
                         requestBody.tool_choice = { type: "function", function: { name: toolChoice }};
                    } else {
                        requestBody.tool_choice = toolChoice;
                    }
                } else if (toolChoice === 'none') {
                    delete requestBody.tools;
                    delete requestBody.tool_choice;
                }

                userInput.disabled = true; sendButton.disabled = true;
                const { messageDiv, contentElement, uniqueIdString } = addMessage('LLM', '');
                currentStreamingMessageDiv = messageDiv; currentStreamingContentElement = contentElement; currentStreamingUniqueId = uniqueIdString;
                accumulatedStreamedText = "";

                const reader = await executeApiRequest(config, requestBody, true);
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
                        userInput.disabled = false;
                        sendButton.disabled = false;
                        currentStreamingMessageDiv = null; currentStreamingContentElement = null; currentStreamingUniqueId = null; accumulatedStreamedText = "";
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
                                    if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                                        if (parsed.choices[0].delta.content) {
                                            accumulatedStreamedText += parsed.choices[0].delta.content;
                                            if (currentStreamingContentElement) {
                                                currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
                                            }
                                            chatArea.scrollTop = chatArea.scrollHeight;
                                        }
                                        // TODO: Add handling for streamed tool calls here if API supports it (example: parsed.choices[0].delta.tool_calls)
                                    }
                                } catch (e) { /* console.warn("SSE JSON Parse Error in makeApiCall:", e, jsonData); */ }
                            }
                        }
                    }
                }
            } else {
                requestBody.stream = false;
                if (toolChoice !== 'none' && formattedTools.length > 0) {
                    if (toolChoice !== 'auto' && toolChoice !== 'none') {
                        requestBody.tool_choice = { type: "function", function: { name: toolChoice }};
                    } else {
                        requestBody.tool_choice = toolChoice;
                    }
                } else if (toolChoice === 'none') {
                    delete requestBody.tools;
                    delete requestBody.tool_choice;
                }

                const responseData = await executeApiRequest(config, requestBody, false);
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
            addMessage('System', 'Error: ' + error.message);
            userInput.disabled = false;
            sendButton.disabled = false;
            userInput.focus();
        }
    }

    submitBtn.addEventListener('click', async () => {
        activeStreamingToolCall = null;
        const instruction = instructionInput.value;
        if (!instruction.trim()) {
            showToast('Please enter an instruction');
            return;
        }
        try {
            const config = await getApiConfig();
            // const toolChoice = config.tool_choice || 'none'; // Not used for one-off
            const prompt = instruction + '\n\n' + selectedText;
            let oneOffHistory = [{ role: 'user', content: prompt }];

            const requestBody = {
                model: config.modelName,
                messages: oneOffHistory,
                max_tokens: parseInt(config.maxTokens) || 2048,
            };
            
            const { enableStreaming } = await new Promise(resolve => chrome.storage.sync.get({ enableStreaming: false }, resolve));

            addMessage('User', instruction + "\n\n[Selected text: " + selectedText.substring(0, 50) + (selectedText.length > 50 ? "..." : "") + "]");
            conversationHistory.push({role: 'user', content: prompt});

            let effectiveEnableStreaming = enableStreaming;
            const hasToolMessage = conversationHistory.some(msg => msg.role === 'tool');

            if (hasToolMessage && enableStreaming) {
                effectiveEnableStreaming = false;
            }

            if (effectiveEnableStreaming) {
                requestBody.stream = true;
                delete requestBody.tools;
                delete requestBody.tool_choice;
                
                oneoffInstructionArea.style.display = 'none'; chatMainArea.style.display = 'block';
                userInput.disabled = true; sendButton.disabled = true;

                const { messageDiv, contentElement, uniqueIdString } = addMessage('LLM', '');
                currentStreamingMessageDiv = messageDiv; currentStreamingContentElement = contentElement; currentStreamingUniqueId = uniqueIdString;
                accumulatedStreamedText = "";

                const reader = await executeApiRequest(config, requestBody, true);
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
                                        if (currentStreamingContentElement) {
                                            currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
                                        }
                                        chatArea.scrollTop = chatArea.scrollHeight;
                                    }
                                } catch (e) { /* console.warn("SSE JSON Parse Error in submitBtn:", e, jsonData); */ }
                            }
                        }
                    }
                }
            } else {
                delete requestBody.tools;
                delete requestBody.tool_choice;
                const responseData = await executeApiRequest(config, requestBody, false);
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
            userInput.disabled = false;
            sendButton.disabled = false;
        }
    });

    // --- Summarize Tab Button Functionality ---
    if (summarizeTabButton) {
        summarizeTabButton.addEventListener('click', async () => {
            showToast('Requesting tab content for summary...');
            
            let toolChoice = 'none';
            try {
                const result = await new Promise((resolve) => {
                    chrome.storage.sync.get(['tool_choice'], resolve); // This tool_choice is for summarize, not one-off
                });
                toolChoice = result.tool_choice || 'none';
            } catch (e) {
                // Error fetching tool_choice, default to 'none'
            }

            chrome.runtime.sendMessage({ action: 'getTabContent' }, (response) => {
                if (chrome.runtime.lastError) {
                    showToast(`Error: ${chrome.runtime.lastError.message}`);
                    return;
                }
                if (response && response.action === 'tabContentResponse') {
                    if (response.content) {
                        const prompt = "Summarize the following text:\n\n" + response.content;
                        chatMainArea.style.display = 'block';
                        oneoffInstructionArea.style.display = 'none';
                        makeApiCall(prompt, toolChoice);
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
        pinnedActionsContainer.innerHTML = '';

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
                // No pinned actions to display
                return;
            }

            currentPins.forEach(pinId => {
                const instruction = allInstructions.find(inst => inst.id === pinId);
                if (instruction) {
                    const button = document.createElement('button');
                    const iconLetter = instruction.name ? instruction.name[0].toUpperCase() : '?';
                    button.textContent = iconLetter;
                    button.title = instruction.name;
                    button.classList.add('quick-action-button', 'pinned-action-item');
                    button.dataset.instructionId = instruction.id;

                    button.addEventListener('click', () => {
                        chatMainArea.style.display = 'block';
                        oneoffInstructionArea.style.display = 'none';

                        let prompt = instruction.content;
                        if (selectedText && selectedText.trim() !== "") {
                            prompt += '\n\nSelected Text:\n' + selectedText;
                        }
                        makeApiCall(prompt); // Pinned actions use default/auto tool_choice from makeApiCall
                        showToast(`Executing: ${instruction.name}`);
                    });
                    pinnedActionsContainer.appendChild(button);
                }
            });
        } catch (error) {
            showStatus("Error loading pinned actions.");
        }
    }

    renderPinnedActions();

});

// --- Core API Call Logic ---
async function executeApiRequest(config, requestBody, isStreaming) {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.apiKey
    };

    const response = await fetch(config.llmEndpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        let errorDetail = errorText;
        try {
            const errorJson = JSON.parse(errorText);
            errorDetail = errorJson.error ? errorJson.error.message : errorText;
        } catch (e) { /* ignore parsing error */ }
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorDetail}`);
    }

    if (isStreaming) {
        return response.body.getReader();
    } else {
        return await response.json();
    }
}
