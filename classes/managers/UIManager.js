import { BaseManager } from './BaseManager.js';

/**
 * UI Manager handling all UI-related operations
 * Implements the Manager pattern for business logic separation
 */
export class UIManager extends BaseManager {
  constructor() {
    super();
  }

  /**
   * Show a toast notification
   * @param {String} message - Message to display
   * @param {String} type - Type of toast (success, error, warning, info)
   * @param {Number} duration - Duration to show in milliseconds
   * @returns {Object} - Toast element
   */
  showToast(message, type = 'info', duration = 5000) {
    // Create toast container if it doesn't exist
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Icon based on type
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };
    
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = icons[type] || icons.info;
    
    const content = document.createElement('span');
    content.textContent = message;
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = () => this.hideToast(toast);
    
    toast.appendChild(icon);
    toast.appendChild(content);
    toast.appendChild(closeBtn);
    
    toastContainer.appendChild(toast);
    
    // Auto-hide after duration
    if (duration > 0) {
      setTimeout(() => this.hideToast(toast), duration);
    }
    
    return toast;
  }

  /**
   * Hide a toast notification
   * @param {Object} toast - Toast element to hide
   */
  hideToast(toast) {
    if (toast && toast.parentElement) {
      toast.classList.add('fade-out');
      setTimeout(() => {
        if (toast.parentElement) {
          toast.parentElement.removeChild(toast);
        }
      }, 300);
    }
  }

  /**
   * Show loading indicator
   * @param {String|Object} element - Element to show loading on
   * @param {String} message - Loading message
   * @returns {String} - Loader ID
   */
  showLoading(element, message = 'Loading...') {
    const loaderId = this.generateId();
    
    if (typeof element === 'string') {
      element = document.querySelector(element);
    }
    
    if (!element) return loaderId;

    // Add loading class to element
    element.classList.add('loading');
    
    // Create loading overlay
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.dataset.loaderId = loaderId;
    
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    
    const text = document.createElement('span');
    text.textContent = message;
    text.className = 'loading-text';
    
    overlay.appendChild(spinner);
    overlay.appendChild(text);
    
    // Position overlay
    const rect = element.getBoundingClientRect();
    if (getComputedStyle(element).position === 'static') {
      element.style.position = 'relative';
    }
    
    element.appendChild(overlay);
    
    return loaderId;
  }

  /**
   * Hide loading indicator
   * @param {String|Object} elementOrId - Element or loader ID to hide loading on
   */
  hideLoading(elementOrId) {
    let element, loaderId;
    
    if (typeof elementOrId === 'string') {
      // Could be element selector or loader ID
      if (elementOrId.startsWith('#') || elementOrId.startsWith('.')) {
        element = document.querySelector(elementOrId);
      } else {
        loaderId = elementOrId;
        const overlay = document.querySelector(`[data-loader-id="${loaderId}"]`);
        if (overlay) {
          element = overlay.parentElement;
        }
      }
    } else {
      element = elementOrId;
    }
    
    if (!element) return;
    
    // Remove loading class
    element.classList.remove('loading');
    
    // Remove overlay
    const overlays = element.querySelectorAll('.loading-overlay');
    overlays.forEach(overlay => {
      overlay.remove();
    });
  }

  /**
   * Set button loading state
   * @param {String|Object} button - Button element
   * @param {Boolean} isLoading - Whether button is loading
   */
  setButtonLoading(button, isLoading = true) {
    if (typeof button === 'string') {
      button = document.querySelector(button);
    }
    
    if (!button) return;
    
    if (isLoading) {
      button.classList.add('button-loading');
      button.disabled = true;
      
      // Store original text
      if (!button.dataset.originalText) {
        button.dataset.originalText = button.textContent;
      }
    } else {
      button.classList.remove('button-loading');
      button.disabled = false;
      
      // Restore original text
      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
    }
  }

  /**
   * Show error state
   * @param {String|Object} element - Element to show error on
   * @param {Error} error - Error to display
   * @param {Object} options - Error display options
   * @returns {Object} - Error element
   */
  showError(element, error, options = {}) {
    if (typeof element === 'string') {
      element = document.querySelector(element);
    }
    
    if (!element) return;
    
    // Clear any existing errors
    this.clearError(element);
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-state';
    errorDiv.dataset.errorId = this.generateId();
    
    const icon = document.createElement('span');
    icon.className = 'error-icon';
    icon.innerHTML = '⚠';
    
    const content = document.createElement('div');
    content.className = 'error-content';
    
    if (options.title) {
      const title = document.createElement('div');
      title.className = 'error-title';
      title.textContent = options.title;
      content.appendChild(title);
    }
    
    const message = document.createElement('div');
    message.className = 'error-message';
    message.textContent = error.message || error.toString();
    content.appendChild(message);
    
    // Action buttons
    if (options.retry || options.dismiss) {
      const actions = document.createElement('div');
      actions.className = 'error-actions';
      
      if (options.retry) {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'error-retry-btn';
        retryBtn.textContent = 'Retry';
        retryBtn.onclick = options.retry;
        actions.appendChild(retryBtn);
      }
      
      if (options.dismiss !== false) {
        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'error-dismiss-btn';
        dismissBtn.textContent = 'Dismiss';
        dismissBtn.onclick = () => this.clearError(element);
        actions.appendChild(dismissBtn);
      }
      
      content.appendChild(actions);
    }
    
    errorDiv.appendChild(icon);
    errorDiv.appendChild(content);
    
    element.appendChild(errorDiv);
    
    return errorDiv;
  }

  /**
   * Clear error state
   * @param {String|Object} element - Element to clear error on
   */
  clearError(element) {
    if (typeof element === 'string') {
      element = document.querySelector(element);
    }
    
    if (!element) return;
    
    const errors = element.querySelectorAll('.error-state');
    errors.forEach(error => error.remove());
  }

  /**
   * Generate a unique ID
   * @returns {String} - Unique ID
   */
  generateId() {
    return 'id_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Apply dark theme to the document
   * @param {Boolean} isDark - Whether to apply dark theme
   */
  applyDarkTheme(isDark) {
    // Apply theme class to document root for better CSS cascade
    const root = document.documentElement;
    const body = document.body;
    
    if (isDark) {
      root.setAttribute('data-theme', 'dark');
      body.classList.add('dark-theme', 'ext-dark');
      const icon = document.getElementById('darkThemeIcon');
      if (icon) icon.textContent = 'wb_sunny';
    } else {
      root.setAttribute('data-theme', 'light');
      body.classList.remove('dark-theme', 'ext-dark');
      body.classList.add('light-theme', 'ext-light');
      const icon = document.getElementById('darkThemeIcon');
      if (icon) icon.textContent = 'brightness_2';
    }

    // Update copy icons based on theme
    const copyMarkdownIcons = document.querySelectorAll('img[src*="copy markdown.png"]');
    const copyFormattedIcons = document.querySelectorAll('img[src*="copy formatted.png"]');

    copyMarkdownIcons.forEach(icon => {
      icon.src = isDark ? 'icons/light_copy markdown.png' : 'icons/copy markdown.png';
    });

    copyFormattedIcons.forEach(icon => {
      icon.src = isDark ? 'icons/light_copy formatted.png' : 'icons/copy formatted.png';
    });
    
    // Dispatch theme change event for other components
    window.dispatchEvent(new CustomEvent('themeChanged', { 
      detail: { isDark, theme: isDark ? 'dark' : 'light' } 
    }));
  }
}