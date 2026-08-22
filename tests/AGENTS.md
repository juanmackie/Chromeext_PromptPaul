# Tests DOX

## Purpose

The `tests/` subtree contains structural, unit, behavior, and real-browser verification for Prompt Paul.

## Ownership

- Root-level test files cover shared runtime and regression behavior.
- `page-action-evaluation.json`, `pageActionEvaluation.test.js`, and `pageActionEvaluationExecution.test.js` own the credential-free browser-action evaluation corpus, schema guards, provider matrix, and bounded metric execution.
- `hermesTransport.test.js` covers Hermes endpoint validation, capability/error handling, approval choices, output adaptation, and event adaptation without real credentials or a live gateway.
- `runtimeAuthorization.test.js` covers extension sender, content-script tab, and opaque run-owner checks without Chrome runtime state.
- `streamSafety.test.js` covers bounded SSE buffers and provider error-body reads.
- `hermesContext.test.js` covers bounded Hermes history, page-context retention, current-turn handling, and historical media redaction.
- `chatHermes.test.js` covers approval-card settlement; `keyedOperationLock.test.js` covers per-profile session reset and session-key concurrency primitives.
- `pageDom.test.js`, `pageActionPolicy.test.js`, and `pageTabController.test.js` cover bounded page state, policy, and owned-tab behavior.
- `tests/browser/AGENTS.md` owns unpacked-extension Playwright coverage and local browser fixtures.

## Local Contracts

- Tests must preserve the root extension contracts and must not use real credentials or private services.
- Evaluation cases must use local fixtures or explicit platform-boundary labels and must not retain secrets, raw page history, or unbounded screenshots.
- Scope/diff evaluation must use indexed semantic regions and bounded change metadata. It must never accept model-supplied selectors or return raw field values.
- Page-action tests must cover bounded fingerprints, repeated-action loop blocking, approved same-tab and owned-tab link navigation, tab-tool opt-in, and journal-safe event behavior.
- Browser fixtures represent Gmail/Outlook compose surfaces locally; they are not production pages.
- `tests/browser/page-action-evaluation.spec.js` executes browser-safe evaluation cases and records bounded result, receipt, action-count, prompt-size, and failure-code metrics without persisting page data.

## Work Guidance

- Keep assertions focused on observable behavior and actionable failure states.
- Run the narrow suite while iterating, then run the applicable full gates before closeout.

## Verification

- `npm run test` and `npm run test:behavior` cover non-browser checks.
- `npm run test:browser` covers the real-browser suite described by the child DOX.

## Child DOX Index

- `tests/browser/AGENTS.md`: unpacked-extension Playwright suite and local fixtures.
