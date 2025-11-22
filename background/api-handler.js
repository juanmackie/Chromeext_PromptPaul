import { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync } from '../errorHandler.js';
import analytics from '../analytics.js';
import { apiClient } from '../services/api-client.js';

/**
 * API Handler
 * Manages LLM API requests including streaming and non-streaming responses
 * Handles tool choices, message formatting, and error management
 */
export class ApiHandler {
    constructor() {
        this.defaultMaxTokens = 2048;
        this.errorDelayMap = {
            startChat: 300,
            regular: 200
        };
    }

    /**
     * Make an LLM API request with optional streaming
     * @param {string} promptContent - The prompt to send
     * @param {string|null} tabId - Tab ID for response routing
     * @param {Object} options - Request options
     * @param {boolean} options.isStartChat - Whether this is starting a new chat
     * @param {string} options.customInstructionToolChoice - Tool choice setting
     * @returns {Promise<void>}
     */
    async makeLlmApiRequest(promptContent, tabId, { isStartChat = false, customInstructionToolChoice = 'none' } = {}) {
        // DEBUG: Validate input parameters
        console.log('[DEBUG API_HANDLER] makeLlmApiRequest called with:', {
            promptLength: promptContent?.length,
            tabId: tabId,
            tabIdType: typeof tabId,
            isStartChat: isStartChat,
            customInstructionToolChoice: customInstructionToolChoice
        });
        
        if (!promptContent || typeof promptContent !== 'string') {
            console.error('[DEBUG API_HANDLER] Invalid prompt content:', promptContent);
            throw new Error('Invalid prompt content provided to makeLlmApiRequest');
        }
        
        if (tabId !== null && (typeof tabId !== 'number' || tabId < 0)) {
            console.error('[DEBUG API_HANDLER] Invalid tabId received:', tabId, 'type:', typeof tabId);
            // Don't throw here, just log and continue - tabId can be null for some operations
        }
        
        let config, tools, enableStreaming;
        try {
            // Step 1: Validate configuration and get tool definitions
            try {
                const results = await Promise.all([
                    this.validateConfig(),
                    this.getAllToolDefinitions(),
                    this.getStreamingSettings()
                ]);
                config = results[0];
                tools = results[1];
                enableStreaming = results[2];
            } catch (error) {
                // Check if this is the specific configuration error we're looking for
                if (error.message === "LLM API endpoint is missing or invalid. Please configure it in the options page.") {
                    console.warn("Background: Caught specific LLM endpoint configuration error.");
                    this.sendConfigurationErrorToChat(promptContent, tabId);
                    return; // Stop further execution in this function
                }
                // If it's a different error from validateConfig or other setup, re-throw it
                throw error;
            }

            // Build messages for API client
            const messages = this.buildMessages(config, promptContent);

            console.log("Background: Making API request with centralized client");

            if (enableStreaming) {
                // Use centralized API client for streaming
                await apiClient.makeStreamingRequest(
                    config,
                    {
                        messages,
                        tools,
                        toolChoice: customInstructionToolChoice,
                        stream: true
                    },
                    // Chunk callback for streaming responses
                    (chunk) => {
                        if (chunk.type === 'content') {
                            // Forward content chunk to chat via runtime message
                            chrome.runtime.sendMessage({
                                action: 'streamApiResponseChunk',
                                chunk: chunk.content,
                                tabId: tabId,
                                prompt: promptContent
                            }).catch(error => console.log(`Error sending streamApiResponseChunk: ${error.message}, tabId: ${tabId}`));
                        } else if (chunk.type === 'tool_call') {
                            // Forward tool call chunk
                            chrome.runtime.sendMessage({
                                action: 'streamApiToolCallChunk',
                                toolCallChunk: chunk.tool_calls,
                                tabId: tabId,
                                prompt: promptContent
                            }).catch(error => console.log(`Error sending streamApiToolCallChunk: ${error.message}, tabId: ${tabId}`));
                        }
                    }
                );

                // Send completion message
                chrome.runtime.sendMessage({
                    action: 'streamApiEnd',
                    tabId: tabId,
                    prompt: promptContent
                }).catch(error => console.log(`Error sending streamApiEnd: ${error.message}, tabId: ${tabId}`));

            } else {
                // Use centralized API client for non-streaming
                const responseData = await apiClient.makeRequest(
                    config,
                    {
                        messages,
                        tools,
                        toolChoice: customInstructionToolChoice,
                        stream: false
                    }
                );

                // Handle non-streaming response
                const messageObject = responseData.choices && responseData.choices[0] ? responseData.choices[0].message : null;

                if (!messageObject) {
                    throw createError('Invalid response format from API: Missing message structure', {
                        category: ErrorCategory.NETWORK,
                        severity: ErrorSeverity.HIGH
                    });
                }

                await this.handleApiResponseAndSendMessage(messageObject, promptContent, tabId, isStartChat);
            }

        } catch (error) {
            await this.handleApiError(error, promptContent, tabId, isStartChat);
        }
    }

