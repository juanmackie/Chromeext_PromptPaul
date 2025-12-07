import {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
  wrapAsync,
} from '../errorHandler.js';
import { storageService } from '../services/storage-service.js';

/**
 * Instruction Manager
 * Handles instruction CRUD operations, pinning, API improvement, and mobile card generation
 * Manages custom instructions for the LLM
 */
export class InstructionManager {
  constructor(showStatusCallback) {
    this.showStatus = showStatusCallback;
  }

  /**
   * Load all instructions from storage
   * @returns {Promise<Array>} Array of instructions
   */
  async loadInstructions() {
    return wrapAsync(
      async () => {
        const result = await storageService.getLocal(['instructions']);
        return result.instructions || [];
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to load instructions',
        severity: ErrorSeverity.MEDIUM,
      }
    );
  }

  /**
   * Save instruction (create or update)
   * @param {Object} instructionData - Instruction data
   * @returns {Promise<Object>} Saved instruction
   */
  async saveInstruction(instructionData) {
    const { id, name, content, tool_choice } = instructionData;

    return wrapAsync(
      async () => {
        if (!name || !content) {
          throw createError('Instruction name and content are required', {
            category: ErrorCategory.VALIDATION,
            severity: ErrorSeverity.MEDIUM,
            userMessage: 'Instruction name and content are required',
          });
        }

        // DEBUG: About to load instructions for saveInstruction');
        let instructions = await this.loadInstructions();
        // DEBUG: Loaded instructions:', instructions);
        const now = new Date().toISOString();

        if (id) {
          // Update existing instruction
          // DEBUG: Attempting to update existing instruction with ID:', id);
          // DEBUG: About to reassign instructions constant - THIS WILL CAUSE ERROR');
          instructions = instructions.map(inst => {
            if (inst.id === id) {
              return {
                ...inst,
                name: name.trim(),
                content: content.trim(),
                tool_choice: tool_choice || 'none',
                modalities: ['text', 'image', 'video', 'audio'],
                lastUpdated: now,
              };
            }
            return inst;
          });
          this.showStatus('Instruction updated!');
        } else {
          // Add new instruction
          const newInstruction = {
            id: 'inst_' + Date.now(),
            name: name.trim(),
            content: content.trim(),
            tool_choice: tool_choice || 'none',
            modalities: ['text', 'image', 'video', 'audio'],
            createdAt: now,
            lastUpdated: now,
          };
          instructions.push(newInstruction);
          this.showStatus('Instruction added!');
        }

        await storageService.setLocal({ instructions });
        return instructions.find(inst =>
          id ? inst.id === id : inst.id === instructions[instructions.length - 1].id
        );
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to save instruction',
        severity: ErrorSeverity.MEDIUM,
        context: { instructionId: id, hasName: !!name },
      }
    );
  }

  /**
   * Delete instruction by ID
   * @param {string} instructionId - Instruction ID to delete
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteInstruction(instructionId) {
    return wrapAsync(
      async () => {
        const instructions = await this.loadInstructions();
        const updatedInstructions = instructions.filter(i => i.id !== instructionId);

        await storageService.setLocal({ instructions: updatedInstructions });
        this.showStatus('Instruction deleted!');
        return true;
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to delete instruction',
        severity: ErrorSeverity.MEDIUM,
        context: { instructionId },
      }
    );
  }

  /**
   * Toggle instruction pin status
   * @param {string} instructionId - Instruction ID to toggle
   * @returns {Promise<boolean>} New pin status
   */
  async toggleInstructionPin(instructionId) {
    return wrapAsync(
      async () => {
        const result = await storageService.getLocal(['pinnedQuickActions']);
        let pinnedQuickActions = result.pinnedQuickActions || [];
        const isPinned = pinnedQuickActions.includes(instructionId);

        if (isPinned) {
          pinnedQuickActions = pinnedQuickActions.filter(id => id !== instructionId);
          this.showStatus('Instruction unpinned from Quick Actions.');
        } else {
          pinnedQuickActions.push(instructionId);
          this.showStatus('Instruction pinned to Quick Actions.');
        }

        await storageService.setLocal({ pinnedQuickActions });
        return !isPinned;
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to update pin status',
        severity: ErrorSeverity.LOW,
        context: { instructionId },
      }
    );
  }

