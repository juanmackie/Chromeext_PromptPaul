/**
 * Instruction Manager
 * Handles instruction management for the options page
 * Implements production-ready coding rules for instruction management
 *
 * Core Principles:
 * - Input Validation: Validate all instruction data
 * - Error Handling: Proper error handling and logging
 * - Security: Don't expose sensitive information
 * - Performance: Efficient instruction management with proper caching
 */

import { logger, validators } from '../shared/index.js';

class InstructionManager {
  constructor(dependencies) {
    this.storage = dependencies.Storage;
    this.logger = dependencies.Logger;
    this.validator = dependencies.Validator;
    
    // Instruction manager configuration
    this.instructions = [];
    this.maxInstructions = 100;
  }

  /**
   * Initializes the instruction manager
   */
  async initialize() {
    this.logger.debug('Initializing instruction manager');

    try {
      // Load instructions from storage
      await this.loadInstructions();

      this.logger.debug('Instruction manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize instruction manager', {}, error);
      throw error;
    }
  }

  /**
   * Loads instructions from storage
   */
  async loadInstructions() {
    try {
      const result = await this.storage.get(['instructions']);
      this.instructions = result.instructions || [];

      this.logger.debug(`Loaded ${this.instructions.length} instructions from storage`);
    } catch (error) {
      this.logger.error('Failed to load instructions from storage', {}, error);
      throw error;
    }
  }

  /**
   * Saves instructions to storage
   */
  async saveInstructions() {
    try {
      await this.storage.set({ instructions: this.instructions });

      this.logger.debug(`Saved ${this.instructions.length} instructions to storage`);
    } catch (error) {
      this.logger.error('Failed to save instructions to storage', {}, error);
      throw error;
    }
  }

  /**
   * Gets all instructions
   * @returns {Array} Array of instructions
   */
  getInstructions() {
    return [...this.instructions];
  }

  /**
   * Gets an instruction by ID
   * @param {string} instructionId - Instruction ID
   * @returns {Object|null} Instruction object or null if not found
   */
  getInstruction(instructionId) {
    if (!instructionId || typeof instructionId !== 'string') {
      return null;
    }

    return this.instructions.find(i => i.id === instructionId) || null;
  }

