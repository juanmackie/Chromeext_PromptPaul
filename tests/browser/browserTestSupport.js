/**
 * @fileoverview Shared setup for unpacked-extension browser tests.
 * @module browserTestSupport
 */

const fs = require('fs');
const http = require('http');
const net = require('net');
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const { chromium, expect } = require('@playwright/test');

const repoRoot = path.resolve(__dirname, '../..');

/**
 * The extension directory to load in browser tests. Defaults to the source
 * checkout, but can point at a built production output (for example dist)
 * via PROMPT_PAUL_LOAD_EXTENSION_DIR so release artifacts are exercised
 * against the exact packaged files (P1-08).
 * @returns {string}
 */
function extensionLoadPath() {
  const target = process.env.PROMPT_PAUL_LOAD_EXTENSION_DIR || '';
  return target ? path.resolve(repoRoot, target) : repoRoot;
}
const fixtureRoot = path.join(__dirname, 'fixtures');
let diagnosticsCaptureIndex = 0;
// Extension ids returned by Extensions.loadUnpacked, so a test never has to
// win a race against a service worker that may start lazily.
const knownExtensionIds = new WeakMap();

function shouldCaptureDiagnostics() {
  return process.env.PROMPT_PAUL_CAPTURE_DIAGNOSTICS === 'true';
}

function diagnosticsDirectory() {
  return path.resolve(
    process.env.PROMPT_PAUL_DIAGNOSTICS_DIR ||
      path.join(repoRoot, 'artifacts', 'browser-diagnostics')
  );
}

async function captureBrowserDiagnostics(context) {
  if (!shouldCaptureDiagnostics()) return;
  const workers = context.serviceWorkers();
  for (const worker of workers) {
    if (!(await isPromptPaulWorker(worker))) continue;
    try {
      const trace = await worker.evaluate(async () => globalThis.promptPaulDevDiagnostics?.get?.());
      fs.mkdirSync(diagnosticsDirectory(), { recursive: true });
      const fileName = `trace-${process.pid}-${String(++diagnosticsCaptureIndex).padStart(3, '0')}.json`;
      fs.writeFileSync(
        path.join(diagnosticsDirectory(), fileName),
        JSON.stringify(trace || { schemaVersion: 1, entries: [] }, null, 2)
      );
    } catch (_) {
      // The worker may be gone during browser shutdown; test cleanup remains best effort.
    }
    return;
  }
}

