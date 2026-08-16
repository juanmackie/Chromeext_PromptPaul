import { describe, expect, it } from 'vitest';
import { createKeyedOperationLock } from '../src/utils/keyedOperationLock.js';

describe('createKeyedOperationLock', () => {
  it('coalesces concurrent operations for the same key', async () => {
    const lock = createKeyedOperationLock();
    let calls = 0;
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const operation = async () => {
      calls += 1;
      await pending;
      return 'shared-result';
    };

    const first = lock.run('profile-1', operation);
    const second = lock.run('profile-1', operation);
    expect(first).toBe(second);
    expect(lock.isLocked('profile-1')).toBe(true);

    release();
    await expect(first).resolves.toBe('shared-result');
    expect(calls).toBe(1);
    expect(lock.isLocked('profile-1')).toBe(false);
  });

  it('rejects a second exclusive operation and releases after failure', async () => {
    const lock = createKeyedOperationLock();
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const first = lock.tryRun('profile-1', async () => {
      await pending;
      throw new Error('reset failed');
    });

    expect(lock.tryRun('profile-1', async () => 'not-run')).toBeNull();
    release();
    await expect(first).rejects.toThrow('reset failed');
    expect(lock.isLocked('profile-1')).toBe(false);
    await expect(lock.tryRun('profile-1', async () => 'next-run')).resolves.toBe('next-run');
  });
});
