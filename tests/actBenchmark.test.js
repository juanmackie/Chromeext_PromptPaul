/**
 * @fileoverview Local benchmark registration and opt-in argument contracts.
 * @module actBenchmarkTests
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const {
  TASKS,
  PASS_TARGET_RATE,
  DEFAULT_RUNS,
  buildSummary,
  getBenchmarkConfig,
  getBenchmarkProfile,
  cleanupTemporaryProfile,
  parseArgs,
  resolveCodexModel,
  summarizeRuns,
  summarizeTrace,
} = createRequire(import.meta.url)('../scripts/act-benchmark.js');

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
      'validation-error',
    ]) {
      expect(ids).toContain(id);
      expect(TASKS.find((task) => task.id === id).prompt.length).toBeGreaterThan(30);
    }
  });

  it('loads a fixed, train-only Mind2Web subset with oracle data outside the page prompt', () => {
    const mind2web = TASKS.filter((task) => task.mind2web);
    const manifest = JSON.parse(
      fs.readFileSync(new URL('../eval/mind2web/manifest.json', import.meta.url), 'utf8')
    );
    const casesBytes = fs.readFileSync(new URL('../eval/mind2web/cases.json', import.meta.url));
    const pageArchive = fs.readFileSync(
      new URL('./browser/fixtures/mind2web-pages.json.gz', import.meta.url)
    );
    const pages = JSON.parse(zlib.gunzipSync(pageArchive).toString('utf8'));
    const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

    expect(manifest.split).toBe('train');
    expect(sha256(casesBytes)).toBe(manifest.casesSha256);
    expect(sha256(pageArchive)).toBe(manifest.pageArchiveSha256);
    expect(mind2web).toHaveLength(9);
    expect(mind2web.map((task) => task.id)).toEqual(manifest.caseIds);
    expect(pages.pages.map((page) => page.id)).toEqual(manifest.caseIds);
    for (const task of mind2web) {
      expect(task.taskMode).toBe('mind2web');
      expect(task.oracle.targetBackendNodeId).toBeTruthy();
      expect(task.prompt).not.toContain(task.oracle.targetBackendNodeId);
    }
  });

  it('selects Codex mode with the requested model and supported medium reasoning', () => {
    expect(getBenchmarkConfig({ PROMPT_PAUL_BENCHMARK_PROVIDER: 'codex' })).toMatchObject({
      provider: 'codex',
      modelHint: 'Luna by OpenAI',
      reasoningLevel: 'medium',
    });
    expect(
      getBenchmarkConfig({
        PROMPT_PAUL_BENCHMARK_PROVIDER: 'codex',
        PROMPT_PAUL_BENCHMARK_MODEL: 'Luna',
        PROMPT_PAUL_BENCHMARK_REASONING_LEVEL: 'high',
      })
    ).toMatchObject({ modelHint: 'Luna', reasoningLevel: 'high' });
    expect(() =>
      getBenchmarkConfig({
        PROMPT_PAUL_BENCHMARK_PROVIDER: 'codex',
        PROMPT_PAUL_BENCHMARK_REASONING_LEVEL: 'turbo',
      })
    ).toThrow(/reasoning level/i);
  });

  it('reuses only a dedicated Codex benchmark profile, separate from task artifacts', () => {
    expect(getBenchmarkProfile('codex')).toMatchObject({
      persistent: true,
      relativePath: 'artifacts/act-benchmark-codex-profile',
    });
    expect(getBenchmarkProfile('api')).toMatchObject({ persistent: false, relativePath: null });
  });

  it('retries temporary browser-profile cleanup after a transient lock', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'act-benchmark-cleanup-'));
    let attempts = 0;
    try {
      const removed = await cleanupTemporaryProfile(directory, {
        remove: (target) => {
          attempts += 1;
          if (attempts === 2) fs.rmSync(target, { recursive: true, force: true });
        },
        wait: async () => {},
      });
      expect({ removed, attempts, remains: fs.existsSync(directory) }).toEqual({
        removed: true,
        attempts: 2,
        remains: false,
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('resolves a unique Codex model and rejects missing reasoning support', () => {
    const models = [
      {
        id: 'codex-luna-2026',
        displayName: 'Luna',
        reasoningLevels: [{ value: 'low' }, { value: 'medium' }],
      },
      { id: 'other', displayName: 'Other', reasoningLevels: [{ value: 'medium' }] },
    ];
    expect(resolveCodexModel(models, 'Luna by OpenAI', 'medium')).toMatchObject({
      id: 'codex-luna-2026',
      displayName: 'Luna',
    });
    expect(() =>
      resolveCodexModel(
        [{ id: 'luna', displayName: 'Luna', reasoningLevels: [{ value: 'low' }] }],
        'Luna'
      )
    ).toThrow(/does not advertise medium/i);
    expect(() => resolveCodexModel(models, 'Missing Model')).toThrow(/not found/i);
  });

  it('reports each run separately and marks timeouts, API errors, or missing attempts incomplete', () => {
    const tasks = ['one', 'two'];
    expect(
      summarizeRuns(
        [
          { taskId: 'one', run: 1, success: true, failureCodes: [] },
          { taskId: 'two', run: 1, success: true, failureCodes: [] },
          { taskId: 'one', run: 2, success: true, failureCodes: [] },
          { taskId: 'two', run: 2, success: false, failureCodes: ['RUN_TIMEOUT', 'API'] },
        ],
        2,
        tasks
      )
    ).toEqual([
      expect.objectContaining({
        run: 1,
        complete: true,
        passRate: 1,
        targetPassRate: 0.8,
        targetMet: true,
      }),
      expect.objectContaining({
        run: 2,
        complete: false,
        timedOutTasks: ['two'],
        apiErrorTasks: ['two'],
        passRate: 0.5,
        targetPassRate: 0.8,
        targetMet: false,
      }),
    ]);
    expect(
      summarizeRuns([{ taskId: 'one', run: 1, success: true, failureCodes: [] }], 1, tasks)[0]
    ).toMatchObject({ complete: false, missingTaskIds: ['two'] });
  });

  it('defaults to single runs and exposes the 80% hold target', () => {
    expect(parseArgs([])).toMatchObject({ run: false, runs: 1 });
    expect(parseArgs(['--run'])).toMatchObject({ run: true, runs: 1 });
    expect(PASS_TARGET_RATE).toBe(0.8);
    expect(DEFAULT_RUNS).toBe(1);
  });

  it('separates end-state results from reported outcomes per task and run', () => {
    const records = [
      { taskId: 'one', run: 1, success: true, endStateMatches: true },
      { taskId: 'one', run: 2, success: false, endStateMatches: true },
      { taskId: 'two', run: 1, success: false, endStateMatches: false },
    ];
    expect(buildSummary(records, 2, [{ id: 'one' }, { id: 'two' }])).toEqual([
      expect.objectContaining({
        taskId: 'one',
        passed: 1,
        passRate: 0.5,
        endStatePassed: 2,
        endStatePassRate: 1,
      }),
      expect.objectContaining({
        taskId: 'two',
        passed: 0,
        passRate: 0,
        endStatePassed: 0,
        endStatePassRate: 0,
      }),
    ]);
    const runs = summarizeRuns(records, 2, ['one', 'two']);
    expect(runs[0]).toMatchObject({ run: 1, passed: 1, endStatePassed: 1 });
    expect(runs[1]).toMatchObject({ run: 2, passed: 0, endStatePassed: 1 });
  });

  it('requires explicit run opt-in and bounds repetition counts', () => {
    expect(parseArgs([]).run).toBe(false);
    expect(parseArgs(['--list']).run).toBe(false);
    expect(parseArgs(['--run', '--runs', '2'])).toMatchObject({ run: true, runs: 2 });
    expect(parseArgs(['--run', '--task', 'validation-error'])).toMatchObject({
      run: true,
      tasks: ['validation-error'],
    });
    expect(parseArgs(['--task', 'validation-error', '--task', 'gmail-sort']).tasks).toEqual([
      'validation-error',
      'gmail-sort',
    ]);
    expect(() => parseArgs(['--task', 'no-such-task'])).toThrow();
    expect(() => parseArgs(['--runs', '11'])).toThrow();
    expect(() => parseArgs(['--unknown'])).toThrow();
  });
});
