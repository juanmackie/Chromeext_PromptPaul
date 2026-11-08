import { describe, expect, it, vi } from 'vitest';
import {
  handleDevDiagnosticsMessage,
  handleImproveInstructionMessage,
  handleNotchMessage,
  handlePageActionMessage,
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

describe('background capability message handlers', () => {
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
    await new Promise((resolve) => setTimeout(resolve, 0));
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
        { action: 'improveInstruction', prompt: 'Make this clearer' },
        { origin: deps.extensionOrigin },
        deps
      )
    ).toBe(true);
    await Promise.resolve();
    expect(improveInstructionForProfile).toHaveBeenCalledWith('Make this clearer');
    expect(deps.sendResponse).toHaveBeenCalledWith({ success: true, content: 'Improved' });
  });

  it('returns null when a message belongs to another capability', () => {
    expect(handlePageActionMessage({ action: 'startRun' }, {}, {})).toBeNull();
  });

  it('only returns Act model support to an extension page', async () => {
    const sendResponse = vi.fn();
    const deps = actDependencies({ extensionPageSender: false, sendResponse });

    expect(handlePageActionMessage({ action: 'getActModelSupport' }, {}, deps)).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Model support status requires a Prompt Paul extension page.',
    });
  });

  it('binds page input answers to the active run source tab', () => {
    const run = { sourceTabId: 7 };
    const runOrchestrator = actRunOrchestrator(run);
    const sendResponse = vi.fn();
    const deps = actDependencies({ runOrchestrator, sendResponse });

    expect(
      handlePageActionMessage(
        { action: 'pageUserInputResponse', runId: 'run-1', sourceTabId: 8 },
        { origin: 'chrome-extension://prompt-paul' },
        deps
      )
    ).toBe(true);
    expect(runOrchestrator.resolvePageUserInput).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'User input response does not match the run.',
    });
  });

  it('detaches precise input before an authorized run abort', async () => {
    const runOrchestrator = actRunOrchestrator({ sourceTabId: 7 });
    const cdpInputBackend = { detachRun: vi.fn() };
    const sendResponse = vi.fn();
    const deps = actDependencies({ runOrchestrator, cdpInputBackend, sendResponse });

    expect(handlePageActionMessage({ action: 'abortRun', runId: 'run-1' }, {}, deps)).toBe(true);
    await Promise.resolve();
    expect(cdpInputBackend.detachRun).toHaveBeenCalledWith('run-1');
    expect(runOrchestrator.abort).toHaveBeenCalledWith('run-1');
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });
});

function actRunOrchestrator(run) {
  return {
    activeRuns: new Map([['run-1', run]]),
    resolvePageUserInput: vi.fn(() => true),
    resolvePageManualIntervention: vi.fn(() => true),
    resolvePageActionDecision: vi.fn(() => true),
    abort: vi.fn(async () => true),
  };
}

function actDependencies(overrides = {}) {
  return {
    chrome: { storage: { local: { get: vi.fn(async () => ({})) } } },
    cdpInputBackend: { detachRun: vi.fn() },
    extensionPageSender: true,
    getPageActionSiteOrigin: vi.fn(),
    getProfileToolSupport: vi.fn(() => true),
    isAuthorizedRunRequest: vi.fn(() => true),
    pageActionDocumentProvider: vi.fn(),
    pageActionSitePolicyStore: { update: vi.fn(async () => ({})) },
    rejectUnauthorizedMessage: (sendResponse, error) => {
      sendResponse({ success: false, error });
      return true;
    },
    resolvePreferredProfile: vi.fn(() => null),
    runOrchestrator: actRunOrchestrator({ sourceTabId: 7 }),
    sendResponse: vi.fn(),
    ...overrides,
  };
}
