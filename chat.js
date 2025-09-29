import { setupThemeToggle } from './themeUtils.js';
import { loadingManager } from './loadingManager.js';

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
    let currentAbortController = null;
    let currentMediaData = null; // Store media data for analysis
    let currentThinkingBlockElement = null; // Holds the thinking-block element during streaming

    function stopApiRequest() {
        if (currentAbortController) {
            currentAbortController.abort();
        }
    }

    const inflightRequests = new Map(); // requestId -> { element, type }

    async function getApiConfig() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
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
        copyIcon.src = document.body.classList.contains('dark-theme') ? 'icons/light_copy markdown.png' : 'icons/copy markdown.png';
        copyIcon.alt = "Copy Raw";
        copyIcon.style.cssText = "cursor: pointer; vertical-align: middle; margin-left: 5px; width: 16px; height: 16px;";
        messageDiv.appendChild(copyIcon);

        // --- Icon for copying formatted text ---
        const copyFormattedIcon = document.createElement('img');
        copyFormattedIcon.id = `copy-formatted-icon-${uniqueIdString}`;
        // Replaced base64 string with a file path
        const formattedIconSrc = document.body.classList.contains('dark-theme') ? 'icons/light_copy formatted.png' : 'icons/copy formatted.png';
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

    // Render a single assistant answer using enhanced-thinking-block (non-streaming)
    function appendEnhancedAnswer(answerText) {
        const block = document.createElement('enhanced-thinking-block');
        block.setAttribute('streaming', 'false');
        block.setAttribute('answer', typeof answerText === 'string' ? answerText : (answerText || ''));
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message llm-message';
        messageDiv.appendChild(block);
        chatArea.appendChild(messageDiv);
        setTimeout(() => { chatArea.scrollTop = chatArea.scrollHeight; }, 10);
        return block;
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
        //         console.log("Chat: General onMessage - About to call makeApiCall for explain. Prompt length:", prompt.length);
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
                        
                        console.log('About to call makeApiCallWithMedia with custom instruction:', {
                            type: currentMediaData.type,
                            mimeType: currentMediaData.mimeType,
                            base64Length: currentMediaData.base64 ? currentMediaData.base64.length : 0,
                            hasBase64: !!currentMediaData.base64,
                            actionType: mediaData.actionType,
                            prompt: analysisPrompt.substring(0, 100) + '...'
                        });
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
                    addMessage('System', `\uD83D\uDD0D Analyzing ${currentMediaData.type}...`);
                }
                
                console.log('About to call makeApiCallWithMedia with:', {
                    type: currentMediaData.type,
                    mimeType: currentMediaData.mimeType,
                    base64Length: currentMediaData.base64 ? currentMediaData.base64.length : 0,
                    hasBase64: !!currentMediaData.base64,
                    actionType: mediaData.actionType,
                    prompt: analysisPrompt.substring(0, 100) + '...'
                });
                makeApiCallWithMedia(analysisPrompt, currentMediaData);
            }
        } else if (request.action === 'setApiResponse') {
            if (request.requestId) {
                const block = document.createElement('enhanced-thinking-block');
                block.setAttribute('streaming', 'false');
                block.setAttribute('answer', typeof request.apiResponse === 'string' ? request.apiResponse : (request.apiResponse?.content?.map?.(b => b.type === 'text' ? b.text : '').join('') || ''));
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message llm-message';
                messageDiv.appendChild(block);
                chatArea.appendChild(messageDiv);
                inflightRequests.delete(request.requestId);
                return;
            }
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
            if (request.prompt) { // Add user prompt to history if not already there
                const lastMessage = conversationHistory[conversationHistory.length - 1];
                if (!lastMessage || !(lastMessage.role === 'user' && lastMessage.content === request.prompt)) {
                    addMessage('User', request.prompt.split('\n')[0]); // Display shortened prompt
                    conversationHistory.push({ role: 'user', content: request.prompt });
                }
            }
            if (request.apiResponse && typeof request.apiResponse === 'string') {
                // Standard text response (OpenAI, or Anthropic without MCP blocks, or error string)
                appendEnhancedAnswer(request.apiResponse);
                const lastAssistantMessage = conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'assistant' ? conversationHistory[conversationHistory.length - 1].content : null;
                if (lastAssistantMessage !== request.apiResponse) {
                    conversationHistory.push({ role: 'assistant', content: request.apiResponse });
                }
            } else if (request.apiResponse) { // Fallback for unexpected structure
                 console.warn("Chat: setApiResponse received apiResponse in unexpected format:", request.apiResponse);
                 appendEnhancedAnswer(JSON.stringify(request.apiResponse));
                 conversationHistory.push({ role: 'assistant', content: JSON.stringify(request.apiResponse) });
            }
        } else if (request.action === 'setThinkingApiResponse') {
            // Handle non-streaming responses with thinking blocks
            console.log("Chat: setThinkingApiResponse received", request);
            chatMainArea.style.display = 'block';
            oneoffInstructionArea.style.display = 'none';
            userInput.disabled = false;
            sendButton.disabled = false;
            
            if (request.prompt) { // Add user prompt to history if not already there
                const lastMessage = conversationHistory[conversationHistory.length - 1];
                if (!lastMessage || !(lastMessage.role === 'user' && lastMessage.content === request.prompt)) {
                    addMessage('User', request.prompt.split('\n')[0]); // Display shortened prompt
                    conversationHistory.push({ role: 'user', content: request.prompt });
                }
            }
            
            // Create a thinking block with the thought and answer parts
            const thinkingBlock = document.createElement('thinking-block');
            thinkingBlock.setAttribute('think', request.think || '');
            thinkingBlock.setAttribute('answer', request.answer || '');
            chatArea.appendChild(thinkingBlock);
            
            // Also add the answer to history
            if (request.answer && request.answer.trim()) {
                conversationHistory.push({ role: 'assistant', content: request.answer });
            }
        } else if (request.action === 'streamApiStart') {
            // Create enhanced-thinking-block keyed by requestId
            if (request.requestId) {
                const thinkingBlock = document.createElement('enhanced-thinking-block');
                thinkingBlock.setAttribute('streaming', 'true');
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message llm-message';
                messageDiv.appendChild(thinkingBlock);
                chatArea.appendChild(messageDiv);
                inflightRequests.set(request.requestId, { element: thinkingBlock, type: 'stream' });
                currentStreamingMessageDiv = thinkingBlock;
                currentStreamingContentElement = thinkingBlock;
                currentStreamingUniqueId = request.requestId;
            }
            // Old path below will be effectively ignored due to requestId handling
            console.log("Chat: streamApiStart received for prompt:", request.prompt);
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
            const thinkingBlock = document.createElement('thinking-block');
            // Set initial streaming state
            thinkingBlock.setAttribute('streaming', 'true');
            chatArea.appendChild(thinkingBlock);

            // Use the thinking-block for both thinking and answer parts
            currentStreamingMessageDiv = thinkingBlock;
            currentThinkingBlockElement = thinkingBlock;
            // Reset reasoning accumulator
            currentThinkingBlockElement.reasoningAccumulator = "";
            // Instead of accessing shadowRoot directly, use the element's attributes to update content
            // The thinking-block handles its internal shadow DOM updates
            currentStreamingContentElement = thinkingBlock; // We'll use the element itself to update content via attributes

            console.log("Chat: streamApiStart - Values set: ", {
                currentThinkingBlockElementExists: !!currentThinkingBlockElement,
                currentStreamingMessageDivExists: !!currentStreamingMessageDiv,
                currentStreamingContentElementExists: !!currentStreamingContentElement
            });
        } else if (request.action === 'streamApiThinkingChunk') {
            const info = request.requestId ? inflightRequests.get(request.requestId) : null;
            if (info && info.element) {
                // For enhanced-thinking-block, use 'content' attribute to handle <thinking> tags
                if (info.element.tagName === 'ENHANCED-THINKING-BLOCK') {
                    let content = '';
                    if (request.think !== undefined) {
                        content += `<thinking>${request.think}</thinking>\n`;
                    }
                    if (request.answer !== undefined) {
                        content += request.answer;
                    }
                    info.element.setAttribute('content', content);
                } else {
                    // Fallback for old thinking-block
                    if (request.think !== undefined) info.element.setAttribute('think', request.think);
                    if (request.answer !== undefined) info.element.setAttribute('answer', request.answer);
                }
                chatArea.scrollTop = chatArea.scrollHeight;
                return;
            }
            // Handle streaming chunks with think/answer separation
            if (currentThinkingBlockElement) {
                if (request.think !== undefined) {
                    currentThinkingBlockElement.setAttribute('think', request.think);
                }
                if (request.answer !== undefined) {
                    currentThinkingBlockElement.setAttribute('answer', request.answer);
                    accumulatedStreamedText = request.answer; // Keep accumulatedStreamedText in sync
                }
            }
            chatArea.scrollTop = chatArea.scrollHeight;
        } else if (request.action === 'streamApiResponseChunk') {
            const info = request.requestId ? inflightRequests.get(request.requestId) : null;
            if (info && info.element && request.chunk != null) {
                if (info.element.tagName === 'ENHANCED-THINKING-BLOCK') {
                    // For enhanced thinking block, accumulate content and update using 'content' attribute
                    const currentContent = info.element.getAttribute('content') || '';
                    const thinkingMatch = currentContent.match(/<thinking>(.*?)<\/thinking>/s);
                    const thinkingPart = thinkingMatch ? `<thinking>${thinkingMatch[1]}</thinking>\n` : '';
                    const answerPart = currentContent.replace(/<thinking>.*?<\/thinking>\s*/s, '') + request.chunk;
                    info.element.setAttribute('content', thinkingPart + answerPart);
                } else {
                    // Fallback for old thinking-block
                    info.element.setAttribute('answer', (info.element.getAttribute('answer') || '') + request.chunk);
                }
                chatArea.scrollTop = chatArea.scrollHeight;
                return;
            }
            if (activeStreamingToolCall) return; // If a tool call is active, don't process further text chunks for this bubble
            if (currentStreamingContentElement && (request.chunk != null || request.reasoningChunk != null)) {
                // Handle reasoning content if present
                if (request.reasoningChunk != null && currentThinkingBlockElement) {
                    // Initialize reasoning accumulator if not exists
                    if (!currentThinkingBlockElement.reasoningAccumulator) {
                        currentThinkingBlockElement.reasoningAccumulator = '';
                    }
                    currentThinkingBlockElement.reasoningAccumulator += request.reasoningChunk;
                    // Update the thinking block with accumulated reasoning
                    currentThinkingBlockElement.setAttribute('think', currentThinkingBlockElement.reasoningAccumulator);
                }

                // Handle regular content if present
                if (request.chunk != null) {
                    accumulatedStreamedText += request.chunk;
                    if (currentStreamingMessageDiv && currentStreamingMessageDiv.tagName === 'THINKING-BLOCK') {
                        // Update the answer portion in our thinking block
                        currentStreamingMessageDiv.setAttribute('answer', accumulatedStreamedText);
                    } else {
                        // Fallback to original behavior if not using thinking block
                        currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
                    }
                }

                chatArea.scrollTop = chatArea.scrollHeight;
            }
        } else if (request.action === 'streamApiEnd') {
            const info = request.requestId ? inflightRequests.get(request.requestId) : null;
            if (info && info.element) {
                info.element.setAttribute('streaming', 'false');
                inflightRequests.delete(request.requestId);
                userInput.disabled = false;
                sendButton.disabled = false;
                clearButton.textContent = 'Clear';
                userInput.focus();
                return;
            }
            console.log("Chat: streamApiEnd handler invoked.", request);

            // Check if Anthropic stream was already finalized by 'streamApiAnthropicMessageStop'
            // This flag is set by the streamApiAnthropicMessageStop handler to prevent this streamApiEnd handler
            // from duplicating UI resets and history additions for Anthropic streams.
            if (window.anthropicStreamFinalizedByStopEvent) {
                console.log("Chat: streamApiEnd - Anthropic stream was finalized by streamApiAnthropicMessageStop. This handler will now skip most operations.");
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

            console.log("Chat: Current activeStreamingToolCall (at start of streamApiEnd, non-Anthropic or Anthropic pre-stop):", activeStreamingToolCall);
            console.log("Chat: Current accumulatedStreamedText (at start of streamApiEnd, non-Anthropic or Anthropic pre-stop):", accumulatedStreamedText);
            let toolCallWasHandledInThisStream = false; // Specific to OpenAI-style tool calls

            // Tool call execution logic (FOR OPENAI-STYLE Client-Managed tools)
            if (activeStreamingToolCall) { // This implies it's an OpenAI-style tool call
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
            if (currentStreamingMessageDiv && currentStreamingContentElement) {
                // If we're using a thinking block, finalize both thinking and answer content
                if (currentStreamingMessageDiv?.tagName === 'THINKING-BLOCK') {
                    // Finalize the thinking block - turn off streaming state
                    if (currentThinkingBlockElement) {
                        currentThinkingBlockElement.setAttribute('streaming', 'false');
                        // Keep the accumulated reasoning in the think attribute
                        if (currentThinkingBlockElement.reasoningAccumulator) {
                            currentStreamingMessageDiv.setAttribute('think', currentThinkingBlockElement.reasoningAccumulator);
                        }
                        // Preserve the final answer content in the answer attribute
                        currentStreamingMessageDiv.setAttribute('answer', accumulatedStreamedText);
                    }

                    // Add to history
                    if (accumulatedStreamedText.trim()) {
                        const lastMessage = conversationHistory[conversationHistory.length - 1];
                        if (!lastMessage || !(lastMessage.role === 'assistant' && lastMessage.content === accumulatedStreamedText)) {
                            conversationHistory.push({ role: 'assistant', content: accumulatedStreamedText });
                        }
                    }
                } else if (currentStreamingUniqueId) { // Only do this for regular messages
                    // Original behavior for regular message divs
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
                        if (currentStreamingMessageDiv && currentStreamingMessageDiv.tagName === 'THINKING-BLOCK') {
                            // Update the answer portion in our thinking block
                            currentStreamingMessageDiv.setAttribute('answer', finalContent);
                        } else {
                            if (finalContent.trim() || currentStreamingContentElement.innerHTML) { // only update if there is new content or it was previously populated
                                currentStreamingContentElement.innerHTML = marked.parse(finalContent);
                                if (copyIconElem && copyFormattedIconElem) {
                                    attachCopyListeners(finalContent, currentStreamingContentElement, copyIconElem, copyFormattedIconElem);
                                }
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
            }

            // Reset global streaming variables
            currentStreamingMessageDiv = null;
            currentStreamingContentElement = null;
            currentStreamingUniqueId = null;
            accumulatedStreamedText = "";
            // Reset reasoning accumulator and clear thinking block reference
            if (currentThinkingBlockElement) {
                currentThinkingBlockElement.setAttribute('streaming', 'false');
                currentThinkingBlockElement.reasoningAccumulator = "";
                currentThinkingBlockElement = null;
            }
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
                if (currentStreamingMessageDiv.tagName === 'THINKING-BLOCK') {
                    // Update the thinking block to show tool usage
                    currentStreamingMessageDiv.setAttribute('answer', `⚙️ Using tool: **${toolCall.function.name}**`);
                } else {
                    currentStreamingContentElement.innerHTML = ''; // Clear the display for "Using tool..."
                }
                
                // Asynchronously fetch tool definition to update UI for MCP tool
                (async () => {
                    const allToolsStream = await getTools();
                    const currentToolDefStream = allToolsStream.find(t => t.name === toolCall.function.name);
                    if (currentStreamingContentElement) { // Check if element still exists
                        if (currentStreamingMessageDiv.tagName === 'THINKING-BLOCK') {
                            currentStreamingMessageDiv.setAttribute('answer', `⚙️ Using tool: **${toolCall.function.name}**`);
                        } else {
                            currentStreamingContentElement.innerHTML = marked.parse(`⚙️ Using tool: **${toolCall.function.name}**`);
                        }
                        // chatArea.scrollTop = chatArea.scrollHeight; // Already present after this block
                    }
                })();
                console.log("Chat: UI updated to show 'Using tool' message.");

                // Potentially, actual arguments could be streamed. For now, just the name.
                // If toolCall.function.arguments is a string of streamed arguments, append it:
                // currentStreamingContentElement.innerHTML += marked.parse("\n```\n" + toolCall.function.arguments + "\n```\n");

                chatArea.scrollTop = chatArea.scrollHeight;
            }
        

        } else if (request.action === 'handleToolCallResponse') { // This handles OpenAI-style non-streaming tool calls
            console.log("Chat: handleToolCallResponse (OpenAI-style) received", request);
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
                })();
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
            showToast('Chat history cleared');
    }

    function addMediaPreview(mediaData) {
        const previewDiv = document.createElement('div');
        previewDiv.classList.add('message', 'system-message');
        previewDiv.style.cssText = 'background: #e3f2fd; border-left: 4px solid #2196f3; margin-bottom: 10px;';
        
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
                        <strong>\uD83C\uDFA5 Video Analysis</strong><br>
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
                        <strong>\uD83C\uDFB5 Audio Analysis</strong><br>
                        <small>Right-clicked audio ready for analysis</small>
                    </div>
                </div>
            `;
        }
        
        chatArea.appendChild(previewDiv);
        chatArea.scrollTop = chatArea.scrollHeight;
    }

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
                max_tokens: parseInt(config.maxTokens) || 2048,
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

            console.log("Chat: makeApiCallWithMedia - Final requestBody (without base64 data):", {
                ...requestBody,
                messages: requestBody.messages.map(msg => ({
                    ...msg,
                    content: Array.isArray(msg.content) ? 
                        msg.content.map(c => c.type === 'image_url' ? 
                            {...c, image_url: {...c.image_url, url: `[BASE64_DATA_${c.image_url.url.split(',')[0]}]`}} : c
                        ) : msg.content
                }))
            });

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
        console.log("Chat: getTools - Starting to fetch and process tool definitions.");
        const { promptPaulTools: definedTools = [] } = await new Promise((resolve) => {
            chrome.storage.local.get(['promptPaulTools'], resolve);
        });
        console.log("Chat: getTools - Defined tools from storage:", definedTools);

        const processedTools = [];

        for (const tool of definedTools) {
            let parametersForLlm = {};
            let source = 'manual'; // Default source

            if (false) {
                console.log(`Chat: getTools - Processing MCP tool: ${tool.name} from ${tool.mcpServerUrl}`);
                try {
                    const response = await new Promise((resolve, reject) => {
                        chrome.runtime.sendMessage(
                            { action: 'getDiscoveredMcpToolSchema', mcpServerUrl: tool.mcpServerUrl, toolName: tool.name },
                            (res) => {
                                if (chrome.runtime.lastError) {
                                    console.error(`Chat: getTools - Error sending 'getDiscoveredMcpToolSchema' message for MCP tool ${tool.name}:`, chrome.runtime.lastError.message);
                                    resolve({ success: false, error: `Message sending failed: ${chrome.runtime.lastError.message}` });
                                    return;
                                }
                                if (!res) {
                                    console.error(`Chat: getTools - No response received from 'getDiscoveredMcpToolSchema' for MCP tool ${tool.name}. This might indicate an issue in background.js or the MCP server connection.`);
                                    resolve({ success: false, error: 'No response from background script.' });
                                    return;
                                }
                                console.log(`Chat: getTools - Response from 'getDiscoveredMcpToolSchema' for MCP tool ${tool.name}:`, res);
                                resolve(res);
                            }
                        );
                    });

                    if (response && response.success && response.toolSchema) {
                        console.log(`Chat: getTools - Successfully fetched live schema for MCP tool ${tool.name}. Schema:`, response.toolSchema);
                        // MCP standard is that response.toolSchema IS the tool definition, including name, description, inputSchema
                        parametersForLlm = response.toolSchema.inputSchema || {}; // Ensure it's an object
                        // Optionally, update tool.description if the live one is preferred, though current plan uses stored one as primary.
                        // tool.description = response.toolSchema.description || tool.description;
                        source = 'mcp_discovered';
                        console.log(`Chat: getTools - Using discovered inputSchema for MCP tool ${tool.name}:`, parametersForLlm);
                    } else {
                        console.warn(`Chat: getTools - Failed to get dynamic schema for MCP tool ${tool.name}. Response success: ${response ? response.success : 'N/A'}, Error: ${response ? response.error : 'Response object itself was null/undefined'}. Falling back to manually configured parameters for tool '${tool.name}'.`);
                        source = 'manual_fallback_mcp';
                        if (tool.parameters) {
                            try {
                                parametersForLlm = JSON.parse(tool.parameters);
                            } catch (e) {
                                console.error(`Chat: getTools - Error parsing manual parameters for fallback MCP tool ${tool.name}:`, e);
                                addMessage('System', `Error: Invalid JSON Schema (fallback) for MCP tool '${tool.name}'. Tool will be excluded or have empty schema.`);
                                parametersForLlm = {}; // Keep it an empty object if parsing fails
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Chat: getTools - Exception while fetching schema for MCP tool ${tool.name}:`, error);
                    source = 'manual_fallback_mcp_exception';
                    if (tool.parameters) {
                        try {
                            parametersForLlm = JSON.parse(tool.parameters);
                        } catch (e) {
                            console.error(`Chat: getTools - Error parsing manual parameters for fallback MCP tool ${tool.name} after exception:`, e);
                             addMessage('System', `Error: Invalid JSON Schema (fallback after exception) for MCP tool '${tool.name}'. Tool will be excluded or have empty schema.`);
                            parametersForLlm = {};
                        }
                    }
                }
            } else { // Not an MCP tool, use manual parameters
                console.log(`Chat: getTools - Processing non-MCP tool: ${tool.name}`);
                if (tool.parameters) {
                    try {
                        parametersForLlm = JSON.parse(tool.parameters);
                    } catch (e) {
                        console.error(`Chat: getTools - Error parsing parameters for manual tool ${tool.name}:`, e);
                        addMessage('System', `Error: Invalid JSON Schema for tool '${tool.name}'. Tool will be excluded or have empty schema.`);
                        parametersForLlm = {}; // Keep it an empty object if parsing fails
                    }
                }
            }

            processedTools.push({
                ...tool, // Spread original tool properties
                parametersForLlm: parametersForLlm, // Add the processed parameters
                source: source // Add the source for debugging/info
            });
        }
        console.log("Chat: getTools - Finished processing tools. Result:", processedTools);
        return processedTools;
    }

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
                messages: messagesForRequest,
                max_tokens: parseInt(config.maxTokens) || 2048,
                // toolChoicePayload will be spread conditionally below
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

            // Not an Anthropic endpoint, use standard OpenAI-style tool definition
            Object.assign(requestBody, toolChoicePayload); // Apply OpenAI-style tool choice


            console.log("Chat: makeApiCall - Final requestBody before sending:", JSON.stringify(requestBody, null, 2));
            console.log("Chat: makeApiCall - Final fetchHeaders:", JSON.stringify(fetchHeaders, null, 2));

            const { enableStreaming } = await new Promise(resolve => chrome.storage.sync.get({ enableStreaming: false }, resolve));

            let effectiveEnableStreaming = enableStreaming;
            // For Anthropic MCP, tool results are part of the stream, so this check might not be needed or behave differently.
            // For now, keeping the existing logic for disabling streaming if a 'tool' role message is in history.
            const hasToolMessage = conversationHistory.some(msg => msg.role === 'tool');

            if (hasToolMessage && enableStreaming) { // Disable streaming when tool result is in history
                effectiveEnableStreaming = false;
                console.log("Chat: Tool result detected in history, temporarily disabling streaming for this call.");
            }


            if (effectiveEnableStreaming) { // This includes Anthropic MCP streaming
                // Delegate streaming entirely to background.js with a requestId
                const requestId = Date.now() + '_' + Math.random().toString(36).substring(2, 9);
                inflightRequests.set(requestId, { element: null, type: 'stream' });
                chrome.runtime.sendMessage({ action: 'startApiRequest', requestId, prompt: userMessage, tool_choice });
                return;
                requestBody.stream = true;
                userInput.disabled = true;
                sendButton.disabled = true;
                clearButton.textContent = 'Stop';

                // Create enhanced thinking block for streaming content with thinking tags support
                const thinkingBlock = document.createElement('enhanced-thinking-block');
                thinkingBlock.setAttribute('streaming', 'true');
                
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message llm-message';
                messageDiv.appendChild(thinkingBlock);
                
                chatArea.appendChild(messageDiv);
                
                currentStreamingMessageDiv = thinkingBlock; // Use the enhanced thinking block
                currentStreamingContentElement = thinkingBlock;
                currentStreamingUniqueId = Date.now() + '_' + Math.random().toString(36).substring(2, 9);
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
                                            // Update the enhanced thinking block with streaming content
                                            if(currentStreamingMessageDiv && currentStreamingMessageDiv.tagName === 'ENHANCED-THINKING-BLOCK') {
                                                // Always use 'content' attribute for enhanced thinking block
                                                currentStreamingMessageDiv.setAttribute('content', accumulatedStreamedText);
                                            } else {
                                                currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
                                            }
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
                                conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: JSON.stringify(response.result) });
                                console.log("Chat: Preparing to call makeApiCall after tool execution (makeApiCall non-streaming). Current conversationHistory (last 3 messages):");
                                console.log(conversationHistory.slice(-3));
                                makeApiCall();
                             }
                        });
                    })();
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
                                            if(currentStreamingMessageDiv && currentStreamingMessageDiv.tagName === 'THINKING-BLOCK') {
                                                currentStreamingMessageDiv.setAttribute('answer', accumulatedStreamedText);
                                            } else {
                                                currentStreamingContentElement.innerHTML = marked.parse(accumulatedStreamedText);
                                            }
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

                userInput.disabled = false;
                sendButton.disabled = false;
                clearButton.textContent = 'Clear';
                currentAbortController = null;
            }
        } catch (error) {
            // Show more detailed error messages
            if (error.name === 'AbortError') {
                addMessage('System', 'Response stopped');
            } else {
                let errorMsg = error.message;
                if (error.details) {
                    errorMsg += ` (Details: ${JSON.stringify(error.details)})`;
                }
                showToast('Error: ' + errorMsg);
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
