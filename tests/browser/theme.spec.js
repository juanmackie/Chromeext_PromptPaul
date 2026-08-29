/**
 * @fileoverview Real-browser coverage for Light, Dark, and System themes.
 * @module themeBrowserSpec
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect, test } = require('@playwright/test');
const { launchTestBrowser, openHarness, removeUserDataDir } = require('./browserTestSupport.js');

test('follows the system theme when System is selected', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-theme-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  const options = await context.newPage();

  try {
    await options.emulateMedia({ colorScheme: 'dark' });
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator('summary', { hasText: 'Appearance' }).click();
    const selector = options.locator('#themePreference');

    await selector.selectOption('system');
    await expect(selector).toHaveValue('system');
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'dark');

    await options.emulateMedia({ colorScheme: 'light' });
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'light');

    await selector.selectOption('dark');
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'dark');
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});
