/**
 * Base ViewModel class implementing common functionality for all view models
 * Follows the ViewModel pattern for UI logic separation
 */
export class BaseViewModel {
  constructor() {
    if (this.constructor === BaseViewModel) {
      throw new Error("Cannot instantiate abstract BaseViewModel class directly");
    }
    
    // Store observers for reactive updates
    this.observers = new Set();
  }

  /**
   * Subscribe to changes in the view model
   * @param {Function} callback - Function to call when data changes
   */
  subscribe(callback) {
    if (typeof callback === 'function') {
      this.observers.add(callback);
    }
  }

  /**
   * Unsubscribe from changes in the view model
   * @param {Function} callback - Function to remove from observers
   */
  unsubscribe(callback) {
    this.observers.delete(callback);
  }

  /**
   * Notify all observers of changes
   * @param {Object} data - Data to send to observers
   */
  notify(data) {
    this.observers.forEach(observer => {
      try {
        observer(data);
      } catch (error) {
        console.error('Error in observer:', error);
      }
    });
  }

  /**
   * Update the view model state
   * Override in subclasses to implement state updates
   * @param {Object} newState - New state to apply
   */
  updateState(newState) {
    // Default implementation does nothing
    // Subclasses should implement their own state management
  }

  /**
   * Get current view model state
   * Override in subclasses to return actual state
   * @returns {Object} - Current state
   */
  getState() {
    return {};
  }
}