function browserLaunchOptions(userDataDir) {
  return {
    // Chromium disables extension service workers in legacy headless mode.
    // Keep headed mode as the default for real extension coverage.
    headless: process.env.PROMPT_PAUL_HEADLESS === 'true' ? true : false,
    args: [
      `--disable-extensions-except=${extensionLoadPath()}`,
      `--load-extension=${extensionLoadPath()}`,
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1280, height: 900 },
    userDataDir,
  };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function getBrandedExecutable(requested) {
  if (process.env.PROMPT_PAUL_BROWSER_EXECUTABLE) {
    return process.env.PROMPT_PAUL_BROWSER_EXECUTABLE;
  }
  const candidates =
    requested === 'edge'
      ? [
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        ]
      : [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

/**
 * Launch Chromium or a branded Chromium-family browser with Prompt Paul loaded.
 * @param {string} userDataDir
 * @returns {Promise<{context: object}>}
 */
async function launchTestBrowser(userDataDir) {
  const requested = String(
    process.env.PROMPT_PAUL_BROWSER || process.env.PROMPT_PAUL_BROWSER_CHANNEL || ''
  ).toLowerCase();
  if (!requested && !process.env.PROMPT_PAUL_BROWSER_EXECUTABLE) {
    const context = await chromium.launchPersistentContext(
      userDataDir,
      browserLaunchOptions(userDataDir)
    );
    const closeContext = context.close.bind(context);
    context.close = async () => {
      await captureBrowserDiagnostics(context);
      await closeContext();
    };
    return { context };
  }

  const executable = getBrandedExecutable(requested === 'edge' ? 'edge' : 'chrome');
  if (!executable) {
    throw new Error(
      `No ${requested === 'edge' ? 'Microsoft Edge' : 'Google Chrome'} executable was found. ` +
        'Set PROMPT_PAUL_BROWSER_EXECUTABLE to an installed browser.'
    );
  }
  const port = await getFreePort();
  const processHandle = spawn(
    executable,
    [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { stdio: 'ignore', windowsHide: true }
  );
  let browser;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!browser) {
    processHandle.kill();
    throw new Error(`Could not connect to ${executable} over Chrome DevTools Protocol.`);
  }

  // Chrome 137+ and equivalent Edge builds reject --load-extension for
  // security reasons. The CDP Extensions domain is the supported path for
  // loading an unpacked directory in those real browsers.
  const browserCdp = await browser.newBrowserCDPSession();
  const loaded = await browserCdp.send('Extensions.loadUnpacked', {
    path: extensionLoadPath(),
  });
  const context = browser.contexts()[0];
  if (typeof loaded?.id === 'string' && loaded.id) knownExtensionIds.set(context, loaded.id);
  const closeContext = context.close.bind(context);
  context.close = async () => {
    await captureBrowserDiagnostics(context);
    await closeContext();
    await browser.close();
    if (process.platform === 'win32') {
      // Best effort: browser.close() usually exits the process first, and
      // taskkill reports an already-dead pid as a non-zero status. Teardown
      // must never fail a test whose assertions already passed.
      try {
        execFileSync('taskkill', ['/pid', String(processHandle.pid), '/t', '/f'], {
          stdio: 'ignore',
        });
      } catch (_) {
        // The browser process is already gone.
      }
    } else {
      processHandle.kill('SIGKILL');
    }
  };
  return { context };
}

const MOCK_CHAT_PATH = '/mock-chat';
const MOCK_CHAT_REPLY = 'Mock provider reply: the attached context was received.';

/**
 * Read a bounded request body from a mock-provider POST.
 * @param {http.IncomingMessage} request
 * @returns {Promise<string>}
 */
function readMockRequestBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        request.destroy();
        reject(new Error('Mock chat request body exceeded 1 MB.'));
      }
    });
    request.on('end', () => resolve(raw));
    request.on('error', reject);
  });
}

/**
 * Build a bounded OpenAI-style SSE stream that emits one deterministic reply.
 * @param {string} content
 * @returns {string}
 */
function openAiSsePayload(content) {
  const base = {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fixture-model',
  };
  const first = {
    ...base,
    choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
  };
  const last = { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  return `data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(last)}\n\ndata: [DONE]\n\n`;
}

/**
 * Handle a POST to the mock chat-completions endpoint: record the bounded
 * request (Authorization presence only, never the credential value) and
 * answer with a deterministic OpenAI-style SSE stream.
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 * @param {{mockRequests: Array, holdRelease: Function|null}} state
 * @param {URL} requestUrl
 * @returns {void}
 */
function serveMockChat(request, response, state, requestUrl) {
  readMockRequestBody(request)
    .then((raw) => {
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch (_) {
        body = null;
      }
      state.mockRequests.push({
        url: requestUrl.pathname + requestUrl.search,
        hasAuthorization: Boolean(request.headers.authorization),
        body,
      });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (requestUrl.searchParams.get('hold') === '1') {
        // Hold the stream open so tests can observe in-flight run state;
        // releaseMockChat() completes the deterministic reply.
        state.holdRelease = () => {
          response.write(openAiSsePayload(MOCK_CHAT_REPLY));
          response.end();
        };
        return;
      }
      response.end(openAiSsePayload(MOCK_CHAT_REPLY));
    })
    .catch(() => {
      try {
        response.writeHead(500);
        response.end();
      } catch (_) {
        // Socket already gone; nothing to recover.
      }
    });
}

function serveFixture(request, response, state) {
  const requestUrl = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'POST' && requestUrl.pathname === MOCK_CHAT_PATH) {
    serveMockChat(request, response, state, requestUrl);
    return;
  }
  if (request.method !== 'GET') {
    response.writeHead(405);
    response.end('Method not allowed');
    return;
  }
  const requestPath = requestUrl.pathname;
  const fileName = path.basename(requestPath);
  const filePath = path.join(fixtureRoot, fileName);
  if (!filePath.startsWith(fixtureRoot) || !fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(fs.readFileSync(filePath));
}

async function startFixtureServer() {
  const state = { mockRequests: [], holdRelease: null };
  const server = http.createServer((request, response) => serveFixture(request, response, state));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    url: (name) => `http://127.0.0.1:${address.port}/${name}`,
    close: () => new Promise((resolve) => server.close(resolve)),
    /** Bounded recorded mock-chat requests (credential values are never kept). */
    mockRequests: () => state.mockRequests.map((entry) => ({ ...entry })),
    resetMockRequests: () => {
      state.mockRequests = [];
    },
    releaseMockChat: () => {
      const release = state.holdRelease;
      state.holdRelease = null;
      if (release) release();
    },
  };
}

