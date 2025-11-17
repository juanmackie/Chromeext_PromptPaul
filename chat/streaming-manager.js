import { errorHandler, ErrorSeverity, ErrorCategory, createError } from '../errorHandler.js';

/**
 * Streaming Manager
 * Handles streaming API responses, real-time message updates, and tool call streaming
 * Manages stream lifecycle, buffer management, and UI coordination during streaming
 */
export class StreamingManager {
    constructor(messageRenderer, uiManager) {
        this.messageRenderer = messageRenderer;
        this.uiManager = uiManager;

        // Streaming state
        this.currentStreamingMessageDiv = null;
        this.currentStreamingContentElement = null;
        this.currentStreamingUniqueId = null;
        this.accumulatedStreamedText = "";
        this.activeStreamingToolCall = null;
        this.currentAbortController = null;

        // Stream state flags
        this.isStreaming = false;
        this.anthropicStreamFinalized = false;
    }

    /**
     * Start a new streaming session
     * @param {Object} request - Stream start request
     * @param {Array} conversationHistory - Conversation history array
     * @param {HTMLElement} userInput - User input element
     * @param {HTMLElement} sendButton - Send button element
     * @param {HTMLElement} clearButton - Clear button element
     * @param {Object} loadingManager - Loading manager instance
     * @returns {Object} Stream start result
     */
    startStream(request, conversationHistory, userInput, sendButton, clearButton, loadingManager) {
        console.log("Chat: streamApiStart received for prompt:", request.prompt);

        this.isStreaming = true;
        this.anthropicStreamFinalized = false;

        // Show chat area and hide instruction area
        this.uiManager.toggleAreas({
            chatMainArea: { element: document.getElementById('chat-main-area'), visible: true },
            oneoffInstructionArea: { element: document.getElementById('oneoff-instruction-area'), visible: false }
        });

        // Disable user input during streaming
        userInput.disabled = true;
        sendButton.disabled = true;

        // Add user prompt to history if not already present
        if (request.prompt) {
            const lastMessage = conversationHistory[conversationHistory.length - 1];
            if (!lastMessage || !(lastMessage.role === 'user' && lastMessage.content === request.prompt)) {
                this.messageRenderer.addMessage('User', request.prompt.split('\n')[0]);
                conversationHistory.push({ role: 'user', content: request.prompt });
            }
        }

        // Remove any existing loading message
        this.uiManager.removeCurrentLoadingMessage();

        // Reset accumulated text and create new streaming message
        this.accumulatedStreamedText = "";
        const { messageDiv, contentElement, uniqueIdString } = this.messageRenderer.addMessage('LLM', '');

        this.currentStreamingMessageDiv = messageDiv;
        this.currentStreamingContentElement = contentElement;
        this.currentStreamingUniqueId = uniqueIdString;

        console.log("Chat: streamApiStart - Values set: ", {
            currentStreamingMessageDivExists: !!this.currentStreamingMessageDiv,
            currentStreamingContentElementExists: !!this.currentStreamingContentElement
        });

        return {
            messageDiv,
            contentElement,
            uniqueIdString
        };
    }

    /**
      * Process a stream response chunk (legacy Chrome message API)
      * @param {Object} request - Stream chunk request
      */
     processStreamChunk(request) {
         // Skip text chunks if tool call is active
         if (this.activeStreamingToolCall) return;
 
         if (this.currentStreamingContentElement && request.chunk != null) {
             this.accumulatedStreamedText += request.chunk;
             this.messageRenderer.updateMessageContent(this.currentStreamingContentElement, this.accumulatedStreamedText);
             this.messageRenderer.scrollToBottom(0); // Immediate scroll during streaming
         }
     }

