/**
 * @fileoverview Real-browser coverage for the explicit read-only answer-card
 * composer actions, provider wire boundary, safe fallback and narrow layout.
 * Uses a local simulated API endpoint and local page fixture only.
 * @module answerCardsBrowserSpec
 */

const fs = require('fs');
const http = require('http');
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

const CHAT_PATH = '/v1/chat/completions';
let fixtureServer;
let answerServer;

function sseDelta(content, index) {
  return `data: ${JSON.stringify({
    id: `chatcmpl-answer-${index}`,
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fixture-model',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`;
}

function sseDone(index) {
  return `data: ${JSON.stringify({
    id: `chatcmpl-answer-${index}`,
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fixture-model',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })}\n\ndata: [DONE]\n\n`;
}

function startAnswerServer() {
  const state = {
    requests: [],
    reply: 'Fixture response.',
    chunks: null,
    holdAfterChunks: new Set(),
    release: null,
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'fixture-model', supported_parameters: [] }] }));
      return;
    }
    if (request.method !== 'POST' || url.pathname !== CHAT_PATH) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) request.destroy();
    });
    request.on('end', async () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch (_) {
        response.writeHead(400);
        response.end();
        return;
      }
      // Keep only local, bounded fixture payloads. Authorization values are
      // intentionally neither read nor persisted by this mock server.
      state.requests.push({ body, authorizationPresent: Boolean(request.headers.authorization) });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunks = state.chunks || [state.reply];
      for (let index = 0; index < chunks.length; index += 1) {
        if (response.destroyed) return;
        response.write(sseDelta(chunks[index], index));
        if (state.holdAfterChunks.has(index + 1)) {
          state.holdAfterChunks.delete(index + 1);
          await new Promise((resolve) => {
            state.release = resolve;
          });
          state.release = null;
        }
      }
      if (!response.destroyed) {
        response.end(sseDone(chunks.length));
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        endpoint: `http://127.0.0.1:${port}${CHAT_PATH}`,
        reset(reply, chunks = null) {
          state.requests = [];
          state.reply = reply;
          state.chunks = chunks;
          state.holdAfterChunks.clear();
          state.release?.();
        },
        setReply(reply, chunks = null) {
          state.reply = reply;
          state.chunks = chunks;
          state.holdAfterChunks.clear();
          state.release?.();
        },
        holdAfter(...chunkCounts) {
          state.holdAfterChunks = new Set(chunkCounts);
        },
        release() {
          state.release?.();
        },
        requests() {
          return state.requests.slice();
        },
        close() {
          state.release?.();
          return new Promise((done) => server.close(done));
        },
      });
    });
  });
}

async function openChat(context, harness) {
  const extensionId = new URL(harness.url()).hostname;
  const chat = await context.newPage();
  await chat.goto(`chrome-extension://${extensionId}/chat.html`);
  await chat.waitForSelector('#user-input', { timeout: 20000 });
  await chat.waitForFunction(() => {
    const row = document.querySelector('#quick-actions-row');
    return Boolean(row && row.children.length > 0);
  });
  return chat;
}

async function seedMockProfile(chat) {
  await chat.evaluate((endpoint) => {
    return new Promise((resolve) => {
      chrome.storage.local.get(['profiles'], ({ profiles = [] }) => {
        const next = profiles.filter((profile) => profile.id !== 'answer-cards-fixture');
        next.push({
          id: 'answer-cards-fixture',
          name: 'Answer cards fixture',
          provider: 'api',
          llmEndpoint: endpoint,
          apiKey: 'pp-local-fixture-not-a-real-key',
          modelName: 'fixture-model',
        });
        chrome.storage.local.set(
          { profiles: next, lastSelectedProfileId: 'answer-cards-fixture' },
          resolve
        );
      });
    });
  }, answerServer.endpoint);
}

async function attachArticle(chat) {
  const article = await chat.context().newPage();
  await article.goto(fixtureUrl(fixtureServer, 'article.html'));
  await article.bringToFront();
  await chat.locator('#add-page-button').click();
  await expect(chat.locator('.loaded-content-container')).toBeVisible();
  return article;
}

async function runCardAction(chat, label) {
  const rowAction = chat.locator('#quick-actions-row button').filter({ hasText: label });
  if (await rowAction.count()) {
    await rowAction.first().click();
    return;
  }
  await chat.locator('#quick-actions-more').click();
  await chat
    .locator('#quick-actions-menu')
    .getByRole('button', { name: label, exact: true })
    .click();
}

function lastUserContent(request) {
  const messages = request.body.messages;
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  if (typeof lastUser?.content === 'string') return lastUser.content;
  return (lastUser?.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

async function setCurrentTabZoom(chat, zoomFactor) {
  return chat.evaluate((factor) => {
    return new Promise((resolve, reject) => {
      chrome.tabs.getCurrent((tab) => {
        if (!tab?.id) {
          reject(new Error('The extension page has no current browser tab.'));
          return;
        }
        chrome.tabs.setZoom(tab.id, factor, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          chrome.tabs.getZoom(tab.id, (currentZoom) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(currentZoom);
          });
        });
      });
    });
  }, zoomFactor);
}

