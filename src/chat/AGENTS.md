# Chat DOX

## Purpose

The `src/chat/` subtree contains side panel chat modules imported by `chat.js`.

## Ownership

- `ChatUI.js` owns chat DOM rendering, message controls, and attachment previews.
- `ChatAPI.js` owns profile/config resolution and run bridge calls to the background worker. It must resolve the selected profile through the shared valid-profile fallback so an incomplete selected profile does not hide a usable Default profile.
- `ChatAPI.js` passes the selected profile provider, ID, model, and saved reasoning level to the background run bridge. Codex credentials are never read by chat modules.
- `ChatSkills.js` owns `/skills`, `/skill <name>`, per-skill shortcuts, natural-language skill intent detection, and the pure typeahead picker helpers (`buildSlashCandidates`, `filterSlashCandidates`).
- `ChatMedia.js` owns media validation, media prompts, base64 conversion, attachment sizing, and vision support checks.
- `ChatStream.js` owns streaming state tracking.
- `ChatVoice.js` owns speech recognition state and voice toggle behavior.
- `ChatPageActions.js` owns page-aware quick actions and preset analysis prompts.
- `ChatPageAutomation.js` owns the default-off Act toggle, page-action preference bridge, and sanitized approval-card rendering.
- `ChatPageAutomation.js` also owns the explicit Tabs toggle and the reconnect notice for the bounded session run journal. The Tabs toggle is off by default.
- `ChatPageAutomation.js` renders bounded clarification cards for `page_request_user_input`; answers are sent through the run/source ownership check in the background worker.
- The Act permission is passed to each run unchanged. The orchestrator owns the initial `page_get_state` inspection even when a custom tool choice is selected; the model-facing Act prompt must expose the callable page-tool list and must not imply that Act tools are unavailable.
- `ChatComposer.js` owns the composer-led UI: the visible context tray, the contextual quick-action row, and inline Stop/Retry/Edit/Continue recovery. It reads context from the DOM (tray item visibility, `data-run-state` on `#input-area`) and routes actions through handlers supplied by `chat.js`.

## Local Contracts

- Chat modules are imported from `chat.js`; tests expect every `src/chat/*.js` module to be referenced there.
- Source modules should stay under the current 600-line guard unless the test contract changes deliberately.
- Skill intent support must preserve the documented patterns in root AGENTS.md and `docs/SKILL_EXAMPLES.md`.
- Media handling must route image/video/audio requests through profile selection that supports vision when required.
- UI state changes that affect buttons, attachments, streaming, or storage sync must stay coordinated with `chat.js`.
- `ChatStream.js` run ID (`currentRunId`) is the authoritative ownership token for orchestrator events; `chat.js` checks it against `streamState.getRunId()` before processing any event.
- `ChatPageActions.js` returns structured `{instruction, context}` prompt request objects via `buildSmartPromptRequest`; callers pass these to `makeApiCall` which calls `composeUserPrompt` from `src/prompts.js`.
- Composer surfaces (`#context-tray`, `#quick-actions-row`, `#page-context-strip`) are the single visible context surface near the composer; `ChatComposer.js` keeps their visibility synchronized with strip state and the run-state contract from `src/utils/runState.js`.
- Inline recovery buttons (Stop/Retry/Edit/Continue) must route through the canonical run entry points (`stopApiRequest`, `runSelectedTextPrompt`, `makeApiCall`); Continue always builds on `previous_response` context, never on a stale sticky selection.
- Run reconnect UI may show only bounded journal metadata. It must never resume page actions automatically after a side-panel or worker restart.

## Work Guidance

- Navigation approval cards show bounded destination context. Same-tab HTTP(S) links use `page_click`; `_blank` links use `page_open_link` only when Tabs is enabled. New origins remain explicit approval actions.

- Keep DOM selection and page-level event wiring in `chat.js` unless a module already owns the behavior.
- Keep pure formatting/parsing helpers exported for tests where possible.
- Preserve user-friendly error messages for runtime, permission, profile, and media failures.
- Update root docs or skill examples when chat command behavior changes.
- New prompt paths must return structured request objects; do not concatenate raw context strings.

## Verification

- Run `npm run test` after chat module changes.
- For UI, media, voice, or streaming changes, reload the side panel and exercise the affected flow in Chrome or Edge.

## Local Contracts

- `ChatGrounding.js` owns the sidebar `webSearchEnabled` toggle, background-only Brave key status bridge, safe `Sources` formatting, and nested tool-result classification. It must not read `braveSearchApiKey` from side-panel storage.
- `ChatGrounding.formatSourcesBlock()`, `buildBodyWithSources()`, and `buildFinalResponseBody()` are the canonical rendering helpers for grounded completions; source titles and URLs must be normalized before rendering.
- Tool traces must classify the inner payload of the orchestrator `{ success, result }` envelope so already-used, no-results, and failed searches are never displayed as successful executions.
- The reserved tool names `web_search`, `page_get_state`, `page_click`, `page_input`, `page_select`, and `page_scroll` must never be shadowed by user-defined tools or imports; they are guarded in runtime and Options save/import validation.
- The Act toggle is a session-scoped, one-run permission, not a mandate to act. It is stored in `chrome.storage.session`, consumed when a run is prepared, and must be off for the next job or browser session unless the user enables it again. Act-enabled runs force an initial `page_get_state` inspection before the agent can respond and direct the model to perform page-achievable requests with the page tools instead of describing steps, re-inspecting after each mutation and summarizing what it did; approved navigation-capable controls may transition the current tab once and then require a fresh `page_get_state`. Requests outside page scope (terminal/OS actions, JavaScript, cross-tab, unsupported navigation, or navigation links) get a one-sentence capability boundary plus the closest achievable offer, never a fake action. Every mutation remains subject to page-action policy and approval, including trusted-mode navigation-capable controls. Approval cards offer one-time Approve/Deny or an explicit “Approve all this session” choice scoped to the current run; the session choice bypasses every confirmation for policy-allowed actions, while hard-blocked controls remain unavailable. Cards must be sanitized, tied to the current run/confirmation ID, and disabled on deny, timeout, stop, or error.
- When grounding is disabled, responses must remain identical to the pre-grounding behavior — no Sources section, no changed payload shape.
- Terminal response rendering consumes safe completion metadata; only confirmed token-limit exhaustion uses the token-budget warning, while reasoning-only responses may receive one bounded text-only recovery.

## Child DOX Index

- Current link contract: validated HTTP(S) same-tab links use `page_click`; `_blank` links use `page_open_link` when Tabs is enabled; new origins always require explicit approval.

- No child AGENTS.md files are currently needed under `src/chat/`.

## Work Guidance

- Keep `chat.js` under its enforced line guard; move composer wiring and helpers into `ChatComposer.js` and `ChatGrounding.js` rather than expanding the entry point.
- Grounding metadata travels only in terminal events and through `braveSearch.js` helpers — never carry the Brave key in LLM request payloads, events, or logs.
