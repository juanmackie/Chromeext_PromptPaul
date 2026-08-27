# Orchestrator DOX

## Purpose

The `src/orchestrator/` subtree centralizes LLM run execution, tool calls, streaming events, abort handling, and skill-instruction injection.

## Ownership

- `RunOrchestrator.js` owns run IDs, active run state, tool execution idempotency, registered built-in tools (including the reserved `web_search` tool), provider-specific execution, and follow-up calls after tool execution.
- `CodexTransport.js` owns the ChatGPT subscription Responses request/input/tool conversion and SSE parsing. `RunOrchestrator.js` remains the owner of Codex tool execution, policy, skills, recovery, and Prompt Paul event shapes.
- `HermesTransport.js` owns authenticated or explicitly trusted-network Hermes gateway requests, session creation and stale-session recovery, bounded SSE parsing, pollable run-status recovery, and server approval calls. Hermes server tools remain gateway-owned; Prompt Paul only adapts safe lifecycle events and renders approvals.
- Provider transports use `src/utils/streamSafety.js` for bounded SSE buffers and error-body reads.
- The orchestrator exposes `run.webSearch` metadata only through the terminal `complete` event (`event.grounding.sources`); the Brave API key never leaves the service worker.
- Current-page actions are opt-in per run through `config.pageActions`, source-tab scoped, and registered as the reserved `page_get_state`, `page_click`, `page_input`, `page_select`, and `page_scroll` tools. Their executor is injected by the service worker; the model never receives browser APIs or selectors. Valid HTTP(S) same-tab links are confirmation-gated through `page_click`; `_blank` links use the indexed `page_open_link` tab tool. Agent-initiated navigation remains approval-gated; an unexpected transition in the active target tab is recoverable after the service worker observes the new URL and re-establishes the content-script bridge, then the orchestrator discards stale state and forces `page_get_state`.
- `config.pageActionsMultiTab` is a second explicit opt-in. It advertises only owned-tab list/open/switch/close tools, limits a run to eight tabs, blocks closing the source tab, and requires approval before a new origin is added. Page actions target the run's selected owned tab and require a fresh snapshot after a switch.
- `page_request_user_input` is a bounded clarification tool. It is available only in an Act-enabled run, blocks secret/payment questions, and waits for an extension-page response with a timeout or abort path. `page_pause_for_user` is a separate safe manual-intervention checkpoint that requires explicit Resume and fresh inspection.
- Act owns the first tool turn: when `config.pageActions` is enabled, `page_get_state` is the only advertised and forced tool until the initial snapshot exists. A forced custom tool choice resumes only after inspection. The Act prompt must name the authoritative callable page tools and tell the model not to claim that those tools are unavailable.
- The page-actions system-prompt block is directive and non-limiting: the model must execute page-achievable requests with the page tools (inspect → act → re-inspect → summarize what it did) rather than describing steps. The block deliberately never enumerates capabilities the tools lack (terminal/OS actions, JavaScript, cross-tab work), because that enumeration drove models to lead with “I can’t” refusals; requests the tools cannot execute are answered normally as a helpful assistant, and the model never fakes an action. Approved navigation-capable controls may transition the current tab once; unexpected active-tab changes discard the old snapshot and require `page_get_state` before continuing the same request. The model must follow that recovery notice instead of claiming that page tools are unavailable. Validated HTTP(S) links may navigate after policy approval; links that open a new tab use `page_open_link` when Tabs is enabled, and new origins require explicit approval. Secrets stay out of the page tools. Empty snapshots tell the model to ask the user to open the target page.
- Page-action policy is snapshotted at run start. Default mode confirms state-changing actions; trusted mode only skips allowed low/medium-risk approvals. An approval-card “Approve all this session” choice is scoped to the active run and skips every confirmation for policy-allowed actions; credential, OTP, payment, security, destructive, navigation-link, and unsupported actions that are hard-blocked remain unavailable.
- Act-mode instructions require the model to continue multi-item or ongoing page workflows after partial progress instead of returning an interim next-step menu; it may ask only when real ambiguity, a blocked action, or a safe manual step prevents progress.
- Brave execution is supplied through `braveSearchExecutor` and key availability through `webSearchStatusProvider`; `run.config.apiKey` is only the selected LLM credential.
- Search/tool sequencing is model-directed before use: a forced user tool (when configured) runs first exactly once, then `web_search` is offered with automatic model selection (never forced) while a search slot is available. The slot is claimed before network I/O.
- After a search attempt, the system prompt switches to an already-completed phase and the immediate continuation is text-only. Duplicate or parallel search calls receive `WEB_SEARCH_ALREADY_USED` and never issue another Brave request.
- A search response with no usable normalized sources produces `WEB_SEARCH_NO_RESULTS`; it is not treated as successful grounding.