async function preparePageChat() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-paul-answer-cards-'));
  const { context } = await launchTestBrowser(userDataDir);
  const harness = await openHarness(context);
  const chat = await openChat(context, harness);
  // First-run Options profile creation is asynchronous; wait before replacing it.
  await expect
    .poll(() =>
      chat.evaluate(async () => {
        const { profiles = [] } = await chrome.storage.local.get('profiles');
        return profiles.some((profile) => profile.id === 'default');
      })
    )
    .toBe(true);
  await seedMockProfile(chat);
  await expect(chat.locator('#sidebar-model-value')).toHaveText('fixture-model');
  const article = await attachArticle(chat);
  return { userDataDir, context, harness, chat, article };
}

async function installClipboardCapture(chat) {
  await chat.evaluate(() => {
    window.__answerClipboard = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__answerClipboard = { plain: String(text) };
        },
        write: async (items) => {
          const item = items[0];
          const plain = await item.getType('text/plain').then((blob) => blob.text());
          const html = await item.getType('text/html').then((blob) => blob.text());
          window.__answerClipboard = { plain, html };
        },
      },
    });
  });
}

async function captureAnswerCardEvents(chat) {
  await chat.evaluate(() => {
    window.__answerCardEvents = [];
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action !== 'orchestratorEvent') return;
      const event = request.event;
      if (event?.type !== 'answer_cards') return;
      window.__answerCardEvents.push({
        answerTurn: event.answerTurn,
        blockCount: event.answerCards?.blocks?.length || 0,
        invalid: event.invalid === true,
        sourceTabId: request.sourceTabId ?? null,
      });
    });
  });
}

async function expectAnswerCopy(chat, expectedText) {
  await chat.getByRole('button', { name: 'Copy As Raw text' }).last().click();
  await expect
    .poll(() => chat.evaluate(() => window.__answerClipboard?.plain || ''))
    .toContain(expectedText);
  await expect
    .poll(() => chat.evaluate(() => window.__answerClipboard?.plain || ''))
    .not.toContain('promptpaul-cards');

  await chat.evaluate(() => {
    window.__answerClipboard = null;
  });
  await chat.getByRole('button', { name: 'Copy As Formatted Text' }).last().click();
  await expect
    .poll(() => chat.evaluate(() => window.__answerClipboard?.html || ''))
    .toContain(expectedText);
  const copied = await chat.evaluate(() => window.__answerClipboard);
  expect(copied.html).toContain(expectedText);
  expect(copied.html).not.toContain('answer-cards');
  expect(copied.html).not.toContain('promptpaul-cards');
  expect(copied.html.match(new RegExp(expectedText, 'g')) || []).toHaveLength(1);
}

test.beforeAll(async () => {
  fixtureServer = await startFixtureServer();
  answerServer = await startAnswerServer();
});

test.afterAll(async () => {
  await answerServer?.close();
  await fixtureServer?.close();
});

