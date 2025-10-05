/**
 * Tool Manager
 * Handles tool management for the options page
 * Implements production-ready coding rules for tool management
 *
 * Core Principles:
 * - Input Validation: Validate all tool data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient tool management with proper caching
 */

import { logger, validators } from '../shared/index.js';

class ToolManager {
  constructor(dependencies) {
    this.storage = dependencies.Storage;
    this.logger = dependencies.Logger;
    this.validator = dependencies.Validator;
    
    // Tool manager configuration
    this.tools = [];
    this.maxTools = 50;
  }

  /**
   * Initializes the tool manager
   */
  async initialize() {
    this.logger.debug('Initializing tool manager');

    try {
      // Load tools from storage
      await this.loadTools();

      this.logger.debug('Tool manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize tool manager', {}, error);
      throw error;
    }
  }

  /**
   * Loads tools from storage
   */
  async loadTools() {
    try {
      const result = await this.storage.get(['promptPaulTools']);
      this.tools = result.promptPaulTools || [];

      this.logger.debug(`Loaded ${this.tools.length} tools from storage`);
    } catch (error) {
      this.logger.error('Failed to load tools from storage', {}, error);
      throw error;
    }
  }

  /**
   * Saves tools to storage
   */
  async saveTools() {
    try {
      await this.storage.set({ promptPaulTools: this.tools });

      this.logger.debug(`Saved ${this.tools.length} tools to storage`);
    } catch (error) {
      this.logger.error('Failed to save tools to storage', {}, error);
      throw error;
    }
  }

  /**
   * Gets all tools
   * @returns {Array} Array of tools
   */
  getTools() {
    return [...this.tools];
  }

  /**
   * Gets a tool by ID
   * @param {string} toolId - Tool ID
   * @returns {Object|null} Tool object or null if not found
   */
  getTool(toolId) {
    if (!toolId || typeof toolId !== 'string') {
      return null;
    }

    return this.tools.find(t => t.id === toolId) || null;
  }

