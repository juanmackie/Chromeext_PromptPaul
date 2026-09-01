# Prompt Paul Read-Only Product Review Plan

## Implementation status

The selected P1/P2 backlog is implemented. The changes protect the active answer bubble, enforce bounded Act planner continuation and final verification, retain read-only and overflow evidence, replay run recovery, scope activity cards, preserve reader scroll position, settle controls only after acknowledgement, add modal focus behavior, handle storage failures, and raise the browser evaluation timeout. No P0 or P3 work was identified.

Verification after implementation: `npm run test` 95/95, `npm run test:behavior` 538/538, `npm run test:browser` 36/36, lint, formatting, smoke, and audit passed.

The remaining review risk is end-to-end provider-specific behavior: no live credentialed provider stream was used. The orchestrator now continues bounded unresolved Act plans and emits an explicit incomplete limitation after the continuation cap.

## Context

Review the extension for small, high-impact defects and polish gaps, with special focus on Act runs that hide the final answer or stop before completing the user's full task. Deliver a prioritized, evidence-backed to-do list for the development team. Do not modify source code.

Initial evidence:

- `src/chat/AGENTS.md` requires the completed assistant bubble to appear after tool traces.
- `src/chat/ChatUI.js` and `chat.js` already move the completed bubble to the transcript end, and the same fix is present in `dist/` and `Prompt-Paul-6.2.1.zip`. Coverage is only a synthetic DOM unit test, so runtime edge cases—not simple package staleness—are the priority.
- `ChatUI.trimExcessMessages()` can remove the still-streaming assistant bubble during a trace-heavy run. The complete handler still writes to that detached element, and `moveMessageToEnd()` then returns `false` without rendering a replacement. This is a priority reproduction target.
- `ChatPageAutomation.updatePageActionActivity()` finds one global activity card and keys items only by event sequence. Consecutive Act runs can reuse or overwrite earlier activity instead of creating run-local history.
- `src/orchestrator/AGENTS.md` requires multi-item Act runs to continue after partial progress. However, planner receipt tracking excludes read-only actions, provider text completion is not gated on unresolved goals, verified receipts are not tied to the goal they complete, and decomposition silently caps work at eight goals. These are priority whole-task tests.
- Run recovery persists terminal content and bounded approval/activity events, but the panel recovery UI does not replay them. Closing the panel can therefore hide a completed answer or strand an approval until timeout.
- Several user-data and Act-interaction callbacks disable/reset UI or report success before checking `chrome.runtime.lastError` or runtime acknowledgement. Storage-failure and transport-failure handling are priority reliability checks.
- The working tree already contains user changes in `CHANGELOG.md`, `manifest.json`, `package.json`, and `package-lock.json`; the read-only review did not alter them, and the implementation phase preserves them.
- The user authorized unrestricted test depth. Live provider and signed-in-page observation may be used, but the read-only review will avoid lasting external changes; mutations will use local or disposable fixtures.

## Approach

1. Trace final-answer rendering, Act activity ordering, transcript trimming, reconnect handling, and scroll behavior from orchestrator events through the chat DOM.
2. Trace task-completion enforcement through planner activation/decomposition, read-only and mutation receipts, model-selected early completion, tool budgets, wrap-up paths, and terminal events.
3. Audit adjacent high-impact UX, reliability, accessibility, privacy, permission, and error-recovery seams.
4. Run existing non-mutating checks, local browser fixtures, and bounded live-provider scenarios. Use signed-in pages only for observation and local/disposable pages for mutations.
5. Rank each confirmed item by severity, user impact, confidence, evidence, likely owner, smallest safe fix, and verification criteria. Separate confirmed defects from recommendations and significant risks.

## Historical review scope

- The read-only review phase changed `REVIEW_PLAN.md` only.
- The implementation phase changes the owning source, test, and browser-test files named by the backlog; generated output and credentials remain untouched.
- The final report identifies implemented fixes and their verification rather than only likely touchpoints.

## Reuse

