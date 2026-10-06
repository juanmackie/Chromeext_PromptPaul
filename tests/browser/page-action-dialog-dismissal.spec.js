/**
 * @fileoverview Real-browser receipt coverage for closing a control's own dialog.
 * @module pageActionDialogDismissalBrowserSpec
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect, test } = require('@playwright/test');
const {
  abortRun,
  fixtureUrl,
  launchTestBrowser,
  openHarness,
  removeUserDataDir,
  startAndInspect,
  startFixtureServer,
} = require('./browserTestSupport.js');

let fixtureServer;

test.beforeAll(async () => {
  fixtureServer = await startFixtureServer();
});

test.afterAll(async () => {
  await fixtureServer?.close();
});

async function openFixtureBrowser() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-dialog-dismissal-'));
  const { context } = await launchTestBrowser(userDataDir);
  try {
    const target = await context.newPage();
    const url = fixtureUrl(fixtureServer, 'links.html');
    await target.goto(url);
    const harness = await openHarness(context);
    return { context, harness, target, url, userDataDir };
  } catch (error) {
    await context.close().catch(() => {});
    removeUserDataDir(userDataDir);
    throw error;
  }
}

async function renderDialogs(target, definitions) {
  await target.evaluate((dialogs) => {
    document.body.replaceChildren();
    window.__dialogDismissClicks = Object.create(null);
    const byId = new Map();
    for (const definition of dialogs) {
      const dialog = document.createElement('section');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', definition.label);
      dialog.dataset.dialogId = definition.id;
      dialog.hidden = definition.hidden === true;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = definition.buttonLabel;
      button.setAttribute('aria-label', definition.buttonLabel);
      button.addEventListener('click', () => {
        window.__dialogDismissClicks[definition.id] =
          (window.__dialogDismissClicks[definition.id] || 0) + 1;
        if (definition.behavior === 'hide-own') dialog.hidden = true;
        if (definition.behavior === 'hide-other') {
          const other = byId.get(definition.otherId);
          if (other) other.hidden = true;
        }
      });
      dialog.append(button);
      document.body.append(dialog);
      byId.set(definition.id, dialog);
    }
  }, definitions);
}

async function clickControl(harness, runId, toolId, snapshot, label) {
  const control = snapshot.elements.find((element) => element.label === label);
  expect(control, `Missing ${label} in the page snapshot`).toBeTruthy();
  return harness.evaluate(
    ({ runId, toolId, snapshotId, index }) =>
      window.pageActionHarness.executeTool(runId, toolId, 'page_click', { snapshotId, index }),
    { runId, toolId, snapshotId: snapshot.snapshotId, index: control.index }
  );
}

test.describe('page action dialog-dismissal receipts', () => {
  test('verifies one click that hides its own visible dialog without an expect', async () => {
    const browser = await openFixtureBrowser();
    const caseUrl = new URL(fixtureUrl(fixtureServer, 'act-benchmark.html'));
    caseUrl.searchParams.set('case', 'modal-dismissal');
    let runId;
    try {
      await browser.target.goto(caseUrl.href);
      await browser.target.evaluate(() => {
        window.__dismissDialogDispatches = 0;
        document.querySelector('[role="dialog"] button').addEventListener(
          'click',
          () => {
            window.__dismissDialogDispatches += 1;
          },
          { capture: true }
        );
      });
      await browser.harness.evaluate(() => window.pageActionHarness.setTrustedMode(true));
      const started = await startAndInspect(browser.harness, caseUrl.href, 'dialog-dismissal');
      runId = started.runId;
      const result = await clickControl(
        browser.harness,
        runId,
        'dialog-dismissal-click',
        started.snapshot,
        'Close dialog'
      );

      expect(result.result.actionReceipt).toMatchObject({
        disposition: 'delivered_verified',
        evidence: { kind: 'dialog_dismissed' },
      });
      expect(await browser.target.locator('[role="dialog"]').isVisible()).toBe(false);
      expect(await browser.target.locator('body').getAttribute('data-dismissed')).toBe('true');
      expect(await browser.target.evaluate(() => window.__dismissDialogDispatches)).toBe(1);

      const { deriveActOutcome } = await import('../../src/orchestrator/ActOutcome.js');
      expect(
        deriveActOutcome(
          {
            status: 'complete',
            resilience: { wrapUp: false },
            pageActions: {
              enabled: true,
              lastBlockReason: null,
              lastActionReceipt: result.result.actionReceipt,
              snapshot: result.result.snapshot,
              planner: null,
            },
          },
          'complete'
        )
      ).toEqual({ status: 'done', reason: null });
    } finally {
      await abortRun(browser.harness, runId);
      await browser.context.close();
      removeUserDataDir(browser.userDataDir);
    }
  });

  test('keeps a failed declared postcondition unverified after the dialog closes', async () => {
    const browser = await openFixtureBrowser();
    let runId;
    try {
      await renderDialogs(browser.target, [
        { id: 'own', label: 'Notice', buttonLabel: 'Close dialog', behavior: 'hide-own' },
      ]);
      await browser.harness.evaluate(() => window.pageActionHarness.setTrustedMode(true));
      const started = await startAndInspect(browser.harness, browser.url, 'dialog-failed-expect');
      runId = started.runId;
      const control = started.snapshot.elements.find((element) => element.label === 'Close dialog');
      expect(control).toBeTruthy();
      const result = await browser.harness.evaluate(
        ({ runId, snapshotId, index }) =>
          window.pageActionHarness.executeTool(runId, 'dialog-failed-expect-click', 'page_click', {
            snapshotId,
            index,
            expect: { type: 'text_appears', text: 'NEVER_PRESENT_EXPECTATION_TOKEN' },
          }),
        { runId, snapshotId: started.snapshot.snapshotId, index: control.index }
      );

      expect(result.result.actionReceipt).toMatchObject({
        disposition: 'delivered_unverified',
        evidence: { kind: 'declared_postcondition', matched: false },
      });
      expect(await browser.target.locator('[data-dialog-id="own"]').isVisible()).toBe(false);
      expect(await browser.target.evaluate(() => window.__dialogDismissClicks.own)).toBe(1);
    } finally {
      await abortRun(browser.harness, runId);
      await browser.context.close();
      removeUserDataDir(browser.userDataDir);
    }
  });

  test('does not report dismissal when the clicked dialog stays visible', async () => {
    const browser = await openFixtureBrowser();
    let runId;
    try {
      await renderDialogs(browser.target, [
        { id: 'own', label: 'Notice', buttonLabel: 'No-op button', behavior: 'unchanged' },
      ]);
      await browser.target.locator('button').focus();
      await browser.harness.evaluate(() => window.pageActionHarness.setTrustedMode(true));
      const started = await startAndInspect(browser.harness, browser.url, 'dialog-unchanged');
      runId = started.runId;
      const result = await clickControl(
        browser.harness,
        runId,
        'dialog-unchanged-click',
        started.snapshot,
        'No-op button'
      );

      expect(result.result.actionReceipt?.evidence?.kind).not.toBe('dialog_dismissed');
      expect(await browser.target.locator('[data-dialog-id="own"]').isVisible()).toBe(true);
      expect(await browser.target.evaluate(() => window.__dialogDismissClicks.own)).toBe(1);
    } finally {
      await abortRun(browser.harness, runId);
      await browser.context.close();
      removeUserDataDir(browser.userDataDir);
    }
  });

  test('does not report an initially hidden dialog as dismissed', async () => {
    const browser = await openFixtureBrowser();
    let runId;
    try {
      await renderDialogs(browser.target, [
        { id: 'hidden', label: 'Hidden notice', buttonLabel: 'Close hidden dialog', hidden: true },
      ]);
      await browser.harness.evaluate(() => window.pageActionHarness.setTrustedMode(true));
      const started = await startAndInspect(browser.harness, browser.url, 'dialog-hidden');
      runId = started.runId;
      expect(
        started.snapshot.elements.some((element) => element.label === 'Close hidden dialog')
      ).toBe(false);
      const result = await browser.harness.evaluate(
        ({ runId, snapshotId }) =>
          window.pageActionHarness.executeTool(runId, 'dialog-hidden-click', 'page_click', {
            snapshotId,
            index: 0,
          }),
        { runId, snapshotId: started.snapshot.snapshotId }
      );

      expect(result.result.error).toBe('PAGE_STATE_STALE');
      expect(result.result.actionReceipt?.evidence?.kind).not.toBe('dialog_dismissed');
      expect(await browser.target.locator('[data-dialog-id="hidden"]').isVisible()).toBe(false);
      expect(await browser.target.evaluate(() => window.__dialogDismissClicks.hidden || 0)).toBe(0);
    } finally {
      await abortRun(browser.harness, runId);
      await browser.context.close();
      removeUserDataDir(browser.userDataDir);
    }
  });

  test('does not report dismissal when a click hides a different dialog', async () => {
    const browser = await openFixtureBrowser();
    let runId;
    try {
      await renderDialogs(browser.target, [
        {
          id: 'owner',
          label: 'Owner dialog',
          buttonLabel: 'Close other dialog',
          behavior: 'hide-other',
          otherId: 'other',
        },
        { id: 'other', label: 'Other dialog', buttonLabel: 'Other action' },
      ]);
      await browser.harness.evaluate(() => window.pageActionHarness.setTrustedMode(true));
      const started = await startAndInspect(browser.harness, browser.url, 'dialog-unrelated');
      runId = started.runId;
      const result = await clickControl(
        browser.harness,
        runId,
        'dialog-unrelated-click',
        started.snapshot,
        'Close other dialog'
      );

      expect(result.result.actionReceipt?.evidence?.kind).not.toBe('dialog_dismissed');
      expect(await browser.target.locator('[data-dialog-id="owner"]').isVisible()).toBe(true);
      expect(await browser.target.locator('[data-dialog-id="other"]').isVisible()).toBe(false);
      expect(await browser.target.evaluate(() => window.__dialogDismissClicks.owner)).toBe(1);
    } finally {
      await abortRun(browser.harness, runId);
      await browser.context.close();
      removeUserDataDir(browser.userDataDir);
    }
  });

  test('stale state does not dispatch a dismissal click', async () => {
    const browser = await openFixtureBrowser();
    let runId;
    try {
      await renderDialogs(browser.target, [
        { id: 'own', label: 'Notice', buttonLabel: 'Close dialog', behavior: 'hide-own' },
      ]);
      await browser.harness.evaluate(() => window.pageActionHarness.setTrustedMode(true));
      const started = await startAndInspect(browser.harness, browser.url, 'dialog-stale');
      runId = started.runId;
      const close = started.snapshot.elements.find((element) => element.label === 'Close dialog');
      expect(close).toBeTruthy();
      await browser.harness.evaluate(
        (id) =>
          window.pageActionHarness.executeTool(id, 'dialog-stale-refresh', 'page_get_state', {}),
        runId
      );
      const result = await browser.harness.evaluate(
        ({ runId, snapshotId, index }) =>
          window.pageActionHarness.executeTool(runId, 'dialog-stale-click', 'page_click', {
            snapshotId,
            index,
          }),
        { runId, snapshotId: started.snapshot.snapshotId, index: close.index }
      );

      expect(result.result.error).toBe('PAGE_STATE_STALE');
      expect(result.result.actionReceipt).toMatchObject({
        disposition: 'not_delivered',
        evidence: { kind: 'stale_snapshot' },
      });
      expect(await browser.target.locator('[data-dialog-id="own"]').isVisible()).toBe(true);
      expect(await browser.target.evaluate(() => window.__dialogDismissClicks.own || 0)).toBe(0);
    } finally {
      await abortRun(browser.harness, runId);
      await browser.context.close();
      removeUserDataDir(browser.userDataDir);
    }
  });

  test('a denied high-risk click leaves its dialog visible and undispatched', async () => {
    const browser = await openFixtureBrowser();
    let runId;
    try {
      await renderDialogs(browser.target, [
        {
          id: 'own',
          label: 'Sensitive action',
          buttonLabel: 'Delete record',
          behavior: 'hide-own',
        },
      ]);
      await browser.harness.evaluate(() => window.pageActionHarness.setTrustedMode(true));
      const started = await startAndInspect(browser.harness, browser.url, 'dialog-denied');
      runId = started.runId;
      const control = started.snapshot.elements.find(
        (element) => element.label === 'Delete record'
      );
      expect(control).toBeTruthy();
      await browser.harness.evaluate(
        ({ runId, snapshotId, index }) => {
          void window.pageActionHarness.executeTool(runId, 'dialog-denied-click', 'page_click', {
            snapshotId,
            index,
          });
          return true;
        },
        { runId, snapshotId: started.snapshot.snapshotId, index: control.index }
      );
      await expect
        .poll(() =>
          browser.harness.evaluate((id) => window.pageActionHarness.getConfirmation(id), runId)
        )
        .toMatchObject({ action: 'page_click' });
      await browser.harness.evaluate(
        ({ url, runId }) => window.pageActionHarness.resolveConfirmation(url, runId, false),
        { url: browser.url, runId }
      );
      await expect
        .poll(() =>
          browser.harness.evaluate(
            (args) => window.pageActionHarness.getToolResult(args.runId, args.toolId),
            {
              runId,
              toolId: 'dialog-denied-click',
            }
          )
        )
        .toMatchObject({ result: { error: 'PAGE_ACTION_DENIED' } });
      const result = await browser.harness.evaluate(
        (args) => window.pageActionHarness.getToolResult(args.runId, args.toolId),
        { runId, toolId: 'dialog-denied-click' }
      );

      expect(result.result.actionReceipt).toBeUndefined();
      expect(await browser.target.locator('[data-dialog-id="own"]').isVisible()).toBe(true);
      expect(await browser.target.evaluate(() => window.__dialogDismissClicks.own || 0)).toBe(0);
    } finally {
      await abortRun(browser.harness, runId);
      await browser.context.close();
      removeUserDataDir(browser.userDataDir);
    }
  });

  test('blocks a repeated unverified click and never calls it a dismissal', async () => {
    const browser = await openFixtureBrowser();
    let runId;
    try {
      await renderDialogs(browser.target, [
        { id: 'own', label: 'Notice', buttonLabel: 'No-op button', behavior: 'unchanged' },
      ]);
      await browser.target.locator('button').focus();
      await browser.harness.evaluate(() => window.pageActionHarness.setTrustedMode(true));
      const started = await startAndInspect(browser.harness, browser.url, 'dialog-retry');
      runId = started.runId;
      const first = await clickControl(
        browser.harness,
        runId,
        'dialog-retry-first',
        started.snapshot,
        'No-op button'
      );
      expect(first.result.actionReceipt).toMatchObject({ disposition: 'delivered_unverified' });
      expect(first.result.actionReceipt.evidence.kind).not.toBe('dialog_dismissed');

      const second = await browser.harness.evaluate(
        ({ runId, snapshotId, index }) =>
          window.pageActionHarness.executeTool(runId, 'dialog-retry-second', 'page_click', {
            snapshotId,
            index,
          }),
        {
          runId,
          snapshotId: first.result.snapshot.snapshotId,
          index: started.snapshot.elements.find((element) => element.label === 'No-op button')
            .index,
        }
      );
      expect(second.result.error).toBe('PAGE_ACTION_UNVERIFIED_RETRY_BLOCKED');
      expect(await browser.target.locator('[data-dialog-id="own"]').isVisible()).toBe(true);
      expect(await browser.target.evaluate(() => window.__dialogDismissClicks.own)).toBe(1);
    } finally {
      await abortRun(browser.harness, runId);
      await browser.context.close();
      removeUserDataDir(browser.userDataDir);
    }
  });
});
