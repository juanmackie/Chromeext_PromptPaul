# Utils DOX

## Purpose

The `src/utils/` subtree contains shared helpers for validation, context budgeting, page permissions, action cards, profile routing, model discovery, skill parsing, tool choice payloads, suggestions, read strategy, run/feedback state, and runtime errors.

## Ownership

- `contextBudget.js` owns token estimation and DOM context trimming.
- `hermesContext.js` owns bounded Hermes current-turn/history preparation, active page-context retention, and historical media redaction.
- `readStrategy.js` owns extraction strategy selection from page signals.
- `permissionGuards.js` owns restricted URL and host permission checks.
- `actionCards.js` owns inferred site-specific prompt cards.
- `suggestionStorage.js` owns custom site suggestion persistence and normalization.
- `skillParser.js` owns canonical Agent Skills frontmatter parsing, metadata validation, and Markdown generation.
- `toolChoiceBuilder.js` owns tool choice normalization and provider payload formatting.
- `profileRouting.js` owns profile usability and vision-model selection helpers.
- `codexAuth.js` owns background-only device-code sign-in, refresh, profile-local credential storage, and secret-free status responses. OAuth records are excluded from backup keys.
- `modelDiscovery.js` owns background-only API and Codex `/models` requests and normalizes safe model/reasoning metadata for the Options page. Codex requests include the client-version query/header required by the subscription route. It never returns credentials.
- `runtimeErrors.js` owns runtime error classification and friendly messages.
- `validation.js` owns shared URL, tool, profile, and backup normalization/validation; request endpoints are HTTP(S)-only and custom-tool methods/names are allowlisted. Backup normalization strips provider and search credentials before export or restore.
- `validation.js` owns shared URL, tool, profile, and backup normalization/validation; request endpoints are HTTP(S)-only and custom-tool methods/names are allowlisted. The session-scoped `pageActionsEnabled` Act permission is not part of local backup/export data.
- `debounce.js` owns debounce and throttle helpers.
- `braveSearch.js` owns the bounded Brave LLM Context API client, HTTP(S)-only source normalization, byte budgeting, caller-abort handling, and safe `NO_RESULTS` errors when no usable sources remain.
- `runState.js` owns the standardized run/feedback state vocabulary (`idle`, `running`, `streaming`, `stopping`, `complete`, `error`, `stopped`) and the `data-run-state`/`aria-busy` DOM contract shared by chat and options.
- `keyedOperationLock.js` owns small per-key runtime locks used to serialize Hermes session-key creation and reject overlapping session resets.
- `runtimeAuthorization.js` owns extension-sender, content-script-tab, and opaque run-owner checks for privileged background messages.
- `streamSafety.js` owns bounded SSE buffers and provider error-body reads.
- `pageDom.js` owns bounded semantic snapshot normalization, element masking, safe display formatting, and snapshot identity checks for current-page actions.
- `pageActionPolicy.js` owns page-action argument validation, risk classification, hard blocks, trusted-mode decisions, and confirmation metadata. It also validates the separate bounded tab tools. It must never authorize arbitrary JavaScript or unowned tabs.
- Link targets are bounded to HTTP(S) origin/path metadata in `pageDom.js`; `page_click` handles approved same-tab links and `page_open_link` handles indexed owned-tab links. Query strings and fragments stay out of model-visible snapshots.

## Local Contracts

- Helpers should be browser-safe and avoid hidden side effects except for modules whose purpose is storage.
- `skillParser.js` must stay aligned with the skill specification in root AGENTS.md.
- `permissionGuards.js` is the central place for blocked browser page behavior.
- `suggestionStorage.js` caps stored suggestions at 60 and enforces command and prompt length limits.
- `toolChoiceBuilder.js` is shared by chat and background paths; keep payload behavior provider-compatible.
- `runState.js` must stay DOM-light (element-like object contract) so it remains unit-testable without a browser, and its state list must match the `[data-run-state]` styles in `ui-primitives.css`.
- Page snapshot/policy helpers must remain deterministic and unit-testable in Node; snapshot data is bounded and sensitive-field values are never returned.
- Privileged background messages must require an extension-page sender; content-script requests must bind to the sender tab; run mutations must include the opaque owner token issued at run start.
- Provider SSE buffers and error response bodies must use the bounded helpers in `streamSafety.js`.
- Page-state fingerprints and tab arguments must stay bounded, deterministic, and safe to log. New tab origins are approved by the orchestrator, not by model-provided flags.

## Work Guidance

- Prefer small functions with explicit exports.
- Keep parsing and validation deterministic and testable without Chrome runtime state when possible.
- Update `scripts/test-runner.js` for new utility contracts that should not regress.
- Do not duplicate restricted-page checks, token budgeting, skill parsing, or tool choice normalization in entry points.

## Verification

- Run `npm run test` after utility changes.
- Run `npm run smoke` when manifest references, vendored dependency assumptions, or browser extraction dependencies are affected.

## Child DOX Index

- No child AGENTS.md files are currently needed under `src/utils/`.
