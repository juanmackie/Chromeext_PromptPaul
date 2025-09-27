// ===== Chat API Service =====

class ChatApiService {
  constructor(stateManager, uiRenderer) {
    this.stateManager = stateManager;
    this.uiRenderer = uiRenderer;
  }

  async getApiConfig() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
        const profiles = result.profiles || [];
        const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
        const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId) || profiles.find(p => p.id === 'default');
        
        if (!selectedProfile || !selectedProfile.llmEndpoint || !selectedProfile.apiKey || !selectedProfile.modelName) {
          console.error("Chat: Configuration is incomplete or missing.");
          const error = new Error('Configuration is incomplete. Please set up the API endpoint, API key, and model name in the options page.');
          this.uiRenderer.showToast('Please configure API settings in options');
          reject(error);
        } else {
          resolve(selectedProfile);
        }
      });
    });
  }

  async getTools() {
    console.log("Chat: getTools - Starting to fetch and process tool definitions.");
    const { promptPaulTools: definedTools = [] } = await new Promise((resolve) => {
      chrome.storage.local.get(['promptPaulTools'], resolve);
    });
    console.log("Chat: getTools - Defined tools from storage:", definedTools);

    const processedTools = [];

    for (const tool of definedTools) {
      let parametersForLlm = {};
      let source = 'manual'; // Default source

      if (tool.mcpServerUrl && tool.mcpServerUrl.trim() !== "") {
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
                  console.error(`Chat: getTools - No response received from 'getDiscoveredMcpToolSchema' for MCP tool ${tool.name}.`);
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
            parametersForLlm = response.toolSchema.inputSchema || {};
            source = 'mcp_discovered';
            console.log(`Chat: getTools - Using discovered inputSchema for MCP tool ${tool.name}:`, parametersForLlm);
          } else {
            console.warn(`Chat: getTools - Failed to get dynamic schema for MCP tool ${tool.name}. Falling back to manually configured parameters.`);
            source = 'manual_fallback_mcp';
            if (tool.parameters) {
              try {
                parametersForLlm = JSON.parse(tool.parameters);
              } catch (e) {
                console.error(`Chat: getTools - Error parsing manual parameters for fallback MCP tool ${tool.name}:`, e);
                this.uiRenderer.addMessage('System', `Error: Invalid JSON Schema (fallback) for MCP tool '${tool.name}'. Tool will be excluded or have empty schema.`);
                parametersForLlm = {};
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
              this.uiRenderer.addMessage('System', `Error: Invalid JSON Schema (fallback after exception) for MCP tool '${tool.name}'. Tool will be excluded or have empty schema.`);
              parametersForLlm = {};
            }
          }
        }
      } else {
        // Not an MCP tool, use manual parameters
        console.log(`Chat: getTools - Processing non-MCP tool: ${tool.name}`);
        if (tool.parameters) {
          try {
            parametersForLlm = JSON.parse(tool.parameters);
          } catch (e) {
            console.error(`Chat: getTools - Error parsing parameters for manual tool ${tool.name}:`, e);
            this.uiRenderer.addMessage('System', `Error: Invalid JSON Schema for tool '${tool.name}'. Tool will be excluded or have empty schema.`);
            parametersForLlm = {};
          }
        }
      }

      processedTools.push({
        ...tool,
        parametersForLlm: parametersForLlm,
        source: source
      });
    }
    
    console.log("Chat: getTools - Finished processing tools. Result:", processedTools);
    return processedTools;
  }

  formatToolsForRequest(tools) {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parametersForLlm
      }
    })).filter(tool => tool !== null);
  }

  prepareToolChoicePayload(toolChoice, formattedTools) {
    let toolChoicePayload = {};

    if (toolChoice === 'none' || formattedTools.length === 0) {
      toolChoicePayload = {};
      if (formattedTools.length === 0 && toolChoice !== 'none') {
        console.log("Chat: No tools available, though choice was not 'none'. Sending request without tools.");
      } else {
        console.log("Chat: Tool choice is 'none' or no tools available. Sending request without tools.");
      }
    } else if (toolChoice === 'auto') {
      toolChoicePayload = { tools: formattedTools, tool_choice: "auto" };
      console.log("Chat: Tool choice is 'auto'. Sending with all available tools.");
    } else if (typeof toolChoice === 'string') {
      const specificTool = formattedTools.find(t => t.function.name === toolChoice);
      if (specificTool) {
        toolChoicePayload = { 
          tools: [specificTool], 
          tool_choice: { type: "function", function: { name: toolChoice } } 
        };
        console.log(`Chat: Tool choice is specific: '${toolChoice}'. Sending with this tool.`);
      } else {
        this.uiRenderer.addMessage('System', `Warning: Specified tool "${toolChoice}" not found. No tools will be sent.`);
        console.log(`Chat: Specified tool "${toolChoice}" not found. Sending request without tools.`);
        toolChoicePayload = {};
      }
    }

    return toolChoicePayload;
  }

  prepareMessagesForRequest(config, userMessage = null) {
    if (userMessage) {
      this.uiRenderer.addMessage('User', userMessage);
      
      // Check if we have media data to include
      const mediaData = this.stateManager.getMediaData();
      if (mediaData && mediaData.type === 'image') {
        const messageContent = [
          {
            type: 'text',
            text: userMessage
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mediaData.mimeType};base64,${mediaData.base64}`
            }
          }
        ];
        this.stateManager.addToHistory({ role: 'user', content: messageContent });
      } else {
        this.stateManager.addToHistory({ role: 'user', content: userMessage });
      }
    }

    const now = new Date();
    const dateTimeString = `Date: ${now.toLocaleDateString()} Time: ${now.toLocaleTimeString()}`;
    let systemPromptContent = dateTimeString;
    if (config.systemPrompt && config.systemPrompt.trim() !== '') {
      systemPromptContent += `\n\n${config.systemPrompt}`;
    }

    const history = this.stateManager.getHistory();
    return [{ role: 'system', content: systemPromptContent }, ...history];
  }

  formatRequestForProvider(requestBody, config) {
    const isAnthropicEndpoint = config.llmEndpoint.includes('api.anthropic.com');
    
    if (isAnthropicEndpoint) {
      // Convert OpenAI format to Anthropic format
      const messages = requestBody.messages.filter(msg => msg.role !== 'system');
      const systemMessage = requestBody.messages.find(msg => msg.role === 'system');
      
      // Handle image format conversion for Anthropic
      const convertedMessages = messages.map(msg => {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          return {
            ...msg,
            content: msg.content.map(content => {
              if (content.type === 'image_url') {
                const mediaData = this.stateManager.getMediaData();
                return {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaData?.mimeType || 'image/jpeg',
                    data: content.image_url.url.split(',')[1] // Remove data:image/...;base64, prefix
                  }
                };
              }
              return content;
            })
          };
        }
        return msg;
      });

      return {
        model: requestBody.model,
        max_tokens: requestBody.max_tokens,
        messages: convertedMessages,
        system: systemMessage?.content,
        tools: requestBody.tools,
        tool_choice: requestBody.tool_choice
      };
    }

    return requestBody;
  }

  getRequestHeaders(config) {
    const isAnthropicEndpoint = config.llmEndpoint.includes('api.anthropic.com');
    
    if (isAnthropicEndpoint) {
      return {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01'
      };
    } else {
      return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.apiKey
      };
    }
  }
}

export { ChatApiService };