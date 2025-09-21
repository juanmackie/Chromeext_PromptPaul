import { BaseViewModel } from '../viewmodels/BaseViewModel.js';

/**
 * Options ViewModel handling options UI logic
 * Implements the ViewModel pattern for UI logic separation
 */
export class OptionsViewModel extends BaseViewModel {
  constructor() {
    super();
    
    // Options state
    this.state = {
      profiles: [],
      selectedProfileId: 'default',
      currentProfile: null,
      instructions: [],
      tools: [],
      pinnedQuickActions: [],
      darkTheme: false,
      enableStreaming: false,
      analyticsConsent: true
    };
  }

  /**
   * Update the view model state
   * @param {Object} newState - New state to apply
   */
  updateState(newState) {
    this.state = { ...this.state, ...newState };
    this.notify(this.state);
  }

  /**
   * Get current view model state
   * @returns {Object} - Current state
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Set profiles
   * @param {Array} profiles - Array of profiles
   */
  setProfiles(profiles) {
    this.state.profiles = profiles;
    this.updateState({ profiles: this.state.profiles });
  }

  /**
   * Set selected profile ID
   * @param {String} profileId - ID of selected profile
   */
  setSelectedProfileId(profileId) {
    this.state.selectedProfileId = profileId;
    this.updateState({ selectedProfileId: this.state.selectedProfileId });
  }

  /**
   * Set current profile
   * @param {Object} profile - Current profile
   */
  setCurrentProfile(profile) {
    this.state.currentProfile = profile;
    this.updateState({ currentProfile: this.state.currentProfile });
  }

  /**
   * Set instructions
   * @param {Array} instructions - Array of instructions
   */
  setInstructions(instructions) {
    this.state.instructions = instructions;
    this.updateState({ instructions: this.state.instructions });
  }

  /**
   * Set tools
   * @param {Array} tools - Array of tools
   */
  setTools(tools) {
    this.state.tools = tools;
    this.updateState({ tools: this.state.tools });
  }

  /**
   * Set pinned quick actions
   * @param {Array} pinnedActions - Array of pinned action IDs
   */
  setPinnedQuickActions(pinnedActions) {
    this.state.pinnedQuickActions = pinnedActions;
    this.updateState({ pinnedQuickActions: this.state.pinnedQuickActions });
  }

  /**
   * Set dark theme preference
   * @param {Boolean} isDark - Whether dark theme is enabled
   */
  setDarkTheme(isDark) {
    this.state.darkTheme = isDark;
    this.updateState({ darkTheme: this.state.darkTheme });
  }

  /**
   * Set streaming preference
   * @param {Boolean} enable - Whether streaming is enabled
   */
  setEnableStreaming(enable) {
    this.state.enableStreaming = enable;
    this.updateState({ enableStreaming: this.state.enableStreaming });
  }

  /**
   * Set analytics consent
   * @param {Boolean} consent - Whether analytics consent is given
   */
  setAnalyticsConsent(consent) {
    this.state.analyticsConsent = consent;
    this.updateState({ analyticsConsent: this.state.analyticsConsent });
  }

  /**
   * Add a new profile
   * @param {Object} profile - Profile to add
   */
  addProfile(profile) {
    this.state.profiles = [...this.state.profiles, profile];
    this.updateState({ profiles: this.state.profiles });
  }

  /**
   * Update an existing profile
   * @param {Object} profile - Profile to update
   */
  updateProfile(profile) {
    this.state.profiles = this.state.profiles.map(p => 
      p.id === profile.id ? { ...p, ...profile } : p
    );
    this.updateState({ profiles: this.state.profiles });
  }

  /**
   * Delete a profile
   * @param {String} profileId - ID of profile to delete
   */
  deleteProfile(profileId) {
    this.state.profiles = this.state.profiles.filter(p => p.id !== profileId);
    this.updateState({ profiles: this.state.profiles });
  }

  /**
   * Add a new instruction
   * @param {Object} instruction - Instruction to add
   */
  addInstruction(instruction) {
    this.state.instructions = [...this.state.instructions, instruction];
    this.updateState({ instructions: this.state.instructions });
  }

  /**
   * Update an existing instruction
   * @param {Object} instruction - Instruction to update
   */
  updateInstruction(instruction) {
    this.state.instructions = this.state.instructions.map(i => 
      i.id === instruction.id ? { ...i, ...instruction } : i
    );
    this.updateState({ instructions: this.state.instructions });
  }

  /**
   * Delete an instruction
   * @param {String} instructionId - ID of instruction to delete
   */
  deleteInstruction(instructionId) {
    this.state.instructions = this.state.instructions.filter(i => i.id !== instructionId);
    // Also remove from pinned actions if it was pinned
    this.state.pinnedQuickActions = this.state.pinnedQuickActions.filter(id => id !== instructionId);
    this.updateState({ 
      instructions: this.state.instructions,
      pinnedQuickActions: this.state.pinnedQuickActions
    });
  }

  /**
   * Add a new tool
   * @param {Object} tool - Tool to add
   */
  addTool(tool) {
    this.state.tools = [...this.state.tools, tool];
    this.updateState({ tools: this.state.tools });
  }

  /**
   * Update an existing tool
   * @param {Object} tool - Tool to update
   */
  updateTool(tool) {
    this.state.tools = this.state.tools.map(t => 
      t.id === tool.id ? { ...t, ...tool } : t
    );
    this.updateState({ tools: this.state.tools });
  }

  /**
   * Delete a tool
   * @param {String} toolId - ID of tool to delete
   */
  deleteTool(toolId) {
    this.state.tools = this.state.tools.filter(t => t.id !== toolId);
    this.updateState({ tools: this.state.tools });
  }

  /**
   * Toggle pinned status for an instruction
   * @param {String} instructionId - ID of instruction to toggle
   */
  togglePinnedInstruction(instructionId) {
    const isPinned = this.state.pinnedQuickActions.includes(instructionId);
    
    if (isPinned) {
      // Unpin the instruction
      this.state.pinnedQuickActions = this.state.pinnedQuickActions.filter(id => id !== instructionId);
    } else {
      // Pin the instruction
      this.state.pinnedQuickActions = [...this.state.pinnedQuickActions, instructionId];
    }
    
    this.updateState({ pinnedQuickActions: this.state.pinnedQuickActions });
  }
}