/**
 * @fileoverview Bounded page-content grounding for web-search results.
 *
 * The caller supplies the browser-specific page reader. Keeping that boundary
 * here makes the caps and result shape testable without a browser runtime.
 *
 * @module webFetchGrounding
 */

import { isSafePublicHttpUrl } from './mediaFetch.js';

const MAX_SEARCH_RESULTS = 5;
const MAX_READABLE_PAGES = 3;
const MAX_EXTRACTED_BYTES = 24_000;
const MAX_PAGE_BYTES = 8_000;
const MAX_SOURCE_ID_LENGTH = 80;
const MAX_SOURCE_TITLE_LENGTH = 200;
const PAGE_READ_TIMEOUT_MS = 15_000;
const EXTRACTION_TOTAL_TIMEOUT_MS = 45_000;
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
 * Deduplicates URLs, tries up to five ranked results to obtain three
 * readable pages, caps each page at 8 KB and total at 24 KB UTF-8 bytes,
 * with 15 s/page and 45 s overall timeouts. Propagates Stop immediately
 * via the abort signal and ignores late responses.
 *
 * @param {Array<{id?: string, title?: string, url?: string}>} sources
 * @param {(url: string, options: {signal?: AbortSignal}) => Promise<{content?: string, title?: string, url?: string}|null>} readPage
 * @param {{maxBytes?: number, signal?: AbortSignal}} [options]
 * @returns {Promise<{pages: Array<{id: string, title: string, url: string, markdown: string, chars: number}>, outcomes: Array<{url: string, status: string, error?: string}>}>}
 */
export async function extractGroundingPages(sources, readPage, options = {}) {
  if (!Array.isArray(sources) || typeof readPage !== 'function') {
    return { pages: [], outcomes: [] };
  }

  // Propagate Stop immediately if already aborted.
  if (options.signal?.aborted) {
    throw new DOMException('The run was aborted.', 'AbortError');
  }

  const maxBytes = Math.min(
    MAX_EXTRACTED_BYTES,
    Math.max(
      0,
      Number.isFinite(options.maxBytes) ? Math.floor(options.maxBytes) : MAX_EXTRACTED_BYTES
    )
  );

  // Deduplicate URLs and collect up to MAX_SEARCH_RESULTS candidates.
  const seen = new Set();
  const candidates = [];
  for (const source of sources) {
    const url = String(source?.url || '').trim();
    if (!isSafePublicHttpUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    candidates.push({ source, url });
    if (candidates.length >= MAX_SEARCH_RESULTS) break;
  }

  // Overall extraction timeout (45 s) - stops the loop gracefully.
  const overallController = new AbortController();
  const overallTimeout = setTimeout(() => overallController.abort(), EXTRACTION_TOTAL_TIMEOUT_MS);

  // Run-level abort propagation - throws AbortError immediately.
  const onRunAbort = () => overallController.abort();
  options.signal?.addEventListener('abort', onRunAbort);

  const pages = [];
  const outcomes = [];
  let usedBytes = 0;

  try {
    for (const { source, url } of candidates) {
      if (pages.length >= MAX_READABLE_PAGES) break;

      // Propagate Stop immediately.
      if (options.signal?.aborted) {
        throw new DOMException('The run was aborted.', 'AbortError');
      }

      // Overall timeout - stop extracting gracefully for remaining URLs.
      if (overallController.signal.aborted) {
        outcomes.push({ url, status: 'timeout' });
        break;
      }

      // Per-page read with 15 s timeout via Promise.race.
      let page;
      try {
        const pageController = new AbortController();
        const pageTimeout = setTimeout(() => pageController.abort(), PAGE_READ_TIMEOUT_MS);
        try {
          page = await Promise.race([
            readPage(url, { signal: options.signal }),
            new Promise((_, reject) => {
              pageController.signal.addEventListener('abort', () => {
                reject(new DOMException('Page read timed out.', 'TimeoutError'));
              });
            }),
          ]);
        } finally {
          clearTimeout(pageTimeout);
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        outcomes.push({ url, status: 'failed', error: err?.message });
        continue;
      }

      // Propagate Stop after a completed read.
      if (options.signal?.aborted) {
        throw new DOMException('The run was aborted.', 'AbortError');
      }

      const content = String(page?.content || '').trim();
      const finalUrl = isSafePublicHttpUrl(page?.url) ? String(page.url).trim() : url;

      if (!content) {
        outcomes.push({ url, status: 'empty' });
        continue;
      }

      const remainingBytes = maxBytes - usedBytes;
      if (remainingBytes <= 0) {
        outcomes.push({ url, status: 'unsupported' });
        continue;
      }

      const markdown = clampText(content, Math.min(MAX_PAGE_BYTES, remainingBytes));
      if (!markdown) {
        outcomes.push({ url, status: 'unsupported' });
        continue;
      }

      const bytes = new TextEncoder().encode(markdown).byteLength;
      pages.push({
        id: String(source?.id || url).slice(0, MAX_SOURCE_ID_LENGTH),
        title: String(page?.title || source?.title || '').slice(0, MAX_SOURCE_TITLE_LENGTH),
        url: finalUrl.slice(0, 2048),
        markdown,
        chars: markdown.length,
      });
      usedBytes += bytes;
      outcomes.push({ url, status: 'success' });
    }
  } finally {
    clearTimeout(overallTimeout);
    options.signal?.removeEventListener('abort', onRunAbort);
  }

  return { pages, outcomes };
}
