import { describe, expect, it } from 'vitest';
import { isSafePublicHttpUrl, MAX_MEDIA_BYTES, readMediaBlob } from '../src/utils/mediaFetch.js';

describe('mediaFetch', () => {
  it('allows public HTTP(S) URLs and blocks private destinations', () => {
    expect(isSafePublicHttpUrl('https://example.com/image.png')).toBe(true);
    expect(isSafePublicHttpUrl('http://127.0.0.1/image.png')).toBe(false);
    expect(isSafePublicHttpUrl('http://192.168.1.10/image.png')).toBe(false);
    expect(isSafePublicHttpUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects non-media response content types', async () => {
    const response = {
      headers: { get: () => 'text/html' },
      body: null,
    };

    await expect(readMediaBlob(response)).rejects.toThrow('content type');
  });

  it('cancels streamed responses that exceed the byte limit', async () => {
    let cancelled = false;
    const reader = {
      async read() {
        return { done: false, value: new Uint8Array(MAX_MEDIA_BYTES + 1) };
      },
      async cancel() {
        cancelled = true;
      },
      releaseLock() {},
    };
    const response = {
      headers: { get: () => 'application/octet-stream' },
      body: { getReader: () => reader },
    };

    await expect(readMediaBlob(response)).rejects.toThrow('too large');
    expect(cancelled).toBe(true);
  });
});
