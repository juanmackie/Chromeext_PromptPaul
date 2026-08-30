/**
 * Theme toggle sidebar button: CSP-safe helper.
 * Loaded as a regular (non-inline) script so Chrome extension CSP allows it.
 */
(function () {
  'use strict';

  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;

  btn.addEventListener('click', function () {
    const cb = document.getElementById('darkThemeToggle');
    if (cb) {
      // Toggle the hidden checkbox, then dispatch change so setupThemeToggle fires
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    }
  });
})();