  /**
   * Creates a new instruction
   * @param {Object} instructionData - Instruction data
   * @returns {string} Instruction ID
   */
  async createInstruction(instructionData) {
    if (!instructionData || typeof instructionData !== 'object') {
      throw new Error('Valid instruction data object is required');
    }

    this.logger.debug('Creating new instruction');

    try {
      // Validate instruction data
      const validation = this.validator.validateInstruction(instructionData);
      if (!validation.isValid) {
        throw new Error(`Invalid instruction data: ${Object.values(validation.errors).join(', ')}`);
      }

      // Check max instructions limit
      if (this.instructions.length >= this.maxInstructions) {
        throw new Error(`Maximum number of instructions (${this.maxInstructions}) reached`);
      }

      // Generate instruction ID
      const instructionId = 'instruction_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

      // Create instruction
      const instruction = {
        id: instructionId,
        name: instructionData.name || 'New Instruction',
        content: instructionData.content || '',
        toolChoice: instructionData.toolChoice || 'none',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Add to instructions
      this.instructions.push(instruction);

      // Save to storage
      await this.saveInstructions();

      this.logger.debug(`Instruction created successfully: ${instructionId}`);

      return instructionId;
    } catch (error) {
      this.logger.error('Failed to create instruction', {}, error);
      throw error;
    }
  }

  /**
   * Updates an instruction
   * @param {string} instructionId - Instruction ID
   * @param {Object} updates - Instruction updates
   * @returns {boolean} True if updated, false if not found
   */
  async updateInstruction(instructionId, updates) {
    if (!instructionId || typeof instructionId !== 'string') {
      throw new Error('Valid instruction ID is required and must be a string');
    }

    if (!updates || typeof updates !== 'object') {
      throw new Error('Valid updates object is required');
    }

    this.logger.debug(`Updating instruction: ${instructionId}`);

    try {
      const instruction = this.instructions.find(i => i.id === instructionId);
      if (!instruction) {
        return false;
      }

      // Validate updates
      const updatedInstruction = { ...instruction, ...updates };
      const validation = this.validator.validateInstruction(updatedInstruction);
      if (!validation.isValid) {
        throw new Error(`Invalid instruction data: ${Object.values(validation.errors).join(', ')}`);
      }

      // Apply updates
      Object.assign(instruction, updates);
      instruction.updatedAt = new Date().toISOString();

      // Save to storage
      await this.saveInstructions();

      this.logger.debug(`Instruction updated successfully: ${instructionId}`);

      return true;
    } catch (error) {
      this.logger.error(`Failed to update instruction: ${instructionId}`, {}, error);
      throw error;
    }
  }

  /**
   * Deletes an instruction
   * @param {string} instructionId - Instruction ID
   * @returns {boolean} True if deleted, false if not found
   */
  async deleteInstruction(instructionId) {
    if (!instructionId || typeof instructionId !== 'string') {
      throw new Error('Valid instruction ID is required and must be a string');
    }

    this.logger.debug(`Deleting instruction: ${instructionId}`);

    try {
      const index = this.instructions.findIndex(i => i.id === instructionId);
      if (index === -1) {
        return false;
      }

      // Remove from instructions
      this.instructions.splice(index, 1);

      // Save to storage
      await this.saveInstructions();

      this.logger.debug(`Instruction deleted successfully: ${instructionId}`);

      return true;
    } catch (error) {
      this.logger.error(`Failed to delete instruction: ${instructionId}`, {}, error);
      throw error;
    }
  }

  /**
   * Reorders instructions
   * @param {Array} instructionIds - Array of instruction IDs in new order
   * @returns {boolean} True if reordered, false if failed
   */
  async reorderInstructions(instructionIds) {
    if (!instructionIds || !Array.isArray(instructionIds)) {
      throw new Error('Valid instruction IDs array is required');
    }

    this.logger.debug('Reordering instructions');

    try {
      // Create a map of current instructions
      const instructionMap = new Map();
      this.instructions.forEach(instruction => {
        instructionMap.set(instruction.id, instruction);
      });

      // Create new ordered array
      const reorderedInstructions = [];
      for (const id of instructionIds) {
        const instruction = instructionMap.get(id);
        if (instruction) {
          reorderedInstructions.push(instruction);
        }
      }

      // Check if all instructions are included
      if (reorderedInstructions.length !== this.instructions.length) {
        throw new Error('Not all instructions were included in the reorder');
      }

      // Update instructions
      this.instructions = reorderedInstructions;

      // Save to storage
      await this.saveInstructions();

      this.logger.debug('Instructions reordered successfully');

      return true;
    } catch (error) {
      this.logger.error('Failed to reorder instructions', {}, error);
      throw error;
    }
  }

  /**
   * Duplicates an instruction
   * @param {string} instructionId - Instruction ID to duplicate
   * @param {string} newName - New instruction name
   * @returns {string} New instruction ID
   */
  async duplicateInstruction(instructionId, newName) {
    if (!instructionId || typeof instructionId !== 'string') {
      throw new Error('Valid instruction ID is required and must be a string');
    }

    if (!newName || typeof newName !== 'string') {
      throw new Error('Valid new name is required and must be a string');
    }

    this.logger.debug(`Duplicating instruction: ${instructionId}`);

    try {
      const instruction = this.instructions.find(i => i.id === instructionId);
      if (!instruction) {
        throw new Error(`Instruction not found: ${instructionId}`);
      }

      // Create duplicate
      const duplicateInstructionData = {
        name: newName,
        content: instruction.content,
        toolChoice: instruction.toolChoice
      };

      const newInstructionId = await this.createInstruction(duplicateInstructionData);

      this.logger.debug(`Instruction duplicated successfully: ${instructionId} -> ${newInstructionId}`);

      return newInstructionId;
    } catch (error) {
      this.logger.error(`Failed to duplicate instruction: ${instructionId}`, {}, error);
      throw error;
    }
  }

  /**
   * Exports instructions
   * @returns {string} JSON string of instructions
   */
  exportInstructions() {
    this.logger.debug('Exporting instructions');

    try {
      const exportData = {
        instructions: this.instructions,
        exportedAt: new Date().toISOString(),
        version: '1.0'
      };

      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      this.logger.error('Failed to export instructions', {}, error);
      throw error;
    }
  }

  /**
   * Imports instructions
   * @param {string} instructionsJson - JSON string of instructions
   * @returns {Object} Import result
   */
  async importInstructions(instructionsJson) {
    if (!instructionsJson || typeof instructionsJson !== 'string') {
      throw new Error('Valid instructions JSON is required and must be a string');
    }

    this.logger.debug('Importing instructions');

    try {
      const importData = JSON.parse(instructionsJson);

      if (!importData.instructions || !Array.isArray(importData.instructions)) {
        throw new Error('Invalid instructions data format');
      }

      // Check if we would exceed the max limit
      if (this.instructions.length + importData.instructions.length > this.maxInstructions) {
        throw new Error(`Import would exceed maximum number of instructions (${this.maxInstructions})`);
      }

      // Validate imported instructions
      const validInstructions = [];
      for (const instruction of importData.instructions) {
        const validation = this.validator.validateInstruction(instruction);
        if (validation.isValid) {
          // Generate new ID to avoid conflicts
          const newInstruction = {
            ...instruction,
            id: 'instruction_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
            importedAt: new Date().toISOString()
          };
          validInstructions.push(newInstruction);
        } else {
          this.logger.warn('Skipping invalid instruction during import', {
            name: instruction.name,
            errors: validation.errors
          });
        }
      }

      // Add valid instructions
      this.instructions.push(...validInstructions);

      // Save to storage
      await this.saveInstructions();

      this.logger.debug(`Instructions imported successfully: ${validInstructions.length}/${importData.instructions.length}`);

      return {
        imported: validInstructions.length,
        total: importData.instructions.length,
        skipped: importData.instructions.length - validInstructions.length
      };
    } catch (error) {
      this.logger.error('Failed to import instructions', {}, error);
      throw error;
    }
  }

  /**
   * Validates an instruction
   * @param {Object} instruction - Instruction to validate
   * @returns {Object} Validation result
   */
  validateInstruction(instruction) {
    if (!instruction || typeof instruction !== 'object') {
      return {
        isValid: false,
        errors: { general: 'Valid instruction object is required' }
      };
    }

    try {
      return this.validator.validateInstruction(instruction);
    } catch (error) {
      this.logger.error('Failed to validate instruction', {}, error);
      return {
        isValid: false,
        errors: { general: 'Validation error: ' + error.message }
      };
    }
  }

  /**
   * Searches instructions
   * @param {string} query - Search query
   * @returns {Array} Array of matching instructions
   */
  searchInstructions(query) {
    if (!query || typeof query !== 'string') {
      return [];
    }

    this.logger.debug('Searching instructions', { query });

    try {
      const lowerQuery = query.toLowerCase();
      return this.instructions.filter(instruction => {
        return (
          instruction.name.toLowerCase().includes(lowerQuery) ||
          instruction.content.toLowerCase().includes(lowerQuery)
        );
      });
    } catch (error) {
      this.logger.error('Failed to search instructions', { query }, error);
      return [];
    }
  }

  /**
   * Gets instruction statistics
   * @returns {Object} Instruction statistics
   */
  getStatistics() {
    return {
      totalInstructions: this.instructions.length,
      maxInstructions: this.maxInstructions,
      canAddMore: this.instructions.length < this.maxInstructions
    };
  }
}

export default InstructionManager;