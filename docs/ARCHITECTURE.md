# Architecture

Prompt Paul is a Manifest V3 Chrome extension with three main surfaces:

- `background.js` - service worker, context menus, storage orchestration, and message routing
- `chat.js` - side panel chat interface
- `options.js` - settings, instructions, tools, skills, and notch management

## System Layers

### Capability Ownership and Imports

The current source tree has application areas in `chat/`, `options/`, and
`orchestrator/`, plus shared modules in `utils/` and `prompts.js`. Root entry
points compose these modules. The structural runner checks imports under
`src/`: application areas cannot import one another; shared modules cannot
depend on application or capability areas; capability modules cannot import
application areas or other capabilities; and application areas import a
capability through its `index.js`. Any new first-level folder under `src/`
defaults to a capability. The only current exception is the evaluation-only
`utils/evalTrace.eval.js` adapter importing `act/index.js`.

Treat `utils/` as a compatibility area for existing shared modules, not the
default home for new capability logic. New work should start from its business
capability and use a vertical slice for the use case. As a capability gets a
cohesive set of modules, move that set behind an explicit entry point and keep
its implementation private to the capability. Shared code belongs in a common
area only when multiple capabilities use the same stable behavior.

Candidate capability areas include `conversation/`, `page-actions/`,
`provider-connections/`, `profiles/`, `search/`, and `content-extraction/`.
Within them, group new work by use case (for example,
`page-actions/fill-form/`) and expose only the capability's consumer-facing
interface from its `index.js`. `chat/` and `options/` remain presentation
surfaces; `orchestrator/` coordinates runs and adapters.

The import check protects direction while this migration happens. It does not
make directory moves safe by itself: preserve storage, message, provider, and
run-event contracts, and update the nearest owning contract and focused tests
with each capability-sized move.

### Browser Layer

- `content_script_notch.js` renders the optional edge-pinnable browser-viewport quick-action notch in an isolated Shadow DOM
- `content_script_diagnostics.js` relays development diagnostics from isolated content scripts, while `content_script_page_diagnostics.js` observes main-world page errors and console output only in development builds
- `content_script_unified.js` extracts page content and metadata; `content_script_page_actions.js` owns the semantic Act runtime and is injected only when an Act run needs it
- The background worker coordinates context menu actions, notch requests, permissions, and Act-runtime reinjection after navigation. It injects the Act runtime into supported frames on demand, merges bounded labelled frame outlines, keeps frame IDs out of model payloads, and routes indexed actions to the frame that produced the target. Site blocks apply per frame, and payment-like frames are omitted.
- `RunOrchestrator.execute()` keeps the worker alive while the run is executing or waiting for a user decision. `ServiceWorkerKeepAlive.js` calls a local extension API every 20 seconds and clears the interval when execution settles; nested turns share the same lifetime, and idle workers can suspend normally. Run budgets, decision timeouts, and explicit recovery after an unexpected restart remain in force.
- The side panel displays chat, page actions, and loaded content

### Chat Layer

- `src/chat/ChatUI.js` renders messages and attachments
- `src/chat/ChatAnswerRenderer.js` renders bounded read-only summary, key/value, and comparison cards with host-resolved source links; `ChatUI` keeps the readable text and copy controls
- `src/chat/ChatAPI.js` resolves profiles and starts runs
- `src/chat/ChatGrounding.js` web-search toggle state, active-provider status bridge, and Sources formatting
- `src/chat/ChatSkills.js` parses `/skills` and `/skill` commands
- `src/chat/ChatMedia.js` prepares image, video, and audio requests
- `src/chat/ChatStream.js` tracks streaming state and history
- `src/chat/ChatPageActions.js` renders page-aware quick actions and preset prompts
- `src/chat/ChatPageAutomation.js` owns the default-off Act toggle, sanitized page-action approval cards, reconnect notices, and the run-scoped page-task progress card driven by bounded `page_task_progress` events; the card shows the current step and target page while running and a deterministic verified-work / unresolved-work / next-recovery-action outcome block at the end, routed onto the existing approval, clarification, manual-Resume, and Watch controls. The legacy multi-tab field remains runtime compatibility only
- `src/chat/ChatRunRecovery.js` stores the opaque active-run pointer and renders bounded session journal status after reconnect
- `src/chat/ChatComposer.js` composer-led UI: context tray, a row of contextual/site suggestions capped at four visible actions (the rest in an overflow menu), no-context starter actions (Summarize page, Ask about page, Act on page) plus the sticky Act permission indicator, and inline Stop/Retry/Edit/Continue recovery
- `src/chat/ChatStream.js` owns the local conversation identity so provider switches can continue the visible transcript safely

