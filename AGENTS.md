# Chromeext_PromptPaul agent contract

## Operating Standard

- Apply `C:\Users\juanm\Documents\GitHub\Vibe Coding Rules 10.md` (V10) as the repository operating standard; read it in full before substantive work.
- This file is the nearest-owning contract. It refines the parent policy with repository-specific facts and cannot weaken a mandatory parent rule; conflicts resolve to the parent.

## Scope and Ownership

- Root owns project-wide contracts, `manifest.json`, package metadata, root extension entry points (`background.js`, `chat.js`, `options.js`), content scripts, HTML/CSS entries, theme/loading helpers, `ui-primitives.css`, README/changelog files, and the durable `REVIEW_PLAN.md` review record. Transient `PLAN.md`/`plans/` drafts stay untracked.
- Child docs own the durable subtrees listed under Child contracts below. Read the applicable child contract before editing inside its scope.
- Shared logic belongs in `src/chat/`, `src/utils/`, or `src/orchestrator/`, not in growing root entry points.
- `dist/`, `dist-dev/`, and `dist-eval/` are generated build output, not source of truth; never edit them directly. `dist-dev/` and `dist-eval/` are local-only development output and must never be packaged or published.
- Do not edit vendored libraries or binary assets unless the task is specifically about them.

## Constraints

- Manifest V3 extension; `background.js` is an ES module service worker; extension-page CSP is `script-src 'self'`. Use 2-space indentation, single quotes, and `@fileoverview`/`@module` JSDoc in new modules under `src/`.
- API keys, profiles, instructions, tools, skills, and settings live in Chrome storage. Codex subscription and Hermes gateway credentials are background-owned and keyed by profile; they never appear in profile records, run configs, events, logs, backups, or chat/UI messages, and are never exposed to the Options page.
- The storage schema is stable: canonical keys (profiles, `lastSelectedProfileId`, instructions, customSkills, promptPaulTools, analytics keys, voice-input keys, `braveSearchApiKey`, `exaSearchApiKey`, web-search/page-action/notch/theme keys, `hermesApiKeys`/`hermesSessions`/`hermesSessionKeys`, `promptPaulActCheckpointsV1`) are pinned by regression guards. `pageActionsEnabled` is session-scoped and excluded from backups; backups export only supported persistent settings and restore profiles without credentials.
- Remote LLM calls happen only when the user sends a prompt or invokes an action. User-supplied media URLs are restricted to bounded public HTTP(S) fetches with private-host, media-type, redirect, timeout, and response-size guards. Browser-internal pages, extension pages, and Chrome Web Store pages are blocked or reported before content extraction. Broad host permissions are intentional for extraction and context-menu workflows.
- Runs: `makeApiCall`/`makeApiCallWithMedia` require `beginResponseRun()` before any side effect and `endResponseRun()` in `finally`. The `executeRun` bridge acknowledges immediately; terminal status arrives via ordered `orchestratorEvent` messages and the session journal, with an opaque owner token kept by the owning chat (reconnect may adopt it, never persisting it). Non-Hermes runs use bounded API-call/wall-clock budgets, one toolless wrap-up, bounded transient retries, context compaction, reasoning-aware timeouts, and repetitive-output protection. The wall-clock deadline is paused while an Act confirmation card waits for a user decision: the elapsed wait is bounded and the deadline is extended by up to 10 minutes on resolution so an open card does not burn budget.
- Privileged background messages require an extension-page sender; content-script requests are bound to the sender tab; provider credentials resolve from the saved profile in the background.
- Providers are `api`, `codex`, or `hermes`. Hermes profiles use gateway sessions, bounded `conversation_history`, server-side tools, and approval events; runs, resets, and session-key operations serialize per profile; Act requires the gateway to advertise `run_client_tools` plus the tool-result endpoint (otherwise Act runs fail with an actionable message); Stop holds `stopping` until the gateway reports terminal; idle action is **New chat** (ends gateway session, clears pointer, keeps local conversation identity). Codex: device-code login creates/selects the `Codex` profile; discovery includes the required extension client version; restored Codex profiles require sign-in again. Codex auth stays in `src/utils/codexAuth.js`, model discovery in `src/utils/modelDiscovery.js`, wire conversion in `src/orchestrator/CodexTransport.js`.
- All entry points (context menus, deep links, toolbar action, website deep links via `externally_connectable` for promptpaul.juanmackie.com) funnel through the side panel via `sendPanelMessage`/`openChatWithContext`. The Options page calls `chrome.sidePanel.open()` from its button gesture. `chat.js` resolves run source tabs via `getRunSourceTabId()`; sticky selection release is provenance-aware (`selectionOwnsTabId`); pending panel actions are consumed locally, not re-sent.
- Chat is composer-led: all send/action flows route through `#input-area`, with composer UI logic in `src/chat/ChatComposer.js` (context tray, quick-action row capped at four visible actions, inline Stop/Retry/Edit/Continue). Suggestions consolidate into one row; starters reuse the canonical current-page load path.
- Context-bearing prompts use structured prompt request objects and `composeUserPrompt` — never raw concatenation of selection, page content, media, or metadata. Untrusted context stays bounded and marked as source material.
- Page actions (Act) are default-off, DOM/semantic-only, session-scoped. Every Act run forces an initial `page_get_state`; password/OTP/payment/credential/security/destructive controls are masked, confirmation-gated, or blocked; trusted mode never enables JavaScript and CDP/`chrome.debugger`/arbitrary JS stay outside the contract. Budgets: 256 observation / 96 navigation / 64 mutation actions; planner 12 sub-goals, 5 replans, auto-approval only for low-risk non-navigation; task memory 72 notes, 360K history chars; up to 12 run-created tabs with one work tab per site; mutations return `not_delivered`/`delivered_unverified`/`delivered_verified` receipts, and unverified mutations are not retried blind. Page-action tools accept an optional bounded model-supplied step `title` (≤80 chars, no control characters or credential/payment wording) validated by the policy layer for progress-card display only; a denied or timed-out decision records a bounded last-denied marker that drives a distinct declined card outcome and a “do not repeat it” planner nudge. Session checkpoints never store DOM, page text, notes, or credentials; resume always clears stale state and forces fresh inspection.
- The Top Notch is Shadow-DOM isolated, edge-pinnable (`notchPlacement`/`notchPosition`), theme-following, holds no credentials, and dictation uses a short-lived background-owned lease so `sidePanel.open()` stays inside a user gesture. Notch-routed IDs and text are validated by the background worker.
- Dropped `.txt`/`.md`/`.markdown`/`.csv`/`.json` files attach as bounded text via `ChatMedia.prepareDroppedFile()` (memory only, one at a time) and never enter the base64/vision pipeline; other drops keep the media flow. PDF extraction parses bytes through the bundled pdf.js path, not Chrome's viewer DOM. Site extraction adapters live in `src/utils/siteExtractors.js` and must stay aligned with the classic content script mirror.
- Run/feedback states use the `data-run-state` vocabulary (`idle`, `running`, `streaming`, `stopping`, `complete`, `error`, `stopped`) driven by `src/utils/runState.js`; `ui-primitives.css` depends on `theme.css` tokens and loads after it on every extension page.
- Web search grounding: Exa (keyless, hosted MCP, with an optional background-owned `exaSearchApiKey` that only lifts Exa free-tier rate limits; never exposed to the Options page as a value and excluded from backups) falling back to Parallel's keyless hosted Search MCP, or Brave (keyed, key background-owned, never reused from LLM profiles), selected by `searchProvider` (`exa` default, `brave` keyed; a stored legacy `duckduckgo` migrates to `exa`); `web_search` is a reserved tool name enforced in `src/chat/ChatAPI.js`, `src/orchestrator/RunOrchestrator.js`, and `options.js`; search is model-directed permission, not a mandate; one search slot per run; empty results are `WEB_SEARCH_NO_RESULTS`, not a grounded response.
- Skills follow the Agent Skills spec (`SKILL.md` with YAML frontmatter; `name`/`description` required; `command-dispatch: tool` for deterministic execution) with built-ins registered in `skills/skills.json` (`humanizer`, `weather-guide`). Skills are instructions by default, not executable tools, unless deterministic tool dispatch is explicitly implemented. `docs/SKILL_EXAMPLES.md` holds user examples.
- Analytics stay opt-in with safe-label handling and a rotating pseudonymous instance ID. Fresh checkouts seed the Default profile with OpenRouter's OpenAI-compatible endpoint and `openrouter/free` model but no credential; existing profiles are preserved.

