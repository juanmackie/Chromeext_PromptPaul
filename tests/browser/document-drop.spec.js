/**
 * @fileoverview Real-browser coverage for document drop attachments. Dropped
 * .txt/.md/.markdown/.csv/.json files attach as bounded text documents in the
 * composer context tray WITHOUT any provider request; the document is sent
 * only when the user sends a prompt, through the structured `document`
 * context. All waits are deterministic (selectors, run-state attributes, and
 * polling) — no fixed sleeps.
 * @module documentDropBrowserSpec
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

/** Maximum document characters mirrored from ChatMedia (200k). */
const MAX_DOCUMENT_CHARS = 200_000;

/**
 * Open the side-panel chat page and wait for deterministic initialization:
 * the composer renders its idle starter actions at the end of chat.js init,
 * after the document drop listener has registered. No fixed sleeps.
 */
async function openChat(context, harness) {
  const extensionId = new URL(harness.url()).hostname;
  const chat = await context.newPage();
  await chat.goto(`chrome-extension://${extensionId}/chat.html`);
  await chat.waitForSelector('#user-input', { timeout: 20000 });
  await chat.waitForFunction(
    () => {
      const row = document.querySelector('#quick-actions-row');
      return Boolean(row && !row.hidden && row.children.length > 0);
    },
    { timeout: 20000 }
  );
  return chat;
}

/**
 * Deliver files to the chat drop handler with a synthetic event that still
 * carries the File objects in `e.dataTransfer.files` (Chromium does not
 * populate `.files` on spread DataTransfer objects for programmatic drops).
 */
function dispatchDocumentDrop(page, files) {
  return page.evaluate(
    (payload) => {
      const files = payload.files.map(({ name, type, text, bytes }) => {
        const content = typeof bytes === 'number' ? new Uint8Array(bytes) : text;
        return new File([content], name, { type });
      });
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files } });
      document.dispatchEvent(event);
    },
    { files }
  );
}

/** Track page-initiated fetch/XHR URLs so tests can assert zero network use. */
async function trackNetworkCalls(context) {
  await context.addInitScript(() => {
    window.__ppNetworkCalls = [];
    const originalFetch = window.fetch && window.fetch.bind(window);
    if (originalFetch) {
      window.fetch = (...args) => {
        const target = args[0];
        window.__ppNetworkCalls.push(String(target && target.url ? target.url : target));
        return originalFetch(...args);
      };
    }
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      window.__ppNetworkCalls.push(String(url));
      return originalOpen.apply(this, arguments);
    };
  });
}

/** Seed a usable API profile pointing at the local fixture server. */
async function seedLocalProfile(chat, endpointUrl) {
  await chat.evaluate((endpoint) => {
    const existing = new Promise((resolve) => {
      chrome.storage.local.get(['profiles'], (result) => resolve(result));
    });
    return existing.then(({ profiles = [] }) => {
      const next = profiles.filter((p) => p.id !== 'doc-drop-e2e');
      next.push({
        id: 'doc-drop-e2e',
        name: 'Doc drop fixture',
        provider: 'api',
        llmEndpoint: endpoint,
        // Fixture-only placeholder; never a real credential.
        apiKey: 'pp-local-fixture-not-a-real-key',
        modelName: 'fixture-model',
      });
      return chrome.storage.local.set({
        profiles: next,
        lastSelectedProfileId: 'doc-drop-e2e',
      });
    });
  }, endpointUrl);
}

/** Latest user message bubble: shows only the composed prompt's first line. */
function lastUserBubble(chat) {
  return chat.locator('.message.user-message').last();
}

/**
 * Read the structured request identity bound to the latest user message: the
 * structured prompt request that a Retry replays and an Edit restores.
 */
