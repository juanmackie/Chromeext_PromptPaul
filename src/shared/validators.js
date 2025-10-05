/**
 * Input Validation System
 * Implements production-ready coding rules for input validation
 *
 * Core Principles:
 * - Input Validation: Validate all external data
 * - Default Deny: Explicit permission required
 * - Security: Sanitize all inputs before processing
 * - Least Privilege: Minimum necessary data processing
 */

import { errorHandler } from './error-handler.js';

class Validators {
  constructor() {
    this.validationRules = new Map();
    this.setupDefaultRules();
  }

  /**
   * Sets up default validation rules
   */
  setupDefaultRules() {
    // URL validation
    this.addRule('url', (value) => {
      if (!value || typeof value !== 'string') {
        return 'URL is required';
      }

      try {
        const url = new URL(value);
        // Only allow http/https protocols
        if (!['http:', 'https:'].includes(url.protocol)) {
          return 'Only HTTP and HTTPS URLs are allowed';
        }
        return null;
      } catch (e) {
        return 'Invalid URL format';
      }
    });

    // API key validation (basic format check)
    this.addRule('apiKey', (value) => {
      if (!value || typeof value !== 'string') {
        return 'API key is required';
      }

      if (value.length < 10) {
        return 'API key is too short';
      }

      if (value.length > 200) {
        return 'API key is too long';
      }

      // Basic character validation
      if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
        return 'API key contains invalid characters';
      }

      return null;
    });

