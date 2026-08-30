import { afterEach, describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../src/utils/domSanitizer.js';

describe('domSanitizer', () => {
  const originalPurify = globalThis.DOMPurify;

  afterEach(() => {
    globalThis.DOMPurify = originalPurify;
  });

  it('escapes all HTML when DOMPurify is unavailable', () => {
    globalThis.DOMPurify = undefined;

    const result = sanitizeHtml(
      '<img src="x" onerror="alert(1)"><a href="javascript:alert(2)">x</a>'
    );

    expect(result).toContain('&lt;img');
    expect(result).toContain('&lt;a href=');
    expect(result).not.toContain('<img');
    expect(result).toContain('javascript:alert(2)');
  });
});
