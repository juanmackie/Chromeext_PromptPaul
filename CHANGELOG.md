# Changelog

## [6.3.0] - 2026-09-12

- Replaced the keyless DuckDuckGo Instant Answer provider with a keyless Exa search client (`src/utils/keylessSearch.js`) backed by Exa's hosted MCP endpoint, falling back to Parallel's keyless hosted Search MCP.
- Added an optional background-owned Exa API key (`exaSearchApiKey`) that only raises Exa free-tier rate limits; it is excluded from backups and never exposed to the Options page as a value.
- Updated the Options page provider UI: the Web Search section now offers Exa (default, free, no key required) and Brave (keyed).
- `searchProvider` now accepts `exa` or `brave`; a stored legacy `duckduckgo` value migrates to `exa` automatically.

## [6.2.0] - 2026-05-11

- Added structured site adapters for Reddit threads, GitHub repository/issue/pull pages, and RSS/Atom feed documents. Adapters fill the existing `adapterMatched` extraction slot, score against the two-pass extractors with a fail-open fallthrough, and are mirrored from the pure helpers in `src/utils/siteExtractors.js`.
- Added zero-dependency document attachments: dropping `.txt`, `.md`, `.markdown`, `.csv`, or `.json` files into the composer reads them as bounded text (200k-character cap) and sends them as a new `document` prompt context type instead of base64 media.
- Current-page actions now support approved HTTP(S) link navigation. Same-tab links use `page_click`; indexed `_blank` links can open owned tabs with `page_open_link`, while unsafe schemes, downloads, and new origins remain gated.
- Act runs now recover from active-tab document changes by discarding stale snapshots, re-inspecting the current supported page, and continuing the request. Mutations interrupted during navigation remain unverified and are never blindly repeated.
- Added profile-local Codex subscription sign-in through the ChatGPT device-code flow, automatic `Codex` profile creation, background token refresh, authenticated model discovery, model-specific thinking levels, and the ChatGPT Codex Responses transport. OAuth credentials are excluded from backups; restored Codex profiles require sign-in again.

## [Unreleased]

- Split the semantic Act runtime into `content_script_page_actions.js` and inject it only when an Act run needs the page bridge; navigation recovery reinstalls it on the destination document. The extraction script remains separate, and page-action message shapes are unchanged. Chrome groups tabs created by one Act run when tab groups are available; this uses the existing `tabs` permission.
- Added default-off experimental precise input, limited to Chrome CDP `Input` mouse/key/text commands. Act still resolves semantic targets and applies its normal policy first; the debugger attaches only for approved input on a supported page and detaches on Stop or run teardown. Standard DOM delivery remains the fallback.
- Improved Act reliability on ARIA-heavy SPA pages: snapshots expose bounded menu/tab/switch state and digest-only hash/query route changes; a 16-action run-only memory ledger detects toggle loops, while counted plural requests track up to 12 distinct completed items. Added Gmail-like local browser and benchmark cases without retaining route fragments or action memory in checkpoints/journals.
- **Reliability/release hardening (P1 punchlist).** Act screenshots are disabled for release behind a static `ACT_SCREENSHOTS_ENABLED=false` gate with DOM-only fallback; Act vision payloads now preserve user text and uploaded images in their original order and replace only the ephemeral screen. Pinned-instruction backups validate pins as bounded string-ID arrays so pinning never blocks export. Each Options section tracks unsaved state independently. Pending page-user-input, manual-Resume, and Hermes-approval interactions replay correctly after a side-panel reconnect. Tool/skill/profile writes report errors instead of clearing drafts on storage failure. CI now gates release artifacts on browser tests of the production output.
- Options status messages are visible again: `loadingManager` toasts were rendered with Bootstrap's `.toast` class, so Bootstrap's `.toast:not(.show){display:none}` outranked the loading-state styles and hid every `showStatus()` message (skill save/clear, section saves, and other feedback on the Options page looked like a no-op). Toasts now use their own `ext-toast`/`ext-toast-container` classes, and the browser suite asserts they are actually visible.
- **Retry and Edit are now bound to the response they belong to.** Previously, acting on an older answer re-ran your newest prompt; each recovery row now uses its own originating request, so attachments and the original selection/context stay correct.
- The sidebar status now shows the connection actually used for the run. If the selected profile is incomplete and a usable fallback is used, the status tooltip says so explicitly instead of naming a profile that is not the real destination.
- Options now distinguish **Configured** from **Connected**: untested settings are labeled Configured, and Connected appears only after a real bounded connection check succeeds (with a visible result and a retry action). Invalid credentials or an offline gateway never show a verified connection.
- Hermes gateway API keys are handled entirely in the background through extension-page-gated status/set/remove operations scoped to the selected profile; the Options page no longer reads or writes the raw credential store, and keys remain masked and excluded from backups, logs, and events.
- Site suggestions keep a canonical hostname key that survives add/reload/another-add/remove round-trips for both URL and bare-hostname inputs.
- `page_find_text`, `page_wait`, and `page_batch` are now reserved names, so they cannot be redefined as custom tools.
- Custom GET tool endpoints preserve existing query parameters and fragments; tool arguments become separate, correctly encoded parameters.
- When rerouting an image request to a vision-capable profile, Prompt Paul now skips incomplete alternate connections, so a working current profile is never replaced by an unusable candidate.
- Switching connection profiles in Options now requires an explicit discard when any section or instruction/tool/skill editor draft is unsaved, and the browser unload guard covers those editor drafts too, so nothing is silently lost.
- The Options Improve Instruction action now runs through the background worker: API profiles use a bounded provider-aware request, while Codex and Hermes profiles receive an explicit capability message and never leave the original instruction overwritten.
- The Top Notch is now edge-pinnable: a new `notchPlacement` preference (top/right/bottom/left) docks the notch to any viewport edge, and `notchPosition` becomes an edge-relative offset (horizontal for top/bottom, vertical for left/right) draggable along that axis.
- The notch now rests as a slim pill that reveals its details panel on hover without pinning; a click pins it open so it stays on pointer-leave. Placement and pin behavior stay within the existing bounded viewport and brand color system.

