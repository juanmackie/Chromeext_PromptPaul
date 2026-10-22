/**
 * @fileoverview Test-only direct Act-mode message hook for the evaluation build.
 * @module evalHookEvaluation
 */

import {
  beginEvalTrace,
  finishEvalTrace,
  getEvalTrace,
  recordEvalTrace,
  setEvalTraceActionCallback,
} from './evalTrace.js';

const MAX_TASK_ID_CHARS = 128;
const MAX_TASK_CHARS = 4_000;
const TASK_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function fail(sendResponse, error, code = 'EVAL_TASK_INVALID') {
  sendResponse({ success: false, code, error });
  return true;
}

function normalizeRequest(request) {
  const taskId = String(request?.taskId || '').trim();
  const task = String(request?.task || '').trim();
  if (!TASK_ID_PATTERN.test(taskId) || taskId.length > MAX_TASK_ID_CHARS) {
    return { error: 'A bounded taskId is required.' };
  }
  if (!task || task.length > MAX_TASK_CHARS) {
    return { error: `Task text must contain 1-${MAX_TASK_CHARS} characters.` };
  }
  const profileId = String(request?.profileId || '').trim();
  if (!profileId || profileId.length > 128) return { error: 'A saved profileId is required.' };
  const sourceTabId = Number(request?.sourceTabId);
  if (!Number.isInteger(sourceTabId) || sourceTabId < 1) {
    return { error: 'A valid sourceTabId is required.' };
  }
  const taskMode = request?.taskMode == null ? null : String(request.taskMode);
  if (taskMode !== null && taskMode !== 'mind2web') {
    return { error: 'Unsupported evaluation task mode.' };
  }
  const evalTemperature = request?.temperature == null ? null : Number(request.temperature);
  if (
    evalTemperature !== null &&
    (!Number.isFinite(evalTemperature) || evalTemperature < 0 || evalTemperature > 1)
  ) {
    return { error: 'Evaluation temperature must be between 0 and 1.' };
  }
  return {
    taskId,
    task,
    profileId,
    sourceTabId,
    dryRun: request?.dryRun !== false,
    taskMode,
    evalTemperature,
  };
}

function normalizeInspectionRequest(request) {
  const taskId = String(request?.taskId || '').trim();
  const task = String(request?.task || '').trim();
  const profileId = String(request?.profileId || '').trim();
  const sourceTabId = Number(request?.sourceTabId);
  if (!TASK_ID_PATTERN.test(taskId) || taskId.length > MAX_TASK_ID_CHARS) {
    return { error: 'A bounded taskId is required.' };
  }
  if (!task || task.length > MAX_TASK_CHARS) {
    return { error: `Task text must contain 1-${MAX_TASK_CHARS} characters.` };
  }
  if (!profileId || profileId.length > 128) return { error: 'A saved profileId is required.' };
  if (!Number.isInteger(sourceTabId) || sourceTabId < 1) {
    return { error: 'A valid sourceTabId is required.' };
  }
  return { taskId, task, profileId, sourceTabId };
}

/**
 * Install the direct test hook. This implementation is copied only into the
 * generated evaluation extension build.
 * @param {object} dependencies
 * @returns {void}
 */
