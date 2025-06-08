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

// --- Dark Theme Apply Function (moved to global scope) ---
function applyDarkTheme(isDark) {
  if (isDark) {
    document.body.classList.add('dark-theme');
    if (document.getElementById('darkThemeIcon')) {
      document.getElementById('darkThemeIcon').textContent = 'wb_sunny';
    }
  } else {
    document.body.classList.remove('dark-theme');
    if (document.getElementById('darkThemeIcon')) {
      document.getElementById('darkThemeIcon').textContent = 'brightness_2';
    }
  }
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
  const selectedProfileId = profileSelectElement.value;

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

  const saveButton = document.getElementById('save');
  saveButton.disabled = true;

  chrome.storage.local.get(['profiles'], (result) => {
    let profiles = result.profiles || [];
    let profileToUpdate = profiles.find(p => p.id === selectedProfileId);

    if (!profileToUpdate) {
      profileToUpdate = {
        id: selectedProfileId,
        name: selectedProfileId === 'default' ? 'Default' : 'New Profile ' + Date.now(),
        llmEndpoint: llmEndpointValue,
        apiKey: apiKeyValue,
        modelName: modelNameValue,
        maxTokens: maxTokensValue || 2048,
        systemPrompt: systemPromptValue,
        lastUpdated: new Date().toLocaleString()
      };
      profiles.push(profileToUpdate);
    } else {
      profileToUpdate.llmEndpoint = llmEndpointValue;
      profileToUpdate.apiKey = apiKeyValue;
      profileToUpdate.modelName = modelNameValue;
      profileToUpdate.maxTokens = maxTokensValue || 2048;
      profileToUpdate.systemPrompt = systemPromptValue;
      profileToUpdate.lastUpdated = new Date().toLocaleString();
    }

    chrome.storage.local.set({ profiles: profiles, lastSelectedProfileId: selectedProfileId }, () => {
      if (chrome.runtime.lastError) {
        console.error('Options: Error saving profile settings to local storage:', chrome.runtime.lastError);
        showStatus('Error saving profile settings: ' + chrome.runtime.lastError.message, true);
      } else {
        showStatus(`Settings for profile '${profileToUpdate.name}' saved!`);
        loadOptions();
      }
      saveButton.disabled = false;
    });
  });
}

function loadProfileSettings(profileId) {
  chrome.storage.local.get(['profiles'], (result) => {
    const profiles = result.profiles || [];
    const selectedProfile = profiles.find(p => p.id === profileId) || profiles.find(p => p.id === 'default');

    if (selectedProfile) {
      document.getElementById('llmEndpoint').value = selectedProfile.llmEndpoint || '';
      document.getElementById('apiKey').value = selectedProfile.apiKey || '';
      document.getElementById('modelName').value = selectedProfile.modelName || '';
      document.getElementById('maxTokens').value = selectedProfile.maxTokens || 2048;
      document.getElementById('systemPrompt').value = selectedProfile.systemPrompt || '';
      updateCurrentConfig(
        selectedProfile.llmEndpoint,
        selectedProfile.apiKey,
        selectedProfile.modelName,
        selectedProfile.lastUpdated || 'Not set',
        selectedProfile.systemPrompt,
        selectedProfile.name
      );
    } else {
      console.warn(`Options: Profile with ID '${profileId}' (or default) not found. This may indicate an issue if 'default' profile was expected.`);
      document.getElementById('llmEndpoint').value = 'https://api.mistral.ai/v1/chat/completions';
      document.getElementById('apiKey').value = '';
      document.getElementById('modelName').value = 'mistral-small-latest';
      document.getElementById('maxTokens').value = 2048;
      document.getElementById('systemPrompt').value = '';
      updateCurrentConfig('Not set', 'Not set', 'Not set', 'Not set', 'Not set', 'Error: Profile not found');
      showStatus(`Profile '${profileId}' not found. Displaying application defaults. Please save settings to create or restore a profile.`, true);
    }
  });
}

