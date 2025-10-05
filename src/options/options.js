/**
 * Options Page Entry Point
 * Coordinates all options page functionality
 * Implements production-ready coding rules for options page coordination
 *
 * Core Principles:
 * - Single Responsibility: Coordinate options page modules, don't implement business logic
 * - Dependency Injection: Use the DI container for module management
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 */

import { container, logger } from '../shared/index.js';
import ProfileManager from './profile-manager.js';
import InstructionManager from './instruction-manager.js';
import ToolManager from './tool-manager.js';
import SettingsManager from './settings-manager.js';

// Register options page modules with the dependency container
container.register('ProfileManager', ProfileManager, ['Storage', 'Logger', 'Validator'], { singleton: true });
container.register('InstructionManager', InstructionManager, ['Storage', 'Logger', 'Validator'], { singleton: true });
container.register('ToolManager', ToolManager, ['Storage', 'Logger', 'Validator'], { singleton: true });
container.register('SettingsManager', SettingsManager, ['Storage', 'Logger', 'Validator'], { singleton: true });

// Global variables for backward compatibility (will be removed in future)
let currentTab = 'profiles';
let isInitialized = false;

/**
 * Initializes the options page
 */
async function initializeOptions() {
  logger.info('Initializing options page...');

  try {
    // Resolve services
    const profileManager = container.resolve('ProfileManager');
    const instructionManager = container.resolve('InstructionManager');
    const toolManager = container.resolve('ToolManager');
    const settingsManager = container.resolve('SettingsManager');

    // Initialize services
    await profileManager.initialize();
    await instructionManager.initialize();
    await toolManager.initialize();
    await settingsManager.initialize();

    // Set up UI
    setupUI(profileManager, instructionManager, toolManager, settingsManager);

    // Set up event listeners
    setupEventListeners(profileManager, instructionManager, toolManager, settingsManager);

    // Set up message listeners
    setupMessageListeners(profileManager, instructionManager, toolManager, settingsManager);

    isInitialized = true;
    logger.info('Options page initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize options page', {}, error);
    showError('Failed to initialize options page');
  }
}

/**
 * Sets up the UI
 */
function setupUI(profileManager, instructionManager, toolManager, settingsManager) {
  logger.debug('Setting up UI');

  try {
    // Set up tabs
    setupTabs();

    // Set up profiles tab
    setupProfilesTab(profileManager);

    // Set up instructions tab
    setupInstructionsTab(instructionManager);

    // Set up tools tab
    setupToolsTab(toolManager);

    // Set up settings tab
    setupSettingsTab(settingsManager);

    logger.debug('UI set up successfully');
  } catch (error) {
    logger.error('Failed to set up UI', {}, error);
    throw error;
  }
}

/**
 * Sets up tabs
 */
function setupTabs() {
  logger.debug('Setting up tabs');

  try {
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        if (!tabName) return;

        // Update active tab
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update active content
        tabContents.forEach(content => {
          content.classList.remove('active');
          if (content.getAttribute('data-tab') === tabName) {
            content.classList.add('active');
          }
        });

        currentTab = tabName;
        logger.debug(`Tab changed to: ${tabName}`);
      });
    });
  } catch (error) {
    logger.error('Failed to set up tabs', {}, error);
    throw error;
  }
}

/**
 * Sets up profiles tab
 */
function setupProfilesTab(profileManager) {
  logger.debug('Setting up profiles tab');

  try {
    const profilesList = document.getElementById('profiles-list');
    const addProfileButton = document.getElementById('add-profile-button');
    const importProfilesButton = document.getElementById('import-profiles-button');
    const exportProfilesButton = document.getElementById('export-profiles-button');

    // Render profiles
    renderProfiles(profileManager, profilesList);

    // Set up add profile button
    if (addProfileButton) {
      addProfileButton.addEventListener('click', () => {
        handleAddProfile(profileManager);
      });
    }

    // Set up import profiles button
    if (importProfilesButton) {
      importProfilesButton.addEventListener('click', () => {
        handleImportProfiles(profileManager);
      });
    }

    // Set up export profiles button
    if (exportProfilesButton) {
      exportProfilesButton.addEventListener('click', () => {
        handleExportProfiles(profileManager);
      });
    }
  } catch (error) {
    logger.error('Failed to set up profiles tab', {}, error);
    throw error;
  }
}

/**
 * Sets up instructions tab
 */
function setupInstructionsTab(instructionManager) {
  logger.debug('Setting up instructions tab');

  try {
    const instructionsList = document.getElementById('instructions-list');
    const addInstructionButton = document.getElementById('add-instruction-button');
    const importInstructionsButton = document.getElementById('import-instructions-button');
    const exportInstructionsButton = document.getElementById('export-instructions-button');

    // Render instructions
    renderInstructions(instructionManager, instructionsList);

    // Set up add instruction button
    if (addInstructionButton) {
      addInstructionButton.addEventListener('click', () => {
        handleAddInstruction(instructionManager);
      });
    }

    // Set up import instructions button
    if (importInstructionsButton) {
      importInstructionsButton.addEventListener('click', () => {
        handleImportInstructions(instructionManager);
      });
    }

    // Set up export instructions button
    if (exportInstructionsButton) {
      exportInstructionsButton.addEventListener('click', () => {
        handleExportInstructions(instructionManager);
      });
    }
  } catch (error) {
    logger.error('Failed to set up instructions tab', {}, error);
    throw error;
  }
}

/**
 * Sets up tools tab
 */
