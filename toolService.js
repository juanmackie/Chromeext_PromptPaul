// ===== Tool Service - Handles tool definitions and execution =====

const activeToolExecutions = new Set();

async function getAllToolDefinitions() {
    const localTools = await new Promise((resolve) => {
        chrome.storage.local.get(['promptPaulTools'], (result) => {
            resolve(result.promptPaulTools || []);
        });
    });
    return localTools.filter(tool => tool.enabled !== false);
}

async function getToolDefinition(name) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['promptPaulTools'], (result) => {
            const tools = result.promptPaulTools || [];
            const tool = tools.find(t => t.name === name);
            if (tool) {
                resolve(tool);
            } else {
                reject(new Error(`Tool '${name}' not found`));
            }
        });
    });
}

async function callUserDefinedEndpoint(endpointUrl, args, userDefinedMethod, originalToolName = null, mcpProxyUrlBase = null) {
    const executionId = `${originalToolName || 'unknown'}_${Date.now()}`;
    
    if (activeToolExecutions.has(executionId)) {
        throw new Error('Tool execution already in progress');
    }
    
    activeToolExecutions.add(executionId);
    
    try {
        console.log(`Calling user-defined endpoint: ${endpointUrl}`);
        console.log('Method:', userDefinedMethod);
        console.log('Arguments:', args);

        const requestOptions = {
            method: userDefinedMethod || 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        };

        if (userDefinedMethod !== 'GET') {
            requestOptions.body = JSON.stringify(args);
        }

        const response = await fetch(endpointUrl, requestOptions);
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('Tool response:', data);
        
        return data;
    } catch (error) {
        console.error('Error calling user-defined endpoint:', error);
        throw error;
    } finally {
        activeToolExecutions.delete(executionId);
    }
}

const toolImplementations = {
    // Basic tool implementations can be added here
    // For now, most tools are user-defined endpoints
};

async function executeToolCall(toolCall, availableTools) {
    const { name, arguments: args } = toolCall.function;
    
    try {
        // Check if it's a built-in tool
        if (toolImplementations[name]) {
            return await toolImplementations[name](args);
        }

        // Look for user-defined tool
        const toolDef = availableTools.find(tool => tool.name === name);
        if (!toolDef) {
            throw new Error(`Tool '${name}' not found in available tools`);
        }

        if (toolDef.endpoint) {
            return await callUserDefinedEndpoint(
                toolDef.endpoint,
                args,
                toolDef.method || 'POST',
                name
            );
        }

        throw new Error(`Tool '${name}' has no implementation`);
    } catch (error) {
        console.error(`Error executing tool '${name}':`, error);
        return {
            error: error.message,
            tool: name,
            success: false
        };
    }
}

async function handleToolCalls(apiResponse, originalRequestBody = {}, headers = {}, endpoint = '', tabId, isStartChat) {
    try {
        const message = apiResponse.choices[0].message;
        const toolCalls = message.tool_calls;
        
        console.log('Processing tool calls:', toolCalls.length);

        // Get available tools for reference
        const availableTools = await getAllToolDefinitions();
        
        // Execute all tool calls
        const toolResults = await Promise.all(
            toolCalls.map(async (toolCall) => {
                const result = await executeToolCall(toolCall, availableTools);
                return {
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: toolCall.function.name,
                    content: JSON.stringify(result)
                };
            })
        );

        // Prepare follow-up request with tool results
        const followUpMessages = [
            ...originalRequestBody.messages,
            message, // Assistant's message with tool calls
            ...toolResults // Tool execution results
        ];

        const followUpRequest = {
            ...originalRequestBody,
            messages: followUpMessages
        };

        console.log('Making follow-up request with tool results');

        // Make follow-up API call
        const followUpResponse = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(followUpRequest)
        });

        if (!followUpResponse.ok) {
            const errorText = await followUpResponse.text();
            throw new Error(`Follow-up request failed: ${followUpResponse.status} ${errorText}`);
        }

        const followUpData = await followUpResponse.json();
        
        // Check for additional tool calls (recursive handling)
        if (followUpData.choices?.[0]?.message?.tool_calls) {
            console.log('Additional tool calls detected, handling recursively');
            return await handleToolCalls(followUpData, followUpRequest, headers, endpoint, tabId, isStartChat);
        }

        // Send final response
        const finalContent = followUpData.choices?.[0]?.message?.content || 'Tool execution completed';
        
        // Send final response directly to avoid circular imports
        const responseMessage = {
          action: 'llmResponse',
          response: finalContent,
          isStartChatContext: isStartChat,
          usingAnthropicMcp: false
        };

        if (tabId && tabId !== -1) {
          try {
            await chrome.tabs.sendMessage(tabId, responseMessage);
          } catch (error) {
            console.warn('Failed to send message to tab, tab may be closed:', error);
          }
        }

    } catch (error) {
        console.error('Error handling tool calls:', error);
        
        const errorMessage = `Error executing tools: ${error.message}`;
        
        // Send error response directly to avoid circular imports
        const errorResponseMessage = {
          action: 'llmResponse',
          response: errorMessage,
          isStartChatContext: isStartChat,
          usingAnthropicMcp: false
        };

        if (tabId && tabId !== -1) {
          try {
            await chrome.tabs.sendMessage(tabId, errorResponseMessage);
          } catch (error) {
            console.warn('Failed to send error message to tab:', error);
          }
        }
    }
}

// Listen for tool definition changes
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.onChanged.addListener(async (changes, namespace) => {
      if (namespace === 'local' && changes.promptPaulTools) {
          console.log('Tool definitions updated');
          // Tools updated, available to all components
      }
  });
}

export {
    getAllToolDefinitions,
    getToolDefinition,
    callUserDefinedEndpoint,
    executeToolCall,
    handleToolCalls,
    activeToolExecutions
};