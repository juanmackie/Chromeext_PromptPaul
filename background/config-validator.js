import { validateUrl } from '../utils/validation.js';

/**
 * Configuration Validator
 * Validates extension configuration settings
 */
export class ConfigValidator {
  /**
   * Validate URL using the centralized validation utility
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid
   */
  isValidURL(url) {
    const result = validateUrl(url);
    return result.isValid;
  }

  /**
   * Validate API endpoint configuration
   * @param {string} endpoint - API endpoint URL
   * @returns {Object} Validation result
   */
  validateApiEndpoint(endpoint) {
    return validateUrl(endpoint, {
      requiredProtocols: ['http', 'https'],
      allowEmpty: false,
    });
  }

  /**
   * Validate tool endpoint configuration
   * @param {string} endpoint - Tool endpoint URL
   * @returns {Object} Validation result
   */
  validateToolEndpoint(endpoint) {
    if (!endpoint || endpoint.trim() === '') {
      // Tool endpoints are optional
      return { isValid: true, error: null };
    }

    return validateUrl(endpoint, {
      requiredProtocols: ['http', 'https'],
      allowEmpty: true,
    });
  }
}
