import { loadingManager } from './loadingManager.js';
import { OptionsCoordinator } from './classes/coordinators/OptionsCoordinator.js';
import { setupThemeToggle } from './themeUtils.js';

// Initialize the options coordinator
const optionsCoordinator = new OptionsCoordinator();
// Expose globally so other modules (e.g., importExport.js) can reuse the same instance
// Avoids multiple coordinators managing state concurrently
// eslint-disable-next-line no-undef
window.optionsCoordinator = optionsCoordinator;

// Function to show status message
function showStatus(message, isError = false, isToast = false) {
  // Only use top-right toast notifications
  if (isError) {
    loadingManager.showToast(message, 'error');
  } else {
    loadingManager.showToast(message, 'success');
  }
}

// Load options when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  // Start the options coordinator
  try {
    await optionsCoordinator.start();
    console.log('OptionsCoordinator started successfully');
  } catch (error) {
    console.error('Failed to start OptionsCoordinator:', error);
    showStatus('Failed to initialize options: ' + error.message, true);
  }
  
  // Set up theme toggle
  const darkThemeToggle = document.getElementById('darkThemeToggle');
  if (darkThemeToggle) {
    setupThemeToggle(darkThemeToggle);
  }
  
  // Set up other event listeners
  setupEventListeners();
  
  // Initial load of data
  // The coordinator handles this automatically when started
  
  // Subscribe to view model changes to update UI
  optionsCoordinator.viewModel.subscribe((state) => {
    console.log('ViewModel state changed, updating UI:', state);
    updateUIFromState(state);
  });
  
  // Force initial UI update after a small delay to ensure coordinator is fully started
  setTimeout(() => {
    const initialState = optionsCoordinator.viewModel.getState();
    console.log('Initial state for UI update:', initialState);
    updateUIFromState(initialState);
  }, 100);
});

// Ensure UI renders once templates are injected
// This helps when state was updated before the templates existed.
document.addEventListener('templatesLoaded', () => {
  try {
    const state = optionsCoordinator.viewModel.getState();
    console.log('templatesLoaded: rendering instructions and tools with current state');
    updateUIFromState(state);
  } catch (e) {
    console.error('Failed to render after templatesLoaded', e);
  }
});


