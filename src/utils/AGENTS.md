# Utils DOX

## Purpose

The `src/utils/` subtree contains shared helpers for validation, context budgeting, page permissions, action cards, profile routing, model discovery, skill parsing, tool choice payloads, suggestions, run/feedback state, and runtime errors.

## Ownership

- `contextBudget.js` owns token estimation and DOM context trimming.
- `answerSchema.js` owns the passive answer-card schema, byte/depth/text bounds, tagged-wire decoding, complete-block progressive parsing, and readable fallback. Bound incremental work and validate each completed prefix before rendering; terminal envelope validation remains authoritative. Keep card projections out of journals and retain ordinary response behaviour outside the explicit cards mode.
- `hermesContext.js` owns bounded Hermes current-turn/history preparation, active page-context retention, and historical media redaction.
- `hermesKeys.js` owns background-only Hermes credential validation (non-empty, 8–512 chars, no whitespace/control chars) and per-profile cleanup of `hermesApiKeys`/`hermesSessions`/`hermesSessionKeys` records on profile delete. It never exposes the secret value.
- `siteExtractors.js` owns pure bounded formatters for Reddit threads, GitHub page metadata, and RSS/Atom feeds (`SITE_EXTRACTOR_CAPS`, truncation markers, XML text normalization). The classic content script mirrors these helpers; keep both sides aligned and covered by `tests/siteExtractors.test.js`.
- `permissionGuards.js` owns restricted URL and host permission checks.
- `actionCards.js` owns inferred site-specific prompt cards.
- `suggestionStorage.js` owns custom site suggestion persistence and normalization.
- `skillParser.js` owns canonical Agent Skills frontmatter parsing, metadata validation, Markdown generation, and the 100,000-character SKILL.md body limit.
- `toolChoiceBuilder.js` owns tool choice normalization and provider payload formatting.
- `profileRouting.js` owns profile usability, vision-model selection and endpoint/model-bound saved tool-support metadata.
- `codexAuth.js` owns background-only device-code sign-in, refresh, profile-local credential storage, and secret-free status responses. OAuth records are excluded from backup keys.
- `modelDiscovery.js` owns background-only API and Codex `/models` requests and normalizes safe model/reasoning metadata for the Options page. Codex requests include the client-version query/header required by the subscription route. It records `supportsTools` from advertised `supported_parameters`; missing metadata stays unknown. Optional saved `modelToolSupport` is tied to the discovered endpoint/model. It never returns credentials.
- `runtimeErrors.js` owns runtime error classification and friendly messages.
- `validation.js` owns URL, tool, profile and backup normalization. Endpoints are HTTP(S)-only; custom-tool methods/names are allowlisted. Backups strip provider/search credentials, bound notch position, include site policies and the boolean `pageActionsPreciseInput` preference, and exclude session-scoped `pageActionsEnabled`. `page_update_plan` is reserved, orchestration-only and excluded from DOM batches.
- `pageActionSitePolicies.js` owns the persistent `pageActionSitePolicies` origin map: at most 200 HTTP(S) origins, only `block` or `allow_low_risk`. Origin keys exclude paths, credentials, queries and fragments. The background owns serialized changes and acknowledges only persisted writes.
- `keylessSearch.js` owns the keyless search-provider client. It fixes two hosted MCP endpoints: Exa's `https://mcp.exa.ai/mcp` (tool `web_search_exa`) first, then Parallel's keyless hosted Search MCP `https://search.parallel.ai/mcp` (tool `web_search`) as fallback. Each leg is a plain JSON-RPC `tools/call` fetch with bounded timeouts, bounded response reads, and bounded query/response/source budgets. It runs keyless by default; an optional background-owned `exaSearchApiKey` is sent as an `x-api-key` header on the Exa leg only and only raises Exa free-tier rate limits. It normalizes results into the same source shape as Brave, preserves the `NO_RESULTS` contract, and never logs or persists the user's query.
- `braveSearch.js` owns the bounded Brave LLM Context API client, HTTP(S)-only source normalization, byte budgeting, caller-abort handling, and safe `NO_RESULTS` errors when no usable sources remain. 400 error bodies surface a bounded, redacted reason in the user message so the user sees why the request was rejected. Error parsing extracts nested `error.detail` and `error.code` as bounded, redacted text and never emits `[object Object]`; the `OPTION_NOT_IN_PLAN` restriction maps to a `PLAN_RESTRICTED` error with an explicit "LLM Context access in Options" message, while all other HTTP 400 failures keep the existing `BAD_REQUEST` handling. The endpoint is fixed and plan restrictions are never auto-retried or auto-switched to another API.
- `mediaFetch.js` owns public-media URL validation and bounded response-body reads used before background base64 conversion.
- `pdfDetection.js` owns PDF URL hints, built-in Chrome viewer source unwrapping, response-header detection, and bounded signature probing for extensionless PDF endpoints.
- `runState.js` owns the standardized run/feedback state vocabulary (`idle`, `running`, `streaming`, `stopping`, `complete`, `error`, `stopped`) and the `data-run-state`/`aria-busy` DOM contract shared by chat and options.
- `keyedOperationLock.js` owns small per-key runtime locks used to serialize Hermes session-key creation and reject overlapping session resets.
- `runtimeAuthorization.js` owns extension-sender, content-script-tab, and opaque run-owner checks for privileged background messages.
- `streamSafety.js` owns bounded SSE buffers and provider error-body reads.
- `runResilience.js` owns bounded provider retry classification, reasoning-model request timeout floors, deterministic conversation compaction, run-output repetition checks, and safe provider error labels.
- `pageDom.js` owns bounded semantic snapshot normalization, optional readable-content bounds, element masking, bounded non-sensitive values and a 24,000-character viewport outline, safe display formatting, and snapshot identity checks for current-page actions.
- `pageActionResult.js` owns model-facing serialization: one formatted control list, readable text, notices, receipts and diff summaries. Snapshot identity remains in the envelope for history compaction; duplicate elements, region index arrays, fingerprints and metrics remain internal; bounded region IDs/counts remain available for scoped inspection.
- Act pointer tools support bounded double-click counts and indexed read-only hover; `page_go_back` requires an owned tab and readiness checking. Register built-in names in policy, validation, schemas and structural guards together.
- Keyboard arguments use the policy key allow-list. Enter and input submission classify the normalized form submit control; focused-target metadata and submit metadata carry no raw values, and sensitive targets remain prohibited.
- Evaluation traces measure original/compact snapshot bytes before truncation and keep provider messages bounded and secret-redacted; production trace stubs do no serialization or storage. Benchmark records include settlement timing, byte samples and bounded runtime outcomes; terminal outcomes survive trace-step exhaustion. Success prose is not grading evidence, and no model score is implied when no key is available.
- `pageActionPolicy.js` owns page-action argument validation, including bounded read-only `page_find_text`, `page_wait`, and non-nested `page_batch` observations, risk classification, hard blocks, trusted-mode decisions, and confirmation metadata. Same-origin GET forms are low-risk without confirmation only when bounded field metadata identifies a search query; write forms and cross-origin forms keep confirmation. It also validates the separate bounded tab tools. Every page-action tool accepts an optional bounded model-supplied `title` (≤80 chars) that this module validates and carries through normalization; titles with control characters or credential/payment wording are rejected so the label is safe to render on the progress card and persist in the journal. It must never authorize arbitrary JavaScript or unowned tabs.
- `pageActionCheckpoint.js` owns bounded session-only Act mutation checkpoints and explicit-recovery metadata, including the planner sub-goal identity attached to completion evidence. It preserves up to 12 checklist steps and the existing metadata shape. Explicit Resume maps old done/blocked statuses to completed/skipped and restores one active step. It never stores DOM, page text, notes, credentials, or raw values.
- `retryBackoff.js` owns bounded exponential delays with jitter for bridge and navigation recovery; it must not retry uncertain mutations.
- `pageActionScopeDiff.js` owns bounded indexed-region and snapshot-diff helpers. Runtime mutation results may expose only selector-free indices, flags, counts, and snapshot IDs; richer region and byte-size measurements remain evaluation-only. It must never accept model-supplied selectors or expose raw page values.
- `devDiagnostics.js` owns the development-only, opt-in diagnostics trace, session storage bounds, credential-shaped redaction, and extension-page error capture. `devDiagnostics.prod.js` is the production no-op replacement selected by `scripts/build.js`.
- `evalTrace.js` and `evalHook.js` own the no-op source interfaces for the isolated evaluation build. `*.eval.js` variants are installed only into `dist-eval/`; they record bounded public-task traces and expose direct test invocation without adding production capabilities.
- Link targets are bounded to HTTP(S) origin/path metadata in `pageDom.js`, with URL credentials, query strings, and fragments removed. Compact model-facing results retain a bounded indexed link list with an `opensNewTab` hint so the model can select `page_click` or `page_open_link` without a blocked trial action; `_blank` links use `page_open_link`, navigating the current target by default or an owned background tab when explicitly requested.

