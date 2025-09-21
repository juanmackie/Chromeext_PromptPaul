/**
 * Base Manager class implementing common functionality for all managers
 * Follows the Manager pattern for business logic separation
 */
export class BaseManager {
  constructor() {
    if (this.constructor === BaseManager) {
      throw new Error("Cannot instantiate abstract BaseManager class directly");
    }
  }

  /**
   * Initialize the manager
   * Override in subclasses to implement initialization logic
   */
  async initialize() {
    // Default implementation does nothing
  }

  /**
   * Clean up resources
   * Override in subclasses to implement cleanup logic
   */
  async destroy() {
    // Default implementation does nothing
  }

  /**
   * Validate configuration
   * @param {Object} config - Configuration object to validate
   * @returns {Boolean} - Whether configuration is valid
   */
  validateConfig(config) {
    return config && typeof config === 'object';
  }

  /**
   * Handle errors consistently across managers
   * @param {Error} error - Error to handle
   * @param {String} context - Context where error occurred
   */
  handleError(error, context = '') {
    console.error(`[${this.constructor.name}] Error in ${context}:`, error);
    // Additional error handling logic can be implemented here
  }
}