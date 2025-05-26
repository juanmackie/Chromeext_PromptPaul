// Function to show status message
function showStatus(message, isError = false, isToast = false) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${isError ? 'error' : 'success'}`;
  status.style.display = 'block';

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

let previousProfileIdBeforeAdd = 'default'; // Variable to store the profile ID before opening the add new form

/**
 * Enables or disables the main settings form elements and action buttons.
 * This is used to prevent interactions with the main form while the
 * "Add New Profile" inline form is active.
 * @param {boolean} disabled - True to disable the main form, false to enable it.
 */
function toggleMainFormDisabled(disabled) {
  const formElements = document.getElementById('optionsForm').elements;
  for (let i = 0; i < formElements.length; i++) {
    // Don't disable the profileSelect dropdown itself, or elements within addNewProfileSection
    if (formElements[i].id !== 'profileSelect' && !formElements[i].closest('#addNewProfileSection')) {
      formElements[i].disabled = disabled;
    }
  }
  // Specifically target buttons that are not part of the form elements collection (like type="button")
  document.getElementById('save').disabled = disabled;
  document.getElementById('deleteProfileButton').disabled = disabled;
  document.getElementById('revertDefaultsButton').disabled = disabled; // If you want to disable this too
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
            document.getElementById('toolId').value = tool.id;
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

// Add event listeners
document.addEventListener('DOMContentLoaded', () => {
  loadOptions(); // This will now also populate profiles and set up listener
  checkAndPromptInstructionMigration();
  setupInstructionHandlers();
  setupToolHandlers(); // Add call to setup tool handlers

  // --- cURL Tool Creation ---
  const curlCommandTextarea = document.getElementById('curlCommand');
  const createToolFromCurlButton = document.getElementById('createToolFromCurlButton');
  const curlFeedbackDiv = document.getElementById('curlFeedback');

  if (createToolFromCurlButton) {
    createToolFromCurlButton.addEventListener('click', () => {
      const curlCommand = curlCommandTextarea.value.trim();
      if (!curlCommand) {
        curlFeedbackDiv.textContent = 'Please paste a cURL command.';
        curlFeedbackDiv.style.color = 'red';
        return;
      }

      curlFeedbackDiv.textContent = 'Creating tool...';
      curlFeedbackDiv.style.color = 'orange';

      chrome.runtime.sendMessage({
        type: 'createToolFromCurl',
        curl: curlCommand
      }, (response) => {
        if (response.success) {
          curlFeedbackDiv.textContent = 'Tool created successfully!';
          curlFeedbackDiv.style.color = 'green';
          curlCommandTextarea.value = ''; // Clear the input field
          loadTools(); // Reload the tools list to show the new tool
        } else {
          curlFeedbackDiv.textContent = `Error: ${response.error}`;
          curlFeedbackDiv.style.color = 'red';
        }
      });
    });
  }
  // --- End cURL Tool Creation ---


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
  const deleteProfileButton = document.getElementById('deleteProfileButton');
  const addNewProfileSection = document.getElementById('addNewProfileSection');
  const newProfileNameInput = document.getElementById('newProfileName');
  const saveNewProfileButton = document.getElementById('saveNewProfileButton');
  const cancelNewProfileButton = document.getElementById('cancelNewProfileButton');

  if (profileSelectElement) {
    /**
     * Event listener for the profile selection dropdown.
     * Handles loading settings for the selected profile.
     * If the "+ Add New Profile..." option is selected, it reveals an inline form
     * for creating a new profile and disables the main settings form to prevent
     * concurrent operations.
     */
    profileSelectElement.addEventListener('change', (event) => {
      const selectedProfileId = event.target.value;
      console.log(`[DEBUG] profileSelect change: Selected profile ID: ${selectedProfileId}`);
      if (selectedProfileId === 'add_new_profile') {
        // Store current selection before showing the add new form
        // Find the actual last selected profile ID, not 'add_new_profile' itself
        const options = Array.from(profileSelectElement.options);
        const currentlySelectedOption = options.find(opt => opt.selected && opt.value !== 'add_new_profile');
        if(currentlySelectedOption) {
             previousProfileIdBeforeAdd = currentlySelectedOption.value;
        } else {
             // Fallback if somehow no other option was selected (e.g. on initial load if default wasn't set right)
            chrome.storage.local.get(['lastSelectedProfileId'], (res) => {
                previousProfileIdBeforeAdd = res.lastSelectedProfileId || 'default';
            });
        }
        
        addNewProfileSection.style.display = 'block';
        newProfileNameInput.value = ''; // Clear the input
        newProfileNameInput.focus();
        toggleMainFormDisabled(true); // Disable main form
      } else {
        addNewProfileSection.style.display = 'none'; // Hide if user selects a regular profile
        toggleMainFormDisabled(false); // Ensure main form is enabled
        chrome.storage.local.set({ lastSelectedProfileId: selectedProfileId });
        loadProfileSettings(selectedProfileId);
      }
    });
  }

  if (saveNewProfileButton) {
    /**
     * Event listener for the "Save New Profile" button in the inline form.
     * Validates the new profile name, checks for duplicates, and then creates
     * a new profile object using the settings currently displayed in the main form.
     * Saves the new profile to storage, updates the profile dropdown,
     * hides the inline form, and re-enables the main settings form.
     */
    saveNewProfileButton.addEventListener('click', () => {
      const newProfileNameValue = newProfileNameInput.value.trim();
      if (!newProfileNameValue) {
        showStatus('Profile name cannot be empty.', true);
        return;
      }

      chrome.storage.local.get(['profiles'], (result) => {
        let profiles = result.profiles || [];
        // Check if profile name already exists
        if (profiles.some(p => p.name.toLowerCase() === newProfileNameValue.toLowerCase())) {
            showStatus(`A profile named "${newProfileNameValue}" already exists. Please choose a different name.`, true);
            return;
        }

        const newProfileId = 'profile_' + Date.now();
        const newProfile = {
          id: newProfileId,
          name: newProfileNameValue,
          llmEndpoint: document.getElementById('llmEndpoint').value.trim(),
          apiKey: document.getElementById('apiKey').value.trim(),
          modelName: document.getElementById('modelName').value.trim(),
          maxTokens: document.getElementById('maxTokens').value.trim() || 2048,
          systemPrompt: document.getElementById('systemPrompt').value.trim(),
          lastUpdated: new Date().toLocaleString()
        };
        profiles.push(newProfile);
        chrome.storage.local.set({ profiles: profiles, lastSelectedProfileId: newProfileId }, () => {
          // Repopulate dropdown, then select the new profile
          // The populateProfileDropdown function is defined within loadOptions,
          // so we call loadOptions which will internally call populate and then loadProfileSettings.
          loadOptions(); // This will repopulate and select the new profile due to lastSelectedProfileId being set
          
          addNewProfileSection.style.display = 'none';
          toggleMainFormDisabled(false);
          showStatus(`Profile "${newProfile.name}" created successfully. Settings copied from previously selected profile.`, false, true);
          // Explicitly set the profileSelect value after loadOptions finishes,
          // as loadOptions might set it based on the stored lastSelectedProfileId which is now newProfileId.
          // We need to ensure the new profile is selected in the dropdown.
           setTimeout(() => { // Ensure loadOptions has completed DOM updates
            profileSelectElement.value = newProfileId;
            loadProfileSettings(newProfileId); // Ensure form shows the new profile's settings
          }, 100); // Small delay to allow DOM updates by loadOptions
        });
      });
    });
  }

  if (cancelNewProfileButton) {
    /**
     * Event listener for the "Cancel" button in the "Add New Profile" inline form.
     * Hides the inline form, re-enables the main settings form, and restores
     * the profile selection dropdown to its state before the inline form was opened.
     */
    cancelNewProfileButton.addEventListener('click', () => {
      addNewProfileSection.style.display = 'none';
      toggleMainFormDisabled(false);
      // Revert dropdown to the profile selected before clicking "Add New Profile..."
      profileSelectElement.value = previousProfileIdBeforeAdd;
      // Trigger change to load the settings of the reverted profile
      if (previousProfileIdBeforeAdd !== 'add_new_profile') {
          loadProfileSettings(previousProfileIdBeforeAdd);
      } else {
          loadProfileSettings('default'); // Fallback if something went wrong
      }
    });
  }

  if (deleteProfileButton) {
    /**
     * Event listener for the "Delete Selected Profile" button.
     * Prevents deletion of the 'default' profile.
     * Prompts the user for confirmation before deleting any other profile.
     * Upon confirmation, removes the profile from storage, sets the active
     * profile to 'default', and refreshes the options UI.
     */
    deleteProfileButton.addEventListener('click', () => {
      const selectedProfileId = profileSelectElement.value;
      const selectedProfileName = profileSelectElement.options[profileSelectElement.selectedIndex].text;

      if (selectedProfileId === 'default') {
        showStatus('The Default profile cannot be deleted.', true);
        return;
      }

      if (selectedProfileId === 'add_new_profile') {
        showStatus('No profile selected to delete.', true);
        return;
      }

      if (confirm(`Are you sure you want to delete the profile: "${selectedProfileName}"?`)) {
        chrome.storage.local.get(['profiles'], (result) => {
          let profiles = result.profiles || [];
          const updatedProfiles = profiles.filter(profile => profile.id !== selectedProfileId);
          
          chrome.storage.local.set({ profiles: updatedProfiles, lastSelectedProfileId: 'default' }, () => {
            if (chrome.runtime.lastError) {
              console.error('Options: Error deleting profile:', chrome.runtime.lastError);
              showStatus('Error deleting profile: ' + chrome.runtime.lastError.message, true);
            } else {
              showStatus(`Profile "${selectedProfileName}" deleted successfully.`);
              loadOptions(); // Reload options to refresh dropdown and form
            }
          });
        });
      }
    });
  }
});

// --- Dark Theme Toggle Logic ---
document.addEventListener('DOMContentLoaded', () => {
  const darkThemeToggle = document.getElementById('darkThemeToggle');
  function applyDarkTheme(isDark) {
    if (isDark) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }
  // Load darkTheme from storage and set toggle/class
  chrome.storage.sync.get({ darkTheme: false }, (result) => {
    if (darkThemeToggle) {
      darkThemeToggle.checked = !!result.darkTheme;
    }
    applyDarkTheme(!!result.darkTheme);
  });
  // Toggle event: update storage and class
  if (darkThemeToggle) {
    darkThemeToggle.addEventListener('change', (e) => {
      const isDark = darkThemeToggle.checked;
      chrome.storage.sync.set({ darkTheme: isDark });
      applyDarkTheme(isDark);
    });
  }
  // Listen for storage changes to sync theme
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.darkTheme) {
      const isDark = changes.darkTheme.newValue;
      if (darkThemeToggle) darkThemeToggle.checked = !!isDark;
      applyDarkTheme(!!isDark);
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
          <td>
            <button class="edit-btn" data-id="${instruction.id}">Edit</button>
            <button class="improve-btn" data-id="${instruction.id}">Improve</button> <!-- Keep improve button -->
            <button class="delete-btn" data-id="${instruction.id}">Delete</button>
          </td>
        `;
        tableBody.appendChild(row);
      });

      // Add edit/delete handlers
      document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const instructionId = e.target.dataset.id;
          const instruction = instructions.find(i => i.id === instructionId);
          if (instruction) {
            document.getElementById('instructionName').value = instruction.name;
            document.getElementById('instructionContent').value = instruction.content;
            document.getElementById('instructionId').value = instruction.id;

            // Set the tool_choice dropdown (multi-select)
            const toolChoiceSelect = document.getElementById('instructionToolChoice');
            if (toolChoiceSelect) {
              // Clear previous selections
              Array.from(toolChoiceSelect.options).forEach(option => {
                option.selected = false;
              });

              // Select the appropriate options based on instruction.tool_choice
              if (Array.isArray(instruction.tool_choice)) {
                instruction.tool_choice.forEach(choice => {
                  const option = toolChoiceSelect.querySelector(`option[value="${choice}"]`);
                  if (option) {
                    option.selected = true;
                  }
                });
              } else if (instruction.tool_choice) { // Handle older string format
                 const option = toolChoiceSelect.querySelector(`option[value="${instruction.tool_choice}"]`);
                 if (option) {
                   option.selected = true;
                 }
              } else {
                 // Default to 'none' if tool_choice is not set
                 const noneOption = toolChoiceSelect.querySelector('option[value="none"]');
                 if (noneOption) {
                   noneOption.selected = true;
                 }
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
      const toolChoiceSelect = document.getElementById('instructionToolChoice');
      const selectedToolChoices = Array.from(toolChoiceSelect.selectedOptions).map(option => option.value);

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
                tool_choice: selectedToolChoices, // Save as array
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
            tool_choice: selectedToolChoices, // Save as array
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
    const toolChoiceSelect = document.getElementById('instructionToolChoice');
    if (toolChoiceSelect) {
      // Clear selected options and set to 'none'
      Array.from(toolChoiceSelect.options).forEach(option => {
        option.selected = false;
      });
      const noneOption = toolChoiceSelect.querySelector('option[value="none"]');
      if (noneOption) {
        noneOption.selected = true;
      }
    }
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
              document.getElementById('toolId').value = tool.id;
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
      const toolName = document.getElementById('toolName').value.trim();
      const toolDescription = document.getElementById('toolDescription').value.trim();
      const toolParameters = document.getElementById('toolParameters').value.trim();
      const toolEndpointUrl = document.getElementById('toolEndpointUrl').value.trim();
      const toolHttpMethod = document.getElementById('toolHttpMethod').value;
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
    document.getElementById('toolId').value = '';
    showStatus('Tool form cleared.');
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
}