test('composer summary action sends attached page once and renders summary, key values and comparison cards', async () => {
  const reply = [
    'The page describes grid storage and deployment choices.',
    '```promptpaul-cards',
    JSON.stringify({
      version: 1,
      blocks: [
        {
          type: 'summary',
          title: 'Grid storage',
          text: 'Storage balances variable renewable output.',
          points: ['Stores surplus energy', 'Supports grid resilience'],
        },
        {
          type: 'key_values',
          title: 'Key findings',
          items: [
            { label: 'Primary benefit', value: 'Resilience' },
            { label: 'Main constraint', value: 'Duration' },
          ],
        },
        {
          type: 'comparison',
          title: 'Options',
          columns: ['Attribute', 'Battery', 'Pumped hydro'],
          rows: [
            ['Response', 'Fast', 'Steady'],
            ['Siting', 'Flexible', 'Geography dependent'],
          ],
        },
      ],
    }),
    '```',
  ].join('\n');
  answerServer.reset(reply);
  const { userDataDir, context, chat } = await preparePageChat();
  try {
    await installClipboardCapture(chat);
    await runCardAction(chat, 'Summary cards');
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
      timeout: 45000,
    });
    await expect(chat.locator('.llm-message').last().locator('[data-inline-stop]')).toHaveCount(0);

    const cards = chat.locator('.answer-cards');
    await expect(cards).toBeVisible();
    await expect(cards.locator('.answer-card--summary')).toContainText('Grid storage');
    await expect(cards.locator('.answer-card--key_values')).toContainText('Resilience');
    await expect(cards.locator('.answer-card--comparison table')).toContainText('Pumped hydro');
    await expect(chat.locator('.answer-text-fallback')).toContainText(
      'The page describes grid storage'
    );
    await expect(chat.locator('.llm-content-area')).not.toContainText('promptpaul-cards');
    await expectAnswerCopy(chat, 'The page describes grid storage');

    const requests = answerServer.requests();
    expect(requests).toHaveLength(1);
    const content = lastUserContent(requests[0]);
    expect(content).toContain('Energy storage');
    expect(content.match(/Energy storage is therefore the linchpin/g) || []).toHaveLength(1);
    expect(
      requests[0].body.messages.some((message) => message.content?.includes?.('promptpaul-cards'))
    ).toBe(true);
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('empty card blocks retain readable fallback and raw/formatted copy', async () => {
  answerServer.reset(
    `Readable fallback survives empty cards.\n\`\`\`promptpaul-cards\n${JSON.stringify({
      version: 1,
      blocks: [],
    })}\n\`\`\``
  );
  const { userDataDir, context, chat } = await preparePageChat();
  try {
    await installClipboardCapture(chat);
    await runCardAction(chat, 'Summary cards');
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
      timeout: 45000,
    });
    await expect(chat.locator('.answer-cards')).toHaveCount(0);
    await expect(chat.locator('.llm-content-area').last()).toContainText(
      'Readable fallback survives empty cards.'
    );
    await expectAnswerCopy(chat, 'Readable fallback survives empty cards.');
    expect(answerServer.requests()).toHaveLength(1);
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('comparison card is keyboard reachable and stays within narrow light, dark, and system layouts', async () => {
  answerServer.reset(
    [
      'Battery and pumped hydro suit different sites.',
      '```promptpaul-cards',
      JSON.stringify({
        version: 1,
        blocks: [
          {
            type: 'comparison',
            title: 'Storage options',
            columns: ['Feature', 'Battery', 'Pumped hydro'],
            rows: [['Setup', 'Modular', 'Site specific']],
          },
        ],
      }),
      '```',
    ].join('\n')
  );
  const { userDataDir, context, chat } = await preparePageChat();
  const pageErrors = [];
  const consoleErrors = [];
  chat.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 300)));
  chat.on('console', (message) => {
    if (message.type() === 'error' && consoleErrors.length < 5) {
      consoleErrors.push(message.text().slice(0, 300));
    }
  });
  try {
    try {
      await runCardAction(chat, 'Compare cards');
      await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
        timeout: 45000,
      });
    } catch (error) {
      const status = await chat.evaluate(async () => {
        const storage = await new Promise((resolve) => {
          chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], resolve);
        });
        const profile = (storage.profiles || []).find(
          (candidate) => candidate.id === storage.lastSelectedProfileId
        );
        return {
          runState: document.querySelector('#input-area')?.dataset.runState || null,
          selectedProfileId: storage.lastSelectedProfileId || null,
          profile: profile
            ? { id: profile.id, provider: profile.provider, modelName: profile.modelName }
            : null,
          visibleModel: document.querySelector('#sidebar-model-value')?.textContent || null,
          systemMessages: Array.from(document.querySelectorAll('.system-message'))
            .slice(-4)
            .map((node) => node.textContent.slice(0, 300)),
        };
      });
      console.error(
        'answer-card-run-diagnostics',
        JSON.stringify({
          status,
          pageErrors: pageErrors.slice(-4),
          consoleErrors,
          requestCount: answerServer.requests().length,
        })
      );
      throw error;
    }
    const region = chat.locator('.answer-card-table-scroll');
    await expect(region).toBeVisible();
    await chat.bringToFront();
    await region.focus();
    await expect(region).toBeFocused();

    for (const width of [320, 400, 600]) {
      await chat.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark', 'system']) {
        await chat.locator('html').evaluate((element, value) => {
          element.dataset.theme = value;
        }, theme);
        const bounds = await region.boundingBox();
        expect(bounds).toBeTruthy();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
        await expect(region).toBeFocused();
      }
    }
    await chat.emulateMedia({ reducedMotion: 'reduce' });
    await chat.setViewportSize({ width: 320, height: 900 });
    expect(await setCurrentTabZoom(chat, 2)).toBe(2);
    expect(
      await chat.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    ).toBe(true);
    expect(await chat.evaluate(() => window.matchMedia('(max-width: 380px)').matches)).toBe(true);
    const zoomedBounds = await region.boundingBox();
    expect(zoomedBounds).toBeTruthy();
    expect(zoomedBounds.x).toBeGreaterThanOrEqual(0);
    await chat.getByRole('searchbox', { name: 'Filter comparison rows' }).focus();
    await expect(chat.getByRole('searchbox', { name: 'Filter comparison rows' })).toBeFocused();
    const sortButton = chat.getByRole('button', { name: 'Sort by Feature' });
    await expect(sortButton).toBeVisible();
    await sortButton.focus();
    await expect(sortButton).toBeFocused();
    await chat.keyboard.press('Enter');
    await expect(chat.locator('.answer-card-comparison th').first()).toHaveAttribute(
      'aria-sort',
      'ascending'
    );
    await expect(region).toBeAttached();
    expect(await setCurrentTabZoom(chat, 1)).toBe(1);
    await chat.emulateMedia({ reducedMotion: 'no-preference' });
    expect(answerServer.requests()).toHaveLength(1);
  } finally {
    await setCurrentTabZoom(chat, 1).catch(() => {});
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('untrusted card labels render as text and cannot add HTML or unsafe links', async () => {
  const payload = {
    version: 1,
    blocks: [
      {
        type: 'key_values',
        title: '<img src=x onerror=alert(1)>',
        items: [{ label: '<script>bad()</script>', value: 'javascript:alert(1)' }],
      },
    ],
  };
  const readableMarkdown = [
    'Readable fallback.',
    '<div id="fixture-fake-answer-cards" class="answer-cards" style="color: rgb(1, 2, 3)">',
    'Fake card wrapper prose.',
    '<div id="fixture-fake-answer-followups" class="answer-followups">Fake follow-up prose.</div>',
    '<div id="fixture-fake-answer-text-fallback" class="answer-text-fallback" style="border: 2px solid rgb(4, 5, 6)">',
    'Fake fallback prose. <span id="fixture-fake-copy-action" class="copy-action-button" style="color: rgb(7, 8, 9)">Fake copy action prose.</span>',
    '</div>',
    '</div>',
  ].join('\n');
  const initialReply = `${readableMarkdown}\n\`\`\`promptpaul-cards\n${JSON.stringify(payload)}\n\`\`\``;
  answerServer.reset(initialReply);
  const { userDataDir, context, harness, chat, article } = await preparePageChat();
  try {
    const originalSource = await harness.evaluate(
      (url) => window.pageActionHarness.findTab(url),
      article.url()
    );
    const otherPage = await context.newPage();
    await otherPage.goto(fixtureUrl(fixtureServer, 'plan-b.html'));
    await otherPage.bringToFront();
    const otherTab = await harness.evaluate(
      (url) => window.pageActionHarness.findTab(url),
      otherPage.url()
    );
    expect(originalSource?.id).toEqual(expect.any(Number));
    expect(otherTab?.id).toEqual(expect.any(Number));
    expect(otherTab.id).not.toBe(originalSource.id);
    const activeTabId = await harness.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]?.id));
        })
    );
    expect(activeTabId).toBe(otherTab.id);

    answerServer.holdAfter(1);
    await runCardAction(chat, 'Summary cards');
    await expect.poll(() => answerServer.requests().length).toBe(1);
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'streaming');
    const initialRunPointer = await chat.evaluate(async () => {
      const value = await chrome.storage.session.get('promptPaulActiveRunV1');
      return value.promptPaulActiveRunV1;
    });
    expect(initialRunPointer?.sourceTabId).toBe(originalSource.id);
    expect(answerServer.requests()).toHaveLength(1);
    const initialUserContent = lastUserContent(answerServer.requests()[0]);
    expect(initialUserContent).toContain(
      'Energy storage is therefore the linchpin of a resilient, low-carbon grid.'
    );
    expect(initialUserContent).not.toContain(
      'Vendor B charges 19 per month for 3 seats and 50 gigabytes of storage.'
    );
    answerServer.release();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
      timeout: 45000,
    });
    const message = chat.locator('.llm-message').last();
    const content = message.locator('.llm-content-area');
    const hostCards = message.locator(':scope > .answer-cards');
    const hostFollowups = message.locator(':scope > .answer-followups');
    const hostFallback = message.locator(':scope > .answer-text-fallback');
    await expect(hostCards).toHaveCount(1);
    await expect(hostCards.locator('.answer-card--key_values')).toHaveCount(1);
    await expect(hostFollowups).toHaveCount(1);
    await expect(hostFollowups.getByRole('button', { name: 'Explain key findings' })).toBeVisible();
    await expect(hostFollowups.getByRole('button', { name: 'Compare tradeoffs' })).toBeVisible();
    await expect(hostFallback).toHaveCount(1);
    await expect(message.locator(':scope > #fixture-fake-answer-cards')).toHaveCount(0);
    await expect(message.locator(':scope > #fixture-fake-answer-followups')).toHaveCount(0);
    await expect(message.locator(':scope > #fixture-fake-copy-action')).toHaveCount(0);

    await hostFallback.locator(':scope > summary').click();
    const fakeCards = content.locator('#fixture-fake-answer-cards');
    const fakeFollowups = content.locator('#fixture-fake-answer-followups');
    const fakeFallback = content.locator('#fixture-fake-answer-text-fallback');
    const fakeCopy = content.locator('#fixture-fake-copy-action');
    await expect(fakeCards).toContainText('Fake card wrapper prose.');
    await expect(fakeFollowups).toContainText('Fake follow-up prose.');
    await expect(fakeFallback).toContainText('Fake fallback prose.');
    await expect(fakeCopy).toContainText('Fake copy action prose.');
    expect(await fakeCards.getAttribute('style')).toContain('color: rgb(1, 2, 3)');
    expect(await fakeFallback.getAttribute('style')).toContain('rgb(4, 5, 6)');
    expect(await fakeCopy.getAttribute('style')).toContain('rgb(7, 8, 9)');
    expect((await hostCards.getAttribute('style')) || '').not.toContain('rgb(1, 2, 3)');
    expect(await hostCards.evaluate((element) => getComputedStyle(element).color)).not.toBe(
      'rgb(1, 2, 3)'
    );
    await expect(content.locator('img, script, a')).toHaveCount(0);

    const card = hostCards.locator('.answer-card--key_values');
    await expect(card).toContainText('<img src=x onerror=alert(1)>');
    await expect(card).toContainText('<script>bad()</script>');
    await expect(card.locator('img, script, a')).toHaveCount(0);
    expect(answerServer.requests()).toHaveLength(1);

    await hostFollowups.getByRole('button', { name: 'Explain key findings' }).click();
    await expect(chat.locator('#user-input')).toHaveValue(
      'Explain the key findings in more detail.'
    );
    await expect(chat.locator('#answer-followup-context')).toContainText(
      'Follow-up uses original answer context'
    );
    expect(answerServer.requests()).toHaveLength(1);

    const laterPage = await context.newPage();
    await laterPage.goto(fixtureUrl(fixtureServer, 'plan-a.html'));
    await laterPage.bringToFront();
    await laterPage.locator('body').evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    answerServer.setReply(
      'Storage improves reliability, while the best technology depends on site and duration.'
    );
    answerServer.holdAfter(1);
    await chat.locator('#send-button').click();
    await expect.poll(() => answerServer.requests().length).toBe(2);
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'streaming');
    const followupRunPointer = await chat.evaluate(async () => {
      const value = await chrome.storage.session.get('promptPaulActiveRunV1');
      return value.promptPaulActiveRunV1;
    });
    expect(followupRunPointer?.sourceTabId).toBe(originalSource.id);
    const followupUserContent = lastUserContent(answerServer.requests()[1]);
    expect(followupUserContent).toContain(
      'Energy storage is therefore the linchpin of a resilient, low-carbon grid.'
    );
    expect(followupUserContent).not.toContain(
      'Vendor A charges 24 per month for 5 seats and 100 gigabytes of storage.'
    );
    expect(followupUserContent).not.toContain(
      'Vendor B charges 19 per month for 3 seats and 50 gigabytes of storage.'
    );
    expect(answerServer.requests()).toHaveLength(2);
    answerServer.release();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
      timeout: 45000,
    });
  } finally {
    answerServer.release();
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('plain and malformed structured responses keep readable fallback without a repair request', async () => {
  const malformed = `Readable answer survives.\n\`\`\`promptpaul-cards\n${JSON.stringify({
    version: 1,
    blocks: [
      {
        type: 'summary',
        title: 'Unsafe',
        text: 'Fallback only',
        points: [],
        url: 'javascript:alert(1)',
      },
    ],
  })}\n\`\`\``;
  for (const [index, response] of [
    ['plain', 'A plain text provider response remains readable.'],
    ['malformed', malformed],
  ]) {
    answerServer.reset(response);
    const { userDataDir, context, chat } = await preparePageChat();
    try {
      await runCardAction(chat, 'Summary cards');
      await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
        timeout: 45000,
      });
      await expect(chat.locator('.llm-message').last()).toContainText(
        index === 'plain' ? 'plain text provider response' : 'Readable answer survives.'
      );
      await expect(chat.locator('.answer-cards')).toHaveCount(0);
      if (index === 'malformed') {
        await expect(chat.locator('.llm-content-area').last()).not.toContainText(
          'promptpaul-cards'
        );
        await expect(
          chat.locator('.llm-message').last().locator('a[href^="javascript:"]')
        ).toHaveCount(0);
      }
      expect(answerServer.requests()).toHaveLength(1);
    } finally {
      await context.close();
      removeUserDataDir(userDataDir);
    }
  }
});

