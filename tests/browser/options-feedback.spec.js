/**
 * @fileoverview Real-browser coverage for Options page status feedback: every
 * `showStatus()` message must surface as a *visible* toast. Regression guard for
 * the Bootstrap cascade bug where loadingManager toasts reused Bootstrap's
 * `.toast` class and were hidden by `.toast:not(.show){display:none}`.
 * @module optionsFeedbackBrowserSpec
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect, test } = require('@playwright/test');
const { launchTestBrowser, openHarness, removeUserDataDir } = require('./browserTestSupport.js');

test('skill form feedback is visible and saving a skill reports success', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-options-feedback-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  const options = await context.newPage();

  try {
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator('[data-bs-target="#skillsCollapse"]').click();

    // Empty form: the only feedback is the toast, and it must be on screen.
    await options.locator('#saveSkill').click();
    const errorToast = options.locator('.ext-toast.error');
    await expect(errorToast).toBeVisible();
    await expect(errorToast).toContainText('All fields are required.');

    // Bootstrap's own toast component must stay hidden; the fix must not leak
    // display onto it (options.html keeps a Bootstrap status toast in the DOM).
    await expect(options.locator('#statusToast')).toBeHidden();

    await options.fill('#skillName', 'feedback-probe');
    await options.fill('#skillDescription', 'Skill used to check Options feedback');
    await options.fill('#skillContent', 'Do the probe thing.');
    await options.locator('#saveSkill').click();

    // Saving also clears the form, so filter to the specific message.
    const successToast = options.locator('.ext-toast.success', { hasText: 'Skill added.' });
    await expect(successToast).toBeVisible();
    await expect(
      options.locator('#skillsTable tbody tr', { hasText: 'feedback-probe' })
    ).toHaveCount(1);
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});
