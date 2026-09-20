# Browser Tests DOX

## Purpose

`tests/browser/` provides page-agent-style Playwright coverage against the unpacked Prompt Paul extension in a real Chromium-family browser.

## Ownership

- `page-actions.spec.js` owns the page-action integration cases, including approved link navigation, owned-tab link opening, and hostile content-script message rejection.
- `page-action-evaluation.spec.js` owns real-browser executor-regression coverage of browser-safe corpus cases, bounded receipt/failure/action/tool-argument metrics, live snapshot scope/diff measurement, distinct measured injection-fixture execution (`injection-hidden.html`, `injection-alt.html`, `injection-aria.html`), measured denial outcomes, and a browser-level metric gate that fails when an injection/sabotage fixture is missed or a denied action is recorded as delivered. Restricted-page and Hermes provider boundaries remain in the unit evaluation matrix.
- `approval-recovery.spec.js` owns real-browser approval sequencing and reconnect/checkpoint recovery coverage: approval decisions bind to the current confirmation, run, owner token, and source tab (wrong bindings are rejected without consuming the confirmation), approved harmless input executes exactly once with a verified receipt backed by the fixture's actual value, denial and confirmation timeout and Stop leave the page unchanged and consumed decisions cannot be replayed, planner approval stays distinct from navigation-action approval (a stale snapshot after a verified mutation must re-inspect before acting), startup renders the existing reconnect controls, Watch adopts the active run without a second provider request, a run completing during reconnect produces no duplicate output or stale controls, and checkpoint Resume requires an explicit user action plus a fresh inspection and never replays automatically — the Resume test asserts the fresh-inspection contract at the wire: the resumed run's provider request carries only `page_get_state` as its tool and tool_choice.
- `options-feedback.spec.js` owns real-browser Options status-feedback coverage: skill-form validation and success messages render as visible toasts (guarding the Bootstrap `.toast:not(.show){display:none}` cascade regression that hid every `showStatus()` message) while Bootstrap's own `#statusToast` stays hidden, and a saved skill appears in the skills table.
- `chat-actions.spec.js` owns real-browser selected-text chat action and sidebar model-status coverage; its recapture flow follows the active tab after the sticky selection is detached.
- `selected-text.spec.js` owns real-browser selected-text capture and delivery coverage: a queued background-tab selection attaches to the composer tray with zero provider requests and survives tab changes, Analyze delivers the structured `selected_text` context into the submitted request (asserted against the mocked provider) and renders the mocked reply, a handoff queued while no panel exists is consumed on panel load, and after detaching the selection the live recapture follows the newly active tab.
- `document-drop.spec.js` owns real-browser document-drop coverage: dropped text documents attach to the composer tray with zero network activity — asserted both at the page wrapper and at the fixture server (`fixtureServer.mockRequests()` must stay empty, closing the service-worker path) — truncation marking, removal, the explicit Replace/Keep-current choice for a second document, the single-document limit message, invalid/oversized handling, send-through-`document`-context with failed-submission retention, Retry/Edit identity replay, the empty-prompt document instruction fallback, and the combined media + pending-document send (a media drop auto-analyze must carry the pending document as structured context and clear the chip on terminal success; asserted against the recorded mock-provider request body).
- `acceptance-journeys.spec.js` owns six concrete acceptance journeys for real-browser regression (summarize an article with attached context, rewrite selected text retaining surroundings, follow up on an attached document, filter a table and report matching rows, fill a harmless form under approval, and compare two pages opened explicitly). Online-model text generation is separated out of the scripted gate: the deterministic context/test/approval parts are asserted credential-free, and the natural-language bubble assertions are commented out and trailed separately with a live provider.
- `notch.spec.js` owns browser-page notch enablement, isolation, accessibility state, horizontal dragging and remembered position, pinned prompt rendering, Act controls, activity glow, selection gating, live disable coverage, and the user-gesture-bound All actions handoff.
- `theme.spec.js` owns Light/Dark/System selector coverage and live system-preference changes.
- `browserTestSupport.js` owns browser launch, fixture-server, extension-worker, test cleanup helpers, optional development-trace capture, and the mocked OpenAI-style chat-completions endpoint (`/mock-chat`) that records bounded requests (Authorization presence only, never credential values) and answers with a deterministic SSE reply for credential-free delivery tests.
- `extension-harness.html` and `extension-harness.js` own the extension-page bridge used by tests.
- `fixtures/` owns credential-free local representatives of form and compose pages, including distinct injection fixtures (`injection-hidden.html`, `injection-alt.html`, `injection-aria.html`) for hidden/alt/ARIA trust-boundary scenarios, plus the acceptance-journey fixtures: a long-form article (`article.html`), a markdown launch-notes document (`notes.md`), two vendor-plan comparison pages (`plan-a.html`, `plan-b.html`), and a filterable book-catalogue table (`tables.html`).

## Local Contracts

- The suite must load the repository unpacked, exercise the content-script bridge and indexed semantic controls, and remain safe to run without network credentials.
- Coverage includes connection interruption, compose contenteditable fields, executor timeout, same-tab and cross-origin link navigation under Act, current-tab `_blank` navigation, explicit foreground and background owned-tab opening with readiness, active-tab navigation recovery, tab-local failure handling, service-worker restart, manual-intervention resume, verified/unverified receipts, and live scope/diff measurements.
- Branded-browser runs select Chrome or Edge with `PROMPT_PAUL_BROWSER=chrome|edge`; the suite uses the browser-level CDP `Extensions.loadUnpacked` path required by Chrome 137+ and equivalent Edge builds. The default uses the installed Playwright Chromium runtime.

## Work Guidance

- Keep browser tests headed by default because extension service workers are unavailable in legacy headless Chromium.
- Use local fixtures instead of Gmail/Outlook accounts or private data.
- Use deterministic waits (selector/run-state/polling) instead of fixed sleeps. The one sanctioned exception is a bounded absence window that asserts something does NOT happen when no event exists to await (e.g., the Resume no-auto-replay check in `approval-recovery.spec.js`); mark it with an explanatory comment.
- Keep evaluation output limited to result, receipt disposition, postcondition evidence, failure code, action count, prompt size, and bounded scope metrics. The evaluation matrix uses its measured 180-second test timeout so credential-free cases do not fail from the default per-test budget; cleanup remains bounded.
- Keep the harness limited to test observability and existing runtime message contracts; do not add production capabilities for test convenience.
- Set `PROMPT_PAUL_CAPTURE_DIAGNOSTICS=true` to enable the development trace for each browser test and write per-test service-worker records to `PROMPT_PAUL_DIAGNOSTICS_DIR` (default `artifacts/browser-diagnostics/`). Keep this mode local and review records before sharing them.

## Verification

- Run `npm run test:browser` from the repository root; the command runs every spec in this directory.
- Run `npx prettier --check` and `npx eslint` for changed browser test files.

## Child DOX Index

- No child AGENTS.md files are currently needed under `tests/browser/`.