### Shared Utilities

- `src/utils/contextBudget.js` trims loaded page content to fit the model window
- `src/utils/answerSchema.js` validates the native answer-card schema and decodes its tagged wire section without exposing that section as chat text
- `src/utils/hermesContext.js` builds bounded Hermes current-turn input and explicit transcript history while removing historical binary media
- `src/utils/siteExtractors.js` owns bounded Reddit-thread, GitHub-metadata, and RSS/Atom feed formatting with explicit caps. It is mirrored structurally inside the classic `content_script_unified.js` runtime; keep caps and behavior aligned on both sides.
- `src/utils/permissionGuards.js` blocks unsupported browser pages
- `src/utils/actionCards.js` generates site-specific quick actions
- `src/utils/suggestionStorage.js` stores custom site suggestions
- `src/utils/skillParser.js` parses and validates `SKILL.md`
- `src/utils/toolChoiceBuilder.js` normalizes tool choice payloads
- `src/utils/validation.js` owns HTTP(S)-only endpoint validation, custom-tool/profile normalization, and bounded backup restore validation
- `src/utils/runtimeAuthorization.js` owns extension-sender, content-script-tab, and opaque run-owner checks for privileged background messages
- `src/background/` owns injected capability handlers for diagnostics, notch, instructions, panel navigation, page extraction, search status, skills, providers, runs, and Act messages; `background.js` composes them with browser orchestration
- `src/utils/streamSafety.js` bounds provider SSE buffers and error-body reads
- `src/utils/mediaFetch.js` validates public media URLs and bounds media response reads
- `src/utils/runResilience.js` classifies provider failures, applies reasoning-model timeout floors, compacts long conversation histories, redacts provider error labels, and stops repetitive output
- `src/utils/codexAuth.js` owns the profile-local ChatGPT device-code login, token refresh, and secret-free status bridge. `src/orchestrator/CodexTransport.js` converts Prompt Paul history/tools to the ChatGPT Codex Responses wire and parses its stream.
- `src/orchestrator/HermesTransport.js` owns the authenticated Hermes gateway routes, session creation, bounded SSE parsing, and server approval requests. Hermes credentials and session pointers stay in the background worker.
- `src/orchestrator/OpenAIExecution.js` and `AnthropicExecution.js` own the API provider request and stream loops. They install methods onto `RunOrchestrator` so provider-specific transport code shares the existing run lifecycle and tool state.
- `src/utils/modelDiscovery.js` owns background-only `/models` requests. API profiles use the configured compatible endpoint, while Codex profiles use the authenticated Codex backend route and receive model-specific reasoning metadata. Advertised API `supported_parameters` becomes true/false/unknown tool support. Saved profile metadata is endpoint/model-bound; enabling Act checks this safe status without generation.
- `src/utils/braveSearch.js` bounded Brave LLM Context client with URL and payload validation (requires a key)
- `src/utils/keylessSearch.js` keyless search client for Exa's hosted MCP endpoint with a Parallel Search MCP fallback; normalizes to the same source shape as Brave
- `src/utils/pageDom.js` bounded semantic DOM snapshot normalization and sensitive-field masking
- `src/utils/pageActionPolicy.js` page-action and bounded tab argument validation, including `page_wait` and non-nested read-only `page_batch`, risk classification, hard blocks, trusted-mode policy, and safe manual-intervention validation
- `src/utils/pageActionSitePolicies.js` validates the persistent, backup-supported map of at most 200 origins and serializes background-owned policy writes
- `src/act/` owns run-scoped page-action execution, policy coordination, model-maintained evidence-gated checklists, finite counted quotas, bounded terminal outcomes, and tool schemas; `ActExecution.js` is installed onto the shared `RunOrchestrator` host so Act uses the same run state and lifecycle
- `src/orchestrator/PageTabController.js` owns run-created tabs, reuses one work tab per site, and groups new tabs when the browser supports it
- `src/utils/pageActionCheckpoint.js` bounded session-only mutation checkpoints and explicit-recovery metadata, including twelve checklist steps
- `src/utils/retryBackoff.js` bounded exponential backoff with jitter for bridge and navigation recovery
- `src/utils/pageActionScopeDiff.js` bounded selector-free indexed-region and snapshot-diff helpers
- `src/utils/runState.js` standardized run/feedback state vocabulary (`data-run-state`) shared by chat and options
- `src/utils/devDiagnostics.js` opt-in development trace storage, credential-shaped redaction, bounded records, and extension-page error capture; production builds replace it with a no-op module
- `src/utils/evalTrace.js` and `src/utils/evalHook.js` provide no-op source interfaces; `npm run build:eval` installs their bounded direct-run implementations only in `dist-eval/`

