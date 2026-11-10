/**
 * @fileoverview Hermes session execution and client-tool lifecycle.
 * @module HermesExecution
 */
import { buildHermesTurn } from '../utils/hermesContext.js';
import { extractHermesOutputText, normalizeHermesEvent } from './HermesTransport.js';
import {
  getMind2WebPageTools,
  getPageActionTools,
  getPageTabTools,
  getPageTaskMemoryTools,
  getPageUserInputTools,
  pageScrollLocationKey,
} from '../act/index.js';
import {
  isPageActionName,
  isPageManualInterventionActionName,
  isPageTabActionName,
  isPageUserInputActionName,
} from '../utils/pageActionPolicy.js';

class HermesExecutionMethods {
  _getHermesProfile(config) {
    return {
      id: String(config?.profileId || '').trim(),
      hermesEndpoint: String(config?.hermesEndpoint || config?.llmEndpoint || '').trim(),
      hermesProfile: String(config?.hermesProfile || '').trim(),
      hermesRemoteConfirmed: config?.hermesRemoteConfirmed === true,
    };
  }

  _getHermesTurn(run) {
    return buildHermesTurn(run.conversationHistory, {
      modelId: run.config.modelName,
      instructions: this._buildHermesInstructions(run),
    });
  }

  _getHermesCurrentTurnInput(messages) {
    return buildHermesTurn(messages).input;
  }

  _buildHermesInstructions(run) {
    // Hermes receives the same Act instructions as the local providers when
    // the gateway has opted into client tools. The tool declaration remains a
    // separate structured field on the run request.
    return this._buildSystemPrompt(run, []).trim();
  }

