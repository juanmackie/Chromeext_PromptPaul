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

function updateCurrentConfig(endpoint, key, model, timestamp) {
  document.getElementById('currentEndpoint').textContent = endpoint || 'Not set';
  document.getElementById('currentApiKey').textContent = key ? '********' + key.slice(-4) : 'Not set';
  document.getElementById('currentModelName').textContent = model || 'Not set';
  document.getElementById('lastUpdated').textContent = timestamp || 'Never';

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

  chrome.storage.sync.set(
    {
      llmEndpoint: llmEndpointValue,
      apiKey: apiKeyValue,
      modelName: modelNameValue,
      maxTokens: maxTokensValue || 2048,
      systemPrompt: systemPromptValue, // Add system prompt
      lastUpdated: new Date().toLocaleString()
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error('Error saving settings:', chrome.runtime.lastError);
        showStatus('Error saving settings: ' + chrome.runtime.lastError.message, true);
      } else {
        console.log('Settings saved successfully:', { llmEndpoint: llmEndpointValue, apiKey: apiKeyValue, modelName: modelNameValue, maxTokens: maxTokensValue, systemPrompt: systemPromptValue });
        showStatus('Settings saved successfully!');
        loadOptions();
      }
      saveButton.disabled = false;
    }
  );
}

// Load saved options
function loadOptions() {
  chrome.storage.sync.get(
    {
      llmEndpoint: 'https://api.mistral.ai/v1/chat/completions',
      apiKey: 'wuS4CEjyu9KApITISfF1b5Th5hSvpkgF',
      modelName: 'mistral-small-latest',
      maxTokens: 32000,
      systemPrompt: '', // Add default for system prompt
      lastUpdated: ''
    },
    (items) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading settings:', chrome.runtime.lastError);
        showStatus('Error loading settings: ' + chrome.runtime.lastError.message, true);
        return;
      }

      console.log('Loaded settings:', items);
      document.getElementById('llmEndpoint').value = items.llmEndpoint;
      document.getElementById('apiKey').value = items.apiKey;
      document.getElementById('modelName').value = items.modelName;
      document.getElementById('maxTokens').value = items.maxTokens;
      document.getElementById('systemPrompt').value = items.systemPrompt; // Load system prompt

      updateCurrentConfig(items.llmEndpoint, items.apiKey, items.modelName, items.lastUpdated);
    }
  );
}

