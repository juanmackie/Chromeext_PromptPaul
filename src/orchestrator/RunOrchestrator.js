/**
 * @fileoverview RunOrchestrator - Centralized LLM request orchestration
 *
 * Responsibilities:
 * - Generate and track run IDs for all requests
 * - Execute tools idempotently by runId + toolCallId
 * - Handle follow-up LLM calls after tool execution
 * - Single source of truth for skill policy
 *
 * @module RunOrchestrator
 */

import { formatToolsForLlm, normalizeToolChoice } from '../utils/toolChoiceBuilder.js';
import { modelSupportsReasoning } from '../utils/profileRouting.js';
import { createThinkParser } from '../utils/inlineReasoning.js';

const CORE_INSTRUCTIONS =
  'OUTPUT FORMATTING: Always use plain text and Unicode characters. Never use LaTeX notation (e.g., write → instead of \\rightarrow, ≠ instead of \\neq, ≥ instead of \\geq, ≤ instead of \\leq). Use Unicode symbols directly.';
const MAX_TOOL_CALL_RETRIES = 3;

class RunOrchestrator {
  constructor(skillManager, options = {}) {
    this.skillManager = skillManager;
    this.userToolExecutor = options.userToolExecutor;
    this.activeRuns = new Map(); // runId -> RunState
    this.toolExecutions = new Set(); // Set of "runId:toolCallId"
    this.toolImplementations = new Map();

    // Register built-in tools
    this._registerBuiltInTools();
  }

  /**
   * Start a new run with unique ID
   */
  async startRun(config) {
    const runId = this._generateRunId();
    const runState = {
      id: runId,
      config,
      sourceTabId: config.sourceTabId || null, // Tab that initiated this run
      conversationHistory: config.messages || [],
      accumulatedText: '',
      activeToolCall: null,
      toolCallIterations: 0,
      status: 'ready',
      abortController: new AbortController(),
    };

    this.activeRuns.set(runId, runState);
    this._registerConfiguredTools(runState);
    console.log(
      `[Orchestrator] Started run ${runId}${runState.sourceTabId ? ' from tab ' + runState.sourceTabId : ''}`
    );
    return runId;
  }

