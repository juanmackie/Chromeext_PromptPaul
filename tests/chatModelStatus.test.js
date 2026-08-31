import { describe, expect, it } from 'vitest';
import { formatModel } from '../src/chat/ChatModelStatus.js';

describe('ChatModelStatus', () => {
  it('preserves the configured model name', () => {
    expect(formatModel('openrouter/free')).toBe('openrouter/free');
  });

  it('uses a readable fallback when no model is configured', () => {
    expect(formatModel('')).toBe('Not set');
    expect(formatModel(null)).toBe('Not set');
  });
});
