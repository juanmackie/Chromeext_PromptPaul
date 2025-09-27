// ===== Chat Message Handler =====

class ChatMessageHandler {
  constructor(stateManager, uiRenderer) {
    this.stateManager = stateManager;
    this.uiRenderer = uiRenderer;
  }

  async handleSetSelectedText(request, chatMainArea, oneoffInstructionArea, selectedTextDiv) {
    this.stateManager.setSelectedText(request.selectedText, request.tabId, request.fromStartChat);
    
    if (request.fromStartChat) {
      this.uiRenderer.switchToMainArea(chatMainArea, oneoffInstructionArea);
      this.stateManager.clearHistory();
    } else {
      selectedTextDiv.textContent = request.selectedText;
      this.uiRenderer.switchToOneoffArea(chatMainArea, oneoffInstructionArea);
    }
  }

  async handleSetMediaForAnalysis(request, chatMainArea, oneoffInstructionArea) {
    const mediaData = request.mediaData;
    this.stateManager.tabId = request.tabId;
    
    // Show chat area
    this.uiRenderer.switchToMainArea(chatMainArea, oneoffInstructionArea);
    
    if (mediaData.loading) {
      this.uiRenderer.addMessage('System', `📥 Loading ${mediaData.type} for analysis...`);
    } else if (mediaData.error) {
      this.uiRenderer.addMessage('System', `❌ Error loading ${mediaData.type}: ${mediaData.error}`);
    } else if (mediaData.base64) {
      // Media loaded successfully
      this.stateManager.setMediaData(mediaData);
      
      // Add media preview to chat
      this.uiRenderer.addMediaPreview(mediaData);
      
      // Generate and return analysis prompt (chat.js will execute the API call)
      return await this.handleMediaAnalysis(mediaData);
    }
  }

  async handleMediaAnalysis(mediaData) {
    let analysisPrompt;
    
    if (mediaData.actionType === "custom" && mediaData.instructionId) {
      // Handle custom instruction
      return new Promise((resolve) => {
        chrome.storage.local.get(['instructions'], (result) => {
          const instructions = result.instructions || [];
          const instruction = instructions.find(i => i.id === mediaData.instructionId);
          if (instruction) {
            analysisPrompt = instruction.content;
            this.uiRenderer.addMessage('System', `🎯 Using custom instruction: "${instruction.name}"`);
          } else {
            analysisPrompt = `Please analyze this ${mediaData.type}. Describe what you see and provide any relevant insights.`;
          }
          
          console.log('About to call makeApiCallWithMedia with custom instruction:', {
            type: mediaData.type,
            mimeType: mediaData.mimeType,
            base64Length: mediaData.base64 ? mediaData.base64.length : 0,
            hasBase64: !!mediaData.base64,
            actionType: mediaData.actionType,
            prompt: analysisPrompt.substring(0, 100) + '...'
          });
          
          // This would need to be injected as a dependency
          // makeApiCallWithMedia(analysisPrompt, mediaData);
          resolve({ prompt: analysisPrompt, mediaData });
        });
      });
    } else if (mediaData.actionType === "summarize") {
      analysisPrompt = `Please summarize this ${mediaData.type} into a bullet list of key points. Focus on the main elements, text, objects, and overall message or purpose.`;
      this.uiRenderer.addMessage('System', `📝 Summarizing ${mediaData.type}...`);
    } else if (mediaData.actionType === "explain") {
      analysisPrompt = `Explain this ${mediaData.type} to me in a short concise MECE approach. Break down what you see into clear, structured categories.`;
      this.uiRenderer.addMessage('System', `💡 Explaining ${mediaData.type}...`);
    } else {
      // Default analysis
      analysisPrompt = `Please analyze this ${mediaData.type}. Describe what you see and provide any relevant insights.`;
    }
    
    return { prompt: analysisPrompt, mediaData };
  }

  handleStreamingResponse(request) {
    if (!this.stateManager.isStreaming()) {
      console.warn('Received streaming response but not in streaming state');
      return;
    }

    const currentContentElement = this.stateManager.currentStreamingContentElement;
    if (!currentContentElement) {
      console.warn('No current streaming content element');
      return;
    }

    // Append streamed text
    this.stateManager.appendStreamedText(request.content);
    
    // Update UI with accumulated text
    const accumulatedText = this.stateManager.getAccumulatedText();
    if (typeof marked !== 'undefined') {
      currentContentElement.innerHTML = marked.parse(accumulatedText);
    } else {
      currentContentElement.textContent = accumulatedText;
    }
    
    this.uiRenderer.scrollToBottom();
  }

  handleStreamingComplete(request, userInput, sendButton, clearButton) {
    if (!this.stateManager.isStreaming()) {
      console.warn('Received streaming complete but not in streaming state');
      return;
    }

    const finalContent = request.finalContent || this.stateManager.getAccumulatedText();
    const currentContentElement = this.stateManager.currentStreamingContentElement;
    const uniqueId = this.stateManager.currentStreamingUniqueId;

    // Finalize content display
    if (currentContentElement && finalContent.trim()) {
      if (typeof marked !== 'undefined') {
        currentContentElement.innerHTML = marked.parse(finalContent);
      } else {
        currentContentElement.textContent = finalContent;
      }

      // Attach copy listeners - ensure icons exist in DOM before trying to attach listeners
      setTimeout(() => {
        const copyIcon = document.getElementById(`copy-icon-${uniqueId}`);
        const copyFormattedIcon = document.getElementById(`copy-formatted-icon-${uniqueId}`);
        if (copyIcon && copyFormattedIcon) {
          this.uiRenderer.attachCopyListeners(finalContent, currentContentElement, copyIcon, copyFormattedIcon);
        }
      }, 0); // Small delay to ensure DOM elements are available
    }

    // Add to conversation history
    if (finalContent.trim()) {
      this.stateManager.addToHistory({ role: 'assistant', content: finalContent });
    }

    // Reset UI state
    this.uiRenderer.enableInputs(userInput, sendButton);
    this.uiRenderer.updateClearButton(clearButton, 'Clear');
    this.stateManager.resetStreamingState();
  }