- OpenRouter requests now include Prompt Paul's app-attribution headers so usage can appear in OpenRouter app analytics and rankings.
- Improved long-horizon Act continuity: required re-inspection keeps the verified mutation receipt available to the planner, receipts are bound to their owning sub-goal, successful owned-tab actions report bounded receipts, and planner prompts retain completed and blocked outcomes for more accurate continuation and final summaries.
- Act now stays enabled across runs until disabled or the browser session ends, and unusable Act tabs report an actionable startup error instead of silently falling back to plain chat.
- Act approval cards now pause the run's wall-clock budget while they wait (capped at 10 minutes), so a card left open no longer eats into the 30-minute run deadline.
- Act step titles: page-action tools accept an optional bounded model-supplied title (≤80 chars, control/credential wording rejected) shown on the progress card, falling back to the event-type label.
- Declining an Act action now renders a distinct declined outcome on the progress card and nudges the planner to change approach instead of repeating the denied action.
- **Packaging/release hardening (P3 punchlist).** The production package now filters a review-approved development-only file set (`AGENTS.md` and derived dev-off files) out of `src`/`libs`/`skills` directory copies while preserving every runtime skill file, vendored asset, and license notice, so development instructions no longer ship. The runtime package is also backed by a fail-closed provenance gate: every shipped third-party asset now maps to an exact source/version/hash record, any unlisted asset fails verification, and a root MIT `LICENSE` documents ownership. Build metadata now records the real git revision, working-tree clean/dirty status with the exact dirty paths, and a reproducible SHA-256 artifact root; a per-file `BUILD.sha256` manifest is written next to `build-metadata.json` so a downloaded candidate can be traced to its tested revision and verified byte-for-byte. Development and evaluation output remain excluded from the release package.

## [6.2.1] - 2026-08-31

### Prompt Paul UX Refinement

- Act now keeps `_blank` link navigation in the current target tab by default. Separate owned tabs remain available only when explicitly requested for multi-page research or retained references.

A coordinated, composer-led refinement of the whole extension, shipped together:

