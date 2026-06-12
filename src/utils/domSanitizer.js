/**
 * @fileoverview DOM sanitization helpers for extension UI surfaces.
 * @module domSanitizer
 */

/**
 * Escape text for safe HTML attribute or text interpolation.
 * @param {unknown} value - Value to escape.
 * @returns {string} Escaped HTML text.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitize HTML generated from untrusted markdown or page content.
 * @param {string} html - Raw HTML.
 * @returns {string} Sanitized HTML.
 */
export function sanitizeHtml(html) {
  const rawHtml = String(html ?? '');
  if (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) {
    return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
  }

  const fallback = document.createElement('template');
  fallback.innerHTML = rawHtml;
  const forbidden = fallback.content.querySelectorAll(
    'script, style, iframe, object, embed, link, meta, base, form, input, button'
  );
  forbidden.forEach((node) => node.remove());
  return fallback.innerHTML;
}

/**
 * Render markdown to sanitized HTML.
 * @param {string} markdown - Markdown text.
 * @returns {string} Sanitized HTML.
 */
export function renderMarkdown(markdown) {
  if (typeof marked !== 'undefined' && marked.parse) {
    return sanitizeHtml(marked.parse(markdown || ''));
  }
  return escapeHtml(markdown || '');
}
