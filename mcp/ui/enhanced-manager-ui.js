/**
 * Enhanced MCP Manager UI
 * Single Responsibility: Handle UI interactions for MCP server management
 * Testability: Dependency injection for DOM and manager
 */

export class EnhancedMcpManagerUI {
  constructor(mcpManager, domHelper = null, logger = console) {
    this.mcpManager = mcpManager;
    this.domHelper = domHelper || new DomHelper();
    this.logger = logger;
    this.currentView = 'servers';
    this.editingServerId = null;
    this.transportTypes = ['stdio', 'http-sse', 'websocket'];
  }

  /**
   * Initialize UI and setup event handlers
   */
  async initialize() {
    try {
      this.setupEventHandlers();
      this.setupMcpManagerHandlers();
      await this.renderServers();
      await this.loadSettings();
      
      this.logger.info('Enhanced MCP Manager UI initialized');
    } catch (error) {
      this.logger.error('Failed to initialize UI:', error);
      this.showStatus('Failed to initialize MCP Manager UI', true);
    }
  }

  /**
   * Setup DOM event handlers
   */
  setupEventHandlers() {
    // Navigation
    this.domHelper.onClick('mcpNavServers', () => this.switchView('servers'));
    this.domHelper.onClick('mcpNavLogs', () => this.switchView('logs'));
    this.domHelper.onClick('mcpNavSettings', () => this.switchView('settings'));

    // Server management
    this.domHelper.onClick('mcpAddServerBtn', () => this.openServerModal());
    this.domHelper.onClick('mcpSaveServerBtn', () => this.saveServer());
    this.domHelper.onClick('mcpCancelServerBtn', () => this.closeServerModal());

    // Import/Export
    this.domHelper.onClick('mcpExportBtn', () => this.exportServers());
    this.domHelper.onClick('mcpImportBtn', () => this.triggerImport());
    this.domHelper.onChange('mcpImportFile', (e) => this.importServers(e));

    // Transport type change
    this.domHelper.onChange('mcpTransportType', (e) => this.handleTransportTypeChange(e));

    // Modal close
    this.domHelper.onClick('mcpServerModal', (e) => {
      if (e.target.id === 'mcpServerModal') {
        this.closeServerModal();
      }
    });

    // Settings
    this.domHelper.onChange('mcpVerboseLogsToggle', (e) => this.updateSettings({ verboseLogs: e.target.checked }));
    this.domHelper.onChange('mcpAutoConnectToggle', (e) => this.updateSettings({ autoConnect: e.target.checked }));
  }

  /**
   * Setup MCP manager event handlers
   */
  setupMcpManagerHandlers() {
    this.mcpManager.on('serverAdded', () => this.renderServers());
    this.mcpManager.on('serverUpdated', () => this.renderServers());
    this.mcpManager.on('serverDeleted', () => this.renderServers());
    this.mcpManager.on('serverConnected', (data) => this.handleServerConnected(data));
    this.mcpManager.on('serverDisconnected', (data) => this.handleServerDisconnected(data));
    this.mcpManager.on('serversImported', (data) => this.handleServersImported(data));
  }

  /**
   * Switch between different views
   */
  switchView(view) {
    this.currentView = view;
    
    // Update navigation
    this.domHelper.removeClass('mcpNavServers', 'active');
    this.domHelper.removeClass('mcpNavLogs', 'active');
    this.domHelper.removeClass('mcpNavSettings', 'active');
    this.domHelper.addClass(`mcpNav${view.charAt(0).toUpperCase() + view.slice(1)}`, 'active');

    // Update content
    this.domHelper.hide('mcpServersView');
    this.domHelper.hide('mcpLogsView');
    this.domHelper.hide('mcpSettingsView');
    this.domHelper.show(`mcp${view.charAt(0).toUpperCase() + view.slice(1)}View`);

    // Load view-specific content
    switch (view) {
      case 'servers':
        this.renderServers();
        break;
      case 'logs':
        this.renderLogs();
        break;
      case 'settings':
        this.renderSettings();
        break;
    }
  }

