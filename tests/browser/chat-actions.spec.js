/**
 * @fileoverview Real-browser coverage for contextual chat actions.
 * @module chatActionsBrowserSpec
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect, test } = require('@playwright/test');
const {
  fixtureUrl,
  launchTestBrowser,
  openHarness,
  removeUserDataDir,
  startFixtureServer,
} = require('./browserTestSupport.js');

let fixtureServer;

test.beforeAll(async () => {
  fixtureServer = await startFixtureServer();
});

test.afterAll(async () => {
  await fixtureServer?.close();
});

test('captures the live page selection when Analyze is clicked', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const target = await context.newPage();
  const targetUrl = fixtureUrl(fixtureServer, 'form.html');
  await target.goto(targetUrl);
  await target.locator('#body p').evaluate((paragraph) => {
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  await harness.evaluate((url) => window.pageActionHarness.attachSelectionSource(url), targetUrl);
  const chat = await context.newPage();
  await chat.goto(`chrome-extension://${extensionId}/chat.html`);

  try {
    await expect(chat.locator('#selected-text-strip')).toBeVisible();
    await chat.locator('#selected-text-remove-button').click();
    await expect(chat.locator('#selected-text-strip')).toBeHidden();

    await chat.locator('#analyze-button').click();

    await expect(chat.locator('#selected-text-strip')).toBeVisible();
    await expect(chat.locator('#selected-text-snippet')).toHaveText('Hello');
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});
