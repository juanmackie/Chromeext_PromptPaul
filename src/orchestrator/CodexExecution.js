/**
 * @fileoverview Codex Responses requests, event adaptation, and tool-call assembly.
 * @module CodexExecution
 */
import { getProviderTimeoutMs } from '../utils/runResilience.js';
import { buildCodexRequest, streamCodexResponse } from './CodexTransport.js';

class CodexExecutionMethods {
  async _executeCodex(run, tools, { allowRecovery = true, recovery = false } = {}) {
    if (!this.codexAuthProvider) {
      throw new Error('Codex subscription sign-in is not available in this build.');
    }
    const auth = await this.codexAuthProvider(run.config.profileId);
    if (!auth?.accessToken) {
      throw new Error('Connect this Codex profile to ChatGPT in Options before sending a prompt.');
    }

    run.completionProvider = 'codex';
    const eligibleSkills = this.skillManager.getEligibleSnapshot();
    const systemPrompt = this._buildSystemPrompt(run, eligibleSkills);
    this._compactProviderHistory(run);
    const body = buildCodexRequest({
      modelName: run.config.modelName,
      systemPrompt,
      messages: run.conversationHistory,
      tools,
      toolChoice: this._getEffectiveToolChoice(run),
      reasoningLevel: run.config.reasoningLevel,
    });

    try {
      for await (const event of streamCodexResponse({
        accessToken: auth.accessToken,
        accountId: auth.accountId,
        sessionId: run.id,
        body,
        signal: run.abortController.signal,
        timeoutMs: getProviderTimeoutMs(run.config.modelName, this.runResilience.requestTimeoutMs),
      })) {
        this._processCodexEvent(run, event);
      }
    } catch (error) {
      throw this._markProviderError(error);
    }

    if (run.activeToolCall || (run.activeToolCalls && run.activeToolCalls.size > 0)) {
      await this._finalizeToolCall(run);
    } else if (allowRecovery && this._shouldRecoverEvalDryRunToolMarkup(run)) {
      await this._executeEmptyResponseRecovery(
        run,
        () => this._executeOpenAI(run, [], { allowRecovery: false, recovery: true }),
        'Your previous output was a tool-call markup, but no tools are available now. Do not emit tool calls or markup. Give the user a concise natural-language final answer. The requested page change was not performed because the evaluation dry-run intercepted it; state that clearly and summarize only facts from the inspected page.'
      );
    } else if (allowRecovery && this._shouldRecoverToolMarkup(run)) {
      await this._executeEmptyResponseRecovery(
        run,
        () => this._executeCodex(run, tools, { allowRecovery: false, recovery: true }),
        this._toolMarkupRecoveryPrompt()
      );
    } else if (allowRecovery && this._shouldRecoverEmptyResponse(run)) {
      await this._executeEmptyResponseRecovery(run, () =>
        this._executeCodex(run, [], { allowRecovery: false, recovery: true })
      );
    } else {
      if (recovery && run.accumulatedText.trim()) run.recoverySucceeded = true;
      await this._finalizeTextResponse(run);
    }
  }

  _processCodexEvent(run, event) {
    const type = event?.type;
    if (!type) return;
    if (type === 'response.output_text.delta') {
      const delta = String(event.delta || '');
      if (delta) {
        this._appendAnswerWire(run, delta);
      }
      return;
    }
    if (
      type === 'response.reasoning_summary_text.delta' ||
      type === 'response.reasoning_text.delta'
    ) {
      const delta = String(event.delta || '');
      if (delta) {
        run.hasReasoning = true;
        this._emitEvent(run.id, { type: 'reasoning', data: delta });
      }
      return;
    }
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      const item = event.item;
      if (item?.type === 'function_call') this._recordCodexToolCall(run, item);
      return;
    }
    if (type === 'response.function_call_arguments.delta') {
      const toolCall = this._findCodexToolCall(run, event.item_id);
      if (toolCall) toolCall.function.arguments += String(event.delta || '');
      return;
    }
    if (type === 'response.function_call_arguments.done') {
      const toolCall = this._findCodexToolCall(run, event.item_id);
      if (toolCall) toolCall.function.arguments = String(event.arguments || '{}');
      return;
    }
    if (type === 'response.completed') {
      const response = event.response || {};
      this._recordCompletionUsage(run, response.usage);
      this._recordCompletionReason(run, response.status);
      for (const item of response.output || []) {
        if (item?.type === 'function_call') this._recordCodexToolCall(run, item);
      }
      return;
    }
    if (type === 'error' || type === 'response.failed') {
      throw new Error(event.error?.message || event.message || 'Codex response failed.');
    }
  }

  _recordCodexToolCall(run, item) {
    if (!run.activeToolCalls) run.activeToolCalls = new Map();
    const id = String(item.call_id || item.id || `codex-tool-${run.activeToolCalls.size}`);
    const existing = run.activeToolCalls.get(id);
    if (existing) {
      if (item.name) existing.function.name = item.name;
      if (item.arguments != null) existing.function.arguments = String(item.arguments);
      return;
    }
    run.activeToolCalls.set(id, {
      id,
      type: 'function',
      function: {
        name: String(item.name || ''),
        arguments: String(item.arguments || ''),
      },
    });
  }

  _findCodexToolCall(run, itemId) {
    if (!itemId || !run.activeToolCalls) return null;
    return run.activeToolCalls.get(String(itemId)) || null;
  }
}

export function installCodexExecutionMethods(target) {
  for (const name of Object.getOwnPropertyNames(CodexExecutionMethods.prototype)) {
    if (name === 'constructor') continue;
    Object.defineProperty(
      target.prototype,
      name,
      Object.getOwnPropertyDescriptor(CodexExecutionMethods.prototype, name)
    );
  }
}
