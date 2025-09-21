import { BaseCoordinator } from '../coordinators/BaseCoordinator.js';
import { OptionsViewModel } from '../viewmodels/OptionsViewModel.js';
import { ConfigManager } from '../managers/ConfigManager.js';
import { InstructionManager } from '../managers/InstructionManager.js';
import { ToolManager } from '../managers/ToolManager.js';
import { StorageManager } from '../managers/StorageManager.js';
import { UIManager } from '../managers/UIManager.js';

/**
 * Options Coordinator handling options flow and coordination
 * Implements the Coordinator pattern for navigation and state flow management
 */
export class OptionsCoordinator extends BaseCoordinator {
  constructor() {
    super();
    
    // Initialize managers
    this.configManager = new ConfigManager();
    this.instructionManager = new InstructionManager();
    this.toolManager = new ToolManager();
    this.storageManager = new StorageManager();
    this.uiManager = new UIManager();
    
    // Initialize view model
    this.viewModel = new OptionsViewModel();
    
    // Bind event handlers
    this.bindEventHandlers();
  }

  /**
   * Start the options coordinator
   */
  async start() {
    console.log('OptionsCoordinator: Starting...');
    // Load initial data
    await this.loadProfiles();
    await this.loadInstructions();
    await this.loadTools();
    await this.loadPreferences();
  }

  /**
   * Stop the options coordinator and clean up resources
   */
  async stop() {
    console.log('OptionsCoordinator: Stopping...');
    // Stop child coordinators
    await super.stop();
  }

  /**
   * Bind event handlers
   */
  bindEventHandlers() {
    // Listen for storage changes to sync preferences (guarded for environments without chrome.storage)
    const storageApi = (typeof chrome !== 'undefined' && chrome.storage) || (typeof browser !== 'undefined' && browser.storage) || null;
    if (storageApi && storageApi.onChanged && typeof storageApi.onChanged.addListener === 'function') {
      storageApi.onChanged.addListener((changes, area) => {
        if (area === 'sync') {
          if (changes.darkTheme) {
            this.viewModel.setDarkTheme(!!changes.darkTheme.newValue);
          }
          if (changes.enableStreaming) {
            this.viewModel.setEnableStreaming(!!changes.enableStreaming.newValue);
          }
        }
        
        if (area === 'local') {
          if (changes.profiles) {
            this.loadProfiles();
          }
          if (changes.instructions) {
            this.loadInstructions();
          }
          if (changes.promptPaulTools) {
            this.loadTools();
          }
          if (changes.pinnedQuickActions) {
            this.loadPinnedActions();
          }
        }
      });
    } else {
      console.warn('OptionsCoordinator: Storage API not available; skipping onChanged listener');
    }
  }

  /**
   * Load profiles from storage
   */
  async loadProfiles() {
    try {
      const result = await this.storageManager.getLocal(['profiles', 'lastSelectedProfileId']);
      const profiles = result.profiles || [];
      const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
      
      // Ensure default profile exists
      if (!profiles.find(p => p.id === 'default')) {
        const defaultProfile = {
          id: 'default',
          name: 'Default',
          llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
          apiKey: 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF',
          modelName: 'mistral-small-latest',
          maxTokens: 16000,
          systemPrompt: 'You are a helpful assistant.',
          lastUpdated: new Date().toLocaleString()
        };
        profiles.push(defaultProfile);
        
        // Save updated profiles
        await this.storageManager.setLocal({ profiles: profiles });
      }
      
      this.viewModel.setProfiles(profiles);
      this.viewModel.setSelectedProfileId(lastSelectedProfileId);
      
      // Set current profile
      const currentProfile = profiles.find(p => p.id === lastSelectedProfileId) || 
                            profiles.find(p => p.id === 'default');
      this.viewModel.setCurrentProfile(currentProfile);
    } catch (error) {
      this.handleError(error, 'loadProfiles');
    }
  }

  /**
   * Load instructions from storage
   */
  async loadInstructions() {
    try {
      const instructions = await this.instructionManager.getInstructions();
      this.viewModel.setInstructions(instructions);
    } catch (error) {
      this.handleError(error, 'loadInstructions');
    }
  }

