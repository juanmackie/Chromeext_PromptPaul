// ===== Loading Manager - Handles UI loading states and notifications =====

class LoadingManager {
  constructor() {
    this.activeLoaders = new Map();
    this.loaderId = 0;
  }

  /**
   * Show a toast notification
   * @param {string} message - The message to display
   * @param {string} type - Type of toast: 'success', 'error', 'warning', 'info'
   * @param {number} duration - Duration in milliseconds (default 3000)
   */
  showToast(message, type = 'info', duration = 3000) {
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        pointer-events: none;
      `;
      document.body.appendChild(toastContainer);
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.style.cssText = `
      margin-bottom: 10px;
      padding: 12px 16px;
      border-radius: 6px;
      color: white;
      font-size: 14px;
      max-width: 300px;
      word-wrap: break-word;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.3s ease;
      pointer-events: auto;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    `;

    // Set background color based on type
    const colors = {
      success: '#22c55e',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6'
    };
    toast.style.backgroundColor = colors[type] || colors.info;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    // Animate in
    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    }, 10);

    // Animate out and remove
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, duration);
  }

  /**
   * Show loading indicator
   * @param {string|HTMLElement} target - Selector or element to show loading in
   * @param {string} message - Loading message
   * @returns {string} Loader ID for hiding later
   */
  showLoading(target, message = 'Loading...') {
    const loaderId = `loader_${++this.loaderId}`;
    const targetElement = typeof target === 'string' ? document.querySelector(target) : target;
    
    if (!targetElement) {
      console.warn('Loading target not found:', target);
      return loaderId;
    }

    const loader = document.createElement('div');
    loader.id = loaderId;
    loader.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255, 255, 255, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      z-index: 1000;
      border-radius: inherit;
    `;

    const spinner = document.createElement('div');
    spinner.style.cssText = `
      width: 24px;
      height: 24px;
      border: 2px solid #e5e7eb;
      border-top: 2px solid #3b82f6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 8px;
    `;

    const text = document.createElement('div');
    text.textContent = message;
    text.style.cssText = `
      color: #374151;
      font-size: 14px;
    `;

    loader.appendChild(spinner);
    loader.appendChild(text);

    // Add CSS animation if not already present
    if (!document.getElementById('loading-styles')) {
      const style = document.createElement('style');
      style.id = 'loading-styles';
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    // Make target relative if not already positioned
    const computed = window.getComputedStyle(targetElement);
    if (computed.position === 'static') {
      targetElement.style.position = 'relative';
    }

    targetElement.appendChild(loader);
    this.activeLoaders.set(loaderId, { element: loader, target: targetElement });

    return loaderId;
  }

  /**
   * Hide loading indicator
   * @param {string} loaderId - The loader ID returned from showLoading
   */
  hideLoading(loaderId) {
    const loader = this.activeLoaders.get(loaderId);
    if (loader && loader.element.parentNode) {
      loader.element.parentNode.removeChild(loader.element);
      this.activeLoaders.delete(loaderId);
    }
  }

  /**
   * Show connection status
   * @param {string|HTMLElement} target - Selector or element
   * @param {string} status - 'connecting', 'connected', 'disconnected'
   */
  showConnectionStatus(target, status) {
    const targetElement = typeof target === 'string' ? document.querySelector(target) : target;
    if (!targetElement) return;

    // Remove existing status indicators
    const existing = targetElement.querySelector('.connection-status');
    if (existing) existing.remove();

    if (status === 'connected') return; // Don't show indicator for connected state

    const statusElement = document.createElement('div');
    statusElement.className = 'connection-status';
    statusElement.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      color: white;
      z-index: 1001;
    `;

    if (status === 'connecting') {
      statusElement.style.backgroundColor = '#f59e0b';
      statusElement.textContent = 'Connecting...';
    } else if (status === 'disconnected') {
      statusElement.style.backgroundColor = '#ef4444';
      statusElement.textContent = 'Disconnected';
    }

    // Make target relative if not already positioned
    const computed = window.getComputedStyle(targetElement);
    if (computed.position === 'static') {
      targetElement.style.position = 'relative';
    }

    targetElement.appendChild(statusElement);

    // Auto-remove after 3 seconds for non-permanent states
    if (status !== 'disconnected') {
      setTimeout(() => {
        if (statusElement.parentNode) {
          statusElement.parentNode.removeChild(statusElement);
        }
      }, 3000);
    }
  }

  /**
   * Show error message in target
   * @param {string|HTMLElement} target - Selector or element
   * @param {Error|string} error - Error object or message
   * @param {object} options - Display options
   */
  showError(target, error, options = {}) {
    const targetElement = typeof target === 'string' ? document.querySelector(target) : target;
    if (!targetElement) return;

    const message = error instanceof Error ? error.message : error;
    const errorElement = document.createElement('div');
    errorElement.style.cssText = `
      padding: 16px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      color: #b91c1c;
      margin: 10px 0;
    `;
    errorElement.textContent = `Error: ${message}`;

    if (options.replace) {
      targetElement.innerHTML = '';
    }

    targetElement.appendChild(errorElement);

    // Auto-remove after delay if specified
    if (options.autoRemove) {
      setTimeout(() => {
        if (errorElement.parentNode) {
          errorElement.parentNode.removeChild(errorElement);
        }
      }, options.autoRemove);
    }
  }

  /**
   * Set button loading state
   * @param {HTMLElement} button - Button element
   * @param {boolean} loading - Whether to show loading state
   * @param {string} loadingText - Text to show when loading
   */
  setButtonLoading(button, loading, loadingText = 'Loading...') {
    if (!button) return;

    if (loading) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = loadingText;
      button.style.opacity = '0.7';
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || 'Save';
      button.style.opacity = '1';
      delete button.dataset.originalText;
    }
  }
}

// Create singleton instance
const loadingManager = new LoadingManager();

export { loadingManager };