## Local Contracts

- Helpers should be browser-safe and avoid hidden side effects except for modules whose purpose is storage. Sanitizer fallback behavior must escape HTML instead of returning partially sanitized markup when DOMPurify is unavailable.
- `skillParser.js` must stay aligned with the skill specification in root AGENTS.md.
- `permissionGuards.js` is the central place for blocked browser page behavior.
- `suggestionStorage.js` caps stored suggestions at 60 and enforces command and prompt length limits.
- `toolChoiceBuilder.js` is shared by chat and background paths; keep payload behavior provider-compatible.
- `runState.js` must stay DOM-light (element-like object contract) so it remains unit-testable without a browser, and its state list must match the `[data-run-state]` styles in `ui-primitives.css`.
- Page snapshot/policy helpers must remain deterministic and unit-testable in Node; snapshot data is bounded and sensitive-field values are never returned. Safe values are limited to 160 characters each and 8,000 characters per snapshot, redacted before display, and excluded from journals/checkpoints. Focused-target and submit-control metadata remain value-free; only the bounded element list discloses field values. Sensitivity matching must distinguish value-bearing controls from ordinary navigation labels (for example, “Video Cards”).
- Form policy metadata may contain only the normalized method and HTTP(S) origin. Never retain the form action path, query, fragment, or user-entered values.
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

- Element IDs are safe non-negative integers independent of the 200-control snapshot cap. Scope diffs compare bounded safe values internally and return only changed indices/flags/counts. Input postconditions accept text_appears, text_gone or url_changes; scalar values and append arguments remain bounded.

## Verification

- Run `npm run test` after utility changes.
- Run `npm run smoke` when manifest references, vendored dependency assumptions, or browser extraction dependencies are affected.

## Child DOX Index

- No child AGENTS.md files are currently needed under `src/utils/`.