  /**
   * Load tools from storage
   */
  async loadTools() {
    try {
      const tools = await this.toolManager.getAllTools();
      this.viewModel.setTools(tools);
    } catch (error) {
      this.handleError(error, 'loadTools');
    }
  }

  /**
   * Load pinned actions from storage
   */
  async loadPinnedActions() {
    try {
      const pinnedActions = await this.instructionManager.getPinnedQuickActions();
      this.viewModel.setPinnedQuickActions(pinnedActions);
    } catch (error) {
      this.handleError(error, 'loadPinnedActions');
    }
  }

  /**
   * Load preferences from storage
   */
  async loadPreferences() {
    try {
      // Load sync preferences
      const syncResult = await this.storageManager.getSync({
        darkTheme: false,
        enableStreaming: false
      });
      
      this.viewModel.setDarkTheme(!!syncResult.darkTheme);
      this.viewModel.setEnableStreaming(!!syncResult.enableStreaming);
      
      // Load local preferences
      const localResult = await this.storageManager.getLocal({
        analyticsConsent: true
      });
      
      this.viewModel.setAnalyticsConsent(localResult.analyticsConsent !== false);
    } catch (error) {
      this.handleError(error, 'loadPreferences');
    }
  }

  /**
   * Save profile
   * @param {Object} profile - Profile to save
   */
  async saveProfile(profile) {
    try {
      await this.configManager.saveConfig(profile);
      this.uiManager.showToast('Profile saved successfully!', 'success');
      
      // Reload profiles
      await this.loadProfiles();
    } catch (error) {
      this.handleError(error, 'saveProfile');
      this.uiManager.showToast('Error saving profile: ' + error.message, 'error');
    }
  }

  /**
   * Delete profile
   * @param {String} profileId - ID of profile to delete
   */
  async deleteProfile(profileId) {
    try {
      if (profileId === 'default') {
        this.uiManager.showToast('The "Default" profile cannot be deleted.', 'warning');
        return;
      }
      
      const result = await this.storageManager.getLocal(['profiles']);
      let profiles = result.profiles || [];
      const updatedProfiles = profiles.filter(p => p.id !== profileId);
      
      await this.storageManager.setLocal({ 
        profiles: updatedProfiles, 
        lastSelectedProfileId: 'default' 
      });
      
      this.uiManager.showToast('Profile deleted successfully!', 'success');
      
      // Reload profiles
      await this.loadProfiles();
    } catch (error) {
      this.handleError(error, 'deleteProfile');
      this.uiManager.showToast('Error deleting profile: ' + error.message, 'error');
    }
  }

  /**
   * Save instruction
   * @param {Object} instruction - Instruction to save
   */
  async saveInstruction(instruction) {
    try {
      await this.instructionManager.saveInstruction(instruction);
      this.uiManager.showToast('Instruction saved successfully!', 'success');
      
      // Reload instructions
      await this.loadInstructions();
    } catch (error) {
      this.handleError(error, 'saveInstruction');
      this.uiManager.showToast('Error saving instruction: ' + error.message, 'error');
    }
  }

  /**
   * Delete instruction
   * @param {String} instructionId - ID of instruction to delete
   */
  async deleteInstruction(instructionId) {
    try {
      await this.instructionManager.deleteInstruction(instructionId);
      this.uiManager.showToast('Instruction deleted successfully!', 'success');
      
      // Reload instructions and pinned actions
      await this.loadInstructions();
      await this.loadPinnedActions();
    } catch (error) {
      this.handleError(error, 'deleteInstruction');
      this.uiManager.showToast('Error deleting instruction: ' + error.message, 'error');
    }
  }

  /**
   * Toggle pinned status for an instruction
   * @param {String} instructionId - ID of instruction to toggle
   */
  async togglePinnedInstruction(instructionId) {
    try {
      await this.instructionManager.togglePinnedInstruction(instructionId);
      this.uiManager.showToast('Pinned status updated!', 'success');
      
      // Reload pinned actions
      await this.loadPinnedActions();
    } catch (error) {
      this.handleError(error, 'togglePinnedInstruction');
      this.uiManager.showToast('Error updating pinned status: ' + error.message, 'error');
    }
  }

