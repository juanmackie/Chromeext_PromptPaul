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
    await harness.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.sync.set({ themePreference: 'light', darkTheme: false }, resolve)
        )
    );
    await harness.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.local.set(
            {
              instructions: [
                { id: 'pinned-summarize', name: 'Summarize cleanly', content: 'Summarize this.' },
                { id: 'pinned-proofread', name: 'Proofread text', content: 'Proofread this.' },
                { id: 'pinned-explain', name: 'Explain simply', content: 'Explain this.' },
                { id: 'pinned-formal', name: 'Make formal', content: 'Make this formal.' },
                { id: 'pinned-short', name: 'Shorten text', content: 'Shorten this.' },
              ],
              pinnedQuickActions: [
                'pinned-summarize',
                'pinned-proofread',
                'pinned-explain',
                'pinned-formal',
                'pinned-short',
              ],
            },
            resolve
          )
        )
    );

    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator('#notchEnabledToggle').check();
    await options.locator('#saveNotch').click();
    await expect(options.locator('#notchSaveStatus')).toHaveText('Notch is on.');

    const host = target.locator('[data-prompt-paul-notch-host]');
    await expect(host).toHaveCount(1);
    const notchShell = host.locator('.notch-shell');
    await expect(notchShell).toHaveAttribute('data-theme', 'light');
    await harness.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.sync.set({ themePreference: 'dark', darkTheme: true }, resolve)
        )
    );
    await expect(notchShell).toHaveAttribute('data-theme', 'dark');
    await harness.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.sync.set({ themePreference: 'system', darkTheme: false }, resolve)
        )
    );
    await target.emulateMedia({ colorScheme: 'dark' });
    await expect(notchShell).toHaveAttribute('data-theme', 'dark');
    await target.emulateMedia({ colorScheme: 'light' });
    await expect(notchShell).toHaveAttribute('data-theme', 'light');
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
    // Browser layout may round the rail and panel borders to different
    // subpixels. Keep the alignment contract while allowing a small
    // rendering tolerance.
    expect(Math.abs(railBox.x - panelBox.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(railBox.width - panelBox.width)).toBeLessThanOrEqual(4);
    const fontFamilies = await host
      .locator('.notch-title, .notch-action-label')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fontFamily));
    expect(new Set(fontFamilies).size).toBe(1);
    await expect(host.locator('[data-notch-action="summarizePage"]')).toBeVisible();
    await expect(host.locator('.notch-pinned-section')).toBeVisible();
    await expect(host.locator('.notch-pinned-action')).toHaveCount(4);
    await expect(host.locator('.notch-pinned-action').first()).toContainText('Summarize cleanly');
    await expect(host.locator('.notch-pinned-action').nth(1)).toContainText('Proofread text');
    await expect(host.locator('.notch-pinned-more')).toHaveText('+ 1 more in All actions');
    await expect(host.locator('.notch-dictation-action')).toBeVisible();
    const targetTabId = await harness.evaluate(
      (targetUrl) =>
        new Promise((resolve) =>
          chrome.tabs.query({}, (tabs) =>
            resolve(tabs.find((tab) => tab.url === targetUrl)?.id || null)
          )
        ),
      target.url()
    );
    expect(targetTabId).not.toBeNull();
    await harness.evaluate(
      (tabId) =>
        new Promise((resolve, reject) =>
          chrome.scripting.executeScript(
            {
              target: { tabId },
              world: 'ISOLATED',
              func: () => {
                class MockSpeechRecognition {
                  constructor() {
                    this.onresult = null;
                    this.onerror = null;
                    this.onend = null;
                  }

                  start() {
                    self.__notchMockRecognition = this;
                  }

                  stop() {
                    this.onend?.();
                  }
                }

                self.SpeechRecognition = MockSpeechRecognition;
                self.webkitSpeechRecognition = MockSpeechRecognition;
              },
            },
            (results) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              resolve(results);
            }
          )
        ),
      targetTabId
    );
    await host.locator('.notch-dictation-action').click();
    await target.waitForTimeout(6_000);
    await harness.evaluate(
      (tabId) =>
        new Promise((resolve, reject) =>
          chrome.scripting.executeScript(
            {
              target: { tabId },
              world: 'ISOLATED',
              func: () => {
                const recognition = self.__notchMockRecognition;
                const result = [{ transcript: 'Summarize this page' }];
                result.isFinal = true;
                recognition?.onresult?.({ resultIndex: 0, results: [result] });
                recognition?.onend?.();
              },
            },
            (results) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              resolve(results);
            }
          )
        ),
      targetTabId
    );
    await target.waitForTimeout(500);
    await expect(host.locator('.notch-feedback')).not.toContainText(
      'may only be called in response to a user gesture'
    );
    await expect(host.locator('.notch-panel')).toBeHidden();
    await toggle.click();
    await expect(host.locator('.notch-panel')).toBeVisible();
    const actToggle = host.locator('.notch-act-toggle');
    const actForm = host.locator('.notch-act-form');
    await expect(actToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(actForm).toBeHidden();
    await actToggle.click();
    await expect(actToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(actForm).toBeVisible();
    await actToggle.click();
    await expect(actToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(actForm).toBeHidden();

    await harness.evaluate(
      (tabId) =>
        new Promise((resolve) =>
          chrome.tabs.sendMessage(
            tabId,
            { action: 'notchActRunState', active: true, runId: 'browser-glow-run' },
            () => {
              void chrome.runtime.lastError;
              resolve();
            }
          )
        ),
      targetTabId
    );
    await expect(target.locator('[data-prompt-paul-act-glow]')).toHaveCount(1);
    await expect(notchShell).toHaveAttribute('data-act-running', 'true');
    await harness.evaluate(
      (tabId) =>
        new Promise((resolve) =>
          chrome.tabs.sendMessage(
            tabId,
            { action: 'notchActRunState', active: false, runId: 'browser-glow-run' },
            () => {
              void chrome.runtime.lastError;
              resolve();
            }
          )
        ),
      targetTabId
    );
    await expect(target.locator('[data-prompt-paul-act-glow]')).toHaveCount(0);
    await expect(notchShell).toHaveAttribute('data-act-running', 'false');

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
