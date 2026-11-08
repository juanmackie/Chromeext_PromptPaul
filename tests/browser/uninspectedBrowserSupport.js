/**
 * @fileoverview Browser control that never attaches to the extension worker.
 * @module uninspectedBrowserSupport
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium, expect } = require('@playwright/test');
// Use Playwright's bundled transport on Node 20 as well as newer Node versions.
const { ws: WebSocket } = require('playwright-core/lib/utilsBundle');
const { extensionLoadPath, getBrandedExecutable } = require('./browserTestSupport.js');

async function launchUninspectedBrowser(userDataDir) {
  const requested = String(
    process.env.PROMPT_PAUL_BROWSER || process.env.PROMPT_PAUL_BROWSER_CHANNEL || ''
  ).toLowerCase();
  const executable =
    requested || process.env.PROMPT_PAUL_BROWSER_EXECUTABLE
      ? getBrandedExecutable(requested === 'edge' ? 'edge' : 'chrome')
      : chromium.executablePath();
  if (!executable) throw new Error('No browser executable was found for the worker lifetime test.');
  const stderr = [];
  const processHandle = spawn(
    executable,
    [
      `--user-data-dir=${userDataDir}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      // GitHub's runners keep /dev/shm small and restrict user namespaces;
      // without these the browser can exit before the DevTools port opens.
      '--disable-dev-shm-usage',
      '--no-sandbox',
      ...(process.env.PROMPT_PAUL_HEADLESS === 'true' ? ['--headless=new'] : []),
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }
  );
  processHandle.stderr.on('data', (chunk) => {
    stderr.push(String(chunk));
    if (stderr.length > 20) stderr.shift();
  });
  let socket;
  let send;
  const close = async () => {
    if (socket?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {});
    socket?.terminate();
    processHandle.kill();
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        processHandle.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };
  try {
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    await expect
      .poll(() => fs.existsSync(portFile) || processHandle.exitCode !== null, { timeout: 10_000 })
      .toBe(true);
    if (!fs.existsSync(portFile)) {
      const detail = stderr.join('').trim().split(/\r?\n/).slice(-5).join(' | ');
      throw new Error(
        `Browser exited before exposing DevTools (code ${processHandle.exitCode})` +
          (detail ? `: ${detail}` : '')
      );
    }
    const [port, route] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    socket = new WebSocket(`ws://127.0.0.1:${port}${route}`);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const pending = new Map();
    let nextId = 0;
    socket.on('message', (data) => {
      const message = JSON.parse(String(data));
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    socket.on('close', () => {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('The test browser disconnected.'));
      }
      pending.clear();
    });
    send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Browser command timed out: ${method}`));
        }, 10_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    const { id: extensionId } = await send('Extensions.loadUnpacked', {
      path: extensionLoadPath(),
    });
    return {
      close,
      send,
      extensionId,
      async openPage(url) {
        const { targetId } = await send('Target.createTarget', { url });
        // Attaching to pages is safe. Attaching to the worker defeats its idle timeout.
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        return async (expression) => {
          const result = await send(
            'Runtime.evaluate',
            { expression, awaitPromise: true, returnByValue: true },
            sessionId
          );
          if (result.exceptionDetails) {
            throw new Error(
              result.exceptionDetails.exception?.description || 'Page evaluation failed.'
            );
          }
          return result.result.value;
        };
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { launchUninspectedBrowser };