function loadOptions() {
  const profileSelectElement = document.getElementById('profileSelect');

  function populateProfileDropdown(profiles, selectedProfileId) {
    profileSelectElement.innerHTML = '';
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
        if (profile.id === 'default') return;
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        profileSelectElement.appendChild(option);
      });
    }
    profileSelectElement.value = selectedProfileId || 'default';
  }

  chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
    let profiles = result.profiles || [];
    const lastSelectedProfileId = result.lastSelectedProfileId || 'default';

    let defaultProfileExists = profiles.some(p => p.id === 'default');
    if (!defaultProfileExists) {
      const defaultProfileData = {
        id: 'default',
        name: 'Default',
        llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
        apiKey: '',
        modelName: 'mistral-small-latest',
        maxTokens: 2048,
        systemPrompt: 'You are a helpful assistant.',
        lastUpdated: new Date().toLocaleString()
      };
      profiles.push(defaultProfileData);
      chrome.storage.local.set({ profiles: profiles }, () => {
        if (chrome.runtime.lastError) {
          console.error('Options: Error saving newly created default profile:', chrome.runtime.lastError);
        }
        populateProfileDropdown(profiles, lastSelectedProfileId);
        loadProfileSettings(lastSelectedProfileId);
      });
    } else {
      populateProfileDropdown(profiles, lastSelectedProfileId);
      loadProfileSettings(lastSelectedProfileId);
    }
  });
}

// Consolidated DOMContentLoaded listener
document.addEventListener('DOMContentLoaded', () => {
  // --- Initial Setup ---
  loadOptions();
  checkAndPromptInstructionMigration();
  setupInstructionHandlers();
  setupToolHandlers();

  // --- Profile Management Event Listeners ---
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
              loadOptions();
            }
          });
        }
      });
    });
  }

  const revertButton = document.getElementById('revertDefaultsButton');
  if (revertButton) {
    revertButton.addEventListener('click', () => {
      const defaultEndpoint = 'https://api.mistral.ai/v1/chat/completions';
      const defaultApiKey = '';
      const defaultModelName = 'mistral-small-latest';
      const defaultMaxTokens = 2048;
      const defaultSystemPrompt = 'You are a helpful assistant.';

      document.getElementById('llmEndpoint').value = defaultEndpoint;
      document.getElementById('apiKey').value = defaultApiKey;
      document.getElementById('modelName').value = defaultModelName;
      document.getElementById('maxTokens').value = defaultMaxTokens;
      document.getElementById('systemPrompt').value = defaultSystemPrompt;

      showStatus('Settings reverted to application defaults. Click "Save Settings" to apply to the current profile.', false, true);
    });
  }

  const profileSelectElement = document.getElementById('profileSelect');
  if (profileSelectElement) {
    profileSelectElement.addEventListener('change', (event) => {
      const selectedProfileId = event.target.value;
      if (selectedProfileId === 'add_new_profile') {
        const newProfileName = prompt('Enter a name for the new profile (e.g., "My OpenAI GPT-4"):');
        if (newProfileName && newProfileName.trim() !== '') {
          chrome.storage.local.get(['profiles'], (result) => {
            let profiles = result.profiles || [];
            const currentEndpoint = document.getElementById('llmEndpoint').value.trim();
            const currentApiKey = document.getElementById('apiKey').value.trim();
            const currentModelName = document.getElementById('modelName').value.trim();
            const currentMaxTokens = document.getElementById('maxTokens').value.trim();
            const currentSystemPrompt = document.getElementById('systemPrompt').value.trim();

            const newProfileId = 'profile_' + Date.now();
            const newProfile = {
              id: newProfileId,
              name: newProfileName.trim(),
              llmEndpoint: currentEndpoint || 'https://api.mistral.ai/v1/chat/completions',
              apiKey: currentApiKey || '',
              modelName: currentModelName || 'mistral-small-latest',
              maxTokens: currentMaxTokens || 2048,
              systemPrompt: currentSystemPrompt || 'You are a helpful assistant.',
              lastUpdated: new Date().toLocaleString()
            };
            profiles.push(newProfile);
            chrome.storage.local.set({ profiles: profiles, lastSelectedProfileId: newProfileId }, () => {
              loadOptions();
              setTimeout(() => {
                  const selectAfterLoad = document.getElementById('profileSelect');
                  if(selectAfterLoad) {
                     selectAfterLoad.value = newProfileId;
                  }
                  loadProfileSettings(newProfileId);
                  showStatus(`Profile "${newProfile.name}" created. Review and save settings if needed.`, false, true);
              }, 0);
            });
          });
        } else {
          chrome.storage.local.get(['lastSelectedProfileId'], (res) => {
            if (profileSelectElement) {
              profileSelectElement.value = res.lastSelectedProfileId || 'default';
            }
          });
        }
      } else {
        chrome.storage.local.set({ lastSelectedProfileId: selectedProfileId }, () => {
            loadProfileSettings(selectedProfileId);
        });
      }
    });
  }

  // --- UI Settings (Streaming & Dark Theme) --- (Moved from the second DOMContentLoaded)
  const enableStreamingToggle = document.getElementById('enableStreamingToggle');
  if (enableStreamingToggle) {
    chrome.storage.sync.get({ enableStreaming: false }, (result) => {
      enableStreamingToggle.checked = !!result.enableStreaming;
    });
    enableStreamingToggle.addEventListener('change', () => {
      const isStreamingEnabled = enableStreamingToggle.checked;
      chrome.storage.sync.set({ enableStreaming: isStreamingEnabled }, () => {
        showStatus(`Streaming responses ${isStreamingEnabled ? 'enabled' : 'disabled'}.`, false, true);
      });
    });
  }

  const darkThemeToggle = document.getElementById('darkThemeToggle');
  // applyDarkTheme is now defined globally
  chrome.storage.sync.get({ darkTheme: false }, (result) => {
    if (darkThemeToggle) {
      darkThemeToggle.checked = !!result.darkTheme;
    }
    applyDarkTheme(!!result.darkTheme);
  });
  if (darkThemeToggle) {
    darkThemeToggle.addEventListener('change', (e) => {
      const isDark = darkThemeToggle.checked;
      chrome.storage.sync.set({ darkTheme: isDark });
      applyDarkTheme(isDark);
    });
  }

  // --- Storage Change Listener (for sync area primarily) --- (Moved from the second DOMContentLoaded)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.darkTheme) {
        const isDark = changes.darkTheme.newValue;
        if (darkThemeToggle) darkThemeToggle.checked = !!isDark;
        applyDarkTheme(!!isDark);
      }
      if (changes.enableStreaming && enableStreamingToggle) {
        enableStreamingToggle.checked = !!changes.enableStreaming.newValue;
      }
    }
  });

  // --- Form Submission --- (Moved from outside to inside DOMContentLoaded)
  const optionsForm = document.getElementById('optionsForm');
  if (optionsForm) {
    optionsForm.addEventListener('submit', saveOptions);
  } else {
    console.error("optionsForm not found!");
  }
});

