import { describe, expect, it } from 'vitest';
import {
  appendBoundedSseBuffer,
  MAX_PROVIDER_ERROR_BYTES,
  readBoundedResponseText,
  truncateUtf8,
} from '../src/utils/streamSafety.js';

describe('stream safety helpers', () => {
  it('rejects an unterminated SSE buffer over the configured byte cap', () => {
    expect(() => appendBoundedSseBuffer('', '12345', 4)).toThrow(
      'Provider response event is too large.'
    );
  });

  it('cancels an oversized response body before retaining it', async () => {
    let cancelled = false;
    const response = {
      body: {
        getReader() {
          return {
            async read() {
              return { done: false, value: new TextEncoder().encode('too large') };
            },
            async cancel() {
              cancelled = true;
            },
          };
        },
      },
    };

    await expect(readBoundedResponseText(response, 4)).resolves.toBe(' [truncated]');
    expect(cancelled).toBe(true);
  });

  it('bounds text-only response doubles for test and fallback implementations', async () => {
    const text = 'x'.repeat(MAX_PROVIDER_ERROR_BYTES + 10);
    await expect(readBoundedResponseText({ text: async () => text })).resolves.toContain(
      '[truncated]'
    );
    expect(truncateUtf8('ééé', 3)).toBe('é [truncated]');
  });
});