### Options Layer

- `src/options/OptionsUI.js` setup status, dirty tracking, unsaved-changes guard, and credential masking helpers
- `src/options/OptionsPageActions.js` renders the bounded site-policy list; explicit add/block/remove controls save through the authenticated background bridge and refresh on storage changes
- The Top Notch section persists `notchEnabled` with an explicit save and participates in the combined unsaved-changes guard

### Shared UI

- `theme.css` theme tokens including semantic feedback colors (success/warning/info/running)
- `themeUtils.js` three-state Light/Dark/System preference handling, effective-theme application, and system-preference changes
- `ui-primitives.css` shared primitives (buttons, chips, badges, trays, sections, run indicators)

## Data Flow

### Page content

1. The user loads a page into the side panel or chooses **Summarize page** from the enabled notch
2. The content script extracts text and metadata
3. The background worker validates the sender tab and returns a bounded extracted payload
4. `chat.js` trims the content to the current budget and composes a structured request
5. The user asks follow-up questions against that page context

### Skill usage

1. The user types `/skills`, `/skill <name>`, or `/<skill-name>`
2. `ChatSkills.js` parses the command
3. The orchestrator resolves the matching skill
4. The skill instructions are injected into the run context

### Prompt composition

1. All prompt paths return structured `{instruction, context}` request objects
2. `composeUserPrompt` from `src/prompts.js` combines instruction and context into a single user message
3. Context boundaries (e.g. `--- Selected text ---`) mark where external content begins and ends; instruction/context text is bounded and context is explicitly treated as untrusted source material
4. Page metadata and document names travel as bounded context metadata, never as instructions
5. Media payloads are attached separately in `makeApiCallWithMedia`, not inlined in the text prompt

### Optional answer cards

