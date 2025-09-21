/**
 * Base Coordinator class implementing common functionality for all coordinators
 * Follows the Coordinator pattern for navigation and state flow management
 */
export class BaseCoordinator {
  constructor() {
    if (this.constructor === BaseCoordinator) {
      throw new Error("Cannot instantiate abstract BaseCoordinator class directly");
    }
    
    // Store child coordinators
    this.childCoordinators = new Set();
  }

  /**
   * Start the coordinator
   * Override in subclasses to implement startup logic
   */
  async start() {
    // Default implementation does nothing
  }

  /**
   * Stop the coordinator and clean up resources
   */
  async stop() {
    // Stop all child coordinators
    for (const coordinator of this.childCoordinators) {
      await coordinator.stop();
    }
    this.childCoordinators.clear();
  }

  /**
   * Add a child coordinator
   * @param {BaseCoordinator} coordinator - Coordinator to add
   */
  addChild(coordinator) {
    if (coordinator instanceof BaseCoordinator) {
      this.childCoordinators.add(coordinator);
    }
  }

  /**
   * Remove a child coordinator
   * @param {BaseCoordinator} coordinator - Coordinator to remove
   */
  removeChild(coordinator) {
    this.childCoordinators.delete(coordinator);
  }

  /**
   * Navigate to a specific route
   * Override in subclasses to implement navigation logic
   * @param {String} route - Route to navigate to
   * @param {Object} params - Parameters for the route
   */
  async navigateTo(route, params = {}) {
    // Default implementation does nothing
    console.warn(`Navigation to ${route} not implemented in ${this.constructor.name}`);
  }

  /**
   * Handle errors consistently across coordinators
   * @param {Error} error - Error to handle
   * @param {String} context - Context where error occurred
   */
  handleError(error, context = '') {
    console.error(`[${this.constructor.name}] Error in ${context}:`, error);
    // Additional error handling logic can be implemented here
  }
}