function setupToolsTab(toolManager) {
  logger.debug('Setting up tools tab');

  try {
    const toolsList = document.getElementById('tools-list');
    const addToolButton = document.getElementById('add-tool-button');
    const importToolsButton = document.getElementById('import-tools-button');
    const exportToolsButton = document.getElementById('export-tools-button');

    // Render tools
    renderTools(toolManager, toolsList);

    // Set up add tool button
    if (addToolButton) {
      addToolButton.addEventListener('click', () => {
        handleAddTool(toolManager);
      });
    }

    // Set up import tools button
    if (importToolsButton) {
      importToolsButton.addEventListener('click', () => {
        handleImportTools(toolManager);
      });
    }

    // Set up export tools button
    if (exportToolsButton) {
      exportToolsButton.addEventListener('click', () => {
        handleExportTools(toolManager);
      });
    }
  } catch (error) {
    logger.error('Failed to set up tools tab', {}, error);
    throw error;
  }
}

/**
 * Sets up settings tab
 */
function setupSettingsTab(settingsManager) {
  logger.debug('Setting up settings tab');

  try {
    const settingsForm = document.getElementById('settings-form');
    const resetSettingsButton = document.getElementById('reset-settings-button');
    const importSettingsButton = document.getElementById('import-settings-button');
    const exportSettingsButton = document.getElementById('export-settings-button');

    // Render settings
    renderSettings(settingsManager, settingsForm);

    // Set up settings form
    if (settingsForm) {
      settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSaveSettings(settingsManager, new FormData(settingsForm));
      });
    }

    // Set up reset settings button
    if (resetSettingsButton) {
      resetSettingsButton.addEventListener('click', () => {
        handleResetSettings(settingsManager);
      });
    }

    // Set up import settings button
    if (importSettingsButton) {
      importSettingsButton.addEventListener('click', () => {
        handleImportSettings(settingsManager);
      });
    }

    // Set up export settings button
    if (exportSettingsButton) {
      exportSettingsButton.addEventListener('click', () => {
        handleExportSettings(settingsManager);
      });
    }
  } catch (error) {
    logger.error('Failed to set up settings tab', {}, error);
    throw error;
  }
}

/**
 * Sets up event listeners
 */
function setupEventListeners(profileManager, instructionManager, toolManager, settingsManager) {
  logger.debug('Setting up event listeners');

  try {
    // Set up save button
    const saveButton = document.getElementById('save-button');
    if (saveButton) {
      saveButton.addEventListener('click', () => {
        handleSave(profileManager, instructionManager, toolManager, settingsManager);
      });
    }

    // Set up search functionality
    setupSearch();

    logger.debug('Event listeners set up successfully');
  } catch (error) {
    logger.error('Failed to set up event listeners', {}, error);
    throw error;
  }
}

/**
 * Sets up message listeners
 */
function setupMessageListeners(profileManager, instructionManager, toolManager, settingsManager) {
  logger.debug('Setting up message listeners');

  try {
    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        handleStorageChanges(changes, profileManager, instructionManager, toolManager, settingsManager);
      }
    });

    logger.debug('Message listeners set up successfully');
  } catch (error) {
    logger.error('Failed to set up message listeners', {}, error);
    throw error;
  }
}

/**
 * Renders profiles
 */
function renderProfiles(profileManager, profilesList) {
  if (!profilesList) return;

  logger.debug('Rendering profiles');

  try {
    const profiles = profileManager.getProfiles();
    const currentProfileId = profileManager.getCurrentProfile()?.id;

    profilesList.innerHTML = '';

    profiles.forEach(profile => {
      const profileItem = document.createElement('div');
      profileItem.className = 'profile-item';
      profileItem.setAttribute('data-profile-id', profile.id);

      if (profile.id === currentProfileId) {
        profileItem.classList.add('active');
      }

      profileItem.innerHTML = `
        <div class="profile-name">${profile.name}</div>
        <div class="profile-actions">
          <button class="edit-profile-button" data-profile-id="${profile.id}">Edit</button>
          <button class="delete-profile-button" data-profile-id="${profile.id}">Delete</button>
        </div>
      `;

      // Set up profile item click
      profileItem.addEventListener('click', (e) => {
        if (!e.target.classList.contains('edit-profile-button') && 
            !e.target.classList.contains('delete-profile-button')) {
          handleSelectProfile(profileManager, profile.id);
        }
      });

      // Set up edit button
      const editButton = profileItem.querySelector('.edit-profile-button');
      if (editButton) {
        editButton.addEventListener('click', (e) => {
          e.stopPropagation();
          handleEditProfile(profileManager, profile.id);
        });
      }

      // Set up delete button
      const deleteButton = profileItem.querySelector('.delete-profile-button');
      if (deleteButton) {
        deleteButton.addEventListener('click', (e) => {
          e.stopPropagation();
          handleDeleteProfile(profileManager, profile.id);
        });
      }

      profilesList.appendChild(profileItem);
    });
  } catch (error) {
    logger.error('Failed to render profiles', {}, error);
    throw error;
  }
}

/**
 * Renders instructions
 */
function renderInstructions(instructionManager, instructionsList) {
  if (!instructionsList) return;

  logger.debug('Rendering instructions');

  try {
    const instructions = instructionManager.getInstructions();

    instructionsList.innerHTML = '';

    instructions.forEach(instruction => {
      const instructionItem = document.createElement('div');
      instructionItem.className = 'instruction-item';
      instructionItem.setAttribute('data-instruction-id', instruction.id);

      instructionItem.innerHTML = `
        <div class="instruction-name">${instruction.name}</div>
        <div class="instruction-content">${instruction.content.substring(0, 100)}${instruction.content.length > 100 ? '...' : ''}</div>
        <div class="instruction-actions">
          <button class="edit-instruction-button" data-instruction-id="${instruction.id}">Edit</button>
          <button class="delete-instruction-button" data-instruction-id="${instruction.id}">Delete</button>
        </div>
      `;

      // Set up edit button
      const editButton = instructionItem.querySelector('.edit-instruction-button');
      if (editButton) {
        editButton.addEventListener('click', (e) => {
          e.stopPropagation();
          handleEditInstruction(instructionManager, instruction.id);
        });
      }

      // Set up delete button
      const deleteButton = instructionItem.querySelector('.delete-instruction-button');
      if (deleteButton) {
        deleteButton.addEventListener('click', (e) => {
          e.stopPropagation();
          handleDeleteInstruction(instructionManager, instruction.id);
        });
      }

      instructionsList.appendChild(instructionItem);
    });
  } catch (error) {
    logger.error('Failed to render instructions', {}, error);
    throw error;
  }
}