    /**
     * Handle a streaming content chunk from the centralized ApiClient
     * @param {string} contentChunk - Text content delta from the LLM
     */
    handleStreamChunk(contentChunk) {
        if (contentChunk == null) {
            console.warn('🚫 Streaming Manager: Received null content chunk');
            return;
        }

        console.log('📨 Streaming Manager: Processing content chunk:', {
            contentLength: contentChunk.length,
            preview: contentChunk.substring(0, 100) + (contentChunk.length > 100 ? '...' : ''),
            hasActiveStreaming: !!this.currentStreamingContentElement,
            currentAccumulatedLength: this.accumulatedStreamedText.length
        });

        // Adapt the centralized streaming callback into the legacy shape
        this.processStreamChunk({ chunk: contentChunk });
    }

    /**
     * Handle a streaming tool call chunk from the centralized ApiClient
     * @param {Array} toolCallChunks - Array of tool_call delta objects from the LLM
     */
    handleToolCallChunk(toolCallChunks) {
        if (!toolCallChunks || !Array.isArray(toolCallChunks) || toolCallChunks.length === 0) {
            console.warn('🚫 Streaming Manager: Invalid tool call chunks received');
            return;
        }

        console.log('🔧 Streaming Manager: Processing tool call chunks:', {
            chunkCount: toolCallChunks.length,
            chunks: toolCallChunks.map(chunk => ({
                id: chunk.id,
                index: chunk.index,
                hasFunction: !!chunk.function,
                functionName: chunk.function?.name || 'unnamed'
            }))
        });

        // For now we only support a single tool call stream; use the first chunk
        const [firstChunk] = toolCallChunks;
        this.processToolCallChunk({ toolCallChunk: firstChunk });
    }

    /**
     * Process tool call chunk during streaming
     * @param {Object} request - Tool call chunk request
     */
    processToolCallChunk(request) {
        if (!request.toolCallChunk) return;

        console.log("Chat: Received tool_call chunk:", request.toolCallChunk);

        const toolCallChunk = request.toolCallChunk;
        if (toolCallChunk.function) {
            console.log("Chat: Tool Call Chunk Function:", toolCallChunk.function);

            // For tool calls, the "index" property is important for handling multiple tool calls
            if (toolCallChunk.index === 0) { // Assuming single tool call for simplicity
                console.log("Chat: Processing tool call for index 0");

                // Initialize activeStreamingToolCall if not already set
                if (!this.activeStreamingToolCall) {
                    console.log("Chat: Creating new activeStreamingToolCall object");
                    this.activeStreamingToolCall = {
                        id: toolCallChunk.function?.id || `tool_call_${Date.now()}`,
                        type: toolCallChunk.type || 'function',
                        function: {
                            name: toolCallChunk.function.name || '',
                            arguments: toolCallChunk.function.arguments || ''
                        }
                    };
                } else {
                    console.log("Chat: Updating existing activeStreamingToolCall object");
                    // Update existing tool call
                    this.activeStreamingToolCall.function.name = this.activeStreamingToolCall.function.name || toolCallChunk.function.name || '';
                    if (toolCallChunk.function.arguments) {
                        this.activeStreamingToolCall.function.arguments += toolCallChunk.function.arguments;
                    }
                }

                console.log("Chat: Updated activeStreamingToolCall:", this.activeStreamingToolCall);
            }
        }
    }

    /**
     * Process Anthropic content block start
     * @param {Object} request - Anthropic content block start request
     */
    processAnthropicContentBlockStart(request) {
        console.log("Chat: Received Anthropic content block start:", request);

        // Reset any existing streaming state for Anthropic
        if (request.block && request.block.type === 'text') {
            console.log("Chat: Resetting streaming state for Anthropic text content block");
            this.accumulatedStreamedText = "";
        }
    }

