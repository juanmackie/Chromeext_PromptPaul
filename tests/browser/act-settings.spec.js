/**
 * @fileoverview Real-browser Act site-policy, redirect and model-warning contracts.
 * @module actSettingsBrowserSpec
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect, test } = require('@playwright/test');
const {
  abortRun,
  launchTestBrowser,
  openHarness,
  removeUserDataDir,
  startAndInspect,
  startFixtureServer,
} = require('./browserTestSupport.js');
let server;
test.beforeAll(async () => {
  server = await startFixtureServer();
});
test.afterAll(async () => {
  await server?.close();
});
const tool = (harness, runId, id, name, args = {}) =>
  harness.evaluate(
    ({ runId, id, name, args }) => window.pageActionHarness.executeTool(runId, id, name, args),
    { runId, id, name, args }
  );

async function showApproval(harness, runId, url) {
  await harness.evaluate(
    async ({ runId, url }) => {
      const { renderPageActionConfirmation } = await import(
        chrome.runtime.getURL('src/chat/ChatPageAutomation.js')
      );
      const area = document.createElement('div');
      document.body.append(area);
      renderPageActionConfirmation(
        area,
        window.pageActionHarness.getConfirmation(runId),
        async (confirmationId, approved, approveAll, allowSite) => {
          const response = await window.pageActionHarness.resolveConfirmation(
            url,
            runId,
            approved,
            approveAll,
            { confirmationId, allowSite }
          );
          if (!response?.success) throw new Error(response?.error || 'Decision failed.');
          return response;
        }
      );
    },
    { runId, url }
  );
}

async function openOptions(context, harness) {
  await expect
    .poll(() =>
      harness.evaluate(
        async () => (await chrome.storage.local.get(['profiles'])).profiles?.length || 0
      )
    )
    .toBeGreaterThan(0);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${new URL(harness.url()).hostname}/options.html`);
  await expect(options.locator('#pageActionSitePolicyForm')).toBeVisible();
  return options;
}

test('precise input stays off by default and saves only after explicit confirmation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-precise-setting-'));
  const { context } = await launchTestBrowser(dir);
  const harness = await openHarness(context);
  try {
    const options = await openOptions(context, harness);
    const toggle = options.locator('#pageActionsPreciseInput');
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(options.locator('#unsaved-banner')).toBeVisible();
    await options.locator('#savePageActions').click();
    await expect(options.locator('#pageActionsSaveStatus')).toContainText('Precise input is on.');
    await expect
      .poll(() =>
        harness.evaluate(
          async () =>
            (await chrome.storage.local.get('pageActionsPreciseInput')).pageActionsPreciseInput
        )
      )
      .toBe(true);
    await options.reload();
    await expect(options.locator('#pageActionsPreciseInput')).toBeChecked();
  } finally {
    await context.close();
    removeUserDataDir(dir);
  }
});

test('site approval persists low-risk trust; Options can block/remove; active runs keep their snapshot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-act-settings-'));
  const { context } = await launchTestBrowser(dir);
  const target = await context.newPage();
  const harness = await openHarness(context);
  const url = server.url('form.html');
  const origin = new URL(url).origin;
  const runs = [];
  try {
    await target.goto(url);
    const { runId, snapshot } = await startAndInspect(harness, url, 'policy');
    runs.push(runId);
    const subject = snapshot.elements.find((entry) => entry.label === 'Subject');
    const firstInput = tool(harness, runId, 'first-input', 'page_input', {
      snapshotId: snapshot.snapshotId,
      index: subject.index,
      text: 'Site-approved subject',
    });
    await expect
      .poll(() => harness.evaluate((id) => window.pageActionHarness.getConfirmation(id), runId))
      .toMatchObject({ siteOrigin: origin });
    await showApproval(harness, runId, url);
    await harness
      .getByRole('button', { name: 'Always allow low-risk actions on this site', exact: true })
      .click();
    expect(await firstInput).toMatchObject({
      result: { actionReceipt: { disposition: 'delivered_verified' } },
    });
    await expect(target.locator('#subject')).toHaveValue('Site-approved subject');
    expect(
      await harness.evaluate(
        async () =>
          (await chrome.storage.local.get(['pageActionSitePolicies'])).pageActionSitePolicies
      )
    ).toEqual({ [origin]: 'allow_low_risk' });
    let state = (await tool(harness, runId, 'fresh-input', 'page_get_state')).result.snapshot;
    const body = state.elements.find((entry) => entry.editable);
    expect(
      (
        await tool(harness, runId, 'trusted-input', 'page_input', {
          snapshotId: state.snapshotId,
          index: body.index,
          text: 'Low-risk site note',
        })
      ).result.actionReceipt.disposition
    ).toBe('delivered_verified');
    await expect(target.locator('#body')).toHaveText('Low-risk site note');
    expect(
      await harness.evaluate((id) => window.pageActionHarness.getConfirmation(id), runId)
    ).toBeNull();

    await target.locator('#continue').evaluate((button) => {
      button.textContent = 'Send';
    });
    state = (await tool(harness, runId, 'fresh-send', 'page_get_state')).result.snapshot;
    const send = state.elements.find((entry) => entry.label === 'Send');
    const highRisk = tool(harness, runId, 'send', 'page_click', {
      snapshotId: state.snapshotId,
      index: send.index,
    });
    await expect
      .poll(() => harness.evaluate((id) => window.pageActionHarness.getConfirmation(id), runId))
      .toMatchObject({ risk: 'high' });
    expect(
      await harness.evaluate(
        ({ id, url }) => window.pageActionHarness.resolveConfirmation(url, id, false),
        { id: runId, url }
      )
    ).toMatchObject({ success: true });
    expect((await highRisk).result.error).toBe('PAGE_ACTION_DENIED');
    await expect(target.locator('#subject')).toHaveValue('Site-approved subject');

    const options = await openOptions(context, harness);
    const list = options.locator('#pageActionSitePoliciesList');
    await expect(list).toContainText(origin);
    await list.getByRole('button', { name: `Block ${origin}`, exact: true }).click();
    await expect(list).toContainText('Blocked');
    const blockedActiveRun = await tool(harness, runId, 'old-policy-read', 'page_get_state');
    expect(blockedActiveRun.result).toMatchObject({ error: 'PAGE_ACTION_SITE_BLOCKED' });
    expect(blockedActiveRun.result.snapshot).toBeUndefined();
    const started = await harness.evaluate((url) => window.pageActionHarness.startRun(url), url);
    runs.push(started.runId);
    const blocked = await tool(harness, started.runId, 'blocked-read', 'page_get_state');
    expect(blocked.result.error).toBe('PAGE_ACTION_SITE_BLOCKED');
    expect(blocked.result.snapshot).toBeUndefined();
    await list.getByRole('button', { name: `Remove ${origin}`, exact: true }).click();
    await expect(list).toContainText('No site policies');
    expect(
      (await tool(harness, started.runId, 'still-blocked', 'page_get_state')).result.error
    ).toBe('PAGE_ACTION_SITE_BLOCKED');
    const fresh = await startAndInspect(harness, url, 'unblocked-new-run');
    runs.push(fresh.runId);
    expect(fresh.snapshot.url).toBe(url);
  } finally {
    for (const id of runs) await abortRun(harness, id);
    await context.close();
    removeUserDataDir(dir);
  }
});

test('terminal progress without a checklist does not claim planner steps resolved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-act-simple-progress-'));
  const { context } = await launchTestBrowser(dir);
  const harness = await openHarness(context);
  try {
    const result = await harness.evaluate(async () => {
      const { updatePageTaskProgress } = await import(
        chrome.runtime.getURL('src/chat/ChatPageAutomation.js')
      );
      const area = document.createElement('div');
      document.body.append(area);
      const card = updatePageTaskProgress(
        area,
        {
          status: 'complete',
          hasPlanner: false,
          taskComplete: true,
          outcome: { status: 'complete', taskComplete: true },
        },
        'simple-read'
      );
      return card.innerText;
    });
    expect(result).toContain('Task complete.');
    expect(result).not.toContain('planner steps');
  } finally {
    await context.close();
    removeUserDataDir(dir);
  }
});

test('Options refuses malformed stored site-policy metadata', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-act-invalid-policy-'));
  const { context } = await launchTestBrowser(dir);
  const harness = await openHarness(context);
  try {
    await harness.evaluate(() =>
      chrome.storage.local.set({ pageActionSitePolicies: { 'not-an-origin': 'unknown' } })
    );
    const options = await openOptions(context, harness);
    await expect(options.locator('#pageActionSitePoliciesList')).toContainText(
      'Site policies could not be loaded'
    );
    await expect(options.locator('#pageActionSitePoliciesList button')).toHaveCount(0);
  } finally {
    await context.close();
    removeUserDataDir(dir);
  }
});

test('a late decision transport failure cannot re-enable an expired approval card', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-act-expired-'));
  const { context } = await launchTestBrowser(dir);
  const harness = await openHarness(context);
  try {
    await harness.evaluate(async () => {
      const module = await import(chrome.runtime.getURL('src/chat/ChatPageAutomation.js'));
      const area = document.createElement('div');
      area.id = 'expired-card';
      document.body.append(area);
      module.renderPageActionConfirmation(
        area,
        {
          confirmationId: 'expired',
          summary: 'Safe local proposal',
          siteOrigin: 'https://fixture.test',
        },
        () =>
          new Promise((resolve, reject) => {
            window.rejectLateDecision = reject;
          })
      );
    });
    await harness.getByRole('button', { name: 'Approve', exact: true }).click();
    await harness.evaluate(async () => {
      const { resolvePageActionConfirmation } = await import(
        chrome.runtime.getURL('src/chat/ChatPageAutomation.js')
      );
      resolvePageActionConfirmation(document.getElementById('expired-card'), {
        confirmationId: 'expired',
        timedOut: true,
      });
      window.rejectLateDecision(new Error('The approval expired.'));
    });
    await expect(harness.locator('#expired-card .page-action-inline-error')).toBeVisible();
    expect(
      await harness
        .locator('#expired-card button')
        .evaluateAll((buttons) => buttons.every((button) => button.disabled))
    ).toBe(true);
  } finally {
    await context.close();
    removeUserDataDir(dir);
  }
});

test('owned-tab redirect stops at the blocked landed origin without returning its content', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-act-redirect-'));
  const { context } = await launchTestBrowser(dir);
  const target = await context.newPage();
  const harness = await openHarness(context);
  let runId;
  try {
    const url = server.url('form.html');
    await target.goto(url);
    const blockedOrigin = new URL(url.replace('127.0.0.1', 'localhost')).origin;
    expect(
      await harness.evaluate(
        ({ origin }) =>
          chrome.runtime.sendMessage({
            action: 'setPageActionSitePolicy',
            origin,
            policy: 'block',
          }),
        { origin: blockedOrigin }
      )
    ).toMatchObject({ success: true });
    ({ runId } = await startAndInspect(harness, url, 'redirect'));
    const result = await tool(harness, runId, 'redirect-open', 'page_open_tab', {
      url: server.url('act-site-redirect'),
    });
    expect(result.result.error).toBe('PAGE_ACTION_SITE_BLOCKED');
    expect(result.result.snapshot).toBeUndefined();
    expect((await tool(harness, runId, 'redirect-followup', 'page_get_state')).result.error).toBe(
      'PAGE_ACTION_SITE_BLOCKED'
    );
  } finally {
    await abortRun(harness, runId);
    await context.close();
    removeUserDataDir(dir);
  }
});

test('Options stores discovered tools metadata and Act distinguishes unsupported, unknown and supported', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-act-model-'));
  const { context } = await launchTestBrowser(dir);
  const harness = await openHarness(context);
  try {
    await expect
      .poll(() =>
        harness.evaluate(
          async () => (await chrome.storage.local.get(['profiles'])).profiles?.length || 0
        )
      )
      .toBeGreaterThan(0);
    await harness.evaluate(
      (endpoint) =>
        chrome.storage.local.set({
          profiles: [
            {
              id: 'model-fixture',
              name: 'Model fixture (simulated)',
              provider: 'api',
              llmEndpoint: endpoint,
              apiKey: 'pp-local-fixture-not-a-real-key',
              modelName: 'fixture-model',
            },
          ],
          lastSelectedProfileId: 'model-fixture',
        }),
      server.url('mock-chat')
    );
    const options = await test.step('Open Options for the local model profile', () =>
      openOptions(context, harness));
    const chat = await context.newPage();
    for (const [model, support] of [
      ['fixture-text-only', false],
      ['fixture-unknown', null],
      ['fixture-model', true],
    ]) {
      await expect(options.locator(`#modelName option[value="${model}"]`)).toHaveCount(1);
      await options.locator('#modelName').selectOption(model);
      await test.step(`Save discovered ${model}`, () => options.locator('#save').click());
      await expect
        .poll(() =>
          harness.evaluate(
            async () => (await chrome.storage.local.get(['profiles'])).profiles[0].modelName
          )
        )
        .toBe(model);
      expect(
        await test.step(`Read ${model} support`, () =>
          harness.evaluate(() => chrome.runtime.sendMessage({ action: 'getActModelSupport' })))
      ).toMatchObject({ success: true, supportsTools: support });
      await harness.evaluate(() => chrome.storage.session.set({ pageActionsEnabled: false }));
      await test.step(`Open chat for ${model}`, () =>
        chat.goto(`chrome-extension://${new URL(harness.url()).hostname}/chat.html`));
      await expect(chat.locator('#page-actions-toggle')).toHaveAttribute('aria-pressed', 'false');
      await chat
        .locator('#quick-actions-row')
        .getByRole('button', { name: 'Act on page', exact: true })
        .click();
      if (support === null)
        await expect(chat.locator('.ext-toast.warning')).toContainText(
          'Tool support for this model is unknown'
        );
      else if (!support)
        await expect(chat.locator('.ext-toast.warning')).toContainText(
          'known not to support tools'
        );
      else
        await expect(chat.locator('.ext-toast.info')).toContainText(
          'Page actions enabled for this browser session'
        );
    }
    expect(server.mockRequests()).toHaveLength(0);
  } finally {
    await context.close();
    removeUserDataDir(dir);
  }
});
