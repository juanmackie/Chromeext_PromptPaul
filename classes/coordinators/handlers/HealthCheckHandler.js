import { BaseManager } from '../../managers/BaseManager.js';

/**
 * Health Check Handler for Background Coordinator
 * Implements the Single Responsibility Principle for health monitoring
 */
export class HealthCheckHandler extends BaseManager {
  constructor(coordinator) {
    super();
    this.coordinator = coordinator;
    this.healthCheckInterval = null;
    this.lastHealthCheck = null;
    this.healthCheckFrequency = 120000; // 2 minutes
  }

  /**
   * Set up periodic health check
   */
  setupHealthCheck() {
    // Run initial health check
    this.performHealthCheck();
    
    // Set up periodic health check
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.healthCheckFrequency);
  }

  /**
   * Stop health check monitoring
   */
  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck() {
    const timestamp = Date.now();
    console.log('BackgroundCoordinator: Performing health check at', new Date(timestamp).toISOString());
    
    try {
      const healthStatus = {
        timestamp: timestamp,
        coordinator: await this.checkCoordinatorHealth(),
        managers: await this.checkManagersHealth(),
        mcpSessions: await this.checkMcpSessionsHealth(),
        storage: await this.checkStorageHealth(),
        permissions: await this.checkPermissionsHealth()
      };
      
      this.lastHealthCheck = healthStatus;
      
      // Log any issues found
      this.logHealthIssues(healthStatus);
      
      // Perform cleanup if needed
      await this.performHealthMaintenance(healthStatus);
      
      console.log('BackgroundCoordinator: Health check completed successfully');
      
    } catch (error) {
      console.error('BackgroundCoordinator: Health check failed:', error);
    }
  }

  /**
   * Check coordinator health
   * @returns {Promise<Object>} - Health status
   */
  async checkCoordinatorHealth() {
    return {
      status: 'healthy',
      activeToolExecutions: this.coordinator.activeToolExecutions.size,
      tabContentCallback: !!this.coordinator.tabContentCallback,
      pinnedActionTabContentCallback: !!this.coordinator.pinnedActionTabContentCallback,
      uptime: Date.now() - (this.coordinator.startTime || Date.now())
    };
  }

  /**
   * Check managers health
   * @returns {Promise<Object>} - Health status
   */
  async checkManagersHealth() {
    const managers = {
      configManager: this.coordinator.configManager,
      toolManager: this.coordinator.toolManager,
      mcpManager: this.coordinator.mcpManager,
      storageManager: this.coordinator.storageManager,
      messagingManager: this.coordinator.messagingManager
    };

    const health = {};
    
    for (const [name, manager] of Object.entries(managers)) {
      try {
        health[name] = {
          status: manager ? 'healthy' : 'missing',
          initialized: manager?.initialized || false,
          lastActivity: manager?.lastActivity || null
        };
      } catch (error) {
        health[name] = {
          status: 'error',
          error: error.message
        };
      }
    }
    
    return health;
  }

  /**
   * Check MCP sessions health
   * @returns {Promise<Object>} - Health status
   */
  async checkMcpSessionsHealth() {
    try {
      const sessions = this.coordinator.mcpManager.mcpSessions || {};
      const sessionCount = Object.keys(sessions).length;
      const healthySessions = [];
      const staleSessions = [];
      const errorSessions = [];
      
      const now = Date.now();
      
      for (const [url, session] of Object.entries(sessions)) {
        try {
          if (this.coordinator.mcpManager.isSessionHealthy(session)) {
            healthySessions.push(url);
          } else {
            const age = now - (session.lastUsed || session.createdAt || 0);
            if (age > this.coordinator.mcpManager.MCP_SESSION_MAX_AGE) {
              staleSessions.push({ url, age });
            } else {
              errorSessions.push({ url, reason: 'unhealthy' });
            }
          }
        } catch (error) {
          errorSessions.push({ url, reason: error.message });
        }
      }
      
      return {
        status: errorSessions.length === 0 ? 'healthy' : 'degraded',
        totalSessions: sessionCount,
        healthySessions: healthySessions.length,
        staleSessions: staleSessions.length,
        errorSessions: errorSessions.length,
        staleSessionDetails: staleSessions,
        errorSessionDetails: errorSessions
      };
      
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Check storage health
   * @returns {Promise<Object>} - Health status
   */
  async checkStorageHealth() {
    try {
      // Test storage read/write
      const testKey = 'healthCheck_' + Date.now();
      const testValue = { timestamp: Date.now(), test: true };
      
      await this.coordinator.storageManager.setLocal({ [testKey]: testValue });
      const result = await this.coordinator.storageManager.getLocal(testKey);
      await this.coordinator.storageManager.removeLocal(testKey);
      
      const retrieved = result[testKey];
      const isWorking = retrieved && retrieved.timestamp === testValue.timestamp;
      
      return {
        status: isWorking ? 'healthy' : 'error',
        readWrite: isWorking,
        error: isWorking ? null : 'Storage read/write test failed'
      };
      
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Check permissions health
   * @returns {Promise<Object>} - Health status
   */
  async checkPermissionsHealth() {
    try {
      const permissions = {
        storage: false,
        activeTab: false,
        scripting: false,
        contextMenus: false,
        sidePanel: false
      };
      
      // Check storage permission
      try {
        await chrome.storage.local.get('test');
        permissions.storage = true;
      } catch (e) {
        // Storage permission missing
      }
      
      // Check activeTab permission
      try {
        await chrome.tabs.query({ active: true });
        permissions.activeTab = true;
      } catch (e) {
        // ActiveTab permission missing
      }
      
      // Check scripting permission
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
          permissions.scripting = true; // Assume scripting works if we can query tabs
        }
      } catch (e) {
        // Scripting permission missing
      }
      
      // Check contextMenus permission
      try {
        // Test contextMenus permission without removing existing menus
        // Just try to access the API to verify permission
        await chrome.contextMenus.create({
          id: 'healthcheck_temp',
          title: 'temp',
          contexts: ['selection']
        });
        await chrome.contextMenus.remove('healthcheck_temp');
        permissions.contextMenus = true;
      } catch (e) {
        // ContextMenus permission missing
      }
      
      // Check sidePanel permission
      try {
        await chrome.sidePanel.getOptions({});
        permissions.sidePanel = true;
      } catch (e) {
        // SidePanel permission missing or not supported
      }
      
      const allPermissionsValid = Object.values(permissions).every(p => p);
      
      return {
        status: allPermissionsValid ? 'healthy' : 'degraded',
        permissions: permissions,
        missingPermissions: Object.entries(permissions)
          .filter(([, granted]) => !granted)
          .map(([permission]) => permission)
      };
      
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Log health issues
   * @param {Object} healthStatus - Health status object
   */
  logHealthIssues(healthStatus) {
    // Log MCP session issues
    if (healthStatus.mcpSessions.staleSessions > 0) {
      console.warn(`BackgroundCoordinator: Found ${healthStatus.mcpSessions.staleSessions} stale MCP sessions`);
    }
    
    if (healthStatus.mcpSessions.errorSessions > 0) {
      console.error(`BackgroundCoordinator: Found ${healthStatus.mcpSessions.errorSessions} error MCP sessions:`, 
        healthStatus.mcpSessions.errorSessionDetails);
    }
    
    // Log storage issues
    if (healthStatus.storage.status !== 'healthy') {
      console.error('BackgroundCoordinator: Storage health issue:', healthStatus.storage.error);
    }
    
    // Log permission issues
    if (healthStatus.permissions.status !== 'healthy') {
      console.warn('BackgroundCoordinator: Missing permissions:', healthStatus.permissions.missingPermissions);
    }
    
    // Log manager issues
    for (const [name, status] of Object.entries(healthStatus.managers)) {
      if (status.status !== 'healthy') {
        console.error(`BackgroundCoordinator: Manager '${name}' is unhealthy:`, status);
      }
    }
  }

  /**
   * Perform health maintenance
   * @param {Object} healthStatus - Health status object
   */
  async performHealthMaintenance(healthStatus) {
    try {
      // Clean up stale MCP sessions
      if (healthStatus.mcpSessions.staleSessionDetails?.length > 0) {
        console.log('BackgroundCoordinator: Cleaning up stale MCP sessions');
        
        for (const staleSession of healthStatus.mcpSessions.staleSessionDetails) {
          try {
            delete this.coordinator.mcpManager.mcpSessions[staleSession.url];
            console.log(`BackgroundCoordinator: Cleaned up stale session for ${staleSession.url}`);
          } catch (error) {
            console.error(`BackgroundCoordinator: Error cleaning up session ${staleSession.url}:`, error);
          }
        }
      }
      
      // Clean up error MCP sessions
      if (healthStatus.mcpSessions.errorSessionDetails?.length > 0) {
        console.log('BackgroundCoordinator: Cleaning up error MCP sessions');
        
        for (const errorSession of healthStatus.mcpSessions.errorSessionDetails) {
          try {
            delete this.coordinator.mcpManager.mcpSessions[errorSession.url];
            console.log(`BackgroundCoordinator: Cleaned up error session for ${errorSession.url}`);
          } catch (error) {
            console.error(`BackgroundCoordinator: Error cleaning up session ${errorSession.url}:`, error);
          }
        }
      }
      
      // Clean up completed tool executions if too many are tracked
      if (healthStatus.coordinator.activeToolExecutions > 100) {
        console.warn('BackgroundCoordinator: Too many active tool executions, clearing set');
        this.coordinator.activeToolExecutions.clear();
      }
      
    } catch (error) {
      console.error('BackgroundCoordinator: Error during health maintenance:', error);
    }
  }

  /**
   * Get last health check results
   * @returns {Object|null} - Last health check results
   */
  getLastHealthCheck() {
    return this.lastHealthCheck;
  }

  /**
   * Force health check
   * @returns {Promise<Object>} - Health check results
   */
  async forceHealthCheck() {
    await this.performHealthCheck();
    return this.lastHealthCheck;
  }
}