- Final response composition: `src/chat/ChatGrounding.js` (`buildFinalResponseBody`).
- Transcript ordering and scrolling: `src/chat/ChatUI.js`, `src/chat/ChatStream.js`.
- Act activity rendering: `src/chat/ChatPageAutomation.js` (`updatePageActionActivity`).
- Ordered event handling: `chat.js` orchestrator-event switch and `ChatStream.queueOrchestratorEvent`.
- Long-task controls: `src/orchestrator/RunOrchestrator.js`, `src/orchestrator/ActPlanner.js`, `src/orchestrator/runResilience.js`.
- Existing verification: `npm run test`, `npm run test:behavior`, and `npm run test:browser`.

## Steps

- [x] Map the affected UI and orchestration flows end to end.
- [x] Inspect existing tests and recent diffs for intended behavior and coverage gaps.
- [x] Run static, unit, behavior, smoke, and browser checks that do not require credentials.
- [x] Reproduce final-answer visibility across normal, 100+ trace, consecutive-run, reconnect, error, stop, and token-limit terminal paths.
- [x] Verify each Act run gets its own activity history and that scroll behavior surfaces completion without repeatedly yanking a user who is reading earlier output.
- [x] Exercise short mutation, long mutation, read-only research, mixed read/write, ambiguous, blocked, more-than-eight-item, and budget-exhausted Act tasks; compare completed work with the original instruction and planner state.
- [x] Test whether a provider can return text while planner goals remain pending and whether final verification represents the requested outcome rather than only a fresh snapshot.
- [x] Close/reopen the side panel while streaming, awaiting approval, awaiting manual input, and just after completion; verify answer, activity, controls, and ownership recovery.
- [x] Inject storage/runtime failures into instruction save/import/restore and Act approval/clarification/manual-resume flows; verify drafts and retry controls are preserved.
- [x] Audit nearby product-polish and high-impact reliability/security/accessibility seams, including duplicate traces, focus management, forced scrolling, stale terminal bubbles, and permission clarity.
- [x] Produce a deduplicated P0-P3 development backlog with evidence, likely owner, smallest safe fix, and acceptance checks.

## Verification

- Every confirmed defect must cite a source location, test output, or reproducible browser observation.
- Interactive findings should include concise reproduction steps and expected versus actual behavior.
- Completion findings should compare the original task, executed actions, planner/receipt evidence, and final answer.
- The report must state what could not be tested, especially provider-specific or credential-gated behavior.
- Each backlog item must be labeled **confirmed**, **reproduced**, or **risk requiring reproduction**; speculative style preferences are excluded.
- Re-read the final backlog against the user's two examples and verify that small polish items and significant risks are listed separately.

## Review evidence captured

### P0 — No release-blocking finding identified

No confirmed P0 issue was found. No credential exposure, unsafe JavaScript execution, or unbounded external mutation was observed in this review.

### P1 — Significant reliability and task-completion work

