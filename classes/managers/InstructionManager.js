import { BaseManager } from './BaseManager.js';

/**
 * Instruction Manager handling all instruction-related operations
 * Implements the Manager pattern for business logic separation
 */
export class InstructionManager extends BaseManager {
  constructor() {
    super();
  }

  /**
   * Get all instructions from storage
   * @returns {Promise<Array>} - Array of instructions
   */
  async getInstructions() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['instructions'], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        const instructions = result.instructions || [];
        resolve(instructions);
      });
    });
  }

  /**
   * Get a specific instruction by ID
   * @param {String} instructionId - ID of the instruction to retrieve
   * @returns {Promise<Object|null>} - Instruction or null if not found
   */
  async getInstructionById(instructionId) {
    const instructions = await this.getInstructions();
    return instructions.find(i => i.id === instructionId) || null;
  }

  /**
   * Save an instruction
   * @param {Object} instruction - Instruction to save
   * @returns {Promise<void>}
   */
  async saveInstruction(instruction) {
    const instructions = await this.getInstructions();
    const now = new Date().toISOString();
    
    // Check if instruction already exists
    const existingIndex = instructions.findIndex(i => i.id === instruction.id);
    
    if (existingIndex > -1) {
      // Update existing instruction
      instructions[existingIndex] = {
        ...instructions[existingIndex],
        ...instruction,
        lastUpdated: now
      };
    } else {
      // Add new instruction
      instructions.push({
        ...instruction,
        id: instruction.id || 'inst_' + Date.now(),
        createdAt: now,
        lastUpdated: now
      });
    }
    
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ instructions: instructions }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Delete an instruction by ID
   * @param {String} instructionId - ID of the instruction to delete
   * @returns {Promise<void>}
   */
  async deleteInstruction(instructionId) {
    const instructions = await this.getInstructions();
    const filteredInstructions = instructions.filter(i => i.id !== instructionId);
    
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ instructions: filteredInstructions }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get pinned quick actions
   * @returns {Promise<Array>} - Array of pinned instruction IDs
   */
  async getPinnedQuickActions() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['pinnedQuickActions'], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        const pinnedActions = result.pinnedQuickActions || [];
        resolve(pinnedActions);
      });
    });
  }

  /**
   * Toggle pin status for an instruction
   * @param {String} instructionId - ID of the instruction to toggle
   * @returns {Promise<Boolean>} - New pin status
   */
  async togglePinnedInstruction(instructionId) {
    const pinnedActions = await this.getPinnedQuickActions();
    const isPinned = pinnedActions.includes(instructionId);
    
    let newPinnedActions;
    if (isPinned) {
      // Unpin the instruction
      newPinnedActions = pinnedActions.filter(id => id !== instructionId);
    } else {
      // Pin the instruction
      newPinnedActions = [...pinnedActions, instructionId];
    }
    
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ pinnedQuickActions: newPinnedActions }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(!isPinned); // Return new pin status
        }
      });
    });
  }

  /**
   * Import instructions from JSON data
   * @param {Object} importData - Data to import
   * @returns {Promise<void>}
   */
  async importInstructions(importData) {
    if (importData.version !== 1 || !Array.isArray(importData.instructions)) {
      throw new Error('Invalid import file format.');
    }

    const existingInstructions = await this.getInstructions();
    const importedInstructions = importData.instructions;
    const nowIso = new Date().toISOString();

    // Helper to generate a reasonably unique id
    const genId = () => 'inst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    // Normalize an imported instruction to our canonical shape while preserving extra fields
    const normalizeInstruction = (src) => {
      const createdAt = src.createdAt || src.created_at || nowIso;
      const lastUpdated = src.lastUpdated || src.updated_at || src.updatedAt || createdAt || nowIso;
      const name = (src.name || src.title || '').toString().trim() || 'Untitled Instruction';
      const content = (src.content || src.body || '').toString();

      // Normalize tool_choice to a single string if an array is provided
      let tool_choice = src.tool_choice;
      if (Array.isArray(tool_choice)) {
        if (tool_choice.includes('auto')) tool_choice = 'auto';
        else if (tool_choice.includes('none')) tool_choice = 'none';
        else tool_choice = tool_choice[0];
      }

      // Keep original object fields but ensure canonical fields exist
      return {
        ...src,
        id: src.id || genId(),
        name,
        content,
        tool_choice,
        createdAt,
        lastUpdated,
        imported_at: src.imported_at || nowIso
      };
    };

    // Merge strategy: update existing by id, otherwise add
    for (const raw of importedInstructions) {
      const normalized = normalizeInstruction(raw);
      const existingIndex = existingInstructions.findIndex(inst => inst.id === normalized.id);
      if (existingIndex > -1) {
        existingInstructions[existingIndex] = {
          ...existingInstructions[existingIndex],
          ...normalized,
          lastUpdated: nowIso
        };
      } else {
        existingInstructions.push(normalized);
      }
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ instructions: existingInstructions }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Export instructions to JSON data
   * @returns {Promise<Object>} - Export data
   */
  async exportInstructions() {
    const instructions = await this.getInstructions();
    
    return {
      version: 1,
      instructions: instructions
    };
  }
}