  /**
   * Creates a new tool
   * @param {Object} toolData - Tool data
   * @returns {string} Tool ID
   */
  async createTool(toolData) {
    if (!toolData || typeof toolData !== 'object') {
      throw new Error('Valid tool data object is required');
    }

    this.logger.debug('Creating new tool');

    try {
      // Validate tool data
      const validation = this.validator.validateTool(toolData);
      if (!validation.isValid) {
        throw new Error(`Invalid tool data: ${Object.values(validation.errors).join(', ')}`);
      }

      // Check max tools limit
      if (this.tools.length >= this.maxTools) {
        throw new Error(`Maximum number of tools (${this.maxTools}) reached`);
      }

      // Generate tool ID
      const toolId = 'tool_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

      // Create tool
      const tool = {
        id: toolId,
        name: toolData.name || 'New Tool',
        description: toolData.description || '',
        endpointUrl: toolData.endpointUrl || '',
        httpMethod: toolData.httpMethod || 'POST',
        parameters: toolData.parameters || '{}',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Add to tools
      this.tools.push(tool);

      // Save to storage
      await this.saveTools();

      this.logger.debug(`Tool created successfully: ${toolId}`);

      return toolId;
    } catch (error) {
      this.logger.error('Failed to create tool', {}, error);
      throw error;
    }
  }

  /**
   * Updates a tool
   * @param {string} toolId - Tool ID
   * @param {Object} updates - Tool updates
   * @returns {boolean} True if updated, false if not found
   */
  async updateTool(toolId, updates) {
    if (!toolId || typeof toolId !== 'string') {
      throw new Error('Valid tool ID is required and must be a string');
    }

    if (!updates || typeof updates !== 'object') {
      throw new Error('Valid updates object is required');
    }

    this.logger.debug(`Updating tool: ${toolId}`);

    try {
      const tool = this.tools.find(t => t.id === toolId);
      if (!tool) {
        return false;
      }

      // Validate updates
      const updatedTool = { ...tool, ...updates };
      const validation = this.validator.validateTool(updatedTool);
      if (!validation.isValid) {
        throw new Error(`Invalid tool data: ${Object.values(validation.errors).join(', ')}`);
      }

      // Apply updates
      Object.assign(tool, updates);
      tool.updatedAt = new Date().toISOString();

      // Save to storage
      await this.saveTools();

      this.logger.debug(`Tool updated successfully: ${toolId}`);

      return true;
    } catch (error) {
      this.logger.error(`Failed to update tool: ${toolId}`, {}, error);
      throw error;
    }
  }

  /**
   * Deletes a tool
   * @param {string} toolId - Tool ID
   * @returns {boolean} True if deleted, false if not found
   */
  async deleteTool(toolId) {
    if (!toolId || typeof toolId !== 'string') {
      throw new Error('Valid tool ID is required and must be a string');
    }

    this.logger.debug(`Deleting tool: ${toolId}`);

    try {
      const index = this.tools.findIndex(t => t.id === toolId);
      if (index === -1) {
        return false;
      }

      // Remove from tools
      this.tools.splice(index, 1);

      // Save to storage
      await this.saveTools();

      this.logger.debug(`Tool deleted successfully: ${toolId}`);

      return true;
    } catch (error) {
      this.logger.error(`Failed to delete tool: ${toolId}`, {}, error);
      throw error;
    }
  }

  /**
   * Tests a tool
   * @param {string} toolId - Tool ID
   * @param {Object} testData - Test data
   * @returns {Object} Test result
   */
  async testTool(toolId, testData = {}) {
    if (!toolId || typeof toolId !== 'string') {
      throw new Error('Valid tool ID is required and must be a string');
    }

    this.logger.debug(`Testing tool: ${toolId}`);

    try {
      const tool = this.tools.find(t => t.id === toolId);
      if (!tool) {
        throw new Error(`Tool not found: ${toolId}`);
      }

      // Validate tool configuration
      if (!tool.endpointUrl) {
        throw new Error('Tool endpoint URL is required for testing');
      }

      // Prepare test request
      const testArgs = testData.args || {};
      const testMethod = testData.method || tool.httpMethod || 'POST';
      const testTimeout = testData.timeout || 10000; // 10 seconds

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), testTimeout);

      try {
        // Prepare request
        let finalEndpointUrl = tool.endpointUrl;
        let finalFetchOptions = {
          method: testMethod,
          headers: {
            'Accept': 'application/json'
          }
        };

        // Handle request body and query parameters
        const isEmptyArgs = !testArgs || Object.keys(testArgs).length === 0;
        
        if (testMethod === 'GET' && !isEmptyArgs) {
          // Add query parameters for GET requests
          const queryParams = new URLSearchParams(testArgs).toString();
          finalEndpointUrl = `${tool.endpointUrl}?${queryParams}`;
        } else if (['POST', 'PUT', 'PATCH'].includes(testMethod) && !isEmptyArgs) {
          // Add request body for POST/PUT/PATCH requests
          finalFetchOptions.headers['Content-Type'] = 'application/json';
          finalFetchOptions.body = JSON.stringify(testArgs);
        }

        // Make request
        this.logger.debug('Making tool test request', {
          method: testMethod,
          url: finalEndpointUrl,
          hasBody: !!finalFetchOptions.body
        });

        const response = await fetch(finalEndpointUrl, {
          ...finalFetchOptions,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        let result;
        const contentType = response.headers.get('content-type');
        
        if (contentType && contentType.includes('application/json')) {
          result = await response.json();
        } else {
          result = await response.text();
        }

        this.logger.debug('Tool test request successful', {
          toolId,
          status: response.status,
          responseType: contentType
        });

        return {
          success: true,
          status: response.status,
          result,
          contentType
        };
      } catch (error) {
        clearTimeout(timeoutId);

        // Handle timeout
        if (error.name === 'AbortError') {
          return {
            success: false,
            error: `Tool test timed out after ${testTimeout}ms`
          };
        }

        // Handle network errors
        if (error.name === 'TypeError') {
          return {
            success: false,
            error: `Network error: ${error.message}`
          };
        }

        // Handle other errors
        return {
          success: false,
          error: error.message || 'Unknown error'
        };
      }
    } catch (error) {
      this.logger.error(`Failed to test tool: ${toolId}`, {}, error);
      return {
        success: false,
        error: error.message || 'Unknown error'
      };
    }
  }

  /**
   * Duplicates a tool
   * @param {string} toolId - Tool ID to duplicate
   * @param {string} newName - New tool name
   * @returns {string} New tool ID
   */
  async duplicateTool(toolId, newName) {
    if (!toolId || typeof toolId !== 'string') {
      throw new Error('Valid tool ID is required and must be a string');
    }

    if (!newName || typeof newName !== 'string') {
      throw new Error('Valid new name is required and must be a string');
    }

    this.logger.debug(`Duplicating tool: ${toolId}`);

    try {
      const tool = this.tools.find(t => t.id === toolId);
      if (!tool) {
        throw new Error(`Tool not found: ${toolId}`);
      }

      // Create duplicate
      const duplicateToolData = {
        name: newName,
        description: tool.description,
        endpointUrl: tool.endpointUrl,
        httpMethod: tool.httpMethod,
        parameters: tool.parameters
      };

      const newToolId = await this.createTool(duplicateToolData);

      this.logger.debug(`Tool duplicated successfully: ${toolId} -> ${newToolId}`);

      return newToolId;
    } catch (error) {
      this.logger.error(`Failed to duplicate tool: ${toolId}`, {}, error);
      throw error;
    }
  }

  /**
   * Exports tools
   * @returns {string} JSON string of tools
   */
  exportTools() {
    this.logger.debug('Exporting tools');

    try {
      const exportData = {
        tools: this.tools,
        exportedAt: new Date().toISOString(),
        version: '1.0'
      };

      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      this.logger.error('Failed to export tools', {}, error);
      throw error;
    }
  }

  /**
   * Imports tools
   * @param {string} toolsJson - JSON string of tools
   * @returns {Object} Import result
   */
  async importTools(toolsJson) {
    if (!toolsJson || typeof toolsJson !== 'string') {
      throw new Error('Valid tools JSON is required and must be a string');
    }

    this.logger.debug('Importing tools');

    try {
      const importData = JSON.parse(toolsJson);

      if (!importData.tools || !Array.isArray(importData.tools)) {
        throw new Error('Invalid tools data format');
      }

      // Check if we would exceed the max limit
      if (this.tools.length + importData.tools.length > this.maxTools) {
        throw new Error(`Import would exceed maximum number of tools (${this.maxTools})`);
      }

      // Validate imported tools
      const validTools = [];
      for (const tool of importData.tools) {
        const validation = this.validator.validateTool(tool);
        if (validation.isValid) {
          // Generate new ID to avoid conflicts
          const newTool = {
            ...tool,
            id: 'tool_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
            importedAt: new Date().toISOString()
          };
          validTools.push(newTool);
        } else {
          this.logger.warn('Skipping invalid tool during import', {
            name: tool.name,
            errors: validation.errors
          });
        }
      }

      // Add valid tools
      this.tools.push(...validTools);

      // Save to storage
      await this.saveTools();

      this.logger.debug(`Tools imported successfully: ${validTools.length}/${importData.tools.length}`);

      return {
        imported: validTools.length,
        total: importData.tools.length,
        skipped: importData.tools.length - validTools.length
      };
    } catch (error) {
      this.logger.error('Failed to import tools', {}, error);
      throw error;
    }
  }

  /**
   * Validates a tool
   * @param {Object} tool - Tool to validate
   * @returns {Object} Validation result
   */
  validateTool(tool) {
    if (!tool || typeof tool !== 'object') {
      return {
        isValid: false,
        errors: { general: 'Valid tool object is required' }
      };
    }

    try {
      return this.validator.validateTool(tool);
    } catch (error) {
      this.logger.error('Failed to validate tool', {}, error);
      return {
        isValid: false,
        errors: { general: 'Validation error: ' + error.message }
      };
    }
  }

  /**
   * Searches tools
   * @param {string} query - Search query
   * @returns {Array} Array of matching tools
   */
  searchTools(query) {
    if (!query || typeof query !== 'string') {
      return [];
    }

    this.logger.debug('Searching tools', { query });

    try {
      const lowerQuery = query.toLowerCase();
      return this.tools.filter(tool => {
        return (
          tool.name.toLowerCase().includes(lowerQuery) ||
          tool.description.toLowerCase().includes(lowerQuery)
        );
      });
    } catch (error) {
      this.logger.error('Failed to search tools', { query }, error);
      return [];
    }
  }

  /**
   * Gets tool statistics
   * @returns {Object} Tool statistics
   */
  getStatistics() {
    return {
      totalTools: this.tools.length,
      maxTools: this.maxTools,
      canAddMore: this.tools.length < this.maxTools
    };
  }
}

export default ToolManager;