/**
 * @fileoverview Runtime message handling for run lifecycle and tool access.
 * @module runMessages
 */

/** Route run lifecycle messages using injected platform and authorization dependencies. */
export function handleRunMessage(request, sender, dependencies) {
  const {
    chrome,
    clearPageActionCheckpoint,
    extensionPageSender,
    getPageActionCheckpoint,
    getRunJournalStorageKey,
    hermesSessionResetLock,
    isAuthorizedRunRequest,
    randomId,
    rejectUnauthorizedMessage,
    resolvePanelTabId,
    resolveStoredRunConfig,
    runOrchestrator,
    sendResponse,
    logger = console,
  } = dependencies;

  if (request.action === 'startRun') {
    if (!extensionPageSender) {
      sendResponse({ error: 'Runs must start from a Prompt Paul page.' });
      return true;
    }

    const config = request.config || {};
    const ownerToken = randomId();
    Promise.resolve()
      .then(async () => {
        const effectiveConfig = await resolveStoredRunConfig(config);
        const { pageActionsPreciseInput } =
          await chrome.storage.local.get('pageActionsPreciseInput');
        effectiveConfig.pageActionsPreciseInput =
          effectiveConfig.pageActions === true && pageActionsPreciseInput === true;
        if (
          effectiveConfig.provider === 'hermes' &&
          hermesSessionResetLock.isLocked(effectiveConfig.profileId)
        ) {
          throw new Error('Hermes New chat is still resetting the previous session.');
        }
        if (effectiveConfig.pageActions && effectiveConfig.sourceTabId != null) {
          try {
            await chrome.tabs.get(Number(effectiveConfig.sourceTabId));
          } catch (_) {
            effectiveConfig.sourceTabId = null;
          }
        }
        if (effectiveConfig.pageActions && effectiveConfig.sourceTabId == null) {
          const sourceTabId = await resolvePanelTabId(sender?.tab?.id ?? null, {
            rejectUnsupportedActive: true,
          });
          if (sourceTabId == null) {
            throw new Error('Act needs an active web page. Open a web page and try again.');
          }
          effectiveConfig.sourceTabId = sourceTabId;
        }
        if (effectiveConfig.provider === 'hermes') effectiveConfig.webSearch = false;
        return runOrchestrator.startRun(effectiveConfig, ownerToken);
      })
      .then((runId) =>
        sendResponse({
          runId,
          ownerToken,
          sourceTabId: runOrchestrator.getRun(runId)?.sourceTabId ?? null,
        })
      )
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'resumeActRun') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse, 'Act resume must come from Prompt Paul.');
    }
    Promise.resolve()
      .then(async () => {
        const checkpointRunId = String(request.checkpointRunId || '').trim();
        const checkpoint = await getPageActionCheckpoint(checkpointRunId);
        if (!checkpoint) throw new Error('The Act checkpoint is no longer available.');
        if (!checkpoint.sourceTabId || !checkpoint.profileId) {
          throw new Error('The Act checkpoint is missing its saved page or connection.');
        }
        const instruction =
          checkpoint.instruction ||
          'Continue the interrupted Act task after inspecting the current page.';
        const effectiveConfig = await resolveStoredRunConfig({
          profileId: checkpoint.profileId,
          pageActions: true,
          pageActionsMultiTab: true,
          sourceTabId: checkpoint.sourceTabId,
          tool_choice: 'auto',
          webSearch: false,
          messages: [{ role: 'user', content: instruction }],
          actCheckpoint: checkpoint,
        });
        const { pageActionsPreciseInput } =
          await chrome.storage.local.get('pageActionsPreciseInput');
        effectiveConfig.pageActionsPreciseInput = pageActionsPreciseInput === true;
        const ownerToken = randomId();
        const runId = await runOrchestrator.startRun(effectiveConfig, ownerToken);
        await clearPageActionCheckpoint(checkpointRunId);
        return {
          runId,
          ownerToken,
          sourceTabId: runOrchestrator.getRun(runId)?.sourceTabId ?? null,
        };
      })
      .then((result) => sendResponse({ success: true, resumed: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'executeRun') {
    const { runId, requestConfig } = request;
    if (!isAuthorizedRunRequest(request, sender)) {
      return rejectUnauthorizedMessage(sendResponse, 'Run execution is not authorized.');
    }
    // A run can span many model turns, approvals, navigations, and tab
    // recoveries. Do not hold the runtime message channel open for that whole
    // lifetime: Chrome may close a long-lived channel when the side panel or
    // service-worker event is recycled, even though the run is still active.
    // Terminal state is delivered through orchestratorEvent and persisted in
    // the run journal; this response only acknowledges that execution was
    // accepted by the worker.
    if (!runOrchestrator.getRun(runId)) {
      sendResponse({ error: `Run ${runId} not found` });
      return false;
    }
    if (!requestConfig || typeof requestConfig !== 'object') {
      sendResponse({ error: 'A valid run configuration is required.' });
      return false;
    }
    void runOrchestrator.execute(runId, requestConfig).catch((error) => {
      logger.error('Background: Run execution failed after acknowledgement:', error);
    });
    sendResponse({ success: true, accepted: true });
    return false;
  }

  if (request.action === 'executeTool') {
    const { runId, toolCall } = request;
    if (!isAuthorizedRunRequest(request, sender)) {
      return rejectUnauthorizedMessage(sendResponse, 'Tool execution is not authorized.');
    }
    runOrchestrator
      .executeTool(runId, toolCall)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({ error: error.message, code: String(error.code || '').slice(0, 80) });
      });
    return true;
  }

  if (request.action === 'hermesApprovalDecision') {
    if (!isAuthorizedRunRequest(request, sender)) {
      sendResponse({ success: false, error: 'Hermes approval is not authorized.' });
      return true;
    }
    const run = runOrchestrator.activeRuns.get(request.runId);
    if (
      !run ||
      run.config?.provider !== 'hermes' ||
      (run.sourceTabId != null && request.sourceTabId !== run.sourceTabId)
    ) {
      sendResponse({ success: false, error: 'Hermes run was not found.' });
      return true;
    }
    runOrchestrator
      .resolveHermesApproval(request.runId, request.approvalId, request.choice)
      .then((success) => sendResponse({ success }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getRunJournal') {
    if (!extensionPageSender) {
      sendResponse({
        success: false,
        error: 'Run journals are available only to Prompt Paul pages.',
      });
      return true;
    }
    const key = getRunJournalStorageKey();
    chrome.storage.session
      .get([key])
      .then((result) => {
        const journals = result?.[key] || {};
        const requested = request.runId ? journals[request.runId] : null;
        const activeRun = request.runId ? runOrchestrator.getRun(request.runId) : null;
        sendResponse({
          success: true,
          journal: activeRun ? runOrchestrator.getRunJournal(request.runId) : requested || null,
          active: Boolean(activeRun),
          ...(activeRun?.ownerToken ? { ownerToken: activeRun.ownerToken } : {}),
        });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getTools') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    sendResponse({ tools: runOrchestrator.getToolImplementations() });
    return true;
  }

  return null;
}