test('partial card syntax stays hidden while streaming and Stop does not expose it', async () => {
  answerServer.reset('', [
    'Readable answer remains visible.',
    '\n```promptpaul-cards\n{"version":1,"blocks":[{"type":"summary",',
    '"title":"unfinished"}]}\n```',
  ]);
  answerServer.holdAfter(2);
  const { userDataDir, context, chat } = await preparePageChat();
  try {
    await runCardAction(chat, 'Summary cards');
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'streaming', {
      timeout: 20000,
    });
    const bubble = chat.locator('.llm-message').last();
    await expect(bubble.locator('[data-inline-stop]')).toBeVisible();
    await expect(bubble.locator('.llm-content-area')).toContainText(
      'Readable answer remains visible.'
    );
    await expect(bubble.locator('.llm-content-area')).not.toContainText('promptpaul-cards');
    await expect(bubble.locator('.llm-content-area')).not.toContainText('unfinished');
    expect(answerServer.requests()).toHaveLength(1);

    await bubble.locator('[data-inline-stop]').click();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'stopped', {
      timeout: 20000,
    });
    await expect(bubble.locator('[data-inline-stop]')).toHaveCount(0);
    await expect(bubble.locator('.llm-content-area')).not.toContainText('promptpaul-cards');
    await expect(bubble.locator('.answer-cards')).toHaveCount(0);
    expect(answerServer.requests()).toHaveLength(1);
  } finally {
    answerServer.release();
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('progressive blocks preserve the existing card DOM, disclosure, filter, sort and readable copy', async () => {
  const summary = {
    type: 'summary',
    title: 'Early findings',
    text: 'Storage balances renewable output.',
    points: ['The first validated block arrives early.'],
  };
  const comparison = {
    type: 'comparison',
    title: 'Options',
    columns: ['Option', 'Cost', 'Response'],
    rows: [
      ['Zeta battery', 'High', 'Fast'],
      ['Alpha hydro', 'Low', 'Steady'],
    ],
  };
  const keyValues = {
    type: 'key_values',
    title: 'Key facts',
    items: [{ label: 'Grid role', value: 'Balances supply' }],
  };
  answerServer.reset('', [
    [
      'Readable stream answer stays available throughout.',
      '```promptpaul-cards',
      `{"version":1,"blocks":[${JSON.stringify(summary)},`,
    ].join('\n'),
    `${JSON.stringify(comparison)},`,
    JSON.stringify(keyValues),
    ']}\n```',
  ]);
  answerServer.holdAfter(1, 2, 3);
  const { userDataDir, context, chat } = await preparePageChat();
  try {
    await installClipboardCapture(chat);
    await captureAnswerCardEvents(chat);
    await runCardAction(chat, 'Summary cards');
    const bubble = chat.locator('.llm-message').last();
    const cards = bubble.locator('.answer-cards');
    await expect(cards).toBeVisible();
    await expect(bubble.locator('.llm-content-area')).toContainText(
      'Readable stream answer stays available throughout.'
    );
    await expect(cards.locator('.answer-card--summary')).toContainText('Early findings');

    await chat.evaluate(() => {
      window.__answerCardsOriginalWrapper = document.querySelector('.answer-cards');
      window.__answerCardsOriginalSummary = document.querySelector('.answer-card--summary');
    });
    const disclosure = cards.locator('.answer-card-summary');
    await disclosure.locator('summary').click();
    await expect(disclosure).not.toHaveAttribute('open', '');
    expect(await disclosure.evaluate((element) => element.open)).toBe(false);

    answerServer.release();
    const filter = cards.getByRole('searchbox', { name: 'Filter comparison rows' });
    await expect(filter).toBeVisible();
    await filter.fill('Alpha');
    const sort = cards.getByRole('button', { name: 'Sort by Option' });
    await sort.click();
    await expect(sort.locator('xpath=..')).toHaveAttribute('aria-sort', 'ascending');
    await expect(cards.locator('tbody tr:visible')).toHaveCount(1);
    await expect(cards.locator('tbody tr:visible')).toContainText('Alpha hydro');
    await expect
      .poll(() =>
        chat.evaluate(
          () =>
            document.querySelector('.answer-cards') === window.__answerCardsOriginalWrapper &&
            document.querySelector('.answer-card--summary') === window.__answerCardsOriginalSummary
        )
      )
      .toBe(true);
    await chat.evaluate(() => {
      window.__answerCardsOriginalComparison = document.querySelector('.answer-card--comparison');
    });

    answerServer.release();
    await expect(cards.locator('.answer-card--key_values')).toContainText('Balances supply');
    await expect(sort).toBeFocused();
    expect(
      await cards
        .locator('.answer-card--comparison')
        .evaluate((element) => element === window.__answerCardsOriginalComparison)
    ).toBe(true);
    await expect(cards.getByRole('searchbox', { name: 'Filter comparison rows' })).toHaveValue(
      'Alpha'
    );
    const observedEvents = await chat.evaluate(() => window.__answerCardEvents);
    expect(observedEvents.map(({ blockCount }) => blockCount)).toEqual([1, 2, 3]);
    await expect(sort).toBeFocused();

    answerServer.release();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
      timeout: 45000,
    });
    await expect(sort).toBeFocused();
    await expect(cards.getByRole('searchbox', { name: 'Filter comparison rows' })).toHaveValue(
      'Alpha'
    );
    await expect(cards.locator('tbody tr:visible')).toHaveCount(1);
    await expect(disclosure).not.toHaveAttribute('open', '');
    await expect(sort.locator('xpath=..')).toHaveAttribute('aria-sort', 'ascending');
    await expect(bubble.locator('.answer-text-fallback')).toContainText(
      'Readable stream answer stays available throughout.'
    );
    await expect(bubble.locator('.llm-content-area')).not.toContainText('promptpaul-cards');
    await cards.getByRole('button', { name: 'Reset table' }).click();
    await expect(cards.getByRole('searchbox', { name: 'Filter comparison rows' })).toHaveValue('');
    await expect(cards.locator('tbody tr:visible')).toHaveCount(2);
    await expect(sort.locator('xpath=..')).not.toHaveAttribute('aria-sort');
    await expectAnswerCopy(chat, 'Readable stream answer stays available throughout.');
    expect(answerServer.requests()).toHaveLength(1);
  } finally {
    answerServer.release();
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('malformed final card data clears its provisional cards and keeps readable text', async () => {
  const validBlock = {
    type: 'summary',
    title: 'Provisional card',
    text: 'This must be withdrawn if the final envelope is invalid.',
    points: [],
  };
  const invalidBlock = { type: 'unknown_action', title: 'Not allowed' };
  answerServer.reset('', [
    [
      'Readable answer survives invalid final data.',
      '```promptpaul-cards',
      `{"version":1,"blocks":[${JSON.stringify(validBlock)},`,
    ].join('\n'),
    JSON.stringify(invalidBlock),
    ']}\n```',
  ]);
  answerServer.holdAfter(1, 2);
  const { userDataDir, context, chat } = await preparePageChat();
  try {
    await runCardAction(chat, 'Summary cards');
    const bubble = chat.locator('.llm-message').last();
    await expect(bubble.locator('.answer-card--summary')).toContainText('Provisional card');
    answerServer.release();
    await expect(bubble.locator('.answer-cards')).toHaveCount(0);
    await expect(bubble.locator('.llm-content-area')).toContainText(
      'Readable answer survives invalid final data.'
    );
    await expect(bubble.locator('.llm-content-area')).not.toContainText('promptpaul-cards');
    answerServer.release();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
      timeout: 45000,
    });
    await expect(bubble.locator('.answer-cards')).toHaveCount(0);
    await expect(bubble.locator('.llm-content-area')).toContainText(
      'Readable answer survives invalid final data.'
    );
    expect(answerServer.requests()).toHaveLength(1);
  } finally {
    answerServer.release();
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('Stop clears visible provisional cards while preserving the streamed readable answer', async () => {
  const block = {
    type: 'summary',
    title: 'Provisional before Stop',
    text: 'This block is not a completed answer.',
    points: [],
  };
  answerServer.reset('', [
    [
      'Readable text remains after Stop.',
      '```promptpaul-cards',
      `{"version":1,"blocks":[${JSON.stringify(block)},`,
    ].join('\n'),
    '{}]}\n```',
  ]);
  answerServer.holdAfter(1);
  const { userDataDir, context, chat } = await preparePageChat();
  try {
    await runCardAction(chat, 'Summary cards');
    const bubble = chat.locator('.llm-message').last();
    await expect(bubble.locator('.answer-card--summary')).toContainText('Provisional before Stop');
    await expect(bubble.locator('.llm-content-area')).toContainText(
      'Readable text remains after Stop.'
    );
    await bubble.locator('[data-inline-stop]').click();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'stopped', {
      timeout: 20000,
    });
    await expect(bubble.locator('.answer-cards')).toHaveCount(0);
    await expect(bubble.locator('.llm-content-area')).toContainText(
      'Readable text remains after Stop.'
    );
    await expect(bubble.locator('.llm-content-area')).not.toContainText('promptpaul-cards');
    expect(answerServer.requests()).toHaveLength(1);
  } finally {
    answerServer.release();
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('answer follow-up prefills without sending and retains original selection and source tab', async () => {
  const originalSelection = 'Original article selection for the structured answer.';
  const differentSelection = 'A newer selection from a different active tab.';
  const reply = [
    'Readable answer about the original source.',
    '```promptpaul-cards',
    JSON.stringify({
      version: 1,
      blocks: [
        {
          type: 'summary',
          title: 'Original selection summary',
          text: 'Key result from the first source.',
          points: [],
        },
      ],
    }),
    '```',
  ].join('\n');
  answerServer.reset(reply);
  answerServer.holdAfter(1);
  const { userDataDir, context, harness, chat } = await preparePageChat();
  const articleUrl = fixtureUrl(fixtureServer, 'article.html');
  const originalSelectionSource = await harness.evaluate(
    ({ url, selectedText }) => window.pageActionHarness.attachSelectionSource(url, selectedText),
    { url: articleUrl, selectedText: originalSelection }
  );
  try {
    expect(originalSelectionSource.success).toBe(true);
    await expect(chat.locator('#selected-text-snippet')).toContainText(originalSelection);
    await runCardAction(chat, 'Summary cards');
    await expect(chat.locator('.answer-card--summary')).toContainText('Original selection summary');
    await expect.poll(() => answerServer.requests().length).toBe(1);
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'streaming');
    const initialRunPointer = await chat.evaluate(async () => {
      const value = await chrome.storage.session.get('promptPaulActiveRunV1');
      return value.promptPaulActiveRunV1;
    });
    expect(initialRunPointer?.sourceTabId).toBe(originalSelectionSource.tabId);
    answerServer.release();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
      timeout: 45000,
    });

    const anotherPage = await context.newPage();
    const otherUrl = fixtureUrl(fixtureServer, 'plan-b.html');
    await anotherPage.goto(otherUrl);
    await anotherPage.bringToFront();
    await anotherPage.locator('body').evaluate((element, selectedText) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      window.__answerCardsLiveSelection = selectedText;
    }, differentSelection);

    const firstBubble = chat.locator('.llm-message').first();
    await firstBubble.locator('.answer-followup-button[data-answer-followup="explain"]').click();
    await expect(chat.locator('#user-input')).toHaveValue(
      'Explain the key findings in more detail.'
    );
    await expect(chat.locator('#answer-followup-context')).toContainText(
      'Follow-up uses original answer context'
    );
    await expect(
      chat.locator('#answer-followup-context [data-cancel-answer-followup]')
    ).toBeVisible();
    expect(answerServer.requests()).toHaveLength(1);

    // Switching tabs and selecting ordinary page text after prefill must not
    // replace the source captured by this card's follow-up action.
    const activePage = await context.newPage();
    await activePage.goto(fixtureUrl(fixtureServer, 'plan-a.html'));
    await activePage.bringToFront();
    await activePage.locator('body').evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    answerServer.holdAfter(1);
    await chat.locator('#send-button').click();
    await expect.poll(() => answerServer.requests().length).toBe(2);
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'streaming');
    const followupRunPointer = await chat.evaluate(async () => {
      const value = await chrome.storage.session.get('promptPaulActiveRunV1');
      return value.promptPaulActiveRunV1;
    });
    expect(followupRunPointer?.sourceTabId).toBe(initialRunPointer.sourceTabId);
    const lastRequest = answerServer.requests().at(-1);
    const userContent = lastUserContent(lastRequest);
    expect(userContent).toContain(originalSelection);
    expect(userContent).not.toContain(differentSelection);
    expect(
      lastRequest.body.messages.some((message) => message.content?.includes?.(differentSelection))
    ).toBe(false);
    expect(answerServer.requests()).toHaveLength(2);
    answerServer.release();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
      timeout: 45000,
    });
  } finally {
    answerServer.release();
    await context.close();
    removeUserDataDir(userDataDir);
  }
});