  /**
   * Check if instruction is pinned
   * @param {string} instructionId - Instruction ID to check
   * @returns {Promise<boolean>} True if pinned
   */
  async isInstructionPinned(instructionId) {
    return wrapAsync(
      async () => {
        const result = await storageService.getLocal(['pinnedQuickActions']);
        const pinnedQuickActions = result.pinnedQuickActions || [];
        return pinnedQuickActions.includes(instructionId);
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to check pin status',
        severity: ErrorSeverity.LOW,
      }
    );
  }

  /**
   * Get pinned instructions
   * @returns {Promise<Array>} Array of pinned instruction IDs
   */
  async getPinnedInstructions() {
    return wrapAsync(
      async () => {
        const result = await storageService.getLocal(['pinnedQuickActions']);
        return result.pinnedQuickActions || [];
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to get pinned instructions',
        severity: ErrorSeverity.LOW,
      }
    );
  }

  /**
   * Improve instruction using API
   * @param {string} instructionId - Instruction ID to improve
   * @param {Object} apiConfig - API configuration
   * @returns {Promise<string>} Improved content
   */
  async improveInstruction(instructionId, apiConfig) {
    return wrapAsync(
      async () => {
        const instructions = await this.loadInstructions();
        const instruction = instructions.find(i => i.id === instructionId);

        if (!instruction) {
          throw createError('Instruction not found', {
            category: ErrorCategory.NOT_FOUND,
            severity: ErrorSeverity.MEDIUM,
            userMessage: 'Instruction not found',
          });
        }

        if (!apiConfig || !apiConfig.llmEndpoint || !apiConfig.apiKey || !apiConfig.modelName) {
          throw createError('API configuration is incomplete', {
            category: ErrorCategory.CONFIGURATION,
            severity: ErrorSeverity.MEDIUM,
            userMessage: 'API configuration is incomplete. Please set it up in settings.',
          });
        }

        this.showStatus('Improving instruction...', false, true);

        const improvedContent = await this.callImprovementAPI(
          apiConfig.llmEndpoint,
          apiConfig.apiKey,
          apiConfig.modelName,
          instruction.content
        );

        this.showStatus('Instruction improved! Review and Save.', false, true);
        return improvedContent;
      },
      {
        category: ErrorCategory.API,
        userMessage: 'Failed to improve instruction',
        severity: ErrorSeverity.MEDIUM,
        context: { instructionId },
      }
    );
  }

