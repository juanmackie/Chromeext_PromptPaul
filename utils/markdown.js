import { marked } from '../libs/marked.js';
import DOMPurify from '../libs/dompurify.js';

// Configure marked once
marked.setOptions({
  gfm: true,
  breaks: true,
  sanitizer: html =>
    DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'p',
        'br',
        'strong',
        'em',
        'u',
        'code',
        'pre',
        'span',
        'div',
        'a',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'blockquote',
        'hr',
      ],
      ALLOWED_ATTR: ['href', 'title', 'class'],
      ALLOWED_URI_REGEXP:
        /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|javascript):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    }),
});

/**
 * Renders markdown text to HTML
 * @param {string} text - The markdown text to render
 * @returns {string} The rendered HTML
 */
export const renderMarkdown = text => {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return marked(text);
};

/**
 * Parses markdown text to tokens
 * @param {string} text - The markdown text to parse
 * @returns {Array} The parsed tokens
 */
export const parseMarkdown = text => {
  if (!text || typeof text !== 'string') {
    return [];
  }
  return marked.lexer(text);
};

/**
 * Checks if text contains markdown syntax
 * @param {string} text - The text to check
 * @returns {boolean} True if text contains markdown
 */
export const hasMarkdown = text => {
  if (!text || typeof text !== 'string') {
    return false;
  }
  const markdownRegex = /(\*\*|__|\*|_|`|#{1,6}|\[.*?\]\(.*?\)|^\s*[-*+]\s|^\s*\d+\.\s)/m;
  return markdownRegex.test(text);
};

export default {
  renderMarkdown,
  parseMarkdown,
  hasMarkdown,
};