// Migration logic for instructions from sync to local
function checkAndPromptInstructionMigration() {
  chrome.storage.sync.get(['instructions'], (syncResult) => {
    chrome.storage.local.get(['instructions'], (localResult) => {
      const syncInstructions = syncResult.instructions || [];
      const localInstructions = localResult.instructions || [];
      if (syncInstructions.length > 0 && localInstructions.length === 0) {
        const migrationPrompt = document.getElementById('migrationPrompt');
        migrationPrompt.style.display = 'block';
        document.getElementById('migrateInstructionsBtn').onclick = () => {
          chrome.storage.local.set({ instructions: syncInstructions }, () => {
            chrome.storage.sync.set({ instructions: [] }, () => {
              migrationPrompt.style.display = 'none';
              showStatus('Instructions migrated to this device only!', false, true);
              if (typeof window.setupInstructionHandlers === 'function') {
                document.querySelector('#instructionsTable tbody').innerHTML = '';
                // Check if loadInstructions is globally available or part of an object
                if (typeof loadInstructions === "function" && setupInstructionHandlers.loadInstructions) { // This check might be problematic
                    setupInstructionHandlers.loadInstructions();
                } else if (typeof window.loadInstructions === "function") {
                    window.loadInstructions();
                } else {
                    setupInstructionHandlers(); // Fallback: re-run setup which includes load
                }
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

// --- Tool Dropdown Population ---
async function populateToolDropdown() {
  const toolChoiceSelect = document.getElementById('instructionToolChoice');
  if (!toolChoiceSelect) {
    console.error("instructionToolChoice dropdown not found!");
    return;
  }

  while (toolChoiceSelect.options.length > 2) {
    toolChoiceSelect.remove(toolChoiceSelect.options.length - 1);
  }

  try {
    const result = await new Promise((resolve) => {
      chrome.storage.local.get(['promptPaulTools'], resolve);
    });
    const tools = result.promptPaulTools || [];

    if (tools.length > 0) {
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '------ Tools ------';
        toolChoiceSelect.appendChild(separator);

        tools.forEach(tool => {
          const option = document.createElement('option');
          option.value = tool.name;
          option.textContent = tool.name;
          toolChoiceSelect.appendChild(option);
        });
    }
  } catch (error) {
    console.error("Error loading tools for dropdown:", error);
    showStatus("Error loading tools for dropdown.", true);
  }
}

// Setup instruction management handlers
function setupInstructionHandlers() {
  const saveInstructionBtn = document.getElementById('saveInstruction');
  const clearFormBtn = document.getElementById('clearForm');

  // Helper to attach listeners to a single instruction row's buttons
  function addInstructionActionListeners(row, instruction, instructions) {
    const pinButton = row.querySelector('.pin-btn');
    if (pinButton) {
      pinButton.addEventListener('click', (e) => pinInstructionHandler(e.currentTarget, instruction.id));
    }
    row.querySelector('.edit-btn').addEventListener('click', () => editInstructionHandler(instruction));
    row.querySelector('.delete-btn').addEventListener('click', () => deleteInstructionHandler(instruction.id));
    row.querySelector('.improve-btn').addEventListener('click', () => improveInstructionHandler(instruction));
  }

  function editInstructionHandler(instruction) {
    document.getElementById('instructionName').value = instruction.name;
    document.getElementById('instructionContent').value = instruction.content;
    document.getElementById('instructionId').value = instruction.id;

    const toolChoiceInput = document.getElementById('instructionToolChoice');
    if (toolChoiceInput) {
      if (Array.isArray(instruction.tool_choice)) {
        toolChoiceInput.value = instruction.tool_choice.includes('auto') ? 'auto' :
                                instruction.tool_choice.length > 0 ? instruction.tool_choice[0] : 'none';
      } else if (instruction.tool_choice) {
        toolChoiceInput.value = instruction.tool_choice;
      } else {
        toolChoiceInput.value = 'none';
      }
    }
  }

  function deleteInstructionHandler(instructionId) {
    if (confirm('Are you sure you want to delete this instruction?')) {
      chrome.storage.local.get(['instructions'], (result) => {
        let instructions = result.instructions || [];
        instructions = instructions.filter(i => i.id !== instructionId);
        chrome.storage.local.set({ instructions: instructions }, () => {
          showStatus('Instruction deleted!');
          loadInstructions();
          if (document.getElementById('instructionId').value === instructionId) {
            clearForm();
          }
        });
      });
    }
  }

  function pinInstructionHandler(button, instructionId) {
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
  }

  async function improveInstructionHandler(instruction) {
      showStatus('Improving instruction...', false, true);
      try {
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
          config.llmEndpoint, config.apiKey, config.modelName, instruction.content
        );

        document.getElementById('instructionName').value = instruction.name;
        document.getElementById('instructionContent').value = improvedContent;
        document.getElementById('instructionId').value = instruction.id;
        showStatus('Instruction improved! Review and Save.', false, true);
      } catch (error) {
        console.error('Error improving instruction:', error);
        showStatus('Failed to improve instruction: ' + error.message, true);
      }
  }

  function loadInstructions() {
    chrome.storage.local.get(['instructions', 'pinnedQuickActions'], (result) => {
      const instructions = result.instructions || [];
      const pinnedQuickActions = result.pinnedQuickActions || [];
      const tableBody = document.querySelector('#instructionsTable tbody');
      tableBody.innerHTML = '';

      instructions.forEach(instruction => {
        const row = document.createElement('tr');

        let toolChoiceDisplay = 'None';
        if (instruction.tool_choice) {
          if (Array.isArray(instruction.tool_choice)) {
            if (instruction.tool_choice.length === 0 || instruction.tool_choice.includes('none')) toolChoiceDisplay = 'None';
            else if (instruction.tool_choice.includes('auto')) toolChoiceDisplay = 'Auto';
            else toolChoiceDisplay = instruction.tool_choice.join(', ');
          } else {
            toolChoiceDisplay = instruction.tool_choice.charAt(0).toUpperCase() + instruction.tool_choice.slice(1);
          }
        }

        row.innerHTML = `
          <td>${instruction.name}</td>
          <td>${instruction.content}</td>
          <td>${toolChoiceDisplay}</td>
          <td><button class="pin-btn" data-id="${instruction.id}" title="Toggle Pin">
            <span class="material-symbols-outlined">${pinnedQuickActions.includes(instruction.id) ? 'keep_off' : 'push_pin'}</span>
          </button></td>
          <td>
            <button class="edit-btn" data-id="${instruction.id}">Edit</button>
            <button class="improve-btn" data-id="${instruction.id}">Improve</button>
            <button class="delete-btn" data-id="${instruction.id}">Delete</button>
          </td>
        `;
        tableBody.appendChild(row);

        const pinButton = row.querySelector('.pin-btn');
        if (pinButton) { // Check if button exists before adding listener
            if (pinnedQuickActions.includes(instruction.id)) {
                pinButton.classList.add('pinned');
                pinButton.title = 'Unpin from Quick Actions';
            } else {
                pinButton.title = 'Pin to Quick Actions';
            }
            pinButton.addEventListener('click', (e) => pinInstructionHandler(e.currentTarget, instruction.id));
        }

        row.querySelector('.edit-btn').addEventListener('click', () => editInstructionHandler(instruction));
        row.querySelector('.delete-btn').addEventListener('click', () => deleteInstructionHandler(instruction.id));
        row.querySelector('.improve-btn').addEventListener('click', () => improveInstructionHandler(instruction));
      });
    });
  }

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
          instructions = instructions.map(inst => {
            if (inst.id === instructionId) {
              return {
                ...inst,
                name: instructionName,
                content: instructionContent,
                tool_choice: toolChoiceValue || 'none',
                lastUpdated: now
              };
            }
            return inst;
          });
          showStatus('Instruction updated!');
        } else {
          const newInstruction = {
            id: 'inst_' + Date.now(),
            name: instructionName,
            content: instructionContent,
            tool_choice: toolChoiceValue || 'none',
            createdAt: now,
            lastUpdated: now
          };
          instructions.push(newInstruction);
          showStatus('Instruction added!');
        }

        chrome.storage.local.set({ instructions: instructions }, () => {
          loadInstructions();
          clearForm();
        });
      });
    });
  }

  if (clearFormBtn) {
    clearFormBtn.addEventListener('click', clearForm);
  }

  function clearForm() {
    document.getElementById('instructionName').value = '';
    document.getElementById('instructionContent').value = '';
    document.getElementById('instructionId').value = '';
    document.getElementById('instructionToolChoice').value = 'none';
    showStatus('Form cleared.');
  }

  document.getElementById('exportInstructions').addEventListener('click', () => {
    chrome.storage.local.get(['instructions'], (result) => {
      const instructions = result.instructions || [];
      const exportData = { version: 1, instructions: instructions };
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "prompt_paul_instructions.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    });
  });

  document.getElementById('importInstructions').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        if (importData.version === 1 && Array.isArray(importData.instructions)) {
          chrome.storage.local.get(['instructions'], (result) => {
            let existingInstructions = result.instructions || [];
            const importedInstructions = importData.instructions;
            importedInstructions.forEach(importedInst => {
              const existingIndex = existingInstructions.findIndex(inst => inst.id === importedInst.id);
              if (existingIndex > -1) {
                existingInstructions[existingIndex] = { ...existingInstructions[existingIndex], ...importedInst, lastUpdated: new Date().toISOString() };
              } else {
                existingInstructions.push({ ...importedInst, id: importedInst.id || 'inst_' + Date.now(), createdAt: importedInst.createdAt || new Date().toISOString(), lastUpdated: new Date().toISOString() });
              }
            });
            chrome.storage.local.set({ instructions: existingInstructions }, () => {
              showStatus('Instructions imported successfully!');
              loadInstructions();
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

  loadInstructions();
  populateToolDropdown();
}

async function improvePromptAPI(endpoint, apiKey, modelName, prompt) {
  const messages = [
    { role: 'system', content: 'You are an expert prompt engineer. Improve the following prompt for a large language model to be clearer, more concise, and more effective. Only return the improved prompt text, nothing else.' },
    { role: 'user', content: prompt }
  ];
  const apiResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelName, messages: messages, max_tokens: 1000, temperature: 0.7 }),
  });
  if (!apiResponse.ok) {
    const errorData = await apiResponse.json().catch(() => null);
    throw new Error(`API request failed with status ${apiResponse.status}: ${errorData ? JSON.stringify(errorData) : apiResponse.statusText}`);
  }
  const responseData = await apiResponse.json();
  if (!responseData || !responseData.choices || !responseData.choices[0] || !responseData.choices[0].message || !responseData.choices[0].message.content) {
    throw new Error('Invalid response format from API: Missing message content.');
  }
  return responseData.choices[0].message.content.trim();
}

function isValidJson(str) {
  try { JSON.parse(str); return true; } catch (e) { return false; }
}

function setupToolHandlers() {
  const saveToolBtn = document.getElementById('saveTool');
  const clearToolFormBtn = document.getElementById('clearToolForm');

  function editToolHandler(tool) {
    document.getElementById('toolName').value = tool.name;
    document.getElementById('toolDescription').value = tool.description;
    document.getElementById('toolParameters').value = tool.parameters || '';
    document.getElementById('toolEndpointUrl').value = tool.endpointUrl || '';
    document.getElementById('toolHttpMethod').value = tool.httpMethod || 'GET';
    document.getElementById('toolId').value = tool.id;
  }

  function deleteToolHandler(toolId) {
    if (confirm('Are you sure you want to delete this tool?')) {
      chrome.storage.local.get(['promptPaulTools'], (result) => {
        let tools = result.promptPaulTools || [];
        tools = tools.filter(t => t.id !== toolId);
        chrome.storage.local.set({ promptPaulTools: tools }, () => {
          showStatus('Tool deleted!');
          loadTools();
          populateToolDropdown();
          if (document.getElementById('toolId').value === toolId) {
            clearToolForm();
          }
        });
      });
    }
  }

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
        row.querySelector('.edit-tool-btn').addEventListener('click', () => editToolHandler(tool));
        row.querySelector('.delete-tool-btn').addEventListener('click', () => deleteToolHandler(tool.id));
      });
    });
  }

  if (saveToolBtn) {
    saveToolBtn.addEventListener('click', () => {
      const toolName = document.getElementById('toolName').value.trim();
      const toolDescription = document.getElementById('toolDescription').value.trim();
      const toolParameters = document.getElementById('toolParameters').value.trim();
      const toolEndpointUrl = document.getElementById('toolEndpointUrl').value.trim();
      const toolHttpMethod = document.getElementById('toolHttpMethod').value;
      const toolId = document.getElementById('toolId').value;

      if (!toolName || !toolDescription) {
        showStatus('Tool name and description are required.', true); return;
      }
      if (toolParameters && !isValidJson(toolParameters)) {
        showStatus('Parameters must be valid JSON.', true); return;
      }

      chrome.storage.local.get(['promptPaulTools'], (result) => {
        let tools = result.promptPaulTools || [];
        const now = new Date().toISOString();
        if (toolId) {
          tools = tools.map(tool => tool.id === toolId ? { ...tool, name: toolName, description: toolDescription, parameters: toolParameters, endpointUrl: toolEndpointUrl, httpMethod: toolHttpMethod, lastUpdated: now } : tool);
          showStatus('Tool updated!');
        } else {
          const newTool = { id: 'tool_' + Date.now(), name: toolName, description: toolDescription, parameters: toolParameters, endpointUrl: toolEndpointUrl, httpMethod: toolHttpMethod, createdAt: now, lastUpdated: now };
          tools.push(newTool);
          showStatus('Tool added!');
        }
        chrome.storage.local.set({ promptPaulTools: tools }, () => {
          loadTools();
          populateToolDropdown();
          clearToolForm();
        });
      });
    });
  }

  if (clearToolFormBtn) {
    clearToolFormBtn.addEventListener('click', clearToolForm);
  }

  function clearToolForm() {
    document.getElementById('toolName').value = '';
    document.getElementById('toolDescription').value = '';
    document.getElementById('toolParameters').value = '';
    document.getElementById('toolEndpointUrl').value = '';
    document.getElementById('toolHttpMethod').value = 'GET'; // Default to GET
    document.getElementById('toolId').value = '';
    showStatus('Tool form cleared.');
  }

  document.getElementById('exportTools').addEventListener('click', () => {
    chrome.storage.local.get(['promptPaulTools'], (result) => {
      const tools = result.promptPaulTools || [];
      const exportData = { version: 1, tools: tools };
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "prompt_paul_tools.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    });
  });

  document.getElementById('importTools').addEventListener('click', () => {
    document.getElementById('importToolsFile').click();
  });

  document.getElementById('importToolsFile').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        if (importData.version === 1 && Array.isArray(importData.tools)) {
          chrome.storage.local.get(['promptPaulTools'], (result) => {
            let existingTools = result.promptPaulTools || [];
            const importedTools = importData.tools;
            importedTools.forEach(importedTool => {
              const existingIndex = existingTools.findIndex(tool => tool.id === importedTool.id);
              if (existingIndex > -1) {
                existingTools[existingIndex] = { ...existingTools[existingIndex], ...importedTool, lastUpdated: new Date().toISOString() };
              } else {
                existingTools.push({ ...importedTool, id: importedTool.id || 'tool_' + Date.now(), createdAt: importedTool.createdAt || new Date().toISOString(), lastUpdated: new Date().toISOString() });
              }
            });
            chrome.storage.local.set({ promptPaulTools: existingTools }, () => {
              showStatus('Tools imported successfully!');
              loadTools();
              populateToolDropdown();
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

  loadTools();
}
