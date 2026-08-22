/**
 * @fileoverview Pure site-aware extraction formatters for Reddit threads,
 * GitHub page metadata, and RSS/Atom feeds. Consumed structurally by the
 * classic content script (`content_script_unified.js`), which mirrors these
 * helpers because manifest content scripts have no module-loader contract.
 * All outputs are bounded, deterministic, and treat extracted text strictly
 * as untrusted source data.
 * @module siteExtractors
 */

/**
 * Bounded output caps shared by every extractor.
 * @typedef {Object} SiteExtractorCaps
 * @property {number} itemText Maximum characters per post/comment/field value.
 * @property {number} redditComments Maximum flattened comments per thread.
 * @property {number} redditDepth Maximum comment nesting depth rendered.
 * @property {number} totalChars Maximum characters of any formatted adapter body.
 * @property {number} feedItems Maximum feed entries rendered.
 * @property {number} feedSnippet Maximum characters per feed entry snippet.
 */

/** @type {SiteExtractorCaps} */
export const SITE_EXTRACTOR_CAPS = {
  itemText: 600,
  redditComments: 60,
  redditDepth: 8,
  totalChars: 24000,
  feedItems: 20,
  feedSnippet: 300,
};

/**
 * Clamp free text to a character budget, appending an explicit truncation marker.
 * @param {string} text Raw untrusted text.
 * @param {number} cap Maximum characters to keep.
 * @returns {string} Clamped single-line-safe text.
 */
export function clampExtractorText(text, cap) {
  const clean = String(text || '')
    .replace(/\u0000/g, '') // eslint-disable-line no-control-regex
    .replace(/\r\n/g, '\n')
    .trim();
  if (!clean) return '';
  if (cap <= 0) return '';
  if (clean.length <= cap) return clean;
  return `${clean.slice(0, Math.max(0, cap - 13))}… [truncated]`;
}

/**
 * Clamp a field onto one logical line (newlines become spaces) for metadata rows.
 * @param {string} text Raw untrusted text.
 * @param {number} cap Maximum characters to keep.
 * @returns {string} Single-line clamped text.
 */
function clampInlineText(text, cap) {
  const clamped = clampExtractorText(text, cap);
  return clamped.replace(/\s*\n+\s*/g, ' ').trim();
}

/**
 * Format a Reddit thread into bounded Markdown.
 * @param {{post?: Object, comments?: Array<Object>}} thread Thread data collected from shreddit DOM.
 * @param {Partial<SiteExtractorCaps>} [caps] Cap overrides for tests.
 * @returns {string} Markdown body, or '' when nothing usable was provided.
 */
export function formatRedditThread(thread, caps = {}) {
  const limits = { ...SITE_EXTRACTOR_CAPS, ...caps };
  const post = thread?.post || {};
  const rawComments = Array.isArray(thread?.comments) ? thread.comments : [];
  const title = clampInlineText(post.title, limits.itemText);
  const body = clampExtractorText(post.body, limits.itemText);

  if (!title && !body && rawComments.length === 0) return '';

  const lines = [];
  if (title) lines.push(`## Reddit thread: ${title}`, '');
  const meta = [];
  if (post.subreddit) meta.push(`r/${clampInlineText(post.subreddit, 100)}`);
  if (post.author) meta.push(`u/${clampInlineText(post.author, 100)}`);
  if (Number.isFinite(post.score)) meta.push(`Score: ${post.score}`);
  if (meta.length) lines.push(`- ${meta.join(' · ')}`, '');
  if (body) lines.push(body, '');

  const renderedComments = [];
  for (const comment of rawComments.slice(0, limits.redditComments)) {
    if (renderedComments.length >= limits.redditComments) break;
    if (!comment) continue;
    const depth = Number.isFinite(comment.depth)
      ? Math.max(0, Math.min(limits.redditDepth, comment.depth))
      : 0;
    const indent = '  '.repeat(depth);
    const who = comment.author ? `u/${clampInlineText(comment.author, 100)}` : 'unknown';
    const score = Number.isFinite(comment.score) ? ` (${comment.score})` : '';
    const text = clampExtractorText(comment.body, limits.itemText).replace(/\s*\n+\s*/g, ' ');
    if (!text) continue;
    renderedComments.push(`${indent}- ${who}${score}: ${text}`);
  }
  if (renderedComments.length > 0) {
    lines.push('### Comments', '', ...renderedComments);
  }

  const out = lines.join('\n').trim();
  if (out.length > limits.totalChars) {
    return `${out.slice(0, limits.totalChars - 13)}… [truncated]`;
  }
  return out;
}

/**
 * Format structured GitHub page metadata into a bounded Markdown header block.
 * The generic two-pass extraction keeps carrying the page body; this block is
 * merged above it so repository/issue context survives weak DOM extraction.
 * @param {Object} meta Metadata detected from GitHub DOM/path.
 * @param {string} [meta.kind] One of `repo`, `issues`, `pull`.
 * @param {string[]} [meta.fields] Ordered `[label, value]` pairs; empty values skipped.
 * @returns {string} Markdown metadata block, or '' when no usable fields exist.
 */
