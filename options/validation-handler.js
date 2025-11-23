import { errorHandler, ErrorSeverity, ErrorCategory, createError, wrapAsync } from '../errorHandler.js';
import { storageService } from '../services/storage-service.js';

/**
 * Validation Handler
 * Handles form validation, input processing, migration logic, and data transformation
 * Centralizes all validation logic for the options page
 */
export class ValidationHandler {
    constructor(showStatusCallback) {
        this.showStatus = showStatusCallback;
        
        // Validation constraints
        this.constraints = {
            maxTokens: { min: 1, max: 100000 },
            modelName: { minLength: 1, maxLength: 100 },
            apiKey: { minLength: 1, maxLength: 1000 },
            endpoint: { minLength: 1, maxLength: 2000 }
        };
    }

    /**
     * Validate API configuration form data
     * @param {Object} formData - Form data to validate
     * @returns {Object} Validation result { isValid: boolean, errors: string[], sanitized: Object }
     */
    validateApiConfig(formData) {
        const errors = [];
        const sanitized = {};

        // Validate and sanitize endpoint
        if (!formData.llmEndpoint || formData.llmEndpoint.trim() === '') {
            errors.push('API endpoint is required');
        } else {
            const endpoint = formData.llmEndpoint.trim();
            if (endpoint.length < this.constraints.endpoint.minLength || 
                endpoint.length > this.constraints.endpoint.maxLength) {
                errors.push('API endpoint length is invalid');
            } else {
                try {
                    new URL(endpoint);
                    sanitized.llmEndpoint = endpoint;
                } catch (e) {
                    errors.push('Please enter a valid URL for the API endpoint');
                }
            }
        }

        // Validate and sanitize API key
        if (!formData.apiKey || formData.apiKey.trim() === '') {
            errors.push('API key is required');
        } else {
            const apiKey = formData.apiKey.trim();
            if (apiKey.length < this.constraints.apiKey.minLength || 
                apiKey.length > this.constraints.apiKey.maxLength) {
                errors.push('API key length is invalid');
            } else {
                sanitized.apiKey = apiKey;
            }
        }

        // Validate and sanitize model name
        if (!formData.modelName || formData.modelName.trim() === '') {
            errors.push('Model name is required');
        } else {
            const modelName = formData.modelName.trim();
            if (modelName.length < this.constraints.modelName.minLength || 
                modelName.length > this.constraints.modelName.maxLength) {
                errors.push('Model name length is invalid');
            } else {
                sanitized.modelName = modelName;
            }
        }

        // Validate and sanitize max tokens
        const maxTokensValue = formData.maxTokens || formData.maxTokensValue;
        if (!maxTokensValue || maxTokensValue.toString().trim() === '') {
            errors.push('Max tokens is required');
        } else {
            const maxTokensNum = parseInt(maxTokensValue.toString().trim(), 10);
            if (isNaN(maxTokensNum) || 
                maxTokensNum < this.constraints.maxTokens.min || 
                maxTokensNum > this.constraints.maxTokens.max) {
                errors.push(`Max tokens must be a number between ${this.constraints.maxTokens.min} and ${this.constraints.maxTokens.max}`);
            } else {
                sanitized.maxTokens = maxTokensNum;
            }
        }

        // Sanitize system prompt (optional)
        sanitized.systemPrompt = formData.systemPrompt ? formData.systemPrompt.trim() : '';

        // Sanitize profile data
        sanitized.selectedProfileId = formData.selectedProfileId || 'default';

        return {
            isValid: errors.length === 0,
            errors,
            sanitized
        };
    }

    /**
     * Validate instruction form data
     * @param {Object} formData - Instruction form data
     * @returns {Object} Validation result
     */
    validateInstructionForm(formData) {
        const errors = [];
        const sanitized = {};

        // Validate instruction name
        if (!formData.instructionName || formData.instructionName.trim() === '') {
            errors.push('Instruction name is required');
        } else {
            sanitized.name = formData.instructionName.trim();
        }

        // Validate instruction content
        if (!formData.instructionContent || formData.instructionContent.trim() === '') {
            errors.push('Instruction content is required');
        } else {
            sanitized.content = formData.instructionContent.trim();
        }

        // Sanitize tool choice
        sanitized.tool_choice = formData.instructionToolChoice ? formData.instructionToolChoice.trim() : 'none';

        // All instructions are now universal across all modalities
        sanitized.modalities = ['text', 'image', 'video', 'audio'];

        return {
            isValid: errors.length === 0,
            errors,
            sanitized
        };
    }