    /**
     * Prepare tool choices and formatted tools for API request
     * @param {Array} tools - Available tools
     * @param {string|Array} customInstructionToolChoice - Tool choice setting
     * @returns {Object} Formatted tools and tool choice payload
     */
    prepareToolChoices(tools, customInstructionToolChoice) {
        const formattedTools = tools.map(tool => {
            try {
                return {
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: JSON.parse(tool.parameters || '{}')
                    }
                };
            } catch (e) {
                console.error(`Background: Error parsing parameters for tool ${tool.name}:`, e);
                return null;
            }
        }).filter(tool => tool !== null);

        let toolChoicePayload = {};

        if (customInstructionToolChoice === 'none' || formattedTools.length === 0) {
            toolChoicePayload = {};
            if (formattedTools.length === 0 && customInstructionToolChoice !== 'none') {
                console.warn("Background: makeLlmApiRequest - No tools available, though choice was not 'none'. Sending request without tools.");
            } else {
                console.log("Background: makeLlmApiRequest - Tool choice is 'none' or no tools available. Sending request without tools.");
            }
        } else if (customInstructionToolChoice === 'auto') {
            toolChoicePayload = { tools: formattedTools, tool_choice: "auto" };
            console.log("Background: makeLlmApiRequest - Tool choice is 'auto'. Sending with all available tools.");
        } else if (typeof customInstructionToolChoice === 'string') {
            const specificTool = formattedTools.find(t => t.function.name === customInstructionToolChoice);
            if (specificTool) {
                toolChoicePayload = { tools: [specificTool], tool_choice: { type: "function", function: { name: customInstructionToolChoice } } };
                console.log(`Background: makeLlmApiRequest - Tool choice is specific: '${customInstructionToolChoice}'. Sending with this tool.`);
            } else {
                console.warn(`Background: Specified tool "${customInstructionToolChoice}" not found. No tools will be sent.`);
                toolChoicePayload = {};
            }
        } else if (Array.isArray(customInstructionToolChoice) && customInstructionToolChoice.length > 0) {
            const selectedTools = formattedTools.filter(tool =>
                customInstructionToolChoice.includes(tool.function.name)
            );
            if (selectedTools.length > 0) {
                const tcObject = selectedTools.length === 1
                    ? { type: 'function', function: { name: selectedTools[0].function.name } }
                    : "auto";

                toolChoicePayload = { tools: selectedTools, tool_choice: tcObject };
                console.log(`Background: makeLlmApiRequest - Tool choice is an array. Making these tools available: ${selectedTools.map(t=>t.function.name).join(', ')} with choice:`, tcObject);
            } else {
                console.warn(`Background: Specified tools in array "${customInstructionToolChoice}" not found. No tools will be sent.`);
                toolChoicePayload = {};
            }
        } else {
            console.warn(`Background: Invalid tool choice format: ${customInstructionToolChoice}. Defaulting to no tools.`);
            toolChoicePayload = {};
        }