1. The user chooses **Summary cards** or **Compare cards** for attached page, selected text, or document context. The composer sends a structured prompt request with the run-local `answerFormat: 'cards'`; ordinary requests retain their format.
2. The shared orchestrator adds static formatting instructions. The model returns a complete readable Markdown answer, optionally followed by a `promptpaul-cards` fenced JSON payload.
3. The bounded decoder streams readable text and withholds the card payload. A forward-only scanner validates complete block prefixes under the same byte, depth, block, and text caps. Progressive detection uses the canonical root order (`version`, then `blocks`); other valid ordering still renders on completion. Full terminal validation remains authoritative. Invalid or oversized data leaves readable text available, without repair calls.
4. API, Anthropic, Codex, and Hermes content passes through the same normalization boundary. Ordered live `answer_cards` events carry a host-issued provider-turn identity and validated prefix; invalidity, Stop/error, and tool continuations clear provisional cards. Assistant history and terminal journal content use readable text; projections and local interaction state remain ephemeral.
5. The side panel revalidates projections and reconciles unchanged native DOM blocks to preserve focus, scroll, disclosures, filters, and sorting. Source IDs resolve only to host-provided grounding metadata. Cards hold no tool, page-action, form, or network authority.
6. **Read as text** and copy retain the complete readable answer. Reconnect uses the existing 8,000-character journal text cap and truncation notice; card projections are not persisted.
7. Static host-authored follow-ups prefill the composer without sending. A memory-only originating request and captured source tab bind the eventual explicit Send to its original bounded context. Add Page returns the exact extraction tab ID in its trusted background response; the attached page retains that ID in memory, including through PDF extraction. Page-card requests use this stored source even after the active tab changes, and an unavailable source fails visibly. Detach or replacement clears it. The pending context chip can be cancelled; replacing attachments or choosing another action clears it. Local table controls never invoke the provider.

The implementation uses a small native schema rather than the full OpenUI runtime. The parser experiment and its limits are recorded in [OPENUI_EXPERIMENT.md](OPENUI_EXPERIMENT.md).

### Profile routing

1. `ChatAPI.js` reads the selected profile and keeps the opaque run owner token in memory
2. The background worker re-resolves the saved profile and configured tools before starting a run, so provider credentials and endpoints are not accepted from an untrusted message
3. `executeRun` acknowledges acceptance immediately; long-running execution is detached from the sender's message channel and completion is delivered through ordered `orchestratorEvent` messages plus the bounded session journal
4. Non-Hermes runs use a 500-provider-call and 30-minute default ceiling, issue one toolless wrap-up call at the limit, retry transient provider failures with backoff, compact the middle of oversized histories, and apply model-aware request timeouts. Duplicate public execution is ignored while a run is already active.
5. Shared routing helpers validate the endpoint, key, and model
6. Media requests can reroute to a vision-capable profile when needed
7. Options creates or selects the `Codex` profile after successful subscription sign-in, then loads the provider model list and persists the selected model/reasoning level

### Hermes gateway provider (optional)

1. Options stores a Hermes profile with a loopback gateway endpoint and optional Hermes profile slug. The API key is stored in the background-owned `hermesApiKeys` map and is not included in profile records or backups.
2. `background.js` validates the stored profile, checks `/health` and `/v1/capabilities`, requires the advertised run submission/status/SSE/stop/approval features, and starts Hermes runs through `RunOrchestrator`.
3. `HermesTransport` creates or reuses one opaque Hermes session per profile and local conversation identity, sends bounded `conversation_history` plus the latest structured user input, recovers only explicit `session_not_found` run failures, uses bounded control-plane request timeouts, and observes `/v1/runs/{id}/events` through a bounded SSE parser.
4. Hermes message, reasoning, server-tool, approval, completion, failure, and cancellation events are adapted to the existing `orchestratorEvent` vocabulary. Server tools stay owned by Hermes; Prompt Paul does not execute their payloads.
5. Prompt Paul renders Hermes approval cards, ties decisions to the pending opaque approval ID, and sends only validated approval choices back through the background worker. Hermes Act is capability-gated: the gateway must advertise `run_client_tools` and `POST /v1/runs/{run_id}/tool-result`; client calls reuse the bounded page-action policy, approvals, ownership, and receipts.

### Reasoning responses

1. `RunOrchestrator` separates structured and inline reasoning from answer text and records provider completion reasons without forwarding hidden reasoning in terminal metadata
2. Reasoning-capable provider requests reserve explicit output capacity for the final answer
3. Codex model metadata supplies the Options thinking-level choices; the selected level is sent as `reasoning.effort`
4. Empty responses receive at most one text-only recovery request with tools disabled; repeated long output is stopped before it can flood the chat
5. `ChatGrounding` shows the token-budget warning only when the provider confirms a token-limit completion; otherwise it uses a neutral no-answer message