  /**
   * Render servers table
   */
  async renderServers() {
    const tbody = this.domHelper.getElement('mcpServersTbody');
    if (!tbody) return;

    try {
      const servers = this.mcpManager.getAllServers();
      tbody.innerHTML = '';

      if (servers.length === 0) {
        this.renderEmptyServersState(tbody);
        return;
      }

      for (const server of servers) {
        const row = this.createServerRow(server);
        tbody.appendChild(row);
      }
    } catch (error) {
      this.logger.error('Failed to render servers:', error);
      this.showStatus('Failed to load servers', true);
    }
  }

  /**
   * Render empty servers state
   */
  renderEmptyServersState(tbody) {
    const row = tbody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 7;
    cell.innerHTML = `
      <div class="empty-state">
        <h3>No MCP Servers Configured</h3>
        <p>Add your first MCP server to get started.</p>
        <button onclick="window.enhancedMcpManagerUI.openServerModal()" class="btn-primary">
          Add Server
        </button>
      </div>
    `;
    cell.style.textAlign = 'center';
    cell.style.padding = '40px';
  }

  /**
   * Create server table row
   */
  createServerRow(server) {
    const row = document.createElement('tr');
    const isConnected = this.mcpManager.activeTransports.has(server.id);
    
    row.innerHTML = `
      <td>
        <div class="server-name">
          ${this.escapeHtml(server.name)}
          <span class="server-type">${server.type}</span>
        </div>
      </td>
      <td>
        <div class="server-config">
          ${this.renderServerConfig(server)}
        </div>
      </td>
      <td>
        <span class="status-badge ${server.enabled ? 'enabled' : 'disabled'}">
          ${server.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </td>
      <td>
        <span class="status-badge ${isConnected ? 'connected' : 'disconnected'}">
          ${isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </td>
      <td>
        <span class="status-badge ${server.allowlisted ? 'allowlisted' : 'not-allowlisted'}">
          ${server.allowlisted ? 'Allowlisted' : 'Standard'}
        </span>
      </td>
      <td>
        <span class="server-source">${server.source}</span>
      </td>
      <td>
        <div class="server-actions">
          ${this.renderServerActions(server, isConnected)}
        </div>
      </td>
    `;

    return row;
  }

  /**
   * Render server configuration display
   */
  renderServerConfig(server) {
    switch (server.type) {
      case 'stdio':
        return `
          <strong>Command:</strong> ${this.escapeHtml(server.config.command)}<br>
          <strong>Args:</strong> ${server.config.args ? server.config.args.join(' ') : 'None'}
        `;
      case 'http-sse':
        return `
          <strong>URL:</strong> ${this.escapeHtml(server.config.url)}<br>
          <strong>Headers:</strong> ${Object.keys(server.config.headers || {}).length} configured
        `;
      case 'websocket':
        return `
          <strong>URL:</strong> ${this.escapeHtml(server.config.url)}<br>
          <strong>Auth:</strong> ${server.config.auth ? 'Configured' : 'None'}
        `;
      default:
        return 'Unknown configuration';
    }
  }

  /**
   * Render server action buttons
   */
  renderServerActions(server, isConnected) {
    return `
      <button onclick="window.enhancedMcpManagerUI.editServer('${server.id}')" 
              class="btn-edit" title="Edit Server">
        Edit
      </button>
      <button onclick="window.enhancedMcpManagerUI.testServer('${server.id}')" 
              class="btn-test" title="Test Connection">
        Test
      </button>
      ${isConnected ? 
        `<button onclick="window.enhancedMcpManagerUI.disconnectServer('${server.id}')" 
                 class="btn-disconnect" title="Disconnect">
          Disconnect
         </button>` :
        `<button onclick="window.enhancedMcpManagerUI.connectServer('${server.id}')" 
                 class="btn-connect" title="Connect">
          Connect
         </button>`
      }
      <button onclick="window.enhancedMcpManagerUI.deleteServer('${server.id}')" 
              class="btn-delete" title="Delete Server">
        Delete
      </button>
    `;
  }

  /**
   * Open server configuration modal
   */
  openServerModal(serverId = null) {
    const modal = this.domHelper.getElement('mcpServerModal');
    const title = this.domHelper.getElement('mcpModalTitle');
    
    if (!modal) return;

    this.editingServerId = serverId;
    
    if (serverId) {
      const server = this.mcpManager.servers.get(serverId);
      if (server) {
        title.textContent = 'Edit MCP Server';
        this.populateServerForm(server);
      }
    } else {
      title.textContent = 'Add MCP Server';
      this.resetServerForm();
    }

    this.domHelper.show('mcpServerModal');
  }

