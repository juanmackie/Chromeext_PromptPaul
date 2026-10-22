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
    // Options seeds the starter profile asynchronously on a fresh install.
    // Wait for that write before replacing it with this test profile.
    await expect
      .poll(() =>
        harness.evaluate(async () => {
          const { profiles = [] } = await chrome.storage.local.get('profiles');
          return profiles.some((profile) => profile.id === 'default');
        })
      )
      .toBe(true);
    await harness.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.local.set(
            {
              profiles: [
                {
                  id: 'default',
                  provider: 'api',
                  modelName: 'openrouter/free',
                  reasoningLevel: 'high',
                },
              ],
              lastSelectedProfileId: 'default',
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
    await expect(notchShell.locator('.notch-model-status')).toHaveText(
      'API · openrouter/free · high'
    );
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
    const initialCenter = hostBox.x + hostBox.width / 2;
    // The property under test is horizontal centering, not a fixed width:
    // resolve the expected center from the viewport the browser actually gave us.
    const viewportWidth = target.viewportSize()?.width || (await target.evaluate(() => innerWidth));
    expect(initialCenter).toBeCloseTo(viewportWidth / 2, 0);
    expect(hostBox.y).toBeLessThan(50);

    const rail = host.locator('.notch-rail');
    const dragRailBox = await rail.boundingBox();
    expect(dragRailBox).not.toBeNull();
    await target.mouse.move(
      dragRailBox.x + dragRailBox.width / 2,
      dragRailBox.y + dragRailBox.height / 2
    );
    await target.mouse.down();
    await target.mouse.move(
      dragRailBox.x + dragRailBox.width / 2 + 220,
      dragRailBox.y + dragRailBox.height / 2,
      { steps: 5 }
    );
    await target.mouse.up();
    await expect
      .poll(async () => {
        const box = await host.boundingBox();
        return box ? box.x + box.width / 2 : 0;
      })
      .toBeGreaterThan(initialCenter + 100);
    const storedPosition = await harness.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.local.get('notchPosition', (result) => resolve(result.notchPosition))
        )
    );
    expect(storedPosition).toBeGreaterThan(50);
    await target.reload();
    await expect(host).toHaveCount(1);
    await expect
      .poll(async () => {
        const box = await host.boundingBox();
        return box ? box.x + box.width / 2 : 0;
      })
      .toBeGreaterThan(initialCenter + 100);

    const toggle = host.locator('.notch-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(host.locator('.notch-panel')).toBeVisible();
    // Wait for the actual CSS transition and panel animations to finish before
    // measuring transformed bounding boxes. Keep the alignment tolerance exact.
    await host.locator('.notch-shell').evaluate(async (shell) => {
      await Promise.all(
        shell
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {}))
      );
    });
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

    await harness.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.local.set({ notchEnabled: false }, () =>
            chrome.storage.local.set({ notchEnabled: true }, resolve)
          )
        )
    );
    await expect(host).toHaveCount(1);
    const laterPage = await context.newPage();
    await laterPage.goto(fixtureUrl(fixtureServer, 'form.html'));
    await expect(laterPage.locator('[data-prompt-paul-notch-host]')).toHaveCount(1);

    await harness.evaluate(
      () => new Promise((resolve) => chrome.storage.local.set({ notchEnabled: false }, resolve))
    );
    await expect(host).toHaveCount(0);
    await expect(laterPage.locator('[data-prompt-paul-notch-host]')).toHaveCount(0);
    await laterPage.close();
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('shows Act activity feedback on demand while the notch stays disabled', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-act-feedback-'));
  const { context } = await launchTestBrowser(userDataDir);
  const target = await context.newPage();
  const targetUrl = fixtureUrl(fixtureServer, 'form.html');
  await target.goto(targetUrl);
  const harness = await openHarness(context);
  let runId;

  try {
    expect(await target.locator('[data-prompt-paul-notch-host]').count()).toBe(0);
    const started = await harness.evaluate(
      (url) => window.pageActionHarness.startRun(url, false, { messages: [] }),
      targetUrl
    );
    expect(started.runId).toBeTruthy();
    runId = started.runId;
    const inspected = await harness.evaluate(
      (id) => window.pageActionHarness.executeTool(id, 'feedback-inspect', 'page_get_state', {}),
      runId
    );
    expect(inspected.result?.snapshot).toBeTruthy();

    await harness.evaluate(
      ({ id }) => {
        void window.pageActionHarness.executeTool(id, 'feedback-wait', 'page_wait', {
          condition: 'text',
          text: 'Act feedback sentinel is absent',
          timeoutMs: 1_000,
        });
        return true;
      },
      { id: runId }
    );
    await expect(target.locator('[data-prompt-paul-act-glow]')).toHaveCount(1);
    await expect
      .poll(() =>
        harness.evaluate(({ run, tool }) => window.pageActionHarness.getToolResult(run, tool), {
          run: runId,
          tool: 'feedback-wait',
        })
      )
      .not.toBeNull();
    await expect(target.locator('[data-prompt-paul-act-glow]')).toHaveCount(0);
    await expect(target.locator('[data-prompt-paul-notch-host]')).toHaveCount(0);
  } finally {
    if (runId) await harness.evaluate((id) => window.pageActionHarness.abortRun(id), runId);
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('pins to a vertical edge, drags along it, and reveals details on hover', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-notch-edge-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  const options = await context.newPage();
  const target = await context.newPage();

  try {
    await target.goto(fixtureUrl(fixtureServer, 'form.html'));
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
              profiles: [
                {
                  id: 'default',
                  provider: 'api',
                  modelName: 'openrouter/free',
                  reasoningLevel: 'high',
                },
              ],
              lastSelectedProfileId: 'default',
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
    const shell = host.locator('.notch-shell');
    await expect(shell).toHaveAttribute('data-placement', 'top');

    // Dock the notch to the right edge via Options and reload so it applies.
    await options.locator('#notchPlacementSelect').selectOption('right');
    await options.locator('#saveNotch').click();
    await expect(options.locator('#notchSaveStatus')).toHaveText('Notch is on.');
    await target.reload();
    await expect(host).toHaveCount(1);
    await expect(shell).toHaveAttribute('data-placement', 'right');

    const viewportWidth = await target.evaluate(() => window.innerWidth);
    const hostBox = await host.boundingBox();
    expect(hostBox).not.toBeNull();
    // The vertical pill sits flush to the right edge.
    expect(Math.abs(hostBox.x + hostBox.width - viewportWidth)).toBeLessThanOrEqual(2);

    // Drag downward along the right edge and verify it persists.
    const rail = host.locator('.notch-rail');
    const dragRailBox = await rail.boundingBox();
    const initialCenterY = dragRailBox.y + dragRailBox.height / 2;
    await target.mouse.move(
      dragRailBox.x + dragRailBox.width / 2,
      dragRailBox.y + dragRailBox.height / 2
    );
    await target.mouse.down();
    await target.mouse.move(
      dragRailBox.x + dragRailBox.width / 2,
      dragRailBox.y + dragRailBox.height / 2 + 160,
      { steps: 5 }
    );
    await target.mouse.up();
    await expect
      .poll(async () => {
        const box = await host.boundingBox();
        return box ? box.y + box.height / 2 : 0;
      })
      .toBeGreaterThan(initialCenterY + 80);
    const storedPosition = await harness.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.local.get('notchPosition', (result) => resolve(result.notchPosition))
        )
    );
    expect(storedPosition).toBeGreaterThan(50);

    // Clicking pins the panel open; it extends to the left of the rail.
    const toggle = host.locator('.notch-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(host.locator('.notch-panel')).toBeVisible();
    expect(shell).toHaveAttribute('data-pinned', 'true');
    await target.waitForTimeout(300);
    const railBox = await rail.boundingBox();
    const panelBox = await host.locator('.notch-panel').boundingBox();
    expect(panelBox).not.toBeNull();
    // Panel opens inward, to the left of the right-anchored rail.
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(railBox.x + 2);

    // Leaving while pinned keeps it open.
    await target.mouse.move(viewportWidth - 5, 5);
    await target.waitForTimeout(120);
    await expect(host.locator('.notch-panel')).toBeVisible();

    // Clicking again unpins and collapses.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(host.locator('.notch-panel')).toBeHidden();

    // Hovering the collapsed rail reveals it without pinning.
    await target.mouse.move(5, 5);
    await target.waitForTimeout(120);
    await target.mouse.move(railBox.x + railBox.width / 2, railBox.y + railBox.height / 2 + 40);
    await target.waitForTimeout(220);
    await expect(host.locator('.notch-panel')).toBeVisible();
    expect(shell).toHaveAttribute('data-pinned', 'false');
    // Moving away collapses the hover-revealed panel.
    await target.mouse.move(viewportWidth - 5, 5);
    await target.waitForTimeout(120);
    await expect(host.locator('.notch-panel')).toBeHidden();

    await options.locator('#notchEnabledToggle').uncheck();
    await options.locator('#saveNotch').click();
    await expect(options.locator('#notchSaveStatus')).toHaveText('Notch is off.');
    await expect(host).toHaveCount(0);
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});
