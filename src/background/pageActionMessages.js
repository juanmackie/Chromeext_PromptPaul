/**
 * @fileoverview Runtime message handling for the Act capability.
 * @module pageActionMessages
 */

/** Route Act messages using injected platform, authorization, and run dependencies. */
export function handlePageActionMessage(request, sender, dependencies) {
  const {
    chrome,
    extensionPageSender,
    getPageActionSiteOrigin,
    getProfileToolSupport,
    isAuthorizedRunRequest,
    pageActionDocumentProvider,
    pageActionSitePolicyStore,
    rejectUnauthorizedMessage,
    resolvePreferredProfile,
    runOrchestrator,
    sendResponse,
  } = dependencies;

  if (request.action === 'getActModelSupport') {
    if (!extensionPageSender) {
      sendResponse({
        success: false,
        error: 'Model support status requires a Prompt Paul extension page.',
      });
      return true;
    }
    chrome.storage.local
      .get(['profiles', 'lastSelectedProfileId'])
      .then(({ profiles, lastSelectedProfileId }) => {
        const saved = Array.isArray(profiles) ? profiles : [];
        const profile = resolvePreferredProfile({
          selectedProfile: saved.find((entry) => entry.id === lastSelectedProfileId),
          defaultProfile: saved.find((entry) => entry.id === 'default') || saved[0],
        });
        sendResponse({
          success: true,
          supportsTools: getProfileToolSupport(profile),
          modelName: String(profile?.modelName || '').slice(0, 256),
        });
      })
      .catch(() => sendResponse({ success: false, error: 'Model support status is unavailable.' }));
    return true;
  }

  if (request.action === 'setPageActionSitePolicy') {
    if (!extensionPageSender) {
      sendResponse({
        success: false,
        error: 'Site policy changes require a Prompt Paul extension page.',
      });
      return true;
    }
    pageActionSitePolicyStore
      .update(request.origin, request.policy)
      .then((policies) => sendResponse({ success: true, policies }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'pageActionDecision') {
    // Sender/run ownership validation: approval decisions must come from a
    // Prompt Paul extension page (the side panel), and the supplied source tab
    // must match the run's source tab: the opaque confirmation ID alone is
    // not enough to authorize an action.
    const decisionRun = runOrchestrator.activeRuns.get(request.runId);
    if (!extensionPageSender) {
      sendResponse({
        success: false,
        error: 'Approval decisions must come from the Prompt Paul extension.',
      });
      return true;
    }
    // A card can outlive its run (finished, stopped, timed out, or the worker
    // restarted). Say so instead of reporting a misleading sender failure.
    if (!decisionRun) {
      sendResponse({
        success: false,
        expired: true,
        error:
          'This approval is no longer waiting (the run ended, timed out, or was stopped). Send a new message to continue.',
      });
      return true;
    }
    if (!isAuthorizedRunRequest(request, sender)) {
      sendResponse({
        success: false,
        error:
          'This approval could not be verified for the current run. Reload Prompt Paul and try again.',
      });
      return true;
    }
    // Extension pages can run in a dedicated harness/options tab whose
    // sender.tab.id is not the web tab that owns the run. Prefer the explicit
    // source-tab token from trusted extension surfaces, then fall back to the
    // sender tab for side-panel messages that omit it.
    const senderTabId = request.sourceTabId ?? sender?.tab?.id;
    if (
      !decisionRun ||
      decisionRun.sourceTabId == null ||
      senderTabId !== decisionRun.sourceTabId
    ) {
      sendResponse({
        success: false,
        error: 'Approval decision does not match the run source tab.',
      });
      return true;
    }
    if (request.allowSite === true && request.approved === true) {
      const pending = decisionRun.pageActions?.pendingConfirmation;
      if (!pending || pending.id !== request.confirmationId || !pending.siteOrigin) {
        sendResponse({
          success: false,
          expired: true,
          error: 'The site approval is no longer waiting.',
        });
        return true;
      }
      void (async () => {
        const current = await pageActionDocumentProvider(
          decisionRun.pageActions.targetTabId || decisionRun.sourceTabId
        );
        if (getPageActionSiteOrigin(current?.url) !== pending.documentOrigin)
          throw new Error('The target site changed. Re-inspect before approving a site policy.');
        await pageActionSitePolicyStore.update(pending.siteOrigin, 'allow_low_risk');
        if (decisionRun.pageActions.pendingConfirmation !== pending) {
          sendResponse({
            success: false,
            expired: true,
            error: 'The approval expired. The site policy was saved, but no action was approved.',
          });
          return;
        }
        decisionRun.pageActions.sitePolicies = {
          ...decisionRun.pageActions.sitePolicies,
          [pending.siteOrigin]: 'allow_low_risk',
        };
        const accepted = runOrchestrator.resolvePageActionDecision(
          request.runId,
          request.confirmationId,
          true,
          false
        );
        sendResponse(
          accepted
            ? { success: true }
            : { success: false, expired: true, error: 'The approval is no longer waiting.' }
        );
      })().catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }
    const accepted = runOrchestrator.resolvePageActionDecision(
      request.runId,
      request.confirmationId,
      request.approved === true,
      request.approveAll === true
    );
    sendResponse(
      accepted
        ? { success: true }
        : {
            success: false,
            expired: true,
            error: 'This approval is no longer waiting (it was already answered or timed out).',
          }
    );
    return true;
  }

  if (request.action === 'pageUserInputResponse') {
    const expiredMessage =
      'This question is no longer waiting for an answer (it timed out or the run ended). Send a new message to continue.';
    if (!runOrchestrator.activeRuns.has(request.runId)) {
      sendResponse({ success: false, expired: true, error: expiredMessage });
      return true;
    }
    if (!isAuthorizedRunRequest(request, sender)) {
      sendResponse({ success: false, error: 'User input response is not authorized.' });
      return true;
    }
    const run = runOrchestrator.activeRuns.get(request.runId);
    if (run.sourceTabId == null || request.sourceTabId !== run.sourceTabId) {
      sendResponse({ success: false, error: 'User input response does not match the run.' });
      return true;
    }
    const accepted = runOrchestrator.resolvePageUserInput(
      request.runId,
      request.requestId,
      request.answer
    );
    sendResponse(
      accepted ? { success: true } : { success: false, expired: true, error: expiredMessage }
    );
    return true;
  }

  if (request.action === 'pageManualInterventionResume') {
    const expiredMessage = 'This step is no longer waiting (it timed out or the run ended).';
    if (!runOrchestrator.activeRuns.has(request.runId)) {
      sendResponse({ success: false, expired: true, error: expiredMessage });
      return true;
    }
    if (!isAuthorizedRunRequest(request, sender)) {
      sendResponse({ success: false, error: 'Manual-intervention response is not authorized.' });
      return true;
    }
    const run = runOrchestrator.activeRuns.get(request.runId);
    if (run.sourceTabId == null || request.sourceTabId !== run.sourceTabId) {
      sendResponse({
        success: false,
        error: 'Manual-intervention response does not match the run.',
      });
      return true;
    }
    const resumed = runOrchestrator.resolvePageManualIntervention(
      request.runId,
      request.requestId,
      request.resume === undefined ? true : request.resume === true
    );
    sendResponse(
      resumed ? { success: true } : { success: false, expired: true, error: expiredMessage }
    );
    return true;
  }

  if (request.action === 'abortRun') {
    const { runId } = request;
    if (!isAuthorizedRunRequest(request, sender)) {
      return rejectUnauthorizedMessage(sendResponse, 'Run abort is not authorized.');
    }
    runOrchestrator
      .abort(runId)
      .then((success) => sendResponse({ success: success !== false }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  return null;
}