/**
 * Renders tools
 */
function renderTools(toolManager, toolsList) {
  if (!toolsList) return;

  logger.debug('Rendering tools');

  try {
    const tools = toolManager.getTools();

    toolsList.innerHTML = '';

    tools.forEach(tool => {
      const toolItem = document.createElement('div');
      toolItem.className = 'tool-item';
      toolItem.setAttribute('data-tool-id', tool.id);

      toolItem.innerHTML = `
        <div class="tool-name">${tool.name}</div>
        <div class="tool-description">${tool.description}</div>
        <div class="tool-actions">
          <button class="edit-tool-button" data-tool-id="${tool.id}">Edit</button>
          <button class="test-tool-button" data-tool-id="${tool.id}">Test</button>
          <button class="delete-tool-button" data-tool-id="${tool.id}">Delete</button>
        </div>
      `;

      // Set up edit button
      const editButton = toolItem.querySelector('.edit-tool-button');
      if (editButton) {
        editButton.addEventListener('click', (e) => {
          e.stopPropagation();
          handleEditTool(toolManager, tool.id);
        });
      }

      // Set up test button
      const testButton = toolItem.querySelector('.test-tool-button');
      if (testButton) {
        testButton.addEventListener('click', (e) => {
          e.stopPropagation();
          handleTestTool(toolManager, tool.id);
        });
      }

      // Set up delete button
      const deleteButton = toolItem.querySelector('.delete-tool-button');
      if (deleteButton) {
        deleteButton.addEventListener('click', (e) => {
          e.stopPropagation();
          handleDeleteTool(toolManager, tool.id);
        });
      }

      toolsList.appendChild(toolItem);
    });
  } catch (error) {
    logger.error('Failed to render tools', {}, error);
    throw error;
  }
}

/**
 * Renders settings
 */
function renderSettings(settingsManager, settingsForm) {
  if (!settingsForm) return;

  logger.debug('Rendering settings');

  try {
    const settings = settingsManager.getSettings();

    // Set form values
    if (settings.analyticsConsent !== undefined) {
      const analyticsConsentInput = settingsForm.querySelector('input[name="analyticsConsent"]');
      if (analyticsConsentInput) {
        analyticsConsentInput.checked = settings.analyticsConsent;
      }
    }

    if (settings.debugMode !== undefined) {
      const debugModeInput = settingsForm.querySelector('input[name="debugMode"]');
      if (debugModeInput) {
        debugModeInput.checked = settings.debugMode;
      }
    }

    if (settings.autoSave !== undefined) {
      const autoSaveInput = settingsForm.querySelector('input[name="autoSave"]');
      if (autoSaveInput) {
        autoSaveInput.checked = settings.autoSave;
      }
    }

    if (settings.theme !== undefined) {
      const themeInput = settingsForm.querySelector('select[name="theme"]');
      if (themeInput) {
        themeInput.value = settings.theme;
      }
    }

    if (settings.language !== undefined) {
      const languageInput = settingsForm.querySelector('input[name="language"]');
      if (languageInput) {
        languageInput.value = settings.language;
      }
    }
  } catch (error) {
    logger.error('Failed to render settings', {}, error);
    throw error;
  }
}

/**
 * Handles profile selection
 */
async function handleSelectProfile(profileManager, profileId) {
  logger.debug('Handling profile selection', { profileId });

  try {
    await profileManager.setCurrentProfile(profileId);
    
    // Update UI
    const profileItems = document.querySelectorAll('.profile-item');
    profileItems.forEach(item => {
      item.classList.remove('active');
      if (item.getAttribute('data-profile-id') === profileId) {
        item.classList.add('active');
      }
    });

    showSuccess('Profile selected successfully');
  } catch (error) {
    logger.error('Failed to select profile', { profileId }, error);
    showError('Failed to select profile');
  }
}

/**
 * Handles add profile
 */