- **[Label: reproduced] Long Act transcripts can detach the final answer bubble.** `src/chat/ChatUI.js:470-491` caps the DOM at 100 children and removes the oldest child. `chat.js:1903-1958` adds generic tool trace children; `chat.js:1960-2001` renders the terminal answer into the saved streaming element and calls `moveMessageToEnd()`, while `src/chat/ChatUI.js:157-160` returns false when that element is detached. Repro: start with the streaming bubble as child 1, append 50 `tool_ready`/`tool_complete` pairs, and apply the existing trim loop; observed output: `activeBubbleStillAttached:false`, `visibleChildren:100`. Owner: `src/chat/ChatUI.js`, `chat.js`. Fix: protect the active bubble or reinsert it on terminal completion. Acceptance: a 100+ trace run retains one visible final answer at the bottom.
- **[Label: risk requiring reproduction] Act can terminate with unresolved planner goals.** `src/orchestrator/RunOrchestrator.js:4702-4734` unconditionally marks text complete and emits `complete`; the unresolved-goal restriction exists only in prompt/tool-selection guidance at `:3238-3242` and `:3475-3479`. Repro: use a multi-goal Act request, make the provider return ordinary text before all goals resolve, and inspect the terminal event. Owner: `src/orchestrator/RunOrchestrator.js`. Fix: gate normal finalization on resolved goals or an explicit blocked/limited outcome. Acceptance: the provider cannot silently end an active plan with pending goals.
- **[Label: confirmed] Read-only Act work cannot naturally produce planner completion evidence.** `src/orchestrator/RunOrchestrator.js:1354-1368` excludes `page_get_state`, `page_scroll`, `page_find_text`, and `page_list_tabs` from planner receipts, while `src/orchestrator/ActPlanner.js:289-305` requires a verified receipt plus a note to advance. Repro: the direct planner probe left goals unchanged for a read-only action; the runtime exclusion prevents that receipt from existing. Owner: both files. Fix: support bounded, goal-relevant read-only evidence. Acceptance: a read-only multi-item task can advance and reach final verification.
- **[Label: reproduced] Requests with more than eight planned items are silently truncated.** `src/orchestrator/ActPlanner.js:10-11,99-112,255` caps extraction/replanning at `MAX_SUB_GOALS = 8`. Repro: pass ten numbered items to `createPlannerState`; observed output: `goals:8` and only items 1–8. Owner: `ActPlanner.js`. Fix: group overflow into a remaining-work goal or report a capability limit. Acceptance: no requested item disappears silently.
- **[Label: reproduced] Planner activation misses concise multi-action prose.** `src/orchestrator/ActPlanner.js:32-47,79-83` activates on length or narrow signal patterns, not on the existing action-clause decomposition. Repro: `Open inbox, label invoices, archive spam`; observed output: `activates:false`, `goals:0`. Owner: `ActPlanner.js`. Fix: activate when bounded action decomposition finds multiple actions. Acceptance: concise multi-action requests receive the same completion safeguards.
- **[Label: confirmed] Terminal recovery does not restore completed answer content.** `src/orchestrator/RunOrchestrator.js:4806` persists bounded complete content in the journal, but `src/chat/ChatRunRecovery.js:79-121` renders only status/objective and a Dismiss/Watch control. Repro: complete a run, close/reopen the panel, and compare the recovery card with the journal’s terminal content. Owner: `ChatRunRecovery.js`, `chat.js`. Fix: render the safe terminal result and settle/clear the pointer deliberately. Acceptance: reopening after completion shows the answer once.
- **[Label: confirmed] Watch recovery skips earlier actionable events.** `chat.js:944-966` sets the next sequence to the journal’s current end without replaying `src/orchestrator/RunOrchestrator.js:4753-4806` journaled activity or approval events. Repro: leave a run awaiting approval, reopen the panel, choose Watch, and observe whether the approval card returns; existing browser coverage only verifies active-run attachment/disabled Send. Owner: `chat.js`, `ChatRunRecovery.js`. Fix: replay bounded activity and live approval state before subscribing. Acceptance: a watched run never waits on an invisible approval.
- **[Label: confirmed] Options persistence can report success before storage acknowledgement.** `options.js:2118-2123` shows success and resets after `chrome.storage.local.set()` without checking `chrome.runtime.lastError`; import does the same at `:2246-2251`, and backup restore resolves writes without checking errors at `:3352-3368`. Repro: inject a quota/write failure and verify the success banner, form reset, and reload behavior. Owner: `options.js`. Fix: use an error-aware storage promise and mutate UI only after success. Acceptance: failed writes preserve drafts and show failure.

### P2 — User-visible UX, recovery, and accessibility polish