  /**
   * Close server configuration modal
   */
  closeServerModal() {
    this.domHelper.hide('mcpServerModal');
    this.editingServerId = null;
    this.resetServerForm();
  }

  /**
   * Populate server form with existing data
   */
  populateServerForm(server) {
    this.domHelper.setValue('mcpServerName', server.name);
    this.domHelper.setValue('mcpTransportType', server.type);
    this.domHelper.setChecked('mcpServerEnabled', server.enabled);
    this.domHelper.setChecked('mcpServerAllowlisted', server.allowlisted);

    this.showTransportConfig(server.type);
    this.populateTransportConfig(server.type, server.config);
  }

  /**
   * Reset server form to defaults
   */
  resetServerForm() {
    this.domHelper.setValue('mcpServerName', '');
    this.domHelper.setValue('mcpTransportType', 'stdio');
    this.domHelper.setChecked('mcpServerEnabled', true);
    this.domHelper.setChecked('mcpServerAllowlisted', false);
    
    this.showTransportConfig('stdio');
    this.clearTransportConfigs();
  }

  /**
   * Handle transport type change
   */
  handleTransportTypeChange(event) {
    const transportType = event.target.value;
    this.showTransportConfig(transportType);
  }

  /**
   * Show configuration fields for transport type
   */
  showTransportConfig(transportType) {
    // Hide all transport configs
    this.domHelper.hide('mcpStdioConfig');
    this.domHelper.hide('mcpHttpSseConfig');
    this.domHelper.hide('mcpWebSocketConfig');

    // Show relevant config
    switch (transportType) {
      case 'stdio':
        this.domHelper.show('mcpStdioConfig');
        break;
      case 'http-sse':
        this.domHelper.show('mcpHttpSseConfig');
        break;
      case 'websocket':
        this.domHelper.show('mcpWebSocketConfig');
        break;
    }
  }

  /**
   * Populate transport-specific configuration
   */
  populateTransportConfig(transportType, config) {
    switch (transportType) {
      case 'stdio':
        this.domHelper.setValue('mcpStdioCommand', config.command || '');
        this.domHelper.setValue('mcpStdioArgs', config.args ? config.args.join(' ') : '');
        this.domHelper.setValue('mcpStdioEnv', config.env ? JSON.stringify(config.env, null, 2) : '{}');
        break;
      case 'http-sse':
        this.domHelper.setValue('mcpHttpUrl', config.url || '');
        this.domHelper.setValue('mcpHttpHeaders', config.headers ? JSON.stringify(config.headers, null, 2) : '{}');
        break;
      case 'websocket':
        this.domHelper.setValue('mcpWsUrl', config.url || '');
        this.domHelper.setValue('mcpWsAuth', config.auth || '');
        break;
    }
  }

  /**
   * Clear all transport configuration fields
   */
  clearTransportConfigs() {
    // Stdio
    this.domHelper.setValue('mcpStdioCommand', '');
    this.domHelper.setValue('mcpStdioArgs', '');
    this.domHelper.setValue('mcpStdioEnv', '{}');
    
    // HTTP/SSE
    this.domHelper.setValue('mcpHttpUrl', '');
    this.domHelper.setValue('mcpHttpHeaders', '{}');
    
    // WebSocket
    this.domHelper.setValue('mcpWsUrl', '');
    this.domHelper.setValue('mcpWsAuth', '');
  }

  /**
   * Save server configuration
   */
  async saveServer() {
    try {
      const serverData = this.collectServerData();
      
      if (this.editingServerId) {
        await this.mcpManager.updateServer(this.editingServerId, serverData);
        this.showStatus('Server updated successfully');
      } else {
        await this.mcpManager.addStandardServer(serverData.name, serverData.config);
        this.showStatus('Server added successfully');
      }
      
      this.closeServerModal();
    } catch (error) {
      this.logger.error('Failed to save server:', error);
      this.showStatus(error.message, true);
    }
  }

  /**
   * Collect server data from form
   */
  collectServerData() {
    const name = this.domHelper.getValue('mcpServerName').trim();
    const transportType = this.domHelper.getValue('mcpTransportType');
    const enabled = this.domHelper.getChecked('mcpServerEnabled');
    const allowlisted = this.domHelper.getChecked('mcpServerAllowlisted');

    if (!name) {
      throw new Error('Server name is required');
    }

    const config = this.collectTransportConfig(transportType);
    config.enabled = enabled;
    config.allowlisted = allowlisted;

    return { name, config };
  }