  handleToolCallChunk(request) {
    console.log("Chat: streamApiToolCallChunk handler invoked.", request);
    
    if (!this.stateManager.isStreaming() || !request.toolCallChunk || request.toolCallChunk.length === 0) {
      console.warn('Invalid tool call chunk or not in streaming state');
      return;
    }

    const toolCall = request.toolCallChunk[0];
    console.log("Chat: Extracted toolCall from chunk:", toolCall);
    
    this.stateManager.setActiveToolCall(toolCall);
    
    const currentContentElement = this.stateManager.currentStreamingContentElement;
    if (currentContentElement) {
      // Clear previous content and show tool usage
      currentContentElement.innerHTML = '';
      
      // This is an async operation that updates the UI
      this.updateToolCallDisplay(toolCall, currentContentElement);
    }
    
    this.uiRenderer.scrollToBottom();
  }

  async updateToolCallDisplay(toolCall, contentElement) {
    try {
      // This would need to be injected as a dependency
      // const allTools = await getTools();
      // const currentToolDef = allTools.find(t => t.name === toolCall.function.name);
      
      // For now, just show basic tool usage
      if (typeof marked !== 'undefined') {
        contentElement.innerHTML = marked.parse(`⚙️ Using tool: **${toolCall.function.name}**`);
      } else {
        contentElement.textContent = `⚙️ Using tool: ${toolCall.function.name}`;
      }
    } catch (error) {
      console.error('Error updating tool call display:', error);
      contentElement.textContent = `⚙️ Using tool: ${toolCall.function.name}`;
    }
  }

  handleAnthropicContentBlockStart(request) {
    console.log("Chat: streamApiAnthropicContentBlockStart received", request.contentBlock);
    
    if (!this.stateManager.currentStreamingContentElement || !request.contentBlock) {
      return;
    }

    const block = request.contentBlock;
    if (block.type === 'mcp_tool_use') {
      const toolUseMessage = `⚙️ Using MCP tool (Anthropic): **${block.name}** (Server: ${block.server_name})`;
      this.uiRenderer.addMessage('System', toolUseMessage);
    } else if (block.type === 'text') {
      console.log("Chat: Anthropic stream started a text block:", block.text || "(empty initial text)");
    }
    
    this.uiRenderer.scrollToBottom();
  }

  handleAnthropicMessageStop(request, userInput, sendButton, clearButton) {
    console.log("Chat: streamApiAnthropicMessageStop received, full Anthropic message:", request.anthropicMessage);
    
    if (!this.stateManager.isStreaming()) {
      return;
    }

    const accumulatedText = this.stateManager.getAccumulatedText();
    const currentContentElement = this.stateManager.currentStreamingContentElement;
    const uniqueId = this.stateManager.currentStreamingUniqueId;

    // Finalize the display with accumulated text
    if (currentContentElement && accumulatedText) {
      if (typeof marked !== 'undefined') {
        currentContentElement.innerHTML = marked.parse(accumulatedText);
      } else {
        currentContentElement.textContent = accumulatedText;
      }
      
      setTimeout(() => {
        const copyIcon = document.getElementById(`copy-icon-${uniqueId}`);
        const copyFormattedIcon = document.getElementById(`copy-formatted-icon-${uniqueId}`);
        if (copyIcon && copyFormattedIcon) {
          this.uiRenderer.attachCopyListeners(accumulatedText, currentContentElement, copyIcon, copyFormattedIcon);
        }
      }, 0); // Small delay to ensure DOM elements are available
    }

    // Add the complete Anthropic message object to history
    if (request.anthropicMessage) {
      this.stateManager.addToHistory(request.anthropicMessage);
      console.log("Chat: Added full Anthropic message to history from streamApiAnthropicMessageStop:", request.anthropicMessage);
    }

    // Reset UI
    this.uiRenderer.enableInputs(userInput, sendButton);
    this.uiRenderer.updateClearButton(clearButton, 'Clear');
    this.stateManager.resetStreamingState();

    // Set a flag to prevent streamApiEnd from duplicating actions
    window.anthropicStreamFinalizedByStopEvent = true;
  }

  async handleToolCallResponse(request) {
    console.log("Chat: handleToolCallResponse (OpenAI-style) received", request);
    
    const { responseMessage } = request;
    
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCall = responseMessage.tool_calls[0];
      
      try {
        // This would need tool execution capability injected
        // const allTools = await getTools();
        // const toolDefinition = allTools.find(t => t.name === toolCall.function.name);
        
        this.uiRenderer.addMessage('System', `🔧 Executing tool: ${toolCall.function.name}`);
        
        // Tool execution would happen here
        // For now, just show that we received the tool call
        console.log('Tool call to execute:', toolCall);
        
      } catch (error) {
        console.error('Error handling tool call response:', error);
        this.uiRenderer.addMessage('System', `❌ Error handling tool call: ${error.message}`);
      }
    }
  }
}

export { ChatMessageHandler };