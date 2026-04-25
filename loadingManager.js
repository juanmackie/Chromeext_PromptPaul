// loadingManager.js - Centralized loading states and error handling
export class LoadingManager {
  constructor() {
    this.activeLoaders = new Set();
    this.toastContainer = null;
    this.init();
  }

  init() {
    // Create toast container if it doesn't exist
    if (!document.querySelector('.toast-container')) {
      this.toastContainer = document.createElement('div');
      this.toastContainer.className = 'toast-container';
      document.body.appendChild(this.toastContainer);
    } else {
      this.toastContainer = document.querySelector('.toast-container');
    }
  }

  // Loading States
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
    this.activeLoaders.add(loaderId);

    return loaderId;
  }

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
    overlays.forEach((overlay) => {
      const id = overlay.dataset.loaderId;
      if (id) this.activeLoaders.delete(id);
      overlay.remove();
    });
  }

  // Button Loading States
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

  // Toast Notifications
  showToast(message, type = 'info', duration = 5000, options = {}) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // Icon based on type
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ',
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
    if (options.closable !== false) {
      toast.appendChild(closeBtn);
    }

    this.toastContainer.appendChild(toast);

    // Auto-hide after duration
    if (duration > 0) {
      setTimeout(() => this.hideToast(toast), duration);
    }

    return toast;
  }

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

  // Error States
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

  clearError(element) {
    if (typeof element === 'string') {
      element = document.querySelector(element);
    }

    if (!element) return;

    const errors = element.querySelectorAll('.error-state');
    errors.forEach((error) => error.remove());
  }

  // Progress Indicators
  showProgress(element, progress = null) {
    if (typeof element === 'string') {
      element = document.querySelector(element);
    }

    if (!element) return;

    let progressBar = element.querySelector('.progress-bar');
    if (!progressBar) {
      progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';

      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      progressBar.appendChild(fill);

      element.appendChild(progressBar);
    }

    const fill = progressBar.querySelector('.progress-fill');

    if (progress === null) {
      // Indeterminate progress
      fill.className = 'progress-fill progress-indeterminate';
      fill.style.width = '100%';
    } else {
      // Determinate progress
      fill.className = 'progress-fill';
      fill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
    }

    return progressBar;
  }

  hideProgress(element) {
    if (typeof element === 'string') {
      element = document.querySelector(element);
    }

    if (!element) return;

    const progressBars = element.querySelectorAll('.progress-bar');
    progressBars.forEach((bar) => bar.remove());
  }

  // Connection Status
  showConnectionStatus(element, status = 'connecting') {
    if (typeof element === 'string') {
      element = document.querySelector(element);
    }

    if (!element) return;

    let statusDiv = element.querySelector('.connection-status');
    if (!statusDiv) {
      statusDiv = document.createElement('div');
      statusDiv.className = 'connection-status';
      element.appendChild(statusDiv);
    }

    const dot = document.createElement('span');
    dot.className = `status-dot ${status === 'connecting' ? 'pulse' : ''}`;

    const text = document.createElement('span');
    const statusTexts = {
      connected: 'Connected',
      disconnected: 'Disconnected',
      connecting: 'Connecting...',
    };
    text.textContent = statusTexts[status] || status;

    statusDiv.className = `connection-status ${status}`;
    statusDiv.innerHTML = '';
    statusDiv.appendChild(dot);
    statusDiv.appendChild(text);

    return statusDiv;
  }

  // Utility Methods
  generateId() {
    return 'loader_' + Math.random().toString(36).substr(2, 9);
  }

  clearAll() {
    // Clear all active loaders
    this.activeLoaders.forEach((id) => {
      const overlay = document.querySelector(`[data-loader-id="${id}"]`);
      if (overlay && overlay.parentElement) {
        overlay.parentElement.classList.remove('loading');
        overlay.remove();
      }
    });
    this.activeLoaders.clear();

    // Clear all toasts
    if (this.toastContainer) {
      this.toastContainer.innerHTML = '';
    }

    // Clear all errors
    document.querySelectorAll('.error-state').forEach((error) => error.remove());

    // Clear all progress bars
    document.querySelectorAll('.progress-bar').forEach((bar) => bar.remove());
  }
}

// Create global instance
export const loadingManager = new LoadingManager();

// Convenience functions for global use
window.showLoading = (element, message) => loadingManager.showLoading(element, message);
window.hideLoading = (elementOrId) => loadingManager.hideLoading(elementOrId);
window.showToast = (message, type, duration, options) =>
  loadingManager.showToast(message, type, duration, options);
window.showError = (element, error, options) => loadingManager.showError(element, error, options);
window.setButtonLoading = (button, isLoading) => loadingManager.setButtonLoading(button, isLoading);
