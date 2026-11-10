/**
 * @fileoverview Real-browser approval sequencing and reconnect/checkpoint
 * recovery coverage. Approval decisions must bind to the current confirmation,
 * run, owner token, and source tab; approved harmless input executes exactly
 * once with a verified receipt backed by the local fixture's actual value;
 * denial, timeout, and Stop leave the page unchanged. Recovery coverage uses
 * deterministic initialization: startup renders the existing reconnect
 * controls, Watch adopts the active run without starting another, checkpoint
 * Resume requires an explicit user action and never replays automatically, and
 * a run that completes during reconnect produces no duplicate output.
 * @module approvalRecoveryBrowserSpec
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
  startFixtureServer,
} = require('./browserTestSupport.js');

let fixtureServer;

test.beforeAll(async () => {
  fixtureServer = await startFixtureServer();
});

test.afterAll(async () => {
  await fixtureServer?.close();
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const APPROVED_BODY_TEXT = 'Approved browser draft text.';

/** Open the side-panel chat page and wait for its composer. */
async function openChat(context, harness) {
  const extensionId = new URL(harness.url()).hostname;
  const chat = await context.newPage();
  await chat.goto(`chrome-extension://${extensionId}/chat.html`);
  await chat.waitForSelector('#user-input', { timeout: 20000 });
  // Deterministic readiness: the composer renders its idle starter actions at
  // the end of chat.js init, after run-recovery and drop listeners register.
  // No fixed sleep.
  await chat.waitForFunction(
    () => {
      const row = document.querySelector('#quick-actions-row');
      return Boolean(row && !row.hidden && row.children.length > 0);
    },
    { timeout: 20000 }
  );
  return chat;
}

/** Seed a usable API profile pointing at the local mock chat endpoint. */
async function seedMockProfile(harness, endpointUrl, profileId = 'approval-fixture') {
  await harness.evaluate(
    ({ profileId, endpoint }) =>
      chrome.storage.local.get(['profiles']).then(({ profiles = [] }) => {
        const next = profiles.filter((entry) => entry.id !== profileId);
        next.push({
          id: profileId,
          name: 'Approval fixture',
          provider: 'api',
          llmEndpoint: endpoint,
          // Fixture-only placeholder; never a real credential.
          apiKey: 'pp-local-fixture-not-a-real-key',
          modelName: 'fixture-model',
        });
        return chrome.storage.local.set({
          profiles: next,
          lastSelectedProfileId: profileId,
        });
      }),
    { profileId, endpoint: endpointUrl }
  );
}

/**
 * Start an Act run and take the first bounded snapshot.
 * With `planner`, the run carries a multi-step user message. Planning is
 * model-maintained and does not grant consent; tests create the checklist explicitly.
 */
async function startInspectedRun(harness, targetUrl, { planner = false } = {}) {
  const started = await harness.evaluate(
    ({ url, planner }) =>
      window.pageActionHarness.startRun(url, planner, {
        messages: planner
          ? [
              {
                role: 'user',
                content:
                  '1. Inspect the form\n2. Fill the message body\n3. Continue the workflow\n4. Verify the completed result',
              },
            ]
          : [],
      }),
    { url: targetUrl, planner }
  );
  expect(started.runId, JSON.stringify(started)).toBeTruthy();
  const state = await harness.evaluate(
    ({ id }) =>
      window.pageActionHarness.executeTool(id, `approval-recovery-state`, 'page_get_state', {}),
    { id: started.runId }
  );
  expect(state.error, JSON.stringify(state)).toBeUndefined();
  expect(state.result?.snapshot, JSON.stringify(state)).toBeTruthy();
  return { runId: started.runId, snapshot: state.result.snapshot };
}

/**
 * Fire a gated `page_input` and wait for its confirmation without resolving
 * it. The executeTool evaluate is fire-and-forget: its message channel stays
 * open until the tool completes, which requires the approval decision below,
 * so awaiting it here would deadlock against the confirmation timeout and
 * auto-deny the action. The stored tool result (`getToolResult`) carries the
 * outcome once the decision lands.
 */
