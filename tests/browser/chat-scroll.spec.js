/**
 * @fileoverview Browser coverage for reading a completed chat response.
 * @module chatScrollBrowserSpec
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { expect, test } = require('@playwright/test');
const { launchTestBrowser, openHarness, removeUserDataDir } = require('./browserTestSupport.js');

test('a long streamed response finishes promptly and stays scrollable after idle', async () => {
  const answer = Array.from(
    { length: 100 },
    (_, index) => `Paragraph ${index + 1}: observation ${index * 7919} has value ${index ** 3}.`
  ).join('\n\n');
  let requestCount = 0;
  const timings = { requestStartedAt: 0, responseFinishedAt: 0 };
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      timings.requestStartedAt = Date.now();
      requestCount += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const base = {
        id: 'chatcmpl-scroll',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'fixture-model',
      };
      const paragraphs = answer.split('\n\n');
      let index = 0;
      const streamTimer = setInterval(() => {
        if (response.destroyed) {
          clearInterval(streamTimer);
          return;
        }
        if (index === paragraphs.length) {
          clearInterval(streamTimer);
          response.end(
            `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
            () => {
              timings.responseFinishedAt = Date.now();
            }
          );
          return;
        }
        const content = `${index === 0 ? '' : '\n\n'}${paragraphs[index]}`;
        response.write(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { ...(index === 0 ? { role: 'assistant' } : {}), content }, finish_reason: null }] })}\n\n`
        );
        index += 1;
      }, 25);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-scroll-'));
  let context;
  try {
    ({ context } = await launchTestBrowser(userDataDir));
    const harness = await openHarness(context);
    await expect
      .poll(() =>
        harness.evaluate(async () => {
          const { profiles } = await chrome.storage.local.get('profiles');
          return Boolean(profiles?.length);
        })
      )
      .toBe(true);
    await harness.evaluate(async (endpoint) => {
      await chrome.storage.local.set({
        profiles: [
          {
            id: 'scroll-fixture',
            name: 'Scroll fixture',
            provider: 'api',
            llmEndpoint: endpoint,
            apiKey: 'fixture-placeholder',
            modelName: 'fixture-model',
          },
        ],
        lastSelectedProfileId: 'scroll-fixture',
      });
    }, `http://127.0.0.1:${server.address().port}/chat`);
    const chat = await context.newPage();
    await chat.setViewportSize({ width: 380, height: 720 });
    const pageErrors = [];
    chat.on('pageerror', (error) => pageErrors.push(error.message));
    await chat.goto(`chrome-extension://${new URL(harness.url()).hostname}/chat.html`);
    await expect(chat.locator('#quick-actions-row')).toBeVisible();
    await expect(chat.locator('#sidebar-model-status')).toHaveAttribute(
      'aria-label',
      /fixture-model/
    );
    await chat.locator('#user-input').fill('Give me the observations.');
    await chat.locator('#send-button').click();
    await expect(chat.locator('#input-area'))
      .toHaveAttribute('data-run-state', 'complete', {
        timeout: 45000,
      })
      .catch(async (error) => {
        throw new Error(
          `${error.message}\nMock requests: ${requestCount}\nPage errors: ${pageErrors.join(' | ')}`
        );
      });
    expect(requestCount).toBe(1);
    const terminalLagMs = Date.now() - timings.responseFinishedAt;
    expect(
      terminalLagMs,
      `terminal UI lagged ${terminalLagMs}ms after the provider stream ended`
    ).toBeLessThan(5000);
    await expect(chat.locator('.llm-content-area')).toContainText('Paragraph 100');

    const transcript = chat.locator('#chat-area');
    // Check scrolling as soon as terminal UI completes, then again after the
    // several-second idle period reported by users.
    const metrics = await transcript.evaluate((element) => ({
      top: element.scrollTop,
      height: element.scrollHeight,
      viewport: element.clientHeight,
    }));
    await chat.screenshot({
      path: path.join(__dirname, '../../artifacts/scroll-completed-panel.png'),
    });
    expect(metrics.height).toBeGreaterThan(metrics.viewport + 1000);
    const box = await transcript.boundingBox();
    await chat.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 200));
    const scrollBothDirections = async () => {
      const before = await transcript.evaluate((element) => element.scrollTop);
      await chat.mouse.wheel(0, -1000);
      await expect
        .poll(() => transcript.evaluate((element) => element.scrollTop))
        .toBeLessThan(before - 300);
      const scrolledUp = await transcript.evaluate((element) => element.scrollTop);
      await chat.mouse.wheel(0, 500);
      await expect
        .poll(() => transcript.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(scrolledUp + 100);
    };
    await expect
      .poll(() =>
        transcript.evaluate(
          (element) => element.scrollHeight - element.clientHeight - element.scrollTop
        )
      )
      .toBeLessThan(80);
    await scrollBothDirections();

    // Keep the panel at the bottom to model the normal streamed-response state
    // during the idle period reported by users.
    await transcript.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await chat.waitForTimeout(5000);
    await scrollBothDirections();
  } finally {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
    removeUserDataDir(userDataDir);
  }
});

test('finalizes streamed reasoning with canonical cross-block Markdown', async () => {
  const reasoning = 'See [docs][d].\n\n[d]: https://example.com';
  let requestCount = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const base = {
        id: 'chatcmpl-reasoning',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'fixture-model',
      };
      const deltas = [{ role: 'assistant' }, { reasoning }, { content: 'Answer.' }];
      for (const delta of deltas) {
        response.write(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
        );
      }
      response.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`
      );
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-reasoning-'));
  let context;
  try {
    ({ context } = await launchTestBrowser(userDataDir));
    const harness = await openHarness(context);
    await expect
      .poll(() =>
        harness.evaluate(async () => {
          const { profiles } = await chrome.storage.local.get('profiles');
          return Boolean(profiles?.length);
        })
      )
      .toBe(true);
    await harness.evaluate(async (endpoint) => {
      await chrome.storage.local.set({
        profiles: [
          {
            id: 'reasoning-fixture',
            name: 'Reasoning fixture',
            provider: 'api',
            llmEndpoint: endpoint,
            apiKey: 'fixture-placeholder',
            modelName: 'fixture-model',
          },
        ],
        lastSelectedProfileId: 'reasoning-fixture',
      });
    }, `http://127.0.0.1:${server.address().port}/chat`);
    const chat = await context.newPage();
    await chat.goto(`chrome-extension://${new URL(harness.url()).hostname}/chat.html`);
    await chat.locator('#user-input').fill('Summarize the reference.');
    await chat.locator('#send-button').click();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
      timeout: 45000,
    });
    expect(requestCount).toBe(1);
    const reference = chat.locator('.reasoning-content a');
    await expect(reference).toHaveText('docs');
    await expect(reference).toHaveAttribute('href', 'https://example.com');
  } finally {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
    removeUserDataDir(userDataDir);
  }
});