## Local Contracts

- Navigation links are supported only when the snapshot exposes a validated HTTP(S) destination. Same-tab links use `page_click` with approval; links that open a new tab use the indexed `page_open_link` tool. Agent-initiated new origins always require explicit approval, including trusted or session-approved runs; an active target tab that changes documents independently is adopted automatically and inspected before any mutation.

- Skills are injected as instructions via the composed system prompt (`_buildSystemPrompt`), not via conversation history unshift. Requested skills are resolved through `resolveSkill` and included even when `disable-model-invocation` hides them from model self-discovery.
- Tool executions must remain idempotent by `runId` and `toolCallId`.
- The tool-call retry cap counts consecutive failing tool turns only: a successful tool result resets the counter, so multi-step page automation (inspect → act → re-inspect) can run up to the page-action budget. Mutation results carry a refreshed-snapshot notice so the model re-reads the current `snapshotId` and indexes instead of reusing stale ones. State-changing page actions return bounded delivery receipts with action-specific evidence; unchanged `delivered_unverified` mutations are not retried.
- Abort handling should emit a clean aborted event rather than surfacing intentional cancellation as an error.
- Provider-specific execution must preserve OpenAI-compatible and Anthropic-compatible endpoint behavior.
- Hermes provider execution must use the stored Hermes profile endpoint, never accept a credential from a chat message, and must reject Act/page actions until a documented client-tool result protocol is available. Hermes runs send the trailing unsent local user messages as current-turn input plus a bounded explicit `conversation_history`; loaded page context stays attached while it is active and historical binary media is removed. Hermes session pointers are bound to the local conversation identity. Hermes session boundaries use `PATCH /api/sessions/{id}` with a fixed `new_conversation` end reason; only the documented `session_not_found` response may clear an already-missing pointer. Stale-run recovery must not treat unrelated 404 responses as missing sessions. One Hermes run or stopping run is admitted per profile; different profiles may run independently. Hermes Stop keeps the active run and profile guard until a remote terminal state. Hermes capability checks require the advertised run submission, status, SSE, stop, and approval features before the connection is reported as supported; released gateways (0.20.x) advertise the approval feature as `run_approval_response`, which the check accepts alongside the documented `run_approval` name. Hermes approval decisions must match the pending opaque approval ID.
- Codex subscription runs use the background-provided access token and account identifier only at request time; never persist or emit those values through run state, journals, or UI events. The selected profile reasoning level is sent as the Codex Responses `reasoning.effort` field.
- Terminal `complete` events may include safe provider completion metadata. Reasoning-only responses receive at most one text-only recovery attempt without repeating tools or exposing hidden reasoning.
- `CORE_INSTRUCTIONS` applies to all runs unless the project deliberately changes the formatting policy.

## Work Guidance

- Keep orchestration logic centralized here instead of duplicating run or tool execution flow in `background.js`.
- Hermes server tools remain gateway-owned; do not register Prompt Paul custom-tool handlers for Hermes runs.
- Register new built-in tools through the existing tool registry pattern.
- Keep skill policy aligned with root AGENTS.md and `src/utils/skillParser.js`.
- Preserve event shapes consumed by `chat.js`; page-action confirmation events must include only bounded summaries, risk, target labels, and opaque confirmation IDs, never raw DOM values or secrets.
- Runtime events carry a monotonic per-run sequence and a bounded session journal. The journal stores safe activity summaries only; raw DOM snapshots, tool arguments, credentials, and streaming deltas are not persisted.

## Verification

- Run `npm run test` after orchestration changes.
- Exercise a side panel run, a skill invocation, and any affected tool flow manually when runtime behavior changes.

## Child DOX Index

- No child AGENTS.md files are currently needed under `src/orchestrator/`.
