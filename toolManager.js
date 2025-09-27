// ===== Tool Management Module =====

import { loadingManager } from './loadingManager.js';

class ToolManager {
  constructor() {
    this.currentToolId = null;
    this.tools = [];
  }

  showStatus(message, isError = false) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = message;
      status.className = `status ${isError ? 'error' : 'success'}`;
      status.style.display = 'block';
    }

    if (isError) {
      loadingManager.showToast(message, 'error');
    } else {
      loadingManager.showToast(message, 'success');
    }

    if (!isError && status) {
      setTimeout(() => {
        status.style.display = 'none';
      }, 2000);
    }
  }

  isValidURL(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  isValidJson(str) {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  }

  updateToolFieldStates() {
    const mcpServerUrl = document.getElementById('tool-mcp-server-url')?.value.trim();
    const endpoint = document.getElementById('tool-endpoint');
    const method = document.getElementById('tool-method');
    const parameters = document.getElementById('tool-parameters');

    if (mcpServerUrl) {
      // MCP tool - disable manual endpoint fields
      if (endpoint) {
        endpoint.disabled = true;
        endpoint.value = '';
      }
      if (method) {
        method.disabled = true;
        method.value = 'POST';
      }
      if (parameters) {
        parameters.placeholder = 'Parameters will be auto-discovered from MCP server';
        parameters.disabled = true;
      }
    } else {
      // Manual tool - enable endpoint fields
      if (endpoint) endpoint.disabled = false;
      if (method) method.disabled = false;
      if (parameters) {
        parameters.disabled = false;
        parameters.placeholder = 'Enter JSON schema for tool parameters';
      }
    }
  }

  async loadTools() {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['promptPaulTools'], resolve);
      });

      this.tools = result.promptPaulTools || [];
      this.renderToolsList();
      return this.tools;
    } catch (error) {
      console.error('Error loading tools:', error);
      this.showStatus('Error loading tools: ' + error.message, true);
      return [];
    }
  }

  renderToolsList() {
    const tbody = document.querySelector('#toolsTable tbody');
    const cards = document.getElementById('tools-cards');
    
    if (tbody) tbody.innerHTML = '';
    if (cards) cards.innerHTML = '';

    if (!this.tools || this.tools.length === 0) {
      if (tbody) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="4">No tools found. Add your first tool below.</td>';
        tbody.appendChild(tr);
      }
      return;
    }

    this.tools.forEach((tool) => {
      // Table row - matches the instructions table structure
      if (tbody) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td data-label="Name">${this.escapeHtml(tool.name || '')}</td>
          <td data-label="Description">${this.escapeHtml(tool.description || '')}</td>
          <td data-label="MCP Server URL">${this.escapeHtml(tool.mcpServerUrl || '')}</td>
          <td data-label="Actions">
            <button class="edit-tool-btn" data-id="${tool.id}">Edit</button>
            <button class="delete-tool-btn" data-id="${tool.id}">Delete</button>
          </td>`;
        tbody.appendChild(tr);
      }

      // Mobile card
      if (cards) {
        const card = document.createElement('div');
        card.className = 'mobile-card';
        card.innerHTML = `
          <div class="card-row"><strong>Name:</strong> ${this.escapeHtml(tool.name || '')}</div>
          <div class="card-row"><strong>Description:</strong> ${this.escapeHtml(tool.description || '')}</div>
          <div class="card-row"><strong>MCP Server URL:</strong> ${this.escapeHtml(tool.mcpServerUrl || '')}</div>
          <div class="card-actions">
            <button class="edit-tool-btn" data-id="${tool.id}">Edit</button>
            <button class="delete-tool-btn" data-id="${tool.id}">Delete</button>
          </div>`;
        cards.appendChild(card);
      }
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  clearToolForm() {
    document.getElementById('toolName').value = '';
    document.getElementById('toolDescription').value = '';
    document.getElementById('toolParameters').value = '';
    document.getElementById('toolEndpointUrl').value = '';
    document.getElementById('toolHttpMethod').value = '';
    document.getElementById('toolMcpServerUrl').value = '';
    document.getElementById('toolMcpProxyUrl').value = '';
    document.getElementById('toolId').value = '';

    this.currentToolId = null;
    this.updateToolFieldStates();
    
    const submitBtn = document.getElementById('saveTool');
    if (submitBtn) {
      submitBtn.textContent = 'Save Tool';
    }
  }

  async saveTool() {
    const name = document.getElementById('toolName')?.value.trim();
    const description = document.getElementById('toolDescription')?.value.trim();
    const parameters = document.getElementById('toolParameters')?.value.trim();
    const endpointUrl = document.getElementById('toolEndpointUrl')?.value.trim();
    const httpMethod = document.getElementById('toolHttpMethod')?.value || '';
    const mcpServerUrl = document.getElementById('toolMcpServerUrl')?.value.trim();
    const mcpProxyUrl = document.getElementById('toolMcpProxyUrl')?.value.trim();
    const toolId = document.getElementById('toolId')?.value || null;

    if (!name || !description) {
      this.showStatus('Tool name and description are required.', true);
      return false;
    }

    // Validate parameters JSON if provided
    if (parameters && !this.isValidJson(parameters)) {
      this.showStatus('Parameters must be valid JSON.', true);
      return false;
    }

    const toolData = {
      id: toolId || `tool_${Date.now()}`,
      name,
      description,
      parameters: parameters || '',
      endpointUrl: endpointUrl || '',
      httpMethod: httpMethod || '',
      mcpServerUrl: mcpServerUrl || '',
      mcpProxyUrl: mcpProxyUrl || '',
      createdAt: toolId ? undefined : new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };

    try {
      // Check for duplicate names
      const existingTool = this.tools.find(tool => 
        tool.name === name && tool.id !== toolId
      );
      
      if (existingTool) {
        this.showStatus('A tool with this name already exists.', true);
        return false;
      }

      // Update the tools array
      if (toolId) {
        const index = this.tools.findIndex(tool => tool.id === toolId);
        if (index >= 0) {
          this.tools[index] = { ...this.tools[index], ...toolData };
        }
      } else {
        this.tools.push(toolData);
      }

      // Save to storage
      await new Promise(resolve => {
        chrome.storage.local.set({ promptPaulTools: this.tools }, resolve);
      });

      this.showStatus(toolId ? 'Tool updated successfully!' : 'Tool added successfully!');
      this.clearToolForm();
      this.renderToolsList();
      return true;
    } catch (error) {
      console.error('Error saving tool:', error);
      this.showStatus('Error saving tool: ' + error.message, true);
      return false;
    }
  }

  editTool(toolId) {
    const tool = this.tools.find(t => t.id === toolId);
    if (!tool) {
      this.showStatus('Tool not found.', true);
      return;
    }

    // Populate form with tool data
    document.getElementById('toolName').value = tool.name || '';
    document.getElementById('toolDescription').value = tool.description || '';
    document.getElementById('toolParameters').value = tool.parameters || '';
    document.getElementById('toolEndpointUrl').value = tool.endpointUrl || '';
    document.getElementById('toolHttpMethod').value = tool.httpMethod || '';
    document.getElementById('toolMcpServerUrl').value = tool.mcpServerUrl || '';
    document.getElementById('toolMcpProxyUrl').value = tool.mcpProxyUrl || '';
    document.getElementById('toolId').value = tool.id;

    this.currentToolId = toolId;
    this.updateToolFieldStates();
    
    const submitBtn = document.getElementById('saveTool');
    if (submitBtn) {
      submitBtn.textContent = 'Save Tool';
    }

    // Scroll to form
    document.getElementById('tool-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  async deleteTool(toolId) {
    if (!confirm('Are you sure you want to delete this tool?')) {
      return;
    }

    try {
      this.tools = this.tools.filter(tool => tool.id !== toolId);
      
      await new Promise(resolve => {
        chrome.storage.local.set({ promptPaulTools: this.tools }, resolve);
      });

      this.showStatus('Tool deleted successfully!');
      this.renderToolsList();
      
      // Clear form if we were editing this tool
      if (this.currentToolId === toolId) {
        this.clearToolForm();
      }
    } catch (error) {
      console.error('Error deleting tool:', error);
      this.showStatus('Error deleting tool: ' + error.message, true);
    }
  }

  async testTool(toolId) {
    const tool = this.tools.find(t => t.id === toolId);
    if (!tool) {
      this.showStatus('Tool not found.', true);
      return;
    }

    try {
      this.showStatus('Testing tool...');
      
      if (tool.mcpServerUrl) {
        // Test MCP tool
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'testMcpTool',
            mcpServerUrl: tool.mcpServerUrl,
            toolName: tool.name
          }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        });

        if (response && response.success) {
          this.showStatus('MCP tool test successful!');
        } else {
          this.showStatus('MCP tool test failed: ' + (response?.error || 'Unknown error'), true);
        }
      } else {
        // Test manual tool
        const testPayload = { test: true };
        const response = await fetch(tool.endpoint, {
          method: tool.method || 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(testPayload)
        });

        if (response.ok) {
          this.showStatus('Tool test successful!');
        } else {
          this.showStatus(`Tool test failed: HTTP ${response.status}`, true);
        }
      }
    } catch (error) {
      console.error('Error testing tool:', error);
      this.showStatus('Tool test failed: ' + error.message, true);
    }
  }

  setupEventHandlers() {
     console.log('🔍 DEBUG: Setting up tool manager event handlers...');

     // MCP server URL input handler
     const mcpUrlInput = document.getElementById('tool-mcp-server-url');
     if (mcpUrlInput) {
       mcpUrlInput.addEventListener('input', () => this.updateToolFieldStates());
     }

     // Clear form button
     const clearBtn = document.getElementById('clearToolForm');
     if (clearBtn) {
       clearBtn.addEventListener('click', () => this.clearToolForm());
     }

     // Submit button
     const submitBtn = document.getElementById('saveTool');
     if (submitBtn) {
       submitBtn.addEventListener('click', (e) => {
         e.preventDefault();
         this.saveTool();
       });
     }

     // Export tools button
     const exportBtn = document.getElementById('exportTools');
     const importBtn = document.getElementById('importTools');
     const importInput = document.getElementById('importToolsFile');
     console.log('🔍 DEBUG: Tool import/export buttons:', { exportBtn, importBtn, importInput });
     if (exportBtn) {
       exportBtn.addEventListener('click', () => this.exportTools());
     }

     // Import tools button
     if (importBtn && importInput) {
       importBtn.addEventListener('click', () => importInput.click());
       importInput.addEventListener('change', (e) => this.importTools(e));
     } else {
       console.error('🔍 DEBUG ERROR: Import/Export elements not found!');
     }
    
    // Add event delegation for table and cards action buttons
    const tbody = document.querySelector('#toolsTable tbody');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        if (btn.classList.contains('edit-tool-btn')) this.editTool(id);
        else if (btn.classList.contains('delete-tool-btn')) this.deleteTool(id);
      });
    }

    const cards = document.getElementById('tools-cards');
    if (cards) {
      cards.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        if (btn.classList.contains('edit-tool-btn')) this.editTool(id);
        else if (btn.classList.contains('delete-tool-btn')) this.deleteTool(id);
      });
    }
  }

  exportTools() {
    try {
      const dataStr = JSON.stringify(this.tools, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `tools_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      this.showStatus('Tools exported successfully!');
    } catch (error) {
      console.error('Error exporting tools:', error);
      this.showStatus('Error exporting tools: ' + error.message, true);
    }
  }

  async importTools(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importedTools = JSON.parse(text);
      
      if (!Array.isArray(importedTools)) {
        throw new Error('Invalid file format. Expected an array of tools.');
      }

      // Validate tool structure
      for (const tool of importedTools) {
        if (!tool.id || !tool.name) {
          throw new Error('Invalid tool format. Missing required fields.');
        }
      }

      // Merge with existing tools (avoid duplicates by ID)
      const existingIds = new Set(this.tools.map(tool => tool.id));
      const newTools = importedTools.filter(tool => !existingIds.has(tool.id));
      
      this.tools = [...this.tools, ...newTools];
      
      await new Promise(resolve => {
        chrome.storage.local.set({ promptPaulTools: this.tools }, resolve);
      });

      this.renderToolsList();
      this.showStatus(`Successfully imported ${newTools.length} tools!`);
      
      // Clear the file input
      event.target.value = '';
    } catch (error) {
      console.error('Error importing tools:', error);
      this.showStatus('Error importing tools: ' + error.message, true);
    }
  }
}

export { ToolManager };