function handleAddProfile(profileManager) {
  logger.debug('Handling add profile');

  try {
    // Create profile dialog
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <h2>Add Profile</h2>
      <form id="add-profile-form">
        <div class="form-group">
          <label for="profile-name">Name:</label>
          <input type="text" id="profile-name" name="name" required>
        </div>
        <div class="form-group">
          <label for="profile-endpoint">LLM Endpoint:</label>
          <input type="text" id="profile-endpoint" name="llmEndpoint">
        </div>
        <div class="form-group">
          <label for="profile-api-key">API Key:</label>
          <input type="password" id="profile-api-key" name="apiKey">
        </div>
        <div class="form-group">
          <label for="profile-model">Model Name:</label>
          <input type="text" id="profile-model" name="modelName">
        </div>
        <div class="form-group">
          <label for="profile-max-tokens">Max Tokens:</label>
          <input type="number" id="profile-max-tokens" name="maxTokens" min="1" max="8192" value="2048">
        </div>
        <div class="form-group">
          <label for="profile-system-prompt">System Prompt:</label>
          <textarea id="profile-system-prompt" name="systemPrompt" rows="4"></textarea>
        </div>
        <div class="form-actions">
          <button type="button" id="cancel-add-profile">Cancel</button>
          <button type="submit">Add Profile</button>
        </div>
      </form>
    `;

    document.body.appendChild(dialog);
    dialog.showModal();

    // Set up form submission
    const form = dialog.querySelector('#add-profile-form');
    const cancelButton = dialog.querySelector('#cancel-add-profile');

    const closeDialog = () => {
      document.body.removeChild(dialog);
    };

    cancelButton.addEventListener('click', closeDialog);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const profileData = {
        name: formData.get('name'),
        llmEndpoint: formData.get('llmEndpoint'),
        apiKey: formData.get('apiKey'),
        modelName: formData.get('modelName'),
        maxTokens: parseInt(formData.get('maxTokens')) || 2048,
        systemPrompt: formData.get('systemPrompt')
      };

      try {
        await profileManager.createProfile(profileData);
        renderProfiles(profileManager, document.getElementById('profiles-list'));
        closeDialog();
        showSuccess('Profile added successfully');
      } catch (error) {
        logger.error('Failed to add profile', {}, error);
        showError('Failed to add profile');
      }
    });
  } catch (error) {
    logger.error('Failed to handle add profile', {}, error);
    showError('Failed to add profile');
  }
}

/**
 * Handles edit profile
 */
function handleEditProfile(profileManager, profileId) {
  logger.debug('Handling edit profile', { profileId });

  try {
    const profile = profileManager.getProfile(profileId);
    if (!profile) {
      showError('Profile not found');
      return;
    }

    // Create edit profile dialog
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <h2>Edit Profile</h2>
      <form id="edit-profile-form">
        <div class="form-group">
          <label for="profile-name">Name:</label>
          <input type="text" id="profile-name" name="name" value="${profile.name}" required>
        </div>
        <div class="form-group">
          <label for="profile-endpoint">LLM Endpoint:</label>
          <input type="text" id="profile-endpoint" name="llmEndpoint" value="${profile.llmEndpoint || ''}">
        </div>
        <div class="form-group">
          <label for="profile-api-key">API Key:</label>
          <input type="password" id="profile-api-key" name="apiKey" value="${profile.apiKey || ''}">
        </div>
        <div class="form-group">
          <label for="profile-model">Model Name:</label>
          <input type="text" id="profile-model" name="modelName" value="${profile.modelName || ''}">
        </div>
        <div class="form-group">
          <label for="profile-max-tokens">Max Tokens:</label>
          <input type="number" id="profile-max-tokens" name="maxTokens" min="1" max="8192" value="${profile.maxTokens || 2048}">
        </div>
        <div class="form-group">
          <label for="profile-system-prompt">System Prompt:</label>
          <textarea id="profile-system-prompt" name="systemPrompt" rows="4">${profile.systemPrompt || ''}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" id="cancel-edit-profile">Cancel</button>
          <button type="submit">Save Profile</button>
        </div>
      </form>
    `;

    document.body.appendChild(dialog);
    dialog.showModal();

    // Set up form submission
    const form = dialog.querySelector('#edit-profile-form');
    const cancelButton = dialog.querySelector('#cancel-edit-profile');

    const closeDialog = () => {
      document.body.removeChild(dialog);
    };

    cancelButton.addEventListener('click', closeDialog);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const updates = {
        name: formData.get('name'),
        llmEndpoint: formData.get('llmEndpoint'),
        apiKey: formData.get('apiKey'),
        modelName: formData.get('modelName'),
        maxTokens: parseInt(formData.get('maxTokens')) || 2048,
        systemPrompt: formData.get('systemPrompt')
      };

      try {
        await profileManager.updateProfile(profileId, updates);
        renderProfiles(profileManager, document.getElementById('profiles-list'));
        closeDialog();
        showSuccess('Profile updated successfully');
      } catch (error) {
        logger.error('Failed to update profile', { profileId }, error);
        showError('Failed to update profile');
      }
    });
  } catch (error) {
    logger.error('Failed to handle edit profile', { profileId }, error);
    showError('Failed to edit profile');
  }
}

/**
 * Handles delete profile
 */
function handleDeleteProfile(profileManager, profileId) {
  logger.debug('Handling delete profile', { profileId });

  try {
    // Confirm deletion
    if (!confirm('Are you sure you want to delete this profile?')) {
      return;
    }

    profileManager.deleteProfile(profileId).then(success => {
      if (success) {
        renderProfiles(profileManager, document.getElementById('profiles-list'));
        showSuccess('Profile deleted successfully');
      } else {
        showError('Failed to delete profile');
      }
    }).catch(error => {
      logger.error('Failed to delete profile', { profileId }, error);
      showError('Failed to delete profile');
    });
  } catch (error) {
    logger.error('Failed to handle delete profile', { profileId }, error);
    showError('Failed to delete profile');
  }
}

/**
 * Handles import profiles
 */
function handleImportProfiles(profileManager) {
  logger.debug('Handling import profiles');

  try {
    // Create file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const result = await profileManager.importProfiles(text);
        renderProfiles(profileManager, document.getElementById('profiles-list'));
        showSuccess(`${result.imported} profiles imported successfully`);
      } catch (error) {
        logger.error('Failed to import profiles', {}, error);
        showError('Failed to import profiles');
      }
    });

    fileInput.click();
  } catch (error) {
    logger.error('Failed to handle import profiles', {}, error);
    showError('Failed to import profiles');
  }
}

/**
 * Handles export profiles
 */
function handleExportProfiles(profileManager) {
  logger.debug('Handling export profiles');

  try {
    const data = profileManager.exportProfiles();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'profiles.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showSuccess('Profiles exported successfully');
  } catch (error) {
    logger.error('Failed to export profiles', {}, error);
    showError('Failed to export profiles');
  }
}

