# Acceptance Sprint Report

Day-5 verification and documentation closeout for the multi-agent sprint on Prompt Paul,
followed by a residual-fix workflow that closed the browser suite to green.
Companion docs: [UX_JOURNEYS.md](UX_JOURNEYS.md), [ARCHITECTURE.md](ARCHITECTURE.md),
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

## Verification gates (actual output)

| Gate               | Command                                   | Result                                                  |
| ------------------ | ----------------------------------------- | ------------------------------------------------------- |
| Structural         | `npm run test` (`scripts/test-runner.js`) | **PASS** — 99/99                                        |
| Behavior           | `npm run test:behavior` (`vitest run`)    | **PASS** — 669/669                                      |
| Build (prod)       | `node scripts/build.js --prod`            | **PASS** — `dist/build-metadata.json` generated         |
| Full validate      | `npm run validate`                        | **PASS** — exit 0 (lint + format + test + behavior + smoke + verify:licenses) |
| Production browser | `node scripts/test-browser-prod.js`       | **PASS** — 46/46 (headed, deterministic)                |

## Six Day-1 acceptance journeys

Scripted in `tests/browser/acceptance-journeys.spec.js`; fixtures in
`tests/browser/fixtures/` (`article.html`, `notes.md`, `tables.html`, `plan-a.html`, `plan-b.html`).

| #   | Journey                                        | Status |
| --- | ---------------------------------------------- | ------ |
| 1   | Summarize an article with attached context     | PASS   |
| 2   | Rewrite selected text, retaining surroundings  | PASS   |
| 3   | Follow up on an attached document (`notes.md`) | PASS   |
| 4   | Filter a table, report matching rows           | PASS   |
| 5   | Fill a harmless form under approval            | PASS   |
| 6   | Compare two pages opened explicitly            | PASS   |

## Residual-fix workflow (closed 7/7 browser failures)

After the sprint, the headed browser gate was 39/46 with 7 deterministic failures. A second
workflow diagnosed and fixed them. All 7 traced to a single product bug plus one spec bug:

**Product bug (root cause of 6 failures, incl. the 2 "pre-existing" chat-actions ones):**
`ChatComposer.renderQuickActions` unconditionally appended `makeActIndicator(state)`, which returns
`null` when the session Act permission is off (every fresh panel). The `TypeError` escaped
`initComposer()` and aborted the `chat.js` `DOMContentLoaded` handler, so everything wired after it
was silently dead — the document `drop` listener (acceptance 3), the run-reconnect card, the
checkpoint-resume card (`[data-run-recovery]`), and the selected-text strip handlers (chat-actions).
**Fix:** null-guard the append in `ChatComposer.js` (one line) + a unit regression test in
`tests/chatComposer.test.js`.

**Spec bug (acceptances 4 & 5):** the spec's `approvedInput` helper awaited the `executeTool`
evaluate, but the harness channel blocks until the tool completes and the tool was blocked inside
the approval gate — a deadlock against the 60s confirmation timeout → `PAGE_ACTION_DENIED`.
The product approval/receipt machinery was correct (proven by `page-actions.spec.js`).
**Fix:** restructured `approvedInput` in `tests/browser/acceptance-journeys.spec.js` to fire
`executeTool` without awaiting, poll `getConfirmation`, resolve the approval, then await the settled
result and assert the `delivered_verified` receipt. Assertion intent kept (real page state:
`#filter-status` "Showing 3 of 8 books matching "fantasy"." = 3 visible rows; `#body` = approved text).

## Classification

- **Not environmental**: the headed browser, Playwright Chromium, and installed Chrome all work.
- All 7 are resolved; the full suite is **46/46**. No residual browser failures remain.

## Changes made (sprint + residual-fix)

- **Code fixes**: `src/chat/ChatComposer.js` (null-guard the Act-indicator append; fixes the
  `TypeError` that aborted `DOMContentLoaded` and the recovery/selection/drop wiring).
- **Spec fix**: `tests/browser/acceptance-journeys.spec.js` (`approvedInput` deadlock).
- **Tests**: `tests/chatComposer.test.js` (+1 regression: `refresh()` survives Act-disabled).
- **Surgical**: added `"plans/"` to `.eslintrc.json` ignorePatterns (transient git-ignored workflow
  draft); prettier trailing-blank-line cleanup in root `AGENTS.md`.
- **Docs / DOX**: root `AGENTS.md` (composer starter actions, four-axes decision rule,
  `page_task_progress` event contract), `src/chat/AGENTS.md` and `src/orchestrator/AGENTS.md`
  (progress card, gated Act Retry, planner auto-approval, budgets), `tests/browser/AGENTS.md`
  (acceptance-journeys spec + fixtures), `tests/AGENTS.md` (`acceptance-journeys.spec.js` and
  `page_task_progress` coverage), `docs/ARCHITECTURE.md` (`page_task_progress` event +
  progress-card/outcome/recovery, composer starters), `docs/UX_JOURNEYS.md` (six acceptance
  journeys), `docs/PRODUCTION_READINESS.md` (Act performance defaults, ephemeral screenshots,
  bounded Act lease permission wording).
- **Report**: this file.

## Release-candidate state

- All gates green: structural 99/99, behavior 669/669, build + full validate PASS, production
  browser **46/46**. The extension is fully browser-verified on the scripted credential-free suite.
- Remaining open item (not a regression): the planner auto-approval contract wording vs enforcement —
  `RunOrchestrator.js` enforces auto-approval for **LOW and MEDIUM** non-navigation actions, while
  the docs/notice say "low-risk" only. Decision required: tighten enforcement to LOW-only (permission
  reduction) or change wording to "low- and medium-risk". Untouched pending the owner's call.
