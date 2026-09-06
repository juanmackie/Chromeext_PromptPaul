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
- `chatRuntimeMessage.test.js` covers the acknowledgement-only long-run bridge and transient runtime-channel error wording.
- `pageDom.test.js`, `pageActionPolicy.test.js`, and `pageTabController.test.js` cover bounded page state, policy, and owned-tab behavior.
- `evalDryRun.test.js` covers dry-run interception of state-changing page actions without delivery; `evalHook.test.js` covers the build-gated `TEST_RUN_TASK` bridge; `evalTrace.test.js` covers bounded redacted eval trace storage.
- `tests/browser/AGENTS.md` owns unpacked-extension Playwright coverage and local browser fixtures.

## Local Contracts

- Tests must preserve the root extension contracts and must not use real credentials or private services.
- Evaluation cases must use local fixtures or explicit platform-boundary labels and must not retain secrets, raw page history, or unbounded screenshots.
- Scope/diff evaluation must use indexed semantic regions and bounded change metadata. It must never accept model-supplied selectors or return raw field values.
- Page-action tests must cover bounded fingerprints, read-only `page_find_text` search, repeated-action loop blocking, automatic active-tab document recovery, same-tab and owned-tab link navigation under the single Act lease, opened-tab readiness, tab-local bridge quarantine, separate action budgets, bounded task notes/history compaction, and journal-safe event behavior. Development diagnostics tests must preserve the production no-op build variant and credential redaction.
- Browser fixtures represent Gmail/Outlook compose surfaces locally; they are not production pages.
- `tests/browser/page-action-evaluation.spec.js` and `tests/pageActionEvaluationExecution.test.js` provide executor-regression coverage of browser-safe evaluation cases and record bounded result, receipt, action-count, tool-argument-size, and failure-code metrics without persisting page data. Actual provider payload size, observed policy outcomes, end-state task success, latency, and repeated-run consistency are measured in the whole-task suite of `pageActionEvaluationExecution.test.js`, passing provider cases through their real wire conversion and using distinct injection fixtures (`injection-hidden.html`, `injection-alt.html`, `injection-aria.html`).

## Work Guidance

- Keep assertions focused on observable behavior and actionable failure states.
- Run the narrow suite while iterating, then run the applicable full gates before closeout.

## Verification

- `npm run test` and `npm run test:behavior` cover non-browser checks.
- `npm run test:browser` covers the real-browser suite described by the child DOX.

## Child DOX Index

- `tests/browser/AGENTS.md`: unpacked-extension Playwright suite and local fixtures.
