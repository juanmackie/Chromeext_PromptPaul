import { describe, expect, it } from 'vitest';
import { isRuntimeMessageUndelivered } from '../src/utils/runtimeErrors.js';

describe('runtime message delivery classification', () => {
  it('only marks a missing receiver as definitely not delivered', () => {
    expect(
      isRuntimeMessageUndelivered('Could not establish connection. Receiving end does not exist.')
    ).toBe(true);
    expect(
      isRuntimeMessageUndelivered('The message port closed before a response was received.')
    ).toBe(false);
    expect(isRuntimeMessageUndelivered(new Error('Unrelated failure'))).toBe(false);
  });
});
