/**
 * @fileoverview Test-only direct Act-mode message hook for the evaluation build.
 * @module evalHookEvaluation
 */

import { beginEvalTrace, finishEvalTrace, getEvalTrace } from './evalTrace.js';

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
    if (request?.action !== 'TEST_RUN_TASK') return false;
    if (!isExtensionSender(sender, getExtensionOrigin?.())) {
      return fail(
        sendResponse,
        'Evaluation tasks must come from a Prompt Paul page.',
        'UNAUTHORIZED'
      );
    }
    const normalized = normalizeRequest(request);
    if (normalized.error) return fail(sendResponse, normalized.error);

    const ownerToken = createOwnerToken();
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
          .then(() => {
            const result = finishEvalTrace(runId, { type: 'complete' }) || getEvalTrace(runId);
            chrome.runtime.sendMessage({
              action: 'TEST_RUN_TASK_RESULT',
              taskId: normalized.taskId,
              runId,
              result,
            });
          })
          .catch((error) => {
            const result = finishEvalTrace(runId, {
              type: 'error',
              error: error?.message || String(error),
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