// Set up event listeners
function setupEventListeners() {
  // Add event listener for collapsible headers
  document.querySelectorAll('.collapsible-header').forEach(header => {
    header.addEventListener('click', () => {
      const content = header.nextElementSibling;
      content.classList.toggle('expanded');
      header.classList.toggle('expanded');
    });
  });
  
  // Add event listener for the options form
  const optionsForm = document.getElementById('optionsForm');
  if (optionsForm) {
    optionsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // Handle form submission through coordinator
      saveCurrentProfile();
    });
  }
  
  // Add event listener for save config button
  const saveConfigBtn = document.getElementById('saveConfig');
  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', (e) => {
      e.preventDefault();
      saveCurrentProfile();
    });
  }
  
  // Add event listener for profile selection change
  const profileSelectElement = document.getElementById('profileSelect');
  if (profileSelectElement) {
    profileSelectElement.addEventListener('change', (event) => {
      const selectedProfileId = event.target.value;
      console.log(`[DEBUG] profileSelect change: Selected profile ID: ${selectedProfileId}`);
      if (selectedProfileId === 'add_new_profile') {
        const newProfileName = prompt('Enter a name for the new profile (e.g., "My OpenAI GPT-4"):');
        if (newProfileName && newProfileName.trim() !== '') {
          // Handle new profile creation through coordinator
          // Implementation would go here
        } else {
          // User cancelled or entered empty name, revert to last selected
          // Implementation would go here
        }
      } else {
        // Handle profile selection through coordinator
        // Implementation would go here
      }
    });
  }
  
  // Add event listener for the Revert button
  const revertButton = document.getElementById('revertDefaultsButton');
  if (revertButton) {
    revertButton.addEventListener('click', () => {
      // Get default values
      const defaultEndpoint = 'https://api.mistral.ai/v1/chat/completions';
      const defaultApiKey = 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF';
      const defaultModelName = 'mistral-small-latest';

      // Set default values in the input fields
      const llmEndpointEl = document.getElementById('llmEndpoint');
      const apiKeyEl = document.getElementById('apiKey');
      const modelNameEl = document.getElementById('modelName');
      const maxTokensEl = document.getElementById('maxTokens');
      const tokenValueEl = document.getElementById('tokenValue');
      
      if (llmEndpointEl) llmEndpointEl.value = defaultEndpoint;
      if (apiKeyEl) apiKeyEl.value = defaultApiKey;
      if (modelNameEl) modelNameEl.value = defaultModelName;
      if (maxTokensEl) maxTokensEl.value = '16000'; // Default max tokens
      if (tokenValueEl) tokenValueEl.textContent = '16000';
      
      showStatus('Settings reverted to defaults. Click "Save Settings" to apply.', false, true); // Show as a toast
    });
  }
  
  // Add event listener for delete profile button
  const deleteProfileButton = document.getElementById('deleteProfileButton');
  if (deleteProfileButton) {
    deleteProfileButton.addEventListener('click', () => {
      // Handle profile deletion through coordinator
      // Implementation would go here
    });
  }
  
  // Add event listener for save instruction button
  const saveInstructionBtn = document.getElementById('saveInstruction');
  if (saveInstructionBtn) {
    saveInstructionBtn.addEventListener('click', () => {
      // Handle instruction save through coordinator
      // Implementation would go here
    });
  }
  
  // Add event listener for clear form button
  const clearFormBtn = document.getElementById('clearForm');
  if (clearFormBtn) {
    clearFormBtn.addEventListener('click', () => {
      // Handle form clearing
      // Implementation would go here
    });
  }
  
  // Export instructions functionality is handled by importExport.js
  
  // Import/export functionality is handled by importExport.js
  
  // Add event listener for save tool button
  const saveToolBtn = document.getElementById('saveTool');
  if (saveToolBtn) {
    saveToolBtn.addEventListener('click', () => {
      // Handle tool save through coordinator
      // Implementation would go here
    });
  }
  
  // Add event listener for clear tool form button
  const clearToolFormBtn = document.getElementById('clearToolForm');
  if (clearToolFormBtn) {
    clearToolFormBtn.addEventListener('click', () => {
      // Handle tool form clearing
      // Implementation would go here
    });
  }
  
  // Tool import/export functionality is handled by importExport.js
  
  // Add event listener for fetch MCP tool info button
  const fetchMcpToolInfoBtn = document.getElementById('fetchMcpToolInfoBtn');
  if (fetchMcpToolInfoBtn) {
    fetchMcpToolInfoBtn.addEventListener('click', async () => {
      // Handle MCP tool info fetching through coordinator
      // Implementation would go here
    });
  }
  
  // Add event listener for streaming toggle
  const enableStreamingToggle = document.getElementById('enableStreamingToggle');
  if (enableStreamingToggle) {
    enableStreamingToggle.addEventListener('change', () => {
      const isStreamingEnabled = enableStreamingToggle.checked;
      // Handle streaming toggle through coordinator
      // Implementation would go here
    });
  }
  
  // Add event listener for analytics consent toggle
  const analyticsConsentToggle = document.getElementById('analyticsConsentToggle');
  if (analyticsConsentToggle) {
    analyticsConsentToggle.addEventListener('change', () => {
      const consent = !!analyticsConsentToggle.checked;
      // Handle analytics consent toggle through coordinator
      // Implementation would go here
    });
  }
}

// --- Sync slider and number input + constraints ---
function setupTokenControls(){
  const slider = null; // slider removed
  const number = document.getElementById('maxTokens');
  const tokenValue = document.getElementById('tokenValue');
  if (!number || !tokenValue) return;

  // Normalize within bounds helper
  const clamp = (v) => {
    const min = Number(number.min) || 1;
    const max = Number(number.max) || 32000;
    v = Math.round(Number(v) || 0);
    if (v < min) v = min;
    if (v > max) v = max;
    return v;
  };

  const updateFrom = (v) => {
    const val = clamp(v);
    number.value = String(val);
    tokenValue.textContent = String(val);
  };

  // Initialize display
  updateFrom(number.value || 16000);

  number.addEventListener('input', e => updateFrom(e.target.value));
  number.addEventListener('blur', () => updateFrom(number.value));
}

// Call the function when DOM is ready
document.addEventListener('DOMContentLoaded', setupTokenControls);

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

// Template-dependent event listeners are handled by importExport.js

