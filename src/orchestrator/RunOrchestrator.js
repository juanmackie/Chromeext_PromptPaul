/**
 * RunOrchestrator - Centralized LLM request orchestration
 *
 * Responsibilities:
 * - Generate and track run IDs for all requests
 * - Execute tools idempotently by runId + toolCallId
 * - Handle follow-up LLM calls after tool execution
 * - Single source of truth for skill policy
 */

import { normalizeToolChoice } from '../utils/toolChoiceBuilder.js';

class RunOrchestrator {
  constructor(skillManager) {
    this.skillManager = skillManager;
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
      conversationHistory: config.messages || [],
      accumulatedText: '',
      activeToolCall: null,
      status: 'ready',
      abortController: new AbortController()
    };

    this.activeRuns.set(runId, runState);
    console.log(`[Orchestrator] Started run ${runId}`);
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

    // Sanitize conversation history to strip orphan tool messages
    run.conversationHistory = this._sanitizeMessages(run.conversationHistory);

    // If the user explicitly requested a skill, resolve and inject instructions
    // directly into conversation — no model tool call needed (mirrors OpenClaw).
    if (run.config.requestedSkill) {
      const resolved = this.skillManager.resolveSkill(run.config.requestedSkill);
      if (resolved) {
        const skillBlock = [
          `══════════════════════════════════════════`,
          `  SKILL: ${resolved.name}`,
          `  ${resolved.description}`,
          `══════════════════════════════════════════`,
          '',
          resolved.instructions,
          '',
          `══════════════════════════════════════════`,
          `Skill instructions loaded. Follow them for this response.`
        ].join('\n');

        run.conversationHistory.unshift({
          role: 'system',
          content: skillBlock
        });

        console.log(`[Orchestrator] Injected skill instructions: ${resolved.name}`);
      } else {
        console.warn(`[Orchestrator] Requested skill '${run.config.requestedSkill}' not found`);
      }
    }

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
      console.error('[Orchestrator] Execute error:', error);
      this._emitEvent(runId, { type: 'error', error: error.message });
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
              hint: `Call skill_view with name: '${name}' to load the skill instructions.`
            }
          };
        }

        console.warn(`[Orchestrator] Unknown tool/skill name: '${name}'`);
        return {
          success: true,
          result: {
            error: 'UNKNOWN_CAPABILITY',
            message: `'${name}' is not a registered tool or skill. Check the available tools in the system prompt and the available skills listed there.`,
            availableTools: Array.from(this.toolImplementations.keys()),
            availableSkills: this.skillManager ? (await this.skillManager.getSkillNames()).map(String) : []
          }
        };
      }

      const args = JSON.parse(toolCall.function.arguments || '{}');
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
      content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
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
      run.abortController.abort();
      this.activeRuns.delete(runId);
    }
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

  /**
   * Build tools list with skill injection
   */
  async _buildTools(run) {
    const tools = [];

    // Add user-defined tools from config
    if (run.config.tools && Array.isArray(run.config.tools)) {
      tools.push(...run.config.tools);
    }

    // Inject skill-related tools if eligible skills available
    const eligibleSkills = this.skillManager.getEligibleSnapshot();
    if (eligibleSkills.length > 0) {
      tools.push({
        type: 'function',
        function: {
          name: 'skills_list',
          description: 'List all available skills with names and short descriptions. Skills are reference instructions — never emit a skill name as a tool call.',
          parameters: { type: 'object', properties: {}, required: [] }
        }
      });
      tools.push({
        type: 'function',
        function: {
          name: 'skill_view',
          description: 'Load full instructions for a specific skill by name.',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'The exact name of the skill to load.' }
            },
            required: ['name']
          }
        }
      });
      tools.push({
        type: 'function',
        function: {
          name: 'load_skill',
          description: '[Compatibility] Loads a skill by name. Prefer skill_view instead.',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'The name of a specific skill to load.' }
            },
            required: []
          }
        }
      });
    }

    return tools;
  }

  /**
   * Execute OpenAI-style streaming
   */
  async _executeOpenAI(run, requestConfig, tools) {
    const { llmEndpoint, apiKey, modelName } = run.config;

    // Build messages
    const messages = [...run.conversationHistory];
    if (requestConfig.messages) {
      // Add new user message if provided
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg || lastMsg.role !== 'user') {
        messages.push(...requestConfig.messages);
      }
    }

    // Add system prompt with skill catalog (eligible skills only)
    const eligibleSkills = this.skillManager.getEligibleSnapshot();
    if (eligibleSkills.length > 0) {
      const systemMsg = messages.find(m => m.role === 'system');
      
      // Format skill catalog: "name (description)"
      const skillCatalog = eligibleSkills.map(s => `${s.name} (${s.description})`).join(', ');
      
      const skillPrompt = `Available skills (reference instructions, NOT callable tools): ${skillCatalog}. CRITICAL: Skills are documentation only. Never emit a skill name as a tool call. The ONLY callable functions for skills are "skills_list" (discover) and "skill_view" (load full instructions). Load skills using skill_view, then use your own tools and knowledge. Proceed without a skill if none match.`;
      
      if (systemMsg) {
        systemMsg.content += `\n\n${skillPrompt}`;
      } else {
        messages.unshift({ role: 'system', content: skillPrompt });
      }
    }

    const body = {
      model: modelName,
      messages,
      stream: true
    };

    // Normalize tool_choice and only include tools if not 'none'
    const normalizedToolChoice = normalizeToolChoice(run.config.tool_choice);
    if (normalizedToolChoice !== 'none' && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = normalizedToolChoice === 'auto' ? 'auto' : { type: 'function', function: { name: normalizedToolChoice } };
    }

    const response = await fetch(llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: run.abortController.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
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

    // Finalize based on what we have
    if (run.activeToolCall) {
      await this._finalizeToolCall(run);
    } else if (run.accumulatedText.trim()) {
      await this._finalizeTextResponse(run);
    }
  }

  /**
   * Execute Anthropic-style streaming
   */
  async _executeAnthropic(run, requestConfig, tools) {
    const { llmEndpoint, apiKey, modelName } = run.config;

    // Build messages for Anthropic format
    const messages = [];
    for (const msg of run.conversationHistory) {
      if (msg.role === 'tool') {
        messages.push({
          role: 'user',
          content: `Tool ${msg.name} result: ${msg.content}`
        });
      } else {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    if (requestConfig.messages) {
      messages.push(...requestConfig.messages);
    }

    const body = {
      model: modelName.replace('anthropic:', ''),
      max_tokens: 4096,
      stream: true,
      messages: messages.filter(m => m.role !== 'system')
    };

    // Add system prompt with skill catalog (eligible skills only)
    const eligibleSkills = this.skillManager.getEligibleSnapshot();
    let systemPrompt = '';
    if (eligibleSkills.length > 0) {
      // Format skill catalog: "name (description)"
      const skillCatalog = eligibleSkills.map(s => `${s.name} (${s.description})`).join(', ');
      systemPrompt = `Available skills (reference instructions, NOT callable tools): ${skillCatalog}. CRITICAL: Skills are documentation only. Never emit a skill name as a tool call. The ONLY callable functions for skills are "skills_list" (discover) and "skill_view" (load full instructions). Load skills using skill_view, then use your own tools and knowledge. Proceed without a skill if none match.`;
    }

    if (run.config.systemPrompt) {
      systemPrompt = run.config.systemPrompt + '\n\n' + systemPrompt;
    }

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    // Normalize tool_choice and add tools if not 'none'
    const normalizedToolChoice = normalizeToolChoice(run.config.tool_choice);
    if (normalizedToolChoice !== 'none' && tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
      }));
    }

    const response = await fetch(llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: run.abortController.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
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

    // Finalize
    if (run.activeToolCall) {
      await this._finalizeToolCall(run);
    } else if (run.accumulatedText.trim()) {
      await this._finalizeTextResponse(run);
    }
  }

  /**
   * Process OpenAI streaming chunk
   */
  async _processOpenAIChunk(run, parsed) {
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return;

    // Handle content
    if (delta.content) {
      run.accumulatedText += delta.content;
      this._emitEvent(run.id, { type: 'content', data: delta.content });
    }

    // Handle tool calls
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      const tc = delta.tool_calls[0];

      if (!run.activeToolCall) {
        // First chunk of tool call
        const tcName = tc.function?.name || '';
        run.activeToolCall = {
          id: tc.id,
          type: 'function',
          function: {
            name: tcName,
            arguments: tc.function?.arguments || ''
          }
        };

        const isTool = tcName ? this.toolImplementations.has(tcName) : false;
        const isSkill = tcName && this.skillManager ? this.skillManager.hasSkill(tcName) : false;
        const capability = isSkill && !isTool ? 'skill' : (isTool ? 'tool' : 'unknown');

        this._emitEvent(run.id, {
          type: 'tool_start',
          toolCall: run.activeToolCall,
          capability
        });
      } else {
        // Accumulate
        if (tc.function?.arguments) {
          run.activeToolCall.function.arguments += tc.function.arguments;
        }
        if (tc.function?.name) {
          run.activeToolCall.function.name = tc.function.name;
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
      }
    } else if (event.type === 'content_block_start') {
      if (event.content_block.type === 'tool_use') {
        const tcName = event.content_block.name;
        run.activeToolCall = {
          id: event.content_block.id,
          type: 'function',
          function: {
            name: tcName,
            arguments: ''
          }
        };

        const isTool = this.toolImplementations.has(tcName);
        const isSkill = this.skillManager && this.skillManager.hasSkill(tcName);
        const capability = isSkill && !isTool ? 'skill' : (isTool ? 'tool' : 'unknown');

        this._emitEvent(run.id, {
          type: 'tool_start',
          toolCall: run.activeToolCall,
          capability
        });
      }
    } else if (event.type === 'content_block_stop') {
      // Tool block complete, arguments should be accumulated
      if (run.activeToolCall) {
        this._emitEvent(run.id, {
          type: 'tool_ready',
          toolCall: run.activeToolCall
        });
      }
    }
  }

  /**
   * Finalize tool call and execute
   */
  async _finalizeToolCall(run) {
    run.status = 'executing_tool';

    // Add assistant message with tool call
    run.conversationHistory.push({
      role: 'assistant',
      content: run.accumulatedText || null,
      tool_calls: [run.activeToolCall]
    });

    this._emitEvent(run.id, {
      type: 'tool_ready',
      toolCall: run.activeToolCall
    });

    // Execute tool
    try {
      const result = await this.executeTool(run.id, run.activeToolCall);

      this._emitEvent(run.id, {
        type: 'tool_complete',
        toolCall: run.activeToolCall,
        result: result
      });

      // Continue conversation
      await this.continueAfterTool(run.id, run.activeToolCall, result);
    } catch (error) {
      this._emitEvent(run.id, {
        type: 'tool_error',
        toolCall: run.activeToolCall,
        error: error.message
      });
    }
  }

  /**
   * Finalize text response
   */
  async _finalizeTextResponse(run) {
    run.status = 'complete';

    run.conversationHistory.push({
      role: 'assistant',
      content: run.accumulatedText
    });

    this._emitEvent(run.id, {
      type: 'complete',
      content: run.accumulatedText
    });
  }

  /**
   * Emit event to chat.js
   */
  _emitEvent(runId, event) {
    chrome.runtime.sendMessage({
      action: 'orchestratorEvent',
      runId,
      event
    }).catch(err => {
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
          availableSkills: (await this.skillManager.getSkillsList()).map(s => s.name)
        };
      }
      const skillData = await this.skillManager.getSkillContent(name);
      if (!skillData) {
        return {
          success: false,
          error: `Skill '${name}' not found.`,
          availableSkills: (await this.skillManager.getSkillsList()).map(s => s.name)
        };
      }
      return {
        success: true,
        skill: skillData,
        metadata: {
          loaded: true,
          type: skillData.type,
          timestamp: new Date().toISOString()
        },
        reminder: 'Skills are reference instructions, not callable tools. Proceed with your own tools and knowledge using this guidance.'
      };
    };

    // skills_list — discovery only
    this.toolImplementations.set('skills_list', async () => {
      const skills = await this.skillManager.getSkillsList();
      return {
        success: true,
        skills: skills.map(s => ({ name: s.name, description: s.description })),
        hint: 'Use skill_view with a specific skill name to load its full instructions.'
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
