import { loadingManager } from './loadingManager.js';
import {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
  wrapAsync,
} from './errorHandler.js';
import { ProfileManager } from './options/profile-manager.js';
import { InstructionManager } from './options/instruction-manager.js';
import { ValidationHandler } from './options/validation-handler.js';
import { UIComponents } from './options/ui-components.js';
import { setupThemeToggle } from './themeUtils.js';
import { storageService } from './services/storage-service.js';
import logger from './utils/logger.js';

/**
 * Options Orchestrator
 * Coordinates all options page modules and handles initialization
 * Manages the overall options page functionality and module interactions
 */
class OptionsOrchestrator {
  constructor() {
    // Module instances
    this.profileManager = null;
    this.instructionManager = null;
    this.validationHandler = null;
    this.uiComponents = null;

    // State
    this.isInitialized = false;
    this.currentToolFieldUpdater = null;
  }

  /**
   * Initialize the options orchestrator
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.info('Options', 'Options: Initializing orchestrator...');

      // Initialize modules
      this.profileManager = new ProfileManager(this.showStatus.bind(this));
      this.instructionManager = new InstructionManager(this.showStatus.bind(this));
      this.validationHandler = new ValidationHandler(this.showStatus.bind(this));
      this.uiComponents = new UIComponents(this.showStatus.bind(this), loadingManager);

      // Setup event listeners
      this.setupEventListeners();

      // Setup UI components
      await this.setupUIComponents();

      // Load initial data
      await this.loadInitialData();

      // Check for instruction migration
      await this.checkInstructionMigration();

      // Check for microphone permission request from sidebar
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('requestMic') === 'true') {
        this.requestMicrophonePermission();
      }

      this.isInitialized = true;
      logger.info('Options', 'Options: Orchestrator initialization complete');
    } catch (error) {
      logger.error('Options', 'Options: Failed to initialize orchestrator:', error);
      await errorHandler.handleError(
        createError('Options initialization failed', {
          category: ErrorCategory.SYSTEM,
          severity: ErrorSeverity.CRITICAL,
          originalError: error,
        })
      );
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Form submission
    const optionsForm = document.getElementById('optionsForm');
    if (optionsForm) {
      optionsForm.addEventListener('submit', e => this.handleSaveOptions(e));
    }

    // Profile management
    this.setupProfileEventListeners();

    // Instruction management
    this.setupInstructionEventListeners();

    // Tool management
    this.setupToolEventListeners();

    // Import/Export
    this.setupImportExportEventListeners();

    // Theme and settings
    this.setupSettingsEventListeners();

    // Help tooltip click handlers
    this.setupHelpTooltipListeners();
  }

  /**
   * Setup profile event listeners
   */
  setupProfileEventListeners() {
    const profileSelect = this.uiComponents.getElement('profileSelect');
    const deleteProfileButton = this.uiComponents.getElement('deleteProfileButton');
    const revertButton = this.uiComponents.getElement('revertDefaultsButton');

    if (profileSelect) {
      profileSelect.addEventListener('change', event => this.handleProfileChange(event));
    }

    if (deleteProfileButton) {
      deleteProfileButton.addEventListener('click', () => this.handleDeleteProfile());
    }

    if (revertButton) {
      revertButton.addEventListener('click', () => this.handleRevertToDefaults());
    }
  }

  /**
   * Setup instruction event listeners
   */
  setupInstructionEventListeners() {
    const saveInstructionBtn = this.uiComponents.getElement('saveInstruction');
    const clearFormBtn = this.uiComponents.getElement('clearForm');
    const generateInstructionBtn = this.uiComponents.getElement('generateInstruction');
    const exportInstructions = this.uiComponents.getElement('exportInstructions');
    const importInstructions = this.uiComponents.getElement('importInstructions');
    const importFile = this.uiComponents.getElement('importFile');

    if (saveInstructionBtn) {
      saveInstructionBtn.addEventListener('click', () => this.handleSaveInstruction());
    }

    if (generateInstructionBtn) {
      generateInstructionBtn.addEventListener('click', () => this.handleGenerateInstruction());
    }

    if (clearFormBtn) {
      clearFormBtn.addEventListener('click', () => this.handleClearInstructionForm());
    }

    if (exportInstructions) {
      exportInstructions.addEventListener('click', () => this.handleExportInstructions());
    }

    if (importInstructions) {
      importInstructions.addEventListener('click', () => this.handleImportInstructions());
    }

    if (importFile) {
      importFile.addEventListener('change', event => this.handleInstructionImportFile(event));
    }

    // Setup dynamic event listeners for instruction table
    this.setupInstructionTableListeners();
  }