    /**
     * Process Anthropic message stop
     * @param {Object} request - Anthropic message stop request
     * @param {Array} conversationHistory - Conversation history array
     * @param {HTMLElement} userInput - User input element
     * @param {HTMLElement} sendButton - Send button element
     * @param {HTMLElement} clearButton - Clear button element
     * @param {Object} loadingManager - Loading manager instance
     */
    processAnthropicMessageStop(request, conversationHistory, userInput, sendButton, clearButton, loadingManager) {
        console.log("Chat: Received Anthropic message stop event:", request);

        // Finalize the stream
        this.finalizeStream(request, conversationHistory, userInput, sendButton, clearButton, loadingManager);

        // Set flag to indicate Anthropic stream was finalized
        this.anthropicStreamFinalized = true;
        window.anthropicStreamFinalizedByStopEvent = true;
    }

    /**
     * End the current streaming session
     * @param {Object} request - Stream end request
     * @param {Array} conversationHistory - Conversation history array
     * @param {HTMLElement} userInput - User input element
     * @param {HTMLElement} sendButton - Send button element
     * @param {HTMLElement} clearButton - Clear button element
     * @param {Object} loadingManager - Loading manager instance
     */
    endStream(request, conversationHistory, userInput, sendButton, clearButton, loadingManager) {
        console.log("Chat: streamApiEnd handler invoked.", request);

        // Check if Anthropic stream was already finalized
        if (this.anthropicStreamFinalized) {
            console.log("Chat: streamApiEnd - Anthropic stream was finalized by streamApiAnthropicMessageStop. Performing minimal cleanup.");
            this.anthropicStreamFinalized = false; // Reset flag
            window.anthropicStreamFinalizedByStopEvent = false;

            // Perform minimal cleanup
            this.resetUIState(userInput, sendButton, clearButton, loadingManager);
            this.resetStreamingState();
            return;
        }

        this.finalizeStream(request, conversationHistory, userInput, sendButton, clearButton, loadingManager);
    }

    /**
     * Finalize streaming with common logic
     * @param {Object} request - Stream end request
     * @param {Array} conversationHistory - Conversation history array
     * @param {HTMLElement} userInput - User input element
     * @param {HTMLElement} sendButton - Send button element
     * @param {HTMLElement} clearButton - Clear button element
     * @param {Object} loadingManager - Loading manager instance
     */
    finalizeStream(request, conversationHistory, userInput, sendButton, clearButton, loadingManager) {
        console.log("Chat: Finalizing stream. Current activeStreamingToolCall:", this.activeStreamingToolCall);
        console.log("Chat: Current accumulatedStreamedText:", this.accumulatedStreamedText);

        let toolCallWasHandled = false;

        // Handle OpenAI-style tool calls
        if (this.activeStreamingToolCall) {
            console.log("Chat: Processing activeStreamingToolCall");
            toolCallWasHandled = true;
            const toolCall = this.activeStreamingToolCall;

            const assistantMessageWithToolCall = {
                role: 'assistant',
                content: this.accumulatedStreamedText.trim(),
                tool_calls: [toolCall]
            };

            // Add to conversation history if not already present
            const lastHistoryMessage = conversationHistory[conversationHistory.length - 1];
            if (!lastHistoryMessage ||
                !(lastHistoryMessage.role === 'assistant' &&
                  lastHistoryMessage.tool_calls &&
                  lastHistoryMessage.tool_calls[0] &&
                  lastHistoryMessage.tool_calls[0].id === toolCall.id)) {
                conversationHistory.push(assistantMessageWithToolCall);
            }

            // Execute tool call
            this.executeToolCall(toolCall, request, loadingManager);
        }

        // Handle regular text response (no tool call)
        if (!toolCallWasHandled && this.accumulatedStreamedText.trim()) {
            const assistantMessage = {
                role: 'assistant',
                content: this.accumulatedStreamedText.trim()
            };

            // Check if last message is already this content
            const lastHistoryMessage = conversationHistory[conversationHistory.length - 1];
            if (!lastHistoryMessage ||
                !(lastHistoryMessage.role === 'assistant' && lastHistoryMessage.content === assistantMessage.content)) {
                conversationHistory.push(assistantMessage);
            }
        }

        // After the stream is complete, (re)attach copy listeners so they use the full streamed text
        try {
            if (this.currentStreamingContentElement &&
                this.currentStreamingUniqueId &&
                this.accumulatedStreamedText.trim()) {

                const rawIcon = document.getElementById(`copy-Raw-icon-${this.currentStreamingUniqueId}`);
                const formattedIcon = document.getElementById(`copy-Formatted-icon-${this.currentStreamingUniqueId}`);

                if (rawIcon && formattedIcon && this.messageRenderer?.attachCopyListeners) {
                    // Use the accumulated streamed text as the raw message for copy handlers
                    this.messageRenderer.attachCopyListeners(
                        this.accumulatedStreamedText,
                        this.currentStreamingContentElement,
                        rawIcon,
                        formattedIcon
                    );
                }
            }
        } catch (e) {
            console.warn('Chat: Failed to rebind copy listeners after streaming:', e);
        }

        // Reset UI state
        this.resetUIState(userInput, sendButton, clearButton, loadingManager);
        this.resetStreamingState();
    }

