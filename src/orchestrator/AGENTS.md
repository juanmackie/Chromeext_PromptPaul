# Orchestrator DOX

## Purpose

The `src/orchestrator/` subtree centralizes LLM run execution, tool calls, streaming events, abort handling, and skill-instruction injection.

## Ownership

- `RunOrchestrator.js` owns run IDs, active run state, tool execution idempotency, registered built-in tools (including the reserved `web_search` tool), provider-specific execution, and follow-up calls after tool execution.
- The orchestrator exposes `run.webSearch` metadata only through the terminal `complete` event (`event.grounding.sources`); the Brave API key never leaves the service worker.
- Brave execution is supplied through `braveSearchExecutor` and key availability through `webSearchStatusProvider`; `run.config.apiKey` is only the selected LLM credential.
- Search/tool sequencing is model-directed before use: a forced user tool (when configured) runs first exactly once, then `web_search` is offered with automatic model selection (never forced) while a search slot is available. The slot is claimed before network I/O.
- After a search attempt, the system prompt switches to an already-completed phase and the immediate continuation is text-only. Duplicate or parallel search calls receive `WEB_SEARCH_ALREADY_USED` and never issue another Brave request.
- A search response with no usable normalized sources produces `WEB_SEARCH_NO_RESULTS`; it is not treated as successful grounding.

## Local Contracts

- Skills are injected as instructions via the composed system prompt (`_buildSystemPrompt`), not via conversation history unshift. Requested skills are resolved through `resolveSkill` and included even when `disable-model-invocation` hides them from model self-discovery.
- Tool executions must remain idempotent by `runId` and `toolCallId`.
- Abort handling should emit a clean aborted event rather than surfacing intentional cancellation as an error.
- Provider-specific execution must preserve OpenAI-compatible and Anthropic-compatible endpoint behavior.
- Terminal `complete` events may include safe provider completion metadata. Reasoning-only responses receive at most one text-only recovery attempt without repeating tools or exposing hidden reasoning.
- `CORE_INSTRUCTIONS` applies to all runs unless the project deliberately changes the formatting policy.

## Work Guidance

- Keep orchestration logic centralized here instead of duplicating run or tool execution flow in `background.js`.
- Register new built-in tools through the existing tool registry pattern.
- Keep skill policy aligned with root AGENTS.md and `src/utils/skillParser.js`.
- Preserve event shapes consumed by `chat.js`.

## Verification

- Run `npm run test` after orchestration changes.
- Exercise a side panel run, a skill invocation, and any affected tool flow manually when runtime behavior changes.

## Child DOX Index

- No child AGENTS.md files are currently needed under `src/orchestrator/`.