// Function to update UI elements from view model state
function updateUIFromState(state) {
  console.log('Updating UI from state:', state);
  
  // Update current profile data in form fields
  if (state.currentProfile) {
    const profile = state.currentProfile;
    
    // Update form fields
    const llmEndpointEl = document.getElementById('llmEndpoint');
    const apiKeyEl = document.getElementById('apiKey');
    const modelNameEl = document.getElementById('modelName');
    const systemPromptEl = document.getElementById('systemPrompt');
    const maxTokensEl = document.getElementById('maxTokens');
    const tokenValueEl = document.getElementById('tokenValue');
    
    if (llmEndpointEl && profile.llmEndpoint) {
      llmEndpointEl.value = profile.llmEndpoint;
    }
    if (apiKeyEl && profile.apiKey) {
      apiKeyEl.value = profile.apiKey;
    }
    if (modelNameEl && profile.modelName) {
      modelNameEl.value = profile.modelName;
    }
    if (systemPromptEl && profile.systemPrompt) {
      systemPromptEl.value = profile.systemPrompt;
    }
    if (maxTokensEl && profile.maxTokens) {
      maxTokensEl.value = profile.maxTokens;
    }
    if (tokenValueEl && profile.maxTokens) {
      tokenValueEl.textContent = profile.maxTokens;
    }
    
    // Update "About" section display
    const currentEndpointEl = document.getElementById('currentEndpoint');
    const currentApiKeyEl = document.getElementById('currentApiKey');
    const currentModelNameEl = document.getElementById('currentModelName');
    const currentSystemPromptEl = document.getElementById('currentSystemPrompt');
    const currentProfileEl = document.getElementById('currentProfile');
    const lastUpdatedEl = document.getElementById('lastUpdated');
    
    if (currentEndpointEl) {
      currentEndpointEl.textContent = profile.llmEndpoint || 'Not set';
    }
    if (currentApiKeyEl) {
      // Mask API key for display
      const maskedKey = profile.apiKey ? 
        profile.apiKey.substring(0, 8) + '...' + profile.apiKey.substring(profile.apiKey.length - 4) : 
        'Not set';
      currentApiKeyEl.textContent = maskedKey;
    }
    if (currentModelNameEl) {
      currentModelNameEl.textContent = profile.modelName || 'Not set';
    }
    if (currentSystemPromptEl) {
      const truncatedPrompt = profile.systemPrompt && profile.systemPrompt.length > 100 ? 
        profile.systemPrompt.substring(0, 100) + '...' : 
        profile.systemPrompt || 'Not set';
      currentSystemPromptEl.textContent = truncatedPrompt;
    }
    if (currentProfileEl) {
      currentProfileEl.textContent = profile.name || 'Default';
    }
    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = profile.lastUpdated || 'Never';
    }
  }
  
  // Update profile selector
  if (state.profiles && state.profiles.length > 0) {
    const profileSelectEl = document.getElementById('profileSelect');
    if (profileSelectEl) {
      // Clear existing options
      profileSelectEl.innerHTML = '';
      
      // Add profile options
      state.profiles.forEach(profile => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        if (profile.id === state.selectedProfileId) {
          option.selected = true;
        }
        profileSelectEl.appendChild(option);
      });
    }
  }
  
  // Update preferences
  const enableTelemetryEl = document.getElementById('enableTelemetry');
  if (enableTelemetryEl && typeof state.analyticsConsent !== 'undefined') {
    enableTelemetryEl.checked = state.analyticsConsent;
  }
  
  // Update streaming toggle if it exists
  const enableStreamingToggleEl = document.getElementById('enableStreamingToggle');
  if (enableStreamingToggleEl && typeof state.enableStreaming !== 'undefined') {
    enableStreamingToggleEl.checked = state.enableStreaming;
  }

  // Render instructions list
  renderInstructions(state.instructions || [], state.pinnedQuickActions || []);
}