    /**
     * Validate tool form data
     * @param {Object} formData - Tool form data
     * @returns {Object} Validation result
     */
    validateToolForm(formData) {
        const errors = [];
        const sanitized = {};

        // Validate tool name
        if (!formData.toolName || formData.toolName.trim() === '') {
            errors.push('Tool name is required');
        } else {
            sanitized.name = formData.toolName.trim();
        }

        // Validate tool description
        if (!formData.toolDescription || formData.toolDescription.trim() === '') {
            errors.push('Tool description is required');
        } else {
            sanitized.description = formData.toolDescription.trim();
        }

        // Validate parameters if provided
        if (formData.toolParameters && formData.toolParameters.trim() !== '') {
            if (!this.isValidJson(formData.toolParameters.trim())) {
                errors.push('Parameters must be valid JSON');
            } else {
                sanitized.parameters = formData.toolParameters.trim();
            }
        } else {
            sanitized.parameters = '';
        }

        // Sanitize endpoint URL
        sanitized.endpointUrl = formData.toolEndpointUrl ? formData.toolEndpointUrl.trim() : '';

        // Validate endpoint URL if provided
        if (sanitized.endpointUrl && !this.isValidURL(sanitized.endpointUrl)) {
            errors.push('Endpoint URL must be a valid URL');
        }

        // Sanitize HTTP method
        sanitized.httpMethod = formData.toolHttpMethod || 'GET';

        return {
            isValid: errors.length === 0,
            errors,
            sanitized
        };
    }