  /**
   * Setup tool event listeners
   */
  setupToolEventListeners() {
    const saveToolBtn = this.uiComponents.getElement('saveTool');
    const clearToolFormBtn = this.uiComponents.getElement('clearToolForm');
    const exportTools = this.uiComponents.getElement('exportTools');
    const importTools = this.uiComponents.getElement('importTools');
    const importToolsFile = this.uiComponents.getElement('importToolsFile');
    const toolEndpointUrl = this.uiComponents.getElement('toolEndpointUrl');

    if (saveToolBtn) {
      saveToolBtn.addEventListener('click', () => this.handleSaveTool());
    }

    if (clearToolFormBtn) {
      clearToolFormBtn.addEventListener('click', () => this.handleClearToolForm());
    }

    if (exportTools) {
      exportTools.addEventListener('click', () => this.handleExportTools());
    }

    if (importTools) {
      importTools.addEventListener('click', () => this.handleImportTools());
    }

    if (importToolsFile) {
      importToolsFile.addEventListener('change', event => this.handleToolImportFile(event));
    }

    if (toolEndpointUrl) {
      toolEndpointUrl.addEventListener('input', () => this.updateToolFieldStates());
    }

    // Setup dynamic event listeners for tool table
    this.setupToolTableListeners();
  }

  /**
   * Setup import/export event listeners
   */
  setupImportExportEventListeners() {
    // Card footer action buttons
    const privacyToggleBtn = document.getElementById('privacyToggleBtn');
    if (privacyToggleBtn) {
      privacyToggleBtn.addEventListener('click', () => {
        const analyticsToggle = this.uiComponents.getElement('analyticsConsentToggle');
        if (analyticsToggle) {
          analyticsToggle.click();
        }
      });
    }

    const instructionsAddBtn = document.getElementById('instructionsAddBtn');
    if (instructionsAddBtn) {
      instructionsAddBtn.addEventListener('click', () => {
        const saveInstructionBtn = this.uiComponents.getElement('saveInstruction');
        if (saveInstructionBtn) {
          saveInstructionBtn.click();
        }
      });
    }

    const toolsAddBtn = document.getElementById('toolsAddBtn');
    if (toolsAddBtn) {
      toolsAddBtn.addEventListener('click', () => {
        const saveToolBtn = this.uiComponents.getElement('saveTool');
        if (saveToolBtn) {
          saveToolBtn.click();
        }
      });
    }

    const aboutRefreshBtn = document.getElementById('aboutRefreshBtn');
    if (aboutRefreshBtn) {
      aboutRefreshBtn.addEventListener('click', () => {
        location.reload();
      });
    }
  }

  /**
   * Setup settings event listeners
   */
  setupSettingsEventListeners() {
    // Migration buttons
    const migrateInstructionsBtn = document.getElementById('migrateInstructionsBtn');
    const dismissMigrationBtn = document.getElementById('dismissMigrationBtn');

    if (migrateInstructionsBtn) {
      migrateInstructionsBtn.addEventListener('click', () => this.handleMigrationConfirm());
    }

    if (dismissMigrationBtn) {
      dismissMigrationBtn.addEventListener('click', () => this.uiComponents.hideMigrationPrompt());
    }

    // Log level selector
    const logLevelSelect = document.getElementById('logLevelSelect');
    if (logLevelSelect) {
      logLevelSelect.addEventListener('change', event => {
        const newLevel = event.target.value;
        chrome.storage.local.set({ logLevel: newLevel }, () => {
          logger.setLevel(newLevel);
          logger.info('Options', `Log level changed to: ${newLevel}`);
        });
      });
    }
  }

