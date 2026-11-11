/**
 * @fileoverview Anonymous, content-free ACT outcome telemetry payload builder.
 * @module actTelemetryTest
 */

import { describe, expect, it } from 'vitest';
import { buildActRunOutcomePayload } from '../src/background/actTelemetry.js';

describe('actTelemetry.buildActRunOutcomePayload', () => {
  it('passes bounded, enum-typed fields through', () => {
    const payload = buildActRunOutcomePayload({
      outcome: 'failed',
      reason: 'loop_detected',
      steps: 14,
      durationMs: 90_000,
      observation: 3,
      navigation: 1,
      mutation: 2,
      loopWarnings: 2,
      replanCount: 1,
      model: 'gpt-4.1-mini',
    });
    expect(payload).toEqual({
      outcome: 'failed',
      reason: 'loop_detected',
      steps: '9_17',
      duration: 'under_2m',
      observation: 3,
      navigation: 1,
      mutation: 2,
      loop_warnings: 2,
      replans: 1,
      model: 'gpt-4.1-mini',
    });
  });

  it('maps missing reason to none for done runs', () => {
    const payload = buildActRunOutcomePayload({ outcome: 'done', reason: null, model: '' });
    expect(payload).toMatchObject({ outcome: 'done', reason: 'none' });
  });

  it('rejects unknown outcome and unknown reason instead of leaking free text', () => {
    expect(buildActRunOutcomePayload({ outcome: 'hacked', reason: 'x' })).toBeNull();
    const payload = buildActRunOutcomePayload({ outcome: 'failed', reason: 'teacher_said_so' });
    expect(payload.reason).toBe('ambiguous');
  });

  it('clamps every numeric field into bounds', () => {
    const payload = buildActRunOutcomePayload({
      outcome: 'done',
      steps: 999_999_999,
      durationMs: 999_999_999,
      observation: -4,
      navigation: 77_000,
      mutation: 1.9,
      loopWarnings: NaN,
      replanCount: 2,
      model: 'ok-model',
    });
    expect(payload.steps).toBe('18_plus');
    expect(payload.duration).toBe('15m_plus');
    expect(payload.observation).toBe(0);
    expect(payload.navigation).toBe(1_000);
    expect(payload.mutation).toBe(1);
    expect(payload.loop_warnings).toBe(0);
  });

  it('drops junk in numeric and unknown fields; no free-form text survives', () => {
    const payload = buildActRunOutcomePayload({
      outcome: 'blocked',
      reason: 'declined',
      steps: 2,
      durationMs: 5_000,
      navigation: 'drop table users',
      mutation: 'bob@example.test',
      pageUrl: 'https://secret.test/internal',
      instruction: 'email bob@example.test',
      model: 'gpt-4.1-mini',
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('@');
    expect(serialized).not.toContain('http');
    expect(serialized).not.toContain('secret.test');
    expect(payload.navigation).toBe(0);
    expect(payload.mutation).toBe(0);
  });
});
