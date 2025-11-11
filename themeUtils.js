/**
 * Centralized dark theme utilities for Chrome extension
 */

/**
 * Applies dark theme to the document
 * @param {boolean} isDark - Whether to apply dark theme
 */
export function applyDarkTheme(isDark) {
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