### Storage import and external tool boundaries

1. Options export filters to supported local/sync backup keys, including Light/Dark/System `themePreference` and `pageActionSitePolicies`; provider/search credentials and session-scoped Act permission are excluded.
2. Backup restore validates supported storage keys and nested profiles/tools before writing; unknown keys are skipped, and restored Codex profiles require reauthentication.
3. Custom tools remain user-configured HTTP(S) endpoints, but save, import, profile/runtime resolution, and execution share the same method/name/URL validation.
4. External media URLs use public HTTP(S)-only validation, reject private hosts and non-media responses/redirects, and enforce timeout and response-size limits before conversion.
5. Instruction and skill imports enforce file/item/body bounds and persist only normalized instruction fields.
6. Custom-tool diagnostics expose only safe status/error codes; endpoint URLs, query strings, credentials, and remote response bodies are not logged. The separate development diagnostics build may record richer local troubleshooting data, but it remains session-scoped, bounded, opt-in, and redacts credential-shaped values.
7. Privileged runtime messages require an extension-page sender; content-script extraction and notch actions are bound to their own tab, and run mutations require the opaque owner token issued at run start.
8. Website deep links bind context to the external sender tab instead of accepting a caller-supplied target tab.
9. The notch bridge accepts only its fixed action allowlist, bounds selected/page text, and never receives provider credentials.
10. Source checkouts and release builds remain credential-free; connection credentials are provided by the user in Options.

### Browser-page Top Notch (optional)

1. `notchEnabled` is a persistent local boolean and defaults to `false`; Options saves it explicitly. Open pages observe storage changes and mount or remove the notch without a reload.
2. The all-pages notch content script runs only in the top frame, mounts one fixed browser-viewport host, follows the saved Light/Dark/System theme preference (including live system changes), and uses Shadow DOM plus accessible labels, focus states, Escape handling, and reduced-motion support. Its bounded position persists: `notchPlacement` (top/right/bottom/left) picks the anchored edge and `notchPosition` (0-100) sets the offset along that edge, changeable by dragging the rail along that axis.
3. The collapsed notch exposes a compact top-edge toggle. Its expanded surface keeps primary actions tight, offers bounded page summarization and selected-text explanation, renders up to four saved pinned prompts in pin order, and provides one-turn dictation plus an explicit Act task field. Dictation always requests the bounded current page context, while pinned prompts use the current bounded selection first, current page content for a new conversation, or the active conversation when one exists. Act submission enables page actions for the browser session until the user disables them or the session ends; selection actions remain disabled until the page has a current bounded selection.
4. Notch messages are accepted only from an injected content script with a valid sender tab. The background worker checks the fixed action allowlist, validates pinned instruction IDs and bounded dictated/task text, rejects unsupported pages, bounds payloads, and starts `chrome.sidePanel.open()` synchronously inside the message handler before any tab or extraction await. It then routes actions through `openChatWithContext`, `sendPanelMessage`, and the existing structured prompt composition.
5. During an Act page-action event, the background notifies the current target tab and the notch content script renders a temporary three-pixel blue border glow. The glow is cleared on action completion/error and run termination; the border is viewport-only because extensions cannot style browser chrome.
6. The notch is browser-page scoped and can dock to any of the four viewport edges; users drag it along that edge without moving page layout. Chrome internal pages, extension pages, and the Chrome Web Store do not receive a usable action surface, and the extension cannot provide an OS-wide desktop overlay.

### Current-Page Actions (optional)

