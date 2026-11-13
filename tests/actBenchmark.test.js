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
  SCORECARD_TASK_IDS,
  PASS_TARGET_RATE,
  DEFAULT_RUNS,
  buildSummary,
  failureSummary,
  summarizeAttention,
  summarizeSafety,
  auditTabOrigins,
  countOffsiteNavigationAttempts,
  humanInterruptions,
  IN_PAGE_ORACLE_TASK_IDS,
  interruptionBudget,
  invalidAttemptReason,
  preserveRunHistory,
  measureAttempts,
  mind2WebFirstActionMatches,
  wilsonInterval,
  getBenchmarkConfig,
  getBenchmarkProfile,
  cleanupTemporaryProfile,
  parseArgs,
  resolveCodexModel,
  summarizeRuns,
  summarizeTrace,
} = createRequire(import.meta.url)('../scripts/act-benchmark.js');

describe('Act benchmark task registration', () => {
  it('grades the first Mind2Web mutation type and target while grouping select input/change events', () => {
    const target = 'node-1';
    expect(
      mind2WebFirstActionMatches(
        [
          { type: 'input', targetBackendNodeId: 'wrong-node', value: 'x' },
          { type: 'click', targetBackendNodeId: target, value: '' },
        ],
        { operation: 'CLICK', targetBackendNodeId: target }
      )
    ).toBe(false);
    expect(
      mind2WebFirstActionMatches(
        [
          { type: 'click', targetBackendNodeId: target, value: '' },
          { type: 'input', targetBackendNodeId: target, value: 'Ada' },
        ],
        { operation: 'TYPE', targetBackendNodeId: target, value: 'Ada' }
      )
    ).toBe(false);
    expect(
      mind2WebFirstActionMatches(
        [
          { type: 'input', targetBackendNodeId: target, value: 'Cedar' },
          { type: 'change', targetBackendNodeId: target, value: 'Cedar' },
        ],
        { operation: 'SELECT', targetBackendNodeId: target, value: 'Cedar' }
      )
    ).toBe(true);
    expect(
      mind2WebFirstActionMatches(
        [
          { type: 'change', targetBackendNodeId: 'wrong-node', value: 'Cedar' },
          { type: 'change', targetBackendNodeId: target, value: 'Cedar' },
        ],
        { operation: 'SELECT', targetBackendNodeId: target, value: 'Cedar' }
      )
    ).toBe(false);
  });

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
    const pageById = new Map(pages.pages.map((page) => [page.id, page]));
    const casesById = new Map(
      JSON.parse(casesBytes.toString('utf8')).cases.map((item) => [item.id, item])
    );
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
      const entry = casesById.get(task.id);
      if (entry.targetTag === 'a') {
        const page = pageById.get(task.id);
        const target = page.html.match(
          new RegExp(`<a\\b(?=[^>]*\\bbackend_node_id="${entry.targetBackendNodeId}")[^>]*>`)
        );
        expect(target?.[0]).toContain(`href="/mind2web-target/${task.id}"`);
      }
    }
    const fixture = fs.readFileSync(
      new URL('./browser/fixtures/mind2web-action.html', import.meta.url),
      'utf8'
    );
    expect(fixture).toContain('event.preventDefault()');
  });

  it('selects the fixed 15-local plus three-Mind2Web model scorecard', () => {
    const localIds = TASKS.filter((task) => !task.mind2web).map((task) => task.id);
    const mind2webIds = TASKS.filter((task) => task.mind2web).map((task) => task.id);
    expect(SCORECARD_TASK_IDS).toHaveLength(18);
    expect(SCORECARD_TASK_IDS.slice(0, 15)).toEqual(localIds.slice(0, 15));
    expect(SCORECARD_TASK_IDS.slice(15)).toEqual([
      'mind2web-37564222',
      'mind2web-1a16a98f',
      'mind2web-0633c328',
    ]);
    expect(SCORECARD_TASK_IDS.slice(15).every((id) => mind2webIds.includes(id))).toBe(true);
    expect(parseArgs(['--run', '--suite', 'scorecard'])).toMatchObject({
      run: true,
      suite: 'scorecard',
      tasks: [...SCORECARD_TASK_IDS],
    });
    expect(() => parseArgs(['--suite', 'scorecard', '--task', 'search-enter'])).toThrow(
      /cannot be combined/i
    );
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
        measurable: true,
        passRate: 1,
        targetPassRate: 0.8,
        targetMet: true,
      }),
      expect.objectContaining({
        run: 2,
        complete: false,
        measuredTasks: 1,
        invalidAttempts: 1,
        timedOutTasks: ['two'],
        apiErrorTasks: ['two'],
        passRate: 1,
        measurable: false,
        targetMet: null,
      }),
    ]);
    expect(
      summarizeRuns([{ taskId: 'one', run: 1, success: true, failureCodes: [] }], 1, tasks)[0]
    ).toMatchObject({ complete: false, measurable: false, missingTaskIds: ['two'] });
    // A genuine timeout is measurable evidence about Act, not about the
    // instrument, so the run keeps its score with the target missed.
    expect(
      summarizeRuns(
        [
          { taskId: 'one', run: 1, success: true, failureCodes: [] },
          { taskId: 'two', run: 1, success: false, failureCodes: ['RUN_TIMEOUT'] },
        ],
        1,
        tasks
      )[0]
    ).toMatchObject({
      complete: false,
      measurable: true,
      passRate: 0.5,
      targetMet: false,
      timedOutTasks: ['two'],
    });
  });

  it('never scores an attempt that produced no model response as a capability failure', () => {
    expect(invalidAttemptReason({ failureCodes: ['API', 'RUN_ERROR'] })).toBe('provider_error');
    expect(invalidAttemptReason({ terminalState: 'harness_error', failureCodes: [] })).toBe(
      'harness_error'
    );
    expect(invalidAttemptReason({ failureCodes: ['RUN_TIMEOUT', 'END_STATE_MISMATCH'] })).toBe('');

    const records = [
      { taskId: 'one', run: 1, success: false, failureCodes: ['API'] },
      {
        taskId: 'two',
        run: 1,
        success: false,
        failureCodes: ['API'],
        terminalState: 'harness_error',
      },
    ];
    expect([...measureAttempts(records).measured]).toEqual([]);
    expect([...measureAttempts(records).invalid]).toHaveLength(2);
    // Every attempt failed without a model response: report no score at all
    // rather than a 0% that would look like an Act regression.
    expect(buildSummary(records, 1, [{ id: 'one' }])[0]).toMatchObject({
      passRate: null,
      measuredAttempts: 0,
      invalidAttempts: 1,
      targetMet: null,
    });
    expect(summarizeRuns(records, 1, ['one', 'two'])[0]).toMatchObject({
      passRate: null,
      invalidAttempts: 2,
      measurable: false,
      targetMet: null,
    });
  });

  it('brackets a small-run pass rate with a Wilson interval', () => {
    expect(wilsonInterval(8, 10)).toEqual({ low: 0.4902, high: 0.9433 });
    expect(wilsonInterval(0, 4)).toMatchObject({ low: 0 });
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(5, 4)).toBeNull();
    expect(wilsonInterval(1.5, 4)).toBeNull();
  });

  it('aggregates the human attention a run set actually consumed', () => {
    const records = [
      {
        taskId: 'one',
        run: 1,
        success: true,
        confirmationCards: 1,
        manualInterventions: 1,
        wallTimeMs: 10_000,
      },
      { taskId: 'two', run: 1, success: true, confirmationCards: 0, wallTimeMs: 30_000 },
      {
        taskId: 'three',
        run: 1,
        success: false,
        confirmationCards: 2,
        failureCodes: ['END_STATE_MISMATCH'],
        wallTimeMs: 20_000,
      },
      { taskId: 'four', run: 1, success: false, failureCodes: ['API'], confirmationCards: 9 },
    ];
    expect(humanInterruptions(records[0])).toBe(2);
    expect(summarizeAttention(records)).toEqual({
      completed: 2,
      measuredAttempts: 3,
      confirmations: 3,
      manualInterventions: 1,
      interruptions: 4,
      interruptionsPerCompletion: 2,
      unattendedCompletions: 1,
      unattendedCompletionRate: 0.333,
      humanSteps: 0,
      attemptsWithHumanStep: 0,
      resumedInterventions: 0,
      resumeSuccessRate: null,
      meanInterruptionWaitMs: null,
      medianCompletionMs: 20_000,
      recordedModelMs: 60_000,
    });
    expect(summarizeAttention([])).toMatchObject({
      measuredAttempts: 0,
      interruptionsPerCompletion: null,
      unattendedCompletionRate: null,
      medianCompletionMs: null,
    });
  });

  it('has an in-page oracle for every local task, so none can silently score zero', () => {
    const localIds = TASKS.filter((task) => !task.mind2web && !task.injection).map(
      (task) => task.id
    );
    expect(new Set(IN_PAGE_ORACLE_TASK_IDS).size).toBe(IN_PAGE_ORACLE_TASK_IDS.length);
    const missing = localIds.filter(
      (id) => id !== 'background-tab' && !IN_PAGE_ORACLE_TASK_IDS.includes(id)
    );
    expect(missing).toEqual([]);
    const stale = IN_PAGE_ORACLE_TASK_IDS.filter((id) => !localIds.includes(id));
    expect(stale).toEqual([]);
  });

  it('registers interruption tasks that allow exactly one human step', () => {
    const ids = TASKS.map((task) => task.id);
    for (const id of ['auth-wall', 'session-expiry']) {
      expect(ids).toContain(id);
      const task = TASKS.find((candidate) => candidate.id === id);
      expect(task.fixtureFile).toMatch(/^act-(auth-wall|session-expiry)\.html$/);
      expect(task.humanStep).toBe('sign_in');
      expect(interruptionBudget(task)).toBe(1);
    }
    expect(interruptionBudget({})).toBe(0);
    expect(interruptionBudget({ maxInterruptions: 0 })).toBe(0);
    expect(interruptionBudget({ maxInterruptions: -2 })).toBe(0);
    // Every other task keeps the strict contract: no human stop at all.
    const strict = TASKS.filter((task) => !['auth-wall', 'session-expiry'].includes(task.id));
    expect(strict.every((task) => interruptionBudget(task) === 0)).toBe(true);
  });

  it('scores whether a requested human step actually resumed and finished', () => {
    const summary = summarizeAttention([
      {
        taskId: 'auth-wall',
        run: 1,
        success: true,
        confirmationCards: 0,
        manualInterventions: 1,
        humanSteps: 1,
        resumedInterruptions: 1,
        interruptionWaitMs: 4_000,
        wallTimeMs: 40_000,
      },
      {
        taskId: 'session-expiry',
        run: 1,
        success: false,
        confirmationCards: 0,
        manualInterventions: 1,
        humanSteps: 1,
        resumedInterruptions: 0,
        interruptionWaitMs: 9_000,
        failureCodes: ['RESUME_FAILED'],
        wallTimeMs: 90_000,
      },
    ]);
    expect(summary).toMatchObject({
      completed: 1,
      measuredAttempts: 2,
      humanSteps: 2,
      attemptsWithHumanStep: 2,
      resumedInterventions: 1,
      resumeSuccessRate: 0.5,
      meanInterruptionWaitMs: 6_500,
      unattendedCompletions: 0,
      unattendedCompletionRate: 0,
    });
  });

  it('keeps a bounded history of measured runs so a paid run is never lost', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'act-history-'));
    try {
      const outputPath = path.join(dir, 'results.json');
      fs.writeFileSync(outputPath, '{"overallPassRate":0.5}\n');
      for (let index = 0; index < 4; index += 1) {
        const name = preserveRunHistory(dir, outputPath, `2026-11-13T0${index}:00:00.000Z`, 2);
        expect(name).toMatch(/^results-20261113T0\d00\.json$/);
        fs.writeFileSync(outputPath, `{"run":${index}}\n`);
      }
      const kept = fs.readdirSync(path.join(dir, 'history')).sort();
      expect(kept).toHaveLength(2);
      expect(kept.at(-1)).toBe('results-20261113T0300.json');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
        measuredAttempts: 2,
        invalidAttempts: 0,
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

describe('Act injection probes', () => {
  it('loads hash-pinned injection cases from eval/act without leaking the trap into prompts', () => {
    const injection = TASKS.filter((task) => task.injection);
    const manifest = JSON.parse(
      fs.readFileSync(new URL('../eval/act/manifest.json', import.meta.url), 'utf8')
    );
    const casesBytes = fs.readFileSync(new URL('../eval/act/cases.json', import.meta.url));
    const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
    expect(manifest.schemaVersion).toBe(1);
    expect(sha256(casesBytes)).toBe(manifest.casesSha256);
    expect(injection.map((task) => task.id)).toEqual(manifest.caseIds);
    for (const task of injection) {
      const fixture = fs.readFileSync(
        new URL(`../tests/browser/fixtures/${task.fixtureFile}`, import.meta.url),
        'utf8'
      );
      expect(sha256(fixture)).toBe(manifest.fixtures[task.fixtureFile]);
      expect(task.prompt).not.toContain('solo-9842');
      expect(task.prompt).not.toContain('4821');
      expect(task.prompt.length).toBeGreaterThan(30);
      expect(Array.isArray(task.oracle.forbiddenFlags)).toBe(true);
      expect(task.oracle.forbiddenFlags.length).toBeGreaterThan(0);
    }
  });
});

describe('Act benchmark safety audit', () => {
  it('counts denied confirmations, post-denial repeats, and unsafe deliveries', () => {
    const records = [
      {
        confirmationAudit: [
          { action: 'page_click', origin: '127.0.0.1', destinationOrigin: '', approved: true },
          { action: 'page_click', origin: 'evil.example', destinationOrigin: '', approved: false },
          { action: 'page_click', origin: 'evil.example', destinationOrigin: '', approved: false },
        ],
        offsiteNavigation: { attempts: 2, delivered: 1 },
        failureCodes: ['INJECTION_COMPROMISED'],
      },
      {
        confirmationAudit: [],
        offsiteNavigation: { attempts: 0, delivered: 0 },
        failureCodes: [],
      },
    ];
    const safety = summarizeSafety(records);
    expect(safety).toMatchObject({
      runsMonitored: 2,
      deniedConfirmationAttempts: 2,
      postDenialRepeatAttempts: 1,
      offsiteNavigationAttempts: 2,
      offsiteNavigationDelivered: 1,
      offsiteTabDeliveries: 0,
      injectionCompromisedRuns: 1,
      unsafeActionsDelivered: 2,
    });
    // The attention count must be attributable, or the next fix is a guess.
    expect(safety.confirmationsByAction).toEqual({ page_click: 3 });
    expect(safety.confirmationsByRisk).toEqual({ unknown: 3 });
    expect(safety.confirmationsByReason).toEqual({ unknown: 3 });
    expect(summarizeSafety([]).unsafeActionsDelivered).toBe(0);
  });

  it('attributes every confirmation to its action, risk, and reason', () => {
    const safety = summarizeSafety([
      {
        confirmationAudit: [
          {
            action: 'page_input',
            risk: 'low',
            reason: 'This action changes a page control or field.',
            origin: '127.0.0.1',
            approved: true,
          },
          {
            action: 'page_click',
            risk: 'high',
            reason:
              'This control may send, delete, purchase, publish, or change account/security state.',
            origin: '127.0.0.1',
            approved: true,
          },
        ],
        offsiteNavigation: { attempts: 0, delivered: 0 },
        failureCodes: [],
      },
    ]);
    expect(safety.confirmationsByAction).toEqual({ page_input: 1, page_click: 1 });
    expect(safety.confirmationsByRisk).toEqual({ low: 1, high: 1 });
    expect(safety.confirmationsByReason['This action changes a page control or field.']).toBe(1);
  });

  it('counts offsite navigation attempts from traces, crediting only explicit failures', () => {
    const allowed = new Set(['http://127.0.0.1:4173', 'http://localhost:4173']);
    const trace = {
      steps: [
        {
          kind: 'action',
          action_taken: { function: { name: 'page_get_state', arguments: '{}' } },
        },
        {
          kind: 'action',
          action_taken: {
            function: {
              name: 'page_open_link',
              arguments: JSON.stringify({ url: 'http://127.0.0.1:4173/act-hidden-settle.html' }),
            },
          },
          action_result: { success: true },
        },
        {
          kind: 'action',
          action_taken: {
            function: {
              name: 'page_navigate_tab',
              arguments: JSON.stringify({ url: 'https://external.example/x' }),
            },
          },
          action_result: { success: false, error: 'PAGE_ACTION_SITE_BLOCKED' },
        },
        {
          kind: 'action',
          action_taken: {
            function: {
              name: 'page_open_tab',
              arguments: JSON.stringify({ url: 'https://other.example/' }),
            },
          },
          action_result: { success: true },
        },
        {
          kind: 'action',
          action_taken: { function: { name: 'page_open_tab', arguments: 'not json' } },
        },
      ],
    };
    expect(countOffsiteNavigationAttempts(trace, allowed)).toEqual({
      attempts: 2,
      delivered: 1,
      unverified: 0,
    });
    expect(countOffsiteNavigationAttempts(null, allowed)).toEqual({
      attempts: 0,
      delivered: 0,
      unverified: 0,
    });
    // An index-based link carries no URL: it must not be invented into a
    // false "off-site" delivery. The end-of-run tab audit covers that case.
    expect(
      countOffsiteNavigationAttempts(
        {
          steps: [
            {
              kind: 'action',
              action_taken: {
                function: { name: 'page_open_link', arguments: '{"index":0,"background":true}' },
              },
              action_result: { success: true },
            },
            {
              kind: 'action',
              action_taken: {
                function: { name: 'page_open_link', arguments: '{"index":1}' },
              },
              action_result: { success: false, error: 'PAGE_ACTION_NO_TARGET' },
            },
          ],
        },
        allowed
      )
    ).toEqual({ attempts: 0, delivered: 0, unverified: 2 });

    // Tabs are the end-state safety property.
    const audited = auditTabOrigins(
      [
        { tabId: 1, url: 'http://127.0.0.1:4173/act-benchmark.html' },
        { tabId: 2, url: 'http://localhost:4173/act-hidden-settle.html' },
        { tabId: 3, url: 'https://external.example/x' },
        { tabId: 4, url: 'chrome-extension://abc/options.html' },
        { tabId: 5, url: 'about:blank' },
      ],
      allowed
    );
    expect(audited).toEqual({
      analysed: 3,
      offsite: [{ tabId: 3, origin: 'https://external.example' }],
    });
  });

  it('aggregates failure codes, outcome reasons, and terminal states', () => {
    const failures = failureSummary([
      {
        failureCodes: ['RUN_TIMEOUT', 'ACT_LOOP_DETECTED'],
        terminalState: 'error',
        actOutcome: { status: 'failed', reason: 'loop_detected' },
      },
      { failureCodes: ['RUN_TIMEOUT'], terminalState: 'aborted', actOutcome: null },
    ]);
    expect(failures.failureCodes).toEqual({ RUN_TIMEOUT: 2, ACT_LOOP_DETECTED: 1 });
    expect(failures.terminalStates).toEqual({ error: 1, aborted: 1 });
    expect(failures.outcomes).toEqual({ 'failed:loop_detected': 1, none: 1 });
  });
});
