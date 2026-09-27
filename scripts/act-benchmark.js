#!/usr/bin/env node

/**
 * @fileoverview Opt-in, local-fixture Act benchmark using an OpenAI-compatible model.
 * @module actBenchmark
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROFILE_ID = 'act-benchmark-local';
const RUN_TIMEOUT_MS = 8 * 60 * 1_000;
const TASKS = [
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
];

function parseArgs(argv) {
  const options = { run: false, list: false, help: false, runs: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') options.run = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--runs') {
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

function parseUrl(value, label) {
  try {
    return new URL(value);
  } catch (_) {
    throw new Error(`${label} must be a valid URL.`);
  }
}

function printHelp() {
  console.log(
    `Local Act benchmark\n\n` +
      `  node scripts/act-benchmark.js --list\n` +
      `  node scripts/act-benchmark.js --run [--runs 3]\n\n` +
      `--run is required before a browser or model request is made. By default it builds the\n` +
      `isolated dist-eval extension; it uses only local fixtures and writes metrics (no prompts, page\n` +
      `text, responses, or credentials) beneath artifacts/act-benchmark/.\n\n` +
      `Each of the ${TASKS.length} task attempts is capped at ${Math.round(
        RUN_TIMEOUT_MS / 60_000
      )} minutes, so expect a long run when a model stalls; progress prints per attempt.\n\n` +
      `Required environment: PROMPT_PAUL_BENCHMARK_API_KEY\n` +
      `Optional: PROMPT_PAUL_BENCHMARK_ENDPOINT (default OpenAI chat completions URL),\n` +
      `          PROMPT_PAUL_BENCHMARK_MODEL (default gpt-4.1-mini),\n` +
      `          PROMPT_PAUL_BENCHMARK_EXTENSION_DIR (prebuilt eval build for A/B runs),\n` +
      `          PROMPT_PAUL_BROWSER=chrome|edge or PROMPT_PAUL_BROWSER_EXECUTABLE.\n` +
      `Use an OpenAI-compatible local endpoint to avoid external model traffic.`
  );
}

function summarizeTrace(trace) {
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  const actionSteps = steps.filter((step) => step.kind === 'action');
  const failureCodes = new Set();
  let inputTokens = 0;
  let outputTokens = 0;
  for (const step of steps) {
    const usage = step.tokenUsage;
    if (Number.isFinite(usage?.inputTokens)) inputTokens += usage.inputTokens;
    if (Number.isFinite(usage?.outputTokens)) outputTokens += usage.outputTokens;
    const result = step.action_result;
    const code = result?.result?.error || result?.error || result?.code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,79}$/.test(code)) failureCodes.add(code);
    if (typeof step.error === 'string') {
      const match = step.error.match(/\b[A-Z][A-Z0-9_]{2,79}\b/);
      if (match) failureCodes.add(match[0]);
    }
  }
  if (trace?.terminal?.type && trace.terminal.type !== 'complete') {
    failureCodes.add(`RUN_${String(trace.terminal.type).toUpperCase().slice(0, 24)}`);
  }
  return {
    steps: actionSteps.length,
    modelTurns: steps.filter((step) => step.kind === 'llm_turn_started').length,
    tokens: inputTokens || outputTokens ? { input: inputTokens, output: outputTokens } : null,
    failureCodes: [...failureCodes].slice(0, 32),
    terminalState: String(trace?.terminal?.type || 'missing').slice(0, 32),
  };
}

async function readFixtureState(page, task) {
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
    const successById = {
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
    };
    return Boolean(successById[taskId]?.(document.body));
  }, task.id);
}

function safeCardOrigin(confirmation, fixtureOrigin) {
  if (!confirmation) return false;
  try {
    const fixture = parseUrl(fixtureOrigin, 'Local fixture origin');
    if (String(confirmation.origin || '') !== fixture.hostname) return false;
    const destination = String(confirmation.destination || '');
    const destinationHost = String(confirmation.destinationOrigin || '');
    if (!destination) return !destinationHost;
    return (
      parseUrl(destination, 'Confirmation destination').origin === fixture.origin &&
      destinationHost === fixture.hostname
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
}) {
  const target = await context.newPage();
  const targetUrl = `${fixtureServer.url('act-benchmark.html')}?case=${encodeURIComponent(task.id)}`;
  await target.goto(targetUrl);
  const taskId = `${task.id}-${runNumber}-${Date.now().toString(36)}`;
  const fixtureOrigin = parseUrl(targetUrl, 'Local fixture URL').origin;
  const startedAt = Date.now();
  let runId = null;
  let resultMessage = null;
  const failureCodes = new Set();
  const deadline = startedAt + RUN_TIMEOUT_MS;
  try {
    await harness.evaluate(
      ({ endpoint, model, apiKey, profileId }) =>
        chrome.storage.local.get(['profiles']).then(({ profiles = [] }) => {
          const profile = {
            id: profileId,
            name: 'Local Act benchmark',
            provider: 'api',
            llmEndpoint: endpoint,
            apiKey,
            modelName: model,
          };
          return chrome.storage.local.set({
            profiles: [...profiles.filter((item) => item.id !== profileId), profile],
            lastSelectedProfileId: profileId,
          });
        }),
      { endpoint, model, apiKey, profileId: PROFILE_ID }
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
    }
    const trace = resultMessage?.result || null;
    const traceSummary = summarizeTrace(trace);
    for (const code of traceSummary.failureCodes) failureCodes.add(code);
    const success = await readFixtureState(target, task);
    if (!success && !failureCodes.size) failureCodes.add('END_STATE_MISMATCH');
    const cards = runId
      ? await harness.evaluate((id) => window.pageActionHarness.getRunMetrics(id), runId)
      : {};
    return {
      taskId: task.id,
      run: runNumber,
      success,
      steps: traceSummary.steps,
      modelTurns: traceSummary.modelTurns,
      tokens: traceSummary.tokens,
      wallTimeMs: Math.max(0, Date.now() - startedAt),
      confirmationCards: Number(cards?.confirmationCards) || 0,
      progressCards: Number(cards?.progressCards) || 0,
      failureCodes: [...failureCodes].slice(0, 32),
      terminalState: traceSummary.terminalState,
    };
  } catch (error) {
    failureCodes.add(
      /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message) ? error.message : 'HARNESS_ERROR'
    );
    return {
      taskId: task.id,
      run: runNumber,
      success: false,
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
    await target.close().catch(() => {});
  }
}

function buildSummary(records, runs) {
  return TASKS.map((task) => {
    const attempts = records.filter((record) => record.taskId === task.id);
    return {
      taskId: task.id,
      passed: attempts.filter((record) => record.success).length,
      runs,
      passRate: attempts.length
        ? attempts.filter((record) => record.success).length / attempts.length
        : 0,
    };
  });
}

async function runBenchmark(options) {
  const apiKey = process.env.PROMPT_PAUL_BENCHMARK_API_KEY;
  if (!apiKey) throw new Error('Set PROMPT_PAUL_BENCHMARK_API_KEY to opt in to model requests.');
  const endpoint =
    process.env.PROMPT_PAUL_BENCHMARK_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
  const model = process.env.PROMPT_PAUL_BENCHMARK_MODEL || 'gpt-4.1-mini';
  const parsed = parseUrl(endpoint, 'Benchmark endpoint');
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(
      'The benchmark endpoint must be a credential-free HTTP(S) URL; pass the key separately.'
    );
  }

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

  const osDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-act-benchmark-'));
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
  try {
    fixtureServer = await startFixtureServer();
    ({ context } = await launchTestBrowser(osDir));
    const harness = await openHarness(context);
    for (const task of TASKS) {
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
        });
        records.push(record);
        console.log(
          `${record.success ? 'PASS' : 'FAIL'} ${task.id} run ${runNumber}/${options.runs}`
        );
      }
    }
  } finally {
    await context?.close().catch(() => {});
    await fixtureServer?.close().catch(() => {});
    removeUserDataDir(osDir);
  }

  const summary = buildSummary(records, options.runs);
  const outputDir = path.join(ROOT, 'artifacts', 'act-benchmark');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(
    outputDir,
    `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    fixtureOrigin: '127.0.0.1 (ephemeral port)',
    model,
    extensionDir: relativeExtensionDir,
    runsPerTask: options.runs,
    summary,
    overallPassRate: records.length
      ? records.filter((record) => record.success).length / records.length
      : 0,
    records,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`\nOverall pass rate: ${Math.round(report.overallPassRate * 100)}%`);
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

main().catch((error) => {
  console.error(`Act benchmark stopped: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { parseArgs, summarizeTrace };