/**
 * Handles add instruction
 */
function handleAddInstruction(instructionManager) {
  logger.debug('Handling add instruction');

  try {
    // Create instruction dialog
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <h2>Add Instruction</h2>
      <form id="add-instruction-form">
        <div class="form-group">
          <label for="instruction-name">Name:</label>
          <input type="text" id="instruction-name" name="name" required>
        </div>
        <div class="form-group">
          <label for="instruction-content">Content:</label>
          <textarea id="instruction-content" name="content" rows="6" required></textarea>
        </div>
        <div class="form-group">
          <label for="instruction-tool-choice">Tool Choice:</label>
          <select id="instruction-tool-choice" name="toolChoice">
            <option value="none">None</option>
            <option value="auto">Auto</option>
          </select>
        </div>
        <div class="form-actions">
          <button type="button" id="cancel-add-instruction">Cancel</button>
          <button type="submit">Add Instruction</button>
        </div>
      </form>
    `;

    document.body.appendChild(dialog);
    dialog.showModal();

    // Set up form submission
    const form = dialog.querySelector('#add-instruction-form');
    const cancelButton = dialog.querySelector('#cancel-add-instruction');

    const closeDialog = () => {
      document.body.removeChild(dialog);
    };

    cancelButton.addEventListener('click', closeDialog);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const instructionData = {
        name: formData.get('name'),
        content: formData.get('content'),
        toolChoice: formData.get('toolChoice')
      };

      try {
        await instructionManager.createInstruction(instructionData);
        renderInstructions(instructionManager, document.getElementById('instructions-list'));
        closeDialog();
        showSuccess('Instruction added successfully');
      } catch (error) {
        logger.error('Failed to add instruction', {}, error);
        showError('Failed to add instruction');
      }
    });
  } catch (error) {
    logger.error('Failed to handle add instruction', {}, error);
    showError('Failed to add instruction');
  }
}

/**
 * Handles edit instruction
 */
function handleEditInstruction(instructionManager, instructionId) {
  logger.debug('Handling edit instruction', { instructionId });

  try {
    const instruction = instructionManager.getInstruction(instructionId);
    if (!instruction) {
      showError('Instruction not found');
      return;
    }

    // Create edit instruction dialog
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <h2>Edit Instruction</h2>
      <form id="edit-instruction-form">
        <div class="form-group">
          <label for="instruction-name">Name:</label>
          <input type="text" id="instruction-name" name="name" value="${instruction.name}" required>
        </div>
        <div class="form-group">
          <label for="instruction-content">Content:</label>
          <textarea id="instruction-content" name="content" rows="6" required>${instruction.content}</textarea>
        </div>
        <div class="form-group">
          <label for="instruction-tool-choice">Tool Choice:</label>
          <select id="instruction-tool-choice" name="toolChoice">
            <option value="none" ${instruction.toolChoice === 'none' ? 'selected' : ''}>None</option>
            <option value="auto" ${instruction.toolChoice === 'auto' ? 'selected' : ''}>Auto</option>
          </select>
        </div>
        <div class="form-actions">
          <button type="button" id="cancel-edit-instruction">Cancel</button>
          <button type="submit">Save Instruction</button>
        </div>
      </form>
    `;

    document.body.appendChild(dialog);
    dialog.showModal();

    // Set up form submission
    const form = dialog.querySelector('#edit-instruction-form');
    const cancelButton = dialog.querySelector('#cancel-edit-instruction');

    const closeDialog = () => {
      document.body.removeChild(dialog);
    };

    cancelButton.addEventListener('click', closeDialog);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const updates = {
        name: formData.get('name'),
        content: formData.get('content'),
        toolChoice: formData.get('toolChoice')
      };

      try {
        await instructionManager.updateInstruction(instructionId, updates);
        renderInstructions(instructionManager, document.getElementById('instructions-list'));
        closeDialog();
        showSuccess('Instruction updated successfully');
      } catch (error) {
        logger.error('Failed to update instruction', { instructionId }, error);
        showError('Failed to update instruction');
      }
    });
  } catch (error) {
    logger.error('Failed to handle edit instruction', { instructionId }, error);
    showError('Failed to edit instruction');
  }
}

/**
 * Handles delete instruction
 */
function handleDeleteInstruction(instructionManager, instructionId) {
  logger.debug('Handling delete instruction', { instructionId });

  try {
    // Confirm deletion
    if (!confirm('Are you sure you want to delete this instruction?')) {
      return;
    }

    instructionManager.deleteInstruction(instructionId).then(success => {
      if (success) {
        renderInstructions(instructionManager, document.getElementById('instructions-list'));
        showSuccess('Instruction deleted successfully');
      } else {
        showError('Failed to delete instruction');
      }
    }).catch(error => {
      logger.error('Failed to delete instruction', { instructionId }, error);
      showError('Failed to delete instruction');
    });
  } catch (error) {
    logger.error('Failed to handle delete instruction', { instructionId }, error);
    showError('Failed to delete instruction');
  }
}

/**
 * Handles import instructions
 */
function handleImportInstructions(instructionManager) {
  logger.debug('Handling import instructions');

  try {
    // Create file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const result = await instructionManager.importInstructions(text);
        renderInstructions(instructionManager, document.getElementById('instructions-list'));
        showSuccess(`${result.imported} instructions imported successfully`);
      } catch (error) {
        logger.error('Failed to import instructions', {}, error);
        showError('Failed to import instructions');
      }
    });

    fileInput.click();
  } catch (error) {
    logger.error('Failed to handle import instructions', {}, error);
    showError('Failed to import instructions');
  }
}

