import { loadingManager } from './loadingManager.js';

// Function to show status message
function showStatus(message, isError = false, isToast = false) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${isError ? 'error' : 'success'}`;
  status.style.display = 'block';

  // Also show toast notification
  if (isError) {
    loadingManager.showToast(message, 'error');
  } else {
    loadingManager.showToast(message, 'success');
  }

  let timeoutDuration = 2000; // Default timeout
  if (isToast) {
    timeoutDuration = 5000; // Longer timeout for toasts
  }

  if (!isError) { // Apply timeout for both success and toast messages, but not errors
    setTimeout(() => {
      status.style.display = 'none';
    }, timeoutDuration);
  }
}

function updateCurrentConfig(endpoint, key, model, timestamp, systemPrompt, profile) {
  document.getElementById('currentEndpoint').textContent = endpoint || 'Not set';
  document.getElementById('currentApiKey').textContent = key ? '********' + key.slice(-4) : 'Not set';
  document.getElementById('currentModelName').textContent = model || 'Not set';
  document.getElementById('lastUpdated').textContent = timestamp || 'Not set';
  document.getElementById('currentSystemPrompt').textContent = systemPrompt || 'Not set';
  const currentProfileElement = document.getElementById('currentProfile');
  if (currentProfileElement) {
    currentProfileElement.textContent = profile || 'Default'; // Display profile
  }

  // Get max tokens from storage and display it
  chrome.storage.sync.get(['maxTokens'], (result) => {
    const maxTokens = result.maxTokens || 2048;
    const maxTokensDisplay = document.getElementById('currentMaxTokens');
    if (maxTokensDisplay) {
      maxTokensDisplay.textContent = maxTokens;
    }
  });
}

// Function to validate inputs
function validateInputs(endpoint, key, model) {
  if (!endpoint || !key || !model) {
    showStatus('API endpoint, API key, and model name are required', true);
    return false;
  }

  try {
    new URL(endpoint);
  } catch (e) {
    showStatus('Please enter a valid URL for the API endpoint', true);
    return false;
  }

  return true;
}

// Save options to chrome.storage
function saveOptions(e) {
  e.preventDefault();

  const profileSelectElement = document.getElementById('profileSelect');
  if (!profileSelectElement) {
    console.error('profileSelect element is missing in the DOM.');
    showStatus('Error: profileSelect element is missing. Please reload the page.', true);
    return;
  }
  const selectedProfileId = profileSelectElement.value; // No trim, could be 'add_new_profile'

  const llmEndpoint = document.getElementById('llmEndpoint');
  if (!llmEndpoint) {
    console.error('llmEndpoint element is missing in the DOM.');
    showStatus('Error: llmEndpoint element is missing. Please reload the page.', true);
    return;
  }
  const llmEndpointValue = llmEndpoint.value.trim();

  const apiKey = document.getElementById('apiKey');
  if (!apiKey) {
    console.error('apiKey element is missing in the DOM.');
    showStatus('Error: apiKey element is missing. Please reload the page.', true);
    return;
  }
  const apiKeyValue = apiKey.value.trim();

  const modelName = document.getElementById('modelName');
  if (!modelName) {
    console.error('modelName element is missing in the DOM.');
    showStatus('Error: modelName element is missing. Please reload the page.', true);
    return;
  }
  const modelNameValue = modelName.value.trim();

  const maxTokens = document.getElementById('maxTokens');
  if (!maxTokens) {
    console.error('maxTokens element is missing in the DOM.');
    showStatus('Error: maxTokens element is missing. Please reload the page.', true);
    return;
  }
  const maxTokensValue = maxTokens.value.trim();

  const systemPrompt = document.getElementById('systemPrompt');
  if (!systemPrompt) {
    console.error('systemPrompt element is missing in the DOM.');
    showStatus('Error: systemPrompt element is missing. Please reload the page.', true);
    return;
  }
  const systemPromptValue = systemPrompt.value.trim();

  if (!validateInputs(llmEndpointValue, apiKeyValue, modelNameValue)) {
    return;
  }

  // Disable save button while saving
  const saveButton = document.getElementById('save');
  saveButton.disabled = true;

  // Save to local storage profiles
  console.log('Options: Attempting to save options...');
  chrome.storage.local.get(['profiles'], (result) => {
    console.log('Options: Current profiles from storage:', result.profiles);
    let profiles = result.profiles || [];
    let profileToUpdate = profiles.find(p => p.id === selectedProfileId);

    if (!profileToUpdate) {
      console.log(`Options: Profile with ID '${selectedProfileId}' not found, creating new profile.`);
      // This case should ideally not happen if dropdown is managed well,
      // but as a fallback, or if it's 'default' and somehow missing.
      profileToUpdate = {
        id: selectedProfileId, // Could be 'default'
        name: selectedProfileId === 'default' ? 'Default' : 'New Profile ' + Date.now(), // Basic name
        llmEndpoint: llmEndpointValue,
        apiKey: apiKeyValue,
        modelName: modelNameValue,
        maxTokens: maxTokensValue || 2048,
        systemPrompt: systemPromptValue,
        lastUpdated: new Date().toLocaleString()
      };
      profiles.push(profileToUpdate);
      console.log('Options: New profile created:', profileToUpdate);
    } else {
      console.log(`Options: Profile with ID '${selectedProfileId}' found, updating existing profile.`);
      profileToUpdate.llmEndpoint = llmEndpointValue;
      profileToUpdate.apiKey = apiKeyValue;
      profileToUpdate.modelName = modelNameValue;
      profileToUpdate.maxTokens = maxTokensValue || 2048;
      profileToUpdate.systemPrompt = systemPromptValue;
      profileToUpdate.lastUpdated = new Date().toLocaleString();
      console.log('Options: Profile updated:', profileToUpdate);
      // profileToUpdate.name is handled during creation or if user edits it (future feature)
    }

    console.log('Options: Saving profiles and last selected profile ID:', { profiles: profiles, lastSelectedProfileId: selectedProfileId });
    chrome.storage.local.set({ profiles: profiles, lastSelectedProfileId: selectedProfileId }, () => {
      if (chrome.runtime.lastError) {
        console.error('Options: Error saving profile settings to local storage:', chrome.runtime.lastError);
        showStatus('Error saving profile settings: ' + chrome.runtime.lastError.message, true);
      } else {
        console.log(`Options: Settings for profile '${profileToUpdate.name}' saved successfully.`);
        showStatus(`Settings for profile '${profileToUpdate.name}' saved!`);
        // Reload options to reflect changes, especially if it was a new profile or name changed
        loadOptions();
      }
      saveButton.disabled = false;
    });
  });
}

// Load saved options
// Function to load settings for a specific profile
function loadProfileSettings(profileId) {
  console.log(`[DEBUG] loadProfileSettings: Attempting to load settings for profile ID: ${profileId}`);
  chrome.storage.local.get(['profiles'], (result) => {
    console.log('[DEBUG] loadProfileSettings: Profiles retrieved from storage:', result.profiles);
    const profiles = result.profiles || [];
    const selectedProfile = profiles.find(p => p.id === profileId) || profiles.find(p => p.id === 'default');
    console.log('[DEBUG] loadProfileSettings: Selected profile:', selectedProfile);

    if (selectedProfile) {
      console.log('Options: Populating form fields with selected profile data.'); // Added log
      document.getElementById('llmEndpoint').value = selectedProfile.llmEndpoint || 'https://api.mistral.ai/v1/chat/completions';
      document.getElementById('apiKey').value = selectedProfile.apiKey || 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF';
      document.getElementById('modelName').value = selectedProfile.modelName || 'mistral-small-latest';
      document.getElementById('maxTokens').value = selectedProfile.maxTokens || 32000;
      document.getElementById('systemPrompt').value = selectedProfile.systemPrompt || '';
      updateCurrentConfig(
        selectedProfile.llmEndpoint,
        selectedProfile.apiKey,
        selectedProfile.modelName,
        selectedProfile.lastUpdated || new Date().toLocaleString(),
        selectedProfile.systemPrompt,
        selectedProfile.name // Pass profile name to updateCurrentConfig
      );
    } else {
      // Fallback to sync storage if profile not found (e.g. initial load or error)
      chrome.storage.sync.get(
        {
          llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
          apiKey: 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF',
          modelName: 'mistral-small-latest',
          maxTokens: 32000,
          systemPrompt: '',
          lastUpdated: '',
          profileSelect: 'default'
        },
        (items) => {
          if (chrome.runtime.lastError) {
            console.error('Error loading settings from sync:', chrome.runtime.lastError);
            showStatus('Error loading settings: ' + chrome.runtime.lastError.message, true);
            return;
          }
          document.getElementById('llmEndpoint').value = items.llmEndpoint;
          document.getElementById('apiKey').value = items.apiKey;
          document.getElementById('modelName').value = items.modelName;
          document.getElementById('maxTokens').value = items.maxTokens;
          document.getElementById('systemPrompt').value = items.systemPrompt;
          updateCurrentConfig(items.llmEndpoint, items.apiKey, items.modelName, items.lastUpdated, items.profileSelect);
        }
      );
    }
  });
}

// Load saved options
function loadOptions() {
  const profileSelectElement = document.getElementById('profileSelect');

  // Function to populate profile dropdown
  function populateProfileDropdown(profiles, selectedProfileId) {
    profileSelectElement.innerHTML = ''; // Clear existing options

    // Add a "Add New Profile" option
    const addNewOption = document.createElement('option');
    addNewOption.value = 'add_new_profile';
    addNewOption.textContent = '+ Add New Profile...';
    profileSelectElement.appendChild(addNewOption);
    
    const defaultOption = document.createElement('option');
    defaultOption.value = 'default';
    defaultOption.textContent = 'Default';
    profileSelectElement.appendChild(defaultOption);

    if (profiles && profiles.length > 0) {
      profiles.forEach(profile => {
        if (profile.id === 'default') return; // Skip default if already added
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        profileSelectElement.appendChild(option);
      });
    }
    profileSelectElement.value = selectedProfileId || 'default';
  }

  // Load profiles and the last selected profile ID from storage
  console.log('Options: Loading profiles and last selected profile ID...');
  chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
    console.log('Options: Storage get result for profiles and lastSelectedProfileId:', result);
    let profiles = result.profiles || [];
    const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
    console.log('Options: Loaded profiles:', profiles);
    console.log('Options: Loaded last selected profile ID:', lastSelectedProfileId);

    // Ensure default profile exists
    if (!profiles.find(p => p.id === 'default')) {
      console.log('Options: Default profile not found, creating it.');
      const defaultProfile = {
        id: 'default',
        name: 'Default',
        llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
        apiKey: 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF',
        modelName: 'mistral-small-latest',
        maxTokens: 32000,
        systemPrompt: 'You are a helpful assistant.',
        lastUpdated: new Date().toLocaleString()
      };
      profiles.push(defaultProfile);
      console.log('Options: Default profile created:', defaultProfile);
      chrome.storage.local.set({ profiles: profiles }, () => {
        if (chrome.runtime.lastError) {
          console.error('Options: Error saving default profile:', chrome.runtime.lastError);
        } else {
          console.log('Options: Default profile saved successfully.');
        }
      }); // Save updated profiles array
    } else {
      console.log('Options: Default profile already exists.');
    }
    
    populateProfileDropdown(profiles, lastSelectedProfileId);
    loadProfileSettings(lastSelectedProfileId); // Load settings for the last selected or default profile
  });
}

// Add event listeners
document.addEventListener('DOMContentLoaded', () => {
  loadOptions(); // This will now also populate profiles and set up listener
  const deleteProfileButton = document.getElementById('deleteProfileButton');

  if (deleteProfileButton) {
    deleteProfileButton.addEventListener('click', () => {
      const profileSelectElement = document.getElementById('profileSelect');
      if (!profileSelectElement) {
        showStatus('Profile select dropdown not found.', true);
        return;
      }
      const selectedProfileId = profileSelectElement.value;

      if (selectedProfileId === 'default') {
        showStatus('The "Default" profile cannot be deleted.', true);
        return;
      }

      if (selectedProfileId === 'add_new_profile') {
        showStatus('Please select a profile to delete.', true);
        return;
      }

      // Confirm with the user
      chrome.storage.local.get(['profiles'], (result) => {
        const profiles = result.profiles || [];
        const profileToDelete = profiles.find(p => p.id === selectedProfileId);
        const profileName = profileToDelete ? profileToDelete.name : 'the selected profile';

        if (window.confirm(`Are you sure you want to delete the profile "${profileName}"? This action cannot be undone.`)) {
          const updatedProfiles = profiles.filter(p => p.id !== selectedProfileId);
          chrome.storage.local.set({ profiles: updatedProfiles, lastSelectedProfileId: 'default' }, () => {
            if (chrome.runtime.lastError) {
              console.error('Error deleting profile:', chrome.runtime.lastError);
              showStatus('Error deleting profile: ' + chrome.runtime.lastError.message, true);
            } else {
              showStatus(`Profile "${profileName}" deleted successfully. Switched to Default profile.`, false, true);
              loadOptions(); // This will repopulate dropdown and load default profile settings.
            }
          });
        }
      });
    });
  }
  checkAndPromptInstructionMigration();
  setupInstructionHandlers();
// Add event listener for collapsible header
document.querySelectorAll('.collapsible-header').forEach(header => {
  header.addEventListener('click', () => {
    const content = header.nextElementSibling;
    content.classList.toggle('expanded');
    header.classList.toggle('expanded');
  });
});
  setupToolHandlers(); // Add call to setup tool handlers

  // Add event listener for the Revert button
  const revertButton = document.getElementById('revertDefaultsButton');
  if (revertButton) {
    revertButton.addEventListener('click', () => {
      // Get default values (these are defined in loadOptions)
      const defaultEndpoint = 'https://api.mistral.ai/v1/chat/completions';
      const defaultApiKey = 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF';
      const defaultModelName = 'mistral-small-latest';

      // Set default values in the input fields
      document.getElementById('llmEndpoint').value = defaultEndpoint;
      document.getElementById('apiKey').value = defaultApiKey;
      document.getElementById('modelName').value = defaultModelName;

      // Optionally, clear maxTokens and systemPrompt or set to their defaults if needed
      // document.getElementById('maxTokens').value = '2048'; // Default max tokens
      // document.getElementById('systemPrompt').value = ''; // Default system prompt

      showStatus('Settings reverted to defaults. Click "Save Settings" to apply.', false, true); // Show as a toast
    });
  }

  // Event listener for profile selection change
  const profileSelectElement = document.getElementById('profileSelect');
  if (profileSelectElement) {
    profileSelectElement.addEventListener('change', (event) => {
      const selectedProfileId = event.target.value;
      console.log(`[DEBUG] profileSelect change: Selected profile ID: ${selectedProfileId}`);
      if (selectedProfileId === 'add_new_profile') {
        const newProfileName = prompt('Enter a name for the new profile (e.g., "My OpenAI GPT-4"):');
        if (newProfileName && newProfileName.trim() !== '') {
          chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
            let profiles = result.profiles || [];
            // Ensure profileSelectElement is available before accessing its value.
            const currentProfileId = profileSelectElement ? profileSelectElement.value : 'default';
            const currentProfile = profiles.find(p => p.id === currentProfileId) || profiles.find(p => p.id === 'default') || {};

            const newProfileId = 'profile_' + Date.now(); // Unique ID for the new profile
            const newProfile = {
              id: newProfileId,
              name: newProfileName.trim(),
              llmEndpoint: document.getElementById('llmEndpoint').value.trim() || currentProfile.llmEndpoint,
              apiKey: document.getElementById('apiKey').value.trim() || currentProfile.apiKey,
              modelName: document.getElementById('modelName').value.trim() || currentProfile.modelName,
              maxTokens: document.getElementById('maxTokens').value.trim() || currentProfile.maxTokens || 2048,
              systemPrompt: document.getElementById('systemPrompt').value.trim() || currentProfile.systemPrompt,
              lastUpdated: new Date().toLocaleString()
            };
            profiles.push(newProfile);
            chrome.storage.local.set({ profiles: profiles, lastSelectedProfileId: newProfileId }, () => {
              // populateProfileDropdown is called within loadOptions
              loadOptions(); // Reload options to correctly populate and select.
              // Explicitly set to new profile ID *after* loadOptions, as loadOptions might reset it.
              profileSelectElement.value = newProfileId;
              loadProfileSettings(newProfileId); // Load its settings into the form
              showStatus(`Profile "${newProfile.name}" created. Review and save settings.`, false, true);
            });
          });
        } else {
          // User cancelled or entered empty name, revert to last selected
          chrome.storage.local.get(['lastSelectedProfileId'], (res) => {
            if (profileSelectElement) {
              profileSelectElement.value = res.lastSelectedProfileId || 'default';
            }
          });
        }
      } else {
        chrome.storage.local.set({ lastSelectedProfileId: selectedProfileId });
        loadProfileSettings(selectedProfileId);
      }
    });
  }
});

// --- Dark Theme Toggle Logic ---
// This DOMContentLoaded listener should ideally be merged with the one above,
// but for now, we'll follow the existing structure.
import { setupThemeToggle } from './themeUtils.js';

document.addEventListener('DOMContentLoaded', () => {
  // Streaming Toggle
  const enableStreamingToggle = document.getElementById('enableStreamingToggle');
  if (enableStreamingToggle) {
    // Load streaming setting
    chrome.storage.sync.get({ enableStreaming: false }, (result) => {
      enableStreamingToggle.checked = !!result.enableStreaming;
    });

    // Save streaming setting on change
    enableStreamingToggle.addEventListener('change', () => {
      const isStreamingEnabled = enableStreamingToggle.checked;
      chrome.storage.sync.set({ enableStreaming: isStreamingEnabled }, () => {
        showStatus(`Streaming responses ${isStreamingEnabled ? 'enabled' : 'disabled'}.`, false, true);
      });
    });
  }

  // Dark Theme Toggle
  const darkThemeToggle = document.getElementById('darkThemeToggle');
  if (darkThemeToggle) {
    setupThemeToggle(darkThemeToggle);
  }

  // Listen for storage changes to sync streaming
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enableStreaming && enableStreamingToggle) {
      enableStreamingToggle.checked = !!changes.enableStreaming.newValue;
    }
  });
});

// Migration logic for instructions from sync to local
function checkAndPromptInstructionMigration() {
  chrome.storage.sync.get(['instructions'], (syncResult) => {
    chrome.storage.local.get(['instructions'], (localResult) => {
      const syncInstructions = syncResult.instructions || [];
      const localInstructions = localResult.instructions || [];
      // Show prompt if sync has instructions and local does not
      if (syncInstructions.length > 0 && localInstructions.length === 0) {
        const migrationPrompt = document.getElementById('migrationPrompt');
        migrationPrompt.style.display = 'block';
        document.getElementById('migrateInstructionsBtn').onclick = () => {
          chrome.storage.local.set({ instructions: syncInstructions }, () => {
            chrome.storage.sync.set({ instructions: [] }, () => {
              migrationPrompt.style.display = 'none';
              showStatus('Instructions migrated to this device only!', false, true);
              // Reload instructions table
              if (typeof window.setupInstructionHandlers === 'function') {
                // If handler is re-entrant, reload
                document.querySelector('#instructionsTable tbody').innerHTML = '';
                // Call loadInstructions directly if available
                if (window.loadInstructions) window.loadInstructions();
              }
            });
          });
        };
        document.getElementById('dismissMigrationBtn').onclick = () => {
          migrationPrompt.style.display = 'none';
        };
      }
    });
  });
}

document.getElementById('optionsForm').addEventListener('submit', saveOptions);

// --- Tool Dropdown Population ---
async function populateToolDropdown() {
  const toolChoiceSelect = document.getElementById('instructionToolChoice');
  if (!toolChoiceSelect) {
    console.error("instructionToolChoice dropdown not found!");
    return;
  }

  // Clear existing tool options (keep the first two: None and Auto)
  while (toolChoiceSelect.options.length > 2) {
    toolChoiceSelect.remove(toolChoiceSelect.options.length - 1);
  }

  try {
    const result = await new Promise((resolve) => {
      chrome.storage.local.get(['promptPaulTools'], resolve);
    });
    const tools = result.promptPaulTools || [];

    if (tools.length > 0) {
        // Add a separator only if there are tools
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '------ Tools ------';
        toolChoiceSelect.appendChild(separator);

        // Add tools to the dropdown
        tools.forEach(tool => {
          const option = document.createElement('option');
          option.value = tool.name; // Use tool name as value
          option.textContent = tool.name;
          toolChoiceSelect.appendChild(option);
        });
    }
    // Selection restoration will be handled in the edit handler (loadInstructions)

  } catch (error) {
    console.error("Error loading tools for dropdown:", error);
    showStatus("Error loading tools for dropdown.", true);
  }
}


// Setup instruction management handlers
function setupInstructionHandlers() {
  const saveInstructionBtn = document.getElementById('saveInstruction');
  const clearFormBtn = document.getElementById('clearForm');
  const instructionForm = document.querySelector('.instruction-form');

  // Load and display instructions
  function loadInstructions() {
    chrome.storage.local.get(['instructions'], (result) => {
      const instructions = result.instructions || [];
      const tableBody = document.querySelector('#instructionsTable tbody');
      tableBody.innerHTML = '';

      instructions.forEach(instruction => {
        const row = document.createElement('tr');
        // Handle tool_choice display (could be string or array)
        let toolChoiceDisplay = 'None'; // Default display
        if (instruction.tool_choice) {
          if (Array.isArray(instruction.tool_choice)) {
            if (instruction.tool_choice.length === 0 || instruction.tool_choice.includes('none')) {
              toolChoiceDisplay = 'None';
            } else if (instruction.tool_choice.includes('auto')) {
              toolChoiceDisplay = 'Auto';
            } else {
              toolChoiceDisplay = instruction.tool_choice.join(', '); // Join array elements
            }
          } else { // Handle older string format for backward compatibility
            toolChoiceDisplay = instruction.tool_choice.charAt(0).toUpperCase() + instruction.tool_choice.slice(1);
          }
        }

        row.innerHTML = `
          <td>${instruction.name}</td>
          <td>${instruction.content}</td>
          <td>${toolChoiceDisplay}</td>
          <td><button class="pin-btn" data-id="${instruction.id}" title="Toggle Pin"><span class="material-symbols-outlined">hourglass_empty</span></button></td>
          <td>
            <button class="edit-btn" data-id="${instruction.id}">Edit</button>
            <button class="improve-btn" data-id="${instruction.id}">Improve</button>
            <button class="delete-btn" data-id="${instruction.id}">Delete</button>
          </td>
        `;
        tableBody.appendChild(row);

        // Asynchronously update the just-added pin button's state
        const currentPinButton = row.querySelector(`.pin-btn[data-id="${instruction.id}"]`);
        if (currentPinButton) {
            chrome.storage.local.get(['pinnedQuickActions'], (result) => {
                const pinnedQuickActions = result.pinnedQuickActions || [];
                if (pinnedQuickActions.includes(instruction.id)) {
                    currentPinButton.innerHTML = '<span class="material-symbols-outlined">keep_off</span>';
                    currentPinButton.classList.add('pinned');
                    currentPinButton.title = 'Unpin from Quick Actions';
                } else {
                    currentPinButton.innerHTML = '<span class="material-symbols-outlined">push_pin</span>';
                    currentPinButton.classList.remove('pinned'); // Ensure it's not there if re-rendering
                    currentPinButton.title = 'Pin to Quick Actions';
                }
            });
        }
      });

      // Add pin/edit/delete handlers (improve-btn is handled separately if it has complex logic)
      document.querySelectorAll('.pin-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const button = e.currentTarget;
          const instructionId = button.dataset.id;

          chrome.storage.local.get(['pinnedQuickActions'], (result) => {
            let pinnedQuickActions = result.pinnedQuickActions || [];
            const isPinned = pinnedQuickActions.includes(instructionId);

            if (isPinned) {
              pinnedQuickActions = pinnedQuickActions.filter(id => id !== instructionId);
              button.innerHTML = '<span class="material-symbols-outlined">push_pin</span>';
              button.classList.remove('pinned');
              button.title = 'Pin to Quick Actions';
              showStatus('Instruction unpinned from Quick Actions.');
            } else {
              pinnedQuickActions.push(instructionId);
              button.innerHTML = '<span class="material-symbols-outlined">keep_off</span>';
              button.classList.add('pinned');
              button.title = 'Unpin from Quick Actions';
              showStatus('Instruction pinned to Quick Actions.');
            }

            chrome.storage.local.set({ pinnedQuickActions: pinnedQuickActions }, () => {
              if (chrome.runtime.lastError) {
                showStatus('Error updating pinned status: ' + chrome.runtime.lastError.message, true);
              }
            });
          });
        });
      });
      document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const instructionId = e.target.dataset.id;
          const instruction = instructions.find(i => i.id === instructionId);
          if (instruction) {
            document.getElementById('instructionName').value = instruction.name;
            document.getElementById('instructionContent').value = instruction.content;
            document.getElementById('instructionId').value = instruction.id;

            // Set the tool_choice input
            const toolChoiceInput = document.getElementById('instructionToolChoice');
            if (toolChoiceInput) {
              if (Array.isArray(instruction.tool_choice)) {
                toolChoiceInput.value = instruction.tool_choice.join(', ');
              } else if (instruction.tool_choice) {
                toolChoiceInput.value = instruction.tool_choice;
              } else {
                toolChoiceInput.value = 'none';
              }
            }
          }
        });
      });

      document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const instructionId = e.target.dataset.id;
          if (confirm('Are you sure you want to delete this instruction?')) {
            chrome.storage.local.get(['instructions'], (result) => {
              let instructions = result.instructions || [];
              instructions = instructions.filter(i => i.id !== instructionId);
              chrome.storage.local.set({ instructions: instructions }, () => {
                showStatus('Instruction deleted!');
                loadInstructions(); // Reload the table
                // Clear the form if the deleted instruction was being edited
                if (document.getElementById('instructionId').value === instructionId) {
                  clearForm();
                }
              });
            });
          }
        });
      });

      // Add improve handler (calls the API)
      document.querySelectorAll('.improve-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const instructionId = e.target.dataset.id;
          const instruction = instructions.find(i => i.id === instructionId);
          if (instruction) {
            showStatus('Improving instruction...', false, true); // Show as toast
            try {
              // Get current API config from the selected profile
              const config = await new Promise((resolve, reject) => {
                chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
                  const profiles = result.profiles || [];
                  const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
                  const selectedProfile = profiles.find(p => p.id === lastSelectedProfileId);
                  if (selectedProfile && selectedProfile.llmEndpoint && selectedProfile.apiKey && selectedProfile.modelName) {
                    resolve(selectedProfile);
                  } else {
                    reject(new Error('API configuration is incomplete. Please set it up in settings.'));
                  }
                });
              });

              const improvedContent = await improvePromptAPI(
                config.llmEndpoint,
                config.apiKey,
                config.modelName,
                instruction.content // Pass the instruction content to the API
              );

              // Update the form with the improved content
              document.getElementById('instructionName').value = instruction.name; // Keep original name
              document.getElementById('instructionContent').value = improvedContent;
              document.getElementById('instructionId').value = instruction.id; // Keep original ID

              showStatus('Instruction improved! Review and Save.', false, true); // Show as toast
            } catch (error) {
              console.error('Error improving instruction:', error);
              showStatus('Failed to improve instruction: ' + error.message, true);
            }
          }
        });
      });
    });
  }

  // Save instruction handler
  if (saveInstructionBtn) {
    saveInstructionBtn.addEventListener('click', () => {
      const instructionName = document.getElementById('instructionName').value.trim();
      const instructionContent = document.getElementById('instructionContent').value.trim();
      const instructionId = document.getElementById('instructionId').value;
      const toolChoiceInput = document.getElementById('instructionToolChoice');
      const toolChoiceValue = toolChoiceInput.value.trim();

      if (!instructionName || !instructionContent) {
        showStatus('Instruction name and content are required.', true);
        return;
      }

      chrome.storage.local.get(['instructions'], (result) => {
        let instructions = result.instructions || [];
        const now = new Date().toISOString();

        if (instructionId) {
          // Update existing instruction
          instructions = instructions.map(inst => {
            if (inst.id === instructionId) {
              return {
                ...inst,
                name: instructionName,
                content: instructionContent,
                tool_choice: toolChoiceValue || 'none', // Save as string
                lastUpdated: now
              };
            }
            return inst;
          });
          showStatus('Instruction updated!');
        } else {
          // Add new instruction
          const newInstruction = {
            id: 'inst_' + Date.now(), // Simple unique ID
            name: instructionName,
            content: instructionContent,
            tool_choice: toolChoiceValue || 'none', // Save as string
            createdAt: now,
            lastUpdated: now
          };
          instructions.push(newInstruction);
          showStatus('Instruction added!');
        }

        chrome.storage.local.set({ instructions: instructions }, () => {
          loadInstructions(); // Reload the table
          clearForm(); // Clear the form after saving
        });
      });
    });
  }

  // Clear form handler
  if (clearFormBtn) {
    clearFormBtn.addEventListener('click', clearForm);
  }

  function clearForm() {
    document.getElementById('instructionName').value = '';
    document.getElementById('instructionContent').value = '';
    document.getElementById('instructionId').value = '';
    document.getElementById('instructionToolChoice').value = '';
    showStatus('Form cleared.');
  }

  // Export instructions handler
  document.getElementById('exportInstructions').addEventListener('click', () => {
    chrome.storage.local.get(['instructions'], (result) => {
      const instructions = result.instructions || [];
      const exportData = {
        version: 1, // Versioning for future compatibility
        instructions: instructions
      };
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "prompt_paul_instructions.json");
      document.body.appendChild(downloadAnchorNode); // Required for Firefox
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    });
  });

  // Import instructions handler
  document.getElementById('importInstructions').addEventListener('click', () => {
    document.getElementById('importFile').click(); // Trigger the hidden file input
  });

  document.getElementById('importFile').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        if (importData.version === 1 && Array.isArray(importData.instructions)) {
          // Simple merge strategy: add new instructions, update existing by ID
          chrome.storage.local.get(['instructions'], (result) => {
            let existingInstructions = result.instructions || [];
            const importedInstructions = importData.instructions;

            importedInstructions.forEach(importedInst => {
              const existingIndex = existingInstructions.findIndex(inst => inst.id === importedInst.id);
              if (existingIndex > -1) {
                // Update existing instruction
                existingInstructions[existingIndex] = { ...existingInstructions[existingIndex], ...importedInst, lastUpdated: new Date().toISOString() };
              } else {
                // Add new instruction
                existingInstructions.push({ ...importedInst, id: importedInst.id || 'inst_' + Date.now(), createdAt: importedInst.createdAt || new Date().toISOString(), lastUpdated: new Date().toISOString() });
              }
            });

            chrome.storage.local.set({ instructions: existingInstructions }, () => {
              showStatus('Instructions imported successfully!');
              loadInstructions(); // Reload the table
            });
          });
        } else {
          showStatus('Invalid import file format.', true);
        }
      } catch (error) {
        console.error('Error importing instructions:', error);
        showStatus('Error reading or parsing import file.', true);
      }
    };
    reader.readAsText(file);
  });

  // Initial load of instructions and tools
  loadInstructions();
  populateToolDropdown(); // Populate tool dropdown on load
}

// Function to call the API for prompt improvement
async function improvePromptAPI(endpoint, apiKey, modelName, prompt) {
  const messages = [
    { role: 'system', content: 'You are an expert prompt engineer. Improve the following prompt for a large language model to be clearer, more concise, and more effective. Only return the improved prompt text, nothing else.' },
    { role: 'user', content: prompt }
  ];

  const apiResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages: messages,
      max_tokens: 1000, // Limit response length for prompt improvement
      temperature: 0.7,
    }),
  });

  if (!apiResponse.ok) {
    const errorData = await apiResponse.json().catch(() => null);
    throw new Error(
      `API request failed with status ${apiResponse.status}: ${
        errorData ? JSON.stringify(errorData) : apiResponse.statusText
      }`
    );
  }

  const responseData = await apiResponse.json();
  if (!responseData || !responseData.choices || !responseData.choices[0] || !responseData.choices[0].message || !responseData.choices[0].message.content) {
    throw new Error('Invalid response format from API: Missing message content.');
  }

  return responseData.choices[0].message.content.trim();
}

// Helper function to validate URL (basic check)
function isValidURL(string) {
  if (!string) return false;
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

function isValidJson(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

// Setup tool management handlers
function setupToolHandlers() {
  const saveToolBtn = document.getElementById('saveTool');
  const clearToolFormBtn = document.getElementById('clearToolForm');
  const toolMcpServerUrlEl = document.getElementById('toolMcpServerUrl');
  const toolEndpointUrlEl = document.getElementById('toolEndpointUrl');
  const toolHttpMethodEl = document.getElementById('toolHttpMethod');
  const fetchMcpToolInfoBtn = document.getElementById('fetchMcpToolInfoBtn');

  function updateToolFieldStates() {
    const mcpUrl = toolMcpServerUrlEl.value.trim();
    const endpointUrl = toolEndpointUrlEl.value.trim();
    const toolDescriptionEl = document.getElementById('toolDescription');
    const toolParametersEl = document.getElementById('toolParameters');
    const toolDescriptionSourceEl = document.getElementById('toolDescriptionSource');
    const toolParametersSourceEl = document.getElementById('toolParametersSource');

    if (mcpUrl) {
      toolEndpointUrlEl.disabled = true;
      toolHttpMethodEl.disabled = true;
      // Optionally, clear them or just disable
      // toolEndpointUrlEl.value = '';
      // toolHttpMethodEl.value = '';
      toolDescriptionEl.dataset.source = 'mcp';
      toolParametersEl.dataset.source = 'mcp';
      toolDescriptionEl.classList.add('mcp-sourced');
      toolParametersEl.classList.add('mcp-sourced');
      toolDescriptionSourceEl.textContent = 'Source: MCP Server (dynamic). Local content is fallback.';
      toolDescriptionSourceEl.style.display = 'block';
      toolParametersSourceEl.textContent = 'Source: MCP Server (dynamic). Local content is fallback.';
      toolParametersSourceEl.style.display = 'block';
      // IMPORTANT: Do not set readOnly here. Fields remain editable for fallback.
    } else {
      toolEndpointUrlEl.disabled = false;
      toolHttpMethodEl.disabled = false;
      toolDescriptionEl.removeAttribute('dataset.source');
      toolParametersEl.removeAttribute('dataset.source');
      toolDescriptionEl.classList.remove('mcp-sourced');
      toolParametersEl.classList.remove('mcp-sourced');
      toolDescriptionSourceEl.style.display = 'none';
      toolParametersSourceEl.style.display = 'none';
      // Ensure fields are editable if MCP URL is removed
      toolDescriptionEl.readOnly = false;
      toolParametersEl.readOnly = false;
      toolDescriptionEl.classList.remove('read-only-mcp');
      toolParametersEl.classList.remove('read-only-mcp');
    }

    if (endpointUrl) {
      toolMcpServerUrlEl.disabled = true;
    } else if (!mcpUrl) { // Only enable mcpUrl if endpointUrl is also empty (and mcpUrl itself was empty before this check)
      toolMcpServerUrlEl.disabled = false;
    }
    // If mcpUrl is filled, endpointUrl related fields are disabled.
    // If endpointUrl is filled, mcpUrl field is disabled.
    // If both are empty, all are enabled.
  }

  if (toolMcpServerUrlEl && toolEndpointUrlEl) { // Ensure elements exist before adding listeners
    toolMcpServerUrlEl.addEventListener('input', updateToolFieldStates);
    toolEndpointUrlEl.addEventListener('input', updateToolFieldStates);
  }

  // Load and display tools
  function loadTools() {
    chrome.storage.local.get(['promptPaulTools'], (result) => {
      const tools = result.promptPaulTools || [];
      const tableBody = document.querySelector('#toolsTable tbody');
      tableBody.innerHTML = '';

      tools.forEach(tool => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${tool.name}</td>
          <td>${tool.description}</td>
          <td>${tool.mcpServerUrl || ''}</td>
          <td>
            <button class="edit-tool-btn" data-id="${tool.id}">Edit</button>
            <button class="delete-tool-btn" data-id="${tool.id}">Delete</button>
          </td>
        `;
        tableBody.appendChild(row);
      });

      // Add edit/delete handlers
      document.querySelectorAll('.edit-tool-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const toolId = e.target.dataset.id;
          chrome.storage.local.get(['promptPaulTools'], (result) => {
            const tools = result.promptPaulTools || [];
            const tool = tools.find(t => t.id === toolId);
            if (tool) {
              document.getElementById('toolName').value = tool.name;
              document.getElementById('toolDescription').value = tool.description;
              document.getElementById('toolParameters').value = tool.parameters || '';
              document.getElementById('toolEndpointUrl').value = tool.endpointUrl || '';
              document.getElementById('toolHttpMethod').value = tool.httpMethod || '';
              // toolMcpId is removed, so no need to load it into a field.
              document.getElementById('toolMcpServerUrl').value = tool.mcpServerUrl || '';
              document.getElementById('toolId').value = tool.id;
              updateToolFieldStates(); // Update field states when a tool is loaded for editing
            }
          });
        });
      });

      document.querySelectorAll('.delete-tool-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const toolId = e.target.dataset.id;
          if (confirm('Are you sure you want to delete this tool?')) {
            chrome.storage.local.get(['promptPaulTools'], (result) => {
              let tools = result.promptPaulTools || [];
              tools = tools.filter(t => t.id !== toolId);
              chrome.storage.local.set({ promptPaulTools: tools }, () => {
                showStatus('Tool deleted!');
                loadTools(); // Reload the table
                populateToolDropdown(); // Update tool dropdown
                // Clear the form if the deleted tool was being edited
                if (document.getElementById('toolId').value === toolId) {
                  clearToolForm();
                }
              });
            });
          }
        });
      });
    });
  }

  // Save tool handler
  if (saveToolBtn) {
    saveToolBtn.addEventListener('click', () => {
      loadingManager.setButtonLoading(saveToolBtn, true);
      const toolName = document.getElementById('toolName').value.trim();
      const toolDescription = document.getElementById('toolDescription').value.trim();
      const toolParameters = document.getElementById('toolParameters').value.trim();
      const toolEndpointUrl = document.getElementById('toolEndpointUrl').value.trim();
      const toolHttpMethod = document.getElementById('toolHttpMethod').value;
      let toolMcpServerUrl = document.getElementById('toolMcpServerUrl').value.trim();
      const toolId = document.getElementById('toolId').value;

      if (!toolName || !toolDescription) {
        showStatus('Tool name and description are required.', true);
        return;
      }


      if (toolParameters && !isValidJson(toolParameters)) {
        showStatus('Parameters must be valid JSON.', true);
        return;
      }

      chrome.storage.local.get(['promptPaulTools'], (result) => {
        let tools = result.promptPaulTools || [];
        const now = new Date().toISOString();

        if (toolId) {
          // Update existing tool
          tools = tools.map(tool => {
            if (tool.id === toolId) {
              return {
                ...tool,
                name: toolName,
                description: toolDescription,
                parameters: toolParameters,
                endpointUrl: toolEndpointUrl,
                httpMethod: toolHttpMethod,
                mcpServerUrl: toolMcpServerUrl,
                lastUpdated: now
              };
            }
            return tool;
          });
          showStatus('Tool updated!');
        } else {
          // Add new tool
          const newTool = {
            id: 'tool_' + Date.now(), // Simple unique ID
            name: toolName,
            description: toolDescription,
            parameters: toolParameters,
            endpointUrl: toolEndpointUrl,
            httpMethod: toolHttpMethod,
            mcpServerUrl: toolMcpServerUrl,
            createdAt: now,
            lastUpdated: now
          };
          tools.push(newTool);
          showStatus('Tool added!');
        }

        chrome.storage.local.set({ promptPaulTools: tools }, () => {
          loadTools(); // Reload the table
          populateToolDropdown(); // Update tool dropdown
          clearToolForm(); // Clear the form after saving
          loadingManager.setButtonLoading(saveToolBtn, false);
        });
      });
    });
  }

  // Clear tool form handler
  if (clearToolFormBtn) {
    clearToolFormBtn.addEventListener('click', clearToolForm);
  }

  function clearToolForm() {
    document.getElementById('toolName').value = '';
    document.getElementById('toolDescription').value = '';
    document.getElementById('toolParameters').value = '';
    document.getElementById('toolEndpointUrl').value = '';
    document.getElementById('toolHttpMethod').value = '';
    // toolMcpId is removed, so no need to clear its field.
    document.getElementById('toolMcpServerUrl').value = '';
    document.getElementById('toolId').value = '';
    updateToolFieldStates(); // Reset field states when form is cleared
    showStatus('Tool form cleared.');
    // Ensure fields are reset to be editable and styling removed
    document.getElementById('toolDescription').readOnly = false;
    document.getElementById('toolParameters').readOnly = false;
    document.getElementById('toolDescription').classList.remove('read-only-mcp');
    document.getElementById('toolParameters').classList.remove('read-only-mcp');
    document.getElementById('toolDescriptionSource').style.display = 'none';
    document.getElementById('toolParametersSource').style.display = 'none';
  }

  // Export tools handler
  document.getElementById('exportTools').addEventListener('click', () => {
    chrome.storage.local.get(['promptPaulTools'], (result) => {
      const tools = result.promptPaulTools || [];
      const exportData = {
        version: 1, // Versioning for future compatibility
        tools: tools
      };
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "prompt_paul_tools.json");
      document.body.appendChild(downloadAnchorNode); // Required for Firefox
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    });
  });

  // Import tools handler
  document.getElementById('importTools').addEventListener('click', () => {
    document.getElementById('importToolsFile').click(); // Trigger the hidden file input
  });

  document.getElementById('importToolsFile').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        if (importData.version === 1 && Array.isArray(importData.tools)) {
          // Simple merge strategy: add new tools, update existing by ID
          chrome.storage.local.get(['promptPaulTools'], (result) => {
            let existingTools = result.promptPaulTools || [];
            const importedTools = importData.tools;

            importedTools.forEach(importedTool => {
              const existingIndex = existingTools.findIndex(tool => tool.id === importedTool.id);
              if (existingIndex > -1) {
                // Update existing tool
                existingTools[existingIndex] = { ...existingTools[existingIndex], ...importedTool, lastUpdated: new Date().toISOString() };
              } else {
                // Add new tool
                existingTools.push({ ...importedTool, id: importedTool.id || 'tool_' + Date.now(), createdAt: importedTool.createdAt || new Date().toISOString(), lastUpdated: new Date().toISOString() });
              }
            });

            chrome.storage.local.set({ promptPaulTools: existingTools }, () => {
              showStatus('Tools imported successfully!');
              loadTools(); // Reload the table
              populateToolDropdown(); // Update tool dropdown
            });
          });
        } else {
          showStatus('Invalid import file format.', true);
        }
      } catch (error) {
        console.error('Error importing tools:', error);
        showStatus('Error reading or parsing import file.', true);
      }
    };
    reader.readAsText(file);
  });

  // Initial load of tools
  loadTools();

  if (fetchMcpToolInfoBtn) {
    fetchMcpToolInfoBtn.addEventListener('click', async () => { // Made async
      const toolMcpServerUrl = toolMcpServerUrlEl.value.trim();
      const toolNameValue = document.getElementById('toolName').value.trim();

      if (!toolMcpServerUrl) {
        showStatus("Please enter an MCP Server URL first.", true);
        return;
      }
      if (!toolNameValue) {
        showStatus("Please enter a Tool Name to fetch its details.", true);
        return;
      }

      console.log(`Fetching tool info for "${toolNameValue}" from: ${toolMcpServerUrl}`);

      // TODO: Implement actual MCP client logic here to fetch tool information.
      // This would involve:
      // 1. Constructing the correct MCP API endpoint (e.g., `${toolMcpServerUrl}/tools/${toolNameFromForm}` or query `${toolMcpServerUrl}/tools`).
      //    The exact endpoint depends on the MCP specification for fetching a single tool's definition.
      // 2. Making an HTTP GET request using `fetch()` with appropriate MCP headers (e.g., 'MCP-Protocol-Version', 'Accept: application/json').
      // 3. Handling the response:
      //    - Check for HTTP errors (response.ok).
      //    - Parse the JSON response.
      //    - Validate if the response conforms to the MCP Tool schema.
      //    - Extract `description` and `inputSchema`.
      // 4. If successful, populate the form fields as done in the mock below.
      // 5. If an error occurs (network, HTTP error, invalid response), show an appropriate status message
      //    and ensure fields are reset to their editable state (as in the 'else' block below).
      // The current implementation uses a mock fetch for demonstration and UI testing.

      // --- Start of actual fetch logic using chrome.runtime.sendMessage ---
      showStatus("Fetching tool information from MCP server...", false, true);
      // Reset fields to editable and remove MCP styling initially
      const toolDescriptionEl = document.getElementById('toolDescription');
      const toolParametersEl = document.getElementById('toolParameters');
      const toolDescriptionSourceEl = document.getElementById('toolDescriptionSource');
      const toolParametersSourceEl = document.getElementById('toolParametersSource');

      toolDescriptionEl.readOnly = false;
      toolParametersEl.readOnly = false;
      toolDescriptionEl.classList.remove('read-only-mcp');
      toolParametersEl.classList.remove('read-only-mcp');
      toolDescriptionSourceEl.style.display = 'none';
      toolParametersSourceEl.style.display = 'none';

      chrome.runtime.sendMessage(
        {
          action: 'fetchMcpToolDetailsFromServer',
          mcpServerUrl: toolMcpServerUrl,
          toolName: toolNameValue
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('Options: Error sending fetchMcpToolDetailsFromServer message:', chrome.runtime.lastError.message);
            showStatus(`Error fetching tool details: ${chrome.runtime.lastError.message}`, true);
            toolDescriptionSourceEl.textContent = 'Source: Local fallback (Error sending message to background).';
            toolParametersSourceEl.textContent = 'Source: Local fallback (Error sending message to background).';
            toolDescriptionSourceEl.style.display = 'block';
            toolParametersSourceEl.style.display = 'block';
            return;
          }

          if (response && response.success && response.toolSchema) {
            const { description, inputSchema, name: mcpToolName } = response.toolSchema;

            // Log the original name from the user and the name from the MCP server
            console.log(`Options: Fetched MCP tool. User-provided name: "${toolNameValue}", Name from MCP server: "${mcpToolName}".`);

            // It's generally better to trust the schema's name if it exists and differs,
            // but for this UI, the "Tool Name" field is the local alias and primary identifier.
            // We will populate description and parameters from the schema.
            // If `mcpToolName` (from schema) is different from `toolNameValue` (from form),
            // it's worth noting, but we don't change `toolNameValue` here as it's the key for storage.

            toolDescriptionEl.value = description || '';
            toolParametersEl.value = inputSchema ? JSON.stringify(inputSchema, null, 2) : '{}';

            // Make fields read-only and style them as MCP-sourced
            toolDescriptionEl.readOnly = true;
            toolParametersEl.readOnly = true;
            toolDescriptionEl.classList.add('read-only-mcp');
            toolParametersEl.classList.add('read-only-mcp');
            toolDescriptionSourceEl.textContent = `Source: MCP Server (${mcpToolName}). Overrides local content.`;
            toolParametersSourceEl.textContent = `Source: MCP Server (${mcpToolName}). Overrides local content.`;
            toolDescriptionSourceEl.style.display = 'block';
            toolParametersSourceEl.style.display = 'block';
            showStatus(`Tool details for '${mcpToolName}' fetched and populated successfully!`, false, true);
          } else {
            const errorMsg = response ? response.error : "Unknown error or no response from background script.";
            console.error('Options: Failed to fetch MCP tool details. Response:', response);
            showStatus(`Failed to fetch tool details: ${errorMsg}`, true);
            toolDescriptionSourceEl.textContent = `Source: Local fallback (Fetch failed: ${errorMsg})`;
            toolParametersSourceEl.textContent = `Source: Local fallback (Fetch failed: ${errorMsg})`;
            toolDescriptionSourceEl.style.display = 'block';
            toolParametersSourceEl.style.display = 'block';
          }
        }
      );
      // --- End of actual fetch logic ---
    });
  }
}
