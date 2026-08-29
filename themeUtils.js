/**
 * @fileoverview Shared theme preference and system-theme utilities.
 * @module themeUtils
 */

export const THEME_PREFERENCES = Object.freeze(['light', 'dark', 'system']);
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

function getSystemIsDark() {
  return typeof window.matchMedia === 'function' && window.matchMedia(SYSTEM_THEME_QUERY).matches;
}

function isThemeSelect(element) {
  return element?.tagName === 'SELECT';
}

/**
 * Normalize the stored preference while preserving the legacy darkTheme key.
 * @param {unknown} preference - Stored three-state preference.
 * @param {boolean} legacyDarkTheme - Legacy boolean theme value.
 * @returns {string} A supported theme preference.
 */
export function normalizeThemePreference(preference, legacyDarkTheme = false) {
  if (THEME_PREFERENCES.includes(preference)) return preference;
  return legacyDarkTheme === true ? 'dark' : 'light';
}

/**
 * Apply a light, dark, or system theme to the current extension page.
 * @param {string} preference - One of light, dark, or system.
 * @returns {boolean} Whether the effective theme is dark.
 */
export function applyThemePreference(preference) {
  const normalizedPreference = normalizeThemePreference(preference);
  const isDark =
    normalizedPreference === 'system' ? getSystemIsDark() : normalizedPreference === 'dark';
  const root = document.documentElement;
  const body = document.body;

  root.setAttribute('data-theme-preference', normalizedPreference);
  root.setAttribute('data-theme', isDark ? 'dark' : 'light');
  root.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
  body.classList.toggle('dark-theme', isDark);

  const icon = document.getElementById('darkThemeIcon');
  if (icon) icon.textContent = isDark ? 'wb_sunny' : 'brightness_2';

  const highlightTheme = document.getElementById('highlight-theme');
  if (highlightTheme) {
    highlightTheme.href = isDark
      ? 'libs/highlight-github-dark.min.css'
      : 'libs/highlight-github.min.css';
  }

  window.dispatchEvent(
    new CustomEvent('themeChanged', {
      detail: {
        isDark,
        theme: isDark ? 'dark' : 'light',
        preference: normalizedPreference,
      },
    })
  );
  return isDark;
}

/**
 * Apply an explicit dark/light value for legacy callers.
 * @param {boolean} isDark - Whether to apply dark mode.
 * @returns {boolean} Whether dark mode is active.
 */
export function applyDarkTheme(isDark) {
  return applyThemePreference(isDark ? 'dark' : 'light');
}

/**
 * Sets up a theme selector or the compact chat theme button's hidden toggle.
 * @param {HTMLInputElement|HTMLSelectElement} toggleElement - Theme control.
 */
export function setupThemeToggle(toggleElement) {
  if (!toggleElement) return;
  const isSelect = isThemeSelect(toggleElement);
  let currentPreference = 'light';
  const mediaQuery =
    typeof window.matchMedia === 'function' ? window.matchMedia(SYSTEM_THEME_QUERY) : null;

  function setPreference(preference, legacyDarkTheme = false) {
    currentPreference = normalizeThemePreference(preference, legacyDarkTheme);
    if (isSelect) toggleElement.value = currentPreference;
    else toggleElement.checked = applyThemePreference(currentPreference);
    if (isSelect) applyThemePreference(currentPreference);
  }

  chrome.storage.sync.get({ darkTheme: false, themePreference: '' }, (result) => {
    setPreference(result.themePreference, result.darkTheme);
  });

  toggleElement.addEventListener('change', () => {
    const preference = isSelect
      ? normalizeThemePreference(toggleElement.value)
      : toggleElement.checked
        ? 'dark'
        : 'light';
    currentPreference = preference;
    chrome.storage.sync.set({
      themePreference: preference,
      darkTheme: preference === 'dark',
    });
    applyThemePreference(preference);
  });

  if (mediaQuery?.addEventListener) {
    mediaQuery.addEventListener('change', () => {
      if (currentPreference === 'system') applyThemePreference('system');
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || (!changes.themePreference && !changes.darkTheme)) return;
    const preference = changes.themePreference
      ? changes.themePreference.newValue
      : changes.darkTheme?.newValue;
    setPreference(preference, changes.darkTheme?.newValue);
  });
}
