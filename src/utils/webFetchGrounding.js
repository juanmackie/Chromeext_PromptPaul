/**
 * @fileoverview Bounded page-content grounding for web-search results.
 *
 * The caller supplies the browser-specific page reader. Keeping that boundary
 * here makes the caps and result shape testable without a browser runtime.
 *
 * @module webFetchGrounding
 */

import { isSafePublicHttpUrl } from './mediaFetch.js';

const MAX_URLS = 3;
const MAX_EXTRACTED_BYTES = 24_000;
const MAX_SOURCE_ID_LENGTH = 80;
const MAX_SOURCE_TITLE_LENGTH = 200;
const TRUNCATION_MARKER = '\n\n[page content truncated]';

function clampText(text, maxBytes) {
  const value = String(text || '').trim();
  if (!value || maxBytes <= 0) return '';

  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  const markerBytes = encoder.encode(TRUNCATION_MARKER).byteLength;
  if (markerBytes >= maxBytes) return '';

  let low = 0;
  let high = value.length;
  let best = '';
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = value.slice(0, middle);
    if (encoder.encode(candidate).byteLength <= maxBytes - markerBytes) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best.trimEnd() + TRUNCATION_MARKER;
}

/**
 * Read bounded content from the top search-result URLs.
 * @param {Array<{id?: string, title?: string, url?: string}>} sources
 * @param {(url: string, options: {signal?: AbortSignal}) => Promise<{content?: string, title?: string, url?: string}|null>} readPage
 * @param {{maxUrls?: number, maxBytes?: number, signal?: AbortSignal}} [options]
 * @returns {Promise<Array<{id: string, title: string, url: string, markdown: string, chars: number}>>}
 */
export async function extractGroundingPages(sources, readPage, options = {}) {
  if (!Array.isArray(sources) || typeof readPage !== 'function') return [];

  const requestedUrls = Number.isFinite(options.maxUrls) ? Math.floor(options.maxUrls) : MAX_URLS;
  const maxUrls = Math.min(MAX_URLS, Math.max(0, requestedUrls));
  const requestedBytes = Number.isFinite(options.maxBytes)
    ? Math.floor(options.maxBytes)
    : MAX_EXTRACTED_BYTES;
  const maxBytes = Math.min(MAX_EXTRACTED_BYTES, Math.max(0, requestedBytes));
  const results = [];
  let usedBytes = 0;

  const candidates = sources.filter((source) => isSafePublicHttpUrl(source?.url)).slice(0, maxUrls);
  for (const source of candidates) {
    if (options.signal?.aborted) {
      throw new DOMException('The run was aborted.', 'AbortError');
    }

    const url = String(source?.url || '').trim();
    try {
      const page = await readPage(url, { signal: options.signal });
      if (options.signal?.aborted) {
        throw new DOMException('The run was aborted.', 'AbortError');
      }
      const remainingBytes = maxBytes - usedBytes;
      const markdown = clampText(page?.content, remainingBytes);
      if (!markdown) continue;

      const bytes = new TextEncoder().encode(markdown).byteLength;
      const pageUrl = isSafePublicHttpUrl(page?.url) ? String(page.url).trim() : url;
      results.push({
        id: String(source?.id || url).slice(0, MAX_SOURCE_ID_LENGTH),
        title: String(page?.title || source?.title || '').slice(0, MAX_SOURCE_TITLE_LENGTH),
        url: pageUrl.slice(0, 2048),
        markdown,
        chars: markdown.length,
      });
      usedBytes += bytes;
      if (usedBytes >= maxBytes) break;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // One inaccessible or unparseable result must not cancel the search.
    }
  }

  return results;
}