/**
 * Handles export instructions
 */
function handleExportInstructions(instructionManager) {
  logger.debug('Handling export instructions');

  try {
    const data = instructionManager.exportInstructions();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'instructions.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showSuccess('Instructions exported successfully');
  } catch (error) {
    logger.error('Failed to export instructions', {}, error);
    showError('Failed to export instructions');
  }
}

/**
 * Handles add tool
 */
function handleAddTool(toolManager) {
  logger.debug('Handling add tool');

  try {
    // Create tool dialog
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <h2>Add Tool</h2>
      <form id="add-tool-form">
        <div class="form-group">
          <label for="tool-name">Name:</label>
          <input type="text" id="tool-name" name="name" required>
        </div>
        <div class="form-group">
          <label for="tool-description">Description:</label>
          <input type="text" id="tool-description" name="description">
        </div>
        <div class="form-group">
          <label for="tool-endpoint">Endpoint URL:</label>
          <input type="text" id="tool-endpoint" name="endpointUrl">
        </div>
        <div class="form-group">
          <label for="tool-method">HTTP Method:</label>
          <select id="tool-method" name="httpMethod">
            <option value="GET">GET</option>
            <option value="POST" selected>POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
        <div class="form-group">
          <label for="tool-parameters">Parameters (JSON):</label>
          <textarea id="tool-parameters" name="parameters" rows="6">{}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" id="cancel-add-tool">Cancel</button>
          <button type="submit">Add Tool</button>
        </div>
      </form>
    `;

    document.body.appendChild(dialog);
    dialog.showModal();

    // Set up form submission
    const form = dialog.querySelector('#add-tool-form');
    const cancelButton = dialog.querySelector('#cancel-add-tool');

    const closeDialog = () => {
      document.body.removeChild(dialog);
    };

    cancelButton.addEventListener('click', closeDialog);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const toolData = {
        name: formData.get('name'),
        description: formData.get('description'),
        endpointUrl: formData.get('endpointUrl'),
        httpMethod: formData.get('httpMethod'),
        parameters: formData.get('parameters')
      };

      try {
        await toolManager.createTool(toolData);
        renderTools(toolManager, document.getElementById('tools-list'));
        closeDialog();
        showSuccess('Tool added successfully');
      } catch (error) {
        logger.error('Failed to add tool', {}, error);
        showError('Failed to add tool');
      }
    });
  } catch (error) {
    logger.error('Failed to handle add tool', {}, error);
    showError('Failed to add tool');
  }
}

/**
 * Handles edit tool
 */
function handleEditTool(toolManager, toolId) {
  logger.debug('Handling edit tool', { toolId });

  try {
    const tool = toolManager.getTool(toolId);
    if (!tool) {
      showError('Tool not found');
      return;
    }

    // Create edit tool dialog
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <h2>Edit Tool</h2>
      <form id="edit-tool-form">
        <div class="form-group">
          <label for="tool-name">Name:</label>
          <input type="text" id="tool-name" name="name" value="${tool.name}" required>
        </div>
        <div class="form-group">
          <label for="tool-description">Description:</label>
          <input type="text" id="tool-description" name="description" value="${tool.description || ''}">
        </div>
        <div class="form-group">
          <label for="tool-endpoint">Endpoint URL:</label>
          <input type="text" id="tool-endpoint" name="endpointUrl" value="${tool.endpointUrl || ''}">
        </div>
        <div class="form-group">
          <label for="tool-method">HTTP Method:</label>
          <select id="tool-method" name="httpMethod">
            <option value="GET" ${tool.httpMethod === 'GET' ? 'selected' : ''}>GET</option>
            <option value="POST" ${tool.httpMethod === 'POST' ? 'selected' : ''}>POST</option>
            <option value="PUT" ${tool.httpMethod === 'PUT' ? 'selected' : ''}>PUT</option>
            <option value="DELETE" ${tool.httpMethod === 'DELETE' ? 'selected' : ''}>DELETE</option>
          </select>
        </div>
        <div class="form-group">
          <label for="tool-parameters">Parameters (JSON):</label>
          <textarea id="tool-parameters" name="parameters" rows="6">${tool.parameters || '{}'}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" id="cancel-edit-tool">Cancel</button>
          <button type="submit">Save Tool</button>
        </div>
      </form>
    `;

    document.body.appendChild(dialog);
    dialog.showModal();

    // Set up form submission
    const form = dialog.querySelector('#edit-tool-form');
    const cancelButton = dialog.querySelector('#cancel-edit-tool');

    const closeDialog = () => {
      document.body.removeChild(dialog);
    };

    cancelButton.addEventListener('click', closeDialog);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const updates = {
        name: formData.get('name'),
        description: formData.get('description'),
        endpointUrl: formData.get('endpointUrl'),
        httpMethod: formData.get('httpMethod'),
        parameters: formData.get('parameters')
      };

      try {
        await toolManager.updateTool(toolId, updates);
        renderTools(toolManager, document.getElementById('tools-list'));
        closeDialog();
        showSuccess('Tool updated successfully');
      } catch (error) {
        logger.error('Failed to update tool', { toolId }, error);
        showError('Failed to update tool');
      }
    });
  } catch (error) {
    logger.error('Failed to handle edit tool', { toolId }, error);
    showError('Failed to edit tool');
  }
}

/**
 * Handles test tool
 */
