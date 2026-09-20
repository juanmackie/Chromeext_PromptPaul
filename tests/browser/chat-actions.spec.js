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
    const userInput = chat.locator('#user-input');
    const sendButton = chat.locator('#send-button');
    const clearButton = chat.locator('#clear-button');
    const icon = toggle.locator('.material-symbols-outlined');
    const collapsedInputBox = await userInput.boundingBox();

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(icon).toHaveText('open_in_full');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(inputArea).toHaveClass(/input-area-expanded/);
    await expect(icon).toHaveText('close_fullscreen');
    await chat.waitForTimeout(250);

    await expect
      .poll(async () => (await userInput.boundingBox())?.height || 0)
      .toBeGreaterThan(collapsedInputBox.height);
    const expandedInputBox = await userInput.boundingBox();
    const sendButtonBox = await sendButton.boundingBox();
    const clearButtonBox = await clearButton.boundingBox();
    expect(expandedInputBox).not.toBeNull();
    expect(sendButtonBox).not.toBeNull();
    expect(clearButtonBox).not.toBeNull();
    expect(expandedInputBox.width).toBeGreaterThanOrEqual(collapsedInputBox.width);
    expect(sendButtonBox.y).toBeGreaterThanOrEqual(expandedInputBox.y + expandedInputBox.height);
    expect(clearButtonBox.y).toBeGreaterThanOrEqual(expandedInputBox.y + expandedInputBox.height);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(inputArea).not.toHaveClass(/input-area-expanded/);
    await expect(icon).toHaveText('open_in_full');
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('shows the selected mode, model, and reasoning level', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  await harness.evaluate(() =>
    chrome.storage.local.set({
      profiles: [
        {
          id: 'default',
          provider: 'api',
          modelName: 'openrouter/free',
          reasoningLevel: 'high',
        },
      ],
      lastSelectedProfileId: 'default',
    })
  );
  const extensionId = new URL(harness.url()).hostname;
  const chat = await context.newPage();
  await chat.goto(`chrome-extension://${extensionId}/chat.html`);

  try {
    // Settle first-run initialization deterministically: confirm opening chat
    // neither overwrites the saved profile nor discards its reasoning level,
    // then assert the sidebar mirrors the saved value.
    const saved = await chat.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], (result) => {
            const profile = (result.profiles || []).find(
              (entry) => entry.id === result.lastSelectedProfileId
            );
            resolve({ reasoningLevel: profile?.reasoningLevel || '' });
          });
        })
    );
    expect(saved.reasoningLevel).toBe('high');

    await expect(chat.locator('#sidebar-mode-value')).toHaveText('API');
    await expect(chat.locator('#sidebar-model-value')).toHaveText('openrouter/free');
    await expect(chat.locator('#sidebar-reasoning-value')).toHaveText(saved.reasoningLevel);
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

    // Detaching the selection releases its source-tab identity, so the live
    // read follows the active tab: focus the target tab like a user would
    // before clicking Analyze in the side panel.
    await target.bringToFront();
    await chat.locator('#analyze-button').click();

    await expect(chat.locator('#selected-text-strip')).toBeVisible();
    await expect(chat.locator('#selected-text-snippet')).toHaveText('Hello');
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('shows feedback when Analyze is clicked without selected text', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  const chat = await context.newPage();
  await chat.goto(`chrome-extension://${extensionId}/chat.html`);

  try {
    await chat.locator('#analyze-button').click();

    await expect(chat.locator('.ext-toast.warning')).toBeVisible();
    await expect(chat.locator('.ext-toast.warning')).toContainText('Please select text first');
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('shows immediate feedback when Analyze starts with selected text', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const target = await context.newPage();
  const targetUrl = fixtureUrl(fixtureServer, 'form.html');
  await target.goto(targetUrl);
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  await harness.evaluate((url) => window.pageActionHarness.attachSelectionSource(url), targetUrl);
  const chat = await context.newPage();
  await chat.goto(`chrome-extension://${extensionId}/chat.html`);

  try {
    await expect(chat.locator('#selected-text-strip')).toBeVisible();
    await chat.locator('#analyze-button').click();

    await expect(chat.locator('.ext-toast.info')).toBeVisible();
    await expect(chat.locator('.ext-toast.info')).toContainText('Summary started');
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('keeps the custom prompt list above the open action menu', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  const chat = await context.newPage();
  await chat.goto(`chrome-extension://${extensionId}/chat.html`);

  try {
    await chat.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.local.set(
            {
              instructions: [
                {
                  id: 'custom-prompt-overlap-test',
                  name: 'Customer query',
                  instruction: 'Test prompt',
                },
              ],
            },
            resolve
          )
        )
    );

    await chat.locator('#quick-actions-more').click();
    await chat.locator('#custom-prompts-dropdown').click();

    const promptMenu = chat.locator('#custom-prompts-menu');
    await expect(promptMenu).toBeVisible();
    await expect(promptMenu.locator('.custom-prompt-item')).toHaveText(/Customer query/);

    const promptPaintedOnTop = await chat.evaluate(() => {
      const promptMenuElement = document.querySelector('#custom-prompts-menu');
      const actionMenuElement = document.querySelector('#quick-actions-menu');
      if (!promptMenuElement || !actionMenuElement) return false;

      const promptRect = promptMenuElement.getBoundingClientRect();
      const actionRect = actionMenuElement.getBoundingClientRect();
      const x = Math.max(promptRect.left, actionRect.left) + 8;
      const y = Math.max(promptRect.top, actionRect.top) + 8;
      const paintedElement = document.elementFromPoint(x, y);
      return Boolean(paintedElement?.closest('#custom-prompts-menu'));
    });

    expect(promptPaintedOnTop).toBe(true);
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('shows mode choices above the open action menu', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  const chat = await context.newPage();
  await chat.goto(`chrome-extension://${extensionId}/chat.html`);

  try {
    await chat.locator('#quick-actions-more').click();
    await chat.locator('#analyze-dropdown').click();

    const presetMenu = chat.locator('#preset-menu');
    await expect(presetMenu).toBeVisible();
    await expect(presetMenu.locator('.preset-menu-item')).toHaveText([
      'Summary',
      'TL;DR',
      'Technical',
      'Proofread',
      'Executive',
    ]);

    const presetPaintedOnTop = await chat.evaluate(() => {
      const presetMenuElement = document.querySelector('#preset-menu');
      const actionMenuElement = document.querySelector('#quick-actions-menu');
      if (!presetMenuElement || !actionMenuElement) return false;

      const presetRect = presetMenuElement.getBoundingClientRect();
      const actionRect = actionMenuElement.getBoundingClientRect();
      const x = Math.max(presetRect.left, actionRect.left) + 8;
      const y = Math.max(presetRect.top, actionRect.top) + 8;
      const paintedElement = document.elementFromPoint(x, y);
      return Boolean(paintedElement?.closest('#preset-menu'));
    });

    expect(presetPaintedOnTop).toBe(true);
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});
