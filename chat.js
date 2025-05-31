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
// Listen for storage changes to sync theme
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.darkTheme) {
        const isDark = changes.darkTheme.newValue;
        if (darkThemeToggle) darkThemeToggle.checked = !!isDark;
        applyDarkTheme(!!isDark);
    }
});

let selectedText = null;
// let tabId = null; // Removed duplicate declaration
    let tabId = null;
    let currentStreamingMessageDiv = null;
    let currentStreamingContentElement = null; // Specifically for the content area of the streaming LLM message
    let currentStreamingUniqueId = null; // To store the unique ID for icons of the streaming message
    let accumulatedStreamedText = "";

     // Get API configuration
    async function getApiConfig() {
        console.log("Chat: Getting API configuration from local storage");
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
                console.log("Chat: Storage get result:", result);
                const profiles = result.profiles || [];
                const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
                
                console.log("Chat: Profiles:", profiles);
                console.log("Chat: Last selected profile ID:", lastSelectedProfileId);
                
                const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId);
                
                if (!selectedProfile || !selectedProfile.llmEndpoint || !selectedProfile.apiKey || !selectedProfile.modelName) {
                    console.warn("Chat: Selected profile is missing or incomplete");
                    // Try to fall back to default profile
                    const defaultProfile = profiles.find(p => p.id === 'default');
                    if (defaultProfile && defaultProfile.llmEndpoint && defaultProfile.apiKey && defaultProfile.modelName) {
                        console.log("Chat: Using default profile as fallback");
                        resolve(defaultProfile);
                    } else {
                        console.error("Chat: No valid configuration found");
                        reject(new Error('Configuration is incomplete. Please set up the API endpoint, API key, and model name in the options page.'));
                    }
                } else {
                    console.log("Chat: Using configuration from profile:", selectedProfile.name || selectedProfile.id);
                    resolve(selectedProfile);
                }
            });
        });
    }


    // Listen for messages from the background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'setSelectedText') {
            selectedText = request.selectedText;
            tabId = request.tabId; // Store the tab ID
            
            // If this is from the "start_chat" context menu option
            if (request.fromStartChat) {
                // Keep chat area visible, just add the selected text as a user message
                chatMainArea.style.display = 'block'; // Ensure chat area is visible
                oneoffInstructionArea.style.display = 'none'; // Hide one-off instruction area
                
                // Reset conversation history for new chat
                conversationHistory = [];
            } else {
                // For one-off instruction, show the instruction area
                selectedTextDiv.textContent = selectedText; // Update selected text display
                chatMainArea.style.display = 'none'; // Hide chat area
                oneoffInstructionArea.style.display = 'block'; // Show one-off instruction area
            }
        } else if (request.action === 'setApiResponse') {
            console.log("setApiResponse message received", request);
            console.log("chatArea element", chatArea);
            // Ensure chat area is visible when showing API response
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            if (request.apiResponse) {
                // Reset conversation history if it's a new conversation
                if (conversationHistory.length === 0) {
                    conversationHistory = [];
                }

                // If we have a prompt, display it as a user message first
                if (request.prompt) {
                    // For predefined commands, extract just the instruction part
                    const promptLines = request.prompt.split('\n');
                    const instruction = promptLines[0]; // Get just the first line (the instruction)

                    // Add the instruction as a user message
                    addMessage('User', instruction);
                    
                    // Add to conversation history
                    conversationHistory.push({
                        role: 'user',
                        content: request.prompt // Use full prompt for context
                    });
                }

                // Add the API response as an LLM message
                if (chatArea) {
                    addMessage('LLM', request.apiResponse);
                    
                    // Add to conversation history
                    conversationHistory.push({
                        role: 'assistant',
                        content: request.apiResponse
                    });
                } else {
                    console.error("chatArea element is null, cannot add message");
                }
            }
        } else if (request.action === 'streamApiStart') {
            console.log("streamApiStart message received", request);
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            userInput.disabled = true;
            sendButton.disabled = true;

            if (request.prompt) {
                // Display user's prompt. Consider if conversationHistory should be cleared based on context.
                // For now, assume it's part of an ongoing or new chat.
                // If it's a new chat initiated by context menu, background.js might have already sent it.
                // Let's ensure not to double-add if this is simply a follow-up.
                // A simple check could be if the last message in history is already this prompt.
                const lastUserMessage = conversationHistory.length > 0 && conversationHistory[conversationHistory.length -1].role === 'user' ? conversationHistory[conversationHistory.length -1].content : null;
                if (lastUserMessage !== request.prompt) { // Avoid duplicating prompt if already added
                    addMessage('User', request.prompt); // Show the prompt that initiated this stream
                    conversationHistory.push({ role: 'user', content: request.prompt });
                }
            }

            // Create a new message div for the LLM response and store it
            accumulatedStreamedText = ""; // Reset accumulator
            currentStreamingMessageDiv = addMessage('LLM', ''); // Add an empty message
            // addMessage already scrolls to bottom

        } else if (request.action === 'streamApiResponseChunk') {
            if (currentStreamingMessageDiv && request.chunk) {
                accumulatedStreamedText += request.chunk;
                // Update the content of the existing message div
                // The innerHTML part of addMessage handles marked.parse.
                // We need to re-apply marked.parse to the accumulated text.
                // The copy icons are problematic here if we just replace innerHTML.
                // For simplicity, let's update textContent for now, and finalize with marked on streamApiEnd.
                // Or, find the actual content element within currentStreamingMessageDiv.

                // Assuming addMessage structure: div.message > (text or innerHTML with marked) + icons
                // Let's find the text node or main content part if possible, excluding icons.
                // For now, a simpler approach: update the whole message with marked.
                // This will re-add icons each time, which is not ideal.
                // A better way: addMessage returns the content part, not the whole messageDiv.
                // Or, addMessage has an updateContent method.

                // Let's refine addMessage later. For now, update the content.
                // The copy icons will be re-added by addMessage logic if we call it.
                // So, we need to update the content part of currentStreamingMessageDiv.
                // If addMessage adds structure, e.g., <div class="content">...</div><img ...><img ...>
                // we should target div.content.

                // Quick fix: update the messageDiv's innerHTML, but isolate the content part.
                // The current addMessage directly sets innerHTML of messageDiv.
                const contentElement = currentStreamingMessageDiv.querySelector('.llm-content-area'); // Need to add this class in addMessage
                if (contentElement) {
                    contentElement.innerHTML = marked.parse(accumulatedStreamedText);
                } else {
                    // Fallback if specific content area not found (e.g. old addMessage structure)
                    // This will overwrite icons if they are siblings.
                    currentStreamingMessageDiv.innerHTML = marked.parse(accumulatedStreamedText) + currentStreamingMessageDiv.innerHTML.substring(currentStreamingMessageDiv.innerHTML.lastIndexOf("<img"));

                }
                chatArea.scrollTop = chatArea.scrollHeight;
            }
        } else if (request.action === 'streamApiEnd') {
            console.log("streamApiEnd message received", request);
            if (currentStreamingMessageDiv) {
                // Finalize the message with accumulated text
                // This ensures marked.parse is applied to the full content and icons are correctly set up by addMessage
                // To do this properly, we might need to clear the content of currentStreamingMessageDiv and re-populate.
                // Or, better: `addMessage` should handle initial creation, and a separate function updates its content.

                // For now, let's assume accumulatedStreamedText has the full plain text.
                // We will update the existing currentStreamingMessageDiv.
                // The copy icons were added when currentStreamingMessageDiv was created by addMessage('LLM', '').
                // We need to make sure they function with the final text.
                // The current addMessage adds unique IDs to icons.
                // Let's find the content part of the message div.
                // A robust way is for addMessage to return an object { messageDiv, contentElement }.

                // Re-rendering the whole message content with marked and ensuring icons are preserved or re-added correctly.
                // The simplest way that fits the current addMessage structure is to set its innerHTML fully.
                // This implies that the copy icon event listeners need to be re-attached or the icon IDs need to be stable.
                // The uniqueId in addMessage is based on Date.now() at the time of message creation.

                // Let's get the unique ID from the existing icons if possible, or just re-create.
                const existingCopyIcon = currentStreamingMessageDiv.querySelector('img[id^="copy-icon-"]');
                const existingFormattedCopyIcon = currentStreamingMessageDiv.querySelector('img[id^="copy-formatted-icon-"]');
                const uniqueId = existingCopyIcon ? existingCopyIcon.id.replace("copy-icon-", "") : Date.now(); // Fallback if icons not found

                currentStreamingMessageDiv.innerHTML = marked.parse(accumulatedStreamedText) +
                    ` <img id="copy-icon-${uniqueId}" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgMjQgMjQiPgogIDxnIGZpbGw9Im5vbmUiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIHN0cm9rZS13aWR0aD0iMiI+CiAgICA8cGF0aCBkPSJNOCAxMGEyIDIgMCAwIDEgMi0yaDhhMiAyIDAgMCAxIDIgMnY4YTIgMiAwIDAgMS0yIDJoLThhMiAyIDAgMCAxLTItMnoiLz4KICAgIDxwYXRoIGQ9Ik0xNiA4VjZhMiAyIDAgMCAwLTItMkg2YTIgMiAwIDAgMC0yIDJ2OGEyIDIgMCAwIDAgMiAyaDIiLz4KICA8L2c+Cjwvc3ZnPg==" alt="Copy" style="cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;">` +
                    `<img id="copy-formatted-icon-${uniqueId}" src="data:image/png;base64,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" alt="Copy Formatted" style="cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;">`;

                conversationHistory.push({ role: 'assistant', content: accumulatedStreamedText });
            }
            currentStreamingMessageDiv = null;
            accumulatedStreamedText = "";
            userInput.disabled = false;
            sendButton.disabled = false;
            userInput.focus();
        } else if (request.action === 'streamApiToolCallChunk') {
            // Placeholder for handling streamed tool call chunks
            console.log("Chat: Received streamApiToolCallChunk:", request.toolCallChunk);
            // This would require logic to accumulate these chunks and then trigger tool execution.
            // For now, tool calls are expected to be handled by the non-streaming path or a full message after stream.
        }
        } else if (request.action === 'streamApiStart') {
            console.log("Chat: streamApiStart received", request);
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            userInput.disabled = true;
            sendButton.disabled = true;

            if (request.prompt) {
                const lastUserMessage = conversationHistory.length > 0 && conversationHistory[conversationHistory.length -1].role === 'user' ? conversationHistory[conversationHistory.length -1].content : null;
                if (lastUserMessage !== request.prompt || conversationHistory.filter(m => m.role === 'user').length === 0) {
                    addMessage('User', request.prompt);
                    conversationHistory.push({ role: 'user', content: request.prompt });
                }
            }

            accumulatedStreamedText = "";
            const { messageDiv, contentElement, uniqueIdString } = addMessage('LLM', '');
            currentStreamingMessageDiv = messageDiv;
            currentStreamingContentElement = contentElement; // This is the span where text will be appended
            currentStreamingUniqueId = uniqueIdString;
            console.log("Chat: streamApiStart - Created new message div for streaming.", currentStreamingMessageDiv, currentStreamingContentElement, currentStreamingUniqueId);

        } else if (request.action === 'streamApiResponseChunk') {
            if (currentStreamingContentElement && request.chunk != null) {
                accumulatedStreamedText += request.chunk;
                currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
                chatArea.scrollTop = chatArea.scrollHeight;
            } else {
                console.log("Chat: streamApiResponseChunk - No currentStreamingContentElement or chunk is null/undefined.", currentStreamingContentElement, request.chunk);
            }
        } else if (request.action === 'streamApiEnd') {
            console.log("Chat: streamApiEnd received", request);
            if (currentStreamingMessageDiv && currentStreamingContentElement && currentStreamingUniqueId) {
                const finalContent = accumulatedStreamedText;
                currentStreamingContentElement.innerHTML = marked.parse(finalContent); // Final parse

                const copyIconElem = document.getElementById(`copy-icon-${currentStreamingUniqueId}`);
                const copyFormattedIconElem = document.getElementById(`copy-formatted-icon-${currentStreamingUniqueId}`);

                if (copyIconElem && copyFormattedIconElem) {
                   attachCopyListeners(finalContent, currentStreamingContentElement, copyIconElem, copyFormattedIconElem);
                } else {
                    console.error("Chat: streamApiEnd - Could not find copy icons for ID:", currentStreamingUniqueId, currentStreamingMessageDiv);
                }

                const lastAssistantMessage = conversationHistory.length > 0 && conversationHistory[conversationHistory.length -1].role === 'assistant' ? conversationHistory[conversationHistory.length -1].content : null;
                if (lastAssistantMessage !== finalContent) { // Avoid duplicate history entries
                    conversationHistory.push({ role: 'assistant', content: finalContent });
                }
            } else {
                 console.error("Chat: streamApiEnd - Missing streaming elements.", currentStreamingMessageDiv, currentStreamingContentElement, currentStreamingUniqueId);
            }
            // Reset streaming state
            currentStreamingMessageDiv = null;
            currentStreamingContentElement = null;
            currentStreamingUniqueId = null;
            accumulatedStreamedText = "";
            userInput.disabled = false;
            sendButton.disabled = false;
            userInput.focus();
        } else if (request.action === 'streamApiToolCallChunk') {
            console.log("Chat: Received streamApiToolCallChunk (not yet fully implemented):", request.toolCallChunk);
            // Future: Logic to accumulate tool call deltas and handle them.
            // For now, tool calls are primarily handled by the non-streaming response path.
        }
         else if (request.action === 'handleToolCallResponse') {
            console.log("handleToolCallResponse message received", request);
            // Ensure chat area is visible
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';

            const { responseMessage, prompt: originalPrompt } = request;

            // Reset conversation history if it's a new conversation (likely from context menu)
            conversationHistory = [];

            // 1. Display the original prompt/instruction as a user message
            if (originalPrompt) {
                // For predefined commands, extract just the instruction part
                const promptLines = originalPrompt.split('\n');
                const instruction = promptLines[0]; // Get just the first line (the instruction)
                addMessage('User', instruction);

                // Add the full original prompt to history for context
                conversationHistory.push({
                    role: 'user',
                    content: originalPrompt
                });
            }

            // 2. Add the assistant's message (containing tool_calls) to history
            conversationHistory.push(responseMessage);

            // 3. Trigger the tool execution flow (similar to makeApiCall)
            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                // Assuming only one call for now, as handled in makeApiCall
                const toolCall = responseMessage.tool_calls[0];
                const toolName = toolCall.function.name;
                const toolArgs = toolCall.function.arguments;

                addMessage('System', `⚙️ Requesting execution for tool: ${toolName}...`);
                console.log("Tool call requested via handleToolCallResponse:", toolCall);

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
                         addMessage('System', `Error communicating with background script: ${chrome.runtime.lastError.message}`);
                         return;
                    }

                    if (response.error) {
                        console.error(`Error executing tool ${toolName}:`, response.error);
                        addMessage('System', `Error executing tool ${toolName}: ${response.error}`);
                        conversationHistory.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: `Error: ${response.error}`
                        });
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
                        // Call makeApiCall again (without a new user message) to get final response
                        makeApiCall();
                    }
                });
            } else {
                 console.error("handleToolCallResponse received message without tool_calls:", responseMessage);
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

    function clearChat() {
            chatArea.innerHTML = '';
            conversationHistory = [];
            
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
            
            // Make API call with the message
            makeApiCall(message);
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
    
            // --- Tool Call Handling Logic (Phase 2, Step 2) ---
            const responseMessage = responseData.choices[0].message;

            // Add the raw assistant message to history (might contain content or tool_calls)
            conversationHistory.push(responseMessage);

            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                // Handle tool calls (assuming only one call for now, but API might return multiple)
                // TODO: Loop through responseMessage.tool_calls if multiple calls need sequential handling
                const toolCall = responseMessage.tool_calls[0]; // Process the first tool call
                const toolName = toolCall.function.name;
                const toolArgs = toolCall.function.arguments; // Arguments are usually a stringified JSON

                addMessage('System', `⚙️ Requesting execution for tool: ${toolName}...`); // Inform user
                console.log("Tool call requested:", toolCall);

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
                         addMessage('System', `Error communicating with background script: ${chrome.runtime.lastError.message}`);
                         // Potentially stop the flow here or try to recover
                         return;
                    }

                    if (response.error) {
                        console.error(`Error executing tool ${toolName}:`, response.error);
                        addMessage('System', `Error executing tool ${toolName}: ${response.error}`);
                        // Add an error message to history? Or let the user retry?
                        // For now, we'll add an error message to history and let the LLM know.
                        conversationHistory.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: `Error: ${response.error}` // Inform LLM about the error
                        });
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

                        // Call makeApiCall again (without a new user message)
                        // This sends the history including the tool result back to the LLM
                        makeApiCall();
                    }
                });
            } else if (responseMessage.content) {
                // Handle regular text response
                const responseContent = responseMessage.content;
                // Display the response
                addMessage('LLM', responseContent);
            } else {
                 // Handle cases where there's neither content nor tool_calls (should be rare)
                 console.error("API response message has neither content nor tool_calls:", responseMessage);
                 addMessage('System', "Received an empty response from the AI.");
            }
        } catch (error) {
            addMessage('LLM', 'Error: ' + error.message);
        }
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
        copyFormattedIcon.src = "data:image/png;base64,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" alt="Copy Formatted" style="cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;">`;
        } else {
            messageDiv.textContent = sender + ': ' + message;
        }
        chatArea.appendChild(messageDiv);
        if (sender === 'LLM') {
            const copyIcon = document.getElementById('copy-icon-' + uniqueId);
            copyIcon.addEventListener('click', function() {
                navigator.clipboard.writeText(message);
                // Show a toast notification
                var toast = document.createElement('div');
                toast.classList.add('toast');
                toast.textContent = 'Copied markdown text to clipboard';
                document.body.appendChild(toast);
                setTimeout(function() {
                    toast.remove();
                }, 3000); // Remove after 3 seconds
            });

            const copyFormattedIcon = document.getElementById('copy-formatted-icon-' + uniqueId);
            copyFormattedIcon.addEventListener('click', function() {
                // Create a temporary div to hold the formatted content
                const tempDiv = document.createElement('div');
                
                // Clone the message div content
                const contentWithoutIcons = messageDiv.cloneNode(true);
                
                // Remove the copy icons from the cloned content
                const iconsToRemove = contentWithoutIcons.querySelectorAll('img');
                iconsToRemove.forEach(icon => icon.remove());
                
                // Set the HTML content to our temporary div
                tempDiv.innerHTML = contentWithoutIcons.innerHTML;
                
                // Use the clipboard API to copy as rich text (HTML)
                const htmlContent = tempDiv.innerHTML;
                
                // Use the Clipboard API with HTML format
                navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': new Blob([htmlContent], { type: 'text/html' }),
                        'text/plain': new Blob([tempDiv.textContent], { type: 'text/plain' })
                    })
                ]).catch(err => {
                    // Fallback to text-only if the rich copy fails
                    navigator.clipboard.writeText(tempDiv.textContent);
                    console.error('Failed to copy rich text: ', err);
                });
                
                // Show a toast notification
                var toast = document.createElement('div');
                toast.classList.add('toast');
                toast.textContent = 'Copied formatted text to clipboard';
                document.body.appendChild(toast);
                setTimeout(function() {
                    toast.remove();
                }, 3000); // Remove after 3 seconds
            });
        }

        // Ensure scroll to bottom happens after content is rendered
        setTimeout(() => {
            chatArea.scrollTop = chatArea.scrollHeight;
        }, 10);
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
    // Clone and replace to ensure old listeners are removed and new ones are attached.
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
        navigator.clipboard.writeText(rawMessage).then(() => {
            showToast('Copied raw text to clipboard');
        }).catch(err => {
            console.error('Failed to copy raw text: ', err);
            showToast('Error copying raw text.');
        });
    });

    newFormattedCopyIcon.addEventListener('click', function(event) {
        event.stopPropagation();
        const htmlContent = contentElement.innerHTML;
        navigator.clipboard.write([
            new ClipboardItem({
                'text/html': new Blob([htmlContent], { type: 'text/html' }),
                'text/plain': new Blob([rawMessage], { type: 'text/plain' })
            })
        ]).then(() => {
            showToast('Copied formatted HTML to clipboard');
        }).catch(err => {
            console.error('Failed to copy formatted text: ', err);
            navigator.clipboard.writeText(rawMessage).then(() => {
                 showToast('Copied (plain text fallback) to clipboard');
            }).catch(errFallback => {
                console.error('Failed to copy plain text fallback: ', errFallback);
                showToast('Error copying text.');
            });
        });
    });
}

    // Handle submit button click for one-off instruction
    submitBtn.addEventListener('click', async () => {
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

            // No longer showing response in the original tab as a popup overlay
            // Only showing in the sidebar

            // Also show the response in the side panel
            // Add the instruction as a user message and the response as an LLM message
            addMessage('User', instruction + "\\n\\n[Selected text: " + selectedText.substring(0, 50) + (selectedText.length > 50 ? "..." : "") + "]");
            addMessage('LLM', responseContent);

            // Clear the instruction input and selected text after processing and switch back to chat area
            instructionInput.value = '';
            selectedTextDiv.textContent = '';
            selectedText = null; // Reset selected text
            oneoffInstructionArea.style.display = 'none'; // Hide one-off instruction area
            chatMainArea.style.display = 'block'; // Show chat area


        } catch (error) {
            alert('Error: ' + error.message);
        }
    });
});