  /**
   * Setup help tooltip click listeners
   */
  setupHelpTooltipListeners() {
    // Add click event listeners to all help tooltip buttons
    const helpTooltips = document.querySelectorAll('.help-tooltip');
    helpTooltips.forEach(tooltip => {
      tooltip.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        const link = tooltip.dataset.link;
        if (link) {
          // Open FAQ link in new tab
          window.open(link, '_blank');
        }
      });
    });
  }

  /**
   * Setup UI components
   */
  async setupUIComponents() {
    // Setup token controls
    this.uiComponents.setupTokenControls();

    // Setup theme toggle
    this.uiComponents.setupThemeToggle(setupThemeToggle);

    // Setup analytics toggle
    await this.uiComponents.setupAnalyticsToggle();

    // Setup streaming toggle
    await this.uiComponents.setupStreamingToggle();


  }

  /**
   * Load initial data
   */
  async loadInitialData() {
    await this.loadProfilesAndSettings();
    await this.loadInstructions();
    await this.loadTools();
    await this.loadLogLevel();
  }

  /**
   * Load profiles and settings
   */
  async loadProfilesAndSettings() {
    try {
      const [profiles, lastSelectedProfileId] = await Promise.all([
        this.profileManager.loadProfiles(),
        this.profileManager.getLastSelectedProfileId(),
      ]);

      // Populate profile dropdown
      await this.uiComponents.populateProfileDropdown(profiles, lastSelectedProfileId);

      // Load selected profile settings
      await this.loadProfileSettings(lastSelectedProfileId);
    } catch (error) {
      logger.error('Options', 'Options: Failed to load profiles and settings:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Load profile settings
   * @param {string} profileId - Profile ID to load
   */
  async loadProfileSettings(profileId) {
    try {
      const profile = await this.profileManager.getProfile(profileId);

      if (profile) {
        // Populate form fields
        await this.uiComponents.populateFormFields(profile, {
          llmEndpoint: 'llmEndpoint',
          apiKey: 'apiKey',
          modelName: 'modelName',
          maxTokens: 'maxTokens',
          systemPrompt: 'systemPrompt',
        });

        // Sync to chrome.storage.sync for API client
        await storageService.setSync({
          apiKey: profile.apiKey,
          apiEndpoint: profile.llmEndpoint,
          modelName: profile.modelName,
          maxTokens: profile.maxTokens,
          systemPrompt: profile.systemPrompt,
        });

        // Update display
        await this.uiComponents.updateCurrentConfigDisplay({
          llmEndpoint: profile.llmEndpoint,
          apiKey: profile.apiKey,
          modelName: profile.modelName,
          timestamp: profile.lastUpdated,
          systemPrompt: profile.systemPrompt,
          profile: profile.name,
          maxTokens: profile.maxTokens,
        });
      }
    } catch (error) {
      logger.error('Options', 'Options: Failed to load profile settings:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Handle profile change
   * @param {Event} event - Change event
   */
  async handleProfileChange(event) {
    const selectedProfileId = event.target.value;

    if (selectedProfileId === 'add_new_profile') {
      await this.handleCreateNewProfile();
    } else {
      await this.profileManager.setLastSelectedProfileId(selectedProfileId);
      await this.loadProfileSettings(selectedProfileId);
    }
  }

  /**
   * Handle create new profile
   */
  async handleCreateNewProfile() {
    const newProfileName = prompt('Enter a name for the new profile (e.g., "My OpenAI GPT-4"):');

    if (!newProfileName || newProfileName.trim() === '') {
      // User cancelled or entered empty name, revert to last selected
      const lastSelectedProfileId = await this.profileManager.getLastSelectedProfileId();
      const profileSelect = this.uiComponents.getElement('profileSelect');
      if (profileSelect) {
        profileSelect.value = lastSelectedProfileId || 'default';
      }
      return;
    }

    try {
      // Get current profile data as template
      const lastSelectedProfileId = await this.profileManager.getLastSelectedProfileId();
      const templateProfile = await this.profileManager.getProfile(lastSelectedProfileId);

      // Create new profile
      const newProfile = await this.profileManager.createProfile(newProfileName, templateProfile);

      // Reload profiles and select new profile
      await this.loadProfilesAndSettings();

      const profileSelect = this.uiComponents.getElement('profileSelect');
      if (profileSelect) {
        profileSelect.value = newProfile.id;
        await this.loadProfileSettings(newProfile.id);
      }

      this.showStatus(
        `Profile "${newProfile.name}" created. Review and save settings.`,
        false,
        true
      );
    } catch (error) {
      logger.error('Options', 'Options: Failed to create profile:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Handle delete profile
   */
  async handleDeleteProfile() {
    const profileSelect = this.uiComponents.getElement('profileSelect');
    if (!profileSelect) {
      this.showStatus('Profile select dropdown not found.', true);
      return;
    }

    const selectedProfileId = profileSelect.value;

    if (selectedProfileId === 'default') {
      this.showStatus('The "Default" profile cannot be deleted.', true);
      return;
    }

    if (selectedProfileId === 'add_new_profile') {
      this.showStatus('Please select a profile to delete.', true);
      return;
    }

    const profile = await this.profileManager.getProfile(selectedProfileId);
    const profileName = profile ? profile.name : 'the selected profile';

    if (
      window.confirm(
        `Are you sure you want to delete the profile "${profileName}"? This action cannot be undone.`
      )
    ) {
      try {
        await this.profileManager.deleteProfile(selectedProfileId);
        await this.loadProfilesAndSettings(); // Reload and switch to default
        this.showStatus(`Profile "${profileName}" deleted successfully.`, false, true);
      } catch (error) {
        logger.error('Options', 'Options: Failed to delete profile:', error);
        await errorHandler.handleError(error);
      }
    }
  }

  /**
   * Handle save options
   * @param {Event} event - Submit event
   */
  async handleSaveOptions(event) {
    event.preventDefault();

    const saveButton = this.uiComponents.getElement('saveButton');
    if (saveButton) {
      saveButton.disabled = true;
    }

    try {
      // Get form data
      const formData = this.getFormData();

      // Validate form data
      const validation = this.validationHandler.validateApiConfig(formData);

      if (!validation.isValid) {
        this.showStatus(validation.errors[0], true);
        return;
      }

      const { selectedProfileId } = formData;
      const profileData = { ...validation.sanitized, id: selectedProfileId };

      // Save profile
      await this.profileManager.saveProfile(profileData);

      // Reload current configuration display
      await this.uiComponents.updateCurrentConfigDisplay({
        ...profileData,
        timestamp: new Date().toLocaleString(),
        profile: (await this.profileManager.getProfile(selectedProfileId))?.name || 'Unknown',
      });
    } catch (error) {
      logger.error('Options', 'Options: Failed to save options:', error);
      await errorHandler.handleError(error);
      this.showStatus(error.userMessage || 'Failed to save options', true);
    } finally {
      if (saveButton) {
        saveButton.disabled = false;
      }
    }
  }

  /**
   * Get form data from DOM
   * @returns {Object} Form data
   */
  getFormData() {
    const profileSelect = this.uiComponents.getElement('profileSelect');

    return {
      selectedProfileId: profileSelect ? profileSelect.value : 'default',
      llmEndpoint: this.uiComponents.getElement('llmEndpoint')?.value?.trim() || '',
      apiKey: this.uiComponents.getElement('apiKey')?.value?.trim() || '',
      modelName: this.uiComponents.getElement('modelName')?.value?.trim() || '',
      maxTokens: this.uiComponents.getElement('maxTokens')?.value?.trim() || '',
      systemPrompt: this.uiComponents.getElement('systemPrompt')?.value?.trim() || '',
    };
  }

  /**
   * Handle revert to defaults
   */
  async handleRevertToDefaults() {
    // Set default values in the input fields
    const defaultValues = {
      llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
      apiKey: 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF',
      modelName: 'mistral-small-latest',
      maxTokens: '16000',
    };

    await this.uiComponents.populateFormFields(defaultValues, {
      llmEndpoint: 'llmEndpoint',
      apiKey: 'apiKey',
      modelName: 'modelName',
      maxTokens: 'maxTokens',
    });

    // Update token value display
    const tokenValue = this.uiComponents.getElement('tokenValue');
    if (tokenValue) {
      tokenValue.textContent = '16000';
    }

    this.showStatus('Settings reverted to defaults. Click "Save Settings" to apply.', false, true);
  }

  /**
   * Load instructions
   */
  async loadInstructions() {
    try {
      const instructions = await this.instructionManager.loadInstructions();

      // Populate table and mobile cards
      await this.uiComponents.populateInstructionTable(instructions, this.instructionManager);
      await this.uiComponents.generateMobileInstructionCards(instructions, this.instructionManager);

      // Setup dynamic event listeners
      this.setupInstructionTableListeners();
    } catch (error) {
      logger.error('Options', 'Options: Failed to load instructions:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Setup instruction table listeners
   */
  setupInstructionTableListeners() {
    // Pin buttons
    document.querySelectorAll('.pin-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const instructionId = e.currentTarget.dataset.id;
        await this.instructionManager.toggleInstructionPin(instructionId);
        await this.loadInstructions(); // Reload to update UI
      });
    });

    // Edit buttons
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const instructionId = e.target.dataset.id;
        await this.handleEditInstruction(instructionId);
      });
    });

    // Delete buttons
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const instructionId = e.target.dataset.id;
        await this.handleDeleteInstruction(instructionId);
      });
    });

    // Improve buttons
    document.querySelectorAll('.improve-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const instructionId = e.target.dataset.id;
        await this.handleImproveInstruction(instructionId);
      });
    });
  }

  /**
   * Handle save instruction
   */
  async handleSaveInstruction() {
    try {
      logger.info('DEBUG: handleSaveInstruction called');
      const formData = this.getInstructionFormData();
      logger.info('DEBUG: Form data:', formData);

      const validation = this.validationHandler.validateInstructionForm(formData);
      logger.info('DEBUG: Validation result:', validation);

      if (!validation.isValid) {
        this.showStatus(validation.errors[0], true);
        return;
      }

      const instructionId = this.uiComponents.getElement('instructionId')?.value;
      const instructionData = { ...validation.sanitized, id: instructionId };
      logger.info(
        'DEBUG: About to call instructionManager.saveInstruction with data:',
        instructionData
      );

      await this.instructionManager.saveInstruction(instructionData);

      // Clear form and reload
      await this.handleClearInstructionForm();
      await this.loadInstructions();
    } catch (error) {
      logger.error('Options', 'Options: Failed to save instruction:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Handle generate instruction from goal
   */
  async handleGenerateInstruction() {
    try {
      const goalDescription = this.uiComponents.getElement('instructionGoal')?.value?.trim();

      if (!goalDescription || goalDescription === '') {
        this.showStatus('Please enter a goal description to generate an instruction.', true);
        return;
      }

      // Get current API configuration
      const lastSelectedProfileId = await this.profileManager.getLastSelectedProfileId();
      const apiConfig = await this.profileManager.getProfile(lastSelectedProfileId);

      const generatedInstruction = await this.instructionManager.generateInstructionFromGoal(
        goalDescription,
        apiConfig
      );

      // Update form with generated instruction
      await this.uiComponents.populateFormFields(
        {
          instructionName: generatedInstruction.name,
          instructionContent: generatedInstruction.content,
        },
        {
          instructionName: 'instructionName',
          instructionContent: 'instructionContent',
        }
      );
    } catch (error) {
      logger.error('Options', 'Options: Failed to generate instruction:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Get instruction form data
   * @returns {Object} Form data
   */
  getInstructionFormData() {
    return {
      instructionName: this.uiComponents.getElement('instructionName')?.value?.trim() || '',
      instructionContent: this.uiComponents.getElement('instructionContent')?.value?.trim() || '',
      instructionToolChoice:
        this.uiComponents.getElement('instructionToolChoice')?.value?.trim() || '',
    };
  }

  /**
   * Handle clear instruction form
   */
  async handleClearInstructionForm() {
    const fieldIds = [
      'instructionName',
      'instructionContent',
      'instructionGoal',
      'instructionId',
      'instructionToolChoice',
    ];
    await this.uiComponents.clearFormFields(fieldIds);

    this.showStatus('Form cleared.');
  }

  /**
   * Handle edit instruction
   * @param {string} instructionId - Instruction ID to edit
   */
  async handleEditInstruction(instructionId) {
    try {
      const instructions = await this.instructionManager.loadInstructions();
      const instruction = instructions.find(i => i.id === instructionId);

      if (instruction) {
        // Populate form fields
        const formData = {
          instructionName: instruction.name,
          instructionContent: instruction.content,
          instructionId: instruction.id,
          instructionToolChoice: Array.isArray(instruction.tool_choice)
            ? instruction.tool_choice.join(', ')
            : instruction.tool_choice || 'none',
        };

        await this.uiComponents.populateFormFields(formData, {
          instructionName: 'instructionName',
          instructionContent: 'instructionContent',
          instructionId: 'instructionId',
          instructionToolChoice: 'instructionToolChoice',
        });
      }
    } catch (error) {
      logger.error('Options', 'Options: Failed to edit instruction:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Handle delete instruction
   * @param {string} instructionId - Instruction ID to delete
   */
  async handleDeleteInstruction(instructionId) {
    if (!confirm('Are you sure you want to delete this instruction?')) {
      return;
    }

    try {
      await this.instructionManager.deleteInstruction(instructionId);

      // Clear form if deleted instruction was being edited
      const currentInstructionId = this.uiComponents.getElement('instructionId')?.value;
      if (currentInstructionId === instructionId) {
        await this.handleClearInstructionForm();
      }

      await this.loadInstructions();
    } catch (error) {
      logger.error('Options', 'Options: Failed to delete instruction:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Handle improve instruction
   * @param {string} instructionId - Instruction ID to improve
   */
  async handleImproveInstruction(instructionId) {
    try {
      // Get current API configuration
      const lastSelectedProfileId = await this.profileManager.getLastSelectedProfileId();
      const apiConfig = await this.profileManager.getProfile(lastSelectedProfileId);

      const improvedContent = await this.instructionManager.improveInstruction(
        instructionId,
        apiConfig
      );

      // Update form with improved content
      const instruction = (await this.instructionManager.loadInstructions()).find(
        i => i.id === instructionId
      );

      if (instruction) {
        await this.uiComponents.populateFormFields(
          {
            instructionName: instruction.name,
            instructionContent: improvedContent,
            instructionId: instruction.id,
          },
          {
            instructionName: 'instructionName',
            instructionContent: 'instructionContent',
            instructionId: 'instructionId',
          }
        );
      }
    } catch (error) {
      logger.error('Options', 'Options: Failed to improve instruction:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Handle export instructions
   */
  async handleExportInstructions() {
    try {
      const exportData = await this.instructionManager.exportInstructions();
      this.downloadJSON(exportData, 'prompt_paul_instructions.json');
      this.showStatus('Instructions exported successfully!');
    } catch (error) {
      logger.error('Options', 'Options: Failed to export instructions:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Handle import instructions
   */
  async handleImportInstructions() {
    const importFile = this.uiComponents.getElement('importFile');
    if (importFile) {
      importFile.click();
    }
  }

  /**
   * Handle instruction import file
   * @param {Event} event - File input change event
   */
  async handleInstructionImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const validation = await this.validationHandler.validateImportFile(file, 'instructions');
      const result = await this.instructionManager.importInstructions(validation.data);

      this.showStatus(
        `Instructions imported successfully! Added: ${result.added}, Updated: ${result.updated}`
      );
      await this.loadInstructions();
    } catch (error) {
      logger.error('Options', 'Options: Failed to import instructions:', error);
      await errorHandler.handleError(error);
    }

    // Reset file input
    event.target.value = '';
  }

  /**
   * Load tools
   */
  async loadTools() {
    try {
      const tools = await storageService
        .getLocal(['promptPaulTools'])
        .then(result => result.promptPaulTools || []);

      // Populate table and mobile cards
      await this.uiComponents.populateToolTable(tools);
      await this.uiComponents.generateMobileToolCards(tools);

      // Populate tool dropdown
      await this.uiComponents.populateToolDropdown(tools);

      // Setup dynamic event listeners
      this.setupToolTableListeners();
    } catch (error) {
      logger.error('Options', 'Options: Failed to load tools:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Load log level setting
   */
  async loadLogLevel() {
    try {
      const result = await chrome.storage.local.get(['logLevel']);
      const logLevel = result.logLevel || 'ERROR';

      const logLevelSelect = document.getElementById('logLevelSelect');
      if (logLevelSelect) {
        logLevelSelect.value = logLevel;
        logger.setLevel(logLevel);
      }
    } catch (error) {
      logger.error('Options', 'Options: Failed to load log level:', error);
    }
  }

  /**
   * Setup tool table listeners
   */
  setupToolTableListeners() {
    // Edit buttons
    document.querySelectorAll('.edit-tool-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const toolId = e.target.dataset.id;
        await this.handleEditTool(toolId);
      });
    });

    // Delete buttons
    document.querySelectorAll('.delete-tool-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const toolId = e.target.dataset.id;
        await this.handleDeleteTool(toolId);
      });
    });
  }

  /**
   * Update tool field states
   */
  updateToolFieldStates() {
    const toolEndpointUrl = this.uiComponents.getElement('toolEndpointUrl');
    const toolHttpMethod = this.uiComponents.getElement('toolHttpMethod');

    if (toolEndpointUrl) {
      toolEndpointUrl.disabled = false;
    }

    if (toolHttpMethod) {
      toolHttpMethod.disabled = false;
    }

    const toolDescriptionSource = document.getElementById('toolDescriptionSource');
    const toolParametersSource = document.getElementById('toolParametersSource');
    if (toolDescriptionSource) toolDescriptionSource.style.display = 'none';
    if (toolParametersSource) toolParametersSource.style.display = 'none';
  }

  /**
   * Handle save tool
   */
  async handleSaveTool() {
    const saveToolBtn = this.uiComponents.getElement('saveTool');

    try {
      if (saveToolBtn) {
        this.uiComponents.setButtonLoading(saveToolBtn, true);
      }

      const formData = this.getToolFormData();

      const validation = this.validationHandler.validateToolForm(formData);

      if (!validation.isValid) {
        this.showStatus(validation.errors[0], true);
        return;
      }

      const toolId = this.uiComponents.getElement('toolId')?.value;
      const toolData = { ...validation.sanitized, id: toolId };

      await this.saveToolToStorage(toolData);

      // Clear form and reload
      await this.handleClearToolForm();
      await this.loadTools();
    } catch (error) {
      logger.error('Options', 'Options: Failed to save tool:', error);
      await errorHandler.handleError(error);
    } finally {
      if (saveToolBtn) {
        this.uiComponents.setButtonLoading(saveToolBtn, false);
      }
    }
  }

  /**
   * Get tool form data
   * @returns {Object} Form data
   */
  getToolFormData() {
    return {
      toolName: this.uiComponents.getElement('toolName')?.value?.trim() || '',
      toolDescription: this.uiComponents.getElement('toolDescription')?.value?.trim() || '',
      toolParameters: this.uiComponents.getElement('toolParameters')?.value?.trim() || '',
      toolEndpointUrl: this.uiComponents.getElement('toolEndpointUrl')?.value?.trim() || '',
      toolHttpMethod: this.uiComponents.getElement('toolHttpMethod')?.value || 'GET',
    };
  }

  /**
   * Save tool to storage
   * @param {Object} toolData - Tool data to save
   */
  async saveToolToStorage(toolData) {
    const { id, name, description, parameters, endpointUrl, httpMethod } = toolData;

    const result = await storageService.getLocal(['promptPaulTools']);
    let tools = result.promptPaulTools || [];
    const now = new Date().toISOString();

    if (id) {
      // Update existing tool
      tools = tools.map(tool => {
        if (tool.id === id) {
          return {
            ...tool,
            name,
            description,
            parameters,
            endpointUrl,
            httpMethod,
            lastUpdated: now,
          };
        }
        return tool;
      });
      this.showStatus('Tool updated!');
    } else {
      // Add new tool
      const newTool = {
        id: `tool_${  Date.now()}`,
        name,
        description,
        parameters,
        endpointUrl,
        httpMethod,
        createdAt: now,
        lastUpdated: now,
      };
      tools.push(newTool);
      this.showStatus('Tool added!');
    }

    await storageService.setLocal({ promptPaulTools: tools });
  }

  /**
   * Handle clear tool form
   */
  async handleClearToolForm() {
    const fieldIds = [
      'toolName',
      'toolDescription',
      'toolParameters',
      'toolEndpointUrl',
      'toolHttpMethod',
      'toolId',
    ];
    await this.uiComponents.clearFormFields(fieldIds);

    // Ensure fields are reset to be editable and styling removed
    const toolDescription = this.uiComponents.getElement('toolDescription');
    const toolParameters = this.uiComponents.getElement('toolParameters');

    if (toolDescription) {
      toolDescription.readOnly = false;
    }

    if (toolParameters) {
      toolParameters.readOnly = false;
    }

    // Hide source indicators
    const toolDescriptionSource = document.getElementById('toolDescriptionSource');
    const toolParametersSource = document.getElementById('toolParametersSource');
    if (toolDescriptionSource) toolDescriptionSource.style.display = 'none';
    if (toolParametersSource) toolParametersSource.style.display = 'none';

    this.updateToolFieldStates();
    this.showStatus('Tool form cleared.');
  }

  /**
   * Handle edit tool
   * @param {string} toolId - Tool ID to edit
   */
  async handleEditTool(toolId) {
    try {
      const tools = await storageService
        .getLocal(['promptPaulTools'])
        .then(result => result.promptPaulTools || []);
      const tool = tools.find(t => t.id === toolId);

      if (tool) {
        const formData = {
          toolName: tool.name,
          toolDescription: tool.description,
          toolParameters: tool.parameters || '',
          toolEndpointUrl: tool.endpointUrl || '',
          toolHttpMethod: tool.httpMethod || '',
          toolId: tool.id,
        };

        await this.uiComponents.populateFormFields(formData, {
          toolName: 'toolName',
          toolDescription: 'toolDescription',
          toolParameters: 'toolParameters',
          toolEndpointUrl: 'toolEndpointUrl',
          toolHttpMethod: 'toolHttpMethod',
          toolId: 'toolId',
        });

        this.updateToolFieldStates();
      }
    } catch (error) {
      logger.error('Options', 'Options: Failed to edit tool:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Handle delete tool
   * @param {string} toolId - Tool ID to delete
   */
  async handleDeleteTool(toolId) {
    if (!confirm('Are you sure you want to delete this tool?')) {
      return;
    }

    try {
      const result = await storageService.getLocal(['promptPaulTools']);
      let tools = result.promptPaulTools || [];
      tools = tools.filter(t => t.id !== toolId);

      await storageService.setLocal({ promptPaulTools: tools });

      // Clear form if deleted tool was being edited
      const currentToolId = this.uiComponents.getElement('toolId')?.value;
      if (currentToolId === toolId) {
        await this.handleClearToolForm();
      }

      this.showStatus('Tool deleted!');
      await this.loadTools();
    } catch (error) {
      logger.error('Options', 'Options: Failed to delete tool:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Handle export tools
   */
  async handleExportTools() {
    try {
      const result = await storageService.getLocal(['promptPaulTools']);
      const tools = result.promptPaulTools || [];

      const exportData = {
        version: 1,
        tools,
        exportedAt: new Date().toISOString(),
      };

      this.downloadJSON(exportData, 'prompt_paul_tools.json');
      this.showStatus('Tools exported successfully!');
    } catch (error) {
      logger.error('Options', 'Options: Failed to export tools:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Handle import tools
   */
  async handleImportTools() {
    const importToolsFile = this.uiComponents.getElement('importToolsFile');
    if (importToolsFile) {
      importToolsFile.click();
    }
  }

  /**
   * Handle tool import file
   * @param {Event} event - File input change event
   */
  async handleToolImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const validation = await this.validationHandler.validateImportFile(file, 'tools');
      const result = await this.importToolsFromData(validation.data);

      this.showStatus(
        `Tools imported successfully! Added: ${result.added}, Updated: ${result.updated}`
      );
      await this.loadTools();
    } catch (error) {
      logger.error('Options', 'Options: Failed to import tools:', error);
      await errorHandler.handleError(error);
    }

    // Reset file input
    event.target.value = '';
  }

  /**
   * Import tools from data
   * @param {Object} importData - Import data
   * @returns {Object} Import result
   */
  async importToolsFromData(importData) {
    const result = await storageService.getLocal(['promptPaulTools']);
    const existingTools = result.promptPaulTools || [];
    const importedTools = importData.tools;
    let addedCount = 0;
    let updatedCount = 0;

    importedTools.forEach(importedTool => {
      const existingIndex = existingTools.findIndex(tool => tool.id === importedTool.id);
      if (existingIndex > -1) {
        // Update existing tool
        existingTools[existingIndex] = {
          ...existingTools[existingIndex],
          ...importedTool,
          lastUpdated: new Date().toISOString(),
        };
        updatedCount++;
      } else {
        // Add new tool
        existingTools.push({
          ...importedTool,
          id: importedTool.id || `tool_${  Date.now()}`,
          createdAt: importedTool.createdAt || new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        });
        addedCount++;
      }
    });

    await storageService.setLocal({ promptPaulTools: existingTools });

    return {
      added: addedCount,
      updated: updatedCount,
      total: existingTools.length,
    };
  }

  /**
   * Check instruction migration
   */
  async checkInstructionMigration() {
    try {
      const migrationNeeded = await this.validationHandler.checkInstructionMigration();

      if (migrationNeeded) {
        this.uiComponents.showMigrationPrompt();
      }
    } catch (error) {
      logger.error('Options', 'Options: Failed to check migration:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Handle migration confirm
   */
  async handleMigrationConfirm() {
    try {
      await this.validationHandler.performInstructionMigration();
      this.uiComponents.hideMigrationPrompt();
      await this.loadInstructions();
    } catch (error) {
      logger.error('Options', 'Options: Failed to migrate instructions:', error);
      await errorHandler.handleError(error);
    }
  }

  /**
   * Download JSON data as file
   * @param {Object} data - Data to download
   * @param {string} filename - Filename
   */
  downloadJSON(data, filename) {
    const dataStr =
      `data:text/json;charset=utf-8,${  encodeURIComponent(JSON.stringify(data, null, 2))}`;
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute('href', dataStr);
    downloadAnchorNode.setAttribute('download', filename);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }

  /**
   * Show toast notification
   * @param {string} message - Message to show
   * @param {boolean} isError - Whether it's an error
   * @param {boolean} isToast - Whether it's a toast
   */
  showStatus(message, isError = false, isToast = false) {
    return wrapAsync(
      () => {
        const toastType = isError ? 'error' : 'success';
        const timeoutDuration = isToast ? 5000 : 3000;
        loadingManager.showToast(message, toastType, timeoutDuration);
      },
      {
        category: ErrorCategory.SYSTEM,
        userMessage: 'Failed to show status message',
        severity: ErrorSeverity.LOW,
      }
    ).catch(async error => {
      await errorHandler.handleError(
        createError('Failed to show status message', {
          category: ErrorCategory.SYSTEM,
          severity: ErrorSeverity.LOW,
          originalError: error,
          context: { message, isError, isToast },
        })
      );
    });
  }

  /**
   * Request microphone permission by triggering getUserMedia
   */
  async requestMicrophonePermission() {
    try {
      logger.info('Options', 'Requesting microphone permission...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // If we get here, permission was granted
      stream.getTracks().forEach(track => track.stop()); // Stop the stream immediately
      this.showStatus('Microphone permission granted! You can now use dictation in the side panel.', false, true);
    } catch (error) {
      logger.error('Options', 'Failed to get microphone permission:', error);
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        this.showStatus('Microphone permission was denied. Please check your browser settings.', true, true);
      } else {
        this.showStatus(`Error accessing microphone: ${  error.message}`, true, true);
      }
    }
  }
}

// Initialize orchestrator when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const optionsOrchestrator = new OptionsOrchestrator();
  optionsOrchestrator.initialize();
});