    /**
     * Execute a tool call from streaming response
     * @param {Object} toolCall - Tool call object
     * @param {Object} request - Original request object
     * @param {Object} loadingManager - Loading manager instance
     */
    async executeToolCall(toolCall, request, loadingManager) {
        console.log("Chat: Executing tool call:", toolCall);

        try {
            // Send tool execution request to background script
            const response = await chrome.runtime.sendMessage({
                action: 'executePromptPaulTool',
                toolCall: {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments
                }
            });

            if (response.error) {
                console.error('Chat: Tool execution failed:', response.error);
                this.messageRenderer.addMessage('System', `Tool execution error: ${response.error}`);
            } else if (response.result) {
                console.log('Chat: Tool execution result:', response.result);
                // Add tool result to conversation
                const toolResultMessage = {
                    role: 'tool',
                    content: JSON.stringify(response.result),
                    tool_call_id: toolCall.id
                };
                // This would typically be handled by the conversation manager
            }
        } catch (error) {
            console.error('Chat: Error executing tool call:', error);
            await errorHandler.handleError(createError('Tool execution failed', {
                category: ErrorCategory.TOOL_EXECUTION,
                severity: ErrorSeverity.MEDIUM,
                originalError: error,
                context: { toolCall }
            }));
            this.messageRenderer.addMessage('System', `Tool execution error: ${error.message}`);
        }
    }

    /**
     * Reset UI state after streaming
     * @param {HTMLElement} userInput - User input element
     * @param {HTMLElement} sendButton - Send button element
     * @param {HTMLElement} clearButton - Clear button element
     * @param {Object} loadingManager - Loading manager instance
     */
    resetUIState(userInput, sendButton, clearButton, loadingManager) {
        // Enable user input if provided
        if (userInput) {
            userInput.disabled = false;
        }
        if (sendButton) {
            sendButton.disabled = false;
        }
 
        // Reset button text and loading state safely
        if (clearButton) {
            clearButton.textContent = 'Clear';
        }
        if (loadingManager && typeof loadingManager.setButtonLoading === 'function') {
            loadingManager.setButtonLoading(sendButton || null, false);
        }
        if (sendButton) {
            sendButton.textContent = 'Send';
        }
 
        // Focus input if available
        if (userInput) {
            userInput.focus();
        }
 
        // Remove loading message if exists
        this.uiManager.removeCurrentLoadingMessage();
    }

    /**
     * Reset streaming state variables
     */
    resetStreamingState() {
        this.currentStreamingMessageDiv = null;
        this.currentStreamingContentElement = null;
        this.currentStreamingUniqueId = null;
        this.accumulatedStreamedText = "";
        this.activeStreamingToolCall = null;
        this.isStreaming = false;
        this.currentAbortController = null;
    }

    /**
     * Stop the current streaming request
     */
    stopStreaming() {
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
        }