        return { formattedTools, toolChoicePayload };
    }

    /**
     * Build API request components
     * @param {Object} config - API configuration
     * @param {string} promptContent - Prompt content
     * @param {Array} formattedTools - Formatted tools
     * @param {Object} toolChoicePayload - Tool choice configuration
     * @param {boolean} enableStreaming - Whether to enable streaming
     * @returns {Object} API request components
     */
    buildApiRequest(config, promptContent, formattedTools, toolChoicePayload, enableStreaming) {
        const messages = this.buildMessages(config, promptContent);

        const apiRequestBody = {
            model: config.modelName,
            messages: messages,
            max_tokens: parseInt(config.maxTokens) || this.defaultMaxTokens,
        };

        // Add tool choice payload to request body
        Object.assign(apiRequestBody, toolChoicePayload);

        if (enableStreaming) {
            apiRequestBody.stream = true;
        }

        const fetchHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        };

        return { messages, apiRequestBody, fetchHeaders };
    }

    /**
     * Build message array for API request
     * @param {Object} config - Configuration
     * @param {string} promptContent - Prompt content
     * @returns {Array} Message array
     */
    buildMessages(config, promptContent) {
        const messages = [];
        const now = new Date();
        const dateTimeString = `Date: ${now.toLocaleDateString()} Time: ${now.toLocaleTimeString()}`;

        let systemPromptContent = dateTimeString;
        if (config.systemPrompt && config.systemPrompt.trim() !== '') {
            systemPromptContent += `\n\n${config.systemPrompt}`;
        }

        messages.push({ role: 'system', content: systemPromptContent });
        messages.push({ role: 'user', content: promptContent });

        return messages;
    }

    /**
     * Handle streaming API response
     * @param {Response} apiResponse - API response
     * @param {string} promptContent - Original prompt
     * @param {string} tabId - Tab ID
     */
    async handleStreamingResponse(apiResponse, promptContent, tabId) {
        console.log("Background: Streaming API response...");
        const reader = apiResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Send a message to chat.js to indicate streaming has started
        chrome.runtime.sendMessage({
            action: 'streamApiStart',
            tabId: tabId,
            prompt: promptContent
        }).catch(error => console.log(`Error sending streamApiStart synchronously: ${error.message}, tabId: ${tabId}`));

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                console.log("Background: Stream finished.");
                chrome.runtime.sendMessage({ action: 'streamApiEnd', tabId: tabId, prompt: promptContent })
                    .catch(error => console.log(`Error sending streamApiEnd: ${error.message}, tabId: ${tabId}`));
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            console.log("Background: Stream raw chunk received:", buffer);

            // Process buffer line by line for SSE
            let lines = buffer.split('\n');
            buffer = lines.pop(); // Keep the last partial line in the buffer

            for (const line of lines) {
                this.processStreamingLine(line, promptContent, tabId);
            }
        }
    }

    /**
     * Process a single line from streaming response
     * @param {string} line - Streaming line
     * @param {string} promptContent - Original prompt
     * @param {string} tabId - Tab ID
     */
    processStreamingLine(line, promptContent, tabId) {
        if (line.startsWith('data:')) {
            let currentPayload = line.substring(5).trim(); // Remove the initial "data:" prefix and trim

            // Aggressively strip any further "data:" prefixes
            while (currentPayload.startsWith('data:')) {
                console.warn("Background: Stripping nested 'data:' prefix. Current payload before strip:", currentPayload);
                currentPayload = currentPayload.substring(5).trim();
                console.warn("Background: Current payload after strip:", currentPayload);
            }

            if (currentPayload === '[DONE]') {
                console.log("Background: Stream signaled [DONE].");
                return;
            }

            // Proceed to parse only if currentPayload is not empty and looks like JSON
            if (currentPayload && currentPayload.length > 0 && (currentPayload.startsWith('{') || currentPayload.startsWith('['))) {
                console.log('Background SSE Processing: Original line (after buffer split):', line);
                console.log('Background SSE Processing: Final string to be parsed (currentPayload):', currentPayload);

                try {
                    const parsed = JSON.parse(currentPayload);

                    // Standard OpenAI-style streaming
                    if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                        const contentChunk = parsed.choices[0].delta.content;
                        const toolCallChunk = parsed.choices[0].delta.tool_calls;

                        if (contentChunk) {
                            chrome.runtime.sendMessage({
                                action: 'streamApiResponseChunk',
                                chunk: contentChunk,
                                tabId: tabId,
                                prompt: promptContent
                            }).catch(error => console.log(`Error sending streamApiResponseChunk: ${error.message}, tabId: ${tabId}`));
                        }

                        if (toolCallChunk) {
                            console.log("Background: Received OpenAI style tool_call delta (streaming):", toolCallChunk);
                            chrome.runtime.sendMessage({
                                action: 'streamApiToolCallChunk',
                                toolCallChunk: toolCallChunk,
                                tabId: tabId,
                                prompt: promptContent
                            }).catch(error => console.log(`Error sending streamApiToolCallChunk: ${error.message}, tabId: ${tabId}`));
                        }
                    }
                } catch (e) {
                    console.error("Background: Error parsing JSON from stream:", e, "Attempted to parse:", currentPayload, "Original full line:", line);
                }
            } else if (currentPayload) {
                console.log("Background: SSE line does not appear to be JSON or [DONE] after stripping prefixes. Payload:", currentPayload, "Original line:", line);
            }
        }
    }

    /**
     * Handle non-streaming API response
     * @param {Response} apiResponse - API response
     * @param {string} promptContent - Original prompt
     * @param {string} tabId - Tab ID
     * @param {boolean} isStartChat - Whether this is starting a new chat
     */
    async handleNonStreamingResponse(apiResponse, promptContent, tabId, isStartChat) {
        const responseData = await apiResponse.json();
        const messageObject = responseData.choices && responseData.choices[0] ? responseData.choices[0].message : null;

        if (!messageObject) {
            throw new Error('Invalid response format from API: Missing message structure.');
        }

        await this.handleApiResponseAndSendMessage(messageObject, promptContent, tabId, isStartChat);
    }

    /**
     * Send configuration error message to chat
     * @param {string} promptContent - Original prompt
     * @param {string} tabId - Tab ID
     */
    sendConfigurationErrorToChat(promptContent, tabId) {
        chrome.runtime.sendMessage({
            action: 'displayErrorInChat',
            errorMessage: "The LLM API endpoint is not configured or is invalid. Please go to the extension options page (right-click the extension icon) and set it up.",
            tabId: tabId,
            prompt: promptContent
        }).catch(e => console.error("Background: Error sending displayErrorInChat message:", e));
    }

    /**
     * Handle API errors and send appropriate messages
     * @param {Error} error - The error that occurred
     * @param {string} promptContent - Original prompt
     * @param {string} tabId - Tab ID
     * @param {boolean} isStartChat - Whether this is starting a new chat
     */
    async handleApiError(error, promptContent, tabId, isStartChat) {
        console.error('Error in makeLlmApiRequest (generic catch):', error);

        try {
            const cat = error?.message?.includes('API request failed') ? 'api_error' : 'network';
            const code = (error?.message || 'error').slice(0, 64);
            await analytics.trackErrorEvent(cat, code);
        } catch (_) {}

        const errorDelay = isStartChat ? this.errorDelayMap.startChat : this.errorDelayMap.regular;

        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: 'setApiResponse',
                apiResponse: `Error: ${error.message}`,
                prompt: promptContent,
                tabId: tabId,
            }).catch(e => console.error(`Error sending setApiResponse (from generic catch): ${e.message}, tabId: ${tabId}`));
        }, errorDelay);
    }

    /**
     * Handle API response and send message
     * @param {Object} messageObject - API message object
     * @param {string} promptContent - Original prompt
     * @param {string} tabId - Tab ID
     * @param {boolean} isStartChat - Whether this is starting a new chat
     */
    async handleApiResponseAndSendMessage(messageObject, promptContent, tabId, isStartChat) {
        // This method should be implemented by the caller or moved to a message handling module
        // For now, keeping the existing functionality
        chrome.runtime.sendMessage({
            action: 'setApiResponse',
            apiResponse: messageObject.content || '',
            prompt: promptContent,
            tabId: tabId,
            isStartChat: isStartChat
        }).catch(e => console.error(`Error sending setApiResponse: ${e.message}, tabId: ${tabId}`));
    }

    // These methods should be implemented or injected
    async validateConfig() {
        throw new Error('validateConfig method must be implemented');
    }

    async getAllToolDefinitions() {
        throw new Error('getAllToolDefinitions method must be implemented');
    }

    async getStreamingSettings() {
        return new Promise(resolve => {
            chrome.storage.sync.get({ enableStreaming: false }, data => resolve(data.enableStreaming));
        });
    }
}

// Export singleton instance
export const apiHandler = new ApiHandler();