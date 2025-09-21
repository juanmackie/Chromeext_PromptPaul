import { BaseManager } from '../../managers/BaseManager.js';

/**
 * Chat Action Handler for managing pending context actions
 * Handles actions like analysis, summarization, etc. from context menu
 */
export class ChatActionHandler extends BaseManager {
  constructor(chatCoordinator) {
    super();
    this.chatCoordinator = chatCoordinator;
  }

  /**
   * Check for pending context actions and handle them
   */
  async checkPendingContextActions() {
    try {
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['pendingContextAction'], resolve);
      });

      const pendingAction = result.pendingContextAction;
      if (pendingAction && pendingAction.timestamp) {
        const now = Date.now();
        const actionAge = now - pendingAction.timestamp;
        
        // Only process actions that are less than 30 seconds old
        if (actionAge < 30000) {
          console.log('Processing pending context action:', pendingAction);
          await this.handlePendingAction(pendingAction);
          
          // Clear the pending action
          await new Promise((resolve) => {
            chrome.storage.local.remove(['pendingContextAction'], resolve);
          });
        } else {
          console.log('Pending action too old, ignoring:', actionAge);
          // Clear old pending action
          await new Promise((resolve) => {
            chrome.storage.local.remove(['pendingContextAction'], resolve);
          });
        }
      }
    } catch (error) {
      console.error('Error checking pending context actions:', error);
    }
  }

  /**
   * Start monitoring for new pending context actions
   */
  startMonitoring() {
    // Listen for storage changes to detect new pending actions
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.pendingContextAction) {
        const newAction = changes.pendingContextAction.newValue;
        if (newAction && newAction.timestamp) {
          console.log('🔄 New pending action detected, processing:', newAction);
          this.checkPendingContextActions();
        }
      }
    });
    
    console.log('✅ Started monitoring for pending context actions');
  }

  /**
   * Stop monitoring for pending context actions
   */
  stopMonitoring() {
    // Note: chrome.storage.onChanged.removeListener doesn't work well with anonymous functions
    // We'll rely on the coordinator's stop method to clean up
    console.log('🛑 Stopped monitoring for pending context actions');
  }

  /**
   * Handle a pending action
   * @param {Object} action - The pending action to handle
   */
  async handlePendingAction(action) {
    switch (action.action) {
      case 'analyze':
        await this.handleAnalyzeAction(action);
        break;
      case 'summarize':
        await this.handleSummarizeAction(action);
        break;
      case 'explain':
        await this.handleExplainAction(action);
        break;
      case 'translate':
        await this.handleTranslateAction(action);
        break;
      case 'custom':
        await this.handleCustomAction(action);
        break;
      case 'executeCustomInstruction':
        await this.handleExecuteCustomInstructionAction(action);
        break;
      case 'executePrompt':
        await this.handleExecutePromptAction(action);
        break;
      case 'oneOffInstruction':
        await this.handleOneOffInstructionAction(action);
        break;
      case 'startChat':
        await this.handleStartChatAction(action);
        break;
      default:
        console.warn('Unknown pending action:', action.action);
    }
  }

  /**
   * Handle analyze action
   * @param {Object} action - Action details
   */
  async handleAnalyzeAction(action) {
    const message = `Please analyze the following content: ${action.selectedText}`;
    await this.chatCoordinator.sendMessage(message, action.mediaData);
  }

  /**
   * Handle summarize action
   * @param {Object} action - Action details
   */
  async handleSummarizeAction(action) {
    const message = `Please provide a concise summary of the following content:\n\n${action.selectedText}`;
    await this.chatCoordinator.sendMessage(message, action.mediaData);
  }

  /**
   * Handle explain action
   * @param {Object} action - Action details
   */
  async handleExplainAction(action) {
    const message = `Please explain the following content in simple terms:\n\n${action.selectedText}`;
    await this.chatCoordinator.sendMessage(message, action.mediaData);
  }

  /**
   * Handle translate action
   * @param {Object} action - Action details
   */
  async handleTranslateAction(action) {
    const targetLanguage = action.targetLanguage || 'English';
    const message = `Please translate the following content to ${targetLanguage}:\n\n${action.selectedText}`;
    await this.chatCoordinator.sendMessage(message, action.mediaData);
  }

  /**
   * Handle custom action
   * @param {Object} action - Action details
   */
  async handleCustomAction(action) {
    const instructionText = (action.instruction || 'Please process the following content').toString().trim();
    const selectedText = (action.selectedText || '').toString().trim();
    const message = instructionText && selectedText
      ? `${instructionText}: ${selectedText}`
      : (instructionText || selectedText);
    
    await this.chatCoordinator.sendMessage(message, action.mediaData, action.toolChoice);
  }

  /**
   * Handle execute custom instruction action
   * @param {Object} action - Action details
   */
  async handleExecuteCustomInstructionAction(action) {
    console.log('🎯 Handling executeCustomInstruction action:', {
      hasInstruction: !!action.instruction,
      instructionName: action.instruction?.name,
      contentLength: action.content?.length
    });

    if (!action.instruction) {
      console.error('❌ No instruction found in executeCustomInstruction action');
      return;
    }

    // Combine the instruction content with the selected context using a colon
    const instructionText = (action.instruction?.content ?? action.instruction?.prompt ?? '').trim();
    const contextText = (action.content ?? '').trim();
    const message = instructionText && contextText
      ? `${instructionText}: ${contextText}`
      : (instructionText || contextText);
    console.log('📨 Sending message to ChatCoordinator:', message.substring(0, 200) + '...');
    
    await this.chatCoordinator.sendMessage(message, action.mediaData);
    console.log('✅ Message sent to ChatCoordinator');
  }

  /**
   * Handle execute prompt action (for Prompt Paul menu items)
   * @param {Object} action - Action details
   */
  async handleExecutePromptAction(action) {
    if (!action.prompt) {
      console.error('No prompt found in executePrompt action');
      return;
    }

    // Combine the prompt with the content using a colon
    const promptText = (action.prompt || '').toString().trim();
    const contentText = (action.content || '').toString().trim();
    const message = promptText && contentText
      ? `${promptText}: ${contentText}`
      : (promptText || contentText);
    
    await this.chatCoordinator.sendMessage(message, action.mediaData);
  }

  /**
   * Handle one-off instruction action
   * @param {Object} action - Action details
   */
  async handleOneOffInstructionAction(action) {
    console.log('🎯 Handling oneOffInstruction action:', {
      contentLength: action.content?.length,
      url: action.url,
      title: action.title
    });

    // For one-off instructions, we need to show the instruction interface
    // This will be handled by the UI to show the instruction input area
    const event = new CustomEvent('showOneOffInstruction', {
      detail: {
        content: action.content,
        url: action.url,
        title: action.title
      }
    });
    document.dispatchEvent(event);
  }

  /**
   * Handle start chat action
   * @param {Object} action - Action details
   */
  async handleStartChatAction(action) {
    console.log('🎯 Handling startChat action:', {
      contentLength: action.content?.length,
      url: action.url,
      title: action.title
    });

    // For start chat, we prefill the chat input with the content
    const event = new CustomEvent('startChatWithContent', {
      detail: {
        content: action.content,
        url: action.url,
        title: action.title
      }
    });
    document.dispatchEvent(event);
  }

  /**
   * Set a pending action
   * @param {Object} action - Action to set as pending
   */
  async setPendingAction(action) {
    const pendingAction = {
      ...action,
      timestamp: Date.now()
    };

    return new Promise((resolve) => {
      chrome.storage.local.set({ pendingContextAction: pendingAction }, resolve);
    });
  }

  /**
   * Clear pending action
   */
  async clearPendingAction() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['pendingContextAction'], resolve);
    });
  }

  /**
   * Check if there's a pending action
   * @returns {Promise<Object|null>} - Pending action or null
   */
  async getPendingAction() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['pendingContextAction'], (result) => {
        resolve(result.pendingContextAction || null);
      });
    });
  }
}