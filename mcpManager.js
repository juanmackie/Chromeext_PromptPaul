// ===== MCP (Model Context Protocol) Management Module =====

import { loadingManager } from './loadingManager.js';

class McpManager {
  constructor() {
    this.servers = [];
    this.editingServerId = null;
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

  redactAuth(value) {
    if (!value) return '';
    // Preserve scheme e.g. 'Bearer ' then mask token
    const parts = value.split(/\s+/, 2);
    if (parts.length === 2) {
      const token = parts[1];
      const masked = token.length > 8 ? token.slice(0, 2) + '•'.repeat(token.length - 4) + token.slice(-2) : '•'.repeat(token.length);
      return parts[0] + ' ' + masked;
    }
    return '•'.repeat(Math.min(12, value.length));
  }

  validateWss(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === 'wss:';
    } catch {
      return false;
    }
  }

  closeModal() {
    this.editingServerId = null;
    const modal = document.getElementById('mcpServerModal');
    if (modal) {
      modal.classList.add('hidden');
    }

    // Clear form fields
    const fields = ['mcpName', 'mcpUrl', 'mcpAuth', 'mcpTimeout', 'mcpBackoffBase', 'mcpBackoffMax', 'mcpBackoffFactor', 'mcpBackoffJitter'];
    fields.forEach(id => {
      const element = document.getElementById(id);
      if (element) element.value = '';
    });

    // Reset checkboxes
    const checkboxes = ['mcpAllowlisted', 'mcpEnabled', 'mcpSensitiveConfirm'];
    checkboxes.forEach(id => {
      const element = document.getElementById(id);
      if (element) element.checked = id === 'mcpEnabled' || id === 'mcpSensitiveConfirm';
    });

    // Set default values
    const defaults = {
      mcpTimeout: 20000,
      mcpBackoffBase: 500,
      mcpBackoffMax: 10000,
      mcpBackoffFactor: 2,
      mcpBackoffJitter: 0.2
    };
    
    Object.entries(defaults).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.value = value;
    });

    // Clear error messages
    const urlErr = document.getElementById('mcpUrlError');
    if (urlErr) urlErr.textContent = '';
  }

  openModal(server = null) {
    const modal = document.getElementById('mcpServerModal');
    const modalTitle = document.getElementById('mcpModalTitle');
    
    if (!modal) return;

    modal.classList.remove('hidden');
    
    if (server) {
      this.editingServerId = server.id;
      if (modalTitle) modalTitle.textContent = 'Edit MCP Server';
      
      // Populate form with server data
      const fields = {
        mcpName: server.name,
        mcpUrl: server.url,
        mcpAuth: server.auth,
        mcpTimeout: server.timeout,
        mcpBackoffBase: server.backoffBase,
        mcpBackoffMax: server.backoffMax,
        mcpBackoffFactor: server.backoffFactor,
        mcpBackoffJitter: server.backoffJitter
      };
      
      Object.entries(fields).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element && value !== undefined) element.value = value;
      });

      const checkboxes = {
        mcpAllowlisted: server.allowlisted,
        mcpEnabled: server.enabled,
        mcpSensitiveConfirm: true
      };
      
      Object.entries(checkboxes).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.checked = !!value;
      });
    } else {
      if (modalTitle) modalTitle.textContent = 'Add MCP Server';
    }
  }

  async renderServers() {
    const tbody = document.getElementById('mcpServersTbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['mcpServers'], resolve);
      });

      this.servers = result.mcpServers || [];

      if (this.servers.length === 0) {
        const row = tbody.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 6;
        cell.textContent = 'No MCP servers configured';
        cell.style.textAlign = 'center';
        cell.style.padding = '20px';
        cell.style.color = '#666';
        return;
      }

      this.servers.forEach(server => {
        const row = tbody.insertRow();
        row.innerHTML = `
          <td>${this.escapeHtml(server.name)}</td>
          <td title="${this.escapeHtml(server.url)}">${this.escapeHtml(server.url.substring(0, 40))}${server.url.length > 40 ? '...' : ''}</td>
          <td>${this.redactAuth(server.auth)}</td>
          <td>
            <span class="status-badge ${server.enabled ? 'enabled' : 'disabled'}">
              ${server.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </td>
          <td>
            <span class="status-badge ${server.allowlisted ? 'allowlisted' : 'not-allowlisted'}">
              ${server.allowlisted ? 'Yes' : 'No'}
            </span>
          </td>
          <td>
            <button onclick="window.mcpManager.openModal(${JSON.stringify(server).replace(/"/g, '&quot;')})" class="btn-edit">Edit</button>
            <button onclick="window.mcpManager.deleteServer('${server.id}')" class="btn-delete">Delete</button>
            <button onclick="window.mcpManager.testServer('${server.id}')" class="btn-test">Test</button>
          </td>
        `;
      });
    } catch (error) {
      console.error('Error rendering servers:', error);
      this.showStatus('Error loading MCP servers: ' + error.message, true);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async renderLogs() {
    const logsDiv = document.getElementById('mcpLogs');
    if (!logsDiv) return;

    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['mcpLogs'], resolve);
      });

      const logs = result.mcpLogs || [];
      
      if (logs.length === 0) {
        logsDiv.innerHTML = '<p>No MCP logs available</p>';
        return;
      }

      logsDiv.innerHTML = logs.slice(-50).reverse().map(log => {
        const timestamp = new Date(log.timestamp || log.ts || Date.now()).toLocaleString();
        const level = log.level || 'info';
        const message = log.message || log.msg || 'No message';
        
        return `
          <div class="log-entry log-${level}">
            <span class="log-timestamp">${timestamp}</span>
            <span class="log-level">${level.toUpperCase()}</span>
            <span class="log-message">${this.escapeHtml(message)}</span>
          </div>
        `;
      }).join('');
    } catch (error) {
      console.error('Error rendering logs:', error);
      logsDiv.innerHTML = '<p>Error loading logs</p>';
    }
  }

  async saveServer() {
    const name = document.getElementById('mcpName')?.value.trim();
    const url = document.getElementById('mcpUrl')?.value.trim();
    const auth = document.getElementById('mcpAuth')?.value.trim();
    const allowlisted = document.getElementById('mcpAllowlisted')?.checked;
    const enabled = document.getElementById('mcpEnabled')?.checked;
    const timeout = parseInt(document.getElementById('mcpTimeout')?.value) || 20000;
    const backoffBase = parseInt(document.getElementById('mcpBackoffBase')?.value) || 500;
    const backoffMax = parseInt(document.getElementById('mcpBackoffMax')?.value) || 10000;
    const backoffFactor = parseFloat(document.getElementById('mcpBackoffFactor')?.value) || 2;
    const backoffJitter = parseFloat(document.getElementById('mcpBackoffJitter')?.value) || 0.2;

    const urlErr = document.getElementById('mcpUrlError');
    if (urlErr) urlErr.textContent = '';

    if (!name || !url) {
      this.showStatus('Please fill in name and URL fields.', true);
      return;
    }

    if (!this.validateWss(url)) {
      if (urlErr) urlErr.textContent = 'URL must use wss:// protocol';
      this.showStatus('Invalid URL format. Must use wss:// protocol.', true);
      return;
    }

    const serverData = {
      id: this.editingServerId || `mcp_${Date.now()}`,
      name,
      url,
      auth,
      allowlisted,
      enabled,
      timeout,
      backoffBase,
      backoffMax,
      backoffFactor,
      backoffJitter,
      createdAt: this.editingServerId ? undefined : Date.now(),
      updatedAt: Date.now()
    };

    try {
      // Check for duplicate names or URLs
      const existingServer = this.servers.find(server => 
        (server.name === name || server.url === url) && server.id !== this.editingServerId
      );
      
      if (existingServer) {
        this.showStatus('A server with this name or URL already exists.', true);
        return;
      }

      // Update servers array
      if (this.editingServerId) {
        const index = this.servers.findIndex(server => server.id === this.editingServerId);
        if (index >= 0) {
          this.servers[index] = { ...this.servers[index], ...serverData };
        }
      } else {
        this.servers.push(serverData);
      }

      // Save to storage
      await new Promise(resolve => {
        chrome.storage.local.set({ mcpServers: this.servers }, resolve);
      });

      this.showStatus(this.editingServerId ? 'MCP server updated successfully!' : 'MCP server added successfully!');
      this.closeModal();
      this.renderServers();
    } catch (error) {
      console.error('Error saving MCP server:', error);
      this.showStatus('Error saving MCP server: ' + error.message, true);
    }
  }

  async deleteServer(serverId) {
    if (!confirm('Are you sure you want to delete this MCP server?')) {
      return;
    }

    try {
      this.servers = this.servers.filter(server => server.id !== serverId);
      
      await new Promise(resolve => {
        chrome.storage.local.set({ mcpServers: this.servers }, resolve);
      });

      this.showStatus('MCP server deleted successfully!');
      this.renderServers();
    } catch (error) {
      console.error('Error deleting MCP server:', error);
      this.showStatus('Error deleting MCP server: ' + error.message, true);
    }
  }

  async testServer(serverId) {
    const server = this.servers.find(s => s.id === serverId);
    if (!server) {
      this.showStatus('Server not found.', true);
      return;
    }

    try {
      this.showStatus('Testing MCP server connection...');
      
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'testMcpServer',
          serverUrl: server.url,
          serverAuth: server.auth
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      if (response && response.success) {
        this.showStatus('MCP server connection successful!');
      } else {
        this.showStatus('MCP server connection failed: ' + (response?.error || 'Unknown error'), true);
      }
    } catch (error) {
      console.error('Error testing MCP server:', error);
      this.showStatus('MCP server test failed: ' + error.message, true);
    }
  }

  setupEventHandlers() {
    // Add server button
    const addBtn = document.getElementById('mcpAddServerBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.openModal());
    }

    // Modal save button
    const modalSave = document.getElementById('mcpSaveServerBtn');
    if (modalSave) {
      modalSave.addEventListener('click', () => this.saveServer());
    }

    // Modal cancel button
    const modalCancel = document.getElementById('mcpCancelServerBtn');
    if (modalCancel) {
      modalCancel.addEventListener('click', () => this.closeModal());
    }

    // Export button
    const exportBtn = document.getElementById('mcpExportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportServers());
    }

    // Import button and file input
    const importBtn = document.getElementById('mcpImportBtn');
    const importFile = document.getElementById('mcpImportFile');
    
    if (importBtn && importFile) {
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', (e) => this.importServers(e));
    }

    // Verbose logs toggle
    const verboseToggle = document.getElementById('mcpVerboseLogsToggle');
    if (verboseToggle) {
      verboseToggle.addEventListener('change', (e) => {
        chrome.storage.local.set({ mcpVerboseLogs: e.target.checked });
      });
    }
  }

  exportServers() {
    try {
      const dataStr = JSON.stringify(this.servers, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `mcp_servers_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      this.showStatus('MCP servers exported successfully!');
    } catch (error) {
      console.error('Error exporting MCP servers:', error);
      this.showStatus('Error exporting MCP servers: ' + error.message, true);
    }
  }

  async importServers(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importedServers = JSON.parse(text);
      
      if (!Array.isArray(importedServers)) {
        throw new Error('Invalid file format. Expected an array of servers.');
      }

      // Validate server structure
      for (const server of importedServers) {
        if (!server.id || !server.name || !server.url) {
          throw new Error('Invalid server format. Missing required fields.');
        }
      }

      // Merge with existing servers (avoid duplicates by ID)
      const existingIds = new Set(this.servers.map(server => server.id));
      const newServers = importedServers.filter(server => !existingIds.has(server.id));
      
      this.servers = [...this.servers, ...newServers];
      
      await new Promise(resolve => {
        chrome.storage.local.set({ mcpServers: this.servers }, resolve);
      });

      this.renderServers();
      this.showStatus(`Successfully imported ${newServers.length} MCP servers!`);
      
      // Clear the file input
      event.target.value = '';
    } catch (error) {
      console.error('Error importing MCP servers:', error);
      this.showStatus('Error importing MCP servers: ' + error.message, true);
    }
  }
}

export { McpManager };