- **Foundation**: Extended the theme token system with semantic feedback colors (`--ext-success`, `--ext-warning`, `--ext-info`, `--ext-running` + deep/bright/foreground/muted variants) across light, dark, and system-preference themes; added a shared UI primitives layer (`ui-primitives.css` with buttons, chips, badges, trays, sections, and run indicators); standardized the run/feedback state vocabulary (`idle`, `running`, `streaming`, `stopping`, `complete`, `error`, `stopped`) in `src/utils/runState.js`, applied to the chat input area with `aria-busy` mirroring.
- **Chat-first composer**: The chat is now composer-led. A visible context tray (`#context-tray`) shows every attached context (selected text, media, page content) as removable chips near the input. A contextual quick-action row offers Analyze/Proofread/Explain for selections and Summary/TL;DR/Technical for loaded pages. Responses gain inline recovery: Stop while streaming, then Retry/Edit/Continue - Continue always builds on the previous response. Capabilities (sidebar, Web toggle, voice, skills) stay visible but visually secondary. Logic lives in `src/chat/ChatComposer.js`.
- **Options**: Chat-led setup with a Get Started banner, live connection status, and an Open Chat button. The credential-free default now points to OpenRouter's `openrouter/free` model, with links to create a key and browse free models. Explicit per-section saves (Connection, Privacy, Web Search) replace implicit persistence, with flash feedback on each. Capability sections (Instructions, Agent Skills, Tools, Web Search) are marked with badges. Credentials are masked: stored API keys are never written into input fields; masked placeholders indicate configured keys, and saving preserves the stored key unless replaced. An unsaved-changes banner plus a `beforeunload` guard covers the combined dirty state of every section.
- **Entry points**: All entry points funnel into the canonical chat. A toolbar action opens the side panel; extension pages and the Prompt Paul website (`externally_connectable`) can deep-link with `{ action: 'openChat', context }`, preserving selection, media, and instruction context; deep-link instructions run automatically against the attached context. Context-menu flows keep preserving page, selection, and media context. The optional Top Notch adds a top-edge browser-viewport-only quick-action surface with Shadow DOM isolation, compact primary actions, saved pinned prompts, one-turn dictation, explicit Act task input with target-page glow, and theme-aware AI energy accents.
- **Compatibility**: Canonical storage keys, profiles, and capabilities remain supported. API, Brave, Codex, and Hermes credentials are excluded from backups; restore requires connection credentials to be configured again. Legacy sync migrations, retired message handlers, and non-canonical skill records were intentionally removed; imports now require the documented canonical formats.

### New Features

- **Hermes Act client-tool bridge**: Hermes profiles can use bounded browser actions when the gateway advertises `run_client_tools` and the `/v1/runs/{run_id}/tool-result` endpoint. Unsupported gateways remain safe and report the required upgrade instead of silently ignoring Act.
- **Long-running Act resilience**: one default-off Act permission now owns up to eight tabs for a run. Opened and switched tabs wait for a ready content-script bridge, safe HTTP(S) navigation does not prompt once per origin, disconnected tabs are quarantined so work can continue elsewhere, and observation/navigation/mutation budgets plus bounded task notes and history compaction keep sustained tasks under control.
- **Verified page-action receipts**: State-changing actions now report `not_delivered`, `delivered_unverified`, or `delivered_verified` with bounded action-specific evidence. Unverified mutations cannot be repeated until the page is inspected again.
- **Local manual intervention**: `page_pause_for_user` lets the user complete a safe step in the visible tab. Resume is explicit, invalidates the old snapshot, and requires fresh inspection. Passwords, OTPs, recovery codes, and payment data remain outside chat and run events.
- **Executable browser-action evaluation**: Expanded the credential-free corpus to 15 cases with provider-boundary coverage, real browser fixtures, bounded result metrics, receipt evidence, failure codes, action counts, and prompt-size measurements.
- **Progressive scope and diff measurement**: Added bounded selector-free scope/diff evidence to successful non-navigation mutations. Runtime output contains only indices, flags, counts, and snapshot IDs; richer region and byte-size measurements remain test-only.
- **Accessible page targeting**: Vendored `dom-accessibility-api` 0.7.1 and use its accessible-name algorithm in page-action snapshots while preserving the existing role, masking, and fingerprint safeguards.
- **Restart-safe Act recovery**: State-changing page and owned-tab actions now persist bounded session checkpoints before dispatch. An interrupted checkpoint offers explicit **Resume Act** after a worker restart, forces a fresh inspection, and never replays actions automatically.
- **Bounded recovery and evaluation**: Bridge and navigation polling use capped backoff with jitter. The credential-free corpus now covers hidden, alt-text, and ARIA prompt-injection variants, manual-intervention boundaries, fault injection, policy-safe completion, risk ratio, and pass-k consistency metrics.

