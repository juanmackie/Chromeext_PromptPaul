import { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync, handleChromeApiCall } from '../errorHandler.js';
import { storageService } from '../services/storage-service.js';
import { apiClient } from '../services/api-client.js';

/**
 * Conversation Manager
 * Handles conversation history, API configuration, and tool management
 * Orchestrates API calls and manages conversation state
 */
export class ConversationManager {
    constructor(messageRenderer, uiManager, streamingManager) {
        this.messageRenderer = messageRenderer;
        this.uiManager = uiManager;
        this.streamingManager = streamingManager;

        // Conversation state
        this.conversationHistory = [];
        this.apiConfig = null;
        this.tools = [];
        this.currentRequest = null;
    }

    /**
     * Initialize conversation manager
     */
    async initialize() {
        await this.loadApiConfig();
        await this.loadTools();
    }

    /**
     * Load API configuration from storage
     * @returns {Object} API configuration
     */
    async loadApiConfig() {
        return await wrapAsync(async () => {
            const result = await storageService.getLocal(['profiles', 'lastSelectedProfileId']);
            const profiles = result.profiles || [];
            const lastSelectedProfileId = result.lastSelectedProfileId || 'default';

            const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId) ||
                                  profiles.find(p => p.id === 'default');

            if (!selectedProfile) {
                throw createError('No configuration profile found', {
                    category: ErrorCategory.CONFIGURATION,
                    severity: ErrorSeverity.CRITICAL,
                    context: { lastSelectedProfileId, profilesCount: profiles.length },
                    userMessage: 'Please create a configuration profile in the options page'
                });
            }

            // Validate profile completeness
            const missingFields = [];
            if (!selectedProfile.llmEndpoint) missingFields.push('API endpoint');
            if (!selectedProfile.apiKey) missingFields.push('API key');
            if (!selectedProfile.modelName) missingFields.push('model name');

            if (missingFields.length > 0) {
                const profileName = selectedProfile.name || selectedProfile.id;
                throw createError(`Configuration profile "${profileName}" is incomplete: missing ${missingFields.join(', ')}`, {
                    category: ErrorCategory.CONFIGURATION,
                    severity: ErrorSeverity.CRITICAL,
                    context: { profileId: selectedProfile.id, missingFields },
                    userMessage: `Configuration incomplete. Please set ${missingFields.join(', ')} in the options page.`
                });
            }

            console.log(`Chat: Using configuration from profile: ${selectedProfile.name || selectedProfile.id}`);
            this.apiConfig = selectedProfile;
            return selectedProfile;

        }, {
            category: ErrorCategory.CONFIGURATION,
            userMessage: 'Failed to load API configuration',
            critical: true
        });
    }

    /**
     * Load tool definitions from storage
     * @returns {Array} Array of tool definitions
     */
    async loadTools() {
        return await wrapAsync(async () => {
            this.tools = await storageService.getToolDefinitions();
            console.log(`Chat: Loaded ${this.tools.length} tool definitions`);
            return this.tools;
        }, {
            category: ErrorCategory.STORAGE,
            userMessage: 'Failed to load tool definitions',
            severity: ErrorSeverity.MEDIUM
        });
    }

    /**
     * Get current API configuration
     * @returns {Object} API configuration
     */
    getApiConfig() {
        return this.apiConfig;
    }

    /**
     * Get tool definitions
     * @returns {Array} Array of tool definitions
     */
    getTools() {
        return this.tools;
    }

    /**
     * Make API call with streaming
     * @param {string} prompt - User prompt
     * @param {Object} options - API call options
     * @returns {Promise<void>}
     */
    async makeApiCall(prompt, options = {}) {
        const {
            tool_choice = 'none',
            isStartChat = false,
            streaming = true
        } = options;

        // Ensure configuration is loaded and display any configuration errors
        if (!this.apiConfig) {
            try {
                await this.loadApiConfig();
            } catch (configError) {
                console.error('Chat: Configuration error:', configError);
                // Display configuration error prominently to user
                const errorMessage = configError.userMessage || configError.message || 'Configuration error occurred';
                this.messageRenderer.addMessage('System', `⚠️ **Configuration Error**: ${errorMessage}`, { isError: true });

                // Also add helpful guidance
                this.messageRenderer.addMessage('System', '💡 **To fix this**: Please go to the extension options and ensure your API configuration is complete with a valid endpoint URL, API key, and model name.', { isHelp: true });

                // Don't proceed with API call if configuration is invalid
                throw configError;
            }
        }

        this.currentRequest = {
            prompt,
            tool_choice,
            isStartChat,
            streaming,
            timestamp: Date.now()
        };

        try {
            console.log('Chat: Starting API call with config:', {
                endpoint: this.apiConfig.llmEndpoint ? '✓ Set' : '✗ Missing',
                apiKey: this.apiConfig.apiKey ? '✓ Set' : '✗ Missing',
                model: this.apiConfig.modelName || '✗ Missing',
                streaming
            });

            // Add user message to conversation history
            if (prompt) {
                this.addToHistory({ role: 'user', content: prompt });
            }

            if (streaming) {
                await this.makeStreamingApiCall(prompt, tool_choice);
            } else {
                await this.makeNonStreamingApiCall(prompt, tool_choice);
            }

        } catch (error) {
            console.error('Chat: API call failed:', error);

            // Determine error type and provide appropriate user feedback
            let userErrorMessage = 'API Error occurred';
            let helpMessage = '';

            if (error.category === ErrorCategory.CONFIGURATION) {
                userErrorMessage = `Configuration Error: ${error.userMessage || error.message}`;
                helpMessage = '💡 **To fix this**: Please check your extension options and ensure all required fields are filled in.';
            } else if (error.category === ErrorCategory.NETWORK) {
                userErrorMessage = `Network Error: Unable to reach the API endpoint`;
                helpMessage = '💡 **To fix this**: Please check your internet connection and verify the API endpoint URL is correct.';
            } else {
                userErrorMessage = `API Error: ${error.message || 'Unknown error occurred'}`;
                helpMessage = '💡 **To fix this**: Please check your configuration and try again.';
            }

            // Display error prominently in the chat
            this.messageRenderer.addMessage('System', `❌ **${userErrorMessage}**`, { isError: true });

            if (helpMessage) {
                this.messageRenderer.addMessage('System', helpMessage, { isHelp: true });
            }

            // Also handle through error handler for logging/monitoring
            await errorHandler.handleError(createError('API call failed', {
                category: ErrorCategory.NETWORK,
                severity: ErrorSeverity.HIGH,
                originalError: error,
                context: { prompt: prompt.substring(0, 100), tool_choice, streaming }
            }));

        } finally {
            this.currentRequest = null;
        }
    }

    /**
     * Make streaming API call
     * @param {string} prompt - User prompt
     * @param {string} tool_choice - Tool choice setting
     * @returns {Promise<void>}
     */
    async makeStreamingApiCall(prompt, tool_choice) {
        console.log("Chat: Starting streaming API call with centralized client");

        try {
            // Initialize streaming UI components first
            this.streamingManager.startStream(
                { prompt },
                this.conversationHistory,
                // Note: These elements might be null - the streaming manager will handle nulls gracefully
                document.getElementById('user-input'),
                document.getElementById('send-button'),
                document.getElementById('clear-button'),
                window.loadingManager
            );

            // Prepare messages and tools for API client
            const messages = this.buildMessages(prompt);
            const { tools } = this.prepareToolChoices(tool_choice);

            // Use centralized API client for streaming
            await apiClient.makeStreamingRequest(
                this.apiConfig,
                {
                    messages,
                    tools,
                    toolChoice: tool_choice,
                    stream: true
                },
                // Chunk callback for streaming responses
                (chunk) => {
                    if (chunk.type === 'content') {
                        // Forward content chunk to streaming manager
                        this.streamingManager.handleStreamChunk(chunk.content);
                    } else if (chunk.type === 'tool_call') {
                        // Handle tool call chunks
                        this.streamingManager.handleToolCallChunk(chunk.tool_calls);
                    }
                },
                // Stream completed callback
                () => {
                    // Finalize the streaming session
                    this.streamingManager.endStream(
                        {},
                        this.conversationHistory,
                        document.getElementById('user-input'),
                        document.getElementById('send-button'),
                        document.getElementById('clear-button'),
                        window.loadingManager
                    );
                }
            );

        } catch (error) {
            console.error('Chat: Streaming API call failed:', error);

            // Finalize streaming and reset state on error
            this.streamingManager.endStream(
                {},
                this.conversationHistory,
                document.getElementById('user-input'),
                document.getElementById('send-button'),
                document.getElementById('clear-button'),
                window.loadingManager
            );
            throw error;
        }
    }

    /**
     * Make non-streaming API call
     * @param {string} prompt - User prompt
     * @param {string} tool_choice - Tool choice setting
     * @returns {Promise<Object>} API response
     */
    async makeNonStreamingApiCall(prompt, tool_choice) {
        console.log("Chat: Making non-streaming API call with centralized client");

        try {
            // Prepare messages and tools for API client
            const messages = this.buildMessages(prompt);
            const { tools } = this.prepareToolChoices(tool_choice);

            // Use centralized API client
            const responseData = await apiClient.makeRequest(
                this.apiConfig,
                {
                    messages,
                    tools,
                    toolChoice: tool_choice,
                    stream: false
                }
            );

            // Extract message from response
            const messageObject = responseData.choices && responseData.choices[0] ? responseData.choices[0].message : null;

            if (!messageObject) {
                throw createError('Invalid response format from API: Missing message structure', {
                    category: ErrorCategory.NETWORK,
                    severity: ErrorSeverity.HIGH
                });
            }

            // Handle response
            await this.handleApiResponse(messageObject, prompt);
            return responseData;

        } catch (error) {
            console.error('Chat: Non-streaming API call failed:', error);
            throw error;
        }
    }

    /**
     * Make API call with media
     * @param {string} prompt - User prompt
     * @param {Object} mediaData - Media data object
     * @param {string} tool_choice - Tool choice setting
     * @returns {Promise<void>}
     */
    async makeApiCallWithMedia(prompt, mediaData, tool_choice = 'none') {
        if (!this.apiConfig) {
            await this.loadApiConfig();
        }

        console.log('About to call makeApiCallWithMedia with centralized client:', {
            promptLength: prompt.length,
            mediaType: mediaData.type,
            toolChoice: tool_choice
        });

        // Add user message to conversation
        this.addToHistory({ role: 'user', content: prompt });

        // Add media to conversation history
        if (mediaData) {
            this.addToHistory({
                role: 'user',
                content: `[Media: ${mediaData.type}] ${mediaData.url || 'No URL'}`,
                media: mediaData
            });
        }

        try {
            // Use centralized API client for media requests
            const responseData = await apiClient.makeMediaRequest(
                this.apiConfig,
                mediaData,
                {
                    prompt,
                    tools: this.tools,
                    toolChoice: tool_choice
                }
            );

            // Extract message from response
            const messageObject = responseData.choices && responseData.choices[0] ? responseData.choices[0].message : null;

            if (!messageObject) {
                throw createError('Invalid response format from API: Missing message structure', {
                    category: ErrorCategory.NETWORK,
                    severity: ErrorSeverity.HIGH
                });
            }

            await this.handleApiResponse(messageObject, prompt);

        } catch (error) {
            console.error('Chat: Media API call failed:', error);
            this.messageRenderer.addMessage('System', `Media API Error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Build messages array for API call
     * @param {string} prompt - User prompt
     * @returns {Array} Messages array
     */
    buildMessages(prompt) {
        const messages = [];

        // Add system prompt
        if (this.apiConfig.systemPrompt && this.apiConfig.systemPrompt.trim()) {
            const now = new Date();
            const dateTimeString = `Date: ${now.toLocaleDateString()} Time: ${now.toLocaleTimeString()}`;

            messages.push({
                role: 'system',
                content: `${dateTimeString}\n\n${this.apiConfig.systemPrompt}`
            });
        }

        // Add conversation history (limited to recent messages)
        const maxHistoryLength = 10;
        const recentHistory = this.conversationHistory.slice(-maxHistoryLength);
        messages.push(...recentHistory);

        // Add current prompt if not already in history
        if (prompt && (!recentHistory.length || recentHistory[recentHistory.length - 1].content !== prompt)) {
            messages.push({ role: 'user', content: prompt });
        }

        return messages;
    }

    /**
     * Build messages with media content
     * @param {string} prompt - User prompt
     * @param {Object} mediaData - Media data
     * @returns {Array} Messages array with media
     */
    buildMessagesWithMedia(prompt, mediaData) {
        const messages = this.buildMessages(prompt);

        // Modify the last user message to include media
        if (mediaData && messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === 'user') {
                // Add media reference to user message
                const mediaContent = this.formatMediaForApi(mediaData);
                lastMessage.content = `${lastMessage.content}\n\n[Attached Media: ${mediaData.type}]\n${mediaContent}`;
            }
        }

        return messages;
    }

    /**
     * Format media for API consumption
     * @param {Object} mediaData - Media data object
     * @returns {string} Formatted media description
     */
    formatMediaForApi(mediaData) {
        if (mediaData.type === 'image') {
            return `[Image: ${mediaData.mimeType}, Size: ${mediaData.base64 ? Math.round(mediaData.base64.length * 0.75) : 'Unknown'} bytes]`;
        } else if (mediaData.type === 'video') {
            return `[Video: ${mediaData.mimeType}, Size: ${mediaData.base64 ? Math.round(mediaData.base64.length * 0.75) : 'Unknown'} bytes]`;
        } else if (mediaData.type === 'audio') {
            return `[Audio: ${mediaData.mimeType}, Size: ${mediaData.base64 ? Math.round(mediaData.base64.length * 0.75) : 'Unknown'} bytes]`;
        }
        return `[Media: ${mediaData.type}]`;
    }

    /**
     * Prepare tool choices for API call
     * @param {string} tool_choice - Tool choice setting
     * @returns {Object} Tool choices and payload
     */
    prepareToolChoices(tool_choice) {
        const formattedTools = this.tools.map(tool => {
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
                console.error(`Error parsing parameters for tool ${tool.name}:`, e);
                return null;
            }
        }).filter(tool => tool !== null);

        let toolChoicePayload = {};

        if (tool_choice === 'none' || formattedTools.length === 0) {
            toolChoicePayload = {};
        } else if (tool_choice === 'auto') {
            toolChoicePayload = { tools: formattedTools, tool_choice: "auto" };
        } else if (typeof tool_choice === 'string') {
            const specificTool = formattedTools.find(t => t.function.name === tool_choice);
            if (specificTool) {
                toolChoicePayload = { tools: [specificTool], tool_choice: { type: "function", function: { name: tool_choice } } };
            } else {
                toolChoicePayload = {};
            }
        }

        return { tools: formattedTools, toolChoicePayload };
    }

    /**
     * Handle API response
     * @param {Object} messageObject - API response message object
     * @param {string} originalPrompt - Original user prompt
     */
    async handleApiResponse(messageObject, originalPrompt) {
        if (messageObject.tool_calls && messageObject.tool_calls.length > 0) {
            // Handle tool calls
            console.log("Chat: Received tool calls from API");
            await this.handleToolCalls(messageObject.tool_calls, originalPrompt);
        } else if (messageObject.content) {
            // Handle regular text response
            const responseText = typeof messageObject.content === 'string' ?
                messageObject.content : JSON.stringify(messageObject.content);

            this.messageRenderer.addMessage('LLM', responseText);
            this.addToHistory({ role: 'assistant', content: responseText });
        }
    }

    /**
     * Handle tool calls from API response
     * @param {Array} toolCalls - Array of tool calls
     * @param {string} originalPrompt - Original user prompt
     */
    async handleToolCalls(toolCalls, originalPrompt) {
        for (const toolCall of toolCalls) {
            try {
                console.log(`Chat: Executing tool: ${toolCall.function.name}`);

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
                } else {
                    console.log('Chat: Tool execution result:', response.result);
                    this.addToHistory({
                        role: 'tool',
                        content: JSON.stringify(response.result),
                        tool_call_id: toolCall.id
                    });
                }
            } catch (error) {
                console.error('Chat: Error executing tool call:', error);
                this.messageRenderer.addMessage('System', `Tool execution error: ${error.message}`);
            }
        }
    }

    /**
     * Add message to conversation history
     * @param {Object} message - Message object
     */
    addToHistory(message) {
        this.conversationHistory.push({
            ...message,
            timestamp: Date.now()
        });

        // Limit history size to prevent memory issues
        const maxHistorySize = 100;
        if (this.conversationHistory.length > maxHistorySize) {
            this.conversationHistory = this.conversationHistory.slice(-maxHistorySize);
        }
    }

    /**
     * Get conversation history
     * @returns {Array} Conversation history array
     */
    getHistory() {
        return [...this.conversationHistory];
    }

    /**
     * Clear conversation history
     */
    clearHistory() {
        this.conversationHistory = [];
    }

    /**
     * Export conversation history
     * @returns {string} Exported conversation text
     */
    exportConversation() {
        if (this.conversationHistory.length === 0) {
            return null;
        }

        const conversationText = this.conversationHistory.map(msg => {
            const role = msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'AI' : msg.role;
            return `${role}: ${msg.content}`;
        }).join('\n\n');

        return conversationText;
    }

    /**
     * Get current request state
     * @returns {Object|null} Current request or null
     */
    getCurrentRequest() {
        return this.currentRequest;
    }

    /**
     * Check if currently processing a request
     * @returns {boolean} True if processing request
     */
    isProcessing() {
        return this.currentRequest !== null || this.streamingManager.isActive();
    }

    /**
     * Get conversation statistics
     * @returns {Object} Conversation statistics
     */
    getConversationStats() {
        const userMessages = this.conversationHistory.filter(msg => msg.role === 'user').length;
        const assistantMessages = this.conversationHistory.filter(msg => msg.role === 'assistant').length;
        const systemMessages = this.conversationHistory.filter(msg => msg.role === 'system').length;
        const toolMessages = this.conversationHistory.filter(msg => msg.role === 'tool').length;

        return {
            totalMessages: this.conversationHistory.length,
            userMessages,
            assistantMessages,
            systemMessages,
            toolMessages,
            hasActiveRequest: this.isProcessing(),
            toolsAvailable: this.tools.length
        };
    }

    /**
     * Refresh configuration and tools
     */
    async refresh() {
        await this.loadApiConfig();
        await this.loadTools();
    }
}