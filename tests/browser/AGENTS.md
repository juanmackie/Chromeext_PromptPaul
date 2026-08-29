# Browser Tests DOX

## Purpose

`tests/browser/` provides page-agent-style Playwright coverage against the unpacked Prompt Paul extension in a real Chromium-family browser.

## Ownership

- `page-actions.spec.js` owns the page-action integration cases, including approved link navigation, owned-tab link opening, and hostile content-script message rejection.
- `page-action-evaluation.spec.js` owns real-browser execution of browser-safe corpus cases, bounded receipt/failure/action/prompt metrics, and live snapshot scope/diff measurement. Restricted-page and Hermes provider boundaries remain in the unit evaluation matrix.
- `chat-actions.spec.js` owns real-browser selected-text chat action coverage.
- `browserTestSupport.js` owns browser launch, fixture-server, extension-worker, and test cleanup helpers.
- `extension-harness.html` and `extension-harness.js` own the extension-page bridge used by tests.
- `fixtures/` owns credential-free local representatives of form and compose pages.

## Local Contracts

- The suite must load the repository unpacked, exercise the content-script bridge and indexed semantic controls, and remain safe to run without network credentials.
- Coverage includes connection interruption, compose contenteditable fields, executor timeout, same-tab and cross-origin link navigation under Act, foreground and background owned-tab opening with readiness, active-tab navigation recovery, tab-local failure handling, service-worker restart, manual-intervention resume, verified/unverified receipts, and live scope/diff measurements.
- Branded-browser runs select Chrome or Edge with `PROMPT_PAUL_BROWSER=chrome|edge`; the suite uses the browser-level CDP `Extensions.loadUnpacked` path required by Chrome 137+ and equivalent Edge builds. The default uses the installed Playwright Chromium runtime.

## Work Guidance

- Keep browser tests headed by default because extension service workers are unavailable in legacy headless Chromium.
- Use local fixtures instead of Gmail/Outlook accounts or private data.
- Keep evaluation output limited to result, receipt disposition, postcondition evidence, failure code, action count, prompt size, and bounded scope metrics.
- Keep the harness limited to test observability and existing runtime message contracts; do not add production capabilities for test convenience.

## Verification

- Run `npm run test:browser` from the repository root; the command runs every spec in this directory.
- Run `npx prettier --check` and `npx eslint` for changed browser test files.

## Child DOX Index

- No child AGENTS.md files are currently needed under `tests/browser/`.
