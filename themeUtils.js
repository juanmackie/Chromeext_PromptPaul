/**
 * Centralized dark theme utilities for Chrome extension
 */

/**
 * Applies dark theme to document
 * @param {boolean} isDark - Whether to apply dark theme
 */
export function applyDarkTheme(isDark) {
  // Apply theme using data-theme attribute for consistency
  const root = document.documentElement;
  const body = document.body;
  
  if (isDark) {
    root.setAttribute('data-theme', 'dark');
    body.classList.remove('light-theme', 'ext-light');
    body.classList.add('dark-theme', 'ext-dark');
  } else {
    root.setAttribute('data-theme', 'light');
    body.classList.remove('dark-theme', 'ext-dark');
    body.classList.add('light-theme', 'ext-light');
  }

  // Note: Main theme toggle icon is handled in chat.js to avoid conflicts

  const darkThemeIcon = document.getElementById('darkThemeIcon');
  if (darkThemeIcon) {
    // Use moon icon in light mode, sun icon in dark mode for options page toggle
    darkThemeIcon.textContent = isDark ? 'light_mode' : 'brightness_2';
  }

  // Update copy icons based on theme and their IDs
  const copyRawIcons = document.querySelectorAll('img[id^="copy-Raw-icon-"]');
  const copyFormattedIcons = document.querySelectorAll('img[id^="copy-Formatted-icon-"]');

  copyRawIcons.forEach(icon => {
    // Match MessageRenderer.messageIcons mapping
    // Dark theme uses the higher-contrast "light" assets
    icon.src = isDark ? 'icons/light_copy_markdown.png' : 'icons/copy_markdown.png';
  });

  copyFormattedIcons.forEach(icon => {
    // Match MessageRenderer.messageIcons mapping
    // Dark theme uses the higher-contrast "light" assets
    icon.src = isDark ? 'icons/light_copy_formatted.png' : 'icons/copy_formatted.png';
  });
  
  // Dispatch theme change event for other components
  window.dispatchEvent(new CustomEvent('themeChanged', {
    detail: { isDark, theme: isDark ? 'dark' : 'light' }
  }));
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