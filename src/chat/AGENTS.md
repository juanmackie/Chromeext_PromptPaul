# Chat DOX

## Purpose

The `src/chat/` subtree contains side panel chat modules imported by `chat.js`.

## Ownership

- `ChatUI.js` owns chat DOM rendering, message controls, and attachment previews.
- `ChatModelStatus.js` owns the compact sidebar readout for the selected profile's mode and reasoning level, including storage-change refreshes.
- `ChatAPI.js` owns profile/config resolution and run bridge calls to the background worker. It must resolve the selected profile through the shared valid-profile fallback so an incomplete selected profile does not hide a usable Default profile.
- `ChatAPI.js` passes only the selected profile provider, ID, model, and saved reasoning level to the background run bridge. It must not include provider credentials in run messages. The background re-resolves provider credentials and configuration from storage, and ChatAPI keeps the opaque run owner token only in memory. Codex credentials are never read by chat modules. When the background resolves a missing Act source tab, ChatAPI adopts the returned source identity before registering the local run so later page-action approvals, clarification responses, and manual-resume responses remain bound to that tab.
- `executeRun` is an acknowledgement-only bridge: the background starts the long-running execution after returning `{ success: true, accepted: true }`, while terminal state arrives through `orchestratorEvent` and the session journal. ChatAPI keeps the run owner token until a terminal event or an acknowledged abort so a long task can survive message-channel and side-panel lifecycle changes.
- `ChatSkills.js` owns `/skills`, `/skill <name>`, per-skill shortcuts, natural-language skill intent detection, and the pure typeahead picker helpers (`buildSlashCandidates`, `filterSlashCandidates`).
- `ChatMedia.js` owns media validation, media prompts, base64 conversion, attachment sizing, vision support checks, and document attachments. `prepareDroppedFile()` classifies dropped files: `.txt`/`.md`/`.markdown`/`.csv`/`.json` documents become bounded text (`MAX_DOCUMENT_CHARS`, 200k chars) and every other allowed file follows the existing base64 media pipeline.
- `ChatStream.js` owns streaming state tracking, the in-memory conversation history, and the opaque conversation identity reused across provider/model switches until New chat or Clear.
- `ChatVoice.js` owns speech recognition state and voice toggle behavior.
- `ChatPageActions.js` owns page-aware quick actions and preset analysis prompts.
- `ChatActionMenu.js` owns the compact chat action dock overflow menu, including focus management, keyboard navigation, and active-state indicators.
- `ChatSelection.js` reads the live source-tab selection only when the user explicitly invokes a chat text action.
- `ChatPageAutomation.js` owns the default-off Act toggle, page-action preference bridge, and sanitized approval-card rendering.
- `ChatPageAutomation.js` retains compatibility helpers for the legacy Tabs preference and owns the reconnect notice for the bounded session run journal. The visible chat surface uses the single Act lease for tab scope; there is no second Tabs permission.
- `ChatHermes.js` owns bounded Hermes server-approval cards and sends only validated approval choices through the background worker.
- `ChatPageAutomation.js` renders bounded clarification cards for `page_request_user_input`; answers are sent through the run/source ownership check in the background worker. Planner activation notices arrive as bounded `page_action_notice` events and render in the page-activity status card.
- The Act permission is passed to each run unchanged. If run setup fails before the background accepts a run, chat restores the consumed permission. The orchestrator owns the initial `page_get_state` inspection even when a custom tool choice is selected; the model-facing Act prompt must expose the callable page-tool list and must not imply that Act tools are unavailable. The single Act lease includes bounded run-owned tabs; background tabs are readiness-checked before use, and a failed tab is isolated rather than ending the run.
- `ChatComposer.js` owns the composer-led UI: the visible context tray, the contextual quick-action row, and inline Stop/Retry/Edit/Continue recovery. It reads context from the DOM (tray item visibility, `data-run-state` on `#input-area`) and routes actions through handlers supplied by `chat.js`.
- `PageContext.js` prepares loaded page/PDF metadata, budgeted text, and structured history messages before `chat.js` mutates the UI or conversation history.
- Hermes run preparation keeps the visible local transcript authoritative across profile changes and sends a bounded provider-specific history through the background bridge.

## Local Contracts