- **[Label: confirmed] Activity is not scoped to a run.** `src/chat/ChatPageAutomation.js:107-108` selects the first global activity card and `:139-143` keys items only by sequence; `src/orchestrator/RunOrchestrator.js:4753` restarts sequence state per run. Code evidence: a second run can select the first run’s card and reuse its sequence keys. Owner: `src/chat/ChatPageAutomation.js`, `chat.js`. Smallest safe fix: add run identity to card and item lookup. Acceptance: each run has isolated activity.
- **[Label: confirmed] Activity updates forcibly scroll readers to the bottom.** `src/chat/ChatPageAutomation.js:151-153` always assigns `scrollTop = scrollHeight`, unlike the near-bottom guard in `src/chat/ChatStream.js:65-105`. Code evidence: every page-action update writes the bottom position without measuring the prior position. Owner: `src/chat/ChatPageAutomation.js`, `src/chat/ChatStream.js`. Smallest safe fix: preserve scroll unless the user was near bottom and show a new-activity affordance otherwise. Acceptance: deliberate reading position remains stable.
- **[Label: confirmed] Generic tool traces duplicate the compact Page activity card.** The compact-card contract is documented at `src/chat/ChatPageAutomation.js:112-114`, but `chat.js:1903-1958` still appends generic tool messages. Code evidence: one page action produces both activity-card updates and generic system-message children. Owner: `chat.js`, `src/chat/ChatPageAutomation.js`. Smallest safe fix: use one coherent Act activity representation. Acceptance: long runs do not evict useful transcript nodes because of duplicate traces.
- **[Label: confirmed] Abort and error leave stale assistant bubbles.** `chat.js:2024-2053` appends a separate terminal system message and clears stream references; `src/chat/ChatStream.js:227-234` clears references, not the DOM node. Code evidence: the owned abort/error branches do not call the existing terminal-bubble finalizer used by the stranded-run branch at `chat.js:1724-1753`. Owner: `chat.js`, `src/chat/ChatStream.js`. Smallest safe fix: share that terminal-bubble finalizer across complete, abort, and error. Acceptance: every terminal state visibly settles the original bubble.
- **[Label: confirmed] Act clarification, manual Resume, and approval controls settle before acknowledgement.** `src/chat/ChatPageAutomation.js:188-191` disables clarification controls before sending; `:256-273` settles manual Resume before checking the response; approval controls disable immediately at `:414-423`. Code evidence: failed clarification delivery has no catch/re-enable path, and failed manual Resume only changes `data-decision`. Owner: `src/chat/ChatPageAutomation.js`, `chat.js`. Smallest safe fix: settle after acknowledgement and preserve a retryable error state. Acceptance: transport failure never strands a disabled card.
- **[Label: confirmed] Approval dialogs lack explicit modal focus semantics.** `src/chat/ChatPageAutomation.js:223-224` and `:359-360` set `role=alertdialog`/`aria-live` but not `aria-modal`, and only clarification input at `:196` receives focus. Code evidence: approval/manual-intervention creation does not focus a dialog control or define modal semantics. Owner: `src/chat/ChatPageAutomation.js`, `chat.js`. Smallest safe fix: move focus into the dialog, expose modal semantics, and restore focus after settlement. Acceptance: approval is operable without pointer use.

- **[Label: reproduced] The default browser evaluation timeout is too tight for the current credential-free gate.** `playwright.config.cjs:6` sets a 90-second test timeout; the full run produced 35/36 passing with `tests/browser/page-action-evaluation.spec.js` timing out, while the same test passed 1/1 with `--timeout=180000` in about 1.1 minutes and printed all nine records. Owner: `playwright.config.cjs`, `tests/browser/page-action-evaluation.spec.js`. Smallest safe fix: split the matrix or set a test-specific timeout based on measured runtime, while preserving bounded cleanup. Acceptance: the default browser command passes repeatedly without masking genuine hangs.

### P3 — No additional low-impact backlog item retained

Lower-value visual preferences were excluded. The remaining work is covered by the P1/P2 acceptance checks above.

### Verification notes and durable command log

- `npm run test` — **95/95 passed**.
- `npm run test:behavior` — **44 files, 534/534 tests passed**.
- `npm run lint` — passed.
- `npm run format:check` — passed.
- `npm run smoke` — passed.
- `npm run audit` — passed; npm audit reported **0 vulnerabilities**.
- `npx playwright test tests/browser` — **36/36 passed** with the evaluation test's measured 180-second timeout.
- `npx playwright test tests/browser/page-action-evaluation.spec.js --timeout=180000 --workers=1` — **1/1 passed** in about 1.1 minutes; console output recorded all nine bounded evaluation records. The timeout is now scoped in `tests/browser/page-action-evaluation.spec.js`.
- `npx prettier --check REVIEW_PLAN.md` and `git diff --check` — passed.
- The first browser timeout is retained as a test-gate reliability finding, not silently discarded. The isolated rerun demonstrates the case completes under a larger budget.
- No live provider completion stream was exercised. The unresolved-goal finalization item is therefore labeled **risk requiring reproduction** for end-to-end confirmation, while the unconditional source path is confirmed.
- No signed-in external page was mutated. `dist/` and `Prompt-Paul-6.2.1.zip` contain `moveMessageToEnd`, so simple stale-package mismatch is not the explanation for the ordering symptom.
- Pre-existing user changes remain untouched: `CHANGELOG.md`, `manifest.json`, `package.json`, and `package-lock.json`. The review artifact is `REVIEW_PLAN.md`; implementation changes are limited to backlog owners and regression coverage.
