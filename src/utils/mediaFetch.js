/**
 * @fileoverview Safe public-media URL validation and bounded response reads.
 * @module mediaFetch
 */

import { isValidHttpUrl } from './validation.js';

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const MEDIA_FETCH_TIMEOUT_MS = 30_000;

function isPrivateMediaHost(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.includes(':')
  ) {
    return true;
  }

  const octets = host.split('.').map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

/**
 * Check whether a media URL is an HTTP(S) URL on a non-private host.
 * @param {unknown} url - Candidate URL.
 * @returns {boolean}
 */
export function isSafeMediaUrl(url) {
  if (!isValidHttpUrl(url)) return false;
  try {
    return !isPrivateMediaHost(new URL(url).hostname);
  } catch (_) {
    return false;
  }
}

/**
 * Read a media response without retaining more than the configured byte limit.
 * @param {object} response - Fetch response-like object.
 * @returns {Promise<Blob>}
 */
export async function readMediaBlob(response) {
  const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].trim();
  if (
    contentType &&
    !/^(?:image|video|audio)\//i.test(contentType) &&
    contentType !== 'application/octet-stream'
  ) {
    throw new Error('Unsupported media content type.');
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES) {
    throw new Error('Media file is too large.');
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const blob = await response.blob();
    if (blob.size > MAX_MEDIA_BYTES) throw new Error('Media file is too large.');
    return blob;
  }

  const chunks = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_MEDIA_BYTES) {
        await reader.cancel?.();
        throw new Error('Media file is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return new Blob(chunks, { type: contentType });
}
