# Orchestrator modules

## Purpose and ownership

`src/orchestrator/` owns model-run lifecycle, provider execution, tool dispatch, abort handling, and event delivery.

- `RunOrchestrator.js` owns run state, shared tool execution/idempotency, common provider callbacks, and follow-up turns.
- `OpenAIExecution.js` and `AnthropicExecution.js` own API request and stream loops; `CodexTransport.js` and `HermesTransport.js` own provider-specific wire protocols.
- `HermesExecution.js` owns gateway session/run lifecycle, client-tool events, and approval responses.
- `CodexExecution.js` owns subscription request setup, Responses event handling, and tool-call assembly.
- `RunBudget.js` and `runResilience.js` own run limits, retries, timeouts, compaction, and repetitive-output protection.
- `RunJournal.js` owns safe event projections, bounded snapshots, and coalesced session-storage writes for run recovery.
- `src/act/` owns Act planning and execution. Import its public API through [`src/act/index.js`](../act/index.js).
- `PageTabController.js` owns tab leases and run-created tab cleanup.

## Boundaries

- The root [AGENTS.md](../../AGENTS.md) is canonical for credentials, run lifecycle, event/journal safety, web search, and cross-capability invariants. Read it before changing those contracts.
- For Act behavior or limits, read [`src/act/AGENTS.md`](../act/AGENTS.md) and the relevant policy/runtime module. Keep limits in the capability constants and cover behavior in Vitest; do not restate numeric policy here.
- Provider credentials resolve in the background from saved profiles. Never copy them into run configs, events, logs, journals, or chat messages.
- Codex and Hermes protocol details stay in their transport modules. Hermes server tools remain gateway-owned; client-side Act requires the advertised client-tool and result capabilities.
- Preserve the existing event contract consumed by `chat.js`: ordered live deltas are transient, terminal events and bounded journal entries settle the run, and errors never imply successful task completion.
- Keep the reserved `web_search` tool and Act tools inside the existing registries and policy boundaries. Do not duplicate run lifecycle or tool execution in `background.js`.

## Work and verification

- Add behavior tests in `tests/` for changed provider, run, or tool behavior. Run `npm run test:behavior` and `npm run validate` for source changes.
- Exercise a side-panel run and each affected provider/tool flow manually when runtime behavior changes.