// Add event listeners
document.addEventListener('DOMContentLoaded', () => {
  loadOptions();
  checkAndPromptInstructionMigration();
  setupInstructionHandlers();
  setupToolHandlers(); // Add call to setup tool handlers
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
        // Default tool_choice to 'none' if not present
        const toolChoice = instruction.tool_choice || 'none';
        row.innerHTML = `
          <td>${instruction.name}</td>
          <td>${instruction.content}</td>
          <td>${toolChoice.charAt(0).toUpperCase() + toolChoice.slice(1)}</td>
          <td>
            <button class="edit-btn" data-id="${instruction.id}">Edit</button>
            <button class="improve-btn" data-id="${instruction.id}">Improve</button>
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
            // Set the tool_choice dropdown, defaulting to 'none' if not present
            document.getElementById('instructionToolChoice').value = instruction.tool_choice || 'none';
          }
        });
      });

      document.querySelectorAll('.improve-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => { // Make the listener async
          const instructionId = e.target.dataset.id;
          const instruction = instructions.find(i => i.id === instructionId);
          if (instruction) {
            // Get API endpoint and API key from storage
            chrome.storage.sync.get(['llmEndpoint', 'apiKey', 'modelName'], async (config) => {
              if (config.llmEndpoint && config.apiKey && config.modelName) {
                const promptForImprovement = `Please improve the following prompt to be clearer and more effective for an LLM. Your response should ONLY contain the improved prompt text, without any additional text, prefixes, or markers. Do not include any placeholders in the improved prompt.\n\nOriginal Prompt Name: ${instruction.name}\n\nOriginal Prompt Content: ${instruction.content}\n\nImproved Prompt:`;

                try {
                  // Call API to improve prompt
                  const improvedPrompt = await improvePromptAPI(config.llmEndpoint, config.apiKey, config.modelName, promptForImprovement);
                  // Update instruction content in the form
                  document.getElementById('instructionContent').value = improvedPrompt;
                  // Optionally show a status message
                  showStatus('Prompt successfully improved', false, true); // Show toast notification
                } catch (error) {
                  console.error('Error improving prompt:', error);
                  showStatus(`Error improving prompt: ${error.message}`, true, false); // Show error status
                }
              } else {
                showStatus('API configuration missing. Please check settings.', true);
              }
            });
          }
        });
      });

      document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const instructionId = e.target.dataset.id;
          if (confirm('Are you sure you want to delete this instruction?')) {
            chrome.storage.local.get(['instructions'], (result) => {
              const updatedInstructions = result.instructions.filter(i => i.id !== instructionId);
              chrome.storage.local.set({ instructions: updatedInstructions }, () => {
                loadInstructions();
                clearForm();
              });
            });
          }
        });
      });
    });
  }

  // Save instruction handler
  saveInstructionBtn.addEventListener('click', () => {
    const instructionId = document.getElementById('instructionId').value;
    const name = document.getElementById('instructionName').value.trim();
    const content = document.getElementById('instructionContent').value.trim();
    const toolChoice = document.getElementById('instructionToolChoice').value; // Get tool_choice value

    if (!name || !content) {
      showStatus('Both name and content are required', true);
      return;
    }

    chrome.storage.local.get(['instructions'], (result) => {
      const instructions = result.instructions || [];
      const existingIndex = instructions.findIndex(i => i.id === instructionId);

      const instruction = {
        id: instructionId || Date.now().toString(),
        name,
        content,
        tool_choice: toolChoice, // Save tool_choice
        created_at: instructionId ? instructions[existingIndex].created_at : new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      if (existingIndex >= 0) {
        instructions[existingIndex] = instruction;
      } else {
        instructions.push(instruction);
      }

      console.log('Saving instructions to local:', instructions);
      chrome.storage.local.set({ instructions }, () => {
        showStatus('Instruction saved successfully!');
        loadInstructions();
        clearForm();
      });
    });
  });

  // Clear form handler
  clearFormBtn.addEventListener('click', clearForm);

  function clearForm() {
    document.getElementById('instructionName').value = '';
    document.getElementById('instructionContent').value = '';
    document.getElementById('instructionId').value = '';
    document.getElementById('instructionToolChoice').value = 'none'; // Reset tool_choice dropdown
  }

  // Export instructions handler
  document.getElementById('exportInstructions').addEventListener('click', () => {
    chrome.storage.local.get(['instructions'], (result) => {
      const instructions = result.instructions || [];
      const exportData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        instructions: instructions
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prompt-paul-instructions-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showStatus('Instructions exported successfully!');
    });
  });

  // Import instructions handler
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

        // Validate import data structure
        if (!importData.instructions || !Array.isArray(importData.instructions)) {
          throw new Error('Invalid import file format');
        }

        // Validate each instruction (add check for tool_choice, but allow missing for backward compatibility)
        importData.instructions.forEach(instruction => {
          if (!instruction.name || !instruction.content) {
            throw new Error('Invalid instruction format: Missing name or content');
          }
          // Optional: Validate tool_choice value if present
          if (instruction.tool_choice && !['none', 'auto'].includes(instruction.tool_choice)) {
             console.warn(`Invalid tool_choice value "${instruction.tool_choice}" for instruction "${instruction.name}". Defaulting to "none".`);
             instruction.tool_choice = 'none';
          }
        });

        // Merge with existing instructions
        chrome.storage.local.get(['instructions'], (result) => {
          const currentInstructions = result.instructions || [];
          const newInstructions = importData.instructions.map(instruction => ({
            ...instruction,
            id: instruction.id || Date.now().toString(),
            tool_choice: instruction.tool_choice || 'none', // Ensure tool_choice exists, default to 'none'
            imported_at: new Date().toISOString()
          }));

          // Remove duplicates based on name
          const mergedInstructions = [...currentInstructions];
          newInstructions.forEach(newInst => {
            const existingIndex = mergedInstructions.findIndex(i => i.name === newInst.name);
            if (existingIndex >= 0) {
              mergedInstructions[existingIndex] = newInst;
            } else {
              mergedInstructions.push(newInst);
            }
          });

          chrome.storage.local.set({ instructions: mergedInstructions }, () => {
            showStatus(`Successfully imported ${newInstructions.length} instructions!`);
            loadInstructions();
          });
        });
      } catch (error) {
        showStatus(`Error importing instructions: ${error.message}`, true);
      }

      // Clear the file input
      event.target.value = '';
    };

    reader.onerror = () => {
      showStatus('Error reading import file', true);
      event.target.value = '';
    };

    reader.readAsText(file);
  });

  // Initial load
  loadInstructions();
}

async function improvePromptAPI(endpoint, apiKey, modelName, prompt) {
  const apiResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName, // Use modelName from config
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
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

  if (
    !responseData ||
    !responseData.choices ||
    !responseData.choices[0] ||
    !responseData.choices[0].message ||
    !responseData.choices[0].message.content
  ) {
    throw new Error('Invalid response format from API');
  }

  return responseData.choices[0].message.content;
}

// --- Tool Management ---

// Function to validate JSON
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
  const toolForm = document.querySelector('.tool-form'); // Assuming a class for the form container

  // Load and display tools
  function loadTools() {
    chrome.storage.sync.get(['promptPaulTools'], (result) => {
      const tools = result.promptPaulTools || [];
      const tableBody = document.querySelector('#toolsTable tbody');
      if (!tableBody) {
          console.error("Tool table body not found!");
          return;
      }
      tableBody.innerHTML = ''; // Clear existing rows

      tools.forEach(tool => {
        const row = document.createElement('tr');
        // Truncate description for display if needed, or use a tooltip
        const displayDescription = tool.description.length > 100 ? tool.description.substring(0, 97) + '...' : tool.description;
        row.innerHTML = `
          <td>${tool.name}</td>
          <td title="${tool.description}">${displayDescription}</td>
          <td>
            <button class="edit-tool-btn" data-id="${tool.id}">Edit</button>
            <button class="delete-tool-btn" data-id="${tool.id}">Delete</button>
          </td>
        `;
        tableBody.appendChild(row);
      });

      // Add edit/delete handlers for tools
      document.querySelectorAll('.edit-tool-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const toolId = e.target.dataset.id;
          const tool = tools.find(t => t.id === toolId);
          if (tool) {
            document.getElementById('toolName').value = tool.name;
            document.getElementById('toolDescription').value = tool.description;
            // Ensure parameters are stored as string; handle potential parsing if stored as object
            document.getElementById('toolParameters').value = typeof tool.parameters === 'string' ? tool.parameters : JSON.stringify(tool.parameters, null, 2);
            document.getElementById('toolEndpointUrl').value = tool.endpointUrl || ''; // Populate endpoint URL
            document.getElementById('toolHttpMethod').value = tool.httpMethod || ''; // Populate HTTP method
            document.getElementById('toolId').value = tool.id;
          }
        });
      });

      document.querySelectorAll('.delete-tool-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const toolId = e.target.dataset.id;
          if (confirm('Are you sure you want to delete this tool definition?')) {
            chrome.storage.sync.get(['promptPaulTools'], (result) => {
              const updatedTools = (result.promptPaulTools || []).filter(t => t.id !== toolId);
              chrome.storage.sync.set({ promptPaulTools: updatedTools }, () => {
                showStatus('Tool deleted successfully!');
                loadTools(); // Reload the list
                clearToolForm(); // Clear the form
              });
            });
          }
        });
      });
    });
  }

  // Save tool handler
  saveToolBtn.addEventListener('click', () => {
    const toolId = document.getElementById('toolId').value;
    const name = document.getElementById('toolName').value.trim();
    const description = document.getElementById('toolDescription').value.trim();
    const parametersStr = document.getElementById('toolParameters').value.trim();
    const endpointUrl = document.getElementById('toolEndpointUrl').value.trim();
    const httpMethod = document.getElementById('toolHttpMethod').value;

    if (!name || !description || !parametersStr) {
      showStatus('Tool name, description, and parameters are required', true);
      return;
    }

    if (!isValidJson(parametersStr)) {
      showStatus('Parameters must be valid JSON', true);
      return;
    }

    // Optional: Validate endpoint URL if provided
    if (endpointUrl) {
        try {
            new URL(endpointUrl);
        } catch (e) {
            showStatus('Please enter a valid URL for the Endpoint URL or leave it empty.', true);
            return;
        }
    }

    chrome.storage.sync.get(['promptPaulTools'], (result) => {
      const tools = result.promptPaulTools || [];
      const existingIndex = tools.findIndex(t => t.id === toolId);

      const tool = {
        id: toolId || Date.now().toString() + Math.random().toString(36).substring(2, 9), // Generate unique ID if new
        name,
        description,
        parameters: parametersStr, // Store as string
        endpointUrl: endpointUrl || null, // Store null if empty
        httpMethod: httpMethod || null, // Store null if empty/auto
        created_at: existingIndex >= 0 ? tools[existingIndex].created_at : new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      if (existingIndex >= 0) {
        tools[existingIndex] = tool; // Update existing
      } else {
        // Check for name conflict before adding
        const nameConflictIndex = tools.findIndex(t => t.name === tool.name);
        if (nameConflictIndex >= 0) {
            showStatus(`A tool with the name "${tool.name}" already exists. Please use a unique name.`, true);
            return; // Prevent adding duplicate name
        }
        tools.push(tool); // Add new
      }

      chrome.storage.sync.set({ promptPaulTools: tools }, () => {
        showStatus('Tool saved successfully!');
        loadTools(); // Reload the list
        clearToolForm(); // Clear the form
      });
    });
  });

  // Clear tool form handler
  clearToolFormBtn.addEventListener('click', clearToolForm);

  function clearToolForm() {
    document.getElementById('toolName').value = '';
    document.getElementById('toolDescription').value = '';
    document.getElementById('toolParameters').value = '';
    document.getElementById('toolEndpointUrl').value = '';
    document.getElementById('toolHttpMethod').value = '';
    document.getElementById('toolId').value = '';
  }

  // --- Tool Import/Export Handlers ---

  // Export tools handler
  document.getElementById('exportTools').addEventListener('click', () => {
    chrome.storage.sync.get(['promptPaulTools'], (result) => {
      const tools = result.promptPaulTools || [];
      // Ensure parameters are objects for export if they were stored as strings
      const toolsForExport = tools.map(tool => {
          let parametersObject;
          try {
              parametersObject = typeof tool.parameters === 'string' ? JSON.parse(tool.parameters) : tool.parameters;
          } catch (e) {
              console.error(`Failed to parse parameters for tool "${tool.name}" during export:`, e);
              // Handle error - maybe skip this tool or use a default empty object
              parametersObject = {}; // Default to empty object on parse error
          }
          return {
              ...tool,
              parameters: parametersObject
          };
      });

      const exportData = {
        version: '1.0', // Add a version for potential future compatibility
        timestamp: new Date().toISOString(),
        tools: toolsForExport
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prompt-paul-tools-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showStatus('Tools exported successfully!');
    });
  });

  // Import tools handler - trigger file input
  document.getElementById('importTools').addEventListener('click', () => {
    document.getElementById('importToolsFile').click();
  });

  // Import tools handler - process file
  document.getElementById('importToolsFile').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);

        // Basic validation
        if (!importData.tools || !Array.isArray(importData.tools)) {
          throw new Error('Invalid import file format: Missing "tools" array.');
        }

        // Validate each tool (add more checks as needed)
        importData.tools.forEach((tool, index) => {
          if (!tool.name || !tool.description || !tool.parameters) {
            throw new Error(`Invalid tool format at index ${index}: Missing required fields (name, description, parameters).`);
          }
          // Parameters should be an object in the import file
          if (typeof tool.parameters !== 'object' || tool.parameters === null) {
               throw new Error(`Parameters for tool "${tool.name}" at index ${index} must be a valid JSON object.`);
          }
        });

        // Merge with existing tools
        chrome.storage.sync.get(['promptPaulTools'], (result) => {
          const currentTools = result.promptPaulTools || [];
          const newTools = importData.tools.map(tool => ({
            ...tool,
            // Ensure parameters are stored as string internally
            parameters: JSON.stringify(tool.parameters, null, 2),
            id: tool.id || Date.now().toString() + Math.random().toString(36).substring(2, 9), // Generate unique ID if missing
            imported_at: new Date().toISOString()
          }));

          // Merge strategy: Overwrite based on ID if present, otherwise add. Check name conflicts.
          const mergedTools = [...currentTools];
          newTools.forEach(newTool => {
            const existingIndexById = mergedTools.findIndex(t => t.id === newTool.id);
            if (existingIndexById >= 0) {
              mergedTools[existingIndexById] = newTool; // Overwrite existing by ID
            } else {
              // Check for name conflict before adding as new
              const existingIndexByName = mergedTools.findIndex(t => t.name === newTool.name);
              if (existingIndexByName >= 0) {
                  // Overwrite based on name if ID didn't match but name did
                  mergedTools[existingIndexByName] = newTool;
                  console.warn(`Tool name conflict for "${newTool.name}". Overwriting existing tool with imported one.`);
                  showStatus(`Warning: Tool "${newTool.name}" already existed and was overwritten by import.`, false, true); // Toast warning
              } else {
                  mergedTools.push(newTool); // Add as new
              }
            }
          });

          chrome.storage.sync.set({ promptPaulTools: mergedTools }, () => {
            showStatus(`Successfully imported/merged ${newTools.length} tools!`);
            loadTools(); // Reload the list in the UI
          });
        });
      } catch (error) {
        console.error("Error importing tools:", error);
        showStatus(`Error importing tools: ${error.message}`, true);
      }

      // Clear the file input value to allow importing the same file again
      event.target.value = '';
    };

    reader.onerror = () => {
      showStatus('Error reading import file', true);
      event.target.value = '';
    };

    reader.readAsText(file);
  });

  // Initial load of tools
  loadTools();
}