export function formatGitHubMetadata(meta, caps = {}) {
  const limits = { ...SITE_EXTRACTOR_CAPS, ...caps };
  const kind = meta?.kind === 'issues' || meta?.kind === 'pull' ? meta.kind : 'repo';
  const heading =
    kind === 'repo'
      ? 'Repository metadata'
      : kind === 'pull'
        ? 'Pull request metadata'
        : 'Issue metadata';
  const fields = Array.isArray(meta?.fields) ? meta.fields : [];
  const lines = [`### ${heading}`, ''];
  let used = 0;
  for (const field of fields) {
    if (!Array.isArray(field) || field.length < 2) continue;
    const label = clampInlineText(field[0], 40);
    const value = clampInlineText(field[1], limits.itemText);
    if (!label || !value) continue;
    lines.push(`- ${label}: ${value}`);
    used++;
    if (used >= 12) break;
  }
  if (used === 0) return '';
  return lines.join('\n');
}

/**
 * Decode the handful of entities browsers resolve in XML text nodes.
 * @param {string} text Encoded text.
 * @returns {string} Decoded text.
 */
function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Normalize an XML text node: unwrap CDATA, strip embedded HTML tags,
 * decode basic entities, and collapse whitespace.
 * @param {string} raw Raw XML text content.
 * @returns {string} Plain text.
 */
function xmlTextToPlainText(raw) {
  let text = String(raw || '');
  const cdata = text.match(/<!\[CDATA\[([\s\S]*?)]]>/);
  if (cdata) {
    // CDATA holds literal markup; strip tags and do not decode entities.
    return String(cdata[1])
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  // Strip markup before decoding entities so decoded literals such as
  // `&lt;story&gt;` survive as data instead of being treated as a tag.
  return decodeXmlEntities(
    String(text)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Extract the first `<tag …>value</tag>` occurrence from an XML fragment.
 * @param {string} block XML fragment.
 * @param {string} tag Tag name.
 * @returns {string} Raw inner text, or '' when absent.
 */
function extractXmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1] : '';
}

/**
 * Parse an RSS 2.0 or Atom document into bounded structured entries.
 * Pure string parsing keeps the helper Node-testable without DOMParser.
 * @param {string} xmlText Raw feed document text.
 * @param {Partial<SiteExtractorCaps>} [caps] Cap overrides for tests.
 * @returns {{kind: 'rss'|'atom', title: string, items: Array<{title:string, link:string, date:string, snippet:string}>}|null}
 * Parsed feed, or null when the document is not a recognizable feed.
 */
export function parseFeedXml(xmlText, caps = {}) {
  const limits = { ...SITE_EXTRACTOR_CAPS, ...caps };
  const source = String(xmlText || '');
  const isRss = /<rss[\s>]/i.test(source);
  const isAtom = /<feed[\s>]/i.test(source);
  if (!isRss && !isAtom) return null;

  const itemTag = isRss ? 'item' : 'entry';
  const headEnd = source.search(new RegExp(`<${itemTag}[\\s>]`, 'i'));
  const head = headEnd === -1 ? source : source.slice(0, headEnd);
  const title = clampInlineText(xmlTextToPlainText(extractXmlTag(head, 'title')), limits.itemText);

  const itemBlocks = source.match(new RegExp(`<${itemTag}[\\s\\S]*?</${itemTag}>`, 'gi')) || [];
  const items = [];
  for (const block of itemBlocks.slice(0, limits.feedItems)) {
    const itemTitle = clampInlineText(
      xmlTextToPlainText(extractXmlTag(block, 'title')),
      limits.itemText
    );
    let link = '';
    const hrefMatch = block.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i);
    if (hrefMatch) {
      link = clampInlineText(hrefMatch[1], 500);
    } else {
      link = clampInlineText(xmlTextToPlainText(extractXmlTag(block, 'link')), 500);
    }
    const dateRaw =
      extractXmlTag(block, 'pubDate') ||
      extractXmlTag(block, 'updated') ||
      extractXmlTag(block, 'published');
    const date = clampInlineText(xmlTextToPlainText(dateRaw), 60);
    const snippetSource =
      extractXmlTag(block, 'description') ||
      extractXmlTag(block, 'summary') ||
      extractXmlTag(block, 'content:encoded') ||
      extractXmlTag(block, 'content');
    const snippet = clampExtractorText(xmlTextToPlainText(snippetSource), limits.feedSnippet);
    if (!itemTitle && !link && !snippet) continue;
    items.push({ title: itemTitle, link, date, snippet });
  }

  if (!items.length) return null;
  return { kind: isRss ? 'rss' : 'atom', title, items };
}

/**
 * Format a parsed feed into bounded Markdown.
 * @param {string} xmlText Raw feed document text.
 * @param {Partial<SiteExtractorCaps>} [caps] Cap overrides for tests.
 * @returns {string} Markdown body, or '' when the document is not a usable feed.
 */
export function formatFeedXml(xmlText, caps = {}) {
  let feed;
  try {
    feed = parseFeedXml(xmlText, caps);
  } catch (_) {
    return '';
  }
  if (!feed) return '';

  const lines = [];
  lines.push(feed.title ? `## Feed: ${feed.title}` : '## Feed', '');
  for (const item of feed.items) {
    const heading = item.title || item.link || '(untitled entry)';
    lines.push(`### ${heading}`, '');
    const meta = [];
    if (item.date) meta.push(item.date);
    if (item.link) meta.push(item.link);
    if (meta.length) lines.push(meta.join(' · '), '');
    if (item.snippet) lines.push(item.snippet, '');
  }

  const limits = { ...SITE_EXTRACTOR_CAPS, ...caps };
  const out = lines.join('\n').trim();
  if (out.length > limits.totalChars) {
    return `${out.slice(0, limits.totalChars - 13)}… [truncated]`;
  }
  return out;
}
