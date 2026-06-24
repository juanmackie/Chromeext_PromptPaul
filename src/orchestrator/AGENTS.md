# Orchestrator DOX

## Purpose

The `src/orchestrator/` subtree centralizes LLM run execution, tool calls, streaming events, abort handling, and skill-instruction injection.

## Ownership

- `RunOrchestrator.js` owns run IDs, active run state, tool execution idempotency, registered built-in tools, provider-specific execution, and follow-up calls after tool execution.

## Local Contracts

- Skills are injected as instructions via the composed system prompt (`_buildSystemPrompt`), not via conversation history unshift. Requested skills are resolved through `resolveSkill` and included even when `disable-model-invocation` hides them from model self-discovery.
- Tool executions must remain idempotent by `runId` and `toolCallId`.
- Abort handling should emit a clean aborted event rather than surfacing intentional cancellation as an error.
- Provider-specific execution must preserve OpenAI-compatible and Anthropic-compatible endpoint behavior.
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
