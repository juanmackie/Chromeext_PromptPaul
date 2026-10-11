#!/usr/bin/env node

/**
 * @fileoverview Opt-in, local-fixture Act benchmark using Codex or an API model.
 * @module actBenchmark
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createBenchmarkFingerprint } = require('./benchmark-fingerprint.js');

const ROOT = path.resolve(__dirname, '..');
const PROFILE_ID = 'act-benchmark-local';
const CODEX_PROFILE_RELATIVE_PATH = 'artifacts/act-benchmark-codex-profile';
// Single-run hold: iterate with --runs 1 pilots while working toward the
// 80% overall pass-rate target. Multi-run repeats stay opt-in via --runs.
const PASS_TARGET_RATE = 0.8;
const DEFAULT_RUNS = 1;
const BENCHMARK_SCHEMA_VERSION = 2;
const RUN_TIMEOUT_MS = 8 * 60 * 1_000;
const TASKS = [
  {
    id: 'search-enter',
    prompt: 'Search for Cedar using the search box with no button. Stay on this local page.',
  },
  {
    id: 'escape-modal',
    prompt: 'Dismiss the Notice dialog using Escape. Stay on this local page.',
  },
  {
    id: 'hover-menu',
    prompt: 'Open the Products menu by hovering and choose Analytics. Stay on this local page.',
  },
  {
    id: 'background-tab',
    prompt:
      'Open the Background notes link in a background tab, switch your work target to it without activating it, and enter Background note in Notes. Keep the source tab open.',
  },
  {
    id: 'viewport-read',
    prompt:
      'Read the verification code in the current viewport and enter it in Verification code. Stay on this local page.',
  },
  {
    id: 'prefilled-form',
    prompt:
      'Keep Name as Ada and City as Brisbane. Correct only the Team field to Cedar. Stay on this local page.',
  },
  {
    id: 'range-date',
    prompt: 'Set Volume to 70 and Appointment date to 2026-10-20. Stay on this local page.',
  },
  {
    id: 'nested-scroll',
    prompt: 'Scroll inside the Activity panel to reach and select Cedar. Stay on this local page.',
  },
  {
    id: 'cross-origin-iframe',
    prompt:
      'Enter Ada in Name in the Contact form frame and submit that form. Stay on these local fixture pages.',
  },
  {
    id: 'trusted-key-only',
    prompt:
      'Press Enter in the Ready field to complete the local keyboard check. Stay on this local page.',
  },
  {
    id: 'spa-menu',
    prompt:
      'On this local page, open the Products menu and choose Analytics. Do not leave this local page.',
  },
  {
    id: 'autocomplete',
    prompt:
      'On this local page, choose Saffron from the Choose a spice autocomplete. Do not leave this local page.',
  },
  {
    id: 'custom-radio',
    prompt:
      'On this local page, select the Vegetarian meal preference. Do not leave this local page.',
  },
  {
    id: 'custom-dropdown',
    prompt:
      'On this local page, choose Japan in the Country dropdown. Do not leave this local page.',
  },
  {
    id: 'shadow-control',
    prompt:
      'On this local page, choose blue using the control in the component. Do not leave this local page.',
  },
  {
    id: 'iframe-form',
    prompt:
      'In the same-origin contact form on this local page, enter the name Ada and submit it. Do not leave this local page.',
  },
  {
    id: 'modal-dismissal',
    prompt: 'Dismiss the Notice dialog on this local page. Do not leave this local page.',
  },
  {
    id: 'pagination',
    prompt: 'Use pagination to reach page 2 on this local page. Do not leave this local page.',
  },
  {
    id: 'infinite-scroll',
    prompt:
      'Scroll the Activity feed to load more rows, then select Cedar. Do not leave this local page.',
  },
  {
    id: 'long-page',
    prompt:
      'Find the verification marker after the long text, then click Confirm ORBIT-47. Do not leave this local page.',
  },
  {
    id: 'duplicate-row-buttons',
    prompt:
      'On this local page, archive the Birch row only. Do not archive Alder or Cedar, and do not leave this page.',
  },
  {
    id: 'gmail-sort',
    prompt:
      'On this Gmail-like local page, switch the inbox to Most recent and leave the menu closed.',
  },
  {
    id: 'gmail-open-three',
    prompt:
      'On this Gmail-like local page, open the three newest threads one at a time, return to the inbox between them and finish back in the inbox, and do not reopen any thread.',
  },
  {
    id: 'gmail-toggle-trap',
    prompt:
      'On this Gmail-like local page, open and close the categories panel to inspect it. If the same toggle restores the previous state, stop toggling it and explain the result.',
  },
  {
    id: 'validation-error',
    prompt:
      'This local checkout form rejected the current email. Read the error message, correct the Email field to ada@example.com, and then submit. Stay on this local page.',
  },
];

function parseArgs(argv) {
  const options = { run: false, list: false, help: false, runs: DEFAULT_RUNS, tasks: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') options.run = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--task') {
      const id = String(argv[++index] || '').trim();
      if (!TASKS.some((task) => task.id === id)) {
        throw new Error(`--task must name one benchmark task: ${id}`);
      }
      options.tasks = [...(options.tasks || []), id];
    } else if (arg === '--runs') {
      const count = Number(argv[++index]);
      if (!Number.isInteger(count) || count < 1 || count > 10) {
        throw new Error('--runs must be an integer from 1 to 10.');
      }
      options.runs = count;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

const CODEX_REASONING_LEVELS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

function getBenchmarkProfile(provider) {
  if (provider !== 'codex') {
    return { persistent: false, relativePath: null, userDataDir: null };
  }
  return {
    persistent: true,
    relativePath: CODEX_PROFILE_RELATIVE_PATH,
    userDataDir: path.resolve(ROOT, CODEX_PROFILE_RELATIVE_PATH),
  };
}

async function cleanupTemporaryProfile(
  userDataDir,
  { remove, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}
) {
  if (typeof remove !== 'function') throw new TypeError('A profile cleanup function is required.');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    remove(userDataDir);
    if (!fs.existsSync(userDataDir)) return true;
    if (attempt < 11) await wait(500);
  }
  return !fs.existsSync(userDataDir);
}

function getBenchmarkConfig(env = process.env) {
  const provider = String(env.PROMPT_PAUL_BENCHMARK_PROVIDER || 'api')
    .trim()
    .toLowerCase();
  if (provider === 'codex') {
    const reasoningLevel = String(env.PROMPT_PAUL_BENCHMARK_REASONING_LEVEL || 'medium')
      .trim()
      .toLowerCase();
    if (!CODEX_REASONING_LEVELS.has(reasoningLevel)) {
      throw new Error(
        'PROMPT_PAUL_BENCHMARK_REASONING_LEVEL must be a supported Codex reasoning level.'
      );
    }
    if (env.PROMPT_PAUL_HEADLESS === 'true') {
      throw new Error('Codex sign-in requires a visible browser; unset PROMPT_PAUL_HEADLESS.');
    }
    const modelHint = String(env.PROMPT_PAUL_BENCHMARK_MODEL || 'Luna by OpenAI').trim();
    if (
      !modelHint ||
      modelHint.length > 256 ||
      [...modelHint].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      )
    ) {
      throw new Error('PROMPT_PAUL_BENCHMARK_MODEL must be 1–256 safe characters.');
    }
    return { provider, modelHint, reasoningLevel };
  }
  if (provider !== 'api') {
    throw new Error('PROMPT_PAUL_BENCHMARK_PROVIDER must be api or codex.');
  }

  const apiKey = env.PROMPT_PAUL_BENCHMARK_API_KEY;
  if (!apiKey) throw new Error('Set PROMPT_PAUL_BENCHMARK_API_KEY to opt in to model requests.');
  const endpoint =
    env.PROMPT_PAUL_BENCHMARK_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
  const parsed = parseUrl(endpoint, 'Benchmark endpoint');
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(
      'The benchmark endpoint must be a credential-free HTTP(S) URL; pass the key separately.'
    );
  }
  return {
    provider,
    apiKey,
    endpoint,
    model: String(env.PROMPT_PAUL_BENCHMARK_MODEL || 'gpt-4.1-mini').trim(),
    reasoningLevel: '',
  };
}

function normalizedModelLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\bby\s+openai\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function resolveCodexModel(models, modelHint, reasoningLevel = 'medium') {
  const target = normalizedModelLabel(modelHint);
  const candidates = (Array.isArray(models) ? models : []).filter(
    (model) => model && typeof model.id === 'string' && model.id.trim()
  );
  const matches = candidates.filter(
    (model) =>
      normalizedModelLabel(model.id) === target ||
      normalizedModelLabel(model.displayName) === target
  );
  if (matches.length !== 1) {
    const available = candidates
      .slice(0, 20)
      .map(
        (model) =>
          `${String(model.displayName || model.id).slice(0, 80)} [${model.id.slice(0, 120)}]`
      )
      .join(', ');
    throw new Error(
      matches.length > 1
        ? `Codex model hint is ambiguous; set PROMPT_PAUL_BENCHMARK_MODEL to an exact model ID. Matches: ${matches.map((model) => model.id).join(', ')}`
        : `Codex model "${String(modelHint).slice(0, 80)}" was not found. Set PROMPT_PAUL_BENCHMARK_MODEL to a listed model ID. Available: ${available || 'none'}`
    );
  }
  const advertisedLevels = Array.isArray(matches[0].reasoningLevels)
    ? matches[0].reasoningLevels.map((entry) =>
        String(typeof entry === 'string' ? entry : entry?.value || '').toLowerCase()
      )
    : [];
  if (!advertisedLevels.includes(reasoningLevel)) {
    throw new Error(
      `Codex model "${matches[0].id}" does not advertise ${reasoningLevel} reasoning.`
    );
  }
  return {
    id: matches[0].id,
    displayName: String(matches[0].displayName || matches[0].id).slice(0, 120),
  };
}

function summarizeRuns(records, runs, taskIds) {
  return Array.from({ length: runs }, (_, index) => {
    const run = index + 1;
    const attempts = records.filter((record) => record.run === run);
    const counts = new Map();
    for (const attempt of attempts) {
      counts.set(attempt.taskId, (counts.get(attempt.taskId) || 0) + 1);
    }
    const missingTaskIds = taskIds.filter((taskId) => !counts.has(taskId));
    const duplicateTaskIds = taskIds.filter((taskId) => (counts.get(taskId) || 0) > 1);
    const timedOutTasks = attempts
      .filter((record) => record.failureCodes?.includes('RUN_TIMEOUT'))
      .map((record) => record.taskId);
    const apiErrorTasks = attempts
      .filter((record) => record.failureCodes?.includes('API'))
      .map((record) => record.taskId);
    const harnessErrorTasks = attempts
      .filter((record) => record.terminalState === 'harness_error')
      .map((record) => record.taskId);
    const passed = attempts.filter((record) => record.success).length;
    const passRate = taskIds.length ? passed / taskIds.length : 0;
    const endStatePassed = attempts.filter((record) => record.endStateMatches === true).length;
    return {
      run,
      expectedTasks: taskIds.length,
      recordedTasks: attempts.length,
      passed,
      passRate,
      endStatePassed,
      endStatePassRate: taskIds.length ? endStatePassed / taskIds.length : 0,
      targetPassRate: PASS_TARGET_RATE,
      targetMet: passRate >= PASS_TARGET_RATE,
      complete:
        missingTaskIds.length === 0 &&
        duplicateTaskIds.length === 0 &&
        timedOutTasks.length === 0 &&
        apiErrorTasks.length === 0 &&
        harnessErrorTasks.length === 0,
      missingTaskIds,
      duplicateTaskIds,
      timedOutTasks,
      apiErrorTasks,
      harnessErrorTasks,
    };
  });
}

function parseUrl(value, label) {
  try {
    return new URL(value);
  } catch (_) {
    throw new Error(`${label} must be a valid URL.`);
  }
}

async function prepareCodexProfile({ context, harness, modelHint, reasoningLevel }) {
  await harness.evaluate(
    ({ profileId, modelName, reasoningLevel }) =>
      chrome.storage.local.get(['profiles']).then(({ profiles = [] }) => {
        const profile = {
          id: profileId,
          name: 'Local Act benchmark',
          provider: 'codex',
          llmEndpoint: '',
          apiKey: '',
          modelName,
          reasoningLevel,
        };
        return chrome.storage.local.set({
          profiles: [...profiles.filter((item) => item.id !== profileId), profile],
          lastSelectedProfileId: profileId,
        });
      }),
    { profileId: PROFILE_ID, modelName: modelHint, reasoningLevel }
  );

  const optionsPage = await context.newPage();
  try {
    const optionsUrl = await harness.evaluate(() => chrome.runtime.getURL('options.html'));
    await optionsPage.goto(optionsUrl);
    await optionsPage.locator('#codexConnectionStatus').waitFor({ state: 'visible' });
    const initialStatus = await optionsPage.locator('#codexConnectionStatus').textContent();
    if (!String(initialStatus || '').startsWith('Connected')) {
      await optionsPage.bringToFront();
      await optionsPage.locator('#connectCodexButton').click();
      console.log(
        'Complete Codex sign-in in the opened browser tab. The one-time code stays in Prompt Paul Options; no token is copied or logged.'
      );
      try {
        await optionsPage.waitForFunction(
          () =>
            document.getElementById('codexConnectionStatus')?.textContent?.startsWith('Connected'),
          null,
          { timeout: 15 * 60 * 1_000 }
        );
      } catch (_) {
        throw new Error('Codex sign-in did not complete before the 15-minute device-code expiry.');
      }
    }

    const response = await harness.evaluate(
      (profileId) => chrome.runtime.sendMessage({ action: 'getAvailableModels', profileId }),
      PROFILE_ID
    );
    if (!response?.success || !Array.isArray(response.models)) {
      throw new Error('Prompt Paul could not load the signed-in Codex model list.');
    }
    const selectedModel = resolveCodexModel(response.models, modelHint, reasoningLevel);
    await harness.evaluate(
      ({ profileId, modelName, reasoningLevel }) =>
        chrome.storage.local.get(['profiles']).then(({ profiles = [] }) => {
          const updated = profiles.map((profile) =>
            profile.id === profileId ? { ...profile, modelName, reasoningLevel } : profile
          );
          return chrome.storage.local.set({ profiles: updated, lastSelectedProfileId: profileId });
        }),
      { profileId: PROFILE_ID, modelName: selectedModel.id, reasoningLevel }
    );
    return selectedModel;
  } finally {
    await optionsPage.close().catch(() => {});
  }
}

function printHelp() {
  console.log(
    `Local Act benchmark\n\n` +
      `  node scripts/act-benchmark.js --list\n` +
      `  node scripts/act-benchmark.js --run [--runs 1] [--task <id> ...]\n\n` +
      `--run is required before a browser or model request is made. By default it builds the\n` +
      `isolated dist-eval extension; it uses only local fixtures and writes bounded metrics plus\n` +
      `redacted per-step traces beneath artifacts/act-benchmark/ (replaced on every run).\n` +
      `Pass one or more --task ids to run a subset.\n` +
      `Single-run pilots are the default hold mode (--runs 1); use --runs 2..10 only for\n` +
      `repeatability checks. The hold target is ${Math.round(PASS_TARGET_RATE * 100)}% overall.\n\n` +
      `Each of the ${TASKS.length} task attempts is capped at ${Math.round(
        RUN_TIMEOUT_MS / 60_000
      )} minutes, so expect a long run when a model stalls; progress prints per attempt.\n\n` +
      `API mode: set PROMPT_PAUL_BENCHMARK_API_KEY; optionally set PROMPT_PAUL_BENCHMARK_ENDPOINT and PROMPT_PAUL_BENCHMARK_MODEL.\n` +
      `Codex mode: set PROMPT_PAUL_BENCHMARK_PROVIDER=codex; sign in through Prompt Paul in the temporary visible browser.\n` +
      `Optional Codex settings: PROMPT_PAUL_BENCHMARK_MODEL (default Luna by OpenAI),\n` +
      `          PROMPT_PAUL_BENCHMARK_REASONING_LEVEL (default medium).\n` +
      `Shared options: PROMPT_PAUL_BENCHMARK_EXTENSION_DIR (prebuilt eval build),\n` +
      `          PROMPT_PAUL_BROWSER=chrome|edge or PROMPT_PAUL_BROWSER_EXECUTABLE.\n` +
      `Codex sign-in is stored in the dedicated ignored profile at artifacts/act-benchmark-codex-profile for reuse across runs.`
  );
}

function summarizeTrace(trace) {
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  const actionSteps = steps.filter((step) => step.kind === 'action');
  const failureCodes = new Set();
  let inputTokens = 0;
  let outputTokens = 0;
  let toggleProtectionObserved = false;
  const snapshotBytes = [];
  const settlements = [];
  for (const step of steps) {
    const usage = step.tokenUsage;
    if (Number.isFinite(usage?.inputTokens)) inputTokens += usage.inputTokens;
    if (Number.isFinite(usage?.outputTokens)) outputTokens += usage.outputTokens;
    const result = step.action_result;
    if (Number.isFinite(step.snapshotBytes?.after)) snapshotBytes.push(step.snapshotBytes);
    const settle = result?.result?.settle || result?.settle;
    if (Number.isFinite(settle?.waitedMs))
      settlements.push({
        waitedMs: settle.waitedMs,
        reason: String(settle.reason || '').slice(0, 32),
      });
    const code = result?.result?.error || result?.error || result?.code;
    if (result?.result?.toggleDetected === true || code === 'PAGE_ACTION_TOGGLE_LOOP') {
      toggleProtectionObserved = true;
    }
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,79}$/.test(code)) failureCodes.add(code);
    if (typeof step.error === 'string') {
      const match = step.error.match(/\b[A-Z][A-Z0-9_]{2,79}\b/);
      if (match) failureCodes.add(match[0]);
    }
  }
  const rawOutcome = trace?.terminal?.actOutcome;
  const knownReason =
    /^(?:sign_in_required|captcha|needs_confirmation|declined|ambiguous|loop_detected|budget_exhausted|site_blocked)$/.test(
      rawOutcome?.reason || ''
    );
  const actOutcome =
    rawOutcome &&
    ((rawOutcome.status === 'done' && rawOutcome.reason === null) ||
      (['blocked', 'failed'].includes(rawOutcome.status) && knownReason))
      ? { status: rawOutcome.status, reason: rawOutcome.reason }
      : null;
  if (actOutcome?.status !== 'done' && actOutcome?.reason)
    failureCodes.add(`ACT_${actOutcome.reason.toUpperCase()}`);
  if (trace?.terminal?.type && trace.terminal.type !== 'complete') {
    failureCodes.add(`RUN_${String(trace.terminal.type).toUpperCase().slice(0, 24)}`);
  }
  return {
    steps: actionSteps.length,
    modelTurns: steps.filter((step) => step.kind === 'llm_turn_started').length,
    tokens: inputTokens || outputTokens ? { input: inputTokens, output: outputTokens } : null,
    snapshotBytes,
    settlements,
    failureCodes: [...failureCodes].slice(0, 32),
    toggleProtectionObserved,
    terminalState: String(trace?.terminal?.type || 'missing').slice(0, 32),
    actOutcome,
  };
}

async function readFixtureState(page, task, excludedTabIds = []) {
  if (task.id === 'background-tab') {
    const harness = page
      .context()
      .pages()
      .find((candidate) => candidate.url().endsWith('/extension-harness.html'));
    if (!harness) return false;
    return harness.evaluate(async (excludedIds) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(
        (candidate) =>
          !excludedIds.includes(candidate.id) && candidate.url?.endsWith('/act-hidden-settle.html')
      );
      if (!tab || tab.active) return false;
      const [state] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () =>
          document.visibilityState === 'hidden' &&
          document.querySelector('#notes')?.value === 'Background note',
      });
      return state?.result === true;
    }, excludedTabIds);
  }
  return page.evaluate((taskId) => {
    const root = document.querySelector('#task');
    if (!root) return false;
    if (taskId === 'iframe-form') {
      return root.querySelector('iframe')?.contentDocument?.body.dataset.submitted === 'Ada';
    }
    if (taskId === 'duplicate-row-buttons') {
      return (
        root.querySelector('[data-row="Birch"]')?.dataset.archived === 'true' &&
        root.querySelector('[data-row="Alder"]')?.dataset.archived !== 'true' &&
        root.querySelector('[data-row="Cedar"]')?.dataset.archived !== 'true'
      );
    }
    if (taskId === 'gmail-open-three') {
      const subjects = (root.querySelector('#opened')?.textContent || '')
        .split(' | ')
        .filter(Boolean);
      return (
        subjects.length === 3 &&
        new Set(subjects).size === 3 &&
        root.querySelector('#inbox')?.hidden === false
      );
    }
    if (taskId === 'gmail-toggle-trap') {
      const toggle = root.querySelector('#toggle-trap');
      return (
        Number(toggle?.dataset.activations || 0) === 2 &&
        toggle?.getAttribute('aria-pressed') === 'false'
      );
    }
    const successById = {
      'search-enter': (body) => body.dataset.searched === 'Cedar',
      'escape-modal': (body) => body.dataset.dismissed === 'true',
      'hover-menu': (body) => body.dataset.selection === 'analytics',
      'viewport-read': () => root.querySelector('#verification')?.value === 'ORBIT-64',
      'prefilled-form': () =>
        ['Ada', 'Brisbane', 'Cedar'].every(
          (value, index) => root.querySelectorAll('input')[index]?.value === value
        ) &&
        [...root.querySelectorAll('input')]
          .slice(0, 2)
          .every((input) => input.dataset.edits === '0'),
      'range-date': () =>
        root.querySelector('#volume')?.value === '70' &&
        root.querySelector('#date')?.value === '2026-10-20',
      'nested-scroll': (body) =>
        body.dataset.selection === 'cedar' && root.querySelector('#scroll-list')?.scrollTop > 0,
      'cross-origin-iframe': (body) => body.dataset.submitted === 'Ada',
      'trusted-key-only': (body) => body.dataset.trustedKey === 'true',
      'spa-menu': (body) => body.dataset.selection === 'analytics',
      autocomplete: (body) => body.dataset.selection === 'Saffron',
      'custom-radio': (body) => body.dataset.selection === 'vegetarian',
      'custom-dropdown': (body) => body.dataset.selection === 'Japan',
      'shadow-control': (body) => body.dataset.selection === 'blue',
      'modal-dismissal': (body) => body.dataset.dismissed === 'true',
      pagination: (body) => body.dataset.page === '2',
      'infinite-scroll': (body) =>
        body.dataset.loaded === 'true' && body.dataset.selection === 'cedar',
      'long-page': (body) => body.dataset.confirmed === 'ORBIT-47',
      'gmail-sort': (body) => body.dataset.sort === 'recent',
      'validation-error': (body) =>
        body.dataset.emailValid === 'true' &&
        root.querySelector('#email')?.value === 'ada@example.com' &&
        root.querySelector('#email')?.getAttribute('aria-invalid') === 'false',
    };
    return Boolean(successById[taskId]?.(document.body));
  }, task.id);
}

function localHostAliases(fixture) {
  const hosts = new Set([fixture.hostname]);
  if (fixture.hostname === 'localhost') hosts.add('127.0.0.1');
  if (fixture.hostname === '127.0.0.1') hosts.add('localhost');
  const origins = new Set([fixture.origin]);
  for (const host of hosts) {
    origins.add(`${fixture.protocol}//${host}${fixture.port ? `:${fixture.port}` : ''}`);
  }
  return { hosts, origins };
}

function safeCardOrigin(confirmation, fixtureOrigin) {
  if (!confirmation) return false;
  try {
    const fixture = parseUrl(fixtureOrigin, 'Local fixture origin');
    const { hosts, origins } = localHostAliases(fixture);
    // Same-origin frame tasks legitimately appear under either local alias
    // (localhost and 127.0.0.1), so accept both forms of the same local origin.
    if (!hosts.has(String(confirmation.origin || ''))) return false;
    const destination = String(confirmation.destination || '');
    const destinationHost = String(confirmation.destinationOrigin || '');
    if (!destination) return !destinationHost;
    return (
      origins.has(parseUrl(destination, 'Confirmation destination').origin) &&
      hosts.has(destinationHost)
    );
  } catch (_) {
    return false;
  }
}

async function runAttempt({
  context,
  harness,
  fixtureServer,
  task,
  runNumber,
  endpoint,
  model,
  apiKey,
  provider,
  reasoningLevel,
  traceDir,
}) {
  const target = await context.newPage();
  const targetUrl = `${fixtureServer.url('act-benchmark.html')}?case=${encodeURIComponent(task.id)}`;
  await target.goto(targetUrl);
  await target.bringToFront();
  const taskId = `${task.id}-${runNumber}-${Date.now().toString(36)}`;
  const fixtureOrigin = parseUrl(targetUrl, 'Local fixture URL').origin;
  const startedAt = Date.now();
  let runId = null;
  let resultMessage = null;
  const failureCodes = new Set();
  const deadline = startedAt + RUN_TIMEOUT_MS;
  const initialTabIds = await harness.evaluate(async () =>
    (await chrome.tabs.query({})).map((tab) => tab.id)
  );
  try {
    // The trusted-key task exists to exercise the opt-in precise-input path:
    // its fixture only accepts a trusted Enter event, which DOM dispatch cannot
    // produce. Every other task runs with the default-off setting.
    await harness.evaluate(
      (enabled) => chrome.storage.local.set({ pageActionsPreciseInput: Boolean(enabled) }),
      task.id === 'trusted-key-only'
    );
    await harness.evaluate(
      ({ endpoint, model, apiKey, provider, reasoningLevel, profileId }) =>
        chrome.storage.local.get(['profiles']).then(({ profiles = [] }) => {
          const profile = {
            id: profileId,
            name: 'Local Act benchmark',
            provider,
            llmEndpoint: endpoint || '',
            apiKey: apiKey || '',
            modelName: model,
            ...(reasoningLevel ? { reasoningLevel } : {}),
          };
          return chrome.storage.local.set({
            profiles: [...profiles.filter((item) => item.id !== profileId), profile],
            lastSelectedProfileId: profileId,
          });
        }),
      { endpoint, model, apiKey, provider, reasoningLevel, profileId: PROFILE_ID }
    );
    const response = await harness.evaluate(
      ({ url, taskId, task, profileId }) =>
        window.pageActionHarness.startEvaluationTask(url, taskId, task, profileId),
      { url: targetUrl, taskId, task: task.prompt, profileId: PROFILE_ID }
    );
    if (!response?.accepted || !response.runId) {
      throw new Error(String(response?.code || 'EVAL_TASK_REJECTED'));
    }
    runId = response.runId;

    let lastConfirmationId = '';
    let manualInterventionHandled = false;
    while (Date.now() < deadline) {
      resultMessage = await harness.evaluate(
        (id) => window.pageActionHarness.getEvaluationResult(id),
        taskId
      );
      if (resultMessage) break;
      const metrics = await harness.evaluate(
        (id) => window.pageActionHarness.getRunMetrics(id),
        runId
      );
      if (!manualInterventionHandled && Number(metrics?.manualInterventions) > 0) {
        manualInterventionHandled = true;
        failureCodes.add('MANUAL_INTERVENTION_REQUIRED');
        await harness.evaluate((id) => window.pageActionHarness.abortRun(id), runId);
      }
      const confirmation = await harness.evaluate(
        (id) => window.pageActionHarness.getConfirmation(id),
        runId
      );
      if (confirmation && confirmation.confirmationId !== lastConfirmationId) {
        lastConfirmationId = confirmation.confirmationId;
        const approved = safeCardOrigin(confirmation, fixtureOrigin);
        if (!approved) failureCodes.add('NON_LOCAL_CONFIRMATION_DENIED');
        const decision = await harness.evaluate(
          ({ url, runId, approved }) =>
            window.pageActionHarness.resolveConfirmation(url, runId, approved, false),
          { url: targetUrl, runId, approved }
        );
        if (!decision?.success) failureCodes.add('CONFIRMATION_DECISION_FAILED');
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (!resultMessage) {
      failureCodes.add('RUN_TIMEOUT');
      await harness.evaluate((id) => window.pageActionHarness.abortRun(id), runId);
      // The aborted run still settles and emits its bounded trace through the
      // eval hook. Wait a short grace period so a timed-out task keeps its
      // per-step evidence instead of recording zero steps.
      const graceUntil = Date.now() + 15_000;
      while (Date.now() < graceUntil) {
        resultMessage = await harness.evaluate(
          (id) => window.pageActionHarness.getEvaluationResult(id),
          taskId
        );
        if (resultMessage) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    const trace = resultMessage?.result || null;
    const traceSummary = summarizeTrace(trace);
    for (const code of traceSummary.failureCodes) failureCodes.add(code);
    const endStateMatches = await readFixtureState(target, task, initialTabIds);
    // Record the independent end-state verdict separately from the model outcome:
    // a run can reach the right end state while reporting ambiguous/blocked, or
    // claim done while missing it. Persisting both sides tells an action failure
    // apart from an outcome-calibration failure without re-running the model.
    const outcomeDone = !traceSummary.actOutcome || traceSummary.actOutcome.status === 'done';
    if (!endStateMatches) failureCodes.add('END_STATE_MISMATCH');
    const success =
      !failureCodes.has('RUN_TIMEOUT') &&
      endStateMatches &&
      outcomeDone &&
      (task.id !== 'gmail-toggle-trap' || traceSummary.toggleProtectionObserved);
    if (
      endStateMatches &&
      task.id === 'gmail-toggle-trap' &&
      !traceSummary.toggleProtectionObserved
    ) {
      failureCodes.add('TOGGLE_PROTECTION_NOT_OBSERVED');
    }
    const cards = runId
      ? await harness.evaluate((id) => window.pageActionHarness.getRunMetrics(id), runId)
      : {};
    // Persist the bounded per-step trace (prompts, responses, actions, receipts)
    // next to the summary so a failure can be read and reproduced. The trace is
    // already secret-redacted by the eval build before it leaves the extension.
    if (traceDir && trace) {
      const tracePath = path.join(traceDir, `${task.id}-run${runNumber}.trace.json`);
      fs.writeFileSync(tracePath, `${JSON.stringify(trace, null, 2)}\n`, { mode: 0o600 });
    }
    return {
      taskId: task.id,
      run: runNumber,
      success,
      endStateMatches,
      outcomeDone,
      steps: traceSummary.steps,
      modelTurns: traceSummary.modelTurns,
      tokens: traceSummary.tokens,
      snapshotBytes: traceSummary.snapshotBytes,
      settlements: traceSummary.settlements,
      wallTimeMs: Math.max(0, Date.now() - startedAt),
      confirmationCards: Number(cards?.confirmationCards) || 0,
      progressCards: Number(cards?.progressCards) || 0,
      failureCodes: [...failureCodes].slice(0, 32),
      terminalState: traceSummary.terminalState,
      actOutcome: traceSummary.actOutcome,
    };
  } catch (error) {
    failureCodes.add(
      /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message) ? error.message : 'HARNESS_ERROR'
    );
    return {
      taskId: task.id,
      run: runNumber,
      success: false,
      endStateMatches: false,
      outcomeDone: false,
      steps: 0,
      modelTurns: 0,
      tokens: null,
      wallTimeMs: Math.max(0, Date.now() - startedAt),
      confirmationCards: 0,
      progressCards: 0,
      failureCodes: [...failureCodes],
      terminalState: 'harness_error',
    };
  } finally {
    if (runId && !resultMessage) {
      await harness.evaluate((id) => window.pageActionHarness.abortRun(id), runId).catch(() => {});
    }
    await harness
      .evaluate(async (initialIds) => {
        const created = (await chrome.tabs.query({})).filter((tab) => !initialIds.includes(tab.id));
        for (const tab of created) await chrome.tabs.remove(tab.id).catch(() => {});
      }, initialTabIds)
      .catch(() => {});
    await target.close().catch(() => {});
  }
}

function buildSummary(records, runs, tasks = TASKS) {
  return tasks.map((task) => {
    const attempts = records.filter((record) => record.taskId === task.id);
    const passed = attempts.filter((record) => record.success).length;
    const endStatePassed = attempts.filter((record) => record.endStateMatches === true).length;
    const passRate = attempts.length ? passed / attempts.length : 0;
    return {
      taskId: task.id,
      passed,
      runs,
      passRate,
      endStatePassed,
      endStatePassRate: attempts.length ? endStatePassed / attempts.length : 0,
      targetPassRate: PASS_TARGET_RATE,
      targetMet: passRate >= PASS_TARGET_RATE,
    };
  });
}

async function runBenchmark(options) {
  const benchmarkConfig = getBenchmarkConfig();
  const { provider, endpoint = '', apiKey = '', reasoningLevel = '' } = benchmarkConfig;
  let model = benchmarkConfig.model || '';

  const configuredExtensionDir = process.env.PROMPT_PAUL_BENCHMARK_EXTENSION_DIR;
  const extensionDir = configuredExtensionDir
    ? path.resolve(ROOT, configuredExtensionDir)
    : path.join(ROOT, 'dist-eval');
  const relativeExtensionDir = path.relative(ROOT, extensionDir);
  if (relativeExtensionDir.startsWith('..') || path.isAbsolute(relativeExtensionDir)) {
    throw new Error('PROMPT_PAUL_BENCHMARK_EXTENSION_DIR must stay inside this repository.');
  }
  if (!configuredExtensionDir) {
    const build = spawnSync(process.execPath, ['scripts/build.js', '--eval'], {
      cwd: ROOT,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (build.status !== 0) throw new Error('The isolated evaluation extension build failed.');
  }
  const evalHookPath = path.join(extensionDir, 'src', 'utils', 'evalHook.js');
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json')) || !fs.existsSync(evalHookPath)) {
    throw new Error('Benchmark extension directory must be a built evaluation extension.');
  }
  if (!fs.readFileSync(evalHookPath, 'utf8').includes('TEST_RUN_TASK')) {
    throw new Error('Evaluation hook is missing; build the extension with npm run build:eval.');
  }
  process.env.PROMPT_PAUL_LOAD_EXTENSION_DIR = relativeExtensionDir;
  // The benchmark drives the real extension through the browser-test harness
  // page, which a built output does not contain. Stage it into the extension
  // under test, exactly as the packaged-browser gate does.
  require('./stage-browser-harness.js').stage();

  const browserProfile = getBenchmarkProfile(provider);
  const userDataDir = browserProfile.persistent
    ? browserProfile.userDataDir
    : fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-act-benchmark-'));
  if (browserProfile.persistent) fs.mkdirSync(userDataDir, { recursive: true });
  const {
    fixtureUrl,
    launchTestBrowser,
    openHarness,
    removeUserDataDir,
    startFixtureServer,
  } = require('../tests/browser/browserTestSupport.js');
  let fixtureServer;
  let context;
  const records = [];
  const benchmarkSchemaVersion = BENCHMARK_SCHEMA_VERSION;
  let configFingerprint = '';
  const selectedTasks = options.tasks?.length
    ? TASKS.filter((task) => options.tasks.includes(task.id))
    : TASKS;
  const outputDir = path.join(ROOT, 'artifacts', 'act-benchmark');
  let traceDir = '';
  let runError = null;
  let cleanupFailure = '';
  try {
    fixtureServer = await startFixtureServer();
    ({ context } = await launchTestBrowser(userDataDir, { realVisibility: true }));
    const harness = await openHarness(context);
    if (provider === 'codex') {
      const selectedModel = await prepareCodexProfile({
        context,
        harness,
        modelHint: benchmarkConfig.modelHint,
        reasoningLevel,
      });
      model = selectedModel.id;
      console.log(`Using Codex model ${selectedModel.displayName} at ${reasoningLevel} reasoning.`);
    }
    configFingerprint = createBenchmarkFingerprint({
      benchmarkSchemaVersion,
      provider,
      model,
      reasoningLevel,
      runsPerTask: options.runs,
      tasks: selectedTasks,
      endpoint,
      extensionDirectory: extensionDir,
    });
    // Preserve previous results if sign-in or model validation fails.
    fs.rmSync(outputDir, { recursive: true, force: true });
    traceDir = path.join(outputDir, 'traces');
    fs.mkdirSync(traceDir, { recursive: true });
    for (const task of selectedTasks) {
      for (let runNumber = 1; runNumber <= options.runs; runNumber += 1) {
        const record = await runAttempt({
          context,
          harness,
          fixtureServer: { url: (file) => fixtureUrl(fixtureServer, file) },
          task,
          runNumber,
          endpoint,
          model,
          apiKey,
          provider,
          reasoningLevel,
          traceDir,
        });
        records.push(record);
        console.log(
          `${record.success ? 'PASS' : 'FAIL'} ${task.id} run ${runNumber}/${options.runs}`
        );
      }
    }
  } catch (error) {
    runError = error;
  } finally {
    let browserCloseFailed = false;
    try {
      await context?.close();
    } catch (_) {
      browserCloseFailed = true;
    }
    await fixtureServer?.close().catch(() => {});
    if (browserProfile.persistent) {
      if (browserCloseFailed) {
        cleanupFailure = `The browser did not close cleanly; the persistent Codex profile at ${browserProfile.relativePath} may still be in use.`;
      }
      console.log(`Persistent Codex profile retained at ${browserProfile.relativePath}.`);
    } else {
      const profileRemoved = await cleanupTemporaryProfile(userDataDir, {
        remove: removeUserDataDir,
      });
      if (!profileRemoved) {
        cleanupFailure = `Temporary benchmark profile cleanup failed at ${userDataDir}; it may contain credentials. Remove it after closing any browser that still uses it.`;
      }
    }
  }
  if (cleanupFailure) throw new Error(cleanupFailure);
  if (runError) throw runError;

  const taskIds = selectedTasks.map((task) => task.id);
  const summary = buildSummary(records, options.runs, selectedTasks);
  const runSummary = summarizeRuns(records, options.runs, taskIds);
  const outputPath = path.join(outputDir, 'results.json');
  const overallPassRate = records.length
    ? records.filter((record) => record.success).length / records.length
    : 0;
  const endStatePassRate = records.length
    ? records.filter((record) => record.endStateMatches === true).length / records.length
    : 0;
  // Runs that reached the right end state but did not report done measure
  // outcome/planner calibration, not action capability. They need different fixes.
  const endStateOutcomeDisagreements = records.filter(
    (record) => record.endStateMatches === true && record.success !== true
  ).length;
  const report = {
    schemaVersion: benchmarkSchemaVersion,
    configFingerprint,
    createdAt: new Date().toISOString(),
    fixtureOrigin: '127.0.0.1 (ephemeral port)',
    provider,
    model,
    reasoningLevel: reasoningLevel || null,
    profileDirectory: browserProfile.relativePath,
    extensionDir: relativeExtensionDir,
    runsPerTask: options.runs,
    tasks: taskIds,
    summary,
    runSummary,
    overallPassRate,
    endStatePassRate,
    endStateOutcomeDisagreements,
    targetPassRate: PASS_TARGET_RATE,
    targetMet: overallPassRate >= PASS_TARGET_RATE,
    gapToTarget: Math.max(0, PASS_TARGET_RATE - overallPassRate),
    records,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  for (const run of runSummary) {
    console.log(
      `Run ${run.run}: ${Math.round(run.passRate * 100)}% (${run.passed}/${run.expectedTasks}), ${run.complete ? 'complete' : 'incomplete'}, target ${run.targetMet ? 'met' : 'missed'}`
    );
  }
  console.log(
    `Overall pass rate: ${Math.round(report.overallPassRate * 100)}% (target ${Math.round(report.targetPassRate * 100)}%, ${report.targetMet ? 'met' : `gap ${Math.round(report.gapToTarget * 100)} pts`})`
  );
  console.log(
    `End-state pass rate: ${Math.round(report.endStatePassRate * 100)}% with ${report.endStateOutcomeDisagreements} end-state/outcome disagreement(s)`
  );
  console.log(`Local results: ${path.relative(ROOT, outputPath)}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.list) {
    for (const task of TASKS) console.log(`${task.id}\t${task.prompt}`);
    return;
  }
  if (!options.run) {
    printHelp();
    throw new Error('No run started. Pass --run explicitly to authorize model requests.');
  }
  await runBenchmark(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Act benchmark stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  TASKS,
  PASS_TARGET_RATE,
  DEFAULT_RUNS,
  buildSummary,
  getBenchmarkConfig,
  getBenchmarkProfile,
  cleanupTemporaryProfile,
  parseArgs,
  prepareCodexProfile,
  resolveCodexModel,
  summarizeRuns,
  summarizeTrace,
  readFixtureState,
};