test('closed follow-up source prevents a provider request and Cancel restores ordinary composer send', async () => {
  const originalSelection = 'Source text for a follow-up whose tab will close.';
  const reply = [
    'Readable answer before the source closes.',
    '```promptpaul-cards',
    JSON.stringify({
      version: 1,
      blocks: [
        {
          type: 'summary',
          title: 'Answer before close',
          text: 'This answer captured its original context.',
          points: [],
        },
      ],
    }),
    '```',
  ].join('\n');
  answerServer.reset(reply);
  const { userDataDir, context, harness, chat, article } = await preparePageChat();
  const articleUrl = fixtureUrl(fixtureServer, 'article.html');
  try {
    const source = await harness.evaluate(
      ({ url, selectedText }) => window.pageActionHarness.attachSelectionSource(url, selectedText),
      { url: articleUrl, selectedText: originalSelection }
    );
    expect(source.success).toBe(true);
    await expect(chat.locator('#selected-text-snippet')).toContainText(originalSelection);
    await runCardAction(chat, 'Summary cards');
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
      timeout: 45000,
    });
    const bubble = chat.locator('.llm-message').first();
    const followup = bubble.locator('.answer-followup-button[data-answer-followup="explain"]');
    await expect(followup).toBeVisible();
    await article.close();
    const sourceStillOpen = await chat.evaluate((tabId) => {
      return new Promise((resolve) => {
        chrome.tabs.get(tabId, () => resolve(!chrome.runtime.lastError));
      });
    }, source.tabId);
    expect(sourceStillOpen).toBe(false);

    await followup.click();
    await expect(chat.locator('#answer-followup-context')).toBeVisible();
    expect(answerServer.requests()).toHaveLength(1);
    await chat.locator('#send-button').click();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete');
    await expect(chat.locator('#answer-followup-context')).toBeVisible();
    expect(answerServer.requests()).toHaveLength(1);

    await chat.locator('#answer-followup-context [data-cancel-answer-followup]').click();
    await expect(chat.locator('#answer-followup-context')).toHaveCount(0);
    await chat.locator('#user-input').fill('Use the current composer intent after Cancel.');
    await chat.locator('#send-button').click();
    await expect(chat.locator('#input-area')).toHaveAttribute('data-run-state', 'complete', {
      timeout: 45000,
    });
    expect(answerServer.requests()).toHaveLength(2);
    const ordinaryRequest = answerServer.requests().at(-1);
    expect(lastUserContent(ordinaryRequest)).toContain(
      'Use the current composer intent after Cancel.'
    );
    expect(lastUserContent(ordinaryRequest)).toContain('Energy storage is therefore the linchpin');
  } finally {
    await context.close();
    removeUserDataDir(userDataDir);
  }
});
