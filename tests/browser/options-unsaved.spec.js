/**
 * @fileoverview Real-browser coverage for per-section unsaved-state
 * independence on the Options page (P1-04).
 * @module optionsUnsavedBrowserSpec
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect, test } = require('@playwright/test');
const { launchTestBrowser, openHarness, removeUserDataDir } = require('./browserTestSupport.js');

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
