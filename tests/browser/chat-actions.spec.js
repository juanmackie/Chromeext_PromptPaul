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

test('expands and collapses the prompt input', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  const chat = await context.newPage();
  await chat.goto(`chrome-extension://${extensionId}/chat.html`);

  try {
    const toggle = chat.locator('#input-expand-toggle');
    const inputArea = chat.locator('#input-area');
    const icon = toggle.locator('.material-symbols-outlined');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(icon).toHaveText('open_in_full');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(inputArea).toHaveClass(/input-area-expanded/);
    await expect(icon).toHaveText('close_fullscreen');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(inputArea).not.toHaveClass(/input-area-expanded/);
    await expect(icon).toHaveText('open_in_full');
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
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
