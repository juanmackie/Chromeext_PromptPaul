# Utils DOX

## Purpose

The `src/utils/` subtree contains shared helpers for validation, context budgeting, page permissions, action cards, profile routing, model discovery, skill parsing, tool choice payloads, suggestions, read strategy, run/feedback state, and runtime errors.

## Ownership

- `contextBudget.js` owns token estimation and DOM context trimming.
- `hermesContext.js` owns bounded Hermes current-turn/history preparation, active page-context retention, and historical media redaction.
- `readStrategy.js` owns extraction strategy selection from page signals.
- `siteExtractors.js` owns pure bounded formatters for Reddit threads, GitHub page metadata, and RSS/Atom feeds (`SITE_EXTRACTOR_CAPS`, truncation markers, XML text normalization). The classic content script mirrors these helpers; keep both sides aligned and covered by `tests/siteExtractors.test.js`.
- `permissionGuards.js` owns restricted URL and host permission checks.
- `actionCards.js` owns inferred site-specific prompt cards.
- `suggestionStorage.js` owns custom site suggestion persistence and normalization.
- `skillParser.js` owns canonical Agent Skills frontmatter parsing, metadata validation, Markdown generation, and the 100,000-character SKILL.md body limit.
- `toolChoiceBuilder.js` owns tool choice normalization and provider payload formatting.
- `profileRouting.js` owns profile usability and vision-model selection helpers.
- `codexAuth.js` owns background-only device-code sign-in, refresh, profile-local credential storage, and secret-free status responses. OAuth records are excluded from backup keys.
- `modelDiscovery.js` owns background-only API and Codex `/models` requests and normalizes safe model/reasoning metadata for the Options page. Codex requests include the client-version query/header required by the subscription route. It never returns credentials.
- `runtimeErrors.js` owns runtime error classification and friendly messages.
- `validation.js` owns shared URL, tool, profile, and backup normalization/validation; request endpoints are HTTP(S)-only and custom-tool methods/names are allowlisted. Backup normalization strips provider and search credentials and bounds the persisted notch position before export or restore.
- `validation.js` owns shared URL, tool, profile, and backup normalization/validation; request endpoints are HTTP(S)-only and custom-tool methods/names are allowlisted. The session-scoped `pageActionsEnabled` Act permission is not part of local backup/export data.
- `debounce.js` owns debounce and throttle helpers.
- `braveSearch.js` owns the bounded Brave LLM Context API client, HTTP(S)-only source normalization, byte budgeting, caller-abort handling, and safe `NO_RESULTS` errors when no usable sources remain.
- `mediaFetch.js` owns public-media URL validation and bounded response-body reads used before background base64 conversion.
- `pdfDetection.js` owns PDF URL hints, built-in Chrome viewer source unwrapping, response-header detection, and bounded signature probing for extensionless PDF endpoints.
- `runState.js` owns the standardized run/feedback state vocabulary (`idle`, `running`, `streaming`, `stopping`, `complete`, `error`, `stopped`) and the `data-run-state`/`aria-busy` DOM contract shared by chat and options.
- `keyedOperationLock.js` owns small per-key runtime locks used to serialize Hermes session-key creation and reject overlapping session resets.
- `runtimeAuthorization.js` owns extension-sender, content-script-tab, and opaque run-owner checks for privileged background messages.
- `streamSafety.js` owns bounded SSE buffers and provider error-body reads.
- `runResilience.js` owns bounded provider retry classification, reasoning-model request timeout floors, deterministic conversation compaction, run-output repetition checks, and safe provider error labels.
- `pageDom.js` owns bounded semantic snapshot normalization, optional readable-content bounds, element masking, safe display formatting, and snapshot identity checks for current-page actions.
- `pageActionPolicy.js` owns page-action argument validation, including bounded read-only `page_find_text`, risk classification, hard blocks, trusted-mode decisions, and confirmation metadata. It also validates the separate bounded tab tools. It must never authorize arbitrary JavaScript or unowned tabs.
- `pageActionCheckpoint.js` owns bounded session-only Act mutation checkpoints and explicit-recovery metadata, including the planner sub-goal identity attached to completion evidence. It never stores DOM, page text, notes, credentials, or raw values.
- `retryBackoff.js` owns bounded exponential delays with jitter for bridge and navigation recovery; it must not retry uncertain mutations.
- `pageActionScopeDiff.js` owns bounded indexed-region and snapshot-diff helpers. Runtime mutation results may expose only selector-free indices, flags, counts, and snapshot IDs; richer region and byte-size measurements remain evaluation-only. It must never accept model-supplied selectors or expose raw page values.
- `devDiagnostics.js` owns the development-only, opt-in diagnostics trace, session storage bounds, credential-shaped redaction, and extension-page error capture. `devDiagnostics.prod.js` is the production no-op replacement selected by `scripts/build.js`.
- Link targets are bounded to HTTP(S) origin/path metadata in `pageDom.js`; `page_click` handles approved same-tab links and `page_open_link` handles indexed `_blank` links, navigating the current target by default or an owned background tab when explicitly requested. Query strings and fragments stay out of model-visible snapshots.

## Local Contracts

- Helpers should be browser-safe and avoid hidden side effects except for modules whose purpose is storage. Sanitizer fallback behavior must escape HTML instead of returning partially sanitized markup when DOMPurify is unavailable.
- `skillParser.js` must stay aligned with the skill specification in root AGENTS.md.
- `permissionGuards.js` is the central place for blocked browser page behavior.
- `suggestionStorage.js` caps stored suggestions at 60 and enforces command and prompt length limits.
- `toolChoiceBuilder.js` is shared by chat and background paths; keep payload behavior provider-compatible.
- `runState.js` must stay DOM-light (element-like object contract) so it remains unit-testable without a browser, and its state list must match the `[data-run-state]` styles in `ui-primitives.css`.
- Page snapshot/policy helpers must remain deterministic and unit-testable in Node; snapshot data is bounded and sensitive-field values are never returned. Sensitivity matching must distinguish value-bearing controls from ordinary navigation labels (for example, “Video Cards”).
- Development diagnostics may record richer local troubleshooting payloads only in `dist-dev/`; credential-shaped fields and values must still be redacted, records must stay session-scoped and bounded, and production must use the no-op replacement.
- Privileged background messages must require an extension-page sender; content-script requests must bind to the sender tab; run mutations must include the opaque owner token issued at run start.
- Provider SSE buffers and error response bodies must use the bounded helpers in `streamSafety.js`. Provider errors shown to users must also use the bounded redaction helper from `runResilience.js`.
- Media response reads must use `mediaFetch.js`; private hosts, redirects, timeouts, and oversized bodies must fail closed.
- Page-state fingerprints and tab arguments must stay bounded, deterministic, and safe to log. Safe HTTP(S) tab origins are admitted by the bounded Act lease; model-provided flags cannot bypass ownership or policy.
- Scope/diff output may be included in a mutation result only as bounded selector-free metadata: indices, flags, counts, and snapshot IDs. Region byte sizes remain evaluation data. The helper must never expose credentials, raw page history, or screenshots.

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