  /**
   * Collect transport-specific configuration
   */
  collectTransportConfig(transportType) {
    switch (transportType) {
      case 'stdio':
        return this.collectStdioConfig();
      case 'http-sse':
        return this.collectHttpSseConfig();
      case 'websocket':
        return this.collectWebSocketConfig();
      default:
        throw new Error(`Unknown transport type: ${transportType}`);
    }
  }

  /**
   * Collect stdio configuration
   */
  collectStdioConfig() {
    const command = this.domHelper.getValue('mcpStdioCommand').trim();
    const argsStr = this.domHelper.getValue('mcpStdioArgs').trim();
    const envStr = this.domHelper.getValue('mcpStdioEnv').trim();

    if (!command) {
      throw new Error('Command is required for stdio transport');
    }

    const config = {
      type: 'stdio',
      command
    };

    if (argsStr) {
      config.args = argsStr.split(/\s+/).filter(arg => arg.length > 0);
    }

    if (envStr && envStr !== '{}') {
      try {
        config.env = JSON.parse(envStr);
      } catch (error) {
        throw new Error('Invalid JSON in environment variables');
      }
    }

    return config;
  }

  /**
   * Collect HTTP/SSE configuration
   */
  collectHttpSseConfig() {
    const url = this.domHelper.getValue('mcpHttpUrl').trim();
    const headersStr = this.domHelper.getValue('mcpHttpHeaders').trim();

    if (!url) {
      throw new Error('URL is required for HTTP/SSE transport');
    }

    const config = {
      type: 'http-sse',
      url
    };

    if (headersStr && headersStr !== '{}') {
      try {
        config.headers = JSON.parse(headersStr);
      } catch (error) {
        throw new Error('Invalid JSON in headers');
      }
    }

    return config;
  }

  /**
   * Collect WebSocket configuration
   */
  collectWebSocketConfig() {
    const url = this.domHelper.getValue('mcpWsUrl').trim();
    const auth = this.domHelper.getValue('mcpWsAuth').trim();

    if (!url) {
      throw new Error('URL is required for WebSocket transport');
    }

    const config = {
      type: 'websocket',
      url
    };

    if (auth) {
      config.auth = auth;
    }

    return config;
  }

  /**
   * Edit existing server
   */
  editServer(serverId) {
    this.openServerModal(serverId);
  }

  /**
   * Test server connection
   */
  async testServer(serverId) {
    try {
      this.showStatus('Testing server connection...');
      const result = await this.mcpManager.testServer(serverId);
      
      if (result.success) {
        this.showStatus('Connection test successful');
      } else {
        this.showStatus(`Connection test failed: ${result.error}`, true);
      }
    } catch (error) {
      this.logger.error('Failed to test server:', error);
      this.showStatus(`Connection test failed: ${error.message}`, true);
    }
  }

  /**
   * Connect to server
   */
  async connectServer(serverId) {
    try {
      this.showStatus('Connecting to server...');
      await this.mcpManager.connectServer(serverId);
      this.showStatus('Connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to server:', error);
      this.showStatus(`Connection failed: ${error.message}`, true);
    }
  }

  /**
   * Disconnect from server
   */
  async disconnectServer(serverId) {
    try {
      await this.mcpManager.disconnectServer(serverId);
      this.showStatus('Disconnected successfully');
    } catch (error) {
      this.logger.error('Failed to disconnect from server:', error);
      this.showStatus(`Disconnect failed: ${error.message}`, true);
    }
  }

  /**
   * Delete server
   */
  async deleteServer(serverId) {
    const server = this.mcpManager.servers.get(serverId);
    if (!server) return;

    if (!confirm(`Are you sure you want to delete the server "${server.name}"?`)) {
      return;
    }

    try {
      await this.mcpManager.deleteServer(serverId);
      this.showStatus('Server deleted successfully');
    } catch (error) {
      this.logger.error('Failed to delete server:', error);
      this.showStatus(`Delete failed: ${error.message}`, true);
    }
  }