  /**
   * Save tool
   * @param {Object} tool - Tool to save
   */
  async saveTool(tool) {
    try {
      await this.toolManager.saveTool(tool);
      this.uiManager.showToast('Tool saved successfully!', 'success');
      
      // Reload tools
      await this.loadTools();
    } catch (error) {
      this.handleError(error, 'saveTool');
      this.uiManager.showToast('Error saving tool: ' + error.message, 'error');
    }
  }

  /**
   * Delete tool
   * @param {String} toolId - ID of tool to delete
   */
  async deleteTool(toolId) {
    try {
      await this.toolManager.deleteTool(toolId);
      this.uiManager.showToast('Tool deleted successfully!', 'success');
      
      // Reload tools
      await this.loadTools();
    } catch (error) {
      this.handleError(error, 'deleteTool');
      this.uiManager.showToast('Error deleting tool: ' + error.message, 'error');
    }
  }

  /**
   * Import instructions from file
   * @param {Object} importData - Data to import
   */
  async importInstructions(importData) {
    try {
      await this.instructionManager.importInstructions(importData);
      this.uiManager.showToast('Instructions imported successfully!', 'success');
      
      // Reload instructions
      await this.loadInstructions();
    } catch (error) {
      this.handleError(error, 'importInstructions');
      this.uiManager.showToast('Error importing instructions: ' + error.message, 'error');
    }
  }

  /**
   * Export instructions to file
   * @returns {Object} - Export data
   */
  async exportInstructions() {
    try {
      const exportData = await this.instructionManager.exportInstructions();
      this.uiManager.showToast('Instructions exported successfully!', 'success');
      return exportData;
    } catch (error) {
      this.handleError(error, 'exportInstructions');
      this.uiManager.showToast('Error exporting instructions: ' + error.message, 'error');
      throw error;
    }
  }

  /**
   * Import tools from file
   * @param {Object} importData - Data to import
   */
  async importTools(importData) {
    try {
      await this.toolManager.importTools(importData);
      this.uiManager.showToast('Tools imported successfully!', 'success');
      await this.loadTools();
    } catch (error) {
      this.handleError(error, 'importTools');
      this.uiManager.showToast('Error importing tools: ' + error.message, 'error');
    }
  }

  /**
   * Export tools to file
   * @returns {Object} - Export data
   */
  async exportTools() {
    try {
      const exportData = await this.toolManager.exportTools();
      this.uiManager.showToast('Tools exported successfully!', 'success');
      return exportData;
    } catch (error) {
      this.handleError(error, 'exportTools');
      this.uiManager.showToast('Error exporting tools: ' + error.message, 'error');
      throw error;
    }
  }

  /**
   * Set dark theme preference
   * @param {Boolean} isDark - Whether dark theme is enabled
   */
  async setDarkTheme(isDark) {
    try {
      await this.storageManager.setSync({ darkTheme: isDark });
      this.viewModel.setDarkTheme(isDark);
      this.uiManager.applyDarkTheme(isDark);
    } catch (error) {
      this.handleError(error, 'setDarkTheme');
      this.uiManager.showToast('Error setting dark theme: ' + error.message, 'error');
    }
  }

  /**
   * Set streaming preference
   * @param {Boolean} enable - Whether streaming is enabled
   */
  async setEnableStreaming(enable) {
    try {
      await this.storageManager.setSync({ enableStreaming: enable });
      this.viewModel.setEnableStreaming(enable);
    } catch (error) {
      this.handleError(error, 'setEnableStreaming');
      this.uiManager.showToast('Error setting streaming preference: ' + error.message, 'error');
    }
  }

  /**
   * Set analytics consent
   * @param {Boolean} consent - Whether analytics consent is given
   */
  async setAnalyticsConsent(consent) {
    try {
      await this.storageManager.setLocal({ analyticsConsent: consent });
      this.viewModel.setAnalyticsConsent(consent);
    } catch (error) {
      this.handleError(error, 'setAnalyticsConsent');
      this.uiManager.showToast('Error setting analytics consent: ' + error.message, 'error');
    }
  }
}