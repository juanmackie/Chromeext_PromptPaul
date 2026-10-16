/**
 * @fileoverview Real-browser coverage for per-section unsaved-state
 * independence on the Options page (P1-04).
 * @module optionsUnsavedBrowserSpec
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect, test } = require('@playwright/test');
const { prepareCodexProfile } = require('../../scripts/act-benchmark.js');
const { launchTestBrowser, openHarness, removeUserDataDir } = require('./browserTestSupport.js');

const blockedBeforeUnloadWarning =
  "Blocked attempt to show a 'beforeunload' confirmation panel for a frame that never had a user gesture since its load.";

async function openOptionsWithProfile(context, harness) {
  const extensionId = new URL(harness.url()).hostname;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const cdp = await context.newCDPSession(page);
  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  await expect
    .poll(
      async () => {
        const { result } = await cdp.send('Runtime.evaluate', {
          expression: `JSON.stringify({
            endpoint: document.querySelector('#llmEndpoint')?.value,
            clean: document.querySelector('#unsaved-banner')?.hidden === true
          })`,
          returnByValue: true,
          userGesture: false,
        });
        return JSON.parse(result.value);
      },
      { timeout: 10_000 }
    )
    .toEqual({ endpoint, clean: true });
  const initialActivation = await cdp.send('Runtime.evaluate', {
    expression: 'navigator.userActivation.hasBeenActive',
    returnByValue: true,
    userGesture: false,
  });
  return { page, cdp, initialActivation: initialActivation.result.value };
}

test('script-generated dirty state reloads without a blocked beforeunload warning', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-options-script-dirty-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  let options;
  let cdp;
  let initialActivation;
  const consoleMessages = [];
  const dialogs = [];

  try {
    ({ page: options, cdp, initialActivation } = await openOptionsWithProfile(context, harness));
    options.on('console', (message) => consoleMessages.push(message.text()));
    options.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });

    // Change the control and notify the dirty tracker without a trusted input
    // event. Use CDP without its userGesture flag because Playwright evaluate
    // grants activation to the target frame.
    expect(initialActivation).toBe(false);
    const { result: activationResult } = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        document.querySelector('#llmEndpoint').value = 'https://script-edited.example.com/v1';
        document.querySelector('#llmEndpoint').dispatchEvent(new Event('input', { bubbles: true }));
        return navigator.userActivation.hasBeenActive;
      })()`,
      returnByValue: true,
      userGesture: false,
    });
    const activation = activationResult.value;
    expect(activation).toBe(false);
    const dirty = await cdp.send('Runtime.evaluate', {
      expression: "!document.querySelector('#unsaved-banner').hidden",
      returnByValue: true,
      userGesture: false,
    });
    expect(dirty.result.value).toBe(true);
    await cdp.send('Runtime.evaluate', {
      expression: 'window.__optionsBeforeUnloadRegressionMarker = true',
      returnByValue: true,
      userGesture: false,
    });

    await options.reload();

    expect(dialogs).toEqual([]);
    expect(
      consoleMessages.filter((message) => message.includes(blockedBeforeUnloadWarning))
    ).toEqual([]);
    const markerAfterReload = await cdp.send('Runtime.evaluate', {
      expression: 'Boolean(window.__optionsBeforeUnloadRegressionMarker)',
      returnByValue: true,
      userGesture: false,
    });
    expect(markerAfterReload.result.value).toBe(false);
    await expect(options.locator('#unsaved-banner')).toBeHidden();
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('trusted edits prompt on reload and honor cancel and accept', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-options-trusted-dirty-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  let options;
  let cdp;

  try {
    ({ page: options, cdp } = await openOptionsWithProfile(context, harness));
    await options.locator('#llmEndpoint').fill('https://trusted-edit.example.com/v1');
    const activated = await cdp.send('Runtime.evaluate', {
      expression: 'navigator.userActivation.hasBeenActive',
      returnByValue: true,
      userGesture: false,
    });
    expect(activated.result.value).toBe(true);
    await expect(options.locator('#unsaved-banner')).toBeVisible();

    const cancelDialogEvent = options.waitForEvent('dialog', { timeout: 5_000 });
    const canceledReload = options.reload().catch((error) => error);
    const cancelDialog = await cancelDialogEvent;
    expect(cancelDialog.type()).toBe('beforeunload');
    await cancelDialog.dismiss();
    // A canceled reload may leave Playwright's navigation promise pending even
    // though the original document remains live; absorb any later rejection.
    void canceledReload;
    await expect(options.locator('#llmEndpoint')).toHaveValue(
      'https://trusted-edit.example.com/v1'
    );
    await expect(options.locator('#unsaved-banner')).toBeVisible();

    const acceptDialogEvent = options.waitForEvent('dialog', { timeout: 5_000 });
    const acceptedReload = options.reload().catch((error) => error);
    const acceptDialog = await acceptDialogEvent;
    expect(acceptDialog.type()).toBe('beforeunload');
    await acceptDialog.accept();
    const acceptedResult = await acceptedReload;
    if (acceptedResult instanceof Error) throw acceptedResult;
    await expect(options.locator('#llmEndpoint')).toHaveValue(
      'https://openrouter.ai/api/v1/chat/completions'
    );
    await expect(options.locator('#unsaved-banner')).toBeHidden();
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('saving a trusted edit clears beforeunload protection', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-options-saved-dirty-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  let options;
  let cdp;
  let dialogCount = 0;

  try {
    ({ page: options, cdp } = await openOptionsWithProfile(context, harness));
    options.on('dialog', (dialog) => {
      dialogCount += 1;
      void dialog.accept();
    });
    await options.locator('#notchEnabledToggle').click();
    const activated = await cdp.send('Runtime.evaluate', {
      expression: 'navigator.userActivation.hasBeenActive',
      returnByValue: true,
      userGesture: false,
    });
    expect(activated.result.value).toBe(true);
    await expect(options.locator('#unsaved-banner')).toBeVisible();

    await options.locator('#saveNotch').click();
    await expect(options.locator('#unsaved-banner')).toBeHidden();
    await options.reload();

    expect(dialogCount).toBe(0);
    await expect(options.locator('#unsaved-banner')).toBeHidden();
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('Codex benchmark setup uses the extension sign-in flow without adding tokens to profiles', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-codex-benchmark-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);

  let modelDiscoveryRequests = 0;
  try {
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (
        url.protocol === 'chrome-extension:' ||
        ['127.0.0.1', 'localhost'].includes(url.hostname)
      ) {
        await route.continue();
      } else {
        await route.abort();
      }
    });
    await context.route('https://auth.openai.com/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/accounts/deviceauth/usercode') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            device_auth_id: 'fake-device',
            user_code: 'TEST-CODE',
            interval: 1,
          }),
        });
      } else if (pathname === '/api/accounts/deviceauth/token') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ authorization_code: 'fake-code', code_verifier: 'fake-verifier' }),
        });
      } else if (pathname === '/oauth/token') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: 'fake-access',
            refresh_token: 'fake-refresh',
            expires_in: 3600,
          }),
        });
      } else {
        await route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>Mock sign-in</title>',
        });
      }
    });
    await context.route('https://chatgpt.com/backend-api/codex/models**', async (route) => {
      modelDiscoveryRequests += 1;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          models: [
            {
              slug: 'codex-luna-2026',
              display_name: 'Luna',
              visibility: 'list',
              supported_reasoning_levels: [{ effort: 'medium', display_name: 'Medium' }],
            },
          ],
        }),
      });
    });

    const model = await prepareCodexProfile({
      context,
      harness,
      modelHint: 'Luna by OpenAI',
      reasoningLevel: 'medium',
    });
    const stored = await harness.evaluate(async (profileId) => {
      const { profiles = [], codexAuthByProfile = {} } = await chrome.storage.local.get([
        'profiles',
        'codexAuthByProfile',
      ]);
      const profile = profiles.find((entry) => entry.id === profileId);
      const auth = codexAuthByProfile[profileId];
      return {
        provider: profile?.provider,
        modelName: profile?.modelName,
        reasoningLevel: profile?.reasoningLevel,
        hasApiKey: Boolean(profile?.apiKey),
        profileHasToken: Boolean(profile?.accessToken || profile?.refreshToken),
        authStoredByExtension: Boolean(auth?.accessToken && auth?.refreshToken),
      };
    }, 'act-benchmark-local');

    expect(model).toMatchObject({ id: 'codex-luna-2026', displayName: 'Luna' });
    expect(modelDiscoveryRequests).toBeGreaterThanOrEqual(1);
    expect(stored).toEqual({
      provider: 'codex',
      modelName: 'codex-luna-2026',
      reasoningLevel: 'medium',
      hasApiKey: false,
      profileHasToken: false,
      authStoredByExtension: true,
    });
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('saving one Options section keeps another section unsaved (P1-04)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-options-unsaved-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  const options = await context.newPage();

  try {
    // Preset representative per-section state. The connection profile has an
    // endpoint but no API key so model discovery takes the offline fallback and
    // never contacts a provider.
    await harness.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.local.set(
            {
              profiles: [
                {
                  id: 'default',
                  name: 'Default',
                  provider: 'api',
                  llmEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
                  modelName: 'openrouter/free',
                  reasoningLevel: 'high',
                },
              ],
              lastSelectedProfileId: 'default',
              analyticsConsent: true,
              braveSearchApiKey: 'synthetic-brave-key',
              notchEnabled: true,
              notchPlacement: 'top',
            },
            resolve
          )
        )
    );

    await options.goto(`chrome-extension://${extensionId}/options.html`);
    // Let every section's async storage load settle and establish its baseline.
    await options.waitForTimeout(1500);

    // Each section loaded its own baseline, so no false-unsaved banner at rest.
    await expect(options.locator('#unsaved-banner')).toBeHidden();

    // Edit only the Top Notch section: flip the toggle and pick another edge.
    await options.locator('#notchEnabledToggle').click();
    await options.locator('#notchPlacementSelect').selectOption('right');
    await expect(options.locator('#unsaved-banner')).toBeVisible();

    // Save only the Privacy section. The unsaved banner must remain because the
    // Notch section is still dirty (per-section tracking, not a global reset).
    await options.locator('#savePrivacy').click();
    await expect(options.locator('#unsaved-banner')).toBeVisible();

    // Now save the Notch section too; everything becomes clean.
    await options.locator('#saveNotch').click();
    await expect(options.locator('#unsaved-banner')).toBeHidden();
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('switching profiles does not silently discard unsaved connection or editor drafts (P2-05)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-draft-guard-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  const options = await context.newPage();

  try {
    await harness.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.local.set(
            {
              profiles: [
                {
                  id: 'default',
                  name: 'Default',
                  provider: 'api',
                  llmEndpoint: 'https://a.example.com/v1',
                  modelName: 'openrouter/free',
                },
                {
                  id: 'alt',
                  name: 'Alt',
                  provider: 'api',
                  llmEndpoint: 'https://b.example.com/v1',
                  modelName: 'openrouter/free',
                },
              ],
              lastSelectedProfileId: 'default',
            },
            resolve
          )
        )
    );
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.waitForTimeout(1500);

    // Edit the connection endpoint for the current profile (dirty draft).
    await options.locator('#llmEndpoint').fill('https://edited.example.com/v1');
    await expect(options.locator('#unsaved-banner')).toBeVisible();

    // The guard asks for confirmation before discarding. Drive it with a
    // persistent handler: the first switch attempt is refused (dismiss), the
    // second is accepted.
    let dialogCount = 0;
    options.on('dialog', (dialog) => {
      dialogCount += 1;
      if (dialogCount === 1) {
        dialog.dismiss(); // refuse to discard
      } else {
        dialog.accept(); // accept the discard and switch
      }
    });

    // Refusing keeps the dropdown on the current profile and preserves the draft.
    await options.locator('#profileSelect').selectOption('alt');
    await options.waitForTimeout(300);
    expect(dialogCount).toBe(1);
    const selectValue = await options.locator('#profileSelect').inputValue();
    expect(selectValue).toBe('default');
    await expect(options.locator('#llmEndpoint')).toHaveValue('https://edited.example.com/v1');

    // A second attempt that accepts the discard does switch.
    await options.locator('#profileSelect').selectOption('alt');
    await expect(options.locator('#llmEndpoint')).toHaveValue('https://b.example.com/v1');
    expect(dialogCount).toBe(2);
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('switching profiles with no edits does not prompt about unsaved changes', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-clean-switch-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  const options = await context.newPage();

  try {
    await harness.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.local.set(
            {
              profiles: [
                {
                  id: 'default',
                  name: 'Default',
                  provider: 'api',
                  llmEndpoint: 'https://a.example.com/v1',
                  modelName: 'openrouter/free',
                },
                {
                  id: 'alt',
                  name: 'Alt',
                  provider: 'api',
                  llmEndpoint: 'https://b.example.com/v1',
                  modelName: 'openrouter/free',
                },
              ],
              lastSelectedProfileId: 'default',
            },
            resolve
          )
        )
    );
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.waitForTimeout(1500);

    // Selecting a profile is the switch itself, not an unsaved draft, so a
    // freshly loaded page must not look dirty.
    await expect(options.locator('#unsaved-banner')).toBeHidden();

    let dialogCount = 0;
    options.on('dialog', (dialog) => {
      dialogCount += 1;
      dialog.accept();
    });

    await options.locator('#profileSelect').selectOption('alt');
    await options.waitForTimeout(300);

    // No discard prompt; the switch applied and nothing is flagged dirty.
    expect(dialogCount).toBe(0);
    await expect(options.locator('#llmEndpoint')).toHaveValue('https://b.example.com/v1');
    await expect(options.locator('#unsaved-banner')).toBeHidden();
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('Improve Instruction routes through the background and leaves the original intact (P2-06)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-improve-guard-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const extensionId = new URL(harness.url()).hostname;
  const options = await context.newPage();

  try {
    // A Codex profile has no OpenAI-shaped chat-completions endpoint, so the
    // background-owned Improve flow must respond with an explicit capability
    // message and must NOT overwrite the instruction editor with a parsed
    // result or a network fetch to a real provider.
    await harness.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.local.set(
            {
              profiles: [
                {
                  id: 'codexprof',
                  name: 'Codex Test',
                  provider: 'codex',
                  modelName: 'gpt-5.1',
                  reasoningLevel: 'high',
                },
              ],
              lastSelectedProfileId: 'codexprof',
              instructions: [
                {
                  id: 'instr-1',
                  name: 'Draft',
                  content: 'tell me a story',
                  tags: [],
                  modalities: [],
                },
              ],
            },
            resolve
          )
        )
    );
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.waitForTimeout(1500);

    // The editor starts untouched/empty.
    await expect(options.locator('#instructionContent')).toHaveValue('');

    // Trigger the Improve flow for the seeded instruction.
    await options.locator('.improve-btn[data-id="instr-1"]').first().click();
    // Let the async background dispatch settle.
    await options.waitForTimeout(1200);

    // The editor must remain untouched (original instruction intact).
    await expect(options.locator('#instructionContent')).toHaveValue('');
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});
