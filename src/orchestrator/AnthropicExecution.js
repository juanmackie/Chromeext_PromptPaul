/**
 * @fileoverview Anthropic message conversion, transport, and stream processing.
 * @module AnthropicExecution
 */
import { appendBoundedSseBuffer, readBoundedResponseText } from '../utils/streamSafety.js';
import { modelSupportsReasoning } from '../utils/profileRouting.js';

const THINKING_BUDGET_TOKENS = 2048;
const FINAL_OUTPUT_TOKENS = 6144;

export class AnthropicExecutionMethods {
  _parseJsonArguments(rawArgs) {
    try {
      if (rawArgs == null || rawArgs === '') return {};
      if (typeof rawArgs === 'object') return rawArgs;
      return JSON.parse(rawArgs);
    } catch (_) {
      return {};
    }
  }

  _buildAnthropicMessages(run) {
    const messages = [];

    const pushMessage = (role, content) => {
      if (!content) return;
      const last = messages[messages.length - 1];
      if (last && last.role === role) {
        last.content = Array.isArray(last.content)
          ? last.content.concat(content)
          : `${last.content}\n\n${content}`;
        return;
      }
      messages.push({ role, content });
    };

    for (const msg of run.conversationHistory) {
      if (!msg || typeof msg !== 'object') continue;

      if (msg.role === 'tool') {
        pushMessage('user', [
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: msg.content || '',
          },
        ]);
      } else if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        const content = [];
        if (msg._anthropicThinking?.signature) {
          content.push({
            type: 'thinking',
            thinking: msg._anthropicThinking.thinking,
            signature: msg._anthropicThinking.signature,
          });
        }
        if (msg.content) content.push({ type: 'text', text: msg.content });
        content.push(
          ...msg.tool_calls.map((toolCall) => ({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function?.name,
            input: this._parseJsonArguments(toolCall.function?.arguments),
          }))
        );
        pushMessage('assistant', content);
      } else {
        pushMessage(msg.role, msg.content || '');
      }
    }

    return messages.filter((m) => m.role !== 'system');
  }

  async _executeAnthropic(run, tools, { allowRecovery = true, recovery = false } = {}) {
    const { llmEndpoint, apiKey, modelName } = run.config;
    run.completionProvider = 'anthropic';

    const reasoningEnabled = modelSupportsReasoning(modelName);
    this._compactProviderHistory(run);

    const body = {
      model: modelName.replace('anthropic:', ''),
      max_tokens: reasoningEnabled
        ? THINKING_BUDGET_TOKENS + FINAL_OUTPUT_TOKENS
        : FINAL_OUTPUT_TOKENS,
      stream: true,
      messages: this._buildAnthropicMessages(run),
    };

    const effectiveToolChoice = this._getEffectiveToolChoice(run);
    const forcingTool = effectiveToolChoice !== 'auto' && effectiveToolChoice !== 'none';

    // Anthropic rejects forced tool_choice while extended thinking is enabled.
    // Disable thinking only for the forced-tool turn; restore it for final auto.
    if (reasoningEnabled && !forcingTool && !recovery) {
      body.thinking = { type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS };
    }

    // Add system prompt with skill catalog (eligible skills only)
    const eligibleSkills = this.skillManager.getEligibleSnapshot();
    let systemPrompt = this._buildSystemPrompt(run, eligibleSkills);

    body.system = systemPrompt;

    if (effectiveToolChoice !== 'none' && tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
      body.tool_choice =
        effectiveToolChoice === 'required'
          ? { type: 'any' }
          : effectiveToolChoice === 'auto'
            ? { type: 'auto' }
            : { type: 'tool', name: effectiveToolChoice };
    }

    const response = await fetch(llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: run.abortController.signal,
    });

    if (!response.ok) {
      const errorText = await readBoundedResponseText(response);
      const toolHint =
        run.webSearch?.enabled && (response.status === 400 || response.status === 422)
          ? ' The selected endpoint may not support function calling; disable Web grounding or choose a tool-capable model.'
          : '';
      throw new Error(`Anthropic API error ${response.status}: ${errorText}${toolHint}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer = appendBoundedSseBuffer(buffer, decoder.decode(value, { stream: true }));

      // Anthropic uses \n-separated events
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.substring(0, newlineIndex).trim();
        buffer = buffer.substring(newlineIndex + 1);

        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          try {
            const parsed = JSON.parse(data);
            await this._processAnthropicEvent(run, parsed);
          } catch (e) {
            console.warn('[Orchestrator] Failed to parse Anthropic event:', e.message);
          }
        }
      }
    }

    // Finalize. When there's no tool call we always finalize the text response  -
    // even with empty/whitespace text (e.g. a thinking-only turn): so a terminal
    // `complete` event is emitted and the UI unlocks instead of hanging.
    if (run.activeToolCall || (run.activeToolCalls && run.activeToolCalls.size > 0)) {
      await this._finalizeToolCall(run);
    } else if (allowRecovery && this._shouldRecoverToolMarkup(run)) {
      await this._executeEmptyResponseRecovery(
        run,
        () => this._executeAnthropic(run, tools, { allowRecovery: false, recovery: true }),
        this._toolMarkupRecoveryPrompt()
      );
    } else if (allowRecovery && this._shouldRecoverEmptyResponse(run)) {
      await this._executeEmptyResponseRecovery(run, () =>
        this._executeAnthropic(run, [], { allowRecovery: false, recovery: true })
      );
    } else {
      if (recovery && run.accumulatedText.trim()) run.recoverySucceeded = true;
      await this._finalizeTextResponse(run);
    }
  }

  /**
   * Process OpenAI streaming chunk
   */

  /**
   * Process Anthropic event
   */

  async _processAnthropicEvent(run, event) {
    if (event.type === 'message_start') {
      this._recordCompletionUsage(run, event.message?.usage);
      this._recordCompletionReason(run, event.message?.stop_reason);
      return;
    }

    if (event.type === 'message_delta') {
      this._recordCompletionUsage(run, event.usage);
      this._recordCompletionReason(run, event.delta?.stop_reason);
      return;
    }

    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        this._appendAnswerWire(run, event.delta.text);
      } else if (event.delta.type === 'thinking_delta') {
        if (!run.thinkingBlock) run.thinkingBlock = { thinking: '', signature: '' };
        run.hasReasoning = true;
        run.thinkingBlock.thinking += event.delta.thinking || '';
        this._emitEvent(run.id, { type: 'reasoning', data: event.delta.thinking || '' });
      } else if (event.delta.type === 'signature_delta') {
        if (!run.thinkingBlock) run.thinkingBlock = { thinking: '', signature: '' };
        run.thinkingBlock.signature += event.delta.signature || '';
      } else if (event.delta.type === 'input_json_delta' && run.activeToolCall) {
        run.activeToolCall.function.arguments = this._mergeToolArguments(
          run.activeToolCall.function.arguments,
          event.delta.partial_json
        );
      }
    } else if (event.type === 'content_block_start') {
      if (event.content_block.type === 'tool_use') {
        const tcName = event.content_block.name;
        run.activeToolCall = {
          id: event.content_block.id,
          type: 'function',
          function: {
            name: tcName,
            arguments: this._normalizeToolArguments(event.content_block.input),
          },
        };

        const isTool = this.toolImplementations.has(tcName);
        const isSkill = this.skillManager && this.skillManager.hasSkill(tcName);
        const capability = isSkill && !isTool ? 'skill' : isTool ? 'tool' : 'unknown';

        this._emitEvent(run.id, {
          type: 'tool_start',
          toolCall: run.activeToolCall,
          capability,
        });
      }
    }
  }

  /**
   * Finalize tool call and execute
   */
}

export function installAnthropicExecutionMethods(target) {
  for (const name of Object.getOwnPropertyNames(AnthropicExecutionMethods.prototype)) {
    if (name === 'constructor') continue;
    Object.defineProperty(
      target.prototype,
      name,
      Object.getOwnPropertyDescriptor(AnthropicExecutionMethods.prototype, name)
    );
  }
}
