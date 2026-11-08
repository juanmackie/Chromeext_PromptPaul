import { describe, expect, it, vi } from 'vitest';
import {
  handleDevDiagnosticsMessage,
  handleExternalPanelMessage,
  handleImproveInstructionMessage,
  handleNotchMessage,
  handlePageActionMessage,
  handlePageContentMessage,
  handlePanelMessage,
  handleProviderMessage,
  handleRunMessage,
  handleSearchMessage,
  handleSkillMessage,
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

  it('requires an extension page before extracting active-tab content', () => {
    const sendResponse = vi.fn();
    const executeTabContentExtraction = vi.fn();
    const deps = {
      chrome: { tabs: { query: vi.fn() } },
      extensionPageSender: false,
      executeTabContentExtraction,
      rejectUnauthorizedMessage: (response, error) => {
        response({ success: false, error });
        return false;
      },
      sendResponse,
    };

    expect(handlePageContentMessage({ action: 'getLoadContent' }, {}, deps)).toBe(false);
    expect(executeTabContentExtraction).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Page extraction must come from Prompt Paul.',
    });
  });

  it('returns built-in skill listings only to extension pages', () => {
    const sendResponse = vi.fn();
    const skillManager = { getSkillsList: vi.fn(), getSlashCommands: vi.fn() };
    const deps = {
      extensionPageSender: true,
      rejectUnauthorizedMessage: vi.fn(),
      sendResponse,
      skillManager,
    };

    expect(handleSkillMessage({ action: 'getSkills' }, {}, deps)).toBe(true);
    expect(skillManager.getSkillsList).toHaveBeenCalledOnce();
    expect(skillManager.getSlashCommands).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith({ skills: undefined, slashCommands: undefined });
  });

  it('binds panel selection handoff to its sender tab', () => {
    const sendResponse = vi.fn();
    const openPromptPaulForSelection = vi.fn();
    const deps = {
      extensionOrigin: 'chrome-extension://prompt-paul',
      extensionPageSender: false,
      isContentScriptSender: vi.fn(() => true),
      openPromptPaulForSelection,
      rejectUnauthorizedMessage: (response, error) => {
        response({ success: false, error });
        return false;
      },
      requestMatchesSenderTab: vi.fn(() => false),
      sendResponse,
    };

    expect(
      handlePanelMessage(
        { action: 'openPromptPaulFromSelection', tabId: 8, selectedText: 'text' },
        { tab: { id: 7 } },
        deps
      )
    ).toBe(false);
    expect(openPromptPaulForSelection).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Selection handoff must come from its tab.',
    });
  });

  it('rejects external panel links without a browser tab', () => {
    const sendResponse = vi.fn();
    const openChatWithContext = vi.fn();

    expect(
      handleExternalPanelMessage(
        { action: 'openChat', context: { selectedText: 'text' } },
        {},
        { openChatWithContext, sendResponse }
      )
    ).toBe(false);
    expect(openChatWithContext).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'External chat links must come from a browser tab.',
    });
  });

  it('binds external panel links to the sending browser tab', () => {
    const sendResponse = vi.fn();
    const openChatWithContext = vi.fn(() => Promise.resolve({ success: true }));

    expect(
      handleExternalPanelMessage(
        { action: 'openChat', context: { selectedText: 'text', tabId: 999 } },
        { tab: { id: 7 } },
        { openChatWithContext, sendResponse }
      )
    ).toBe(true);
    expect(openChatWithContext).toHaveBeenCalledWith({ selectedText: 'text', tabId: 7 });
  });

  it('returns web-search readiness without exposing its stored key', () => {
    const sendResponse = vi.fn();
    const deps = {
      chrome: {
        storage: {
          local: {
            get: vi.fn((_keys, callback) =>
              callback({ searchProvider: 'brave', braveSearchApiKey: 'secret-value' })
            ),
          },
        },
      },
      extensionPageSender: true,
      rejectUnauthorizedMessage: vi.fn(),
      sendResponse,
    };

    expect(handleSearchMessage({ action: 'getWebSearchStatus' }, {}, deps)).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({ configured: true, provider: 'brave' });
    expect(JSON.stringify(sendResponse.mock.calls)).not.toContain('secret-value');
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

  it('routes run execution through the authorized run handler', () => {
    const runOrchestrator = {
      getRun: vi.fn(() => ({ id: 'run-1' })),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const sendResponse = vi.fn();
    const deps = runDependencies({ runOrchestrator, sendResponse });
    const request = { action: 'executeRun', runId: 'run-1', requestConfig: { messages: [] } };

    expect(handleRunMessage(request, {}, deps)).toBe(false);
    expect(runOrchestrator.execute).toHaveBeenCalledWith('run-1', request.requestConfig);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, accepted: true });
  });

  it('rejects unauthorized run execution before accessing run state', () => {
    const runOrchestrator = { getRun: vi.fn(), execute: vi.fn() };
    const sendResponse = vi.fn();
    const deps = runDependencies({
      isAuthorizedRunRequest: vi.fn(() => false),
      rejectUnauthorizedMessage: (response, error) => {
        response({ success: false, error });
        return false;
      },
      runOrchestrator,
      sendResponse,
    });

    expect(handleRunMessage({ action: 'executeRun', runId: 'run-1' }, {}, deps)).toBe(false);
    expect(runOrchestrator.getRun).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Run execution is not authorized.',
    });
  });

  it('returns null when a message belongs to a different capability', () => {
    expect(handleRunMessage({ action: 'not-owned' }, {}, {})).toBeNull();
  });

  it('keeps provider account messages behind the extension-page boundary', () => {
    const sendResponse = vi.fn();
    const setHermesCredential = vi.fn();
    const deps = providerDependencies({
      extensionPageSender: false,
      rejectUnauthorizedMessage: (response) => {
        response({ success: false, error: 'Unauthorized' });
        return false;
      },
      sendResponse,
      setHermesCredential,
    });

    expect(
      handleProviderMessage({ action: 'hermesKeySet', profileId: 'p1', value: 'secret' }, {}, deps)
    ).toBe(false);
    expect(setHermesCredential).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });
  });

  it('never returns a saved Hermes credential in the response', async () => {
    const sendResponse = vi.fn();
    const setHermesCredential = vi.fn(async () => {});
    const deps = providerDependencies({ sendResponse, setHermesCredential });

    expect(
      handleProviderMessage(
        { action: 'hermesKeySet', profileId: 'p1', value: 'secret-value' },
        {},
        deps
      )
    ).toBe(true);
    await Promise.resolve();
    expect(setHermesCredential).toHaveBeenCalledWith('p1', 'secret-value');
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
    expect(JSON.stringify(sendResponse.mock.calls)).not.toContain('secret-value');
  });

  it('does not store invalid Hermes credentials', () => {
    const sendResponse = vi.fn();
    const setHermesCredential = vi.fn();
    const deps = providerDependencies({
      sendResponse,
      setHermesCredential,
      validateHermesKey: vi.fn(() => ({ ok: false, error: 'Invalid key.' })),
    });

    expect(
      handleProviderMessage({ action: 'hermesKeySet', profileId: 'p1', value: 'bad key' }, {}, deps)
    ).toBe(true);
    expect(setHermesCredential).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Invalid key.' });
  });

  it('reports only whether a Hermes credential is configured', async () => {
    const sendResponse = vi.fn();
    const deps = providerDependencies({
      getHermesCredential: vi.fn(async () => 'secret-value'),
      sendResponse,
    });

    expect(handleProviderMessage({ action: 'hermesKeyStatus', profileId: 'p1' }, {}, deps)).toBe(
      true
    );
    await Promise.resolve();
    expect(sendResponse).toHaveBeenCalledWith({ success: true, configured: true });
    expect(JSON.stringify(sendResponse.mock.calls)).not.toContain('secret-value');
  });

  it('clears Hermes state through the provider handler on profile deletion', async () => {
    const chrome = { storage: { local: {} } };
    const removeProfileHermesState = vi.fn(async () => {});
    const deps = providerDependencies({ chrome, removeProfileHermesState });

    expect(
      handleProviderMessage({ action: 'hermesProfileDeleted', profileId: 'p1' }, {}, deps)
    ).toBe(true);
    await Promise.resolve();
    expect(removeProfileHermesState).toHaveBeenCalledWith('p1', chrome);
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

function runDependencies(overrides = {}) {
  return {
    chrome: {
      storage: {
        local: { get: vi.fn(async () => ({})) },
        session: { get: vi.fn(async () => ({})) },
      },
    },
    clearPageActionCheckpoint: vi.fn(async () => {}),
    extensionPageSender: true,
    getPageActionCheckpoint: vi.fn(async () => null),
    getRunJournalStorageKey: vi.fn(() => 'run-journals'),
    hermesSessionResetLock: { isLocked: vi.fn(() => false) },
    isAuthorizedRunRequest: vi.fn(() => true),
    randomId: vi.fn(() => 'owner-1'),
    rejectUnauthorizedMessage: vi.fn(() => false),
    resolvePanelTabId: vi.fn(async () => 7),
    resolveStoredRunConfig: vi.fn(async (config) => config),
    runOrchestrator: { getRun: vi.fn(), execute: vi.fn() },
    sendResponse: vi.fn(),
    logger: { error: vi.fn() },
    ...overrides,
  };
}

function providerDependencies(overrides = {}) {
  return {
    chrome: {
      runtime: { getManifest: vi.fn(() => ({ version: '6.4.0' })) },
      storage: { local: { get: vi.fn((_keys, callback) => callback({ profiles: [] })) } },
    },
    codexAuthManager: {
      getAuthStatus: vi.fn(async () => ({})),
      getValidAuth: vi.fn(async () => null),
      startLogin: vi.fn(async () => ({})),
      pollLogin: vi.fn(async () => ({})),
      logout: vi.fn(async () => {}),
    },
    extensionPageSender: true,
    fetchAvailableModels: vi.fn(async () => []),
    getHermesCredential: vi.fn(async () => null),
    getHermesEndpoint: vi.fn(() => 'https://gateway.test'),
    hermesSessionResetLock: { tryRun: vi.fn(), isLocked: vi.fn(() => false) },
    hermesTransport: {
      checkConnection: vi.fn(async () => ({})),
      getStoredSession: vi.fn(async () => null),
      endSession: vi.fn(async () => {}),
      clearStoredSession: vi.fn(async () => {}),
    },
    removeHermesCredential: vi.fn(async () => {}),
    removeProfileHermesState: vi.fn(async () => {}),
    rejectUnauthorizedMessage: vi.fn(() => false),
    runOrchestrator: { activeRuns: new Map() },
    sendResponse: vi.fn(),
    setHermesCredential: vi.fn(async () => {}),
    supportsHermesClientTools: vi.fn(() => true),
    validateHermesKey: vi.fn((value) => ({ ok: true, value })),
    ...overrides,
  };
}