async function isPromptPaulWorker(serviceWorker) {
  if (!serviceWorker) return false;
  try {
    const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
    return manifest?.name?.includes('Prompt Paul');
  } catch (_) {
    return false;
  }
}

async function getExtensionId(context) {
  const known = knownExtensionIds.get(context);
  if (known) return known;
  for (const serviceWorker of context.serviceWorkers()) {
    if (await isPromptPaulWorker(serviceWorker)) return new URL(serviceWorker.url()).hostname;
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const serviceWorker = await context.waitForEvent('serviceworker', {
      timeout: Math.max(1, deadline - Date.now()),
    });
    if (await isPromptPaulWorker(serviceWorker)) return new URL(serviceWorker.url()).hostname;
  }
  throw new Error(
    'Prompt Paul service worker did not start; verify the browser loaded the unpacked extension.'
  );
}

async function openHarness(context) {
  try {
    const extensionId = await getExtensionId(context);
    const harness = await context.newPage();
    await harness.goto(`chrome-extension://${extensionId}/tests/browser/extension-harness.html`);
    await expect(harness.locator('#status')).toHaveAttribute('data-ready', 'true');
    if (shouldCaptureDiagnostics()) {
      await harness.evaluate(async () => {
        await chrome.storage.session.set({
          promptPaulDevDiagnosticsConfigV1: {
            enabled: true,
            expiresAt: Date.now() + 24 * 60 * 60 * 1_000,
          },
        });
      });
    }
    return harness;
  } catch (error) {
    // A browser whose harness never opened cannot be driven by the test, and
    // several callers invoke openHarness before their try/finally. Close it
    // here so one failed test cannot leak a process and starve later launches.
    await context.close().catch(() => {});
    throw error;
  }
}

async function startAndInspect(harness, targetUrl, prefix) {
  const started = await harness.evaluate(
    ({ targetUrl }) => window.pageActionHarness.startRun(targetUrl),
    { targetUrl }
  );
  expect(started.runId, JSON.stringify(started)).toBeTruthy();
  const state = await harness.evaluate(
    ({ runId, prefix }) =>
      window.pageActionHarness.executeTool(runId, `${prefix}-state`, 'page_get_state', {}),
    { runId: started.runId, prefix }
  );
  expect(state.error, JSON.stringify(state)).toBeUndefined();
  expect(state.result?.snapshot, JSON.stringify(state)).toBeTruthy();
  return { runId: started.runId, snapshot: state.result.snapshot };
}

async function abortRun(harness, runId) {
  if (!runId) return;
  await harness.evaluate((id) => window.pageActionHarness.abortRun(id), runId);
}

function removeUserDataDir(userDataDir) {
  try {
    fs.rmSync(userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  } catch (_) {
    // Chrome may release profile locks just after the CDP disconnect. The
    // profile is disposable test data, so cleanup failure is non-fatal.
  }
}

module.exports = {
  abortRun,
  extensionLoadPath,
  fixtureUrl: (server, name) => server.url(name),
  getBrandedExecutable,
  launchTestBrowser,
  openHarness,
  removeUserDataDir,
  startAndInspect,
  startFixtureServer,
};
