# Tests DOX

## Purpose

The `tests/` subtree contains structural, unit, behavior, and real-browser verification for Prompt Paul.

## Ownership

- Root-level test files cover shared runtime and regression behavior.
- `page-action-evaluation.json`, `pageActionEvaluation.test.js`, and `pageActionEvaluationExecution.test.js` own the credential-free browser-action evaluation corpus, schema guards, provider matrix, and bounded metric execution.
- `hermesTransport.test.js` covers Hermes endpoint validation, capability/error handling, approval choices, output adaptation, and event adaptation without real credentials or a live gateway.
- `runtimeAuthorization.test.js` covers extension sender, content-script tab, and opaque run-owner checks without Chrome runtime state.
- `validation.test.js` covers persistence and validation of the `notchEnabled`, bounded `notchPosition`, and `notchPlacement` backup preferences and `themePreference` values.
- `streamSafety.test.js` covers bounded SSE buffers and provider error-body reads.
- `devDiagnostics.test.js` covers credential-shaped redaction and diagnostic payload bounds; it never enables browser tracing or uses real credentials.
- `chatModelStatus.test.js` covers the sidebar model-name formatting fallback.
- `mediaFetch.test.js` covers public-media URL rejection, response MIME checks, and streamed size limits.
- `domSanitizer.test.js` covers fail-closed HTML escaping when DOMPurify is unavailable.
- `prompts.test.js` covers untrusted context and metadata boundaries; `chatDocuments.test.js` covers filename separation from document instructions.
- `hermesContext.test.js` covers bounded Hermes history, page-context retention, current-turn handling, and historical media redaction.
- `chatHermes.test.js` covers approval-card settlement; `keyedOperationLock.test.js` covers per-profile session reset and session-key concurrency primitives.
- `chatComposer.test.js` covers composer context state, action splitting, inline recovery helpers, and the pending-document attachment rules (single-document limit message, structured `document` request building, tray rendering with Replace/Keep-current conflict state).
- `chatRuntimeMessage.test.js` covers the acknowledgement-only long-run bridge and transient runtime-channel error wording.
- `pageDom.test.js`, `pageActionPolicy.test.js`, and `pageTabController.test.js` cover bounded page state (including ARIA widget-state flags), policy, and owned-tab behavior; `actWorkingMemory.test.js` covers the run-scoped ledger, stable target keys, effect summaries, bounds, and toggle detection; `actPlanner.test.js` covers counted-request activation and quota deduplication; `pageTaskMemory.test.js` covers safe optional quota item notes. `pageActionPolicy.test.js` also guards the optional model-supplied step `title` (≤80 chars, unsafe/control-character titles omitted without rejecting the underlying action, valid-title propagation).
- `evalDryRun.test.js` covers dry-run interception of state-changing page actions without delivery; `evalHook.test.js` covers the build-gated `TEST_RUN_TASK` bridge; `evalTrace.test.js` covers bounded redacted eval trace storage and provider-reported token counts.
- `tests/browser/AGENTS.md` owns unpacked-extension Playwright coverage and local browser fixtures; its `acceptance-journeys.spec.js` runs the six Day-1 acceptance journeys as real-browser regression.
- `runOrchestrator.test.js` covers orchestrator behavior including the bounded `page_task_progress` progress-card events (current action, target page, waiting state), journal safety, the approval-wait deadline pause, and the declined-outcome/planner-nudge path. `runResilience.test.js` covers the approval-wait deadline-extension math (full wait absorbed, 10-minute cap, non-Act runs untouched, timeout path).

## Local Contracts

- Tests must preserve the root extension contracts and must not use real credentials or private services.
- Evaluation cases must use local fixtures or explicit platform-boundary labels and must not retain secrets, raw page history, or unbounded screenshots. The opt-in `npm run benchmark:act -- --run` uses the eval build, requires an environment key, never runs in CI, and stores only end-state/step/token/time/confirmation metrics under ignored `artifacts/act-benchmark/`.
- Scope/diff evaluation must use indexed semantic regions and bounded change metadata. It must never accept model-supplied selectors or return raw field values.
- Page-action tests must cover bounded fingerprints, per-snapshot element-key mismatch rejection before dispatch, read-only `page_find_text` search, repeated-action loop blocking, automatic active-tab document recovery, same-tab and owned-tab link navigation under the single Act lease, opened-tab readiness, tab-local bridge quarantine, separate action budgets, bounded task notes/history compaction, and journal-safe event behavior. Direct browser-harness mutations derive the internal `elementKey` from the latest observed snapshot; models never supply that key. Development diagnostics tests must preserve the production no-op build variant and credential redaction.
- Browser fixtures represent Gmail/Outlook compose surfaces locally; they are not production pages. `act-gmail-like.html` covers ARIA sort-menu discovery, per-thread buttons, hash-only SPA route receipts, fragment redaction, and toggle loops without a live Gmail account.
- `tests/browser/page-action-evaluation.spec.js` and `tests/pageActionEvaluationExecution.test.js` provide executor-regression coverage of browser-safe evaluation cases and record bounded result, receipt, action-count, tool-argument-size, failure-code, and measured policy-outcome metrics without persisting page data. The policy-denied outcome is derived from the actual approval decision (PAGE_ACTION_DENIED / not_delivered), never hardcoded; a denied action is observable as a policy violation and fails the success/risk metric. Actual provider payload size, end-state task success, latency, and repeated-run consistency are measured in the whole-task suite of `pageActionEvaluationExecution.test.js`, passing provider cases through their real wire conversion and using distinct injection fixtures (`injection-hidden.html`, `injection-alt.html`, `injection-aria.html`). The browser spec loads each injection fixture end-to-end and enforces a metric gate so a missed sabotage fixture fails.
- `tests/browser/approval-recovery.spec.js` owns real-browser approval-binding, one-time execution with fixture-backed verified receipts, denial/timeout/Stop invariance, planner-versus-navigation approval separation, Watch adoption, terminal-reconnect races, and explicit checkpoint Resume coverage.

## Work Guidance

- Keep assertions focused on observable behavior and actionable failure states.
- Run the narrow suite while iterating, then run the applicable full gates before closeout.

## Verification

- `npm run test` and `npm run test:behavior` cover non-browser checks.
- `npm run test:browser` covers the real-browser suite described by the child DOX.

## Child DOX Index

- `tests/browser/AGENTS.md`: unpacked-extension Playwright suite and local fixtures.