// Render the instructions table and mobile cards from state
function renderInstructions(instructions, pinnedQuickActions) {
  try {
    const table = document.getElementById('instructionsTable');
    const tbody = table ? table.querySelector('tbody') : null;
    const cardsContainer = document.querySelector('#instructions-section .mobile-cards');

    if (!tbody && !cardsContainer) return; // Nothing to render into yet

    // Helper: truncate text for preview
    const truncate = (text, n) => {
      if (!text) return '';
      const s = String(text);
      return s.length > n ? s.slice(0, n - 1) + '…' : s;
    };

    // Clear containers
    if (tbody) tbody.innerHTML = '';
    if (cardsContainer) cardsContainer.innerHTML = '';

    // If no instructions, show empty state
    if (!Array.isArray(instructions) || instructions.length === 0) {
      if (tbody) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.textContent = 'No instructions yet.';
        td.style.textAlign = 'center';
        tr.appendChild(td);
        tbody.appendChild(tr);
      }
      if (cardsContainer) {
        const p = document.createElement('p');
        p.textContent = 'No instructions yet.';
        cardsContainer.appendChild(p);
      }
      return;
    }

    const pinnedSet = new Set(pinnedQuickActions || []);

    instructions.forEach(inst => {
      const id = inst.id || '';
      const name = inst.name || 'Untitled';
      const content = inst.content || '';
      const toolChoice = inst.tool_choice || '-';
      const isPinned = pinnedSet.has(id);

      // Table row
      if (tbody) {
        const tr = document.createElement('tr');
        tr.dataset.id = id;

        const nameTd = document.createElement('td');
        nameTd.textContent = name;
        tr.appendChild(nameTd);

        const contentTd = document.createElement('td');
        contentTd.textContent = truncate(content, 120);
        tr.appendChild(contentTd);

        const toolTd = document.createElement('td');
        toolTd.textContent = toolChoice;
        tr.appendChild(toolTd);

        const pinTd = document.createElement('td');
        const pinBtn = document.createElement('button');
        pinBtn.className = 'btn btn-secondary pin-btn';
        pinBtn.textContent = isPinned ? '📌 Unpin' : '📍 Pin';
        pinBtn.addEventListener('click', async () => {
          try {
            await window.optionsCoordinator.togglePinnedInstruction(id);
          } catch (e) {
            console.error('Toggle pin failed', e);
          }
        });
        pinTd.appendChild(pinBtn);
        tr.appendChild(pinTd);

        const actionsTd = document.createElement('td');
        // Minimal actions for now: delete
        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-destructive';
        delBtn.textContent = '🗑️ Delete';
        delBtn.addEventListener('click', async () => {
          if (!confirm('Delete this instruction?')) return;
          try {
            await window.optionsCoordinator.deleteInstruction(id);
          } catch (e) {
            console.error('Delete instruction failed', e);
          }
        });
        actionsTd.appendChild(delBtn);
        tr.appendChild(actionsTd);

        tbody.appendChild(tr);
      }

      // Mobile card
      if (cardsContainer) {
        const card = document.createElement('div');
        card.className = 'card';
        const title = document.createElement('h4');
        title.textContent = name;
        const body = document.createElement('p');
        body.textContent = truncate(content, 200);
        const meta = document.createElement('p');
        meta.style.opacity = '0.8';
        meta.textContent = `Tool: ${toolChoice}`;
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '8px';
        const pinBtn2 = document.createElement('button');
        pinBtn2.className = 'btn btn-secondary';
        pinBtn2.textContent = isPinned ? '📌 Unpin' : '📍 Pin';
        pinBtn2.addEventListener('click', async () => {
          try {
            await window.optionsCoordinator.togglePinnedInstruction(id);
          } catch (e) {
            console.error('Toggle pin failed', e);
          }
        });
        const delBtn2 = document.createElement('button');
        delBtn2.className = 'btn btn-destructive';
        delBtn2.textContent = '🗑️ Delete';
        delBtn2.addEventListener('click', async () => {
          if (!confirm('Delete this instruction?')) return;
          try {
            await window.optionsCoordinator.deleteInstruction(id);
          } catch (e) {
            console.error('Delete instruction failed', e);
          }
        });
        actions.appendChild(pinBtn2);
        actions.appendChild(delBtn2);

        card.appendChild(title);
        card.appendChild(body);
        card.appendChild(meta);
        card.appendChild(actions);
        cardsContainer.appendChild(card);
      }
    });
  } catch (err) {
    console.error('Error rendering instructions UI:', err);
  }
}

// Function to save current profile from form data
async function saveCurrentProfile() {
  try {
    // Get form values
    const llmEndpointEl = document.getElementById('llmEndpoint');
    const apiKeyEl = document.getElementById('apiKey');
    const modelNameEl = document.getElementById('modelName');
    const systemPromptEl = document.getElementById('systemPrompt');
    const maxTokensEl = document.getElementById('maxTokens');
    
    // Validate required fields
    if (!llmEndpointEl?.value || !apiKeyEl?.value || !modelNameEl?.value) {
      showStatus('Please fill in all required fields (LLM Endpoint, API Key, Model Name)', true);
      return;
    }
    
    // Validate URL
    if (!isValidURL(llmEndpointEl.value)) {
      showStatus('Please enter a valid LLM Endpoint URL', true);
      return;
    }
    
    // Get current profile ID or use 'default'
    const currentState = optionsCoordinator.viewModel.getState();
    const profileId = currentState.selectedProfileId || 'default';
    
    // Create profile object
    const profile = {
      id: profileId,
      name: profileId === 'default' ? 'Default' : currentState.currentProfile?.name || 'Default',
      llmEndpoint: llmEndpointEl.value.trim(),
      apiKey: apiKeyEl.value.trim(),
      modelName: modelNameEl.value.trim(),
      systemPrompt: systemPromptEl?.value?.trim() || 'You are a helpful assistant.',
      maxTokens: parseInt(maxTokensEl?.value) || 16000,
      lastUpdated: new Date().toLocaleString()
    };
    
    // Save through coordinator
    await optionsCoordinator.saveProfile(profile);
    
  } catch (error) {
    console.error('Error saving profile:', error);
    showStatus('Error saving configuration: ' + error.message, true);
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