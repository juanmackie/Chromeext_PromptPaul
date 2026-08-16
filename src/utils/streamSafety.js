/**
 * @fileoverview Bounds streaming buffers and provider error responses.
 * @module streamSafety
 */

export const MAX_SSE_BUFFER_BYTES = 512 * 1024;
export const MAX_PROVIDER_ERROR_BYTES = 64 * 1024;

const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Append one provider stream chunk without allowing an unterminated SSE frame
 * to grow without bound.
 * @param {string} current - Existing buffer contents.
 * @param {string} chunk - New decoded provider data.
 * @param {number} [maxBytes=MAX_SSE_BUFFER_BYTES] - Maximum UTF-8 byte size.
 * @returns {string} The combined buffer.
 * @throws {Error} When the combined buffer exceeds the limit.
 */
export function appendBoundedSseBuffer(current, chunk, maxBytes = MAX_SSE_BUFFER_BYTES) {
  const next = `${current || ''}${chunk || ''}`;
  if (textEncoder.encode(next).byteLength > maxBytes) {
    const error = new Error('Provider response event is too large.');
    error.code = 'PROVIDER_RESPONSE_TOO_LARGE';
    throw error;
  }
  return next;
}

/**
 * Truncate text by UTF-8 byte length.
 * @param {string} value - Text to bound.
 * @param {number} maxBytes - Maximum UTF-8 byte size.
 * @returns {string} Bounded text with a marker when truncation occurred.
 */
export function truncateUtf8(value, maxBytes) {
  const text = String(value || '');
  const bytes = textEncoder.encode(text);
  if (bytes.byteLength <= maxBytes) return text;
  let end = Math.max(0, maxBytes);
  while (end > 0) {
    try {
      return `${fatalTextDecoder.decode(bytes.slice(0, end))} [truncated]`;
    } catch (_) {
      end -= 1;
    }
  }
  return '[truncated]';
}

/**
 * Read a response body with a byte limit.
 * Fetch responses use the reader path so an oversized provider error body is
 * cancelled before the full body is retained. Small test doubles may expose
 * only response.text(), which is bounded after it resolves.
 * @param {object|null|undefined} response - Fetch response-like object.
 * @param {number} [maxBytes=MAX_PROVIDER_ERROR_BYTES] - Maximum UTF-8 bytes.
 * @returns {Promise<string>} Bounded response text.
 */
export async function readBoundedResponseText(response, maxBytes = MAX_PROVIDER_ERROR_BYTES) {
  const reader = response?.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    let text = '';
    let totalBytes = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        return text;
      }

      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
      if (totalBytes + bytes.byteLength > maxBytes) {
        await reader.cancel?.();
        return `${text} [truncated]`;
      }

      totalBytes += bytes.byteLength;
      text += decoder.decode(bytes, { stream: true });
    }
  }

  if (typeof response?.text === 'function') {
    return truncateUtf8(await response.text(), maxBytes);
  }
  if (typeof response?.json === 'function') {
    return truncateUtf8(JSON.stringify(await response.json()), maxBytes);
  }
  return '';
}
