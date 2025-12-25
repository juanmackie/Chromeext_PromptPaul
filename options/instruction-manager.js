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
    * Generate instruction from goal using API
    * @param {string} goalDescription - User's goal description
    * @param {Object} apiConfig - API configuration
    * @returns {Promise<Object>} Generated instruction with name and content
    */
   async generateInstructionFromGoal(goalDescription, apiConfig) {
     return wrapAsync(
       async () => {
         if (!goalDescription || goalDescription.trim() === '') {
           throw createError('Goal description is required', {
             category: ErrorCategory.VALIDATION,
             severity: ErrorSeverity.MEDIUM,
             userMessage: 'Please provide a goal description',
           });
         }

         if (!apiConfig || !apiConfig.llmEndpoint || !apiConfig.apiKey || !apiConfig.modelName) {
           throw createError('API configuration is incomplete', {
             category: ErrorCategory.CONFIGURATION,
             severity: ErrorSeverity.MEDIUM,
             userMessage: 'API configuration is incomplete. Please set it up in settings.',
           });
         }

         this.showStatus('Generating instruction from goal...', false, true);

         const generatedInstruction = await this.callInstructionGenerationAPI(
           apiConfig.llmEndpoint,
           apiConfig.apiKey,
           apiConfig.modelName,
           goalDescription
         );

         this.showStatus('Instruction generated! Review and Save.', false, true);
         return generatedInstruction;
       },
       {
         category: ErrorCategory.API,
         userMessage: 'Failed to generate instruction from goal',
         severity: ErrorSeverity.MEDIUM,
         context: { goalDescription },
       }
     );
   }

   /**
    * Call API to generate instruction from goal
    * @param {string} endpoint - API endpoint
    * @param {string} apiKey - API key
    * @param {string} modelName - Model name
    * @param {string} goalDescription - User's goal description
    * @returns {Promise<Object>} Generated instruction with name and content
    */
   async callInstructionGenerationAPI(endpoint, apiKey, modelName, goalDescription) {
     return wrapAsync(
       async () => {
          const messages = [
            {
              role: 'system',
              content:
                'You are a world-class prompt engineering expert, mastering techniques from the dair-ai Prompt Engineering Guide, Anthropic\'s best practices (clarity, XML tags, roles, chain-of-thought, prefill), OpenAI cookbooks, and 2025 advancements in meta-prompting (e.g., Automatic Prompt Engineering, structured self-refinement).\n\nYour task: For the user\'s goal/task description, create ONE optimal, complete prompt/system instruction for a large language model.\n\nFollow this exact step-by-step process (reason internally):\n\n1. Analyze the goal: Identify objectives, output format, tone, length, audience, edge cases, and success criteria.\n2. Apply best techniques: Prioritize clarity/specificity; add role-playing; include few-shot examples if useful; enable chain-of-thought for reasoning; use XML/Markdown for structure; prefill if complex; handle long context.\n3. Ensure robustness: Avoid ambiguity/hallucinations; make token-efficient; tailor to strong reasoning models (e.g., Grok/Claude/GPT/o1).\n4. Refine: Mentally simulate outputs and improve for maximum performance.\n\nOutput STRICTLY as a valid JSON object with exactly these fields:\n{\n  "name": "Concise title (3-5 words describing the prompt\'s purpose)",\n  "content": "The full, optimized prompt/instruction (ready-to-use, well-structured, no placeholders unless necessary)"\n}\n\n- Output ONLY the JSON. No explanations, no markdown, no additional text before/after.\n- Ensure the JSON is perfectly valid and parsable.',
            },
            { role: 'user', content: goalDescription },
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
             `API request failed with status ${apiResponse.status}: $
             {
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

          // Parse the JSON response with enhanced error handling
          let generatedInstruction;
          try {
            const responseContent = responseData.choices[0].message.content.trim();
            
            // Debug logging for raw response (sanitized)
            const responsePreview = responseContent.length > 500 
              ? responseContent.substring(0, 500) + '...' 
              : responseContent;
            console.debug('Raw API response for instruction generation:', responsePreview);
            
            // Clean up any markdown code blocks if present
            let cleanedContent = responseContent.replace(/```json\n?|```/g, '').trim();
            
            // Additional cleanup for common formatting issues
            cleanedContent = this.cleanJsonResponse(cleanedContent);
            
            // Validate JSON structure before parsing
            if (!this.isValidJsonStructure(cleanedContent)) {
              throw createError('Invalid JSON structure in API response', {
                category: ErrorCategory.API,
                severity: ErrorSeverity.MEDIUM,
                context: { 
                  responsePreview: cleanedContent.substring(0, 200) + '...',
                  responseLength: cleanedContent.length 
                },
              });
            }
            
            generatedInstruction = JSON.parse(cleanedContent);
            
          } catch (parseError) {
            // Enhanced error handling with more context
            const errorContext = {
              errorType: parseError.constructor.name,
              errorMessage: parseError.message,
              responseLength: responseData.choices[0].message.content?.length || 0,
              responsePreview: responseData.choices[0].message.content?.substring(0, 200) || 'No content'
            };
            
            console.error('JSON parsing failed with detailed context:', errorContext);
            
            // Special handling for unterminated string errors
            if (parseError.message.includes('Unterminated string') || parseError.message.includes('Unexpected end')) {
              console.warn('Detected unterminated string or incomplete JSON - attempting automatic repair');
              
              // Try to repair the unterminated string
              const repairedContent = this.repairUnterminatedString(responseData.choices[0].message.content);
              
              try {
                const repairedInstruction = JSON.parse(repairedContent);
                if (repairedInstruction.name && repairedInstruction.content) {
                  console.warn('Successfully repaired unterminated string in JSON response');
                  generatedInstruction = repairedInstruction;
                }
              } catch (repairError) {
                console.error('Automatic repair failed, trying fallback extraction:', repairError.message);
                
                // If repair fails, try fallback extraction
                const fallbackInstruction = this.extractInstructionFromMalformedResponse(responseData.choices[0].message.content);
                
                if (fallbackInstruction && fallbackInstruction.name && fallbackInstruction.content) {
                  console.warn('Using fallback extraction method for malformed JSON response');
                  generatedInstruction = fallbackInstruction;
                }
              }
            } else {
              // For other types of JSON errors, try fallback extraction
              const fallbackInstruction = this.extractInstructionFromMalformedResponse(responseData.choices[0].message.content);
              
              if (fallbackInstruction && fallbackInstruction.name && fallbackInstruction.content) {
                console.warn('Using fallback extraction method for malformed JSON response');
                generatedInstruction = fallbackInstruction;
              }
            }
            
            // If we still don't have a valid instruction, throw the error
            if (!generatedInstruction || !generatedInstruction.name || !generatedInstruction.content) {
              throw createError('Failed to parse generated instruction: ' + parseError.message, {
                category: ErrorCategory.API,
                severity: ErrorSeverity.MEDIUM,
                context: errorContext,
                userMessage: 'The API returned an invalid response format. Please try again or check your API configuration.',
              });
            }
          }

         // Validate the generated instruction structure
         if (!generatedInstruction.name || !generatedInstruction.content) {
           throw createError('Generated instruction is missing required fields', {
             category: ErrorCategory.API,
             severity: ErrorSeverity.MEDIUM,
             context: { generatedInstruction },
           });
         }

         return generatedInstruction;
       },
       {
         category: ErrorCategory.API,
         userMessage: 'Failed to call instruction generation API',
         severity: ErrorSeverity.MEDIUM,
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
   * Clean JSON response by fixing common formatting issues
   * @param {string} jsonString - Raw JSON string
   * @returns {string} Cleaned JSON string
   */
  cleanJsonResponse(jsonString) {
    let cleaned = jsonString;
    
    // Fix common issues that can cause JSON parsing to fail
    try {
      // Remove any trailing commas in objects/arrays
      cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
      
      // Fix unescaped quotes within strings
      cleaned = cleaned.replace(/(\w)"(\w)/g, '$1\\"$2');
      
      // Ensure proper string termination by balancing quotes
      let openQuotes = (cleaned.match(/"/g) || []).length;
      if (openQuotes % 2 !== 0) {
        // If odd number of quotes, try to find and fix the unterminated string
        const lastQuoteIndex = cleaned.lastIndexOf('"');
        if (lastQuoteIndex !== -1 && lastQuoteIndex < cleaned.length - 1) {
          // Add closing quote at the end if it seems like a string was cut off
          cleaned += '"';
        }
      }
      
      // Balance braces and brackets
      const openBraces = (cleaned.match(/\{/g) || []).length;
      const closeBraces = (cleaned.match(/\}/g) || []).length;
      const openBrackets = (cleaned.match(/\[/g) || []).length;
      const closeBrackets = (cleaned.match(/\]/g) || []).length;
      
      // Add missing closing braces/brackets
      for (let i = 0; i < openBraces - closeBraces; i++) {
        cleaned += '}';
      }
      for (let i = 0; i < openBrackets - closeBrackets; i++) {
        cleaned += ']';
      }
      
    } catch (error) {
      console.warn('JSON cleaning encountered an issue:', error.message);
      // Return original if cleaning fails
    }
    
    return cleaned;
  }

  /**
   * Validate JSON structure before parsing
   * @param {string} jsonString - JSON string to validate
   * @returns {boolean} True if structure appears valid
   */
  isValidJsonStructure(jsonString) {
    if (!jsonString || typeof jsonString !== 'string') {
      return false;
    }
    
    // Basic structure checks
    const trimmed = jsonString.trim();
    
    // Must start with object or array
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return false;
    }
    
    // Must end with matching closing character
    if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) {
      return false;
    }
    
    // Check for balanced braces (simple check)
    const stack = [];
    const pairs = { '{': '}', '[': ']' };
    const closers = { '}': '{', ']': '[' };
    
    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      
      if (pairs[char]) {
        stack.push(char);
      } else if (closers[char]) {
        if (stack.length === 0 || pairs[stack.pop()] !== char) {
          return false;
        }
      }
    }
    
    return stack.length === 0;
  }

  /**
   * Attempt to repair unterminated string in JSON response
   * @param {string} responseContent - Raw response content
   * @returns {string} Repaired JSON string
   */
  repairUnterminatedString(responseContent) {
    let repaired = responseContent;
    
    try {
      // First check if it's already valid JSON to avoid unnecessary modifications
      try {
        JSON.parse(repaired);
        return repaired; // Return as-is if already valid
      } catch (e) {
        // Continue with repair if parsing fails
      }
      
      // Find the position where the string might be unterminated
      const unterminatedMatch = repaired.match(/"[^"]*$/);
      
      if (unterminatedMatch) {
        const unterminatedString = unterminatedMatch[0];
        const lastQuotePosition = repaired.lastIndexOf(unterminatedString);
        
        // Try to find where the string should logically end
        if (lastQuotePosition !== -1) {
          // Look for common patterns that might indicate the end of the content
          const remainingContent = repaired.substring(lastQuotePosition + unterminatedString.length);
          
          // If there's content after the unterminated string, it might be part of the JSON structure
          if (remainingContent.trim()) {
            // Try to find where the actual content ends and JSON structure begins
            const structureMatch = remainingContent.match(/\s*[,\}\]]\s*/);
            if (structureMatch) {
              // Add the missing quote before the JSON structure
              repaired = repaired.substring(0, lastQuotePosition + unterminatedString.length) + 
                         '"' + remainingContent;
            } else {
              // If no clear structure, just add the missing quote at the end
              repaired += '"';
            }
          } else {
            // Just add the missing quote at the end
            repaired += '"';
          }
        }
      }
      
      // Also try to fix any other obvious JSON structure issues
      repaired = this.cleanJsonResponse(repaired);
      
    } catch (error) {
      console.warn('String repair encountered an issue:', error.message);
    }
    
    return repaired;
  }

  /**
   * Fallback method to extract instruction from malformed JSON
   * @param {string} responseContent - Raw response content
   * @returns {Object|null} Extracted instruction or null
   */
  extractInstructionFromMalformedResponse(responseContent) {
    try {
      // Try to extract name and content using regex patterns
      const nameMatch = responseContent.match(/"name"\s*:\s*"([^"]+)"/);
      const contentMatch = responseContent.match(/"content"\s*:\s*"([^"]+)"/);

      if (nameMatch && contentMatch) {
        return {
          name: nameMatch[1],
          content: contentMatch[1]
        };
      }

      // Try alternative patterns if standard JSON extraction fails
      const altNameMatch = responseContent.match(/name\s*:\s*"([^"]+)"/);
      const altContentMatch = responseContent.match(/content\s*:\s*"([^"]+)"/);

      if (altNameMatch && altContentMatch) {
        return {
          name: altNameMatch[1],
          content: altContentMatch[1]
        };
      }

    } catch (error) {
      console.warn('Fallback extraction failed:', error.message);
    }

    return null;
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