async function fireGatedInput(harness, { runId, snapshotId, index, toolCallId, text }) {
  await harness.evaluate(
    ({ runId, snapshotId, index, toolCallId, text }) => {
      void window.pageActionHarness.executeTool(runId, toolCallId, 'page_input', {
        snapshotId,
        index,
        text,
      });
      return true;
    },
    { runId, snapshotId, index, toolCallId, text }
  );
  await expect
    .poll(() => harness.evaluate((id) => window.pageActionHarness.getConfirmation(id), runId))
    .toMatchObject({ action: 'page_input', confirmationId: expect.any(String) });
}

// ---------------------------------------------------------------------------
// Approval decisions bind to confirmation, run, owner token, and source tab
// ---------------------------------------------------------------------------

test('approved harmless input executes exactly once with a verified receipt backed by the fixture value', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const target = await context.newPage();
  const targetUrl = fixtureUrl(fixtureServer, 'form.html');
  await target.goto(targetUrl);
  const harness = await openHarness(context);
  let runId;

  try {
    const inspected = await startInspectedRun(harness, targetUrl);
    runId = inspected.runId;
    const body = inspected.snapshot.elements.find((element) => element.editable === true);
    expect(body, 'message body should be indexed').toBeTruthy();

    await fireGatedInput(harness, {
      runId,
      snapshotId: inspected.snapshot.snapshotId,
      index: body.index,
      toolCallId: 'bind-body-input',
      text: APPROVED_BODY_TEXT,
    });
    const confirmation = await harness.evaluate(
      (id) => window.pageActionHarness.getConfirmation(id),
      runId
    );
    expect(confirmation.confirmationId, JSON.stringify(confirmation)).toBeTruthy();

    // Decisions that do not bind to the current run/token/source tab are
    // rejected WITHOUT consuming the confirmation or executing the action.
    const wrongToken = await harness.evaluate(
      ({ url, id }) =>
        window.pageActionHarness.resolveConfirmation(url, id, true, false, {
          ownerToken: 'not-the-owner-token',
        }),
      { url: targetUrl, id: runId }
    );
    expect(wrongToken.success, JSON.stringify(wrongToken)).toBe(false);
    const wrongTab = await harness.evaluate(
      ({ url, id }) =>
        window.pageActionHarness.resolveConfirmation(url, id, true, false, {
          sourceTabId: 999999,
        }),
      { url: targetUrl, id: runId }
    );
    expect(wrongTab.success, JSON.stringify(wrongTab)).toBe(false);
    const staleConfirmation = await harness.evaluate(
      ({ url, id }) =>
        window.pageActionHarness.resolveConfirmation(url, id, true, false, {
          confirmationId: 'confirm-stale',
        }),
      { url: targetUrl, id: runId }
    );
    expect(staleConfirmation.success, JSON.stringify(staleConfirmation)).toBe(false);
    await expect(target.locator('#body')).not.toContainText(APPROVED_BODY_TEXT);
    expect(
      await harness.evaluate((id) => window.pageActionHarness.getConfirmation(id), runId)
    ).toMatchObject({ confirmationId: confirmation.confirmationId });

    // The correctly bound decision is acknowledged and executes exactly once.
    const decision = await harness.evaluate(
      ({ url, id }) => window.pageActionHarness.resolveConfirmation(url, id, true, false),
      { url: targetUrl, id: runId }
    );
    expect(decision, JSON.stringify(decision)).toMatchObject({ success: true });
    await expect
      .poll(() =>
        harness.evaluate(
          ({ id }) => window.pageActionHarness.getToolResult(id, 'bind-body-input'),
          { id: runId }
        )
      )
      .toMatchObject({
        result: {
          actionReceipt: {
            disposition: 'delivered_verified',
            evidence: { kind: 'input_value_match', matched: true },
          },
        },
      });

    // The receipt is backed by the fixture's actual value, written once.
    await expect(target.locator('#body')).toContainText(APPROVED_BODY_TEXT);
    expect((await target.locator('#body').innerText()).split(APPROVED_BODY_TEXT).length - 1).toBe(
      1
    );

    // A replayed decision on the consumed confirmation is rejected.
    const replay = await harness.evaluate(
      ({ url, id }) => window.pageActionHarness.resolveConfirmation(url, id, true, false),
      { url: targetUrl, id: runId }
    );
    expect(replay.success, JSON.stringify(replay)).toBe(false);
    expect((await target.locator('#body').innerText()).split(APPROVED_BODY_TEXT).length - 1).toBe(
      1
    );
  } finally {
    await abortRun(harness, runId);
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('denial leaves the page unchanged and the run can act again after a new approval', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const target = await context.newPage();
  const targetUrl = fixtureUrl(fixtureServer, 'form.html');
  await target.goto(targetUrl);
  const harness = await openHarness(context);
  let runId;

  try {
    const inspected = await startInspectedRun(harness, targetUrl);
    runId = inspected.runId;
    const body = inspected.snapshot.elements.find((element) => element.editable === true);
    expect(body).toBeTruthy();

    await fireGatedInput(harness, {
      runId,
      snapshotId: inspected.snapshot.snapshotId,
      index: body.index,
      toolCallId: 'deny-body-input',
      text: APPROVED_BODY_TEXT,
    });
    const denied = await harness.evaluate(
      ({ url, id }) => window.pageActionHarness.resolveConfirmation(url, id, false, false),
      { url: targetUrl, id: runId }
    );
    expect(denied, JSON.stringify(denied)).toMatchObject({ success: true });
    await expect
      .poll(() =>
        harness.evaluate(
          ({ id }) => window.pageActionHarness.getToolResult(id, 'deny-body-input'),
          { id: runId }
        )
      )
      .toMatchObject({
        result: { error: 'PAGE_ACTION_DENIED', message: 'The user denied this page action.' },
      });

    // The page is unchanged and the consumed confirmation cannot be replayed.
    await expect(target.locator('#body')).not.toContainText(APPROVED_BODY_TEXT);
    expect(
      await harness.evaluate((id) => window.pageActionHarness.getConfirmation(id), runId)
    ).toBe(null);
    const replay = await harness.evaluate(
      ({ url, id }) => window.pageActionHarness.resolveConfirmation(url, id, false, false),
      { url: targetUrl, id: runId }
    );
    expect(replay.success, JSON.stringify(replay)).toBe(false);

    // Denial blocks only that action: a fresh approval round executes once.
    await fireGatedInput(harness, {
      runId,
      snapshotId: inspected.snapshot.snapshotId,
      index: body.index,
      toolCallId: 'deny-body-input-second',
      text: APPROVED_BODY_TEXT,
    });
    const approved = await harness.evaluate(
      ({ url, id }) => window.pageActionHarness.resolveConfirmation(url, id, true, false),
      { url: targetUrl, id: runId }
    );
    expect(approved, JSON.stringify(approved)).toMatchObject({ success: true });
    await expect
      .poll(() =>
        harness.evaluate(
          ({ id }) => window.pageActionHarness.getToolResult(id, 'deny-body-input-second'),
          { id: runId }
        )
      )
      .toMatchObject({ result: { actionReceipt: { disposition: 'delivered_verified' } } });
    await expect(target.locator('#body')).toContainText(APPROVED_BODY_TEXT);
  } finally {
    await abortRun(harness, runId);
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('confirmation timeout denies the action without delivery and records the timeout decision', async () => {
  test.setTimeout(45_000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const target = await context.newPage();
  const targetUrl = fixtureUrl(fixtureServer, 'form.html');
  await target.goto(targetUrl);
  const harness = await openHarness(context);
  let runId;

  try {
    const started = await harness.evaluate(
      ({ url }) =>
        window.pageActionHarness.startRun(url, false, {
          pageActionConfirmationTimeoutMs: 1_000,
          messages: [],
        }),
      { url: targetUrl }
    );
    expect(started.runId, JSON.stringify(started)).toBeTruthy();
    runId = started.runId;
    const state = await harness.evaluate(
      ({ id }) => window.pageActionHarness.executeTool(id, 'timeout-state', 'page_get_state', {}),
      { id: runId }
    );
    const body = state.result.snapshot.elements.find((element) => element.editable === true);
    expect(body).toBeTruthy();

    await fireGatedInput(harness, {
      runId,
      snapshotId: state.result.snapshot.snapshotId,
      index: body.index,
      toolCallId: 'timeout-body-input',
      text: APPROVED_BODY_TEXT,
    });
    // No decision is sent; the bounded confirmation timeout denies the action.
    await expect
      .poll(() =>
        harness.evaluate(
          ({ id }) => window.pageActionHarness.getToolResult(id, 'timeout-body-input'),
          { id: runId }
        )
      )
      .toMatchObject({ result: { error: 'PAGE_ACTION_DENIED' } });
    await expect(target.locator('#body')).not.toContainText(APPROVED_BODY_TEXT);

    const journal = await harness.evaluate((id) => window.pageActionHarness.getJournal(id), runId);
    expect(journal.success, JSON.stringify(journal)).toBe(true);
    const timeoutDecision = (journal.journal?.events || [])
      .filter((event) => event.type === 'page_action_decision')
      .pop();
    expect(timeoutDecision, JSON.stringify(journal.journal?.events)).toMatchObject({
      approved: false,
      timedOut: true,
    });

    // The timed-out confirmation is consumed: a later decision is rejected.
    const late = await harness.evaluate(
      ({ url, id }) => window.pageActionHarness.resolveConfirmation(url, id, true, false),
      { url: targetUrl, id: runId }
    );
    expect(late.success, JSON.stringify(late)).toBe(false);
    await expect(target.locator('#body')).not.toContainText(APPROVED_BODY_TEXT);
  } finally {
    await abortRun(harness, runId);
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('Stop during a pending approval aborts the run without delivering the action', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const target = await context.newPage();
  const targetUrl = fixtureUrl(fixtureServer, 'form.html');
  await target.goto(targetUrl);
  const harness = await openHarness(context);
  let runId;

  try {
    const inspected = await startInspectedRun(harness, targetUrl);
    runId = inspected.runId;
    const body = inspected.snapshot.elements.find((element) => element.editable === true);
    expect(body).toBeTruthy();

    await fireGatedInput(harness, {
      runId,
      snapshotId: inspected.snapshot.snapshotId,
      index: body.index,
      toolCallId: 'stop-body-input',
      text: APPROVED_BODY_TEXT,
    });
    const stopped = await harness.evaluate((id) => window.pageActionHarness.abortRun(id), runId);
    expect(stopped.error, JSON.stringify(stopped)).toBeUndefined();
    await expect
      .poll(() =>
        harness.evaluate(
          ({ id }) => window.pageActionHarness.getToolResult(id, 'stop-body-input'),
          { id: runId }
        )
      )
      .toMatchObject({ error: expect.stringMatching(/abort/i) });
    await expect(target.locator('#body')).not.toContainText(APPROVED_BODY_TEXT);

    // The aborted run no longer accepts decisions on its confirmation.
    const lateDecision = await harness.evaluate(
      ({ url, id }) => window.pageActionHarness.resolveConfirmation(url, id, true, false),
      { url: targetUrl, id: runId }
    );
    expect(lateDecision.success, JSON.stringify(lateDecision)).toBe(false);
    await expect(target.locator('#body')).not.toContainText(APPROVED_BODY_TEXT);
  } finally {
    await abortRun(harness, runId);
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('model planning never enables consent and run approval never covers Send', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const target = await context.newPage();
  const targetUrl = fixtureUrl(fixtureServer, 'form.html');
  await target.goto(targetUrl);
  const harness = await openHarness(context);
  let runId;

  try {
    await target.locator('#continue').evaluate((button) => {
      button.textContent = 'Send';
    });
    const inspected = await startInspectedRun(harness, targetUrl, { planner: true });
    runId = inspected.runId;
    const planned = await harness.evaluate(
      (id) =>
        window.pageActionHarness.executeTool(id, 'model-plan', 'page_update_plan', {
          steps: [
            { description: 'Fill body', status: 'in_progress' },
            { description: 'Fill subject', status: 'pending' },
            { description: 'Review sending', status: 'pending' },
          ],
        }),
      runId
    );
    expect(planned.result.updated).toBe(true);
    const body = inspected.snapshot.elements.find((element) => element.editable === true);
    const subject = inspected.snapshot.elements.find((element) => element.label === 'Subject');
    const continueButton = inspected.snapshot.elements.find((element) => element.label === 'Send');
    expect(body).toBeTruthy();
    expect(subject).toBeTruthy();
    expect(continueButton).toBeTruthy();

    // A single approval covers this decision only, independently of the checklist.
    await fireGatedInput(harness, {
      runId,
      snapshotId: inspected.snapshot.snapshotId,
      index: body.index,
      toolCallId: 'planner-body-input',
      text: APPROVED_BODY_TEXT,
    });
    const plannerConfirmation = await harness.evaluate(
      (id) => window.pageActionHarness.getConfirmation(id),
      runId
    );
    const decision = await harness.evaluate(
      ({ url, id }) => window.pageActionHarness.resolveConfirmation(url, id, true, false),
      { url: targetUrl, id: runId }
    );
    expect(decision, JSON.stringify(decision)).toMatchObject({ success: true });
    await expect
      .poll(() =>
        harness.evaluate(
          ({ id }) => window.pageActionHarness.getToolResult(id, 'planner-body-input'),
          { id: runId }
        )
      )
      .toMatchObject({ result: { actionReceipt: { disposition: 'delivered_verified' } } });
    await expect(target.locator('#body')).toContainText(APPROVED_BODY_TEXT);

    // A checklist never grants approval. The next low-risk input still asks,
    // and its target must come from the latest observation.
    const nextState = await harness.evaluate(
      ({ id }) => window.pageActionHarness.executeTool(id, 'planner-state-2', 'page_get_state', {}),
      { id: runId }
    );
    expect(nextState.error, JSON.stringify(nextState)).toBeUndefined();
    const nextSnapshot = nextState.result.snapshot;
    const nextSubject = nextSnapshot.elements.find((element) => element.label === 'Subject');
    const nextContinue = nextSnapshot.elements.find((element) => element.label === 'Send');
    expect(nextSubject, JSON.stringify(nextSnapshot)).toBeTruthy();
    expect(nextContinue, JSON.stringify(nextSnapshot)).toBeTruthy();
    await fireGatedInput(harness, {
      runId,
      snapshotId: nextSnapshot.snapshotId,
      index: nextSubject.index,
      toolCallId: 'planner-subject-input',
      text: 'Explicitly approved subject',
    });
    await expect
      .poll(() => harness.evaluate((id) => window.pageActionHarness.getConfirmation(id), runId))
      .toMatchObject({ action: 'page_input' });
    expect(
      await harness.evaluate(
        ({ url, id }) => window.pageActionHarness.resolveConfirmation(url, id, true, true),
        { url: targetUrl, id: runId }
      )
    ).toMatchObject({ success: true });
    await expect
      .poll(() =>
        harness.evaluate(
          ({ id }) => window.pageActionHarness.getToolResult(id, 'planner-subject-input'),
          { id: runId }
        )
      )
      .toMatchObject({ result: { actionReceipt: { disposition: 'delivered_verified' } } });
    await expect(target.locator('#subject')).toHaveValue('Explicitly approved subject');
    expect(
      await harness.evaluate((id) => window.pageActionHarness.getConfirmation(id), runId)
    ).toBe(null);

    // Explicit similar-action approval cannot cover high-risk Send. It needs
    // a new, separately bound confirmation after fresh inspection.
    const navState = await harness.evaluate(
      ({ id }) => window.pageActionHarness.executeTool(id, 'planner-state-3', 'page_get_state', {}),
      { id: runId }
    );
    expect(navState.error, JSON.stringify(navState)).toBeUndefined();
    const navSnapshot = navState.result.snapshot;
    const navContinue = navSnapshot.elements.find((element) => element.label === 'Send');
    expect(navContinue, JSON.stringify(navSnapshot)).toBeTruthy();
    const navigation = harness.evaluate(
      ({ runId, snapshotId, index, toolCallId }) =>
        window.pageActionHarness.executeTool(runId, toolCallId, 'page_click', {
          snapshotId,
          index,
        }),
      {
        runId,
        snapshotId: navSnapshot.snapshotId,
        index: navContinue.index,
        toolCallId: 'planner-continue-click',
      }
    );
    await expect
      .poll(() => harness.evaluate((id) => window.pageActionHarness.getConfirmation(id), runId))
      .toMatchObject({ action: 'page_click' });
    const navigationConfirmation = await harness.evaluate(
      (id) => window.pageActionHarness.getConfirmation(id),
      runId
    );
    expect(navigationConfirmation.confirmationId).not.toBe(plannerConfirmation.confirmationId);

    // Denying the navigation click leaves the page unchanged.
    const denied = await harness.evaluate(
      ({ url, id }) => window.pageActionHarness.resolveConfirmation(url, id, false, false),
      { url: targetUrl, id: runId }
    );
    expect(denied, JSON.stringify(denied)).toMatchObject({ success: true });
    await expect(navigation).resolves.toMatchObject({
      result: { error: 'PAGE_ACTION_DENIED' },
    });
    await expect(target.locator('#subject')).toHaveValue('Explicitly approved subject');
  } finally {
    await abortRun(harness, runId);
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

// ---------------------------------------------------------------------------
// Reconnect and checkpoint recovery
// ---------------------------------------------------------------------------

test('startup renders reconnect controls and Watch adopts the active run without starting another', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  let chat;

  try {
    await seedMockProfile(harness, `${fixtureUrl(fixtureServer, 'mock-chat')}?hold=1`);
    fixtureServer.resetMockRequests();
    chat = await openChat(context, harness);
    await chat.locator('#user-input').fill('Watch me while the run is held open.');
    await chat.locator('#send-button').click();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'streaming');
    await expect.poll(() => fixtureServer.mockRequests().length).toBe(1);

    // Reconnect: startup reaches recovery loading and renders the EXISTING
    // controls (composer, send, clear) next to the reconnect notice.
    await chat.reload();
    await expect(chat.locator('[data-run-recovery]')).toContainText('Run reconnect available');
    const watch = chat.locator('[data-run-recovery] button', { hasText: 'Watch run' });
    await expect(watch).toBeVisible();
    await expect(chat.locator('#user-input')).toBeVisible();
    await expect(chat.locator('#send-button')).toBeEnabled();
    await expect(chat.locator('#clear-button')).toBeVisible();

    // Watching must not start another provider request.
    await watch.click();
    await expect(chat.locator('[data-run-recovery]')).toHaveCount(0);
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'streaming');
    await expect(chat.locator('#send-button')).toBeDisabled();
    expect(fixtureServer.mockRequests()).toHaveLength(1);

    // The adopted run completes in the SAME bubble, exactly once.
    fixtureServer.releaseMockChat();
    await expect(
      chat.locator('.message.llm-message .llm-content-area', {
        hasText: 'Mock provider reply',
      })
    ).toHaveCount(1);
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete');
    await expect(chat.locator('#send-button')).toBeEnabled();
    expect(fixtureServer.mockRequests()).toHaveLength(1);
  } finally {
    await chat?.close().catch(() => {});
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('a stale terminal event cannot finalize a live run or release its guard', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  let chat;

  try {
    await seedMockProfile(harness, `${fixtureUrl(fixtureServer, 'mock-chat')}?hold=1`);
    fixtureServer.resetMockRequests();
    chat = await openChat(context, harness);
    await chat.locator('#user-input').fill('Keep this run alive while a stale terminal arrives.');
    await chat.locator('#send-button').click();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'streaming');
    await expect.poll(() => fixtureServer.mockRequests().length).toBe(1);

    // A terminal for an older run must not settle the live bubble or release
    // the live run's in-process guard. The harness is a separate extension
    // page, so chat.js receives this through its normal runtime listener.
    await harness.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              action: 'orchestratorEvent',
              runId: 'stale-run-before-the-current-one',
              sourceTabId: null,
              event: { type: 'complete', content: 'STALE TERMINAL FROM AN OLDER RUN' },
            },
            resolve
          );
        })
    );

    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'streaming');
    await expect(chat.locator('#user-input')).toBeDisabled();
    await expect(
      chat.locator('.message.llm-message .llm-content-area', { hasText: 'STALE TERMINAL' })
    ).toHaveCount(0);

    // The live run still owns its bubble and completes normally, with no
    // second provider request and no duplicate output.
    fixtureServer.releaseMockChat();
    await expect(
      chat.locator('.message.llm-message .llm-content-area', {
        hasText: 'Mock provider reply',
      })
    ).toHaveCount(1);
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete');
    await expect(chat.locator('#user-input')).toBeEnabled();
    expect(fixtureServer.mockRequests()).toHaveLength(1);
  } finally {
    await chat?.close().catch(() => {});
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('a run completing during reconnect produces no duplicate output and no stale controls', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  let chat;

  try {
    await seedMockProfile(harness, `${fixtureUrl(fixtureServer, 'mock-chat')}?hold=1`);
    fixtureServer.resetMockRequests();
    chat = await openChat(context, harness);
    await chat.locator('#user-input').fill('Finish while the panel is reconnecting.');
    await chat.locator('#send-button').click();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'streaming');

    await chat.reload();
    await expect(chat.locator('[data-run-recovery]')).toContainText('Run reconnect available');

    // The run reaches its terminal state while the fresh panel still shows
    // the reconnect notice.
    fixtureServer.releaseMockChat();
    const runId = await chat.evaluate(async () => {
      const result = await chrome.storage.session.get(['promptPaulActiveRunV1']);
      return result?.promptPaulActiveRunV1?.runId || null;
    });
    expect(runId).toBeTruthy();
    await expect
      .poll(async () => {
        const journal = await harness.evaluate(
          (id) => window.pageActionHarness.getJournal(id),
          runId
        );
        return journal.active === false;
      })
      .toBe(true);

    // The stale Watch control is inert: no new run, no output, no state change.
    const staleWatch = chat.locator('[data-run-recovery] button', { hasText: 'Watch run' });
    await expect(staleWatch).toBeVisible();
    await staleWatch.click();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'idle');
    await expect(chat.locator('.message.llm-message')).toHaveCount(0);
    await expect(chat.locator('[data-run-recovery]')).toBeVisible();

    // Reloading restores the terminal run once with no duplicate bubble and
    // clears the reconnect pointer.
    await chat.reload();
    await expect(chat.locator('[data-run-recovery]')).toHaveCount(0);
    await expect(
      chat.locator('.message.llm-message .llm-content-area', { hasText: 'Mock provider reply' })
    ).toHaveCount(1);
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'idle');
    await expect(chat.locator('#send-button')).toBeEnabled();
    const pointer = await chat.evaluate(() =>
      chrome.storage.session.get(['promptPaulActiveRunV1'])
    );
    expect(pointer.promptPaulActiveRunV1).toBeUndefined();
  } finally {
    await chat?.close().catch(() => {});
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('checkpoint Resume requires an explicit user action and a fresh inspection, never an automatic replay', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const target = await context.newPage();
  const targetUrl = fixtureUrl(fixtureServer, 'form.html');
  await target.goto(targetUrl);
  const harness = await openHarness(context);
  let chat;

  try {
    const sourceTab = await harness.evaluate(
      (url) => window.pageActionHarness.findTab(url),
      targetUrl
    );
    expect(sourceTab?.id, 'fixture tab should be found').toBeTruthy();
    await seedMockProfile(harness, fixtureUrl(fixtureServer, 'mock-chat'), 'default');
    await harness.evaluate(
      ({ tabId }) =>
        chrome.storage.session.set({
          promptPaulActCheckpointsV1: [
            {
              runId: 'approval-recovery-checkpoint',
              sourceTabId: tabId,
              targetTabId: tabId,
              profileId: 'default',
              provider: 'api',
              instruction: 'Fill the message body with the approved draft.',
              actionName: 'page_input',
              toolCallId: 'checkpoint-input',
              actionHash: 'hash-approval-recovery',
              snapshotId: 'snapshot-approval-recovery',
              status: 'in_flight',
              savedAt: Date.now(),
              budgets: { observation: 4, navigation: 2, mutation: 2 },
              planner: null,
            },
          ],
        }),
      { tabId: sourceTab.id }
    );

    chat = await openChat(context, harness);
    const recovery = chat.locator('[data-run-recovery]');
    await expect(recovery).toContainText('Interrupted Act task available');
    const resume = recovery.locator('button', { hasText: 'Resume Act' });
    await expect(resume).toBeVisible();
    await expect(recovery).toContainText('will not repeat it automatically');

    // Loading the panel never resumes automatically: the run state stays idle,
    // the fixture is untouched, and the checkpoint is preserved.
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'idle');
    // Loading the panel never resumes automatically: no event exists for an
    // auto-resume to await, so this is a sanctioned bounded absence window
    // (the sole fixed-wait exception in the browser suite).
    await chat.waitForTimeout(1_500);
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'idle');
    await expect(chat.locator('.message.llm-message')).toHaveCount(0);
    await expect(target.locator('#body')).not.toContainText(APPROVED_BODY_TEXT);
    let checkpoints = await chat.evaluate(() =>
      chrome.storage.session.get(['promptPaulActCheckpointsV1'])
    );
    expect(
      (checkpoints.promptPaulActCheckpointsV1 || []).filter((entry) => entry.status === 'in_flight')
    ).toHaveLength(1);

    // Explicit Resume starts a fresh owned run. The interrupted mutation is
    // not replayed: the model must inspect the page before any mutation, and
    // the held mock reply completes the run without touching the fixture.
    fixtureServer.resetMockRequests();
    await resume.click();
    await expect(
      chat.locator('.message.user-message').filter({ hasText: 'Fill the message body' })
    ).toHaveCount(1);
    await expect(
      chat.locator('.message.llm-message .llm-content-area', { hasText: 'Mock provider reply' })
    ).toHaveCount(1);
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete');
    await expect(target.locator('#body')).not.toContainText(APPROVED_BODY_TEXT);

    // Resume clears stale state and executes a fresh inspection before the
    // provider request. The matching synthetic pair replaces named tool choice;
    // the interrupted mutation is never replayed.
    expect(fixtureServer.mockRequests()).toHaveLength(1);
    const resumedBody = fixtureServer.mockRequests()[0].body;
    expect(resumedBody.tool_choice).toBe('auto');
    const initialCall = resumedBody.messages.find((message) => message.tool_calls)?.tool_calls[0];
    const observation = resumedBody.messages.find((message) => message.role === 'tool');
    expect(initialCall.function.name).toBe('page_get_state');
    expect(observation.tool_call_id).toBe(initialCall.id);
    expect(JSON.parse(observation.content).result.snapshot.snapshotId).not.toBe(
      'snapshot-approval-recovery'
    );
    expect(JSON.parse(observation.content).result.snapshot.url).toBe(targetUrl);

    checkpoints = await chat.evaluate(() =>
      chrome.storage.session.get(['promptPaulActCheckpointsV1'])
    );
    expect(
      (checkpoints.promptPaulActCheckpointsV1 || []).filter((entry) =>
        ['in_flight', 'uncertain_delivery'].includes(entry.status)
      )
    ).toHaveLength(0);
    const pointer = await chat.evaluate(() =>
      chrome.storage.session.get(['promptPaulActiveRunV1'])
    );
    expect(pointer.promptPaulActiveRunV1).toBeUndefined();

    // The resumed run settled through its own entry point. Its in-process run
    // guard must be released too, or every later send is rejected as "A
    // response is already in progress" until the panel reloads.
    fixtureServer.resetMockRequests();
    await chat.locator('#user-input').fill('A plain follow-up after the resumed run.');
    await chat.locator('#send-button').click();
    await expect.poll(() => fixtureServer.mockRequests().length, { timeout: 20_000 }).toBe(1);
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete');
  } finally {
    await chat?.close().catch(() => {});
    await context.close();
    removeUserDataDir(userDataDir);
  }
});