- **Web Search Grounding**: A sidebar toggle (Web) lets users optionally ground LLM answers with Brave Search. When enabled, the model may call the reserved `web_search` function tool when current, verifiable, or time-sensitive information would materially improve the answer - the toggle is a permission, not a mandate, so the model can answer directly without searching. Queries Brave's LLM Context API and returns source-cited results that the UI renders as a first-party Sources section. Requires a Brave Search API key; pricing and quotas are subject to Brave's current plans. Grounding is disabled by default.
- **Current-page actions**: A separate default-off Act toggle adapts Page-Agent's semantic DOM snapshot and indexed-control ideas for the current tab. When Act is enabled, the first tool turn is forced through `page_get_state` so the agent inspects the current page before responding; it can then use guarded `page_click`, `page_input`, `page_select`, and `page_scroll` tools. State-changing actions use accessible approval cards by default; an optional trusted mode skips only allowed low/medium-risk confirmations. No arbitrary JavaScript, selectors, passwords, payment/security fields, navigation, or cross-tab automation is exposed.
- **Page actions take action**: Act-enabled runs now direct the model to perform page-achievable requests on the current tab (inspect, act, re-inspect, then summarize what it did) instead of describing steps. Requests outside page scope - like cloning a repo to a local machine (terminal/OS), needing a different page, JavaScript, or cross-tab work - get an honest one-sentence limitation plus the closest achievable offer, never a fake action. Empty pages prompt the model to ask the user to open the target page.

### Security and Reliability

- Added a development-only, opt-in diagnostics build. `npm run build:dev` creates `dist-dev/` with structured run, provider, runtime-message, content-script, and Act traces; `npm run build:prod` replaces the tracer with no-op variants.
- Removed the retired starter credential and release-time demo-key injection path; source and release builds now require user-provided connection credentials.
- Added shared HTTP(S)-only validation for profiles and custom tools, validated backup restore data, and removed sensitive custom-tool endpoint/error logging.
- Updated transitive development dependencies to versions with no current high-severity audit findings.

### Bug Fixes

- Fixed the sidebar Act toggle losing its active shading as soon as the one-run permission was consumed; it now stays visibly active and unavailable until the Act run reaches a terminal state.
- Fixed long-running Act runs surfacing Chrome's asynchronous message-channel closure. `executeRun` now acknowledges acceptance immediately, keeps the owner token until terminal cleanup, and relies on ordered run events plus the session journal for completion; transient disconnects are shown with a recovery message.
- Fixed Options profile saves losing an existing masked API key after model or endpoint edits, and fixed new profiles falling back to the Default profile's credential. Saves now preserve the stored profile credential and new profiles clone from the profile that was active before creation.
- Fixed chat configuration resolution rejecting an incomplete selected profile even when a valid Default profile existed; chat now matches background fallback behavior. Open Chat now opens the canonical side panel directly from the Options page.
- Fixed page-action runs aborting with "Maximum tool call retries exceeded (3)" after only three tool turns: the cap now counts only consecutive failing tool calls (a successful tool result resets it), so multi-step flows such as inspect → act → re-inspect → act can complete up to the page-action budget. Mutation results now also carry a refreshed-snapshot notice so the model re-reads the latest snapshotId and index numbers instead of reusing stale ones.
- Fixed current-page actions failing on dynamic SPA pages when unrelated class or DOM mutations invalidated an otherwise unchanged target; actions now validate the indexed control's connection and semantic fingerprint instead of a page-wide mutation counter.
- Fixed reasoning-only completions that could consume the response budget without producing a final answer; provider completion metadata, reserved output capacity, and a bounded text-only recovery now prevent misleading token-budget warnings
- Fixed "A response is already in progress" error that prevented follow-up messages after initial response completion (run state was not cleared on success)
- Fixed sidebar quick-action buttons becoming permanently disabled after initial selected-text action

### Improvements

- **AI visual language**: Added restrained indigo/cyan/violet energy gradients, soft ambient washes, and intentional active-run signals across the notch, chat composer, response surfaces, loading states, and Options header while preserving the existing typography, geometry, and hard-shadow identity. Reduced-motion users keep static surfaces.
- **Selected text handling**: Selected text now displays as a visible, dismissible chip in the chat input area instead of hidden state
  - Chip shows a 2-line preview of selected text and can be removed independently of clearing the chat
  - Sidebar actions (Explain, Proofread, Analyze, custom prompts) now work as conversation follow-ups when no text is selected
  - Buttons enable when there's a selection OR existing conversation history
- **Copy button feedback**: Response copy buttons (raw/formatted) now flash green "Copied!" or red "Copy failed" on interaction with 1.5s auto-revert
- **Copy button labels**: Updated from "Copy"/"Formatted" to clearer "Copy As Raw text" / "Copy As Formatted Text" with white-space handling
- Removed first-run analytics consent banner (consent toggle still available in Options)
- Refactored `chat.js` to move page action cards, preset analysis, and site suggestion rendering into `src/chat/ChatPageActions.js`
- Added page-context helpers for token budgeting, read strategy selection, permission guards, and runtime error normalization
- Updated docs to match the current module layout and page-aware quick-action flow
- Expanded content extraction metadata for platform-aware quick actions and YouTube moment prompts

