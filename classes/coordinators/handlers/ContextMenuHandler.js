import { BaseManager } from '../../managers/BaseManager.js';

/**
 * Context Menu Handler for Background Coordinator
 * Implements the Single Responsibility Principle for context menu operations
 */
export class ContextMenuHandler extends BaseManager {
  constructor(coordinator) {
    super();
    this.coordinator = coordinator;
  }

  /**
   * Set up context menu listeners
   */
  setupContextMenuListeners() {
    // Handle context menu clicks
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      this.handleContextMenuClick(info, tab);
    });
    
    // Create context menus when extension is installed
    chrome.runtime.onInstalled.addListener(() => {
      this.createContextMenus();
    });

    // Also create context menus when the browser starts
    chrome.runtime.onStartup?.addListener(() => {
      this.createContextMenus();
    });
    
    // Also create context menus immediately when handler is set up
    // This ensures menus are available even if onInstalled doesn't fire
    // Use a slight delay to avoid race conditions
    setTimeout(() => {
      this.createContextMenus().catch(error => {
        console.error('Error creating context menus on startup:', error);
      });
    }, 100);
  }

  /**
   * Handle context menu click
   * @param {Object} info - Click info
   * @param {Object} tab - Tab object
   */
  async handleContextMenuClick(info, tab) {
    console.log('🎯 CONTEXT MENU CLICKED:', {
      menuItemId: info.menuItemId,
      tabId: tab.id,
      hasSelection: !!info.selectionText,
      timestamp: new Date().toISOString()
    });
    
    try {
      // For actions that need side panel, open it immediately to preserve user gesture
      const needsSidePanel = ['oneoff_instruction', 'start_chat', 'summarize', 'analyze', 'explain', 'polish', 'shorten', 'formal', 'casual'].includes(info.menuItemId) || info.menuItemId.startsWith('custom_');
      
      if (needsSidePanel) {
        // Open side panel immediately while we still have user gesture context
        try {
          await chrome.sidePanel.open({ tabId: tab.id });
          console.log('✅ Side panel opened successfully');
        } catch (sidePanelError) {
          console.error('Error opening side panel directly:', sidePanelError);
          // Continue with the action anyway, the side panel might already be open
        }
      }
      
      // Get selected text or use page content
      const content = await this.getContextContent(info, tab);
      console.log('📄 CONTENT EXTRACTED:', {
        contentLength: content.length,
        contentPreview: content.substring(0, 100) + '...'
      });
      
      // Handle different menu actions
      switch (info.menuItemId) {
        case 'oneoff_instruction':
          await this.handleOneOffInstruction(content, tab, false); // false = don't try to open side panel again
          break;
          
        case 'start_chat':
          await this.handleStartChat(content, tab, false);
          break;
          
        case 'summarize':
        case 'analyze':
        case 'explain':
        case 'polish':
        case 'shorten':
        case 'formal':
        case 'casual':
          await this.handlePromptPaulAction(info.menuItemId, content, tab, false);
          break;
          
        case 'manageInstructions':
          await this.handleManageInstructions(tab);
          break;
          
        default:
          if (info.menuItemId.startsWith('custom_')) {
            await this.handleCustomInstruction(info.menuItemId, content, tab, false);
          }
          break;
      }
    } catch (error) {
      console.error('Error handling context menu click:', error);
    }
  }

  /**
   * Get content from context (selected text or page content)
   * @param {Object} info - Click info
   * @param {Object} tab - Tab object
   * @returns {Promise<String>} - Content
   */
  async getContextContent(info, tab) {
    if (info.selectionText) {
      return info.selectionText;
    }
    
    // Extract page content if no selection
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => {
        const content = document.body.innerText || document.body.textContent || '';
        return content.slice(0, 5000); // Limit to 5KB for context
      }
    });
    
    return results && results[0] ? results[0].result : '';
  }

  /**
   * Handle one-off instruction
   * @param {String} content - Content
   * @param {Object} tab - Tab object
   * @param {Boolean} openSidePanel - Whether to attempt opening side panel
   */
  async handleOneOffInstruction(content, tab, openSidePanel = true) {
    // Store the context data for immediate processing
    await this.coordinator.storageManager.setLocal({
      pendingContextAction: {
        action: 'oneOffInstruction',
        content: content,
        url: tab.url,
        title: tab.title,
        timestamp: Date.now()
      }
    });
    
    // Open side panel if requested (legacy fallback)
    if (openSidePanel) {
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
      } catch (sidePanelError) {
        console.error('Error opening side panel directly:', sidePanelError);
      }
    }
  }

  /**
   * Handle start chat
   * @param {String} content - Content
   * @param {Object} tab - Tab object
   * @param {Boolean} openSidePanel - Whether to attempt opening side panel
   */
  async handleStartChat(content, tab, openSidePanel = true) {
    // Store the context data for immediate processing
    await this.coordinator.storageManager.setLocal({
      pendingContextAction: {
        action: 'startChat',
        content: content,
        url: tab.url,
        title: tab.title,
        timestamp: Date.now()
      }
    });
    
    // Open side panel if requested (legacy fallback)
    if (openSidePanel) {
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
      } catch (sidePanelError) {
        console.error('Error opening side panel directly:', sidePanelError);
      }
    }
  }

  /**
   * Handle Prompt Paul actions
   * @param {String} action - Action type
   * @param {String} content - Content
   * @param {Object} tab - Tab object
   * @param {Boolean} openSidePanel - Whether to attempt opening side panel
   */
  async handlePromptPaulAction(action, content, tab, openSidePanel = true) {
    const prompts = {
      summarize: 'Please provide a concise summary of the following content:',
      analyze: 'Please analyze the following content and provide insights:',
      explain: 'Please explain the following content in simple terms:',
      polish: 'Please polish and improve the following text:',
      shorten: 'Please shorten the following text while keeping the key information:',
      formal: 'Please rewrite the following text in a formal tone:',
      casual: 'Please rewrite the following text in a casual, friendly tone:'
    };
    
    const prompt = prompts[action];
    if (!prompt) {
      console.error('Unknown Prompt Paul action:', action);
      return;
    }
    
    // Store the context data for immediate processing
    const pendingAction = {
      action: 'executePrompt',
      prompt: prompt,
      content: content,
      url: tab.url,
      title: tab.title,
      timestamp: Date.now()
    };
    
    console.log('💾 STORING PENDING ACTION:', {
      action: pendingAction.action,
      prompt: pendingAction.prompt,
      contentLength: pendingAction.content.length,
      timestamp: new Date(pendingAction.timestamp).toISOString()
    });
    
    await this.coordinator.storageManager.setLocal({
      pendingContextAction: pendingAction
    });
    
    // Open side panel if requested (legacy fallback)
    if (openSidePanel) {
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
      } catch (sidePanelError) {
        console.error('Error opening side panel directly:', sidePanelError);
      }
    }
  }

  /**
   * Handle manage instructions
   * @param {Object} tab - Tab object
   */
  async handleManageInstructions(tab) {
    // Open options page
    chrome.runtime.openOptionsPage();
  }

  /**
   * Handle custom instruction
   * @param {String} menuItemId - Menu item ID
   * @param {String} content - Content
   * @param {Object} tab - Tab object
   * @param {Boolean} openSidePanel - Whether to attempt opening side panel
   */
  async handleCustomInstruction(menuItemId, content, tab, openSidePanel = true) {
    const instructionId = menuItemId.replace('custom_', '');
    
    // Get instruction from storage (canonical key)
    const result = await this.coordinator.storageManager.getLocal(['instructions']);
    const instructions = Array.isArray(result.instructions) ? result.instructions : [];
    const instruction = instructions.find(inst => String(inst.id) === instructionId);
    
    if (!instruction) {
      console.error('Custom instruction not found:', instructionId);
      return;
    }
    
    // Store the context data for immediate processing
    const pendingAction = {
      action: 'executeCustomInstruction',
      instruction: instruction,
      content: content,
      url: tab.url,
      title: tab.title,
      timestamp: Date.now()
    };
    
    console.log('💾 STORING PENDING ACTION:', {
      action: pendingAction.action,
      instructionName: pendingAction.instruction.name,
      contentLength: pendingAction.content.length,
      timestamp: new Date(pendingAction.timestamp).toISOString()
    });
    
    await this.coordinator.storageManager.setLocal({
      pendingContextAction: pendingAction
    });
    
    // Open side panel if requested (legacy fallback)
    if (openSidePanel) {
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
      } catch (sidePanelError) {
        console.error('Error opening side panel directly:', sidePanelError);
      }
    }
  }

  /**
   * Helper method to create menu items safely
   * @param {Object} menuProperties - Menu item properties
   */
  createMenuItem(menuProperties) {
    return new Promise((resolve) => {
      chrome.contextMenus.create(menuProperties, () => {
        if (chrome.runtime.lastError) {
          if (chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes('duplicate id')) {
            console.log(`⚠️ Menu item ${menuProperties.id} already exists, skipping creation`);
          } else {
            console.error(`❌ Error creating menu item ${menuProperties.id}:`, chrome.runtime.lastError.message);
          }
        }
        resolve();
      });
    });
  }

  /**
   * Create context menus
   */
  async createContextMenus() {
    console.log('🎯 Creating context menus...');
    
    try {
      // Remove all existing menus first
      await chrome.contextMenus.removeAll();
      console.log('✅ Removed existing context menus');
    
      // Create one-off instruction menu item (always at top)
      await this.createMenuItem({
        id: 'oneoff_instruction',
        title: '✨ One-off Instruction',
        contexts: ['selection', 'image', 'page', 'link', 'editable'],
      });
      console.log('✅ Created one-off instruction menu');
      
      // Create start chat menu item
      await this.createMenuItem({
        id: 'start_chat',
        title: '💬 Start Chat',
        contexts: ['selection', 'image', 'page', 'link', 'editable'],
      });
      console.log('✅ Created start chat menu');

      // Create parent menu for Prompt Paul
      await this.createMenuItem({
        id: 'prompt_paul',
        title: 'Query Prompt Paul',
        contexts: ['selection', 'image', 'page', 'link', 'editable'],
      });
      console.log('✅ Created Prompt Paul parent menu');

      // Create predefined menu items under Prompt Paul
      await this.createPromptPaulMenuItems();
      console.log('✅ Created Prompt Paul sub-menus');
      
      // Create custom instructions menu
      await this.createCustomInstructionsMenu();
      console.log('✅ Created custom instructions menu');
      
      // Add separator and manage instructions
      await this.createManagementMenuItems();
      console.log('✅ Created management menu items');
      
      console.log('🎉 All context menus created successfully!');
      
    } catch (error) {
      console.error('❌ Error creating context menus:', error);
      throw error;
    }
  }

  /**
   * Create Prompt Paul menu items
   */
  async createPromptPaulMenuItems() {
    const menuItems = [
      { id: 'summarize', title: '📝 Summarize' },
      { id: 'analyze', title: '🧐 Analyze' },
      { id: 'explain', title: '❓ Explain' },
      { id: 'polish', title: '🪄 Polish' },
      { id: 'shorten', title: '✂️ Shorten' },
      { id: 'formal', title: '💼 Formal' },
      { id: 'casual', title: '🤙 Casual' }
    ];

    for (const item of menuItems) {
      await this.createMenuItem({
        id: item.id,
        title: item.title,
        contexts: ['selection', 'image', 'page', 'link', 'editable'],
        parentId: 'prompt_paul'
      });
    }
  }

  /**
   * Create custom instructions menu
   */
  async createCustomInstructionsMenu() {
    // Create parent menu for custom instructions
    await this.createMenuItem({
      id: 'customInstructions',
      title: 'Custom Instructions',
      contexts: ['selection', 'image', 'page', 'link', 'editable'],
    });

    // Get instructions and pinned list from storage (new canonical keys)
    const result = await this.coordinator.storageManager.getLocal(['instructions', 'pinnedQuickActions']);
    const allInstructions = Array.isArray(result.instructions) ? result.instructions : [];
    const pinned = Array.isArray(result.pinnedQuickActions) ? new Set(result.pinnedQuickActions) : new Set();

    // Order: pinned first, then others, limit to 10
    const pinnedInstructions = allInstructions.filter(i => pinned.has(i.id));
    const otherInstructions = allInstructions.filter(i => !pinned.has(i.id));
    const ordered = [...pinnedInstructions, ...otherInstructions].slice(0, 10);

    for (const instruction of ordered) {
      const title = `${instruction.emoji || '📋'} ${instruction.name || 'Untitled'}`;
      await this.createMenuItem({
        id: `custom_${instruction.id}`,
        title,
        contexts: ['selection', 'image', 'page', 'link', 'editable'],
        parentId: 'customInstructions'
      });
    }
  }

  /**
   * Create management menu items
   */
  async createManagementMenuItems() {
    // Add a separator
    await this.createMenuItem({
      id: 'separator',
      type: 'separator',
      contexts: ['selection', 'image', 'page', 'link', 'editable'],
    });

    // Add option to manage custom instructions as the last item
    await this.createMenuItem({
      id: 'manageInstructions',
      title: '⚙️ Manage Instructions',
      contexts: ['selection', 'image', 'page', 'link', 'editable'],
    });
  }

  /**
   * Update custom instructions menu
   */
  async updateCustomInstructionsMenu() {
    // Remove old custom menu items by recreating entire menu tree
    try {
      await chrome.contextMenus.removeAll();
    } catch (e) {
      // ignore
    }

    // Recreate full context menu
    await this.createContextMenus();
  }

}