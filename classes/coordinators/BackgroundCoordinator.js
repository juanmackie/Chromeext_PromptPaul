import { BaseCoordinator } from '../coordinators/BaseCoordinator.js';
import { ConfigManager } from '../managers/ConfigManager.js';
import { ToolManager } from '../managers/ToolManager.js';
import { MCPManager } from '../managers/MCPManager.js';
import { StorageManager } from '../managers/StorageManager.js';
import { MessagingManager } from '../managers/MessagingManager.js';

// Import handler classes
import { MessageHandler } from './handlers/MessageHandler.js';
import { ToolExecutionHandler } from './handlers/ToolExecutionHandler.js';
import { ContextMenuHandler } from './handlers/ContextMenuHandler.js';
import { HealthCheckHandler } from './handlers/HealthCheckHandler.js';

/**
 * Background Coordinator handling background operations and coordination
 * Implements the Coordinator pattern for navigation and state flow management
 * Refactored to use handler classes for better separation of concerns
 */
export class BackgroundCoordinator extends BaseCoordinator {
  constructor() {
    super();
    
    // Initialize managers
    this.configManager = new ConfigManager();
    this.toolManager = new ToolManager();
    this.mcpManager = new MCPManager();
    this.storageManager = new StorageManager();
    this.messagingManager = new MessagingManager();
    
    // Initialize handlers
    this.messageHandler = new MessageHandler(this);
    this.toolExecutionHandler = new ToolExecutionHandler(this);
    this.contextMenuHandler = new ContextMenuHandler(this);
    this.healthCheckHandler = new HealthCheckHandler(this);
    
    // Track active tool executions to prevent duplicates
    this.activeToolExecutions = new Set();
    
    // Track content extraction callbacks
    this.tabContentCallback = null;
    this.pinnedActionTabContentCallback = null;
    
    // Track start time for health monitoring
    this.startTime = Date.now();
  }

