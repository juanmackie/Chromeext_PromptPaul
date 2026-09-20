// loadingManager.js - Loading states, toasts, and button loading states
export class LoadingManager {
  constructor() {
    this.toastContainer = null;
    this.init();
  }

  init() {
    // Own container/class names: reusing Bootstrap's `.toast`/`.toast-container` made
    // `.toast:not(.show){display:none}` win over loading-states.css and hid every toast.
    if (!document.querySelector('.ext-toast-container')) {
      this.toastContainer = document.createElement('div');
      this.toastContainer.className = 'ext-toast-container';
      document.body.appendChild(this.toastContainer);
    } else {
      this.toastContainer = document.querySelector('.ext-toast-container');
    }
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

      if (!button.dataset.originalText) {
        button.dataset.originalText = button.textContent;
      }
    } else {
      button.classList.remove('button-loading');
      button.disabled = false;

      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
    }
  }

  // Toast Notifications
  showToast(message, type = 'info', duration = 5000, options = {}) {
    const toast = document.createElement('div');
    toast.className = `ext-toast ${type}`;

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
}

// Create global instance
export const loadingManager = new LoadingManager();

// Convenience functions for global use
window.showToast = (message, type, duration, options) =>
  loadingManager.showToast(message, type, duration, options);
window.setButtonLoading = (button, isLoading) => loadingManager.setButtonLoading(button, isLoading);
