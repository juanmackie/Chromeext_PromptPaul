import { BaseManager } from './BaseManager.js';

/**
 * Tool Manager handling all tool-related operations
 * Implements the Manager pattern for business logic separation
 */
export class ToolManager extends BaseManager {
  constructor() {
    super();
  }

  /**
   * Get all tool definitions from storage
   * @returns {Promise<Array>} - Array of tool definitions
   */
  async getAllTools() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['promptPaulTools'], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        const toolsArray = result.promptPaulTools || [];
        resolve(toolsArray);
      });
    });
  }

  /**
   * Get a specific tool definition by name
   * @param {String} name - Name of the tool to retrieve
   * @returns {Promise<Object|null>} - Tool definition or null if not found
   */
  async getToolByName(name) {
    const tools = await this.getAllTools();
    return tools.find(t => t.name === name) || null;
  }

  /**
   * Save a tool definition
   * @param {Object} tool - Tool definition to save
   * @returns {Promise<void>}
   */
  async saveTool(tool) {
    const tools = await this.getAllTools();
    const now = new Date().toISOString();
    
    // Check if tool already exists
    const existingIndex = tools.findIndex(t => t.id === tool.id);
    
    if (existingIndex > -1) {
      // Update existing tool
      tools[existingIndex] = {
        ...tools[existingIndex],
        ...tool,
        lastUpdated: now
      };
    } else {
      // Add new tool
      tools.push({
        ...tool,
        id: tool.id || 'tool_' + Date.now(),
        createdAt: now,
        lastUpdated: now
      });
    }
    
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ promptPaulTools: tools }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Delete a tool by ID
   * @param {String} toolId - ID of the tool to delete
   * @returns {Promise<void>}
   */
  async deleteTool(toolId) {
    const tools = await this.getAllTools();
    const filteredTools = tools.filter(t => t.id !== toolId);
    
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ promptPaulTools: filteredTools }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Format tools for API request
   * @param {Array} tools - Array of tool definitions
   * @returns {Array} - Formatted tools for API
   */
  formatToolsForApi(tools) {
    return tools.map(tool => {
      try {
        return {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: JSON.parse(tool.parameters || '{}')
          }
        };
      } catch (e) {
        console.error(`Error parsing parameters for tool ${tool.name}:`, e);
        return null;
      }
    }).filter(tool => tool !== null);
  }

  /**
   * Import tools from JSON data (versioned)
   * @param {Object} importData - Expected shape: { version: 1, tools: [...] }
   * @returns {Promise<void>}
   */
  async importTools(importData) {
    if (importData.version !== 1 || !Array.isArray(importData.tools)) {
      throw new Error('Invalid import file format.');
    }

    const existingTools = await this.getAllTools();
    const importedTools = importData.tools;
    const nowIso = new Date().toISOString();

    // Helper to generate a reasonably unique id
    const genId = () => 'tool_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    // Normalize an imported tool to our canonical shape while preserving extra fields
    const normalizeTool = (src) => {
      const createdAt = src.createdAt || src.created_at || nowIso;
      const lastUpdated = src.lastUpdated || src.updated_at || src.updatedAt || createdAt || nowIso;
      const name = (src.name || '').toString().trim() || 'unnamed_tool';
      const description = (src.description || '').toString();
      const endpointUrl = src.endpointUrl || src.endpointURL || src.endpoint_url || src.url || '';
      const httpMethod = (src.httpMethod || src.method || '').toString().toUpperCase() || 'POST';

      // Ensure parameters is a stringified JSON schema
      let parameters = src.parameters;
      if (typeof parameters === 'object') {
        try { parameters = JSON.stringify(parameters, null, 2); } catch (_) { parameters = '{}'; }
      }
      if (typeof parameters !== 'string') {
        parameters = '{}';
      }

      return {
        ...src,
        id: src.id || genId(),
        name,
        description,
        endpointUrl,
        httpMethod,
        parameters,
        createdAt,
        lastUpdated,
        imported_at: src.imported_at || nowIso
      };
    };

    // Merge by id; update if exists, else add
    for (const raw of importedTools) {
      const normalized = normalizeTool(raw);
      const existingIndex = existingTools.findIndex(t => t.id === normalized.id);
      if (existingIndex > -1) {
        existingTools[existingIndex] = {
          ...existingTools[existingIndex],
          ...normalized,
          lastUpdated: nowIso
        };
      } else {
        existingTools.push(normalized);
      }
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ promptPaulTools: existingTools }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Export tools to JSON data (versioned)
   * @returns {Promise<Object>} - Export data
   */
  async exportTools() {
    const tools = await this.getAllTools();
    return {
      version: 1,
      tools
    };
  }
}