## Verification

- `npm run test` — module structure, manifest references, skill files, regression guards (`scripts/test-runner.js`).
- `npm run test:behavior` — vitest behavior suite (`vitest.config.js`).
- `npm run test:browser` — Playwright real-browser coverage (`playwright.config.cjs`, `tests/browser/`).
- `npm run smoke` — manifest file references and vendored dependency conflicts (`scripts/smoke-check.js`).
- `npm run validate` — lint, format check, tests, behavior suite, smoke, vendored-license verification (see `package.json` scripts; all component scripts exist there).
- `npm run build` / `build:dev` / `build:eval` / `build:prod` — generate `dist/` variants (`scripts/build.js`).
- For UI or browser-runtime changes, also reload the unpacked extension in Chrome or Edge and exercise the affected flow by hand; a passing build is not evidence of visual or interaction correctness.

## Documentation index

- `docs/PRODUCTION_READINESS.md` is the concise repository checklist; keep it aligned with these contracts.
- `docs/SKILL_EXAMPLES.md` documents end-user skill usage; `REVIEW_PLAN.md` is the durable review record.

## Child contracts

- `docs/AGENTS.md` — documentation, user guides, architecture notes, development workflow docs.
- `src/AGENTS.md` — shared source modules with deeper chat, utility, and orchestration contracts.
- `scripts/AGENTS.md` — build, smoke, and test scripts.
- `skills/AGENTS.md` — built-in skill registry and `SKILL.md` sources.
- `libs/AGENTS.md` — vendored browser libraries and third-party assets.
- `icons/AGENTS.md` — extension icons and copy/action image assets.
- `tests/AGENTS.md` — automated test suites, including real-browser integration coverage.
- Each child contract refines this file under V10 and cannot weaken the parent policy. `dist-dev/` and `dist-eval/` are generated build copies with no contracts; do not edit them.
