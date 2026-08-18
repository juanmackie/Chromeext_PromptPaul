/**
 * @fileoverview Detects PDF documents from URL hints and response metadata.
 * @module pdfDetection
 */

const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d];
const CHROME_PDF_VIEWER_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';

/**
 * Returns the source document URL from Chrome's built-in PDF viewer URL.
 * Ordinary URLs are returned unchanged. Unknown extension pages do not get a
 * source URL, so browser-internal pages remain blocked by the normal guard.
 *
 * @param {string} url - Candidate tab URL.
 * @returns {string}
 */
export function getPdfSourceUrl(url) {
  const rawUrl = String(url || '');
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'chrome-extension:') return rawUrl;
    if (parsed.hostname !== CHROME_PDF_VIEWER_ID) return '';

    const sourceUrl = parsed.searchParams.get('file') || '';
    const source = new URL(sourceUrl);
    return /^(?:https?:|file:)$/.test(source.protocol) ? source.href : '';
  } catch (_) {
    return '';
  }
}

/**
 * Returns whether a URL or tab title contains a PDF filename hint.
 *
 * @param {string} url - Candidate document URL.
 * @param {string} [title] - Optional browser tab title.
 * @returns {boolean}
 */
export function isLikelyPdfUrl(url, title = '') {
  const candidates = [];
  const sourceUrl = getPdfSourceUrl(url);
  try {
    if (new URL(String(url || '')).protocol === 'chrome-extension:' && !sourceUrl) {
      return false;
    }
  } catch (_) {
    // Continue with the raw URL fallback below.
  }
  try {
    const parsed = new URL(String(url || ''));
    candidates.push(parsed.pathname, ...parsed.searchParams.values(), parsed.hash);
  } catch (_) {
    candidates.push(String(url || ''));
  }
  if (sourceUrl && sourceUrl !== String(url || '')) candidates.push(sourceUrl);
  candidates.push(String(title || ''));

  return candidates.some((candidate) => {
    try {
      return /\.pdf(?:$|[\s)#?&])/i.test(decodeURIComponent(String(candidate)));
    } catch (_) {
      return /\.pdf(?:$|[\s)#?&])/i.test(String(candidate));
    }
  });
}

/**
 * Returns whether a response content type identifies a PDF.
 *
 * @param {string} contentType - HTTP Content-Type value.
 * @returns {boolean}
 */
export function isPdfContentType(contentType) {
  return /^application\/pdf(?:\s*;|$)/i.test(String(contentType || '').trim());
}

/**
 * Returns whether response headers identify a PDF by type or filename.
 *
 * @param {Headers|Object|null} headers - Response headers.
 * @returns {boolean}
 */
export function hasPdfResponseHeaders(headers) {
  const getHeader = (name) => {
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get(name) || '';
    return headers[name] || headers[name.toLowerCase()] || '';
  };

  return (
    isPdfContentType(getHeader('content-type')) ||
    /\.pdf(?:["';]|$)/i.test(String(getHeader('content-disposition')))
  );
}

function hasPdfMagicBytes(bytes) {
  return PDF_MAGIC_BYTES.every((value, index) => bytes[index] === value);
}

async function responseStartsWithPdfMagic(response) {
  const reader = response?.body?.getReader?.();
  if (!reader) return false;

  const bytes = [];
  try {
    while (bytes.length < PDF_MAGIC_BYTES.length) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const byte of value || []) {
        bytes.push(byte);
        if (bytes.length >= PDF_MAGIC_BYTES.length) break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return hasPdfMagicBytes(bytes);
}

/**
 * Probes an extensionless HTTP(S) endpoint without downloading the document.
 * A HEAD request checks response metadata. A bounded range request checks the
 * PDF signature when the server does not provide useful metadata.
 *
 * @param {string} url - Candidate document URL.
 * @param {Object} [options] - Probe options.
 * @param {typeof fetch} [options.fetchImpl] - Fetch implementation for tests.
 * @param {number} [options.timeoutMs] - Maximum probe duration.
 * @returns {Promise<boolean>}
 */
export async function probePdfUrl(url, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const sourceUrl = getPdfSourceUrl(url);
  if (isLikelyPdfUrl(sourceUrl || url) || typeof fetchImpl !== 'function') {
    return isLikelyPdfUrl(sourceUrl || url);
  }

  let parsed;
  try {
    parsed = new URL(sourceUrl || String(url || ''));
  } catch (_) {
    return false;
  }
  if (!/^https?:$/.test(parsed.protocol)) return false;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = setTimeout(() => controller?.abort(), timeoutMs);
  const requestOptions = {
    redirect: 'follow',
    ...(controller ? { signal: controller.signal } : {}),
  };

  try {
    const headResponse = await fetchImpl(parsed.href, { ...requestOptions, method: 'HEAD' });
    if (hasPdfResponseHeaders(headResponse?.headers)) return true;

    const rangeResponse = await fetchImpl(parsed.href, {
      ...requestOptions,
      method: 'GET',
      headers: { Range: 'bytes=0-4' },
    });
    if (hasPdfResponseHeaders(rangeResponse?.headers)) return true;
    return await responseStartsWithPdfMagic(rangeResponse);
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
