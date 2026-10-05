/**
 * @fileoverview Local benchmark registration and opt-in argument contracts.
 * @module actBenchmarkTests
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { TASKS, parseArgs, summarizeTrace } = createRequire(import.meta.url)(
  '../scripts/act-benchmark.js'
);

describe('Act benchmark task registration', () => {
  it('reports settlement timing and measured snapshot bytes without inferring model scores', () => {
    const summary = summarizeTrace({
      steps: [
        {
          kind: 'action',
          snapshotBytes: { before: 2000, after: 900 },
          action_result: { result: { settle: { waitedMs: 1500, reason: 'busy' } } },
        },
      ],
      terminal: { type: 'complete' },
    });
    expect(summary).toMatchObject({
      steps: 1,
      tokens: null,
      snapshotBytes: [{ before: 2000, after: 900 }],
      settlements: [{ waitedMs: 1500, reason: 'busy' }],
    });
  });
  it('records runtime outcomes as failure codes without trusting success prose', () => {
    expect(
      summarizeTrace({
        steps: [],
        terminal: {
          type: 'complete',
          content: 'All done.',
          actOutcome: { status: 'blocked', reason: 'declined' },
        },
      })
    ).toMatchObject({
      actOutcome: { status: 'blocked', reason: 'declined' },
      failureCodes: ['ACT_DECLINED'],
    });
    expect(
      summarizeTrace({ steps: [], terminal: { type: 'complete', content: 'All done.' } }).actOutcome
    ).toBeNull();
  });

  it('registers each roadmap interaction once with a concrete local task', () => {
    const ids = TASKS.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      'search-enter',
      'escape-modal',
      'hover-menu',
      'background-tab',
      'viewport-read',
      'prefilled-form',
      'range-date',
      'nested-scroll',
      'cross-origin-iframe',
      'trusted-key-only',
    ]) {
      expect(ids).toContain(id);
      expect(TASKS.find((task) => task.id === id).prompt.length).toBeGreaterThan(30);
    }
  });

  it('requires explicit run opt-in and bounds repetition counts', () => {
    expect(parseArgs([]).run).toBe(false);
    expect(parseArgs(['--list']).run).toBe(false);
    expect(parseArgs(['--run', '--runs', '2'])).toMatchObject({ run: true, runs: 2 });
    expect(() => parseArgs(['--runs', '11'])).toThrow();
    expect(() => parseArgs(['--unknown'])).toThrow();
  });
});