  /**
   * Export servers
   */
  exportServers() {
    try {
      const standardData = this.mcpManager.exportStandardFormat();
      const legacyData = this.mcpManager.exportLegacyFormat();
      
      const exportData = {
        ...standardData,
        legacyServers: legacyData,
        exportedAt: new Date().toISOString(),
        version: '1.0'
      };

      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `mcp_servers_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      this.showStatus('Servers exported successfully');
    } catch (error) {
      this.logger.error('Failed to export servers:', error);
      this.showStatus(`Export failed: ${error.message}`, true);
    }
  }

  /**
   * Trigger import file dialog
   */
  triggerImport() {
    this.domHelper.click('mcpImportFile');
  }

  /**
   * Import servers from file
   */
  async importServers(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      this.showStatus('Importing servers...');
      
      const text = await file.text();
      const data = JSON.parse(text);
      
      const results = await this.mcpManager.importServers(data);
      
      const message = `Import completed: ${results.imported} imported, ${results.skipped} skipped, ${results.errors.length} errors`;
      this.showStatus(message, results.errors.length > 0);
      
      if (results.errors.length > 0) {
        this.logger.warn('Import errors:', results.errors);
      }
      
      // Clear file input
      event.target.value = '';
    } catch (error) {
      this.logger.error('Failed to import servers:', error);
      this.showStatus(`Import failed: ${error.message}`, true);
    }
  }

  /**
   * Handle server connected event
   */
  handleServerConnected(data) {
    this.renderServers();
    this.showStatus(`Connected to ${data.server.name}`);
  }

  /**
   * Handle server disconnected event
   */
  handleServerDisconnected(data) {
    this.renderServers();
    if (data.server) {
      this.showStatus(`Disconnected from ${data.server.name}`);
    }
  }

  /**
   * Handle servers imported event
   */
  handleServersImported(data) {
    this.renderServers();
  }

  /**
   * Render logs view
   */
  async renderLogs() {
    // Implementation for logs view
    const logsContainer = this.domHelper.getElement('mcpLogsContainer');
    if (logsContainer) {
      logsContainer.innerHTML = '<p>Logs functionality coming soon...</p>';
    }
  }

  /**
   * Render settings view
   */
  async renderSettings() {
    // Implementation for settings view
    const settingsContainer = this.domHelper.getElement('mcpSettingsContainer');
    if (settingsContainer) {
      settingsContainer.innerHTML = '<p>Settings functionality coming soon...</p>';
    }
  }

  /**
   * Load settings
   */
  async loadSettings() {
    // Implementation for loading settings
  }

  /**
   * Update settings
   */
  async updateSettings(updates) {
    // Implementation for updating settings
  }

  /**
   * Show status message
   */
  showStatus(message, isError = false) {
    const status = this.domHelper.getElement('mcpStatus');
    if (status) {
      status.textContent = message;
      status.className = `status ${isError ? 'error' : 'success'}`;
      this.domHelper.show('mcpStatus');
      
      if (!isError) {
        setTimeout(() => {
          this.domHelper.hide('mcpStatus');
        }, 3000);
      }
    }
    
    this.logger[isError ? 'error' : 'info'](message);
  }

  /**
   * Escape HTML for safe display
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

/**
 * DOM Helper for testability
 */
class DomHelper {
  getElement(id) {
    return document.getElementById(id);
  }

  getValue(id) {
    const element = this.getElement(id);
    return element ? element.value : '';
  }

  setValue(id, value) {
    const element = this.getElement(id);
    if (element) element.value = value;
  }

  getChecked(id) {
    const element = this.getElement(id);
    return element ? element.checked : false;
  }

  setChecked(id, checked) {
    const element = this.getElement(id);
    if (element) element.checked = checked;
  }

  show(id) {
    const element = this.getElement(id);
    if (element) element.style.display = 'block';
  }

  hide(id) {
    const element = this.getElement(id);
    if (element) element.style.display = 'none';
  }

  addClass(id, className) {
    const element = this.getElement(id);
    if (element) element.classList.add(className);
  }

  removeClass(id, className) {
    const element = this.getElement(id);
    if (element) element.classList.remove(className);
  }

  onClick(id, handler) {
    const element = this.getElement(id);
    if (element) element.addEventListener('click', handler);
  }

  onChange(id, handler) {
    const element = this.getElement(id);
    if (element) element.addEventListener('change', handler);
  }

  click(id) {
    const element = this.getElement(id);
    if (element) element.click();
  }
}

export { DomHelper };