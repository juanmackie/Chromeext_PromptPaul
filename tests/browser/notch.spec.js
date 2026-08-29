/**
 * @fileoverview Real-browser coverage for the optional page-scoped notch.
 * @module notchBrowserSpec
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

test('shows an isolated quick-action notch when enabled', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-notch-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  const options = await context.newPage();
  const target = await context.newPage();

  try {
    await target.goto(fixtureUrl(fixtureServer, 'form.html'));
    await expect(target.locator('[data-prompt-paul-notch-host]')).toHaveCount(0);

    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator('#notchEnabledToggle').check();
    await options.locator('#saveNotch').click();
    await expect(options.locator('#notchSaveStatus')).toHaveText('Notch is on.');

    const host = target.locator('[data-prompt-paul-notch-host]');
    await expect(host).toHaveCount(1);
    const hostBox = await host.boundingBox();
    expect(hostBox).not.toBeNull();
    expect(hostBox.x + hostBox.width / 2).toBeCloseTo(640, 0);
    expect(hostBox.y).toBeLessThan(50);
    const toggle = host.locator('.notch-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(host.locator('.notch-panel')).toBeVisible();
    await target.waitForTimeout(450);
    const railBox = await host.locator('.notch-rail').boundingBox();
    const panelBox = await host.locator('.notch-panel').boundingBox();
    expect(railBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(railBox.x).toBeCloseTo(panelBox.x, 0);
    expect(railBox.width).toBeCloseTo(panelBox.width, 0);
    const fontFamilies = await host
      .locator('.notch-title, .notch-action-label')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fontFamily));
    expect(new Set(fontFamilies).size).toBe(1);
    await expect(host.locator('[data-notch-action="summarizePage"]')).toBeVisible();

    await host.locator('[data-notch-action="openActions"]').click();
    await expect(host.locator('.notch-panel')).toBeHidden();

    await target.locator('#body p').evaluate((paragraph) => {
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await expect(host.locator('[data-notch-action="explainSelection"]')).toBeEnabled();

    await options.locator('#notchEnabledToggle').uncheck();
    await options.locator('#saveNotch').click();
    await expect(options.locator('#notchSaveStatus')).toHaveText('Notch is off.');
    await expect(host).toHaveCount(0);
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});