  async _waitForHermesRun(profile, remoteRunId, sessionKey, signal, initialError) {
    const deadline = Date.now() + 5 * 60 * 1000;
    let lastError = initialError;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      try {
        const status = await this.hermesTransport.getRunStatus(profile, remoteRunId, {
          sessionKey,
          signal,
        });
        const value = String(status?.status || '').toLowerCase();
        if (['completed', 'failed', 'cancelled', 'stopped'].includes(value)) return status;
      } catch (error) {
        if ([400, 401, 403, 404].includes(error?.status)) throw error;
        lastError = error;
      }
      await new Promise((resolve, reject) => {
        let timer;
        const onAbort = () => {
          cleanup();
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        };
        const cleanup = () => {
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
        };
        timer = setTimeout(() => {
          cleanup();
          resolve();
        }, 1000);
        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
    throw lastError || new Error('Hermes run status did not reach a terminal state.');
  }

  _applyHermesRecoveredOutput(run, output) {
    const recovered = extractHermesOutputText(output);
    if (!recovered) return;
    const current = run.answerCardDecoder ? run.answerWireText || '' : run.accumulatedText || '';
    if (!current) {
      if (run.answerCardDecoder) this._replaceAnswerWire(run, recovered);
      else {
        run.accumulatedText = recovered;
        this._emitEvent(run.id, { type: 'content', data: recovered });
      }
    } else if (recovered.startsWith(current)) {
      const remainder = recovered.slice(current.length);
      if (remainder) this._appendAnswerWire(run, remainder);
    } else {
      // The status payload is authoritative when the stream used a different
      // chunking or formatting. The terminal event replaces the stale partial
      // bubble, so do not append divergent text and duplicate the answer.
      if (run.answerCardDecoder) this._replaceAnswerWire(run, recovered);
      else run.accumulatedText = recovered;
    }
  }

  /**
   * Execute a run through the Hermes gateway. Hermes owns server-side tools;
   * Prompt Paul only renders their bounded lifecycle events.
   * @param {object} run
   * @returns {Promise<void>}
   * @private
   */
  _isHermesClientToolName(name) {
    return Boolean(
      isPageActionName(name) ||
      isPageTabActionName(name) ||
      isPageUserInputActionName(name) ||
      isPageManualInterventionActionName(name) ||
      name === 'page_record_note' ||
      name === 'page_update_plan'
    );
  }

  async _executeHermes(run) {
    if (!this.hermesTransport) {
      throw new Error('Hermes support is not available in this build.');
    }
    if (run.pageActions?.enabled && !run.hermes?.clientToolsEnabled) {
      throw new Error(
        'Hermes gateway does not advertise the client-tool protocol required for Act.'
      );
    }

    const profile = this._getHermesProfile(run.config);
    if (!profile.id || !profile.hermesEndpoint) {
      throw new Error('Configure a Hermes gateway endpoint in Options before sending a prompt.');
    }
    const activeProfileRun = this.hermesProfileRuns.get(profile.id);
    if (activeProfileRun && activeProfileRun !== run.id) {
      throw new Error('A Hermes response is already running for this profile.');
    }
    this.hermesProfileRuns.set(profile.id, run.id);

    const sessionKey = await this.hermesTransport.getSessionKey(profile.id);
    run.hermes.sessionKey = sessionKey;
    const conversationId = String(run.config.conversationId || '').trim();
    const hasSessionRecords = typeof this.hermesTransport.getStoredSessionRecord === 'function';
    const stored = hasSessionRecords
      ? await this.hermesTransport.getStoredSessionRecord(profile.id)
      : { sessionId: await this.hermesTransport.getStoredSession(profile.id), conversationId: '' };
    let sessionId = stored.sessionId;
    if (
      sessionId &&
      conversationId &&
      hasSessionRecords &&
      stored.conversationId !== conversationId
    ) {
      if (typeof this.hermesTransport.endSession === 'function') {
        await this.hermesTransport.endSession(profile, sessionId);
      }
      await this.hermesTransport.clearStoredSession(profile.id);
      sessionId = '';
    }
    if (!sessionId) {
      sessionId = await this.hermesTransport.ensureSession(profile);
      await this.hermesTransport.storeSession(profile.id, sessionId, conversationId);
    }
    run.hermes.sessionId = sessionId;

    const hermesTurn = this._getHermesTurn(run);
    const instructions = this._buildHermesInstructions(run);
    const scrollLocationKey = pageScrollLocationKey(run);
    if (
      run.pageActions?.scrollStalled &&
      run.pageActions.scrollStallLocationKey !== scrollLocationKey
    ) {
      run.pageActions.scrollStalled = false;
      run.pageActions.scrollStallLocationKey = '';
      run.pageActions.scrollStallRejectedCalls = 0;
      run.pageActions.scrollPositionVisits?.clear();
      run.pageActions.noProgressScrollCount = 0;
      run.pageActions.noProgressScrollKeys?.clear();
    }
    const clientTools = run.pageActions?.enabled
      ? run.config?.evalTaskMode === 'mind2web'
        ? getMind2WebPageTools()
        : [
            ...getPageActionTools().filter(
              (tool) => !run.pageActions.scrollStalled || tool.function?.name !== 'page_scroll'
            ),
            ...getPageUserInputTools(),
            ...getPageTaskMemoryTools(),
            ...getPageTabTools(),
          ]
      : [];

    let started;
    try {
      started = await this.hermesTransport.startRun(profile, {
        input: hermesTurn.input,
        conversationHistory: hermesTurn.conversationHistory,
        sessionId,
        instructions,
        model: String(run.config.modelName || '').trim(),
        clientTools,
        sessionKey,
        signal: run.abortController.signal,
      });
    } catch (error) {
      if (error?.status !== 404 || error?.code !== 'session_not_found' || !sessionId) throw error;
      await this.hermesTransport.clearStoredSession(profile.id);
      sessionId = await this.hermesTransport.ensureSession(profile);
      await this.hermesTransport.storeSession(profile.id, sessionId, conversationId);
      run.hermes.sessionId = sessionId;
      started = await this.hermesTransport.startRun(profile, {
        input: hermesTurn.input,
        conversationHistory: hermesTurn.conversationHistory,
        sessionId,
        instructions,
        model: String(run.config.modelName || '').trim(),
        clientTools,
        sessionKey,
        signal: run.abortController.signal,
      });
    }
    run.hermes.remoteRunId = started.runId;
    if (started.sessionId && started.sessionId !== sessionId) {
      run.hermes.sessionId = started.sessionId;
      await this.hermesTransport.storeSession(profile.id, started.sessionId, conversationId);
    }

    let terminal = null;
    let streamError = null;
    const onEvent = async (event) => {
      if (!this.activeRuns.has(run.id)) return;
      const normalized = normalizeHermesEvent(event);
      if (!normalized) return;
      if (normalized.type === 'content') {
        this._appendAnswerWire(run, normalized.data);
      } else if (normalized.type === 'reasoning') {
        run.hasReasoning = true;
        this._emitEvent(run.id, normalized);
      } else if (normalized.type === 'hermes_terminal') {
        terminal = normalized;
        if (normalized.output !== undefined)
          this._applyHermesRecoveredOutput(run, normalized.output);
        this._recordCompletionUsage(run, normalized.usage);
      } else if (normalized.type === 'hermes_client_tool_call') {
        this._invalidateAnswerCards(run);
        run.answerProgressParser?.disable();
        const toolCall = normalized.toolCall;
        const toolCallId = String(toolCall?.id || '').trim();
        const toolName = String(toolCall?.function?.name || '').trim();
        if (!toolCallId || !toolName) {
          throw new Error('Hermes returned an invalid client-tool request.');
        }

        this._emitEvent(run.id, {
          type: 'tool_start',
          capability: 'hermes_client',
          toolCall: {
            id: toolCallId,
            type: 'client_tool',
            function: { name: toolName },
          },
        });

        run.hermes.clientToolResults ||= new Map();
        let result = run.hermes.clientToolResults.get(toolCallId);
        if (!result) {
          try {
            if (this._isHermesClientToolName(toolName)) {
              result = await this.executeTool(run.id, toolCall);
            } else {
              result = {
                success: true,
                result: {
                  error: 'UNKNOWN_CAPABILITY',
                  message: 'This client tool is not available to Hermes.',
                },
              };
            }
          } catch (toolError) {
            // Abort propagates so the run can stop cleanly. Any other failure
            // must still reach the gateway as a tool result, or the remote run
            // stays blocked waiting for an answer that never arrives.
            if (toolError instanceof DOMException && toolError.name === 'AbortError') {
              throw toolError;
            }
            result = {
              success: false,
              result: {
                error: 'CLIENT_TOOL_FAILED',
                message: String(toolError?.message || 'The client tool failed.').slice(0, 240),
              },
            };
          }
          run.hermes.clientToolResults.set(toolCallId, result);
        }

        try {
          await this.hermesTransport.submitToolResult(profile, started.runId, toolCallId, result, {
            sessionKey,
          });
        } catch (submitError) {
          if (submitError instanceof DOMException && submitError.name === 'AbortError') {
            throw submitError;
          }
          // The gateway did not accept the result. Surface it and let the
          // existing status-polling recovery report the remote outcome.
          throw new Error(
            `Hermes did not accept the client-tool result: ${
              submitError?.message || 'submission failed.'
            }`,
            { cause: submitError }
          );
        }
        this._emitEvent(run.id, {
          type: 'tool_complete',
          capability: 'hermes_client',
          toolCall: {
            id: toolCallId,
            type: 'client_tool',
            function: { name: toolName },
          },
          result: {
            success: result?.success === true,
            summary: String(
              result?.result?.message || result?.result?.error || 'Client tool completed.'
            ).slice(0, 240),
          },
        });
      } else if (normalized.type === 'hermes_approval_required') {
        run.hermes.pendingApproval = normalized;
        this._emitEvent(run.id, normalized);
      } else if (normalized.type === 'hermes_approval_updated') {
        if (run.hermes.pendingApproval?.approvalId === normalized.approvalId) {
          run.hermes.pendingApproval = null;
        }
        this._emitEvent(run.id, normalized);
      } else {
        this._emitEvent(run.id, normalized);
      }
    };
    try {
      await this.hermesTransport.streamRun(profile, started.runId, {
        sessionKey,
        signal: run.abortController.signal,
        onEvent,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error?.code === 'REPETITIVE_OUTPUT') throw error;
      streamError = error;
    }

    if (!this.activeRuns.has(run.id)) return;
    const needsCompletedOutputRecovery =
      terminal?.status === 'complete' && !run.accumulatedText.trim() && !terminal.output;
    if (!terminal || (streamError && !terminal.output) || needsCompletedOutputRecovery) {
      const status = await this._waitForHermesRun(
        profile,
        started.runId,
        sessionKey,
        run.abortController.signal,
        streamError
      );
      const statusValue = String(status?.status || '').toLowerCase();
      if (statusValue === 'completed') {
        this._applyHermesRecoveredOutput(run, status.output);
        terminal = { status: 'complete' };
      } else if (['cancelled', 'stopped'].includes(statusValue)) {
        terminal = { status: 'stopped' };
      } else if (statusValue === 'failed') {
        terminal = { status: 'error', error: status.error || 'Hermes run failed.' };
      }
    }

    if (!this.activeRuns.has(run.id)) return;
    if (terminal?.status === 'stopped') {
      this._terminateRun(run.id, { type: 'aborted' }, { run });
      return;
    }
    if (terminal?.status === 'error') {
      throw new Error(terminal.error || 'Hermes run failed.');
    }
    await this._finalizeTextResponse(run);
  }

  /**
   * Resolve a Hermes server approval for a live run.
   * @param {string} runId
   * @param {string} choice
   * @returns {Promise<boolean>}
   */
  async resolveHermesApproval(runId, approvalId, choice) {
    const run = this.activeRuns.get(runId);
    const pending = run?.hermes?.pendingApproval;
    if (
      !run ||
      run.config?.provider !== 'hermes' ||
      !run.hermes?.remoteRunId ||
      !pending?.approvalId ||
      pending.approvalId !== String(approvalId || '').trim()
    ) {
      return false;
    }
    await this.hermesTransport.respondToApproval(
      this._getHermesProfile(run.config),
      run.hermes.remoteRunId,
      choice,
      { sessionKey: run.hermes.sessionKey }
    );
    run.hermes.pendingApproval = null;
    this._emitEvent(runId, {
      type: 'hermes_approval_updated',
      approvalId: pending.approvalId,
      choice,
    });
    return true;
  }
}

export function installHermesExecutionMethods(target) {
  for (const name of Object.getOwnPropertyNames(HermesExecutionMethods.prototype)) {
    if (name === 'constructor') continue;
    Object.defineProperty(
      target.prototype,
      name,
      Object.getOwnPropertyDescriptor(HermesExecutionMethods.prototype, name)
    );
  }
}