async function readLastUserIdentity(chat) {
  return chat.evaluate(() => {
    const messages = document.querySelectorAll('.message.user-message');
    const request = messages[messages.length - 1].requestIdentity;
    return {
      instruction: request.instruction,
      contextType: request.context ? request.context.type : null,
      documentName:
        request.context && request.context.metadata ? request.context.metadata.name : null,
      hasDocumentText:
        Boolean(request.context) &&
        typeof request.context.text === 'string' &&
        request.context.text.length > 0,
    };
  });
}

test('attaches a dropped document to the tray without any network request', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  await trackNetworkCalls(context);
  const chat = await openChat(context, harness);
  fixtureServer.resetMockRequests();
  try {
    const before = await chat.evaluate(() => window.__ppNetworkCalls.length);

    await dispatchDocumentDrop(chat, [
      { name: 'notes.txt', type: 'text/plain', text: 'line one\nline two\nline three' },
    ]);

    // The document attaches as a pending composer tray item with its filename.
    const strip = chat.locator('#document-strip');
    await expect(strip).toBeVisible();
    await expect(chat.locator('#document-title')).toHaveText('notes.txt');
    await expect(chat.locator('#document-details')).toContainText('3 lines');
    await expect(chat.locator('#document-details')).not.toContainText('truncated');
    await expect(chat.locator('#document-remove-button')).toBeVisible();

    // Dropping never starts a provider request: run state stays idle and no
    // page-initiated network call was recorded since before the drop.
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'idle');
    expect(await chat.evaluate(() => window.__ppNetworkCalls.length)).toBe(before);
    expect(await chat.evaluate(() => window.__ppNetworkCalls)).toEqual([]);
    // No background-worker mock request either: dropping only attaches locally,
    // so the service worker must not have issued a provider POST for the drop.
    expect(fixtureServer.mockRequests()).toEqual([]);

    // A pending document counts as attached context: no starter actions.
    await expect(chat.locator('#quick-actions-row')).not.toContainText('Summarize page');
    await expect(chat.locator('#quick-actions-row')).not.toContainText('Ask about page');
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('marks oversized documents as truncated in the tray', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const chat = await openChat(context, harness);
  try {
    await dispatchDocumentDrop(chat, [
      { name: 'big.md', type: 'text/markdown', text: 'x'.repeat(MAX_DOCUMENT_CHARS + 500) },
    ]);
    await expect(chat.locator('#document-strip')).toBeVisible();
    await expect(chat.locator('#document-title')).toHaveText('big.md');
    await expect(chat.locator('#document-details')).toContainText(
      'truncated to fit the context budget'
    );
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('Remove detaches the pending document', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const chat = await openChat(context, harness);
  try {
    await dispatchDocumentDrop(chat, [{ name: 'notes.txt', type: 'text/plain', text: 'hello' }]);
    await expect(chat.locator('#document-strip')).toBeVisible();

    await chat.locator('#document-remove-button').click();
    await expect(chat.locator('#document-strip')).toBeHidden();
    await expect(chat.locator('#context-tray')).toBeHidden();
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('a second document requires an explicit Replace or Keep current choice', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const chat = await openChat(context, harness);
  try {
    await dispatchDocumentDrop(chat, [{ name: 'first.txt', type: 'text/plain', text: 'one' }]);
    await expect(chat.locator('#document-title')).toHaveText('first.txt');

    // Dropping again must not silently replace: show the explicit choice.
    await dispatchDocumentDrop(chat, [{ name: 'second.txt', type: 'text/plain', text: 'two' }]);
    await expect(chat.locator('#document-title')).toHaveText('Replace attached document?');
    await expect(chat.locator('#document-replace-button')).toBeVisible();
    await expect(chat.locator('#document-keep-button')).toBeVisible();

    // Keep current keeps the original attachment.
    await chat.locator('#document-keep-button').click();
    await expect(chat.locator('#document-title')).toHaveText('first.txt');
    await expect(chat.locator('#document-conflict-actions')).toBeHidden();

    // Replace swaps in the newly dropped document.
    await dispatchDocumentDrop(chat, [{ name: 'third.txt', type: 'text/plain', text: 'three' }]);
    await expect(chat.locator('#document-title')).toHaveText('Replace attached document?');
    await chat.locator('#document-replace-button').click();
    await expect(chat.locator('#document-title')).toHaveText('third.txt');
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('multiple-document drops show one single-document limit message', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const chat = await openChat(context, harness);
  try {
    await dispatchDocumentDrop(chat, [
      { name: 'a.txt', type: 'text/plain', text: 'first' },
      { name: 'b.csv', type: 'text/csv', text: 'x,y' },
      { name: 'c.json', type: 'application/json', text: '{}' },
    ]);

    // Exactly one actionable single-document limit message.
    const limits = chat
      .locator('.message.system-message')
      .filter({ hasText: 'Only one document can be attached at a time.' });
    await expect(limits).toHaveCount(1);
    await expect(limits).toContainText('a.txt');
    await expect(limits).toContainText('b.csv');

    // The first document is the attached one.
    await expect(chat.locator('#document-title')).toHaveText('a.txt');
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('invalid and oversized files report errors without attaching', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const chat = await openChat(context, harness);
  try {
    // Unsupported binary with an empty MIME type (typical Windows drop).
    await dispatchDocumentDrop(chat, [{ name: 'app.exe', type: '', text: 'MZ' }]);
    await expect(
      chat.locator('.message.system-message').filter({ hasText: 'Unsupported file type' })
    ).toBeVisible();
    await expect(chat.locator('#document-strip')).toBeHidden();

    // Oversized document beyond the 20 MB ceiling.
    await dispatchDocumentDrop(chat, [
      { name: 'big.csv', type: 'text/csv', bytes: 21 * 1024 * 1024 },
    ]);
    await expect(
      chat.locator('.message.system-message').filter({ hasText: 'max 20 MB' })
    ).toBeVisible();
    await expect(chat.locator('#document-strip')).toBeHidden();
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('sending uses the document context; failure retains it; Retry/Edit keep identity', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const chat = await openChat(context, harness);
  try {
    // The fixture endpoint only serves GETs; the run POST fails fast, which is
    // exactly the deterministic "failed submission" case, credential-free.
    await seedLocalProfile(chat, fixtureUrl(fixtureServer, 'fixture-model'));
    await dispatchDocumentDrop(chat, [
      { name: 'notes.txt', type: 'text/plain', text: 'Diego owns the migration.' },
    ]);
    await expect(chat.locator('#document-strip')).toBeVisible();

    // Send with the document attached.
    await chat.locator('#user-input').fill('Who owns the migration?');
    await chat.locator('#send-button').click();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'error', {
      timeout: 45000,
    });

    // The user bubble shows the typed instruction (display shows the first
    // line), and the bound request identity is the structured document
    // context: metadata name plus bounded text, composed via composeUserPrompt.
    await expect(lastUserBubble(chat)).toContainText('Who owns the migration?');
    expect(await readLastUserIdentity(chat)).toEqual({
      instruction: 'Who owns the migration?',
      contextType: 'document',
      documentName: 'notes.txt',
      hasDocumentText: true,
    });

    // Failed submission retains the pending attachment in the tray.
    await expect(chat.locator('#document-strip')).toBeVisible();
    await expect(chat.locator('#document-title')).toHaveText('notes.txt');

    // Follow-up: the retained document is sent again with the new message.
    await chat.locator('#user-input').fill('And who reviews it?');
    await chat.locator('#send-button').click();
    await expect(chat.locator('.message.user-message')).toHaveCount(2);
    await expect(lastUserBubble(chat)).toContainText('And who reviews it?');
    expect((await readLastUserIdentity(chat)).documentName).toBe('notes.txt');
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'error');

    // Retry replays the ORIGINAL bound request identity (document context
    // included) instead of the current, possibly changed composer context.
    const retryButton = chat
      .locator('.message.llm-message')
      .last()
      .locator('[data-recovery-row] button')
      .filter({ hasText: 'Retry' });
    await expect(retryButton).toBeVisible();
    await retryButton.click();
    await expect(chat.locator('.message.user-message')).toHaveCount(3);
    await expect(lastUserBubble(chat)).toContainText('And who reviews it?');
    expect((await readLastUserIdentity(chat)).documentName).toBe('notes.txt');

    // Edit restores the original document identity: remove the chip first,
    // then Edit must re-attach the originating document alongside the prompt.
    await chat.locator('#document-remove-button').click();
    await expect(chat.locator('#document-strip')).toBeHidden();
    const editButton = chat
      .locator('.message.llm-message')
      .last()
      .locator('[data-recovery-row] button')
      .filter({ hasText: 'Edit' });
    await expect(editButton).toBeVisible();
    await editButton.click();
    await expect(chat.locator('#user-input')).toHaveValue('And who reviews it?');
    await expect(chat.locator('#document-strip')).toBeVisible();
    await expect(chat.locator('#document-title')).toHaveText('notes.txt');
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('sending a pending document with no typed prompt uses the document instruction', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const chat = await openChat(context, harness);
  try {
    await seedLocalProfile(chat, fixtureUrl(fixtureServer, 'fixture-model'));
    await dispatchDocumentDrop(chat, [{ name: 'data.csv', type: 'text/csv', text: 'a,b\n1,2' }]);
    await expect(chat.locator('#document-title')).toHaveText('data.csv');

    // Empty input + pending document: send uses the document instruction.
    await chat.locator('#send-button').click();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'error', {
      timeout: 45000,
    });
    await expect(lastUserBubble(chat)).toContainText('Analyze this attached document.');
    expect(await readLastUserIdentity(chat)).toEqual({
      instruction: 'Analyze this attached document.',
      contextType: 'document',
      documentName: 'data.csv',
      hasDocumentText: true,
    });
    await expect(chat.locator('#document-strip')).toBeVisible();
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('a media drop with a pending document carries both in one run and clears the chip', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-browser-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const chat = await openChat(context, harness);
  try {
    // Success path: the mock-chat endpoint answers with a deterministic SSE
    // stream, so the auto-analyze run completes and the fixture records the
    // request body for wire-level assertions.
    await seedLocalProfile(chat, fixtureUrl(fixtureServer, 'mock-chat'));
    fixtureServer.resetMockRequests();

    // Drop the document first; it attaches as a pending composer item.
    await dispatchDocumentDrop(chat, [
      { name: 'notes.txt', type: 'text/plain', text: 'Diego owns the migration.' },
    ]);
    await expect(chat.locator('#document-title')).toHaveText('notes.txt');

    // Dropping an image auto-analyzes it (existing media pipeline). While a
    // document is pending, that run must carry the document as structured
    // context too, not silently drop it.
    await dispatchDocumentDrop(chat, [{ name: 'pixel.png', type: 'image/png', bytes: 8 }]);
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
      timeout: 45000,
    });

    // Exactly one provider request, and its composed user message contains
    // both the document block and the image part.
    const requests = fixtureServer.mockRequests();
    expect(requests).toHaveLength(1);
    const messages = requests[0].body && requests[0].body.messages;
    expect(messages && Array.isArray(messages)).toBe(true);
    const lastUser = messages[messages.length - 1];
    expect(lastUser.role).toBe('user');
    const textPart = lastUser.content.find((part) => part.type === 'text');
    const imagePart = lastUser.content.find((part) => part.type === 'image_url');
    expect(textPart && textPart.text).toContain('--- Attached document ---');
    expect(textPart.text).toContain('Diego owns the migration.');
    expect(imagePart).toBeTruthy();

    // The document was spent on terminal success: the pending chip is cleared.
    await expect(chat.locator('#document-strip')).toBeHidden();
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});
