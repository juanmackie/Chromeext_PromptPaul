/**
 * Context Menu Service
 * Handles all context menu creation and management
 * Implements production-ready coding rules for context menu handling
 *
 * Core Principles:
 * - Input Validation: Validate all menu items
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient menu creation and updates
 */

import { logger } from '../shared/index.js';

class ContextMenuService {
  constructor(dependencies) {
    this.storage = dependencies.Storage;
    this.logger = dependencies.Logger;
    
    // Menu configuration
    this.menuItems = new Map();
    this.parentMenus = new Map();
    this.imageCustomMenuItems = new Set();
  }

  /**
   * Creates the main context menu structure
   * @returns {Promise<void>}
   */
  async createMainMenu() {
    this.logger.debug('Creating main context menu structure');

    try {
      // Create one-off instruction menu item (always at top)
      chrome.contextMenus.create({
        id: 'oneoff_instruction',
        title: '✨ One-off Instruction',
        contexts: ['selection', 'image'],
      });

      // Create start chat menu item
      chrome.contextMenus.create({
        id: 'start_chat',
        title: '💬 Start Chat',
        contexts: ['selection', 'image'],
      });

      // Create parent menu for Prompt Paul
      chrome.contextMenus.create({
        id: 'prompt_paul',
        title: 'Query Prompt Paul',
        contexts: ['selection', 'image'],
      });

      // Create predefined menu items under Prompt Paul
      this.createPromptPaulMenuItems();

      // Create parent menu for custom instructions
      chrome.contextMenus.create({
        id: 'customInstructions',
        title: 'Custom Instructions',
        contexts: ['selection', 'image'],
      });

      // Create parent menu for media analysis
      this.createMediaAnalysisMenus();

      // Load and create custom instruction menu items
      await this.createCustomInstructionMenuItems();

      // Add separator and manage instructions at the end
      setTimeout(() => {
        this.createMenuFooter();
      }, 100);

      this.logger.info('Main context menu created successfully');
    } catch (error) {
      this.logger.error('Failed to create main context menu', {}, error);
      throw error;
    }
  }

  /**
   * Creates predefined Prompt Paul menu items
   */
  createPromptPaulMenuItems() {
    const predefinedCommands = [
      { id: 'summarize', title: '📝 Summarize' },
      { id: 'analyze', title: '🧐 Analyze' },
      { id: 'explain', title: '❓ Explain' },
      { id: 'polish', title: '🪄 Polish' },
      { id: 'shorten', title: '\u2702\uFE0F Shorten' },
      { id: 'formal', title: '💼 Formal' },
      { id: 'casual', title: '🤙 Casual' }
    ];

    predefinedCommands.forEach(command => {
      chrome.contextMenus.create({
        id: command.id,
        title: command.title,
        contexts: ['selection', 'image'],
        parentId: 'prompt_paul'
      });

      this.menuItems.set(command.id, {
        type: 'predefined',
        contexts: ['selection', 'image'],
        parentId: 'prompt_paul'
      });
    });
  }