1. The side-panel **Act** toggle stores `pageActionsEnabled` in session storage, defaults to `false`, and remains enabled across runs until the user disables it or the browser session ends; it is a permission, not a request to act. An enabled Act run fails with an actionable error when its source tab cannot host page actions. Options separately persists `pageActionsTrustedMode`, also default `false`.
2. `chat.js` passes `pageActions: true` only for opted-in runs with a supported source tab. The Act lease includes owned-tab tools; the old `pageActionsMultiTab` field is accepted for compatibility but is not a second permission. Non-Hermes runs perform `page_get_state` before the first provider request and serialize a matching synthetic tool pair; Hermes keeps gateway-directed inspection. Later mutations still pass policy and approval. Tabs are owned by the run, capped at twelve, and opened/switched tabs pass a bounded document/bridge readiness check. Safe HTTP(S) navigation across origins does not create a per-site prompt. A failed tab is quarantined so the run can continue on another healthy tab or report partial progress; after a user reload, a fresh `page_get_state` can re-probe the failed source tab. If the active target tab changes documents during a live run, the orchestrator adopts the supported destination and forces a fresh inspection. `page_request_user_input` asks one bounded, non-secret clarification. `page_pause_for_user` pauses for a safe manual step and requires explicit Resume. Before a state-changing action, a session-only checkpoint stores bounded planner metadata, budgets, receipt identity, and an uncertainty token. An explicit Resume starts a fresh owned run and forces inspection after a worker restart; actions never resume automatically. `page_record_note` stores bounded untrusted observations for long tasks and rejects secret, credential, and payment wording. `page_update_plan` lets the model create/update a checklist of at most twelve 200-character steps, with one active unresolved step and at most five revisions. Completion consumes new receipt/snapshot evidence; notes never advance steps. Short tasks need no plan, and planning never changes approval.
3. The on-demand page-action content script creates a viewport outline (24K characters, 200 controls) with document/session-stable IDs and a run-scoped `snapshotId`. Background frame collection inspects up to sixteen supported frames, merges labelled sections, and stores a bounded global-index-to-frame route map. Mutations translate the merged index to the owning frame's local snapshot and key; frame IDs never enter model results. Blocked origins and payment-like frames are omitted. Open shadow roots and modal-first sections are included. Safe field values are capped at 160 characters each/8K total, excluded from focused/submit metadata and never journaled/checkpointed. Source text stays untrusted and sensitive values stay masked. A bounded optional Markdown reading view removes scripts, media, hidden content, and value-bearing controls, sanitizes links, redacts common numeric/token patterns, and stays inside the complete payload cap.
4. Mutating actions require the current snapshot ID and are routed by `background.js` to the selected owned tab. Site policies are snapshotted at run start; current, requested and landed origins are checked before extraction. Blocked redirects return no snapshot and stop the run. Saving trust from a live approval updates only that origin in the waiting run; other settings changes apply to new runs. `background.js` waits for the new document and content-script bridge before returning a navigation result, and the orchestrator clears the old snapshot and forces `page_get_state` before another mutation. Unexpected active-tab navigation is recovered the same way; a stale mutation is skipped, while an action interrupted after delivery is marked unverified and is never blindly repeated. A disconnected bridge quarantines only its tab instead of terminating the run.
5. `pageActionPolicy.js` classifies targets and enforces default confirmation, trusted-mode limits, hard blocks, separate observation/navigation/mutation budgets (256/96/64), and DOM/semantic behavior. The default path has no selector or coordinate input. Input delivery uses standard browser DOM events after semantic target resolution and policy approval. Validated HTTP(S) links may transition the current tab without per-origin permission; `_blank` links use `page_open_link`, which navigates the current target by default and opens an owned tab only when `background: true` explicitly requests separate-page work. Sensitive detection is element-aware so ordinary labels such as “Video Cards” are not mistaken for payment fields. Every page-action tool accepts an optional bounded model-supplied `title` (≤80 chars, no control characters, no credential/payment wording) that the policy layer validates before it reaches the progress card or the journal; unsafe titles are omitted without rejecting the core action.
6. Mutations return bounded action receipts: `not_delivered`, `delivered_unverified`, or `delivered_verified`. Input, select, checkbox, and observed navigation postconditions can be verified. An unverified mutation is not retried automatically; the same unchanged mutation is blocked until the page is inspected again. Successful non-navigation mutations may include bounded selector-free `scopeDiff` metadata with indices, flags, counts, and snapshot IDs. Confirmable actions emit bounded `page_action_confirmation` events. The side panel offers Approve/Deny, **Approve similar actions this run** and **Always allow low-risk actions on this site**. Run approval covers permitted low/medium risk; persistent site trust follows non-navigation trusted-mode semantics. High risk always confirms and hard blocks remain. Site saving requires the authenticated, unexpired pending card and unchanged live origin; failed persistence never approves. Late decision transport failures keep expired/settled cards disabled. Decisions are matched to the live run and opaque confirmation ID, and timeout/stop/error paths clear pending UI and content-script state. While a confirmation card is open, the run's provider-clock deadline is paused: the wait is bounded and the deadline is extended by the elapsed approval time (capped at 10 minutes) so staring at a card does not burn budget, and an abandoned card cannot immortalize a run. A denied or timed-out decision records a bounded `lastDeniedAction` marker that drives a distinct declined outcome on the progress card and a “do not repeat it” nudge in the next planner prompt.
7. The page-actions system-prompt block is directive: when the user's request is achievable on the current page, the model must inspect, act, re-inspect after each mutation, and summarize what it did. A run may use only its owned tabs and must switch before acting on another tab; background tabs do not retarget the active target. Safe HTTP(S) navigation crosses origins without a per-site prompt, while writes and risky controls remain gated. Opened tabs return only after readiness is verified, and a failed tab is skipped with a bounded recovery result. `page_record_note` keeps short untrusted facts while old snapshots are compacted before provider calls. Unexpected active-tab changes discard the stale snapshot and require `page_get_state`, after which the model continues the same request. `_blank` links use `page_open_link` in the current target by default; `background: true` is reserved for explicit separate-page research. The model can pause only for a safe user-only step; Resume clears the content-script session and forces a fresh `page_get_state`. `page_find_text` offers bounded read-only search for exact page text before scrolling; `page_wait` handles bounded asynchronous text/URL conditions, and `page_batch` combines 2–4 read-only observations in one tool turn. The model never fakes an action. An empty snapshot result tells the model the page has nothing actionable and to ask the user to open the target page. Scope/diff runtime output stays selector-free and bounded; richer region and byte-size measurements remain test-only. When all planner sub-goals resolve, one final fresh `page_get_state` is required before the final summary.
8. The evaluation contract is credential-free and bounded. `tests/page-action-evaluation.json` defines 15 cases; unit execution covers API, Codex, Hermes, and restricted-page boundaries, while the browser evaluator runs the browser-safe cases against local fixtures. It records only result, receipt disposition, postcondition evidence, failure code, action count, prompt size, bounded policy metrics, and scope metrics. Live scope measurements use indexed semantic regions and snapshot diffs; they never accept model-supplied selectors or return raw values.
9. The orchestrator emits a bounded `page_task_progress` event (current action, target page, waiting state) alongside the journal, and the side panel renders a run-scoped page-task progress card from it. The current-step line prefers the bounded model-supplied `title` for the current action when present and falls back to the event-type label. On completion the card shows a deterministic outcome block (verified work, unresolved work, and a single best next recovery action) picked from actual run/planner/receipt state and routed onto the existing approval, clarification, manual-Resume, and Watch controls — never a parallel recovery UI. Terminal/progress/journal events carry bounded `actOutcome {status, reason}` derived by `ActOutcome.js`, not answer prose. Failed/skipped requirements, denied/timed-out decisions, manual blocks, budgets, loops and blocked sites cannot report task success. Evaluation traces retain terminal outcomes after step-cap exhaustion; benchmark summaries use ACT\_\* codes and independently grade end state. A denied action renders as a distinct declined outcome line instead of a generic warning, and the next planner prompt includes a one-line “change approach, do not repeat” nudge. A generic Retry on an Act run whose final mutation was unverified or in-flight is gated through the checkpoint/fresh-inspection path instead of blindly replaying the mutation.

