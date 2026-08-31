import { describe, expect, it, vi } from 'vitest';
import {
  disableDevDiagnostics,
  enableDevDiagnostics,
  isDevDiagnosticsEnabled,
  recordDevDiagnostic,
  sanitizeDevDiagnostic,
} from '../src/utils/devDiagnostics.js';

const sessionData = {};
globalThis.chrome = {
  storage: {
    session: {
      async get(key) {
        return { [key]: sessionData[key] };
      },
      async set(values) {
        Object.assign(sessionData, values);
      },
      async remove(keys) {
        for (const key of keys) delete sessionData[key];
      },
    },
    onChanged: { addListener: vi.fn() },
  },
  runtime: {},
};

describe('development diagnostics', () => {
  it('redacts credential-shaped fields and values', () => {
    const result = sanitizeDevDiagnostic({
      apiKey: 'secret-key',
      headers: { authorization: 'Bearer abc123', 'x-api-key': 'header-key' },
      nested: { password: 'password-value', token: 'token-value' },
      message: 'request failed; token=secret-value',
      targetUrl: 'https://example.test/path?token=secret#fragment',
    });

    expect(result).toEqual({
      apiKey: '[REDACTED]',
      headers: { authorization: '[REDACTED]', 'x-api-key': '[REDACTED]' },
      nested: { password: '[REDACTED]', token: '[REDACTED]' },
      message: 'request failed; token=[REDACTED]',
      targetUrl: 'https://example.test/path',
    });
  });

  it('expires an enabled trace after its session window', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await enableDevDiagnostics(1_000);
    expect(isDevDiagnosticsEnabled()).toBe(true);
    clock.mockReturnValue(2_001);
    expect(isDevDiagnosticsEnabled()).toBe(false);
    clock.mockRestore();
    await disableDevDiagnostics();
  });

  it('bounds complete diagnostic entries before recording', async () => {
    await enableDevDiagnostics(60_000);
    const entry = recordDevDiagnostic('large_payload', { body: 'x'.repeat(200_000) });
    expect(JSON.stringify(entry).length).toBeLessThanOrEqual(96 * 1024);
    await disableDevDiagnostics();
  });

  it('bounds deeply nested and oversized values', () => {
    const result = sanitizeDevDiagnostic({
      body: 'x'.repeat(40_000),
      deep: { one: { two: { three: { four: { five: { six: { seven: true } } } } } } },
    });

    expect(result.body).toHaveLength(32_012);
    expect(result.deep.one.two.three.four.five).toBe('[depth limit]');
  });
});
