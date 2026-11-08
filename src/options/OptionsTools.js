/**
 * @fileoverview User-defined tool editing, invocation settings, and import/export.
 * @module OptionsTools
 */
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORTED_RECORDS } from './OptionsLimits.js';
import { escapeHtml } from '../utils/domSanitizer.js';
import { createUniqueId } from '../utils/ids.js';
import { normalizeToolDefinition } from '../utils/validation.js';

export function normalizeToolsForImport(importedTools) {
  if (!Array.isArray(importedTools)) return { valid: false, reason: 'format' };
  if (importedTools.length > MAX_IMPORTED_RECORDS) return { valid: false, reason: 'too_many' };
  const tools = importedTools
    .map((tool) => normalizeToolDefinition(tool))
    .filter((entry) => entry.valid)
    .map((entry) => entry.value);
  return { valid: true, tools, skippedCount: importedTools.length - tools.length };
}

// Setup tool management handlers
export function setupToolHandlers({
  showStatus,
  setChromeStorage,
  populateToolDropdown,
  setButtonLoading,
}) {
  const saveToolBtn = document.getElementById('saveTool');
  const clearToolFormBtn = document.getElementById('clearToolForm');
  // Load and display tools
  function loadTools() {
    chrome.storage.local.get(['promptPaulTools'], (result) => {
      const tools = result.promptPaulTools || [];
      const tableBody = document.querySelector('#toolsTable tbody');
      tableBody.innerHTML = '';

      tools.forEach((tool) => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td data-label="Name">${escapeHtml(tool.name)}</td>
          <td data-label="Description">${escapeHtml(tool.description)}</td>
          <td data-label="Actions">
            <button class="edit-tool-btn" data-id="${escapeHtml(tool.id)}">Edit</button>
            <button class="delete-tool-btn" data-id="${escapeHtml(tool.id)}">Delete</button>
          </td>
        `;
        tableBody.appendChild(row);
      });

      // Add edit/delete handlers
      document.querySelectorAll('.edit-tool-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const toolId = e.target.dataset.id;
          chrome.storage.local.get(['promptPaulTools'], (result) => {
            if (chrome.runtime.lastError) {
              console.error('Error loading tool for edit:', chrome.runtime.lastError.message);
              showStatus('Error loading tool data.', true);
              return;
            }
            const tools = result.promptPaulTools || [];
            const tool = tools.find((t) => t.id === toolId);
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

      document.querySelectorAll('.delete-tool-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const toolId = e.target.dataset.id;
          if (confirm('Are you sure you want to delete this tool?')) {
            chrome.storage.local.get(['promptPaulTools'], (result) => {
              if (chrome.runtime.lastError) {
                console.error('Error loading tools for delete:', chrome.runtime.lastError.message);
                showStatus('Error loading tool data.', true);
                return;
              }
              let tools = result.promptPaulTools || [];
              tools = tools.filter((t) => t.id !== toolId);
              chrome.storage.local.set({ promptPaulTools: tools }, () => {
                if (chrome.runtime.lastError) {
                  console.error('Error deleting tool:', chrome.runtime.lastError.message);
                  showStatus('Error deleting tool.', true);
                  return;
                }
                showStatus('Tool deleted.');
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
      setButtonLoading(saveToolBtn, true);
      const toolName = document.getElementById('toolName').value.trim();
      const toolDescription = document.getElementById('toolDescription').value.trim();
      const toolParameters = document.getElementById('toolParameters').value.trim();
      const toolEndpointUrl = document.getElementById('toolEndpointUrl').value.trim();
      const toolHttpMethod = document.getElementById('toolHttpMethod').value;
      const toolId = document.getElementById('toolId').value;

      const normalizedTool = normalizeToolDefinition({
        name: toolName,
        description: toolDescription,
        parameters: toolParameters,
        endpointUrl: toolEndpointUrl,
        httpMethod: toolHttpMethod,
      });
      if (!normalizedTool.valid) {
        showStatus(normalizedTool.error, true);
        setButtonLoading(saveToolBtn, false);
        return;
      }

      const normalizedToolValue = normalizedTool.value;

      chrome.storage.local.get(['promptPaulTools'], (result) => {
        let tools = result.promptPaulTools || [];
        const now = new Date().toISOString();

        if (toolId) {
          // Update existing tool
          tools = tools.map((tool) => {
            if (tool.id === toolId) {
              return {
                ...tool,
                name: normalizedToolValue.name,
                description: normalizedToolValue.description,
                parameters: normalizedToolValue.parameters,
                endpointUrl: normalizedToolValue.endpointUrl,
                httpMethod: normalizedToolValue.httpMethod,
                lastUpdated: now,
              };
            }
            return tool;
          });
          setChromeStorage(chrome.storage.local, { promptPaulTools: tools })
            .then(() => {
              showStatus('Tool updated.');
              loadTools(); // Reload the table
              populateToolDropdown(); // Update tool dropdown
              clearToolForm(); // Clear the form after saving
            })
            .catch((error) => {
              showStatus(
                `Tool could not be saved: ${error.message}. Your draft is preserved.`,
                true
              );
            })
            .finally(() => setButtonLoading(saveToolBtn, false));
        } else {
          // Add new tool
          const newTool = {
            id: createUniqueId('tool'),
            name: normalizedToolValue.name,
            description: normalizedToolValue.description,
            parameters: normalizedToolValue.parameters,
            endpointUrl: normalizedToolValue.endpointUrl,
            httpMethod: normalizedToolValue.httpMethod,
            createdAt: now,
            lastUpdated: now,
          };
          tools.push(newTool);
          tools = tools.slice(0, MAX_IMPORTED_RECORDS);
          setChromeStorage(chrome.storage.local, { promptPaulTools: tools })
            .then(() => {
              showStatus('Tool added.');
              loadTools(); // Reload the table
              populateToolDropdown(); // Update tool dropdown
              clearToolForm(); // Clear the form after saving
            })
            .catch((error) => {
              showStatus(
                `Tool could not be saved: ${error.message}. Your draft is preserved.`,
                true
              );
            })
            .finally(() => setButtonLoading(saveToolBtn, false));
        }
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
        tools: tools,
      };
      const dataStr =
        'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute('href', dataStr);
      downloadAnchorNode.setAttribute('download', 'prompt_paul_tools.json');
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
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      showStatus('Tool import file is too large.', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        if (importData.version === 1 && Array.isArray(importData.tools)) {
          const imported = normalizeToolsForImport(importData.tools);
          if (!imported.valid && imported.reason === 'too_many') {
            showStatus(`Import contains more than ${MAX_IMPORTED_RECORDS} tools.`, true);
            return;
          }
          // Simple merge strategy: add new tools, update existing by ID
          chrome.storage.local.get(['promptPaulTools'], (result) => {
            let existingTools = result.promptPaulTools || [];
            if (imported.skippedCount > 0) {
              showStatus(
                `Skipped ${imported.skippedCount} invalid or reserved tool(s).`,
                false,
                true
              );
            }
            imported.tools.forEach((importedTool) => {
              const existingIndex = existingTools.findIndex((tool) => tool.id === importedTool.id);
              if (existingIndex > -1) {
                // Update existing tool
                existingTools[existingIndex] = {
                  ...existingTools[existingIndex],
                  ...importedTool,
                  lastUpdated: new Date().toISOString(),
                };
              } else {
                // Add new tool
                existingTools.push({
                  ...importedTool,
                  id: importedTool.id || createUniqueId('tool'),
                  createdAt: importedTool.createdAt || new Date().toISOString(),
                  lastUpdated: new Date().toISOString(),
                });
              }
            });

            existingTools = existingTools.slice(0, MAX_IMPORTED_RECORDS);
            chrome.storage.local.set({ promptPaulTools: existingTools }, () => {
              showStatus('Tools imported successfully.');
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
