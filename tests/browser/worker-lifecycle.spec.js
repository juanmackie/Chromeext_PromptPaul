/**
 * @fileoverview Verify real worker idle shutdown without a worker debugger.
 * @module workerLifecycleBrowserSpec
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { expect, test } = require('@playwright/test');
const { removeUserDataDir } = require('./browserTestSupport.js');
const { launchUninspectedBrowser } = require('./uninspectedBrowserSupport.js');

test('a quiet clarification remains answerable and the completed worker becomes idle', async () => {
  test.setTimeout(120_000);
  let providerCalls = 0;
  const server = http.createServer((request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>Greeting fixture</title><button>Greeting</button>');
      return;
    }
    request.resume();
    request.on('end', () => {
      providerCalls += 1;
      const name = providerCalls === 1 ? 'page_get_state' : 'page_request_user_input';
      const args = providerCalls === 1 ? {} : { question: 'Which greeting should I use?' };
      const delta =
        providerCalls <= 2
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: `greeting-${providerCalls}`,
                  type: 'function',
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            }
          : { content: 'Greeting selected.' };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta, finish_reason: providerCalls <= 2 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mock-chat`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-lifetime-'));
  let browser;
  try {
    browser = await launchUninspectedBrowser(userDataDir);
    const evaluate = await browser.openPage(
      `chrome-extension://${browser.extensionId}/tests/browser/extension-harness.html`
    );
    await expect.poll(() => evaluate('Boolean(window.pageActionHarness)')).toBe(true);
    await evaluate(`(async () => {
      await chrome.storage.local.set({ profiles: [{ id: 'lifetime-fixture', name: 'Lifetime fixture', provider: 'api',
        llmEndpoint: ${JSON.stringify(endpoint)}, apiKey: 'fixture-placeholder', modelName: 'fixture-model' }] });
      chrome.runtime.onMessage.addListener(message => {
        if (message.event?.type === 'page_user_input_request') window.lifetimeQuestion = message.event;
        if (message.event?.type === 'complete') window.lifetimeCompletion = message.event;
      });
      const tab = await chrome.tabs.create({ url: ${JSON.stringify(endpoint)}, active: false });
      window.lifetimeTabId = tab.id;
    })()`);
    await expect
      .poll(() => evaluate('chrome.tabs.get(window.lifetimeTabId).then(tab => tab.status)'))
      .toBe('complete');
    const ack = await evaluate(`(async () => {
      window.lifetimeRun = await chrome.runtime.sendMessage({ action: 'startRun', config: {
        profileId: 'lifetime-fixture', pageActions: true, sourceTabId: window.lifetimeTabId, tool_choice: 'auto' } });
      return chrome.runtime.sendMessage({ action: 'executeRun', ...window.lifetimeRun,
        requestConfig: { messages: [{ role: 'user', content: 'Choose a greeting.' }] } });
    })()`);
    expect(ack).toMatchObject({ success: true, accepted: true });
    await expect.poll(() => evaluate('Boolean(window.lifetimeQuestion)')).toBe(true);
    // This absence window is essential: polling the worker would reset its idle timer.
    await new Promise((resolve) => setTimeout(resolve, 40_000));
    const journal = await evaluate(
      'chrome.runtime.sendMessage({ action: "getRunJournal", runId: window.lifetimeRun.runId })'
    );
    expect(journal.active, 'The worker lost the pending question during idle shutdown').toBe(true);
    const answered = await evaluate(`chrome.runtime.sendMessage({ action: 'pageUserInputResponse',
      ...window.lifetimeRun, sourceTabId: window.lifetimeTabId, requestId: window.lifetimeQuestion.requestId, answer: 'Hello' })`);
    expect(answered).toMatchObject({ success: true });
    await expect
      .poll(() => evaluate('window.lifetimeCompletion?.content'))
      .toBe('Greeting selected.');
    expect(providerCalls).toBe(3);
    // Check that completing the operation releases the heartbeat, allowing normal suspension.
    await new Promise((resolve) => setTimeout(resolve, 40_000));
    const targets = await browser.send('Target.getTargets');
    expect(
      targets.targetInfos.filter(
        (target) =>
          target.type === 'service_worker' &&
          target.url.startsWith(`chrome-extension://${browser.extensionId}/`)
      )
    ).toHaveLength(0);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    removeUserDataDir(userDataDir);
  }
});