function handleTestTool(toolManager, toolId) {
  logger.debug('Handling test tool', { toolId });

  try {
    const tool = toolManager.getTool(toolId);
    if (!tool) {
      showError('Tool not found');
      return;
    }

    // Create test tool dialog
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <h2>Test Tool: ${tool.name}</h2>
      <form id="test-tool-form">
        <div class="form-group">
          <label for="test-args">Test Arguments (JSON):</label>
          <textarea id="test-args" name="args" rows="6">{}</textarea>
        </div>
        <div class="form-group">
          <label for="test-method">HTTP Method:</label>
          <select id="test-method" name="method">
            <option value="GET">GET</option>
            <option value="POST" ${tool.httpMethod === 'POST' ? 'selected' : ''}>POST</option>
            <option value="PUT" ${tool.httpMethod === 'PUT' ? 'selected' : ''}>PUT</option>
            <option value="DELETE" ${tool.httpMethod === 'DELETE' ? 'selected' : ''}>DELETE</option>
          </select>
        </div>
        <div class="form-actions">
          <button type="button" id="cancel-test-tool">Cancel</button>
          <button type="submit" id="test-tool-submit">Test Tool</button>
        </div>
      </form>
      <div id="test-result" class="test-result" style="display: none;">
        <h3>Test Result</h3>
        <pre id="test-result-content"></pre>
      </div>
    `;

    document.body.appendChild(dialog);
    dialog.showModal();

    // Set up form submission
    const form = dialog.querySelector('#test-tool-form');
    const cancelButton = dialog.querySelector('#cancel-test-tool');
    const testButton = document.querySelector('#test-tool-submit');
    const testResult = document.querySelector('#test-result');
    const testResultContent = document.querySelector('#test-result-content');

    const closeDialog = () => {
      document.body.removeChild(dialog);
    };

    cancelButton.addEventListener('click', closeDialog);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const testData = {
        args: JSON.parse(formData.get('args') || '{}'),
        method: formData.get('method')
      };

      try {
        // Disable test button
        testButton.disabled = true;
        testButton.textContent = 'Testing...';

        // Test tool
        const result = await toolManager.testTool(toolId, testData);

        // Show result
        testResultContent.textContent = JSON.stringify(result, null, 2);
        testResult.style.display = 'block';

        if (result.success) {
          showSuccess('Tool test successful');
        } else {
          showError('Tool test failed');
        }
      } catch (error) {
        logger.error('Failed to test tool', { toolId }, error);
        showError('Failed to test tool');
      } finally {
        // Re-enable test button
        testButton.disabled = false;
        testButton.textContent = 'Test Tool';
      }
    });
  } catch (error) {
    logger.error('Failed to handle test tool', { toolId }, error);
    showError('Failed to test tool');
  }
}

/**
 * Handles delete tool
 */
function handleDeleteTool(toolManager, toolId) {
  logger.debug('Handling delete tool', { toolId });

  try {
    // Confirm deletion
    if (!confirm('Are you sure you want to delete this tool?')) {
      return;
    }

    toolManager.deleteTool(toolId).then(success => {
      if (success) {
        renderTools(toolManager, document.getElementById('tools-list'));
        showSuccess('Tool deleted successfully');
      } else {
        showError('Failed to delete tool');
      }
    }).catch(error => {
      logger.error('Failed to delete tool', { toolId }, error);
      showError('Failed to delete tool');
    });
  } catch (error) {
    logger.error('Failed to handle delete tool', { toolId }, error);
    showError('Failed to delete tool');
  }
}

/**
 * Handles import tools
 */
function handleImportTools(toolManager) {
  logger.debug('Handling import tools');

  try {
    // Create file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const result = await toolManager.importTools(text);
        renderTools(toolManager, document.getElementById('tools-list'));
        showSuccess(`${result.imported} tools imported successfully`);
      } catch (error) {
        logger.error('Failed to import tools', {}, error);
        showError('Failed to import tools');
      }
    });

    fileInput.click();
  } catch (error) {
    logger.error('Failed to handle import tools', {}, error);
    showError('Failed to import tools');
  }
}

/**
 * Handles export tools
 */
function handleExportTools(toolManager) {
  logger.debug('Handling export tools');

  try {
    const data = toolManager.exportTools();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tools.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showSuccess('Tools exported successfully');
  } catch (error) {
    logger.error('Failed to export tools', {}, error);
    showError('Failed to export tools');
  }
}

/**
 * Handles save settings
 */
function handleSaveSettings(settingsManager, formData) {
  logger.debug('Handling save settings');

  try {
    const updates = {
      analyticsConsent: formData.get('analyticsConsent') === 'on',
      debugMode: formData.get('debugMode') === 'on',
      autoSave: formData.get('autoSave') === 'on',
      theme: formData.get('theme'),
      language: formData.get('language')
    };

    settingsManager.updateSettings(updates).then(success => {
      if (success) {
        showSuccess('Settings saved successfully');
      } else {
        showError('Failed to save settings');
      }
    }).catch(error => {
      logger.error('Failed to save settings', {}, error);
      showError('Failed to save settings');
    });
  } catch (error) {
    logger.error('Failed to handle save settings', {}, error);
    showError('Failed to save settings');
  }
}

/**
 * Handles reset settings
 */
function handleResetSettings(settingsManager) {
  logger.debug('Handling reset settings');

  try {
    // Confirm reset
    if (!confirm('Are you sure you want to reset all settings to their default values?')) {
      return;
    }

    settingsManager.resetSettings().then(() => {
      renderSettings(settingsManager, document.getElementById('settings-form'));
      showSuccess('Settings reset successfully');
    }).catch(error => {
      logger.error('Failed to reset settings', {}, error);
      showError('Failed to reset settings');
    });
  } catch (error) {
    logger.error('Failed to handle reset settings', {}, error);
    showError('Failed to reset settings');
  }
}

/**
 * Handles import settings
 */
function handleImportSettings(settingsManager) {
  logger.debug('Handling import settings');

  try {
    // Create file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const result = await settingsManager.importSettings(text);
        renderSettings(settingsManager, document.getElementById('settings-form'));
        showSuccess('Settings imported successfully');
      } catch (error) {
        logger.error('Failed to import settings', {}, error);
        showError('Failed to import settings');
      }
    });

    fileInput.click();
  } catch (error) {
    logger.error('Failed to handle import settings', {}, error);
    showError('Failed to import settings');
  }
}

/**
 * Handles export settings
 */
function handleExportSettings(settingsManager) {
  logger.debug('Handling export settings');

  try {
    const data = settingsManager.exportSettings();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showSuccess('Settings exported successfully');
  } catch (error) {
    logger.error('Failed to export settings', {}, error);
    showError('Failed to export settings');
  }
}

/**
 * Handles save
 */
function handleSave(profileManager, instructionManager, toolManager, settingsManager) {
  logger.debug('Handling save');

  try {
    // Save all data
    Promise.all([
      profileManager.saveProfiles(),
      instructionManager.saveInstructions(),
      toolManager.saveTools(),
      settingsManager.saveSettings()
    ]).then(() => {
      showSuccess('All data saved successfully');
    }).catch(error => {
      logger.error('Failed to save data', {}, error);
      showError('Failed to save data');
    });
  } catch (error) {
    logger.error('Failed to handle save', {}, error);
    showError('Failed to save data');
  }
}

/**
 * Handles storage changes
 */
function handleStorageChanges(changes, profileManager, instructionManager, toolManager, settingsManager) {
  logger.debug('Handling storage changes', { changes });

  try {
    // Reload data if it changed
    if (changes.profiles) {
      profileManager.loadProfiles().then(() => {
        renderProfiles(profileManager, document.getElementById('profiles-list'));
      }).catch(error => {
        logger.error('Failed to reload profiles', {}, error);
      });
    }

    if (changes.instructions) {
      instructionManager.loadInstructions().then(() => {
        renderInstructions(instructionManager, document.getElementById('instructions-list'));
      }).catch(error => {
        logger.error('Failed to reload instructions', {}, error);
      });
    }

    if (changes.promptPaulTools) {
      toolManager.loadTools().then(() => {
        renderTools(toolManager, document.getElementById('tools-list'));
      }).catch(error => {
        logger.error('Failed to reload tools', {}, error);
      });
    }

    if (changes.settings) {
      settingsManager.loadSettings().then(() => {
        renderSettings(settingsManager, document.getElementById('settings-form'));
      }).catch(error => {
        logger.error('Failed to reload settings', {}, error);
      });
    }
  } catch (error) {
    logger.error('Failed to handle storage changes', {}, error);
  }
}

/**
 * Sets up search functionality
 */
function setupSearch() {
  logger.debug('Setting up search functionality');

  try {
    const searchInput = document.getElementById('search-input');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const activeTab = currentTab;

      // Search in active tab
      switch (activeTab) {
        case 'profiles':
          searchProfiles(query);
          break;
        case 'instructions':
          searchInstructions(query);
          break;
        case 'tools':
          searchTools(query);
          break;
        case 'settings':
          searchSettings(query);
          break;
      }
    });
  } catch (error) {
    logger.error('Failed to set up search functionality', {}, error);
    throw error;
  }
}

/**
 * Searches profiles
 */
function searchProfiles(query) {
  const profileItems = document.querySelectorAll('.profile-item');
  
  profileItems.forEach(item => {
    const name = item.querySelector('.profile-name').textContent.toLowerCase();
    if (name.includes(query)) {
      item.style.display = 'block';
    } else {
      item.style.display = 'none';
    }
  });
}

/**
 * Searches instructions
 */
function searchInstructions(query) {
  const instructionItems = document.querySelectorAll('.instruction-item');
  
  instructionItems.forEach(item => {
    const name = item.querySelector('.instruction-name').textContent.toLowerCase();
    const content = item.querySelector('.instruction-content').textContent.toLowerCase();
    if (name.includes(query) || content.includes(query)) {
      item.style.display = 'block';
    } else {
      item.style.display = 'none';
    }
  });
}

/**
 * Searches tools
 */
function searchTools(query) {
  const toolItems = document.querySelectorAll('.tool-item');
  
  toolItems.forEach(item => {
    const name = item.querySelector('.tool-name').textContent.toLowerCase();
    const description = item.querySelector('.tool-description').textContent.toLowerCase();
    if (name.includes(query) || description.includes(query)) {
      item.style.display = 'block';
    } else {
      item.style.display = 'none';
    }
  });
}

/**
 * Searches settings
 */
function searchSettings(query) {
  const formGroups = document.querySelectorAll('#settings-form .form-group');
  
  formGroups.forEach(group => {
    const label = group.querySelector('label').textContent.toLowerCase();
    if (label.includes(query)) {
      group.style.display = 'block';
    } else {
      group.style.display = 'none';
    }
  });
}

/**
 * Shows success message
 */
function showSuccess(message) {
  // Create success message
  const successMessage = document.createElement('div');
  successMessage.className = 'success-message';
  successMessage.textContent = message;

  document.body.appendChild(successMessage);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (successMessage.parentNode) {
      successMessage.parentNode.removeChild(successMessage);
    }
  }, 3000);
}

/**
 * Shows error message
 */
function showError(message) {
  // Create error message
  const errorMessage = document.createElement('div');
  errorMessage.className = 'error-message';
  errorMessage.textContent = message;

  document.body.appendChild(errorMessage);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (errorMessage.parentNode) {
      errorMessage.parentNode.removeChild(errorMessage);
    }
  }, 5000);
}

// Initialize options page when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeOptions);
} else {
  initializeOptions().catch(error => {
    logger.error('Failed to initialize options page', {}, error);
  });
}