- Chat modules are imported from `chat.js`; tests expect every `src/chat/*.js` module to be referenced there.
- Hermes approval cards must use text nodes, show bounded server summaries, default to one-time approval, bind decisions to the opaque pending approval ID, visibly settle accepted/closed cards, and never render raw command arguments or credentials.
- Source modules should stay under the current 600-line guard unless the test contract changes deliberately.
- Skill intent support must preserve the documented patterns in root AGENTS.md and `docs/SKILL_EXAMPLES.md`.
- Media handling must route image/video/audio requests through profile selection that supports vision when required.
- Document attachments must use the `document` prompt context type from `src/prompts.js` and the plain `makeApiCall` path. Documents never enter the vision/base64 media pipeline and never trigger vision-profile rerouting.
- UI state changes that affect buttons, attachments, streaming, or storage sync must stay coordinated with `chat.js`.
- The idle Hermes chat action is **New chat**. It must end the selected Hermes session through the background worker before clearing local history, attachments, selection, and page context; API and Codex keep local **Clear** behavior.
- `ChatStream.js` run ID (`currentRunId`) is the authoritative ownership token for orchestrator events; `chat.js` checks it against `streamState.getRunId()` before processing any event. Orchestrator events are applied in monotonic sequence order, and the completed assistant bubble is placed after tool traces.
- `ChatPageActions.js` returns structured `{instruction, context}` prompt request objects via `buildSmartPromptRequest`; callers pass these to `makeApiCall` which calls `composeUserPrompt` from `src/prompts.js`.
- Composer surfaces (`#context-tray`, `#quick-actions-row`, `#page-context-strip`) are the single visible context surface near the composer; `ChatComposer.js` keeps their visibility synchronized with strip state and the run-state contract from `src/utils/runState.js`.
- Inline recovery buttons (Stop/Retry/Edit/Continue) must route through the canonical run entry points (`stopApiRequest`, `runSelectedTextPrompt`, `makeApiCall`); Continue always builds on `previous_response` context, never on a stale sticky selection.
- Run reconnect UI may show only bounded journal metadata. It must never resume page actions automatically after a side-panel or worker restart.

## Work Guidance

- Navigation cards show bounded destination context when a state-changing control needs approval. Same-tab HTTP(S) links use `page_click`; `_blank` links use `page_open_link` under the single Act lease. Safe navigation across origins does not require a second site permission; writes and risky controls remain gated.

- Keep DOM selection and page-level event wiring in `chat.js` unless a module already owns the behavior.
- Keep pure formatting/parsing helpers exported for tests where possible.
- Preserve user-friendly error messages for runtime, permission, profile, and media failures.
- Update root docs or skill examples when chat command behavior changes.
- New prompt paths must return structured request objects; do not concatenate raw context strings.
- Loading a new page replaces the prior page-context history entry and loaded-content card; detaching page context removes its local history entry without clearing the rest of the conversation.

## Verification

- Run `npm run test` after chat module changes.
- For UI, media, voice, or streaming changes, reload the side panel and exercise the affected flow in Chrome or Edge.

## Local Contracts

- `ChatGrounding.js` owns the sidebar `webSearchEnabled` toggle, background-only Brave key status bridge, safe `Sources` formatting, and nested tool-result classification. It must not read `braveSearchApiKey` from side-panel storage.
- `ChatGrounding.formatSourcesBlock()`, `buildBodyWithSources()`, and `buildFinalResponseBody()` are the canonical rendering helpers for grounded completions; source titles and URLs must be normalized before rendering.
- Tool traces must classify the inner payload of the orchestrator `{ success, result }` envelope so already-used, no-results, and failed searches are never displayed as successful executions.
- The reserved tool names `web_search`, all page-action and owned-tab tools, `page_request_user_input`, `page_pause_for_user`, `page_record_note`, and `page_replan` must never be shadowed by user-defined tools or imports; they are guarded in runtime and Options save/import validation.
- The Act toggle is a session-scoped, one-run permission, not a mandate to act. It is stored in `chrome.storage.session`, consumed when a run is prepared, and must be off for the next job or browser session unless the user enables it again. Act-enabled runs force an initial `page_get_state` inspection before the agent can respond and direct the model to perform page-achievable requests with the page tools instead of describing steps, re-inspecting after each mutation and summarizing what it did; safe HTTP(S) navigation across origins is allowed under the bounded Act lease, while writes and risky controls remain gated. Requests outside page scope (terminal/OS actions, JavaScript, unsupported navigation, or links without a safe supported destination) get a one-sentence capability boundary plus the closest achievable offer, never a fake action. The lease includes up to twelve owned tabs, readiness checks for opened/switched tabs, tab-local quarantine on bridge failure, separate observation/navigation/mutation budgets, bounded `page_record_note` memory, and bounded `page_replan` for replacing unresolved sub-goals. Every high-risk or navigation mutation remains subject to page-action policy and approval, including trusted-mode navigation-capable controls. Planner auto-approval applies only to low-risk, non-navigation mutations after one initial approval. Approval cards offer one-time Approve/Deny or an explicit “Approve all this session” choice scoped to the current run; the session choice bypasses every confirmation for policy-allowed actions, while hard-blocked controls remain unavailable. Manual-intervention cards show only bounded active-tab context and require explicit Resume. Receipt and activity cards show bounded delivery status and evidence. Cards must be sanitized, tied to the current run/confirmation ID, and disabled on deny, timeout, stop, or error.
- When grounding is disabled, responses must remain identical to the pre-grounding behavior — no Sources section, no changed payload shape.
- Terminal response rendering consumes safe completion metadata; only confirmed token-limit exhaustion uses the token-budget warning, while reasoning-only responses may receive one bounded text-only recovery.

## Child DOX Index

- Current link contract: validated HTTP(S) same-tab links use `page_click`; `_blank` links use `page_open_link` under the single Act lease; safe cross-origin navigation does not require a second site permission.

- No child AGENTS.md files are currently needed under `src/chat/`.

## Work Guidance

- Keep `chat.js` under its enforced line guard; move composer wiring and helpers into `ChatComposer.js` and `ChatGrounding.js` rather than expanding the entry point.
- Grounding metadata travels only in terminal events and through `braveSearch.js` helpers — never carry the Brave key in LLM request payloads, events, or logs.