### Web Search Grounding (optional)

1. The sidebar **Web** toggle sets a boolean `webSearchEnabled` in `chrome.storage.local`; the side panel asks the background worker only for configured/not-configured status and never reads `braveSearchApiKey`. The `searchProvider` preference (`'exa'` default | `'brave'`; a stored legacy `'duckduckgo'` migrates to `'exa'`) picks the active provider
2. `chat.js` reads the global preference at each `makeApiCall` / `makeApiCallWithMedia` entry and injects `webSearch: true` into `runConfig`
3. The background worker validates provider availability and injects a background-owned search executor (historical name `braveSearchExecutor`) that dispatches on `searchProvider`; the Exa leg runs keyless with an optional background-owned `exaSearchApiKey` that only lifts Exa free-tier rate limits, falls back to Parallel's keyless hosted Search MCP, and only the Brave path reads `braveSearchApiKey` from storage at search time
4. `RunOrchestrator._buildTools()` offers the reserved `web_search` tool alongside the normal toolset (or alone for `none` / a satisfied forced user tool) with automatic model selection while a search is available; grounding is permission, not a mandate
5. `executeTool()` claims the single search slot before network I/O. Parallel or hallucinated duplicate calls receive `WEB_SEARCH_ALREADY_USED` and cannot issue another search request
6. After an attempt, the grounding prompt switches to an already-completed phase and the immediate LLM continuation is text-only so the model consumes the existing result and produces the final answer
7. The extraction helper (`src/utils/webFetchGrounding.js`) deduplicates URLs, tries up to five ranked results to obtain three readable pages, caps each page at 8 KB and total at 24 KB UTF-8 bytes, enforces 15 s/page and 45 s overall timeouts, and propagates Stop immediately. Outcomes (`success | failed | empty | timeout | unsupported`) are returned per URL alongside `sources` and `extractedPages`.
8. Empty normalized results become the safe `WEB_SEARCH_NO_RESULTS` outcome. Nested tool outcomes are classified before rendering so failures are not shown as successful executions
9. `_finalizeTextResponse()` emits normalized `event.grounding.sources` when a search produced usable sources, and `chat.js` appends an escaped first-party `**Sources:**` section to rendered, copied, and persisted output
10. When grounding is off, no grounding field or Sources section is added; the normal LLM payload and UI behavior remain unchanged
11. Grounding requires an endpoint/model that supports function tools. Tool rejection is surfaced as an actionable error rather than retried indefinitely

## Build and Test

- `scripts/build.js` copies the production extension into `dist/` and the opt-in diagnostics extension into `dist-dev/`; production replaces the diagnostics module and content-script bridge with no-op variants
- `docs/DIAGNOSTICS.md` documents the development-only full-feature trace workflow
- `scripts/test-runner.js` checks module structure and key regression guards
- `npm run audit` runs the high-severity dependency gate used by CI and release builds
- `scripts/smoke-check.js` performs the cheapest end-to-end sanity check
- `npm run test:browser` runs every unpacked-extension spec in `tests/browser/` against a real headed Chromium-family browser and exercises the content-script bridge, selected-text actions, the executable page-action corpus, live scope/diff measurement, privileged-message rejection, indexed compose controls, interrupted connections, timeout, active-tab navigation recovery, and service-worker restart paths; set `PROMPT_PAUL_BROWSER=chrome|edge` to target an installed branded browser. Chrome 137+ and equivalent Edge builds use the browser-level CDP Extensions domain to load the unpacked directory. CI runs this suite under Xvfb.

## Notes

- The extension stays inside Chrome storage and the browser runtime
- Remote APIs are only called when the user sends a prompt or action
- Restricted pages are blocked early with a user-friendly message
