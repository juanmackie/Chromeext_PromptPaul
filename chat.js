// ===== Main Chat Script - Orchestrates chat functionality =====

import { setupThemeToggle } from './themeUtils.js';

import { ChatStateManager } from './chatStateManager.js';
import { ChatUIRenderer } from './chatUIRenderer.js';
import { ChatMessageHandler } from './chatMessageHandler.js';
import { ChatApiService } from './chatApiService.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOMContentLoaded event fired in chat.js");
    
    // DOM Elements
    const chatArea = document.getElementById('chat-area');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const selectedTextDiv = document.getElementById('selectedText');
    const instructionInput = document.getElementById('instructionInput');
    const submitBtn = document.getElementById('submitBtn');
    const chatMainArea = document.getElementById('chat-main-area');
    const oneoffInstructionArea = document.getElementById('oneoff-instruction-area');
    const clearButton = document.getElementById('clear-button');
    const darkThemeToggle = document.getElementById('darkThemeToggle');

    // Quick Actions Sidebar Elements
    const summarizeTabButton = document.getElementById('summarize-tab-button');
    const pinnedActionsContainer = document.getElementById('pinned-actions-container');
    const explainBtn = document.getElementById('explain-button');

    // Initialize services
    const stateManager = new ChatStateManager();
    const uiRenderer = new ChatUIRenderer(chatArea);
    const messageHandler = new ChatMessageHandler(stateManager, uiRenderer);
    const apiService = new ChatApiService(stateManager, uiRenderer);

    // Setup theme toggle
    if (darkThemeToggle) {
        setupThemeToggle(darkThemeToggle);
    }

    // Listen for storage changes to update pinned actions
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.pinnedQuickActions || changes.instructions)) {
            renderPinnedActions();
        }
    });

    // Explain button handler
    if (explainBtn) {
        explainBtn.addEventListener('click', () => {
            uiRenderer.showToast('Requesting tab content for explanation...');
            chrome.runtime.sendMessage({ action: 'getExplainContent' })
                .then(response => {
                    console.log("Chat.js: Explain button - received response from background:", response);
                    
                    if (response && response.action === 'explainContentResponse') {
                        if (response.success && response.content) {
                            console.log("Chat.js: Explain button - Content received, length:", response.content.length);
                            const prompt = "Explain the following text:\n\n" + response.content;
                            uiRenderer.switchToMainArea(chatMainArea, oneoffInstructionArea);
                            console.log("Chat.js: Explain button - About to call makeApiCall. Prompt length:", prompt.length);
                            makeApiCall(prompt);
                            uiRenderer.showToast('Tab content received, explaining...');
                        } else {
                            console.error("Chat.js: Explain button - Failed to get content or content missing. Success:", response.success, "Error:", response.error);
                            uiRenderer.showToast('No content received for explanation: ' + (response.error || 'Content not available'));
                        }
                    } else {
                        console.warn("Chat.js: Explain button - Received unexpected response action or missing action. Response:", response);
                        uiRenderer.showToast('Received an unexpected response for explain action.');
                    }
                })
                .catch(error => {
                    console.error("Chat.js: Explain button - Error sending getExplainContent message:", error);
                    uiRenderer.showToast(`Error: ${error.message || error}`);
                });
        });
    }

    // Stop API request function
    function stopApiRequest() {
        stateManager.abortCurrentRequest();
    }

    // Clear chat functionality
    function clearChat() {
        uiRenderer.clearChat();
        stateManager.clearHistory();
        stateManager.clearMediaData();
    }

    // Clear button handler
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            if (clearButton.textContent === 'Stop') {
                stopApiRequest();
                uiRenderer.enableInputs(userInput, sendButton);
                uiRenderer.updateClearButton(clearButton, 'Clear');
                stateManager.resetStreamingState();
            } else {
                clearChat();
            }
        });
    }

    // Send message functionality
    function sendMessage() {
        stateManager.clearActiveToolCall(); // Reset active tool call
        const message = userInput.value;
        if (message.trim() === '') return;

        userInput.value = '';
        makeApiCall(message);
    }

    // Input handlers
    if (userInput && sendButton) {
        sendButton.addEventListener('click', sendMessage);
        userInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }

    // One-off instruction handler
    if (submitBtn) {
        submitBtn.addEventListener('click', () => {
            const instruction = instructionInput.value.trim();
            const selectedText = stateManager.getSelectedText();
            
            if (!instruction) {
                uiRenderer.showToast('Please enter an instruction.');
                return;
            }

            if (!selectedText) {
                uiRenderer.showToast('No text selected.');
                return;
            }

            const prompt = `${instruction}\n\nText to process:\n${selectedText}`;
            uiRenderer.switchToMainArea(chatMainArea, oneoffInstructionArea);
            makeApiCall(prompt);
        });
    }

    // API call with media functionality
    async function makeApiCallWithMedia(userMessage, mediaData, tool_choice = 'none') {
        try {
            const config = await apiService.getApiConfig();
            const allAvailableTools = await apiService.getTools();

            if (userMessage) {
                uiRenderer.addMessage('User', userMessage);
                
                const messageContent = [];
                messageContent.push({
                    type: 'text',
                    text: userMessage
                });

                if (mediaData && mediaData.base64) {
                    messageContent.push({
                        type: 'image_url',
                        image_url: {
                            url: `data:${mediaData.mimeType};base64,${mediaData.base64}`
                        }
                    });
                }

                stateManager.addToHistory({ role: 'user', content: messageContent });
            }

            const messagesForRequest = apiService.prepareMessagesForRequest(config);
            const formattedTools = apiService.formatToolsForRequest(allAvailableTools);
            const toolChoicePayload = apiService.prepareToolChoicePayload(tool_choice, formattedTools);

            const requestBody = {
                model: config.modelName,
                messages: messagesForRequest,
                max_tokens: parseInt(config.maxTokens) || 2048,
                ...toolChoicePayload
            };

            const finalRequestBody = apiService.formatRequestForProvider(requestBody, config);
            const fetchHeaders = apiService.getRequestHeaders(config);

            // Create abort controller
            const abortController = new AbortController();
            stateManager.setAbortController(abortController);

            // Make API call
            const apiResponse = await fetch(config.llmEndpoint, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify(finalRequestBody),
                signal: abortController.signal
            });

            if (!apiResponse.ok) {
                const errorText = await apiResponse.text();
                let errorDetail = errorText;
                try { 
                    const errorJson = JSON.parse(errorText); 
                    errorDetail = errorJson.error?.message || errorJson.message || errorText;
                } catch (e) {
                    console.warn('Could not parse error response as JSON:', e);
                }
                throw new Error(`API request failed: ${apiResponse.status} ${apiResponse.statusText} - ${errorDetail}`);
            }

            const responseData = await apiResponse.json();
            console.log("Chat: makeApiCallWithMedia - API Response received:", responseData);

            const responseMessage = responseData.choices[0].message;
            const responseContent = responseMessage.content;

            uiRenderer.addMessage('LLM', responseContent);
            stateManager.addToHistory({ role: 'assistant', content: responseContent });

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('API request was aborted');
                uiRenderer.addMessage('System', 'Request was cancelled.');
            } else {
                console.error('Error in makeApiCallWithMedia:', error);
                uiRenderer.addMessage('System', `Error: ${error.message}`);
            }
        } finally {
            uiRenderer.enableInputs(userInput, sendButton);
            uiRenderer.updateClearButton(clearButton, 'Clear');
        }
    }

    // Main API call functionality
    async function makeApiCall(userMessage = null, tool_choice = 'none') {
        try {
            uiRenderer.disableInputs(userInput, sendButton);
            uiRenderer.updateClearButton(clearButton, 'Stop');

            const config = await apiService.getApiConfig();
            const allAvailableTools = await apiService.getTools();

            const messagesForRequest = apiService.prepareMessagesForRequest(config, userMessage);
            const formattedTools = apiService.formatToolsForRequest(allAvailableTools);
            const toolChoicePayload = apiService.prepareToolChoicePayload(tool_choice, formattedTools);

            const requestBody = {
                model: config.modelName,
                messages: messagesForRequest,
                max_tokens: parseInt(config.maxTokens) || 2048,
                stream: true, // Enable streaming
                ...toolChoicePayload
            };

            const finalRequestBody = apiService.formatRequestForProvider(requestBody, config);
            const fetchHeaders = apiService.getRequestHeaders(config);

            // Create abort controller
            const abortController = new AbortController();
            stateManager.setAbortController(abortController);

            // Start streaming message
            const { messageDiv, contentElement, uniqueIdString } = uiRenderer.addMessage('LLM', '');
            stateManager.initializeStreaming(messageDiv, contentElement, uniqueIdString);

            console.log("Chat: Starting streaming API request...");

            // Make streaming API call
            const response = await fetch(config.llmEndpoint, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify(finalRequestBody),
                signal: abortController.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Handle streaming response
            await handleStreamingResponse(response);

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('API request was aborted');
                uiRenderer.addMessage('System', 'Request was cancelled.');
            } else {
                console.error('Error in makeApiCall:', error);
                uiRenderer.addMessage('System', `Error: ${error.message}`);
            }
        } finally {
            uiRenderer.enableInputs(userInput, sendButton);
            uiRenderer.updateClearButton(clearButton, 'Clear');
            stateManager.resetStreamingState();
        }
    }

    // Handle streaming response
    async function handleStreamingResponse(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            await processStreamingChunk(parsed);
                        } catch (parseError) {
                            console.warn('Failed to parse streaming data:', parseError);
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    // Process individual streaming chunks
    async function processStreamingChunk(chunk) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;

        if (delta.content) {
            stateManager.appendStreamedText(delta.content);
            const currentContentElement = stateManager.currentStreamingContentElement;
            
            if (currentContentElement) {
                const accumulatedText = stateManager.getAccumulatedText();
                if (typeof marked !== 'undefined') {
                    currentContentElement.innerHTML = marked.parse(accumulatedText);
                } else {
                    currentContentElement.textContent = accumulatedText;
                }
                uiRenderer.scrollToBottom();
            }
        }

        if (delta.tool_calls) {
            // Handle tool calls
            console.log('Tool calls in streaming response:', delta.tool_calls);
            // This would need to be implemented based on the specific tool call format
        }
    }

    // Deduplication state for executePrompt
    const processedExecuteIds = new Set();
    let lastExecKey = null;
    let lastExecTs = 0;

        // Chrome runtime message listener
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log("Chat: Received message:", request.action);

        try {
            switch (request.action) {
                case 'setSelectedText':
                    messageHandler.handleSetSelectedText(request, chatMainArea, oneoffInstructionArea, selectedTextDiv);
                    break;

                case 'setMediaForAnalysis':
                    (async () => {
                        const result = await messageHandler.handleSetMediaForAnalysis(request, chatMainArea, oneoffInstructionArea);
                        if (result && result.prompt && result.mediaData) {
                            await makeApiCallWithMedia(result.prompt, result.mediaData);
                        }
                    })();
                    break;

                case 'executePrompt': {
                    // Deduplicate executes arriving close together
                    if (request.messageId) {
                        if (processedExecuteIds.has(request.messageId)) {
                            console.log('Chat: Ignoring duplicate executePrompt with messageId:', request.messageId);
                            return true;
                        }
                        processedExecuteIds.add(request.messageId);
                        // expire after 60 seconds to avoid memory growth
                        setTimeout(() => processedExecuteIds.delete(request.messageId), 60_000);
                    } else {
                        const toolChoice = request.tool_choice || 'none';
                        const promptFrag = (request.prompt || '').slice(0, 256);
                        const dedupKey = `${toolChoice}|${promptFrag}`;
                        const now = Date.now();
                        if (lastExecKey === dedupKey && (now - lastExecTs) < 2000) {
                            console.log('Chat: Ignoring near-duplicate executePrompt (no messageId).');
                            return true;
                        }
                        lastExecKey = dedupKey;
                        lastExecTs = now;
                    }

                    uiRenderer.switchToMainArea(chatMainArea, oneoffInstructionArea);
                    if (request.prompt) {
                        makeApiCall(request.prompt, request.tool_choice || 'none');
                    }
                    break;
                }

                case 'streamApiResponseChunk':
                    messageHandler.handleStreamingResponse(request);
                    break;

                case 'streamApiEnd':
                    messageHandler.handleStreamingComplete(request, userInput, sendButton, clearButton);
                    break;

                case 'streamApiToolCallChunk':
                    messageHandler.handleToolCallChunk(request);
                    break;

                case 'streamApiAnthropicContentBlockStart':
                    messageHandler.handleAnthropicContentBlockStart(request);
                    break;

                case 'streamApiAnthropicMessageStop':
                    messageHandler.handleAnthropicMessageStop(request, userInput, sendButton, clearButton);
                    break;

                case 'handleToolCallResponse':
                    messageHandler.handleToolCallResponse(request);
                    break;

                case 'updatePinnedActions':
                    // Update pinned actions when they change from options page
                    renderPinnedActions();
                    break;

                default:
                    console.warn('Unknown message action:', request.action);
                    // Only send response if one is expected for unknown actions
                    if (request._expectingResponse) {
                        sendResponse({ success: false, error: `Unknown action: ${request.action}` });
                    }
                    break;
            }
        } catch (error) {
            console.error('Error handling message in chat.js:', error);
            if (request._expectingResponse) {
                sendResponse({ success: false, error: error.message });
            }
        }

        return true; // Keep message channel open for async responses
    });

    // Render pinned actions
    async function renderPinnedActions() {
        if (!pinnedActionsContainer) return;

        try {
            const result = await new Promise(resolve => {
                chrome.storage.local.get(['pinnedQuickActions', 'instructions'], resolve);
            });

            const pinnedActions = result.pinnedQuickActions || [];
            const instructions = result.instructions || [];

            pinnedActionsContainer.innerHTML = '';

            // Filter out any action IDs that don't have corresponding instructions or have invalid titles
            const validPinnedActions = pinnedActions.filter(actionId => {
                const instruction = instructions.find(inst => inst.id === actionId);
                return instruction && instruction.title && instruction.title.trim() !== '';
            });

            // Update storage to remove invalid action IDs (cleanup)
            if (validPinnedActions.length !== pinnedActions.length) {
                await chrome.storage.local.set({ pinnedQuickActions: validPinnedActions });
                console.log(`Cleaned up pinned actions, removed ${pinnedActions.length - validPinnedActions.length} invalid entries`);
            }

            validPinnedActions.forEach(actionId => {
                const instruction = instructions.find(inst => inst.id === actionId);
                if (instruction && instruction.title && instruction.title.trim() !== '') {
                    const button = document.createElement('button');
                    button.textContent = instruction.title;
                    button.className = 'pinned-action-btn';
                    button.title = instruction.title;  // Add tooltip with title
                    button.addEventListener('click', () => {
                        executeInstruction(instruction);
                    });
                    pinnedActionsContainer.appendChild(button);
                }
            });
        } catch (error) {
            console.error('Error rendering pinned actions:', error);
        }
    }

    // Execute instruction
    function executeInstruction(instruction) {
        uiRenderer.showToast(`Executing: ${instruction.title}`);
        chrome.runtime.sendMessage({ action: 'getPinnedActionTabContent' })
            .then(response => {
                if (response && response.success && response.content) {
                    const prompt = `${instruction.prompt}\n\nContent:\n${response.content}`;
                    uiRenderer.switchToMainArea(chatMainArea, oneoffInstructionArea);
                    makeApiCall(prompt);
                    uiRenderer.showToast('Content received, processing...');
                } else {
                    uiRenderer.showToast('No content received: ' + (response?.error || 'Content not available'));
                }
            })
            .catch(error => {
                console.error('Error getting tab content:', error);
                uiRenderer.showToast(`Error: ${error.message || error}`);
            });
    }

    // Initialize pinned actions
    renderPinnedActions();

    // Expose functions for debugging
    window.chatDebug = {
        stateManager,
        uiRenderer,
        messageHandler,
        apiService,
        makeApiCall,
        clearChat
    };

    console.log('Chat.js initialization complete - all modules loaded successfully');
});