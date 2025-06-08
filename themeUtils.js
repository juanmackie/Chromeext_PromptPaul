/**
 * Centralized dark theme utilities for Chrome extension
 */

/**
 * Applies dark theme to the document
 * @param {boolean} isDark - Whether to apply dark theme
 */
export function applyDarkTheme(isDark) {
  if (isDark) {
    document.body.classList.add('dark-theme');
    const icon = document.getElementById('darkThemeIcon');
    if (icon) icon.textContent = 'wb_sunny';
  } else {
    document.body.classList.remove('dark-theme');
    const icon = document.getElementById('darkThemeIcon');
    if (icon) icon.textContent = 'brightness_2';
  }
}

/**
 * Sets up theme toggle with storage synchronization
 * @param {HTMLInputElement} toggleElement - Theme toggle element
 */
export function setupThemeToggle(toggleElement) {
  // Load initial state
  chrome.storage.sync.get({ darkTheme: false }, (result) => {
    toggleElement.checked = !!result.darkTheme;
    applyDarkTheme(!!result.darkTheme);
  });

  // Handle toggle changes
  toggleElement.addEventListener('change', () => {
    const isDark = toggleElement.checked;
    chrome.storage.sync.set({ darkTheme: isDark });
    applyDarkTheme(isDark);
  });

  // Sync across extension components
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.darkTheme) {
      const isDark = changes.darkTheme.newValue;
      toggleElement.checked = isDark;
      applyDarkTheme(isDark);
    }
  });
}