  /**
   * Creates media analysis menu items
   */
  createMediaAnalysisMenus() {
    // Create parent menu for image analysis
    chrome.contextMenus.create({
      id: 'imageAnalysis',
      title: '📷 Analyze Image',
      contexts: ['image']
    });

    // Create image analysis options
    const imageOptions = [
      { id: 'analyzeImage', title: '🔍 Analyze Image' },
      { id: 'summarizeImage', title: '📝 Summarize Image' },
      { id: 'explainImage', title: '💡 Explain Image' }
    ];

    imageOptions.forEach(option => {
      chrome.contextMenus.create({
        id: option.id,
        title: option.title,
        contexts: ['image'],
        parentId: 'imageAnalysis'
      });

      this.menuItems.set(option.id, {
        type: 'media',
        mediaType: 'image',
        actionType: option.id.replace('Image', '').toLowerCase(),
        contexts: ['image'],
        parentId: 'imageAnalysis'
      });
    });

    // Create parent menu for video analysis
    chrome.contextMenus.create({
      id: 'videoAnalysis',
      title: '🎬 Analyze Video',
      contexts: ['video']
    });

    // Create video analysis options
    const videoOptions = [
      { id: 'analyzeVideo', title: '🔍 Analyze Video' },
      { id: 'summarizeVideo', title: '📝 Summarize Video' }
    ];

    videoOptions.forEach(option => {
      chrome.contextMenus.create({
        id: option.id,
        title: option.title,
        contexts: ['video'],
        parentId: 'videoAnalysis'
      });

      this.menuItems.set(option.id, {
        type: 'media',
        mediaType: 'video',
        actionType: option.id.replace('Video', '').toLowerCase(),
        contexts: ['video'],
        parentId: 'videoAnalysis'
      });
    });

    // Create parent menu for audio analysis
    chrome.contextMenus.create({
      id: 'audioAnalysis',
      title: '🎵 Analyze Audio',
      contexts: ['audio']
    });

    // Create audio analysis options
    const audioOptions = [
      { id: 'analyzeAudio', title: '🔍 Analyze Audio' },
      { id: 'summarizeAudio', title: '📝 Summarize Audio' }
    ];

    audioOptions.forEach(option => {
      chrome.contextMenus.create({
        id: option.id,
        title: option.title,
        contexts: ['audio'],
        parentId: 'audioAnalysis'
      });

      this.menuItems.set(option.id, {
        type: 'media',
        mediaType: 'audio',
        actionType: option.id.replace('Audio', '').toLowerCase(),
        contexts: ['audio'],
        parentId: 'audioAnalysis'
      });
    });
  }

  /**
   * Creates custom instruction menu items
   * @returns {Promise<void>}
   */
  async createCustomInstructionMenuItems() {
    try {
      const { instructions } = await this.storage.get(['instructions']);
      const customInstructions = instructions || [];

      if (customInstructions.length > 0) {
        customInstructions.forEach(instruction => {
          chrome.contextMenus.create({
            id: `custom_${instruction.id}`,
            parentId: 'customInstructions',
            title: `✨ ${instruction.name}`,
            contexts: ['selection', 'image'],
          });

          this.menuItems.set(`custom_${instruction.id}`, {
            type: 'custom',
            instructionId: instruction.id,
            instructionName: instruction.name,
            instructionContent: instruction.content,
            contexts: ['selection', 'image'],
            parentId: 'customInstructions'
          });
        });
      }

      // Create image custom instruction menu items
      await this.createImageCustomInstructionMenuItems(customInstructions);

      this.logger.debug(`Created ${customInstructions.length} custom instruction menu items`);
    } catch (error) {
      this.logger.error('Failed to create custom instruction menu items', {}, error);
    }
  }

  /**
   * Creates image-specific custom instruction menu items
   * @param {Array} instructions - Custom instructions
   * @returns {Promise<void>}
   */
  async createImageCustomInstructionMenuItems(instructions) {
    try {
      // Remove existing custom instruction menu items that we know exist
      for (const menuItemId of this.imageCustomMenuItems) {
        try {
          await new Promise((resolve, reject) => {
            chrome.contextMenus.remove(menuItemId, () => {
              if (chrome.runtime.lastError) {
                resolve(); // Menu item doesn't exist, that's fine
              } else {
                resolve();
              }
            });
          });
        } catch (e) {
          // Ignore errors for non-existent menu items
        }
      }
      this.imageCustomMenuItems.clear();

      // Add current custom instructions
      if (instructions && instructions.length > 0) {
        for (const instruction of instructions) {
          const menuItemId = `imageCustom_${instruction.id}`;
          try {
            await new Promise((resolve, reject) => {
              chrome.contextMenus.create({
                id: menuItemId,
                parentId: "imageAnalysis",
                title: `⚡ ${instruction.name}`,
                contexts: ["image"]
              }, () => {
                if (chrome.runtime.lastError) {
                  this.logger.warn(`Failed to create menu item ${menuItemId}:`, chrome.runtime.lastError.message);
                  resolve();
                } else {
                  this.imageCustomMenuItems.add(menuItemId);
                  resolve();
                }
              });
            });
          } catch (e) {
            this.logger.warn(`Error creating menu item for instruction ${instruction.name}:`, e);
          }
        }
      }

      this.logger.debug(`Updated image context menu with ${this.imageCustomMenuItems.size} custom instructions`);
    } catch (error) {
      this.logger.error('Failed to create image custom instruction menu items', {}, error);
    }
  }

