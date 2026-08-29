# Architecture

Prompt Paul is a Manifest V3 Chrome extension with three main surfaces:

- `background.js` - service worker, context menus, storage orchestration, and message routing
- `chat.js` - side panel chat interface
- `options.js` - settings, instructions, tools, and skills management

## System Layers

### Browser Layer

- Content scripts extract page content and page metadata
- The background worker coordinates context menu actions and permissions
- The side panel displays chat, page actions, and loaded content

### Chat Layer

- `src/chat/ChatUI.js` renders messages and attachments
- `src/chat/ChatAPI.js` resolves profiles and starts runs
- `src/chat/ChatGrounding.js` web-search toggle state, Brave key status bridge, and Sources formatting
- `src/chat/ChatSkills.js` parses `/skills` and `/skill` commands
- `src/chat/ChatMedia.js` prepares image, video, and audio requests
- `src/chat/ChatStream.js` tracks streaming state and history
- `src/chat/ChatPageActions.js` renders page-aware quick actions and preset prompts
- `src/chat/ChatPageAutomation.js` owns the default-off Act toggle, sanitized page-action approval cards, and reconnect notices; legacy Tabs helpers remain only for compatibility
- `src/chat/ChatRunRecovery.js` stores the opaque active-run pointer and renders bounded session journal status after reconnect
- `src/chat/ChatComposer.js` composer-led UI: context tray, contextual quick actions, and inline Stop/Retry/Edit/Continue recovery
- `src/chat/ChatStream.js` owns the local conversation identity so provider switches can continue the visible transcript safely

### Shared Utilities

- `src/utils/contextBudget.js` trims loaded page content to fit the model window
- `src/utils/hermesContext.js` builds bounded Hermes current-turn input and explicit transcript history while removing historical binary media
- `src/utils/readStrategy.js` picks the extraction mode from page signals
- `src/utils/siteExtractors.js` owns bounded Reddit-thread, GitHub-metadata, and RSS/Atom feed formatting with explicit caps. It is mirrored structurally inside the classic `content_script_unified.js` runtime; keep caps and behavior aligned on both sides.
- `src/utils/permissionGuards.js` blocks unsupported browser pages
- `src/utils/actionCards.js` generates site-specific quick actions
- `src/utils/suggestionStorage.js` stores custom site suggestions
- `src/utils/skillParser.js` parses and validates `SKILL.md`
- `src/utils/toolChoiceBuilder.js` normalizes tool choice payloads
- `src/utils/validation.js` owns HTTP(S)-only endpoint validation, custom-tool/profile normalization, and bounded backup restore validation
- `src/utils/runtimeAuthorization.js` owns extension-sender, content-script-tab, and opaque run-owner checks for privileged background messages
- `src/utils/streamSafety.js` bounds provider SSE buffers and error-body reads
- `src/utils/codexAuth.js` owns the profile-local ChatGPT device-code login, token refresh, and secret-free status bridge. `src/orchestrator/CodexTransport.js` converts Prompt Paul history/tools to the ChatGPT Codex Responses wire and parses its stream.
- `src/orchestrator/HermesTransport.js` owns the authenticated Hermes gateway routes, session creation, bounded SSE parsing, and server approval requests. Hermes credentials and session pointers stay in the background worker.
- `src/utils/modelDiscovery.js` owns background-only `/models` requests. API profiles use the configured compatible endpoint, while Codex profiles use the authenticated Codex backend route and receive model-specific reasoning metadata.
- `src/utils/braveSearch.js` bounded Brave LLM Context client with URL and payload validation
- `src/utils/pageDom.js` bounded semantic DOM snapshot normalization and sensitive-field masking
- `src/utils/pageActionPolicy.js` page-action and bounded tab argument validation, risk classification, hard blocks, trusted-mode policy, and safe manual-intervention validation
- `src/utils/pageActionScopeDiff.js` non-public bounded indexed-region and snapshot-diff measurements for page-action evaluation
- `src/utils/runState.js` standardized run/feedback state vocabulary (`data-run-state`) shared by chat and options

### Options Layer

- `src/options/OptionsUI.js` setup status, dirty tracking, unsaved-changes guard, and credential masking helpers

### Shared UI

- `theme.css` theme tokens including semantic feedback colors (success/warning/info/running)
- `ui-primitives.css` shared primitives (buttons, chips, badges, trays, sections, run indicators)

## Data Flow

### Page content

1. The user loads a page into the side panel
2. The content script extracts text and metadata
3. The background worker returns the extracted payload
4. `chat.js` trims the content to the current budget
5. The user asks follow-up questions against that page context

### Skill usage

1. The user types `/skills`, `/skill <name>`, or `/<skill-name>`
2. `ChatSkills.js` parses the command
3. The orchestrator resolves the matching skill
4. The skill instructions are injected into the run context

### Prompt composition

1. All prompt paths return structured `{instruction, context}` request objects
2. `composeUserPrompt` from `src/prompts.js` combines instruction and context into a single user message
3. Context boundaries (e.g. `--- Selected text ---`) mark where external content begins and ends
4. Media payloads are attached separately in `makeApiCallWithMedia`, not inlined in the text prompt