        if (this.isStreaming) {
            this.resetStreamingState();
            this.messageRenderer.addMessage('System', 'Request stopped by user');
        }
    }

    /**
     * Get current streaming state
     * @returns {Object} Current streaming state
     */
    getStreamingState() {
        return {
            isStreaming: this.isStreaming,
            hasActiveToolCall: !!this.activeStreamingToolCall,
            accumulatedTextLength: this.accumulatedStreamedText.length,
            hasStreamingMessage: !!this.currentStreamingMessageDiv,
            anthropicStreamFinalized: this.anthropicStreamFinalized
        };
    }

    /**
     * Check if currently streaming
     * @returns {boolean} True if streaming is active
     */
    isActive() {
        return this.isStreaming;
    }

    /**
     * Get accumulated text
     * @returns {string} Accumulated streamed text
     */
    getAccumulatedText() {
        return this.accumulatedStreamedText;
    }

    /**
     * Get current tool call if active
     * @returns {Object|null} Active tool call or null
     */
    getActiveToolCall() {
        return this.activeStreamingToolCall;
    }

    /**
     * Create abort controller for new request
     * @returns {AbortController} New abort controller
     */
    createAbortController() {
        this.currentAbortController = new AbortController();
        return this.currentAbortController;
    }

    /**
     * Handle streaming errors
     * @param {Error} error - Streaming error
     * @param {HTMLElement} userInput - User input element
     * @param {HTMLElement} sendButton - Send button element
     * @param {Object} loadingManager - Loading manager instance
     */
    handleStreamingError(error, userInput, sendButton, loadingManager) {
        console.error('💥 Streaming Manager: Streaming error occurred:', {
            name: error.name,
            message: error.message,
            stack: error.stack?.substring(0, 500),
            streamingState: this.getStreamingState()
        });

        // Add error message to chat with enhanced styling
        const errorMessage = `Streaming error: ${error.message}`;
        this.messageRenderer.addMessage('System', errorMessage, { isError: true });

        // Add helpful guidance for common streaming issues
        let helpMessage = '💡 **To fix this**: Please try the following:\n';
        if (error.message.includes('timeout')) {
            helpMessage += '- Check your internet connection\n';
            helpMessage += '- Try sending a shorter message\n';
            helpMessage += '- Wait a moment and try again';
        } else if (error.message.includes('network')) {
            helpMessage += '- Check your internet connection\n';
            helpMessage += '- Verify the API endpoint is accessible\n';
            helpMessage += '- Try refreshing the page';
        } else {
            helpMessage += '- Check your API configuration\n';
            helpMessage += '- Try sending the message again\n';
            helpMessage += '- If the issue persists, contact support';
        }

        this.messageRenderer.addMessage('System', helpMessage, { isHelp: true });

        // Reset state
        this.resetUIState(userInput, sendButton, null, loadingManager);
        this.resetStreamingState();

        // Log error for analytics with context
        errorHandler.handleError(createError('Streaming failed', {
            category: ErrorCategory.NETWORK,
            severity: ErrorSeverity.MEDIUM,
            originalError: error,
            context: {
                accumulatedTextLength: this.accumulatedStreamedText.length,
                hadActiveToolCall: !!this.activeStreamingToolCall,
                wasStreaming: this.isStreaming
            }
        }));
    }

    /**
     * Update streaming message content manually
     * @param {string} content - New content to add
     */
    updateStreamingContent(content) {
        if (this.currentStreamingContentElement && content) {
            this.accumulatedStreamedText += content;
            this.messageRenderer.updateMessageContent(this.currentStreamingContentElement, this.accumulatedStreamedText);
            this.messageRenderer.scrollToBottom(0);
        }
    }

    /**
     * Set active tool call manually
     * @param {Object} toolCall - Tool call object
     */
    setActiveToolCall(toolCall) {
        this.activeStreamingToolCall = toolCall;
    }

    /**
     * Clear accumulated text
     */
    clearAccumulatedText() {
        this.accumulatedStreamedText = "";
    }
}