    /**
     * Check if string is valid URL
     * @param {string} urlString - URL string to validate
     * @returns {boolean} True if valid URL
     */
    isValidURL(urlString) {
        if (!urlString) return false;
        try {
            new URL(urlString);
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Check if string is valid JSON
     * @param {string} jsonString - JSON string to validate
     * @returns {boolean} True if valid JSON
     */
    isValidJson(jsonString) {
        try {
            JSON.parse(jsonString);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Clamp number within bounds
     * @param {number} value - Value to clamp
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @returns {number} Clamped value
     */
    clampValue(value, min, max) {
        const num = Math.round(Number(value) || 0);
        if (num < min) return min;
        if (num > max) return max;
        return num;
    }

    /**
     * Sanitize and clamp max tokens input
     * @param {string|number} value - Max tokens value
     * @returns {number} Sanitized and clamped value
     */
    sanitizeMaxTokens(value) {
        return this.clampValue(value, this.constraints.maxTokens.min, this.constraints.maxTokens.max);
    }

    /**
     * Redact authentication information for display
     * @param {string} value - Authentication value to redact
     * @returns {string} Redacted value
     */
    redactAuth(value) {
        if (!value) return '';
        
        // Preserve scheme e.g. 'Bearer ' then mask token
        const parts = value.split(/\s+/, 2);
        if (parts.length === 2) {
            const token = parts[1];
            const masked = token.length > 8 ? 
                token.slice(0, 2) + '•'.repeat(token.length - 4) + token.slice(-2) : 
                '•'.repeat(token.length);
            return parts[0] + ' ' + masked;
        }
        
        return '•'.repeat(Math.min(12, value.length));
    }

    /**
     * Check and prompt for instruction migration from sync to local storage
     * @returns {Promise<boolean>} True if migration is available
     */
    async checkInstructionMigration() {
        return wrapAsync(async () => {
            const [syncResult, localResult] = await Promise.all([
                storageService.getSync(['instructions']),
                storageService.getLocal(['instructions'])
            ]);

            const syncInstructions = syncResult.instructions || [];
            const localInstructions = localResult.instructions || [];

            // Show prompt if sync has instructions and local does not
            if (syncInstructions.length > 0 && localInstructions.length === 0) {
                return true; // Migration available
            }

            return false; // No migration needed
        }, {
            category: ErrorCategory.STORAGE,
            userMessage: 'Failed to check migration status',
            severity: ErrorSeverity.LOW
        });
    }

    /**
     * Perform instruction migration from sync to local storage
     * @returns {Promise<Object>} Migration result
     */
    async performInstructionMigration() {
        return wrapAsync(async () => {
            const [syncResult, localResult] = await Promise.all([
                storageService.getSync(['instructions']),
                storageService.getLocal(['instructions'])
            ]);

            const syncInstructions = syncResult.instructions || [];
            const localInstructions = localResult.instructions || [];

            if (syncInstructions.length === 0) {
                throw createError('No instructions found in sync storage', {
                    category: ErrorCategory.NOT_FOUND,
                    severity: ErrorSeverity.MEDIUM,
                    userMessage: 'No instructions to migrate'
                });
            }

            // Migrate instructions to local storage
            await storageService.setLocal({ instructions: syncInstructions });
            
            // Clear sync storage after successful migration
            await storageService.setSync({ instructions: [] });

            this.showStatus('Instructions migrated to this device only!', false, true);

            return {
                migratedCount: syncInstructions.length,
                localCount: syncInstructions.length
            };
        }, {
            category: ErrorCategory.STORAGE,
            userMessage: 'Failed to migrate instructions',
            severity: ErrorSeverity.MEDIUM
        });
    }

    /**
     * Validate configuration completeness
     * @param {Object} config - Configuration object
     * @returns {boolean} True if configuration is complete
     */
    validateConfigCompleteness(config) {
        return !!(
            config &&
            config.llmEndpoint &&
            config.apiKey &&
            config.modelName &&
            config.maxTokens
        );
    }

    /**
     * Get validation rules for display
     * @returns {Object} Validation rules
     */
    getValidationRules() {
        return {
            maxTokens: {
                min: this.constraints.maxTokens.min,
                max: this.constraints.maxTokens.max,
                message: `Max tokens must be between ${this.constraints.maxTokens.min} and ${this.constraints.maxTokens.max}`
            },
            modelName: {
                minLength: this.constraints.modelName.minLength,
                maxLength: this.constraints.modelName.maxLength,
                message: `Model name must be between ${this.constraints.modelName.minLength} and ${this.constraints.modelName.maxLength} characters`
            },
            apiKey: {
                minLength: this.constraints.apiKey.minLength,
                maxLength: this.constraints.apiKey.maxLength,
                message: `API key must be between ${this.constraints.apiKey.minLength} and ${this.constraints.apiKey.maxLength} characters`
            },
            url: {
                message: 'Please enter a valid URL'
            },
            json: {
                message: 'Parameters must be valid JSON'
            }
        };
    }

    /**
     * Validate profile name uniqueness
     * @param {string} name - Profile name to validate
     * @param {string} excludeId - Profile ID to exclude from check (for updates)
     * @returns {Promise<boolean>} True if name is unique
     */
    async validateProfileNameUniqueness(name, excludeId = null) {
        return wrapAsync(async () => {
            const profiles = await storageService.getLocal(['profiles']);
            const profileList = profiles.profiles || [];
            
            return !profileList.some(profile => 
                profile.id !== excludeId && profile.name.toLowerCase() === name.toLowerCase()
            );
        }, {
            category: ErrorCategory.VALIDATION,
            userMessage: 'Failed to validate profile name',
            severity: ErrorSeverity.LOW
        });
    }

    /**
     * Sanitize file input for import
     * @param {File} file - File to validate
     * @param {string} expectedType - Expected file type ('instructions' or 'tools')
     * @returns {Promise<Object>} Validation result
     */
    async validateImportFile(file, expectedType) {
        return wrapAsync(async () => {
            // Check file type
            if (!file.type.includes('application/json')) {
                throw createError('Invalid file type. Please select a JSON file.', {
                    category: ErrorCategory.VALIDATION,
                    severity: ErrorSeverity.MEDIUM,
                    userMessage: 'Please select a JSON file'
                });
            }

            // Check file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                throw createError('File too large. Maximum size is 5MB.', {
                    category: ErrorCategory.VALIDATION,
                    severity: ErrorSeverity.MEDIUM,
                    userMessage: 'File is too large (max 5MB)'
                });
            }

            // Read and validate file content
            const content = await this.readFileAsText(file);
            const importData = JSON.parse(content);

            // Validate structure
            if (!importData.version || !Array.isArray(importData[expectedType])) {
                throw createError(`Invalid ${expectedType} file format`, {
                    category: ErrorCategory.VALIDATION,
                    severity: ErrorSeverity.MEDIUM,
                    userMessage: `Invalid ${expectedType} file format`
                });
            }

            return {
                isValid: true,
                data: importData,
                itemCount: importData[expectedType].length
            };
        }, {
            category: ErrorCategory.VALIDATION,
            userMessage: 'Failed to validate import file',
            severity: ErrorSeverity.MEDIUM
        });
    }

    /**
     * Read file as text
     * @param {File} file - File to read
     * @returns {Promise<string>} File content
     */
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }
}