import { describe, expect, it } from 'vitest';
import {
  isContentScriptSender,
  isExtensionSender,
  isRunOwner,
  requestMatchesSenderTab,
} from '../src/utils/runtimeAuthorization.js';

const EXTENSION_ORIGIN = 'chrome-extension://prompt-paul/';

const extensionSender = { url: `${EXTENSION_ORIGIN}chat.html` };
const contentSender = { url: 'https://example.test/page', tab: { id: 7, windowId: 2 } };

describe('runtime authorization helpers', () => {
  it('distinguishes extension pages from content scripts', () => {
    expect(isExtensionSender(extensionSender, EXTENSION_ORIGIN)).toBe(true);
    expect(isExtensionSender(contentSender, EXTENSION_ORIGIN)).toBe(false);
    expect(isContentScriptSender(contentSender, EXTENSION_ORIGIN)).toBe(true);
    expect(isContentScriptSender(extensionSender, EXTENSION_ORIGIN)).toBe(false);
  });

  it('binds content-script requests to the sender tab', () => {
    expect(requestMatchesSenderTab(contentSender, undefined)).toBe(true);
    expect(requestMatchesSenderTab(contentSender, 7)).toBe(true);
    expect(requestMatchesSenderTab(contentSender, 8)).toBe(false);
  });

  it('requires the extension sender and the opaque owner token', () => {
    const run = { ownerToken: 'run-token', sourceTabId: 7 };
    expect(isRunOwner(run, { ownerToken: 'run-token' }, extensionSender, EXTENSION_ORIGIN)).toBe(
      true
    );
    expect(isRunOwner(run, { ownerToken: 'wrong' }, extensionSender, EXTENSION_ORIGIN)).toBe(false);
    expect(isRunOwner(run, { ownerToken: 'run-token' }, contentSender, EXTENSION_ORIGIN)).toBe(
      false
    );
    expect(
      isRunOwner(
        run,
        { ownerToken: 'run-token', sourceTabId: 8 },
        extensionSender,
        EXTENSION_ORIGIN
      )
    ).toBe(false);
  });
});