export function registerEvalRunHook(dependencies = {}) {
  const {
    getExtensionOrigin,
    isExtensionSender,
    resolveStoredRunConfig,
    runOrchestrator,
    createOwnerToken,
  } = dependencies;
  if (
    typeof chrome === 'undefined' ||
    !chrome.runtime?.onMessage ||
    typeof isExtensionSender !== 'function' ||
    typeof runOrchestrator?.startRun !== 'function'
  ) {
    return;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!['TEST_RUN_TASK', 'TEST_INSPECT_PAGE', 'TEST_GET_TRACE'].includes(request?.action)) {
      return false;
    }
    if (!isExtensionSender(sender, getExtensionOrigin?.())) {
      return fail(
        sendResponse,
        'Evaluation tasks must come from a Prompt Paul page.',
        'UNAUTHORIZED'
      );
    }
    if (request.action === 'TEST_GET_TRACE') {
      const runId = String(request?.runId || '').trim();
      if (!TASK_ID_PATTERN.test(runId) || runId.length > MAX_TASK_ID_CHARS) {
        return fail(sendResponse, 'A bounded runId is required.');
      }
      sendResponse({ success: true, trace: getEvalTrace(runId) });
      return false;
    }
    if (request.action === 'TEST_INSPECT_PAGE') {
      const normalized = normalizeInspectionRequest(request);
      if (normalized.error) return fail(sendResponse, normalized.error);
      const ownerToken = createOwnerToken();
      let runId = '';
      let runAbortAttempted = false;
      const recordAbortFailure = (error) => {
        recordEvalTrace(runId, {
          kind: 'abort_error',
          error: error?.message || String(error),
        });
      };
      Promise.resolve()
        .then(async () => {
          const config = await resolveStoredRunConfig({
            profileId: normalized.profileId,
            pageActions: true,
            pageActionsMultiTab: true,
            sourceTabId: normalized.sourceTabId,
            tool_choice: 'auto',
            webSearch: false,
            messages: [],
            evalTaskId: normalized.taskId,
            evalDryRun: true,
            evalTaskMode: 'mind2web',
          });
          try {
            const { pageActionsPreciseInput } =
              await chrome.storage.local.get('pageActionsPreciseInput');
            config.pageActionsPreciseInput = pageActionsPreciseInput === true;
          } catch (_) {
            config.pageActionsPreciseInput = false;
          }
          runId = await runOrchestrator.startRun(config, ownerToken);
          beginEvalTrace({
            taskId: normalized.taskId,
            runId,
            task: normalized.task,
            dryRun: true,
          });
          const toolCall = {
            id: `eval-inspect-${normalized.taskId}`.slice(0, 128),
            function: { name: 'page_get_state', arguments: '{}' },
          };
          let inspectionError = null;
          try {
            const result = await runOrchestrator.executeTool(runId, toolCall);
            recordEvalTrace(runId, {
              kind: 'action',
              action: toolCall,
              actionResult: result,
            });
            const snapshot = result?.result?.snapshot || result?.snapshot;
            const actionError = result?.result?.error || result?.error;
            if (result?.success === false || actionError || !snapshot) {
              throw new Error(
                result?.result?.message || actionError || 'Page inspection returned no snapshot.'
              );
            }
          } catch (error) {
            inspectionError = error;
            if (!getEvalTrace(runId)?.steps.some((step) => step.action_taken?.id === toolCall.id)) {
              recordEvalTrace(runId, {
                kind: 'action',
                action: toolCall,
                actionResult: { error: error?.message || String(error) },
                error: error?.message || String(error),
              });
            }
          }
          runAbortAttempted = true;
          let abortError = null;
          try {
            await runOrchestrator.abort(runId);
          } catch (error) {
            recordAbortFailure(error);
            abortError = error;
          }
          finishEvalTrace(runId, {
            type: inspectionError ? 'error' : 'inspection_preflight',
            error: inspectionError?.message || undefined,
          });
          if (abortError) throw abortError;
          if (inspectionError) throw inspectionError;
          return getEvalTrace(runId);
        })
        .then((trace) => sendResponse({ success: true, trace }))
        .catch((error) => {
          if (runId && !runAbortAttempted) {
            runAbortAttempted = true;
            try {
              const pendingAbort = runOrchestrator.abort(runId);
              Promise.resolve(pendingAbort).catch(recordAbortFailure);
            } catch (abortError) {
              recordAbortFailure(abortError);
            }
          }
          if (runId) {
            finishEvalTrace(runId, { type: 'error', error: error?.message || String(error) });
          }
          sendResponse({ success: false, error: error?.message || String(error) });
        });
      return true;
    }
    const normalized = normalizeRequest(request);
    if (normalized.error) return fail(sendResponse, normalized.error);

    const ownerToken = createOwnerToken();
    let abortPromise = null;
    let abortFailure = null;
    const recordAbortFailure = (runId, error) => {
      abortFailure = error;
      recordEvalTrace(runId, {
        kind: 'abort_error',
        error: error?.message || String(error),
      });
      const activeRun = runOrchestrator.activeRuns?.get?.(runId);
      if (
        activeRun &&
        activeRun.config?.provider !== 'hermes' &&
        typeof runOrchestrator._terminateRun === 'function'
      ) {
        runOrchestrator._terminateRun(runId, { type: 'aborted' }, { abortSignal: true });
      }
    };
    Promise.resolve()
      .then(async () => {
        const config = await resolveStoredRunConfig({
          profileId: normalized.profileId,
          pageActions: true,
          pageActionsMultiTab: true,
          sourceTabId: normalized.sourceTabId,
          tool_choice: 'auto',
          webSearch: false,
          messages: [],
          evalTaskId: normalized.taskId,
          evalDryRun: normalized.dryRun,
          evalTaskMode: normalized.taskMode,
          evalTemperature: normalized.evalTemperature,
        });
        // Honor the opt-in precise-input preference exactly as the production
        // startRun path does, so an eval task that exercises trusted input is
        // not silently downgraded to DOM dispatch.
        try {
          const { pageActionsPreciseInput } =
            await chrome.storage.local.get('pageActionsPreciseInput');
          config.pageActionsPreciseInput = pageActionsPreciseInput === true;
        } catch (_) {
          config.pageActionsPreciseInput = false;
        }
        const runId = await runOrchestrator.startRun(config, ownerToken);
        beginEvalTrace({
          taskId: normalized.taskId,
          runId,
          task: normalized.task,
          dryRun: normalized.dryRun,
        });
        if (normalized.taskMode === 'mind2web' && normalized.dryRun) {
          setEvalTraceActionCallback(runId, () => {
            runOrchestrator.activeRuns?.get?.(runId)?.abortController?.abort();
            try {
              abortPromise = Promise.resolve(runOrchestrator.abort(runId)).then(
                () => null,
                (error) => {
                  recordAbortFailure(runId, error);
                  return error;
                }
              );
            } catch (error) {
              recordAbortFailure(runId, error);
              abortPromise = Promise.resolve(error);
            }
          });
        }
        return { runId, ownerToken };
      })
      .then(({ runId, ownerToken: token }) => {
        sendResponse({
          success: true,
          accepted: true,
          taskId: normalized.taskId,
          runId,
          ownerToken: token,
          sourceTabId: normalized.sourceTabId,
          dryRun: normalized.dryRun,
        });
        void runOrchestrator
          .execute(runId, { messages: [{ role: 'user', content: normalized.task }] })
          .then(async () => {
            if (abortPromise) await abortPromise;
            const trace = getEvalTrace(runId);
            const captured =
              normalized.taskMode === 'mind2web' &&
              normalized.dryRun &&
              trace?.measurement?.terminalReason === 'prediction_captured';
            const abortError = abortFailure?.message || (abortFailure ? String(abortFailure) : '');
            const result =
              finishEvalTrace(runId, {
                type: abortError ? 'abort_error' : captured ? 'prediction_captured' : 'complete',
                error: abortError || undefined,
              }) || getEvalTrace(runId);
            chrome.runtime.sendMessage({
              action: 'TEST_RUN_TASK_RESULT',
              taskId: normalized.taskId,
              runId,
              result,
            });
          })
          .catch(async (error) => {
            if (abortPromise) await abortPromise;
            const trace = getEvalTrace(runId);
            const captured =
              normalized.taskMode === 'mind2web' &&
              normalized.dryRun &&
              trace?.measurement?.terminalReason === 'prediction_captured';
            const abortError = abortFailure?.message || (abortFailure ? String(abortFailure) : '');
            const result = finishEvalTrace(runId, {
              type: abortError ? 'abort_error' : captured ? 'prediction_captured' : 'error',
              error: abortError || (captured ? undefined : error?.message || String(error)),
            });
            chrome.runtime.sendMessage({
              action: 'TEST_RUN_TASK_RESULT',
              taskId: normalized.taskId,
              runId,
              result,
            });
          });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  });
}