  /**
   * Start the background coordinator
   */
  async start() {
    console.log('BackgroundCoordinator: Starting...');
    
    try {
      // Initialize managers
      await this.initializeManagers();
      
      // Set up all handlers
      this.setupHandlers();
      
      // Set up side panel options
      this.setupSidePanel();
      
      console.log('BackgroundCoordinator: Started successfully');
      
    } catch (error) {
      console.error('BackgroundCoordinator: Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop the background coordinator and clean up resources
   */
  async stop() {
    console.log('BackgroundCoordinator: Stopping...');
    
    try {
      // Stop health check handler
      this.healthCheckHandler.stopHealthCheck();
      
      // Clean up MCP sessions
      this.mcpManager.cleanupMcpSessions();
      
      // Clear active tool executions
      this.activeToolExecutions.clear();
      
      // Stop child coordinators
      await super.stop();
      
      console.log('BackgroundCoordinator: Stopped successfully');
      
    } catch (error) {
      console.error('BackgroundCoordinator: Error during stop:', error);
    }
  }

  /**
   * Initialize all managers
   */
  async initializeManagers() {
    console.log('BackgroundCoordinator: Initializing managers...');
    
    await this.configManager.initialize();
    await this.toolManager.initialize();
    
    // Mark managers as initialized
    this.configManager.initialized = true;
    this.toolManager.initialized = true;
    this.mcpManager.initialized = true;
    this.storageManager.initialized = true;
    this.messagingManager.initialized = true;
    
    console.log('BackgroundCoordinator: Managers initialized');
  }

  /**
   * Set up all handlers
   */
  setupHandlers() {
    console.log('BackgroundCoordinator: Setting up handlers...');
    
    // Set up message listeners
    this.messageHandler.setupMessageListeners();
    
    // Set up context menu listeners
    this.contextMenuHandler.setupContextMenuListeners();

    // React to storage changes to refresh context menus (instructions/pinned)
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.instructions || changes.pinnedQuickActions)) {
          console.log('Storage changed for instructions/pinnedQuickActions, updating context menus');
          this.updateContextMenus().catch(err => console.error('Failed to update context menus:', err));
        }
      });
    } catch (e) {
      console.warn('Could not attach storage.onChanged listener in background:', e);
    }
    
    // Set up periodic health check
    this.healthCheckHandler.setupHealthCheck();
    
    console.log('BackgroundCoordinator: Handlers set up');
  }

  /**
   * Set up side panel options
   */
  setupSidePanel() {
    console.log('BackgroundCoordinator: Setting up side panel...');
    
    // Enable the side panel on all pages
    chrome.sidePanel
      .setOptions({ path: 'chat.html' })
      .catch((error) => console.error('Error setting side panel options:', error));
      
    // Set options when tab is activated
    chrome.tabs.onActivated.addListener(({ tabId }) => {
      chrome.sidePanel.setOptions({
        tabId,
        path: 'chat.html',
        enabled: true
      }).catch((error) => console.error(`Error setting side panel options for tab ${tabId}:`, error));
    });

    // Handle action clicks (extension icon) to open side panel
    chrome.action.onClicked.addListener(async (tab) => {
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
        console.log('Side panel opened via action click');
      } catch (error) {
        console.error('Error opening side panel via action click:', error);
      }
    });
    
    console.log('BackgroundCoordinator: Side panel set up');
  }

  /**
   * Register tab content callback
   * @param {Function} callback - Callback function
   */
  registerTabContentCallback(callback) {
    this.tabContentCallback = callback;
    console.log('BackgroundCoordinator: Tab content callback registered');
  }

  /**
   * Register pinned action tab content callback
   * @param {Function} callback - Callback function
   */
  registerPinnedActionTabContentCallback(callback) {
    this.pinnedActionTabContentCallback = callback;
    console.log('BackgroundCoordinator: Pinned action tab content callback registered');
  }

  /**
   * Unregister tab content callback
   */
  unregisterTabContentCallback() {
    this.tabContentCallback = null;
    console.log('BackgroundCoordinator: Tab content callback unregistered');
  }

  /**
   * Unregister pinned action tab content callback
   */
  unregisterPinnedActionTabContentCallback() {
    this.pinnedActionTabContentCallback = null;
    console.log('BackgroundCoordinator: Pinned action tab content callback unregistered');
  }

  /**
   * Get health status
   * @returns {Object|null} - Health status
   */
  getHealthStatus() {
    return this.healthCheckHandler.getLastHealthCheck();
  }

  /**
   * Force health check
   * @returns {Promise<Object>} - Health check results
   */
  async forceHealthCheck() {
    return await this.healthCheckHandler.forceHealthCheck();
  }

  /**
   * Update context menus (proxy to handler)
   */
  async updateContextMenus() {
    await this.contextMenuHandler.updateCustomInstructionsMenu();
  }

  /**
   * Get active tool executions count
   * @returns {Number} - Number of active executions
   */
  getActiveToolExecutionsCount() {
    return this.activeToolExecutions.size;
  }

  /**
   * Clear active tool executions
   */
  clearActiveToolExecutions() {
    this.activeToolExecutions.clear();
    console.log('BackgroundCoordinator: Cleared active tool executions');
  }

  /**
   * Get manager status
   * @returns {Object} - Manager status
   */
  getManagerStatus() {
    return {
      configManager: {
        initialized: this.configManager.initialized || false,
        lastActivity: this.configManager.lastActivity || null
      },
      toolManager: {
        initialized: this.toolManager.initialized || false,
        lastActivity: this.toolManager.lastActivity || null
      },
      mcpManager: {
        initialized: this.mcpManager.initialized || false,
        sessionCount: Object.keys(this.mcpManager.mcpSessions || {}).length
      },
      storageManager: {
        initialized: this.storageManager.initialized || false,
        lastActivity: this.storageManager.lastActivity || null
      },
      messagingManager: {
        initialized: this.messagingManager.initialized || false,
        lastActivity: this.messagingManager.lastActivity || null
      }
    };
  }

  /**
   * Handle executePromptPaulTool message (proxy to handler)
   * @param {Object} request - Request object
   * @param {Object} sender - Sender object
   * @param {Function} sendResponse - Response function
   */
  async handleExecutePromptPaulTool(request, sender, sendResponse) {
    return await this.toolExecutionHandler.handleExecutePromptPaulTool(request, sender, sendResponse);
  }
}