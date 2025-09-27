// ===== API Service - Handles all LLM API calls =====

// import './marked.min.js'; // Not needed in service worker context

function isValidURL(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

async function validateConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['profiles', 'lastSelectedProfileId', 'defaultLlmEndpoint'], resolve)
  });
}

async function _handleApiResponseAndSendMessage(responseMessage, prompt, tabId, isStartChatContext, usingAnthropicMcp) {
  try {
    // Send the response back to the content script
    const message = {
      action: 'llmResponse',
      response: responseMessage,
      isStartChatContext: isStartChatContext,
      usingAnthropicMcp: usingAnthropicMcp
    };

    if (tabId && tabId !== -1) {
      try {
        await chrome.tabs.sendMessage(tabId, message);
      } catch (error) {
        console.warn('Failed to send message to tab, tab may be closed:', error);
      }
    }
  } catch (error) {
    console.error('Error in _handleApiResponseAndSendMessage:', error);
  }
}

async function makeLlmApiRequest(promptContent, tabId, { isStartChat = false, customInstructionToolChoice = 'none' } = {}) {
  try {
    console.log("Making LLM API request with prompt length:", promptContent.length);
    
    const [config, streamingConfig] = await Promise.all([
      validateConfig(),
      new Promise(resolve => chrome.storage.sync.get({ enableStreaming: false }, data => resolve(data)))
    ]);

    const profiles = config.profiles || [];
    const lastSelectedProfileId = config.lastSelectedProfileId || 'default';
    const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId) || profiles.find(p => p.id === 'default');

    if (!selectedProfile) {
      throw new Error('No profile selected or default profile not found');
    }

    const { llmEndpoint, apiKey, modelName, systemPrompt, maxTokens } = selectedProfile;

    if (!llmEndpoint || !apiKey || !modelName) {
      throw new Error('API configuration is incomplete');
    }

    const enableStreaming = streamingConfig.enableStreaming;
    console.log("Streaming enabled:", enableStreaming);

    // Prepare messages array
    const messages = [];
    
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({
        role: "system",
        content: systemPrompt.trim()
      });
    }

    messages.push({
      role: "user",
      content: promptContent
    });

    // Get available tools - using chrome.storage directly to avoid circular imports
    const result = await new Promise(resolve => {
      chrome.storage.local.get(['promptPaulTools'], resolve);
    });
    const availableTools = (result.promptPaulTools || []).filter(tool => tool.enabled !== false);
    
    // Prepare request body
    const requestBody = {
      model: modelName,
      messages: messages,
      max_tokens: maxTokens || 4000,
      stream: enableStreaming,
      tools: availableTools.length > 0 ? availableTools : undefined,
      tool_choice: customInstructionToolChoice || (availableTools.length > 0 ? "auto" : undefined)
    };

    // Remove undefined fields
    Object.keys(requestBody).forEach(key => 
      requestBody[key] === undefined && delete requestBody[key]
    );

    console.log("Request body prepared:", {
      model: requestBody.model,
      messageCount: requestBody.messages.length,
      toolCount: requestBody.tools?.length || 0,
      streaming: requestBody.stream
    });

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    // Handle streaming vs non-streaming
    if (enableStreaming) {
      await handleStreamingRequest(llmEndpoint, requestBody, headers, tabId, isStartChat);
    } else {
      await handleNonStreamingRequest(llmEndpoint, requestBody, headers, tabId, isStartChat);
    }

  } catch (error) {
    console.error('Error in makeLlmApiRequest:', error);
    
    const errorMessage = {
      action: 'llmResponse',
      response: `Error: ${error.message}`,
      isStartChatContext: isStartChat,
      error: true
    };

    if (tabId && tabId !== -1) {
      try {
        await chrome.tabs.sendMessage(tabId, errorMessage);
      } catch (sendError) {
        console.warn('Failed to send error message to tab:', sendError);
      }
    }
  }
}

async function handleStreamingRequest(endpoint, requestBody, headers, tabId, isStartChat) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedContent = '';

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
            const delta = parsed.choices?.[0]?.delta;
            
            if (delta?.content) {
              accumulatedContent += delta.content;
              
              // Send streaming update
              const streamMessage = {
                action: 'llmStreamingResponse',
                content: delta.content,
                accumulated: accumulatedContent,
                isStartChatContext: isStartChat
              };

              if (tabId && tabId !== -1) {
                try {
                  await chrome.tabs.sendMessage(tabId, streamMessage);
                } catch (error) {
                  console.warn('Failed to send streaming message:', error);
                }
              }
            }

            // Handle tool calls in streaming
            if (delta?.tool_calls) {
              // Handle tool calls (simplified for now)
              console.log('Tool calls in streaming response:', delta.tool_calls);
            }
          } catch (parseError) {
            console.warn('Failed to parse streaming data:', parseError);
          }
        }
      }
    }

    // Send final message
    const finalMessage = {
      action: 'llmStreamingComplete',
      finalContent: accumulatedContent,
      isStartChatContext: isStartChat
    };

    if (tabId && tabId !== -1) {
      try {
        await chrome.tabs.sendMessage(tabId, finalMessage);
      } catch (error) {
        console.warn('Failed to send completion message:', error);
      }
    }

  } catch (error) {
    console.error('Streaming request error:', error);
    throw error;
  }
}

async function handleNonStreamingRequest(endpoint, requestBody, headers, tabId, isStartChat) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    // Handle tool calls - send message to background script to handle
    if (data.choices?.[0]?.message?.tool_calls) {
      // Send tool call response to background for processing
      chrome.runtime.sendMessage({
        action: 'handleToolCallResponse',
        responseMessage: data.choices[0].message,
        prompt: null,
        tabId: tabId,
        isStartChat: isStartChat
      });
      return;
    }

    // Regular response
    const content = data.choices?.[0]?.message?.content || 'No response content';
    await _handleApiResponseAndSendMessage(content, null, tabId, isStartChat, false);

  } catch (error) {
    console.error('Non-streaming request error:', error);
    throw error;
  }
}

export {
  makeLlmApiRequest,
  validateConfig,
  isValidURL,
  _handleApiResponseAndSendMessage
};