  /**
   * Call API to improve instruction
   * @param {string} endpoint - API endpoint
   * @param {string} apiKey - API key
   * @param {string} modelName - Model name
   * @param {string} prompt - Original prompt to improve
   * @returns {Promise<string>} Improved prompt
   */
  async callImprovementAPI(endpoint, apiKey, modelName, prompt) {
    return wrapAsync(
      async () => {
        const messages = [
          {
            role: 'system',
            content:
              'You are an expert prompt engineer. Improve the following prompt for a large language model to be clearer, more concise, and more effective. Only return the improved prompt text, nothing else.',
          },
          { role: 'user', content: prompt },
        ];

        const apiResponse = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages: messages,
            max_tokens: 1000,
            temperature: 0.7,
          }),
        });

        if (!apiResponse.ok) {
          const errorData = await apiResponse.json().catch(() => null);
          throw createError(
            `API request failed with status ${apiResponse.status}: ${
              errorData ? JSON.stringify(errorData) : apiResponse.statusText
            }`,
            {
              category: ErrorCategory.API,
              severity: ErrorSeverity.MEDIUM,
              context: { status: apiResponse.status, endpoint },
            }
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
          throw createError('Invalid response format from API: Missing message content.', {
            category: ErrorCategory.API,
            severity: ErrorSeverity.MEDIUM,
          });
        }

        return responseData.choices[0].message.content.trim();
      },
      {
        category: ErrorCategory.API,
        userMessage: 'Failed to call improvement API',
        severity: ErrorSeverity.MEDIUM,
      }
    );
  }

  /**
   * Export instructions to JSON
   * @returns {Promise<Object>} Export data
   */
  async exportInstructions() {
    return wrapAsync(
      async () => {
        const instructions = await this.loadInstructions();
        const pinnedQuickActions = await this.getPinnedInstructions();

        return {
          version: 1,
          instructions,
          pinnedQuickActions,
          exportedAt: new Date().toISOString(),
        };
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to export instructions',
        severity: ErrorSeverity.MEDIUM,
      }
    );
  }

  /**
   * Import instructions from JSON
   * @param {Object} importData - Import data
   * @returns {Promise<Object>} Import result
   */
  async importInstructions(importData) {
    return wrapAsync(
      async () => {
        if (!importData.version || !Array.isArray(importData.instructions)) {
          throw createError('Invalid import file format', {
            category: ErrorCategory.VALIDATION,
            severity: ErrorSeverity.MEDIUM,
            userMessage: 'Invalid import file format',
          });
        }

        const existingInstructions = await this.loadInstructions();
        const importedInstructions = importData.instructions;
        let addedCount = 0;
        let updatedCount = 0;

        importedInstructions.forEach(importedInst => {
          const existingIndex = existingInstructions.findIndex(inst => inst.id === importedInst.id);
          if (existingIndex > -1) {
            // Update existing instruction
            existingInstructions[existingIndex] = {
              ...existingInstructions[existingIndex],
              ...importedInst,
              lastUpdated: new Date().toISOString(),
            };
            updatedCount++;
          } else {
            // Add new instruction
            existingInstructions.push({
              ...importedInst,
              id: importedInst.id || 'inst_' + Date.now(),
              createdAt: importedInst.createdAt || new Date().toISOString(),
              lastUpdated: new Date().toISOString(),
            });
            addedCount++;
          }
        });

        // Import pinned instructions if available
        if (importData.pinnedQuickActions && Array.isArray(importData.pinnedQuickActions)) {
          await storageService.setLocal({ pinnedQuickActions: importData.pinnedQuickActions });
        }

        await storageService.setLocal({ instructions: existingInstructions });

        this.showStatus(
          `Instructions imported successfully! Added: ${addedCount}, Updated: ${updatedCount}`
        );

        return {
          added: addedCount,
          updated: updatedCount,
          total: existingInstructions.length,
        };
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to import instructions',
        severity: ErrorSeverity.MEDIUM,
      }
    );
  }

  /**
   * Format tool choice for display
   * @param {string|Array} toolChoice - Tool choice value
   * @returns {string} Formatted display string
   */
  formatToolChoiceDisplay(toolChoice) {
    if (!toolChoice) return 'None';

    if (Array.isArray(toolChoice)) {
      if (toolChoice.length === 0 || toolChoice.includes('none')) {
        return 'None';
      } else if (toolChoice.includes('auto')) {
        return 'Auto';
      } else {
        return toolChoice.join(', ');
      }
    } else {
      // Handle older string format
      return toolChoice.charAt(0).toUpperCase() + toolChoice.slice(1);
    }
  }

  /**
   * Get instruction statistics
   * @returns {Promise<Object>} Instruction statistics
   */
  async getInstructionStats() {
    return wrapAsync(
      async () => {
        const instructions = await this.loadInstructions();
        const pinnedQuickActions = await this.getPinnedInstructions();

        const toolChoicesCount = {};

        instructions.forEach(inst => {
          // Count tool choices
          const toolChoice = this.formatToolChoiceDisplay(inst.tool_choice);
          toolChoicesCount[toolChoice] = (toolChoicesCount[toolChoice] || 0) + 1;
        });

        return {
          totalInstructions: instructions.length,
          pinnedInstructions: pinnedQuickActions.length,
          toolChoicesCount,
          recentlyCreated: instructions.filter(inst => {
            const createdDate = new Date(inst.createdAt);
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            return createdDate > weekAgo;
          }).length,
        };
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to get instruction statistics',
        severity: ErrorSeverity.LOW,
      }
    );
  }

  /**
   * Search instructions
   * @param {string} query - Search query
   * @returns {Promise<Array>} Matching instructions
   */
  async searchInstructions(query) {
    return wrapAsync(
      async () => {
        const instructions = await this.loadInstructions();
        const lowerQuery = query.toLowerCase();

        return instructions.filter(
          inst =>
            inst.name.toLowerCase().includes(lowerQuery) ||
            inst.content.toLowerCase().includes(lowerQuery)
        );
      },
      {
        category: ErrorCategory.STORAGE,
        userMessage: 'Failed to search instructions',
        severity: ErrorSeverity.LOW,
        context: { query },
      }
    );
  }
}
