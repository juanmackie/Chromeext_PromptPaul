# Brave Web Grounding Toggle Plan

## Context

Prompt Paul should let users opt into web-grounded answers from the side-panel sidebar for ordinary prompts, selected-text/page actions, custom instructions, skills, and media prompts.

Research conclusions:

- These side-panel paths converge on `makeApiCall()` / `makeApiCallWithMedia()` in `chat.js`, then run through `src/orchestrator/RunOrchestrator.js`.
- Upstream Pi does **not** implement provider-native server tools; maintainers declined that design in issues [#709](https://github.com/earendil-works/pi/issues/709) and [#1740](https://github.com/earendil-works/pi/issues/1740). The practical Pi setup is the external [`badlogic/pi-skills` Brave Search skill](https://github.com/badlogic/pi-skills/tree/main/brave-search), which calls Brave with a user-supplied `BRAVE_API_KEY` and returns results to the model.
- The user confirmed Prompt Paul should use the same Brave-key approach. Brave's monthly credits can cover small usage, but “free” depends on Brave's current plan, signup, quota, and pricing; the extension must not promise unlimited or permanently free search.
- Brave now recommends its LLM Context endpoint for agent grounding. It returns extracted, source-linked snippets in one search and avoids Prompt Paul scraping arbitrary result pages.

## Approach

Implement a provider-neutral, reserved `web_search` function tool backed by Brave's LLM Context API. Keep it disabled by default and available only for runs started while a global sidebar toggle is on.

### Settings and sidebar behavior

- Add a **Web Search** section in Options with a separate password field for `braveSearchApiKey`, setup/pricing links, local-storage/privacy copy, and save/remove controls. Do not place this credential inside an LLM profile.
- Store the global preference as `webSearchEnabled` in `chrome.storage.local`, defaulting to `false`.
- Add a sidebar button labeled `Web` with `aria-pressed`, an active style, and an explanatory title. Enabling it without a configured Brave key should keep it off, show an actionable toast, and open Options.
- Resolve configured/not-configured status through the background worker; `chat.js` passes only `{ enabled: true|false }` in `runConfig`, never the key.
- Changes made during an active response apply to the next run.

### Brave request and result contract

- Add a browser-safe utility that GETs the fixed endpoint `https://api.search.brave.com/res/v1/llm/context` with `X-Subscription-Token`; never accept a caller-supplied search URL.
- Accept one model-generated query (1–400 characters, at most 50 words) and an optional bounded freshness enum (`pd`, `pw`, `pm`, `py`). Use fixed conservative grounding limits (about 5 URLs / 2,048 context tokens / bounded snippets) so one run cannot flood the model context or consume multiple search credits.
- Allow at most one Brave search attempt per run. Pass the run abort signal through a 30-second search timeout and map missing/invalid keys, 401/403, 429/quota, timeout, malformed responses, and empty results to user-safe errors without logging credentials or full sensitive payloads.
- Normalize successful data to `{ query, retrievedAt, sources: [{ id, title, url, snippets }] }`; accept only HTTP(S) source URLs and cap every field plus the total serialized result size.

### Orchestrator and tool-choice behavior

- Inject background-owned credential/status and search executor callbacks into `RunOrchestrator`; validate configuration before the first LLM request and read the key only inside the service worker at execution time. The LLM profile key remains separate from the Brave key.
- Add `web_search` to `_buildTools()` only when the run opted in and has not attempted search. Authorize it again in `executeTool()` against a live enabled run so legacy/direct tool messages cannot invoke Brave.
- Reserve `web_search` alongside skill-loader names in chat filtering, Options save/import validation, and orchestrator registration so user-defined tools cannot shadow it.
- Treat the sidebar grounding choice separately from an instruction's user-tool choice. Web enabled means permission to search, not a mandate:
  - with `auto`, offer `web_search` alongside the normal toolset with automatic model selection so the model may search or answer directly on the first turn;
  - with `none`, suppress user tools but still offer `web_search` with automatic model selection;
  - with a specifically forced user tool, execute that tool first exactly once, mark the forced choice satisfied, then offer only `web_search` with automatic model selection on the continuation;
  - after the one search attempt (success or failure), omit `web_search` and use normal/auto generation for the final answer;
  - the model is never forced to call `web_search`; it may answer directly with zero Brave requests.
- For Anthropic, omit extended thinking only on a turn where a tool must be forced (Anthropic disallows forced tools with thinking), then restore thinking for the final answer. Preserve the existing OpenAI-compatible and Anthropic message/tool continuation formats.
- State clearly in the UI/docs that grounding requires the selected LLM model/endpoint to support function calling; surface an actionable error when the endpoint rejects tools.

### Grounded output and safety

- Record normalized sources on the run and include them in the terminal `complete` event. Give source blocks stable IDs and instruct the model to cite those IDs while treating snippets as untrusted reference data, never as instructions.
- Add a small chat grounding module to own preference/status helpers and deterministic source formatting, keeping `chat.js` under its enforced line limit.
- Append a validated **Sources** section from event metadata to the rendered/copyable/persisted assistant answer in both the owned-run and stranded-terminal completion paths. Source titles and URLs are normalized and escaped before Markdown rendering, so source metadata cannot inject additional links.
- Disclose that enabled runs send model-generated search queries—which may derive from selected/page content—to Brave. Keep the key out of `runConfig`, LLM messages, tool results, analytics, logs, and orchestrator events.
- Full Backup currently exports all local data, including existing LLM credentials; retain that behavior for the Brave key but update the warning to explicitly say backup files contain API keys and must be protected.

## Files to modify

- `chat.html` — accessible Web toggle in the sidebar.
- `chat.css` — active/disabled/focus states for the toggle.
- `chat.js` — minimal grounding-controller wiring, run option propagation at both converged call sites, and source-aware terminal handling.
- `src/chat/ChatGrounding.js` (new) — storage/status coordination and safe source formatting.
- `src/chat/ChatAPI.js` — background status bridge and `web_search` reservation in configured tool filtering.
- `src/chat/ChatUI.js` — render structured grounding sources with safe links.
- `options.html` — Brave key setup UI, disclosure, links, and credential-backup warning.
- `options.js` — load/save/remove the Brave credential and reject reserved tool names on save/import.
- `background.js` — configured-status message, pre-run validation, and background-only Brave executor injection.
- `src/utils/braveSearch.js` (new) — fixed-endpoint request, bounds, response normalization, URL validation, aborts, and safe errors.
- `src/orchestrator/RunOrchestrator.js` — per-run search state, model-directed tool-choice sequencing, authorization, source collection, and complete-event metadata.
- `tests/braveSearch.test.js` and `tests/chatGrounding.test.js` (new), plus `tests/runOrchestrator.test.js` — focused behavior coverage.
- `scripts/test-runner.js` — module/import/HTML regression guards. Reserved tool names are enforced in `src/chat/ChatAPI.js`, `options.js`, and `src/orchestrator/RunOrchestrator.js`.
- `README.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`, and applicable root/`src`/child `AGENTS.md` files — setup, privacy, pricing caveat, architecture, ownership, and durable contracts.

`manifest.json` should not need a permission change because existing HTTPS host permissions already cover the fixed Brave endpoint.

## Reuse

- `composeUserPrompt` in `src/prompts.js` and the two guarded run entry points in `chat.js`.
- Existing Chrome local-storage and theme/sidebar toggle patterns.
- `RunOrchestrator._buildTools()`, `executeTool()`, `_finalizeToolCall()`, and provider-specific continuation handling.
- `renderMarkdown` / DOM sanitization and `ChatUI`'s existing message post-processing.
- Existing background fetch/abort patterns, while keeping Brave's credential handling dedicated rather than treating it as a user-defined endpoint.
- Pi's model-directed client-side search-tool architecture; do not copy its rejected provider-native proposal or Node-only helper.

## Steps

- [x] Confirm upstream Pi's actual web-search approach and select Brave with a user-supplied key.
- [x] Add the Brave credential settings, global default-off preference, sidebar toggle, background status check, disclosures, and backup warning.
- [x] Implement and unit-test the bounded Brave LLM Context client and normalized source contract.
- [x] Thread the non-secret run option through both chat entry points and add run-level configuration validation.
- [x] Register/authorize the reserved search tool, enforce one search per run, and implement deterministic tool-choice sequencing for OpenAI-compatible and Anthropic paths.
- [x] Carry validated source metadata through completion, render/persist a first-party Sources section, and preserve ordinary responses exactly when grounding is off.
- [x] Reserve the tool name across runtime, save, and import paths; add error, abort, collision, privacy, and unsupported-model handling.
- [x] Update tests, documentation, changelog, and the DOX hierarchy.

## Verification

Automated:

- Add utility tests for the exact Brave endpoint/header/body, query/result caps, HTTP(S)-only URLs, malformed/empty data, 401/403, 429, timeout, and abort behavior.
- Add grounding helper tests for default-off persistence/state, missing-key behavior, safe/deduplicated Sources formatting, and unsafe URL rejection.
- Extend orchestrator tests for disabled payload identity, enabled authorization, one-attempt limit, `none`/auto/specific-tool optional sequencing, reserved-name collisions, both provider dialects, search failure continuation, direct-answer (zero requests), exactly-one-request behavior, source metadata, and abort cleanup.
- Run `npm run test:behavior` (Vitest is not included by `validate`), `npm run validate`, and `npm run build:prod`. Do not use a live Brave endpoint in tests; inject a fake search executor.

Manual in unpacked Chrome/Edge:

- Verify missing-key enablement opens Options; save/remove a key; close/reopen the side panel and confirm persisted state.
- With grounding off, verify chat, selected-text/page actions, custom instructions (including `none` and a forced custom tool), skills, and media behave as before.
- With grounding on, verify the same flows make no more than one Brave request, show a tool trace, return a current grounded answer, and append working source links.
- Test an invalid key, exhausted quota, no results, stopping during search, service-worker suspension/restart, and a model that rejects function tools; ensure the UI unlocks with no credential leakage.
- Export a full backup and confirm the revised warning accurately explains that credentials are included.