  /**
   * Creates menu footer items
   */
  createMenuFooter() {
    // Add a separator
    chrome.contextMenus.create({
      id: 'separator',
      type: 'separator',
      contexts: ['selection', 'image'],
    });

    // Add option to manage custom instructions as the last item
    chrome.contextMenus.create({
      id: 'manageInstructions',
      title: 'Manage Custom Instructions',
      contexts: ['selection', 'image'],
    });

    this.menuItems.set('separator', {
      type: 'separator',
      contexts: ['selection', 'image']
    });

    this.menuItems.set('manageInstructions', {
      type: 'action',
      action: 'manage',
      contexts: ['selection', 'image']
    });
  }

  /**
   * Updates custom instruction menu items
   * @returns {Promise<void>}
   */
  async updateCustomInstructionMenuItems() {
    this.logger.debug('Updating custom instruction menu items');

    try {
      // Remove existing menu items
      await this.removeMenuItemsByPrefix('custom_');
      await this.removeMenuItemsByPrefix('imageCustom_');

      // Recreate custom instruction menu items
      await this.createCustomInstructionMenuItems();

      this.logger.info('Custom instruction menu items updated successfully');
    } catch (error) {
      this.logger.error('Failed to update custom instruction menu items', {}, error);
    }
  }

  /**
   * Removes menu items by prefix
   * @param {string} prefix - Menu item ID prefix
   * @returns {Promise<void>}
   */
  async removeMenuItemsByPrefix(prefix) {
    try {
      const menuItems = await this.getAllMenuItems();
      
      for (const item of menuItems) {
        if (item.id && item.id.startsWith(prefix)) {
          await new Promise((resolve) => {
            chrome.contextMenus.remove(item.id, () => {
              if (chrome.runtime.lastError) {
                this.logger.warn(`Failed to remove menu item ${item.id}:`, chrome.runtime.lastError.message);
              }
              resolve();
            });
          });

          this.menuItems.delete(item.id);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to remove menu items with prefix ${prefix}`, {}, error);
    }
  }

  /**
   * Gets all menu items
   * @returns {Promise<Array>} Array of menu items
   */
  async getAllMenuItems() {
    return new Promise((resolve) => {
      chrome.contextMenus.getAll(resolve);
    });
  }

  /**
   * Gets menu item information
   * @param {string} menuItemId - Menu item ID
   * @returns {Object|null} Menu item information or null if not found
   */
  getMenuItemInfo(menuItemId) {
    return this.menuItems.get(menuItemId) || null;
  }

  /**
   * Handles context menu click
   * @param {Object} info - Click information
   * @param {Object} tab - Tab information
   * @returns {Object} Processed click information
   */
  handleMenuClick(info, tab) {
    const menuItemInfo = this.getMenuItemInfo(info.menuItemId);
    
    if (!menuItemInfo) {
      this.logger.warn(`Unknown menu item clicked: ${info.menuItemId}`);
      return null;
    }

    this.logger.debug(`Context menu clicked: ${info.menuItemId}`, {
      type: menuItemInfo.type,
      contexts: menuItemInfo.contexts
    });

    return {
      menuItemId: info.menuItemId,
      menuItemInfo,
      selectionText: info.selectionText,
      srcUrl: info.srcUrl,
      mediaType: info.mediaType,
      tab
    };
  }

  /**
   * Sets up context menu click listener
   * @param {Function} callback - Click handler callback
   */
  setupClickListener(callback) {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      const clickInfo = this.handleMenuClick(info, tab);
      if (clickInfo) {
        callback(clickInfo);
      }
    });

    this.logger.debug('Context menu click listener set up');
  }

  /**
   * Initializes the context menu service
   * @param {Function} clickCallback - Click handler callback
   * @returns {Promise<void>}
   */
  async initialize(clickCallback) {
    this.logger.debug('Initializing context menu service');

    try {
      // Create main menu
      await this.createMainMenu();

      // Set up click listener
      this.setupClickListener(clickCallback);

      // Set up storage change listener for custom instructions
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.instructions) {
          this.logger.debug('Custom instructions changed, updating context menus...');
          this.updateCustomInstructionMenuItems();
        }
      });

      this.logger.info('Context menu service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize context menu service', {}, error);
      throw error;
    }
  }
}

export default ContextMenuService;