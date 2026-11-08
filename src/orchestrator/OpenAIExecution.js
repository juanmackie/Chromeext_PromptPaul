/**
 * @fileoverview OpenAI-compatible request, SSE, and delta processing.
 * @module OpenAIExecution
 */
import { appendBoundedSseBuffer, readBoundedResponseText } from '../utils/streamSafety.js';
import {
  createTimeoutSignal,
  getProviderTimeoutMs,
  redactProviderErrorMessage,
} from '../utils/runResilience.js';
import { recordEvalTrace } from '../utils/evalTrace.js';
import { createThinkParser } from '../utils/inlineReasoning.js';

const OPENROUTER_APP_URL = 'https://promptpaul.juanmackie.com';
const OPENROUTER_APP_TITLE = 'Prompt Paul';

function isOpenRouterEndpoint(endpoint) {
  try {
    return new URL(endpoint).hostname === 'openrouter.ai';
  } catch (_) {
    return false;
  }
}

export class OpenAIExecutionMethods {
  async _executeOpenAI(run, tools, { allowRecovery = true, recovery = false } = {}) {
    const { llmEndpoint, apiKey, modelName } = run.config;
    run.completionProvider = 'openai-compatible';
    run.evalProviderCallCount = (run.evalProviderCallCount || 0) + 1;
    const providerCallIndex = run.evalProviderCallCount;
    const providerStartedAt = Date.now();
    recordEvalTrace(run.id, {
      kind: 'provider_timing',
      eventType: 'request_started',
      providerCallIndex,
    });

    // Build messages exclusively from run.conversationHistory (already includes
    // requestConfig.messages absorbed in execute()).
    const eligibleSkills = this.skillManager.getEligibleSnapshot();
    const systemPrompt = this._buildSystemPrompt(run, eligibleSkills);
    this._compactProviderHistory(run);
    const messages = this._stripInternalContextMarkers(
      run.conversationHistory.filter((m) => m.role !== 'system')
    );
    messages.unshift({ role: 'system', content: systemPrompt });
    const body = {
      model: modelName,
      messages,
      stream: true,
    };
    if (run.config?.evalTaskMode === 'mind2web' && Number.isFinite(run.config?.evalTemperature)) {
      body.temperature = run.config.evalTemperature;
    }
    this._applyOpenAIOutputBudget(body, modelName);

    const effectiveToolChoice = this._getEffectiveToolChoice(run);
    if (effectiveToolChoice !== 'none' && tools.length > 0) {
      body.tools = tools;
      if (effectiveToolChoice === 'required') {
        body.tool_choice = 'required';
        body.parallel_tool_calls = false;
      } else {
        body.tool_choice =
          effectiveToolChoice === 'auto'
            ? 'auto'
            : { type: 'function', function: { name: effectiveToolChoice } };
      }
    }

    const requestTimeout = createTimeoutSignal(
      run.abortController.signal,
      getProviderTimeoutMs(modelName, this.runResilience.requestTimeoutMs)
    );
    // Attribute per-turn latency to the request size. A growing page-action
    // history is the main real-world slowdown on long tasks; without this the
    // trace cannot separate a slow provider from a bloated context.
    const payload = JSON.stringify(body);
    recordEvalTrace(run.id, {
      kind: 'provider_request',
      providerCallIndex,
      messageCount: messages.length,
      payloadChars: payload.length,
      toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
      temperature: body.temperature,
      providerMessages: messages.length > 6 ? [messages[0], ...messages.slice(-5)] : messages,
    });
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    if (isOpenRouterEndpoint(llmEndpoint)) {
      headers['HTTP-Referer'] = OPENROUTER_APP_URL;
      headers['X-OpenRouter-Title'] = OPENROUTER_APP_TITLE;
    }

    let response;
    try {
      response = await fetch(llmEndpoint, {
        method: 'POST',
        headers,
        body: payload,
        signal: requestTimeout.signal,
      });
    } catch (error) {
      requestTimeout.cleanup();
      recordEvalTrace(run.id, {
        kind: 'provider_timing',
        eventType: 'request_failed',
        providerCallIndex,
        durationMs: Date.now() - providerStartedAt,
        error: error?.code || error?.message || 'provider request failed',
      });
      if (requestTimeout.timedOut && !run.abortController.signal.aborted) {
        const timeoutError = new Error('Provider request timed out.');
        timeoutError.code = 'provider_timeout';
        throw this._markProviderError(timeoutError);
      }
      throw this._markProviderError(error);
    }

    if (!response.ok) {
      const errorText = await readBoundedResponseText(response);
      const toolHint =
        run.webSearch?.enabled && (response.status === 400 || response.status === 422)
          ? ' The selected endpoint may not support function calling; disable Web grounding or choose a tool-capable model.'
          : '';
      const error = new Error(
        `API error ${response.status}: ${redactProviderErrorMessage(errorText)}${toolHint}`
      );
      requestTimeout.cleanup();
      recordEvalTrace(run.id, {
        kind: 'provider_timing',
        eventType: 'request_rejected',
        providerCallIndex,
        durationMs: Date.now() - providerStartedAt,
        error: `http_${response.status}`,
      });
      throw this._markProviderError(error, response.status);
    }

    try {
      recordEvalTrace(run.id, {
        kind: 'provider_timing',
        eventType: 'response_headers_received',
        providerCallIndex,
        durationMs: Date.now() - providerStartedAt,
        servedModelId: response.headers?.get?.('x-openrouter-model') || undefined,
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let firstChunkRecorded = false;
      let servedModelRecorded = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!firstChunkRecorded) {
          firstChunkRecorded = true;
          recordEvalTrace(run.id, {
            kind: 'provider_timing',
            eventType: 'first_stream_chunk',
            providerCallIndex,
            durationMs: Date.now() - providerStartedAt,
          });
        }

        buffer = appendBoundedSseBuffer(buffer, decoder.decode(value, { stream: true }));
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;

          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (!servedModelRecorded && typeof parsed.model === 'string') {
              servedModelRecorded = true;
              recordEvalTrace(run.id, {
                kind: 'provider_timing',
                eventType: 'served_model',
                providerCallIndex,
                servedModelId: parsed.model,
              });
            }
            await this._processOpenAIChunk(run, parsed);
          } catch (error) {
            if (error?.code === 'REPETITIVE_OUTPUT') throw error;
            console.warn('[Orchestrator] Failed to parse chunk:', error.message);
          }
        }
      }
      recordEvalTrace(run.id, {
        kind: 'provider_timing',
        eventType: 'stream_completed',
        providerCallIndex,
        durationMs: Date.now() - providerStartedAt,
      });
    } catch (error) {
      recordEvalTrace(run.id, {
        kind: 'provider_timing',
        eventType: 'stream_failed',
        providerCallIndex,
        durationMs: Date.now() - providerStartedAt,
        error: error?.code || error?.message || 'provider stream failed',
      });
      if (requestTimeout.timedOut && !run.abortController.signal.aborted) {
        const timeoutError = new Error('Provider request timed out.');
        timeoutError.code = 'provider_timeout';
        throw this._markProviderError(timeoutError);
      }
      throw this._markProviderError(error);
    } finally {
      requestTimeout.cleanup();
    }

    // Drain any tail held back while waiting on a possible inline-think tag.
    const tail = run.thinkParser.flush();
    if (tail.reasoning) {
      run.hasReasoning = true;
      this._emitEvent(run.id, { type: 'reasoning', data: tail.reasoning });
    }
    if (tail.content) {
      this._appendAnswerWire(run, tail.content);
    }

    // Finalize based on what we have. When there's no tool call we always finalize
    // the text response: even with empty/whitespace text: so a terminal `complete`
    // event is emitted and the UI unlocks instead of hanging.
    if (run.activeToolCall || (run.activeToolCalls && run.activeToolCalls.size > 0)) {
      await this._finalizeToolCall(run);
    } else if (allowRecovery && this._shouldRecoverToolMarkup(run)) {
      await this._executeEmptyResponseRecovery(
        run,
        () => this._executeOpenAI(run, tools, { allowRecovery: false, recovery: true }),
        this._toolMarkupRecoveryPrompt()
      );
    } else if (allowRecovery && this._shouldRecoverEmptyResponse(run)) {
      await this._executeEmptyResponseRecovery(run, () =>
        this._executeOpenAI(run, [], { allowRecovery: false, recovery: true })
      );
    } else {
      if (recovery && run.accumulatedText.trim()) run.recoverySucceeded = true;
      await this._finalizeTextResponse(run);
    }
  }

  async _processOpenAIChunk(run, parsed) {
    this._recordCompletionUsage(run, parsed.usage);
    const choice = parsed.choices?.[0];
    this._recordCompletionReason(run, choice?.finish_reason);
    const delta = choice?.delta;
    if (!delta) return;

    if (!run.thinkParser) run.thinkParser = createThinkParser();

    // Handle structured reasoning tokens (DeepSeek: reasoning_content, OpenRouter: reasoning).
    // Display-only: not added to accumulatedText or conversation history.
    const structuredReasoning = delta.reasoning_content ?? delta.reasoning;
    if (structuredReasoning) {
      run.hasReasoning = true;
      this._emitEvent(run.id, { type: 'reasoning', data: structuredReasoning });
    }

    // Handle content. Some models stream their chain-of-thought inline as
    // <think>…</think> instead of a separate reasoning field; split it out so
    // the thinking goes to the reasoning panel and only the answer is kept.
    if (delta.content) {
      const { content, reasoning } = run.thinkParser.push(delta.content);
      if (reasoning) {
        run.hasReasoning = true;
        this._emitEvent(run.id, { type: 'reasoning', data: reasoning });
      }
      if (content) {
        this._appendAnswerWire(run, content);
      }
    }

    // Handle tool calls
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      if (!run.activeToolCalls) run.activeToolCalls = new Map();

      for (const tc of delta.tool_calls) {
        const index = Number(tc.index ?? 0);
        let toolCall = run.activeToolCalls.get(index);

        if (!toolCall) {
          const tcName = tc.function?.name || '';
          toolCall = {
            id: tc.id,
            type: 'function',
            function: {
              name: tcName,
              arguments: this._normalizeToolArguments(tc.function?.arguments),
            },
          };
          run.activeToolCalls.set(index, toolCall);

          const isTool = tcName ? this.toolImplementations.has(tcName) : false;
          const isSkill = tcName && this.skillManager ? this.skillManager.hasSkill(tcName) : false;
          const capability = isSkill && !isTool ? 'skill' : isTool ? 'tool' : 'unknown';

          this._emitEvent(run.id, {
            type: 'tool_start',
            toolCall,
            capability,
          });
          continue;
        }

        if (tc.id) toolCall.id = tc.id;
        if (tc.function?.arguments) {
          toolCall.function.arguments = this._mergeToolArguments(
            toolCall.function.arguments,
            tc.function.arguments
          );
        }
        if (tc.function?.name) {
          toolCall.function.name = tc.function.name;
        }
      }
    }
  }
}

export function installOpenAIExecutionMethods(target) {
  for (const name of Object.getOwnPropertyNames(OpenAIExecutionMethods.prototype)) {
    if (name === 'constructor') continue;
    Object.defineProperty(
      target.prototype,
      name,
      Object.getOwnPropertyDescriptor(OpenAIExecutionMethods.prototype, name)
    );
  }
}