### New

- `src/utils/braveSearch.js` - bounded Brave LLM Context API client and normalized source contract
- `src/chat/ChatGrounding.js` - toggle state, Brave key status bridge, and Sources formatting helpers
- `src/chat/ChatPageAutomation.js` - Act toggle state and sanitized page-action approval cards
- `src/utils/pageDom.js` / `src/utils/pageActionPolicy.js` - bounded page snapshots, masking, risk policy, and trusted-mode limits

## [6.0.0] - 2026-04-25

### Major Changes

- **Modular refactor**: Extracted 7 modules from chat.js and related helpers for page-aware analysis
  - `ChatUI.js` - UI rendering and DOM manipulation
  - `ChatAPI.js` - API orchestration and configuration
  - `ChatSkills.js` - Skill detection and command parsing
  - `ChatVoice.js` - Voice input and speech recognition
  - `ChatMedia.js` - Media data processing and analysis
  - `ChatStream.js` - Streaming state management
  - `ChatPageActions.js` - Preset analysis and page action cards

- **Build system**: Added comprehensive build infrastructure
  - Production and development builds
  - Manifest validation
  - Build metadata generation

- **Test framework**: Created automated test suite
  - Unit tests for module structure
  - Integration tests for file dependencies
  - Coverage reporting

- **CI/CD pipeline**: Enhanced GitHub Actions workflow
  - Validate job (lint, format, tests)
  - Build job (production build with artifact upload)
  - Required validation job (lint, formatting, structural tests, behavior tests, and smoke checks)
  - Dependency audit and production build artifact jobs

- **Code quality tools**: Added ESLint and Prettier configuration

### New Features

- StreamStateManager for centralized streaming state
- Enhanced media analysis prompt generation
- Improved error handling in chat modules

### Bug Fixes

- Fixed duplicate variable declarations in chat.js
- Fixed invalid object literal method calls in console.log
- Fixed unreachable code in error handler
- Fixed missing closing brace in DOMContentLoaded handler

### Documentation

- Created ARCHITECTURE.md
- Created DEVELOPMENT.md
- Created CHANGELOG.md
- Created CONTRIBUTING.md
- Updated README.md with new build/test documentation
- Updated README.md, ARCHITECTURE.md, and DEVELOPMENT.md for action cards, context budgeting, and restricted-page handling

## [5.0.0] - 2026-03-22

### Major Changes

- **Agent Skills system**: OpenClaw-compatible skill system
  - SKILL.md frontmatter specification
  - Slash command support (`/skill`, `/skills`)
  - Natural language intent detection
  - Built-in skills: humanizer, weather-guide

- **Orchestrator**: RunOrchestrator for streaming API calls
  - Event-based streaming response handling
  - Tool call management
  - Conversation history tracking

- **Voice input**: Web Speech API integration
  - Microphone permission management
  - Toggle button with state feedback

### New Features

- Custom instruction presets with pinning
- Media analysis (images, videos, audio)
- Quick action sidebar
- Dark/light theme toggle
- Profile management for multiple API endpoints

### Improvements

- Enhanced error handling and user feedback
- Loading states and toast notifications
- Better accessibility support

## [4.0.0] - 2025-12-15

### Major Changes

- **Manifest V3 migration**: Upgraded from MV2 to MV3
  - Service worker replacement for background page
  - Side panel API integration
  - Updated permission model

### New Features

- Side panel chat interface
- Context menu integration for text, images, video, audio
- Multi-modal support
- Privacy-first analytics (Umami)

## [3.0.0] - 2025-09-01

### Major Changes

- **Options page redesign**: Complete UI overhaul
  - Connection configuration
  - Custom instruction management
  - Profile management
  - Analytics controls

### New Features

- Custom instruction support
- Multiple API profile support
- System prompt customization
- Export/import configuration

## [2.0.0] - 2025-06-01

### Major Changes

- **OpenAI API compatibility**: Support for any OpenAI-compatible endpoint
- **Streaming responses**: Real-time response display

### New Features

- Mistral AI support
- Model selection
- Temperature and max tokens configuration

## [1.0.0] - 2025-03-01

### Initial Release

- Basic text processing via context menu
- Simple API integration
- Chrome extension foundation

---

_Prompt Paul Changelog_