### Profile routing

1. `ChatAPI.js` reads the selected profile and keeps the opaque run owner token in memory
2. The background worker re-resolves the saved profile and configured tools before starting a run, so provider credentials and endpoints are not accepted from an untrusted message
3. `executeRun` acknowledges acceptance immediately; long-running execution is detached from the sender's message channel and completion is delivered through ordered `orchestratorEvent` messages plus the bounded session journal
4. Shared routing helpers validate the endpoint, key, and model
5. Media requests can reroute to a vision-capable profile when needed
6. Options creates or selects the `Codex` profile after successful subscription sign-in, then loads the provider model list and persists the selected model/reasoning level

### Hermes gateway provider (optional)

1. Options stores a Hermes profile with a loopback gateway endpoint and optional Hermes profile slug. The API key is stored in the background-owned `hermesApiKeys` map and is not included in profile records or backups.
2. `background.js` validates the stored profile, checks `/health` and `/v1/capabilities`, requires the advertised run submission/status/SSE/stop/approval features, and starts Hermes runs through `RunOrchestrator`.
3. `HermesTransport` creates or reuses one opaque Hermes session per profile and local conversation identity, sends bounded `conversation_history` plus the latest structured user input, recovers only explicit `session_not_found` run failures, and observes `/v1/runs/{id}/events` through a bounded SSE parser.
4. Hermes message, reasoning, server-tool, approval, completion, failure, and cancellation events are adapted to the existing `orchestratorEvent` vocabulary. Server tools stay owned by Hermes; Prompt Paul does not execute their payloads.
5. Prompt Paul renders Hermes approval cards, ties decisions to the pending opaque approval ID, and sends only validated approval choices back through the background worker. Act/page actions remain disabled until Hermes exposes a documented client-tool result protocol.

### Reasoning responses

1. `RunOrchestrator` separates structured and inline reasoning from answer text and records provider completion reasons without forwarding hidden reasoning in terminal metadata
2. Reasoning-capable provider requests reserve explicit output capacity for the final answer
3. Codex model metadata supplies the Options thinking-level choices; the selected level is sent as `reasoning.effort`
4. A reasoning-only response receives at most one text-only recovery request with tools disabled
5. `ChatGrounding` shows the token-budget warning only when the provider confirms a token-limit completion; otherwise it uses a neutral no-answer message

### Storage import and external tool boundaries

1. Options export filters to supported local/sync backup keys; API credentials remain subject to the existing backup warning, while Codex subscription tokens are never exported.
2. Backup restore validates supported storage keys and nested profiles/tools before writing; unknown keys are skipped, and restored Codex profiles require reauthentication.
3. Custom tools remain user-configured HTTP(S) endpoints, but save, import, profile/runtime resolution, and execution share the same method/name/URL validation.
4. Custom-tool diagnostics expose only safe status/error codes; endpoint URLs, query strings, credentials, and remote response bodies are not logged.
5. Privileged runtime messages require an extension-page sender; content-script extraction is bound to its own tab, and run mutations require the opaque owner token issued at run start.
6. Source checkouts and release builds remain credential-free; connection credentials are provided by the user in Options.

### Current-Page Actions (optional)