  /**
   * Execute LLM request
   */
  async execute(runId, requestConfig) {
    const run = this.activeRuns.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    run.status = 'streaming';
    run.accumulatedText = '';
    run.activeToolCall = null;
    run.activeToolCalls = null;
    // Per-turn Anthropic thinking block (text + signature) for tool-call continuity.
    run.thinkingBlock = null;
    // Per-turn parser that strips inline <think>…</think> reasoning from the answer
    // stream (used by the OpenAI-style path; harmless no-op for Anthropic).
    run.thinkParser = createThinkParser();

    // Sanitize conversation history to strip orphan tool messages
    run.conversationHistory = this._sanitizeMessages(run.conversationHistory);

    try {
      // Build tools with skill injection
      const tools = await this._buildTools(run);

      // Execute based on provider
      if (this._isAnthropicEndpoint(run.config.llmEndpoint)) {
        await this._executeAnthropic(run, requestConfig, tools);
      } else {
        await this._executeOpenAI(run, requestConfig, tools);
      }
    } catch (error) {
      // Handle abort errors gracefully (intentional cancellations)
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.log(`[Orchestrator] Run ${runId} aborted by user`);
        if (this.activeRuns.has(runId)) {
          this._emitEvent(runId, { type: 'aborted' });
        }
        return;
      }
      console.error(
        `[Orchestrator] Execute error:`,
        error.name ? `${error.name}: ${error.message}` : error.message || error
      );
      this._emitEvent(runId, { type: 'error', error: error.message || String(error) });
      this.activeRuns.delete(runId);
      throw error;
    }
  }

  /**
   * Execute tool call - idempotent by runId + toolCallId
   */
  async executeTool(runId, toolCall) {
    const executionKey = `${runId}:${toolCall.id}`;

    if (this.toolExecutions.has(executionKey)) {
      console.log(`[Orchestrator] Tool ${toolCall.id} already executed for run ${runId}`);
      return { cached: true };
    }

    this.toolExecutions.add(executionKey);

    try {
      const { name } = toolCall.function;

      // Classify: is this a registered tool, a known skill, or unknown?
      const implementation = this.toolImplementations.get(name);

      if (!implementation) {
        // Guard: skills are not executable tools
        if (this.skillManager && this.skillManager.hasSkill(name)) {
          console.warn(`[Orchestrator] '${name}' is a skill, not an executable tool`);
          return {
            success: true,
            result: {
              error: 'SKILL_NOT_EXECUTABLE',
              message: `'${name}' is a skill (reference instructions), not a callable tool. Use skill_view to load it into context, then proceed with your own tools and knowledge.`,
              hint: `Call skill_view with name: '${name}' to load the skill instructions.`,
            },
          };
        }

        console.warn(`[Orchestrator] Unknown tool/skill name: '${name}'`);
        return {
          success: true,
          result: {
            error: 'UNKNOWN_CAPABILITY',
            message: `'${name}' is not a registered tool or skill. Check the available tools in the system prompt and the available skills listed there.`,
            availableTools: Array.from(this.toolImplementations.keys()),
            availableSkills: this.skillManager
              ? (await this.skillManager.getSkillNames()).map(String)
              : [],
          },
        };
      }

      const args = this._parseToolArguments(toolCall.function.arguments);
      const result = await implementation(args);

      return { success: true, result };
    } catch (error) {
      this.toolExecutions.delete(executionKey);
      throw error;
    }
  }

  /**
   * Continue conversation after tool execution
   */
  async continueAfterTool(runId, toolCall, toolResult) {
    const run = this.activeRuns.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    // Add tool result to history
    run.conversationHistory.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      name: toolCall.function.name,
      content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
    });

    // Mark as ready for next execution
    run.status = 'ready';
    run.activeToolCall = null;

    // Trigger next LLM call
    return this.execute(runId, { continueConversation: true });
  }

  /**
   * Abort a run
   */
  abort(runId) {
    const run = this.activeRuns.get(runId);
    if (run) {
      this._emitEvent(runId, { type: 'aborted' });
      run.abortController.abort();
      this.activeRuns.delete(runId);
    }
    // Clean up tool executions for this run to prevent memory leak
    this._cleanupToolExecutions(runId);
  }

  /**
   * Clean up tool executions for a specific run to prevent memory leaks.
   * Called automatically when a run completes or aborts.
   * @param {string} runId - The ID of the run to clean up
   * @private
   */
  _cleanupToolExecutions(runId) {
    const keysToDelete = [];
    for (const key of this.toolExecutions) {
      if (key.startsWith(`${runId}:`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => this.toolExecutions.delete(key));
    if (keysToDelete.length > 0) {
      console.log(
        `[Orchestrator] Cleaned up ${keysToDelete.length} tool executions for run ${runId}`
      );
    }
  }

  /**
   * Full cleanup of all runs and cached data.
   * Useful for extension background worker restarts or memory pressure situations.
   */
  cleanup() {
    // Abort all active runs
    for (const [runId] of this.activeRuns) {
      this.abort(runId);
    }
    // Clear all tool executions
    this.toolExecutions.clear();
    console.log('[Orchestrator] Full cleanup completed - all runs terminated and caches cleared');
  }

  /**
   * Get run state
   */
  getRun(runId) {
    return this.activeRuns.get(runId);
  }

  /**
   * Get tool implementations
   */
  getToolImplementations() {
    return Array.from(this.toolImplementations.keys());
  }

  /**
   * Register a custom tool implementation
   */
  registerTool(name, implementation) {
    this.toolImplementations.set(name, implementation);
  }

  _registerConfiguredTools(run) {
    if (!this.userToolExecutor || !Array.isArray(run.config.tools)) return;

    for (const tool of run.config.tools) {
      if (!tool?.name || !tool?.endpointUrl) continue;
      if (tool.name === 'skills_list' || tool.name === 'skill_view' || tool.name === 'load_skill') {
        continue;
      }
      this.registerTool(tool.name, async (args) => {
        return this.userToolExecutor(tool, args);
      });
    }
  }

  /**
   * Build tools list with skill injection
   */
  async _buildTools(run) {
    const tools = [];

    // Add user-defined tools from config
    if (run.config.tools && Array.isArray(run.config.tools)) {
      tools.push(...formatToolsForLlm(run.config.tools));
    }

    // Inject skill-related tools if eligible skills available
    const eligibleSkills = this.skillManager.getEligibleSnapshot();
    if (eligibleSkills.length > 0 && !run.config.requestedSkill) {
      tools.push({
        type: 'function',
        function: {
          name: 'skills_list',
          description:
            'List all available skills with names and short descriptions. Skills are reference instructions — never emit a skill name as a tool call.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      });
      tools.push({
        type: 'function',
        function: {
          name: 'skill_view',
          description: 'Load full instructions for a specific skill by name.',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'The exact name of the skill to load.' },
            },
            required: ['name'],
          },
        },
      });
      tools.push({
        type: 'function',
        function: {
          name: 'load_skill',
          description: '[Compatibility] Loads a skill by name. Prefer skill_view instead.',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'The name of a specific skill to load.' },
            },
            required: [],
          },
        },
      });
    }

    return tools;
  }

  _formatSkillBlock(resolved) {
    return [
      `══════════════════════════════════════════`,
      `  SKILL: ${resolved.name}`,
      `  ${resolved.description}`,
      `══════════════════════════════════════════`,
      '',
      resolved.instructions,
      '',
      `══════════════════════════════════════════`,
      `Skill instructions loaded. Follow them for this response.`,
    ].join('\n');
  }

  _buildSystemPrompt(run, eligibleSkills) {
    const parts = [CORE_INSTRUCTIONS];
    if (run.config.systemPrompt) parts.push(run.config.systemPrompt);

    if (run.config.requestedSkill) {
      const resolved = this.skillManager.resolveSkill(run.config.requestedSkill);
      if (resolved) {
        parts.push(this._formatSkillBlock(resolved));
        console.log(`[Orchestrator] Injected skill instructions: ${resolved.name}`);
      } else {
        console.warn(`[Orchestrator] Requested skill '${run.config.requestedSkill}' not found`);
      }
    } else if (eligibleSkills.length > 0) {
      const skillCatalog = eligibleSkills.map((s) => `${s.name} (${s.description})`).join(', ');
      parts.push(
        `Available skills (reference instructions, NOT callable tools): ${skillCatalog}. CRITICAL: Skills are documentation only. Never emit a skill name as a tool call. The ONLY callable functions for skills are "skills_list" (discover) and "skill_view" (load full instructions). Load skills using skill_view, then use your own tools and knowledge. Proceed without a skill if none match.`
      );
    }

    return parts.filter(Boolean).join('\n\n').trim();
  }

  /**
   * Execute OpenAI-style streaming
   */
  async _executeOpenAI(run, requestConfig, tools) {
    const { llmEndpoint, apiKey, modelName } = run.config;

    // Add a single system prompt without mutating history objects.
    const eligibleSkills = this.skillManager.getEligibleSnapshot();
    const systemPrompt = this._buildSystemPrompt(run, eligibleSkills);
    const messages = run.conversationHistory
      .filter((m) => m.role !== 'system')
      .map((m) => ({ ...m }));
    if (requestConfig.messages) {
      const newMessages = requestConfig.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ ...m }));
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg || lastMsg.role !== 'user') {
        messages.push(...newMessages);
      }
    }
    messages.unshift({ role: 'system', content: systemPrompt });

    const body = {
      model: modelName,
      messages,
      stream: true,
    };

    // Normalize tool_choice and only include tools if not 'none'
    const normalizedToolChoice = normalizeToolChoice(run.config.tool_choice);
    if (normalizedToolChoice !== 'none' && tools.length > 0) {
      body.tools = tools;
      body.tool_choice =
        normalizedToolChoice === 'auto'
          ? 'auto'
          : { type: 'function', function: { name: normalizedToolChoice } };
    }

    const response = await fetch(llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: run.abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;

        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          await this._processOpenAIChunk(run, parsed);
        } catch (e) {
          console.warn('[Orchestrator] Failed to parse chunk:', e.message);
        }
      }
    }

    // Drain any tail held back while waiting on a possible inline-think tag.
    const tail = run.thinkParser.flush();
    if (tail.reasoning) {
      this._emitEvent(run.id, { type: 'reasoning', data: tail.reasoning });
    }
    if (tail.content) {
      run.accumulatedText += tail.content;
      this._emitEvent(run.id, { type: 'content', data: tail.content });
    }

    // Finalize based on what we have. When there's no tool call we always finalize
    // the text response — even with empty/whitespace text — so a terminal `complete`
    // event is emitted and the UI unlocks instead of hanging.
    if (run.activeToolCall || (run.activeToolCalls && run.activeToolCalls.size > 0)) {
      await this._finalizeToolCall(run);
    } else {
      await this._finalizeTextResponse(run);
    }
  }

  _parseJsonArguments(rawArgs) {
    try {
      if (rawArgs == null || rawArgs === '') return {};
      if (typeof rawArgs === 'object') return rawArgs;
      return JSON.parse(rawArgs);
    } catch (_) {
      return {};
    }
  }

  _buildAnthropicMessages(run, requestConfig) {
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

    if (requestConfig.messages) {
      for (const msg of requestConfig.messages) {
        if (msg?.role === 'tool') {
          pushMessage('user', [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: msg.content || '',
            },
          ]);
        } else if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls)) {
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
    }

    return messages.filter((m) => m.role !== 'system');
  }

  /**
   * Execute Anthropic-style streaming
   */
  async _executeAnthropic(run, requestConfig, tools) {
    const { llmEndpoint, apiKey, modelName } = run.config;

    const reasoningEnabled = modelSupportsReasoning(modelName);
    const THINKING_BUDGET_TOKENS = 2048;

    const body = {
      model: modelName.replace('anthropic:', ''),
      max_tokens: reasoningEnabled ? 4096 + THINKING_BUDGET_TOKENS : 4096,
      stream: true,
      messages: this._buildAnthropicMessages(run, requestConfig),
    };

    // Enable extended thinking for models that support it. Temperature must be
    // left unset (Anthropic requirement) — it already is.
    if (reasoningEnabled) {
      body.thinking = { type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS };
    }

    // Add system prompt with skill catalog (eligible skills only)
    const eligibleSkills = this.skillManager.getEligibleSnapshot();
    body.system = this._buildSystemPrompt(run, eligibleSkills);

    // Normalize tool_choice and add tools if not 'none'.
    // Note: Anthropic disallows forced tool_choice while thinking is enabled;
    // tools are still offered with the default (auto) selection.
    const normalizedToolChoice = normalizeToolChoice(run.config.tool_choice);
    if (normalizedToolChoice !== 'none' && tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
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
      const errorText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

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

    // Finalize. When there's no tool call we always finalize the text response —
    // even with empty/whitespace text (e.g. a thinking-only turn) — so a terminal
    // `complete` event is emitted and the UI unlocks instead of hanging.
    if (run.activeToolCall || (run.activeToolCalls && run.activeToolCalls.size > 0)) {
      await this._finalizeToolCall(run);
    } else {
      await this._finalizeTextResponse(run);
    }
  }

  /**
   * Process OpenAI streaming chunk
   */
  async _processOpenAIChunk(run, parsed) {
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return;

    if (!run.thinkParser) run.thinkParser = createThinkParser();

    // Handle structured reasoning tokens (DeepSeek: reasoning_content, OpenRouter: reasoning).
    // Display-only — not added to accumulatedText or conversation history.
    const structuredReasoning = delta.reasoning_content ?? delta.reasoning;
    if (structuredReasoning) {
      this._emitEvent(run.id, { type: 'reasoning', data: structuredReasoning });
    }

    // Handle content. Some models stream their chain-of-thought inline as
    // <think>…</think> instead of a separate reasoning field; split it out so
    // the thinking goes to the reasoning panel and only the answer is kept.
    if (delta.content) {
      const { content, reasoning } = run.thinkParser.push(delta.content);
      if (reasoning) {
        this._emitEvent(run.id, { type: 'reasoning', data: reasoning });
      }
      if (content) {
        run.accumulatedText += content;
        this._emitEvent(run.id, { type: 'content', data: content });
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

  /**
   * Process Anthropic event
   */
  async _processAnthropicEvent(run, event) {
    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        run.accumulatedText += event.delta.text;
        this._emitEvent(run.id, { type: 'content', data: event.delta.text });
      } else if (event.delta.type === 'thinking_delta') {
        if (!run.thinkingBlock) run.thinkingBlock = { thinking: '', signature: '' };
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
    } else if (event.type === 'message_stop') {
    }
  }

  /**
   * Finalize tool call and execute
   */
  async _finalizeToolCall(run) {
    run.status = 'executing_tool';
    run.toolCallIterations += 1;

    if (run.toolCallIterations > MAX_TOOL_CALL_RETRIES) {
      const error = `Maximum tool call retries exceeded (${MAX_TOOL_CALL_RETRIES}).`;
      this._emitEvent(run.id, { type: 'error', error });
      throw new Error(error);
    }

    const toolCalls = run.activeToolCalls
      ? Array.from(run.activeToolCalls.values())
      : run.activeToolCall
        ? [run.activeToolCall]
        : [];
    if (toolCalls.length === 0) return;

    const assistantMessage = {
      role: 'assistant',
      content: run.accumulatedText || null,
      tool_calls: toolCalls,
    };
    // Preserve Anthropic thinking block (with signature) so it can be replayed
    // on the follow-up turn — required when extended thinking + tool_use combine.
    if (run.thinkingBlock?.thinking && run.thinkingBlock?.signature) {
      assistantMessage._anthropicThinking = run.thinkingBlock;
    }
    run.conversationHistory.push(assistantMessage);

    this._emitEvent(run.id, {
      type: 'tool_ready',
      toolCall: toolCalls[0],
    });

    for (const toolCall of toolCalls) {
      try {
        const result = await this.executeTool(run.id, toolCall);

        this._emitEvent(run.id, {
          type: 'tool_complete',
          toolCall,
          result: result,
        });

        run.conversationHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      } catch (error) {
        run.conversationHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: `Error: ${error.message}`,
        });
        this._emitEvent(run.id, {
          type: 'tool_error',
          toolCall,
          error: error.message,
        });
      }
    }

    run.status = 'ready';
    run.activeToolCall = null;
    run.activeToolCalls?.clear?.();
    await this.execute(run.id, { continueConversation: true });
  }

  /**
   * Finalize text response
   */
  async _finalizeTextResponse(run) {
    run.status = 'complete';

    // Don't persist an empty assistant turn (reasoning-only response with no
    // answer); still emit `complete` below so the UI finalizes and unlocks.
    if (run.accumulatedText.trim()) {
      run.conversationHistory.push({
        role: 'assistant',
        content: run.accumulatedText,
      });
    }

    this._emitEvent(run.id, {
      type: 'complete',
      content: run.accumulatedText,
    });

    // Clean up tool executions and active run state for this completed run to prevent memory leak
    this._cleanupToolExecutions(run.id);
    this.activeRuns.delete(run.id);
  }

  /**
   * Emit event to chat.js
   */
  _emitEvent(runId, event) {
    const run = this.activeRuns.get(runId);
    chrome.runtime
      .sendMessage({
        action: 'orchestratorEvent',
        runId,
        sourceTabId: run?.sourceTabId || null,
        event,
      })
      .catch((err) => {
        // Chat might not be listening
      });
  }

  /**
   * Sanitize messages before sending to OpenAI.
   * - Strips orphan tool messages (tool results without preceding assistant tool_calls)
   * - Ensures valid role ordering for OpenAI strict mode
   */
  _sanitizeMessages(messages) {
    const out = [];
    const validToolCallIds = new Set();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || typeof msg !== 'object') continue;

      // Track tool_call IDs from assistant messages
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc.id) validToolCallIds.add(tc.id);
        }
        out.push(msg);
        continue;
      }

      // Strip orphan tool messages
      if (msg.role === 'tool') {
        if (msg.tool_call_id && validToolCallIds.has(msg.tool_call_id)) {
          out.push(msg);
        }
        // Drop orphan silently
        continue;
      }

      out.push(msg);
    }

    return out;
  }

  _normalizeToolArguments(args) {
    if (args == null) return '';
    return typeof args === 'string' ? args : JSON.stringify(args);
  }

  _mergeToolArguments(existingArgs, incomingArgs) {
    const existing = this._normalizeToolArguments(existingArgs);
    const incoming = this._normalizeToolArguments(incomingArgs);

    if (!existing) return incoming;
    if (!incoming) return existing;
    if (incoming === existing) return existing;
    if (incoming.startsWith(existing)) return incoming;
    if (existing.endsWith(incoming)) return existing;

    const existingParsed = this._tryParseJson(existing);
    const incomingParsed = this._tryParseJson(incoming);
    if (existingParsed.ok && incomingParsed.ok) {
      return incoming;
    }

    const overlap = this._getStringOverlap(existing, incoming);
    if (overlap > 0) {
      return existing + incoming.slice(overlap);
    }

    return existing + incoming;
  }

  _parseToolArguments(rawArgs) {
    if (rawArgs == null || rawArgs === '') return {};
    if (typeof rawArgs === 'object') return rawArgs;

    const normalized = String(rawArgs).trim();
    if (!normalized) return {};

    const parsed = this._tryParseJson(normalized);
    if (parsed.ok) return parsed.value;

    const recovered = this._recoverTrailingJson(normalized);
    if (recovered.ok) return recovered.value;

    throw new Error(
      `Invalid tool arguments format: ${parsed.error?.message || 'Could not parse JSON arguments.'}`
    );
  }

  _recoverTrailingJson(value) {
    for (let i = value.length - 1; i >= 0; i--) {
      const char = value[i];
      if (char !== '{' && char !== '[') continue;

      const candidate = value.slice(i).trim();
      const parsed = this._tryParseJson(candidate);
      if (parsed.ok) {
        return parsed;
      }
    }

    return { ok: false };
  }

  _tryParseJson(value) {
    try {
      return { ok: true, value: JSON.parse(value) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  _getStringOverlap(left, right) {
    const maxLength = Math.min(left.length, right.length);
    for (let size = maxLength; size > 0; size--) {
      if (left.slice(-size) === right.slice(0, size)) {
        return size;
      }
    }
    return 0;
  }

  _generateRunId() {
    return `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  _isAnthropicEndpoint(endpoint) {
    return endpoint.includes('anthropic.com');
  }

  _registerBuiltInTools() {
    // Shared helper for loading a single skill by name
    const loadSkillByName = async (name) => {
      if (!name) {
        return {
          success: false,
          error: 'Missing required parameter "name".',
          availableSkills: (await this.skillManager.getSkillsList()).map((s) => s.name),
        };
      }
      const skillData = await this.skillManager.getSkillContent(name);
      if (!skillData) {
        return {
          success: false,
          error: `Skill '${name}' not found.`,
          availableSkills: (await this.skillManager.getSkillsList()).map((s) => s.name),
        };
      }
      return {
        success: true,
        skill: skillData,
        metadata: {
          loaded: true,
          type: skillData.type,
          timestamp: new Date().toISOString(),
        },
        reminder:
          'Skills are reference instructions, not callable tools. Proceed with your own tools and knowledge using this guidance.',
      };
    };

    // skills_list — discovery only
    this.toolImplementations.set('skills_list', async () => {
      const skills = await this.skillManager.getSkillsList();
      return {
        success: true,
        skills: skills.map((s) => ({ name: s.name, description: s.description })),
        hint: 'Use skill_view with a specific skill name to load its full instructions.',
      };
    });

    // skill_view — load full content
    this.toolImplementations.set('skill_view', async (args) => {
      return loadSkillByName(args?.name);
    });

    // load_skill — compatibility alias
    this.toolImplementations.set('load_skill', async (args) => {
      return loadSkillByName(args?.name);
    });
  }
}

export default RunOrchestrator;
