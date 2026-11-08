import { describe, expect, it, vi } from 'vitest';
import {
  handleDevDiagnosticsMessage,
  handleImproveInstructionMessage,
  handleNotchMessage,
} from '../src/background/index.js';

function dependencies(overrides = {}) {
  return {
    extensionOrigin: 'chrome-extension://prompt-paul',
    isExtensionSender: (sender, origin) => sender.origin === origin,
    isContentScriptSender: (sender) => sender.contentScript === true,
    requestMatchesSenderTab: (sender, tabId) => sender.tab?.id === tabId,
    rejectUnauthorizedMessage: (sendResponse) => {
      sendResponse({ error: 'Unauthorized' });
      return false;
    },
    recordRemoteDevDiagnostic: vi.fn(() => true),
    getDevDiagnosticsStatus: vi.fn(() => ({ enabled: true })),
    sendResponse: vi.fn(),
    ...overrides,
  };
}

describe('background diagnostics message handler', () => {
  it('accepts diagnostics from extension pages', () => {
    const deps = dependencies();
    const result = handleDevDiagnosticsMessage(
      { action: 'devDiagnostic', entry: { message: 'ok' } },
      { origin: deps.extensionOrigin },
      deps
    );

    expect(result).toBe(false);
    expect(deps.recordRemoteDevDiagnostic).toHaveBeenCalledWith({ message: 'ok' });
    expect(deps.sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('binds content-script diagnostics to their sender tab', () => {
    const sender = { contentScript: true, tab: { id: 7 } };
    const deps = dependencies();

    handleDevDiagnosticsMessage({ action: 'devDiagnostic', tabId: 8 }, sender, deps);

    expect(deps.recordRemoteDevDiagnostic).not.toHaveBeenCalled();
    expect(deps.sendResponse).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('returns null for messages owned by another capability', () => {
    const deps = dependencies();

    expect(handleDevDiagnosticsMessage({ action: 'other' }, {}, deps)).toBeNull();
    expect(deps.sendResponse).not.toHaveBeenCalled();
  });

  it('returns diagnostics status only to an authorized sender', () => {
    const deps = dependencies();

    handleDevDiagnosticsMessage({ action: 'devDiagnosticsStatus' }, { contentScript: true }, deps);

    expect(deps.getDevDiagnosticsStatus).toHaveBeenCalledOnce();
    expect(deps.sendResponse).toHaveBeenCalledWith({ enabled: true });
  });

  it('routes notch actions and reports capability errors', async () => {
    const handleNotchAction = vi.fn().mockRejectedValue(new Error('Notch unavailable'));
    const deps = dependencies({ handleNotchAction });

    expect(handleNotchMessage({ action: 'notchAction' }, {}, deps)).toBe(true);
    await Promise.resolve();
    expect(deps.sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Notch unavailable',
    });
  });

  it('requires an extension page to improve instructions', async () => {
    const improveInstructionForProfile = vi.fn().mockResolvedValue('Improved');
    const deps = dependencies({ improveInstructionForProfile });

    expect(
      handleImproveInstructionMessage(
        { action: 'improveInstruction', prompt: '  Make this clearer  ' },
        { origin: deps.extensionOrigin },
        deps
      )
    ).toBe(true);
    await Promise.resolve();
    expect(improveInstructionForProfile).toHaveBeenCalledWith('Make this clearer');
    expect(deps.sendResponse).toHaveBeenCalledWith({ success: true, content: 'Improved' });
  });
});