1. The side-panel **Act** toggle stores `pageActionsEnabled` in session storage, defaults to `false`, and consumes it for one run; it is a run permission, not a request to act. Options separately persists `pageActionsTrustedMode`, also default `false`.
2. `chat.js` passes `pageActions: true` only for opted-in runs with a supported source tab. The Act lease includes owned-tab tools; the old `pageActionsMultiTab` field is accepted for compatibility but is not a second permission. `RunOrchestrator` forces the first page-action tool turn through `page_get_state`; later mutations still require policy evaluation and approval. Tabs are owned by the run, capped at eight, and opened/switched tabs pass a bounded document/bridge readiness check. Safe HTTP(S) navigation across origins does not create a per-site prompt. A failed tab is quarantined so the run can continue on another healthy tab or report partial progress; after a user reload, a fresh `page_get_state` can re-probe the failed source tab. If the active target tab changes documents during a live run, the orchestrator adopts the supported destination and forces a fresh inspection. `page_request_user_input` asks one bounded, non-secret clarification. `page_pause_for_user` pauses for a safe manual step and requires explicit Resume. `page_record_note` stores bounded untrusted observations for long tasks and rejects secret, credential, and payment wording.
3. The all-pages content script creates an on-demand, bounded semantic snapshot with indexed controls and a run-scoped `snapshotId`; text is marked as untrusted reference data and password/OTP/credential/payment values are masked or omitted.
4. Mutating actions require the current snapshot ID and are routed by `background.js` to the selected owned tab. `background.js` waits for the new document and content-script bridge before returning a new-tab result, and the orchestrator clears the old snapshot and forces `page_get_state` before another mutation. Unexpected active-tab navigation is recovered the same way; a stale mutation is skipped, while an action interrupted after delivery is marked unverified and is never blindly repeated. A disconnected bridge quarantines only its tab instead of terminating the run.
5. `pageActionPolicy.js` classifies targets and enforces default confirmation, trusted-mode limits, hard blocks, separate observation/navigation/mutation budgets (64/24/16), and DOM-only behavior. There is no selector, coordinate, arbitrary JavaScript, or main-world escape hatch; validated HTTP(S) links may transition the current tab without per-origin permission, while `_blank` links use the owned-tab `page_open_link` tool. Sensitive detection is element-aware so ordinary labels such as “Video Cards” are not mistaken for payment fields.
6. Mutations return bounded action receipts: `not_delivered`, `delivered_unverified`, or `delivered_verified`. Input, select, checkbox, and observed navigation postconditions can be verified. An unverified mutation is not retried automatically; the same unchanged mutation is blocked until the page is inspected again. Confirmable actions emit bounded `page_action_confirmation` events. The side panel renders Approve/Deny cards with an explicit “Approve all this session” option for every policy-allowed action; that session approval is scoped to the live run, while hard-blocked controls remain unavailable. Decisions are matched to the live run and opaque confirmation ID, and timeout/stop/error paths clear pending UI and content-script state.
7. The page-actions system-prompt block is directive: when the user's request is achievable on the current page, the model must inspect, act, re-inspect after each mutation, and summarize what it did. A run may use only its owned tabs and must switch before acting on another tab; background tabs do not retarget the active target. Safe HTTP(S) navigation crosses origins without a per-site prompt, while writes and risky controls remain gated. Opened tabs return only after readiness is verified, and a failed tab is skipped with a bounded recovery result. `page_record_note` keeps short untrusted facts while old snapshots are compacted before provider calls. Unexpected active-tab changes discard the stale snapshot and require `page_get_state`, after which the model continues the same request. `_blank` links use `page_open_link`. The model can pause only for a safe user-only step; Resume clears the content-script session and forces a fresh `page_get_state`. The model never fakes an action. An empty snapshot result tells the model the page has nothing actionable and to ask the user to open the target page. Scope/diff measurements remain test-only until reliability and safety evidence supports a later public tool.
8. The evaluation contract is credential-free and bounded. `tests/page-action-evaluation.json` defines 11 cases; unit execution covers API, Codex, Hermes, and restricted-page boundaries, while the browser evaluator runs the browser-safe cases against local fixtures. It records only result, receipt disposition, postcondition evidence, failure code, action count, prompt size, and scope metrics. Live scope measurements use indexed semantic regions and snapshot diffs; they never accept model-supplied selectors or return raw values.

### Web Search Grounding (optional)

1. The sidebar **Web** toggle sets a boolean `webSearchEnabled` in `chrome.storage.local`; the side panel asks the background worker only for configured/not-configured status and never reads `braveSearchApiKey`
2. `chat.js` reads the global preference at each `makeApiCall` / `makeApiCallWithMedia` entry and injects `webSearch: true` into `runConfig`
3. The background worker validates key availability and injects a background-owned search executor; only that executor reads `braveSearchApiKey` from storage at search time
4. `RunOrchestrator._buildTools()` offers the reserved `web_search` tool alongside the normal toolset (or alone for `none` / a satisfied forced user tool) with automatic model selection while a search is available; grounding is permission, not a mandate
5. `executeTool()` claims the single search slot before network I/O. Parallel or hallucinated duplicate calls receive `WEB_SEARCH_ALREADY_USED` and cannot issue another Brave request
6. After an attempt, the grounding prompt switches to an already-completed phase and the immediate LLM continuation is text-only so the model consumes the existing result and produces the final answer
7. Empty normalized results become the safe `WEB_SEARCH_NO_RESULTS` outcome. Nested tool outcomes are classified before rendering so failures are not shown as successful executions
8. `_finalizeTextResponse()` emits normalized `event.grounding.sources` when a search produced usable sources, and `chat.js` appends an escaped first-party `**Sources:**` section to rendered, copied, and persisted output
9. When grounding is off, no grounding field or Sources section is added; the normal LLM payload and UI behavior remain unchanged
10. Grounding requires an endpoint/model that supports function tools. Tool rejection is surfaced as an actionable error rather than retried indefinitely

## Build and Test

- `scripts/build.js` copies the extension into `dist/`
- `scripts/test-runner.js` checks module structure and key regression guards
- `scripts/smoke-check.js` performs the cheapest end-to-end sanity check
- `npm run test:browser` runs every unpacked-extension spec in `tests/browser/` against a real headed Chromium-family browser and exercises the content-script bridge, selected-text actions, the executable page-action corpus, live scope/diff measurement, privileged-message rejection, indexed compose controls, interrupted connections, timeout, active-tab navigation recovery, and service-worker restart paths; set `PROMPT_PAUL_BROWSER=chrome|edge` to target an installed branded browser. Chrome 137+ and equivalent Edge builds use the browser-level CDP Extensions domain to load the unpacked directory. CI runs this suite under Xvfb.

## Notes

- The extension stays inside Chrome storage and the browser runtime
- Remote APIs are only called when the user sends a prompt or action
- Restricted pages are blocked early with a user-friendly message