    // Model name validation
    this.addRule('modelName', (value) => {
      if (!value || typeof value !== 'string') {
        return 'Model name is required';
      }

      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return 'Model name cannot be empty';
      }

      if (trimmed.length > 100) {
        return 'Model name is too long';
      }

      // Allow alphanumeric, hyphens, dots, and slashes
      if (!/^[a-zA-Z0-9._/-]+$/.test(trimmed)) {
        return 'Model name contains invalid characters';
      }

      return null;
    });

    // Instruction name validation
    this.addRule('instructionName', (value) => {
      if (!value || typeof value !== 'string') {
        return 'Instruction name is required';
      }

      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return 'Instruction name cannot be empty';
      }

      if (trimmed.length > 50) {
        return 'Instruction name is too long (max 50 characters)';
      }

      // Allow alphanumeric, spaces, and common punctuation
      if (!/^[a-zA-Z0-9\s\-_.,!?()]+$/.test(trimmed)) {
        return 'Instruction name contains invalid characters';
      }

      return null;
    });

    // Instruction content validation
    this.addRule('instructionContent', (value) => {
      if (!value || typeof value !== 'string') {
        return 'Instruction content is required';
      }

      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return 'Instruction content cannot be empty';
      }

      if (trimmed.length > 10000) {
        return 'Instruction content is too long (max 10,000 characters)';
      }

      return null;
    });

    // Tool name validation
    this.addRule('toolName', (value) => {
      if (!value || typeof value !== 'string') {
        return 'Tool name is required';
      }

      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return 'Tool name cannot be empty';
      }

      if (trimmed.length > 50) {
        return 'Tool name is too long (max 50 characters)';
      }

      // Must start with letter, contain only alphanumeric and underscores
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(trimmed)) {
        return 'Tool name must start with a letter and contain only letters, numbers, and underscores';
      }

      return null;
    });

    // JSON schema validation
    this.addRule('jsonSchema', (value) => {
      if (!value || typeof value !== 'string') {
        return 'JSON schema is required';
      }

      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return 'JSON schema cannot be empty';
      }

      try {
        JSON.parse(trimmed);
        return null;
      } catch (e) {
        return 'Invalid JSON format: ' + e.message;
      }
    });

    // Base64 data validation
    this.addRule('base64Data', (value) => {
      if (!value || typeof value !== 'string') {
        return 'Base64 data is required';
      }

      // Basic base64 format check
      if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(value)) {
        return 'Invalid base64 format';
      }

      // Check minimum length for meaningful data
      if (value.length < 100) {
        return 'Base64 data is too short';
      }

      return null;
    });

    // MIME type validation
    this.addRule('mimeType', (value) => {
      if (!value || typeof value !== 'string') {
        return 'MIME type is required';
      }

      const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav'
      ];

      if (!allowedTypes.includes(value.toLowerCase())) {
        return 'Unsupported media type';
      }

      return null;
    });
  }

  /**
   * Adds a custom validation rule
   * @param {string} name - Rule name
   * @param {Function} validator - Validation function
   */
  addRule(name, validator) {
    this.validationRules.set(name, validator);
  }

  /**
   * Validates a value against a rule
   * @param {string} ruleName - Name of validation rule
   * @param {any} value - Value to validate
   * @param {string} fieldName - Name of field for error reporting
   * @returns {string|null} Error message or null if valid
   */
  validate(ruleName, value, fieldName = 'field') {
    const rule = this.validationRules.get(ruleName);
    if (!rule) {
      return `Unknown validation rule: ${ruleName}`;
    }

    try {
      const result = rule(value);
      if (result) {
        errorHandler.handleValidationError(fieldName, value, result);
      }
      return result;
    } catch (error) {
      const errorMessage = `Validation error in rule ${ruleName}: ${error.message}`;
      errorHandler.handleValidationError(fieldName, value, errorMessage);
      return errorMessage;
    }
  }

  /**
   * Validates multiple fields against their rules
   * @param {Object} validationSchema - Schema with field:rule pairs
   * @param {Object} data - Data to validate
   * @returns {Object} Object with field:error pairs for invalid fields
   */
  validateSchema(validationSchema, data) {
    const errors = {};

    for (const [field, ruleName] of Object.entries(validationSchema)) {
      const error = this.validate(ruleName, data[field], field);
      if (error) {
        errors[field] = error;
      }
    }

    return errors;
  }

  /**
   * Sanitizes string input
   * @param {string} input - Input to sanitize
   * @param {Object} options - Sanitization options
   * @returns {string} Sanitized input
   */
  sanitizeString(input, options = {}) {
    if (typeof input !== 'string') {
      return '';
    }

    let sanitized = input.trim();

    if (options.maxLength) {
      sanitized = sanitized.substring(0, options.maxLength);
    }

    if (options.toLowerCase) {
      sanitized = sanitized.toLowerCase();
    }

    if (options.removeHtml) {
      // Remove HTML tags
      sanitized = sanitized.replace(/<[^>]*>/g, '');
    }

    if (options.removeSpecialChars) {
      // Remove special characters except alphanumeric and common punctuation
      sanitized = sanitized.replace(/[^a-zA-Z0-9\s\-_.,!?()]/g, '');
    }

    return sanitized;
  }

  /**
   * Sanitizes URL input
   * @param {string} url - URL to sanitize
   * @returns {string|null} Sanitized URL or null if invalid
   */
  sanitizeUrl(url) {
    try {
      const parsed = new URL(url);

      // Only allow http/https
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return null;
      }

      // Remove potentially dangerous query parameters
      const allowedParams = ['format', 'size', 'quality', 'width', 'height'];
      const searchParams = new URLSearchParams();

      for (const [key, value] of parsed.searchParams) {
        if (allowedParams.includes(key.toLowerCase())) {
          searchParams.set(key, value);
        }
      }

      parsed.search = searchParams.toString();
      return parsed.toString();
    } catch (e) {
      return null;
    }
  }

  /**
   * Validates and sanitizes configuration object
   * @param {Object} config - Configuration object
   * @returns {Object} Validation result with isValid and errors
   */
  validateConfig(config) {
    const schema = {
      llmEndpoint: 'url',
      apiKey: 'apiKey',
      modelName: 'modelName',
      maxTokens: 'number',
      systemPrompt: 'string'
    };

    const errors = this.validateSchema(schema, config);

    // Additional validation for numeric fields
    if (config.maxTokens && (isNaN(config.maxTokens) || config.maxTokens < 1 || config.maxTokens > 32000)) {
      errors.maxTokens = 'Max tokens must be between 1 and 32000';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  /**
   * Validates and sanitizes instruction object
   * @param {Object} instruction - Instruction object
   * @returns {Object} Validation result with isValid and errors
   */
  validateInstruction(instruction) {
    const schema = {
      name: 'instructionName',
      content: 'instructionContent',
      tool_choice: 'string',
      modalities: 'array'
    };

    const errors = this.validateSchema(schema, instruction);

    // Additional validation for tool_choice
    if (instruction.tool_choice && !['none', 'auto'].includes(instruction.tool_choice) &&
        !Array.isArray(instruction.tool_choice)) {
      errors.tool_choice = 'Tool choice must be "none", "auto", or an array of tool names';
    }

    // Additional validation for modalities
    if (instruction.modalities && Array.isArray(instruction.modalities)) {
      const allowedModalities = ['text', 'image', 'video', 'audio'];
      const invalidModalities = instruction.modalities.filter(m => !allowedModalities.includes(m));
      if (invalidModalities.length > 0) {
        errors.modalities = `Invalid modalities: ${invalidModalities.join(', ')}`;
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  /**
   * Validates and sanitizes tool object
   * @param {Object} tool - Tool object
   * @returns {Object} Validation result with isValid and errors
   */
  validateTool(tool) {
    const schema = {
      name: 'toolName',
      description: 'string',
      parameters: 'jsonSchema',
      endpointUrl: 'url',
      httpMethod: 'string'
    };

    const errors = this.validateSchema(schema, tool);

    // Additional validation for HTTP method
    if (tool.httpMethod && !['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(tool.httpMethod.toUpperCase())) {
      errors.httpMethod = 'HTTP method must be GET, POST, PUT, DELETE, or PATCH';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }
}

// Export singleton instance
export const validators = new Validators();
export default validators;