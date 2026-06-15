/**
 * Centralized dark theme utilities for Chrome extension
 */

/**
 * Applies dark theme to the document
 * @param {boolean} isDark - Whether to apply dark theme
 */
export function applyDarkTheme(isDark) {
  const root = document.documentElement;
  const body = document.body;

  if (isDark) {
    root.setAttribute('data-theme', 'dark');
    root.setAttribute('data-bs-theme', 'dark');
    body.classList.add('dark-theme', 'ext-dark');
    const icon = document.getElementById('darkThemeIcon');
    if (icon) icon.textContent = 'wb_sunny';
  } else {
    root.setAttribute('data-theme', 'light');
    root.setAttribute('data-bs-theme', 'light');
    body.classList.remove('dark-theme', 'ext-dark');
    body.classList.add('light-theme', 'ext-light');
    const icon = document.getElementById('darkThemeIcon');
    if (icon) icon.textContent = 'brightness_2';
  }

  // Switch highlight.js theme for syntax highlighting
  const highlightTheme = document.getElementById('highlight-theme');
  if (highlightTheme) {
    highlightTheme.href = isDark
      ? 'libs/highlight-github-dark.min.css'
      : 'libs/highlight-github.min.css';
  }

  // Dispatch theme change event for other components
  window.dispatchEvent(
    new CustomEvent('themeChanged', {
      detail: { isDark, theme: isDark ? 'dark' : 'light' },
    })
  );
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
