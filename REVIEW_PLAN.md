# Prompt Paul review and TODO — overall health, with an Act focus

Reviewed: 2026-09-27. Baseline: commit `e46e7c9`, version 6.3.0. Status: **draft for owner review**.
Goal set by the owner: **an overall improvement, and a substantial improvement to Act**.

## 2026-10-02 Act evaluation and planner correction

Evaluated task completion and recovery using the existing sibling repository `prompt-paul-agent-eval`. The user's instruction to proceed authorized reuse of its fixtures and outcome grading. Existing local changes in that repository were preserved.

INTENT: a lookup for “Guardians of the Galaxy Vol. 3” activated the multi-goal planner because punctuation splitting invented a second goal, “3 the movie”. The regression requires title/name abbreviations, initials, decimal values, and URLs to remain within their lookup clause, while genuine action sentences still split.

Reproduced before fixing: the planner regression failed on the invented goal. The source correction is confined to `splitInstructionIntoClauses` in `src/orchestrator/ActPlanner.js`; six lookup variants and two genuine action sequences now pass. TWINS: planner activation and initial goal generation share this function, so both use the correction.

Real-model evidence through the extension's eval-only entry point: `mistral-small-latest`, one local release-date task, three repetitions per artifact. Calibrated baseline **0/3**, candidate **3/3**. The baseline was frozen before changing source. One cancelled baseline timeout was preserved separately and its missing repetition retried; the timeout is not hidden in the scored denominator. Scored baseline trials required 9, 9, and 14 recorded model calls; candidate trials required two each.

The external harness now distinguishes bookkeeping, navigation, and mutation; verifies a page observation and independent fixture state; rejects explicit incomplete-planner outcomes; bounds/cancels cases; preserves repetitions and configuration fingerprints; separates infrastructure errors; and supports resuming missing trials and regrading saved traces. The release-date grader no longer requires an attribution phrase absent from the request. Both immutable raw runs were graded with the same calibrated checks, preserving original grades.

Audit limits: nine existing fixtures display preset facts; the shopping-list, BBC causes, and dictionary-definition mappings have prompt/oracle gaps. Mock results are plumbing evidence. The one selected lookup is a regression check, not a general success estimate or deploy decision; serving identity, stop reasons, complete timeout usage, and billed cost remain unavailable. No signed-in site, real mutation, or Hermes/Codex comparison was performed.

Verification: full `npm run validate` passed (100 structural checks, 772 behavior tests, lint, formatting, smoke, and licenses). All 46 focused Act/approval browser tests passed. Of the remaining 37 cases, 35 passed initially and the Options profile-switch timeout passed on retry: 82/83 unique browser cases passed. The notch width check at `tests/browser/notch.spec.js:183` remains failing (6.347 px initially, 4.203 px on retry, 4 px tolerance); its source and tests were untouched. The full browser gate is not green. The external harness passed 14 unit tests, its dry-run browser smoke test, and pinned-corpus verification (590 records). The production build passed and excludes diagnostics/evaluation implementations.

Manual UI coverage remains unavailable: the agent-browser launcher lacks its native executable, and the supplied browser UI runtime failed to start. Headed browser regressions and the model-backed extension runs provide automated coverage.

Inspect the [local report](artifacts/act-eval/report.md) for the actual input, all six outputs, atomic grading, wall times, measured token counts, raw traces, comparison artifact, and reproduction commands. These artifacts are local and ignored by Git. No commit, push, or deployment was performed.

## 2026-10-01 blocker review

- [x] Remove the obsolete V10 dependency; use the active global instructions and repository contracts.
- [x] Run baseline validation: 100 structural checks, 762 behavior tests, and 82 browser tests passed.
- [x] Reproduce the highest-impact lifecycle defect: an acknowledged Act run lost its pending clarification after 40 seconds without worker inspection or runtime messages. The journal remained non-terminal, but `getRunJournal` returned `active: false`.
- [x] Protect executing runs from idle worker shutdown and add regression coverage.
- [x] Verify the original browser reproduction, validation, browser coverage, and production build.

Scope: `RunOrchestrator`, one worker-lifetime helper, focused unit/browser tests, structural module validation, and the related contracts and architecture notes.

INTENT: code loses a pending Act question during worker idle shutdown; the regression expects the question to remain answerable; the run contract says an acknowledged run continues through user decisions and ordered terminal events.

The shared `execute()` boundary now owns a 20-second local extension API heartbeat through `ServiceWorkerKeepAlive.js`. Nested turns share it, concurrent runs release it independently, and completion, error, and Stop clear it in `finally`. No heartbeat starts for an unexecuted run. Run budgets, decision timeouts, approval policy, credentials, and storage keys stay unchanged. This follows [Chrome's guidance for long-running operations](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#keep_a_service_worker_alive_until_a_long-running_operation_is_finished).

Regression evidence: three focused tests failed before the fix because no worker heartbeat was issued. All nine lifetime behavior cases pass after the fix. The real-browser test uses no worker debugger, answers the same question after 40 quiet seconds, receives one completion, and observes normal worker shutdown after completion. Ordinary Playwright worker attachment can hide this defect.

TWINS: searched detached execute calls - found 1 other site: `src/utils/evalHook.eval.js`, covered by the shared fix.

Final validation passed: lint, formatting, 100 structural checks, 771 behavior tests, smoke, vendored licenses, and all 83 browser tests. The same lifecycle test also passed against the staged production build. The first production test could not load its harness because staging used the source path; it passed after setting the correct `PROMPT_PAUL_LOAD_EXTENSION_DIR=dist` for both staging and testing. The production build includes the lifetime helper and excludes diagnostics/evaluation implementations. Its Git revision and dirty-tree metadata were verified after building outside the sandbox; the sandboxed build could not read Git metadata. The final production build removes the staged test harness. No live-provider request was needed. Manual side-panel interaction was unavailable because this session exposed no browser UI surface.

Temporary reproduction scripts and the disposable probe profiles were removed. The permanent unit/browser regressions remain in `tests/`.

The previous punchlist (27 items, all marked resolved) is preserved in git: `git show e46e7c9:REVIEW_PLAN.md`. Its two unverified residuals are carried over as GEN-06.

## How to read this

- **Reproduced:** observed by a probe or test against the current code. Probes used stubbed executors in Node, not a live page.
- **Source-confirmed:** the current code establishes the issue; the full browser flow was not run.
- **Recommendation:** an improvement or design change, not a proven defect.
- **Decision:** needs an owner decision because it changes a documented contract.
- **P1:** fix first — Act acts on the wrong thing, stops the run, or weakens a safety gate. **P2:** the substantial Act upgrade and real reliability gaps. **P3:** cleanup, docs, and measured efficiency work.
- Effort: **S** narrow change, **M** several related paths, **L** cross-cutting. Not time estimates.
- Removal/simplification items use the labels `delete:`, `shrink:`, `yagni:`.

## Baseline checks (this review)

| Check                            | Result                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                   | 0 errors, 7 warnings (unused parameters in `tests/runOrchestrator.test.js` and `tests/runResilience.test.js`)                                                                   |
| `npm run format:check`           | **Fails locally** on `marked.min.js` only: the working copy is CRLF while the index is LF (`git ls-files --eol` → `i/lf w/crlf`). An LF copy passes. See GEN-01.                |
| `npm run validate`               | Stops at the format check above. The remaining gates were run individually.                                                                                                     |
| `npm run test` (structural)      | 98/98 passed                                                                                                                                                                    |
| `npm run test:behavior` (Vitest) | 746/746 passed across 56 files                                                                                                                                                  |
| `npm run smoke`                  | Passed                                                                                                                                                                          |
| `npm run verify:licenses`        | Passed                                                                                                                                                                          |
| Browser suite                    | **Not run** in this review (`npm run test:browser:prod` needs a headed browser)                                                                                                 |
| Direct probes                    | Reproduced ACT-01, ACT-02, ACT-03, ACT-15 and the planner activation part of ACT-27 with Node scripts against `pageActionPolicy.js`, `ActPlanner.js`, and `RunOrchestrator.js`. |

## Assessment

**What to keep.** The safety scaffolding around Act is strong and well tested: forced first inspection, stale-snapshot checks, delivery receipts, the pre-dispatch occlusion gate, sensitive-control masking, separate budgets, restart checkpoints with explicit Resume, bounded journals, and a large behavior suite. The items below build on these controls; none of them removes one.

**What holds Act back.** Most failures a user would see fall into four groups:

1. **Guards that misfire on normal work.** A display-only step title can reject a valid action (ACT-01). Three rejected or denied tool turns stop the whole run with a raw error (ACT-02). The no-progress guard counts visible page changes as "no change" (ACT-03). The risk classifier matches substrings, so "Postal code" is high risk (ACT-15).
2. **Target identity is weaker than the approval card implies.** The orchestrator evaluates policy on one indexed element, and in some cases the page acts on a different one (ACT-04, ACT-05).
3. **The page model is narrow.** Act cannot see shadow DOM or iframes, cannot press Enter or Escape, cannot operate custom dropdowns or ARIA menus/tabs, and searches only the first 16,000 characters of a page (ACT-09, ACT-20 to ACT-24).
4. **No task-level measurement.** The corpus tests the executor with scripted actions. No model-driven success rate exists, and the WebVoyager baseline was never recorded. Improvements cannot be shown to help until ACT-30 exists.

## Browser-use roadmap execution (2026-10-04)

- Branch: `feat/act-browser-use-roadmap`; starting revision: `afb0ed5` (clean).
- Scope requested: the full five-phase roadmap, with baseline preparation first; no commit or push. The complete implementation source is the local, untracked `plans/act-browser-use-roadmap.md`. Its saved contents close the previously missing sections; older drafts are not implementation sources.
- Model-driven baseline: **not recorded**. `npm run benchmark:act -- --run` stopped before browser/model execution because `PROMPT_PAUL_BENCHMARK_API_KEY` is absent. Use scripted corpus and browser gates until credentials are available. No model pass rate, steps, tokens, or snapshot-byte comparison is claimed.
- Phase 0 automated gate **passed**: ten new local benchmark interaction cases, outcome graders, and oracle/null checks. Validation passed (100 structural checks, 778 behavior tests), all 86 browser cases passed, and the production build passed. The background-tab benchmark uses real visibility rather than Playwright's focus emulation. Manual Chrome journeys remain pending; the local browser launcher is now repaired.
- Phase 1 **passed** its automated and manual delivery gates (90 browser tests, 100 structural checks, 791 behavior tests, production build, three Chrome journeys). Phase 2 **passed** its automated and manual delivery gates (98 browser tests, 100 structural checks, 801 behavior tests, production build, three Chrome journeys). Phase 3 **passed delivery gates**: validation (100 structural checks, 796 behavior tests), all 105 browser tests, production build, and real production-unpacked Chrome read, approved Notes edit/read-back, and owned-tab journeys through a local simulated provider. The browser journey artifact is `artifacts/act-roadmap/phase3-manual-journeys-fresh.log`; the latest UI label regression has separate red/green Playwright evidence. This is not model-performance evidence. Phases 4–5 have not started.

| New item | Phase | Requirement                                          | Status               |
| -------- | ----- | ---------------------------------------------------- | -------------------- |
| ACT-45   | 1     | Hidden-tab settlement                                | Phase 1 gates passed |
| ACT-46   | 1     | Adaptive settlement on action-triggered busy signals | Phase 1 gates passed |
| ACT-47   | 2     | Viewport-anchored outline                            | Phase 2 gates passed |
| ACT-48   | 2     | Bounded non-sensitive field values                   | Phase 2 gates passed |
| ACT-49   | 2     | Set-value and append input                           | Phase 2 gates passed |
| ACT-50   | 2     | Element-scoped scroll                                | Phase 2 gates passed |
| ACT-51   | 3     | Structured Act terminal outcome                      | Phase 3 gates passed |
| ACT-52   | 3     | Per-site trust/block policies                        | Phase 3 gates passed |
| ACT-53   | 4     | Opt-in allow-listed CDP input with DOM fallback      | Pending              |
| ACT-54   | 4     | Group run-created tabs without added permissions     | Pending              |

### ACT-45 — Hidden-tab settlement

- [x] Complete automated verification and record results.

Reproduced against the unchanged runtime: the browser asserted `document.visibilityState === 'hidden'`, then input failed with `HIDDEN_SETTLE_TIMEOUT` after five seconds. The DOM mutation was delivered, but the double animation-frame wait never returned. The focused unit reproduction also failed for hidden documents and visibility changes between frames.

Settlement now uses a timer when hidden, observes visibility changes during the frame wait, and applies the existing one-second deadline to the entire wait. Visible quiet pages retain two animation frames. Completion clears the observer, quiet/deadline/hidden timers, pending frames, and visibility listener. The browser regression checks a verified input receipt, hidden-tab scroll completion, and a fresh inspection without bridge quarantine.

Verification: `npm run validate` passed (100 structural checks, 776 behavior tests, lint, formatting, smoke, and licenses). The four settlement unit cases also pass with timing assertions that require the hidden-tab path to finish before the deadline. `npm run test:browser` passed all 84 cases, including the scripted evaluation corpus, the hidden-tab regression, and normal worker shutdown without a worker debugger. The known notch failure did not reproduce in this run. `npm run build` passed; production metadata records starting revision `afb0ed5`, the feature branch, and the dirty working tree, with diagnostics/eval hooks excluded. Final changed-file formatting and whitespace checks passed.

The earlier manual-check blocker is resolved. A fresh production unpacked build was loaded into disposable Chrome and exercised through the visible chat UI with a local scripted provider: read the hidden-tab fixture, approve the Notes edit and inspect its actual value, then open and inspect the pointer-controls fixture in a run-owned tab. All three delivery journeys completed. At this phase boundary the final progress card incorrectly reported unfinished steps; Phase 3 fixed this with runtime-derived terminal outcomes and explicit simple-task wording. Phase 2's Chrome exercise was delivery/UI verification, not a model-driven benchmark. No commit or push was performed.

Phase 1 validation passed with 100 structural checks and 791 behavior tests; the production build passed. Original/compact snapshot bytes measured on real fixtures were 2,489/1,281 (form), 2,977/1,710 (Gmail-like), and 2,789/1,503 (pointer controls), a combined 45.6% reduction. A full browser attempt passed 89/90 with an unchanged notch reasoning assertion failing; its targeted rerun passed. The obsolete Resume named-tool-choice assertion was updated to verify the fresh synthetic pair. The final full browser rerun passed all 90 tests after synchronizing the initial-observation fixture with the install-time starter-profile write. Validation briefly failed because Chrome installed extension files into the temporary profile inside the lint tree; moving that profile under the ignored dependency cache restored the full validation gate.

### Phase 2 — Observation model (gates passed)

All nine new unit regressions and eight real-browser regressions failed against Phase 1, reproducing each observation/action gap. The new cases now pass in focused browser testing. ACT-47 adds a viewport outline with modal-first context; ACT-25 keeps node IDs through insertion/reinspection and rejects removed nodes; ACT-48 discloses bounded safe values and compares them in metadata-only diffs; ACT-49 adds native scalar setters and append; ACT-23 traverses open roots for controls/text/occlusion; ACT-22 scopes exact custom option selection; ACT-50 scrolls indexed/focused/modal containers; ACT-28 checks declared postconditions and additional click evidence. The previous validation passed (100 structural checks, 800 behavior tests) and the production build passed. The full browser attempt passed 91/98; seven outdated outline/injection/focus assertions were corrected, then passed 7/7 in a focused rerun. This was not a green full-suite gate. Snapshot full/compact bytes were 2,410/1,332 (form), 2,769/1,655 (Gmail-like), and 2,612/1,486 (pointer controls).

The focused-value boundary regression failed before the correction: a separately normalized focused record disclosed `beyond-shared-budget` after the 8K element allowance was exhausted. Focused and submit-control metadata are now value-free in the classic runtime and normalizer; bounded control values stay available in the outline. Final verification passed: 31 focused behavior cases, `npm run validate` (100 structural checks, 801 behavior tests, lint, formatting, smoke, licenses), all 98 `npm run test:browser` cases, and `npm run build`. Logs are in `artifacts/act-roadmap/phase2-{validate,browser,build}.log`; the value regression red/green logs are in the same directory. The final browser run measured the same full/compact bytes listed above after the correction.

The handoff's task-owned helpers had stopped. New disposable helpers loaded the final production build into Chrome; agent-browser connected successfully after explicitly opening a tab (its initial listing omitted existing extension pages, not a connection failure). All three visible UI journeys passed with the local scripted provider: read the current fixture, approve the Notes edit and read back `Manual fixture note` from the actual field, then open and inspect the pointer-controls fixture in an owned tab. Screenshots are `phase2-read.png`, `phase2-form-{approval,complete}.png` and `phase2-multitab-complete.png` in `artifacts/act-roadmap/`. No page errors were reported. The multi-tab wait initially followed the newly active owned tab; returning to chat confirmed completion. The existing incorrect unfinished-steps outcome remains assigned to Phase 3 (ACT-27/ACT-51), not silently accepted as accurate progress. These journeys prove delivery and rendering only. Model-driven A/B remains **not recorded** because the benchmark key is absent. No commit, push or deployment occurred.

### Phase 3 — Agent loop and approvals (gates passed)

ACT-27 replaces regex decomposition and keyword-driven note advancement with `page_update_plan`: twelve 200-character steps, one active unresolved step, five revisions, atomic validation and fresh evidence for completion. Notes retain finite multi-item quotas but never advance steps or grant consent. One-item/unquantified reading, durations and model-version numbers no longer invent unfinished quota work. All twelve short step descriptions survive checkpoints; explicit Resume normalizes legacy statuses and performs fresh inspection.

ACT-51 carries normalized runtime `actOutcome` through final/progress/journal/eval records, including when the trace step cap is full. Declines persist across reinspection, timeout reports `needs_confirmation`, skipped work does not report done, and sign-in/CAPTCHA reasons use observed signals rather than model explanations. Benchmark summaries use ACT_* codes and reject blocked/failed success claims independently of answer prose.

ACT-07 makes high risk always confirm after run/global/site trust and renames the button to **Approve similar actions this run**. ACT-52 implements background-owned serialized origin policies, backups/pinned keys, live-card site saving, Options list/block/remove and run-start snapshots. Source, requested, landed and recovery dispatch origins are gated before extraction; blocked runs clear observations and withhold tools. Site saving is bound to the authenticated unexpired card and unchanged live origin; failed persistence never approves. Stop cannot create a late approval after awaited policy checks. Expired cards remain disabled after late transport failure; malformed stored policy maps render an error, not false trust.

ACT-29 records advertised API tool support, preserves endpoint/model-bound metadata and warns on all enable paths for unsupported/unknown models without generation. The warning directs users to Options; no specific model quality is recommended without model-driven evidence.

Red reproductions are preserved under `artifacts/act-roadmap/phase3-*-red.log`, including planner/high-risk/site/model, redirect extraction, checkpoint/outcome/eval boundaries, expired-card transport, malformed settings, quota false positives and simple-task progress wording. Final gates passed after contract/documentation alignment: `npm run validate` (100 structural checks, 796 behavior tests, lint, format, smoke, licenses), `npm run test:browser` (105/105), and `npm run build` (production diagnostics/eval hooks excluded). A first browser attempt was affected by an active task-owned manual Chrome process and one transient Notch width assertion; after stopping only that identified process, a full rerun passed 104/104. After the final progress-label regression/fix, validation and build passed again and the complete browser suite passed 105/105. The real production-unpacked Chrome read, approved field edit/read-back, and owned-tab inspection passed with the local deterministic provider; the terminal journal recorded `{status: done, reason: null}`. The provider is simulated and proves delivery only. `PROMPT_PAUL_BENCHMARK_API_KEY` is absent, so model A/B is **not recorded**. Persistent site trust requires human security review before production; no production/release action occurred.

## TODO index

### ACT-46 — Adaptive settlement

The failing unit and browser reproductions returned before a 1.4-second action-triggered busy result. Settlement now captures pre-action busy controls, ignores existing spinners, observes newly busy controls and resource entries during the quiet window, and extends only those waits to a three-second overall deadline. Quiet pages retain the 100 ms / one-second path. Results include `settle: {waitedMs, reason}`; all DOM/resource observers, timers, frames and visibility listeners are released. The adaptive browser case and hidden-tab regression passed together. Phase 1 validation, all 90 browser tests, production build and the three Chrome delivery journeys passed; see the phase record above.

### ACT-26 / ACT-40 — Initial observation and compact results (Phase 1 passed)

Non-Hermes runs now execute `page_get_state` before their first provider request and add a synthetic matching call/result pair. Compact model results retain the identity envelope, formatted controls, readable text, notices, receipts and diffs, while duplicate elements/regions, metrics and fingerprints remain internal. Provider-adapter/history-compaction checks, byte measurements, all 90 browser tests and manual acceptance passed; see the Phase 1 evidence above.

### ACT-21 / ACT-44 / double-click — Pointer controls (Phase 1 passed)

The browser reproduction omitted searchbox/spinbutton/slider roles and the label-backed invisible checkbox. Collection now includes those roles and visible label proxies for hidden checkbox/radio controls; own labels pass the occlusion gate. Double-click accepts only counts 1 or 2, and indexed hover returns a fresh snapshot with observation budgeting. Owned-tab back navigation checks readiness and clears stale state. Focused checks and Phase 1 automated/manual gates passed; see the phase record above.

### ACT-20 — Keyboard and submit (Phase 1 passed)

Keyboard validation is allow-listed. Indexed and focused targets share current snapshot/key checks; focused identity is revalidated before delivery. Form submit metadata is bounded, normalized, and incorporated into target fingerprints so a changed submit control invalidates approval. Enter and `page_input.submit` classify the submit control; sensitive controls remain blocked. DOM key delivery and form submission passed browser acceptance, conservative-receipt tests and the Phase 1 gates.

### ACT-41 — Act prompt checklist (Phase 1 passed)

The Act instructions now use an eight-step checklist covering inspection, safety, observation tools, receipts, outcome verification, tabs, continued work and recovery. Tool descriptions share the system safety policy instead of repeating it. Navigation wording distinguishes observed links from unrequested model-entered destinations, and the list includes notes, keyboard, hover and back navigation. Provider/browser checks and Phase 1 automated/manual gates passed. Model effectiveness remains unmeasured.

Suggested order: GEN-01 → ACT-30 → P1 → P2 capability → P3. See [Sequencing](#sequencing).

**P1 — fix first**

- [x] ACT-01 Step `title` validation rejects valid actions (Reproduced · S)
- [x] ACT-02 Three failing tool turns stop an Act run; user denials count as failures (Reproduced · S)
- [x] ACT-03 No-progress guard blocks clicks that visibly changed the page (Reproduced · S)
- [x] ACT-04 Approval/policy can evaluate a different element than the page acts on (Source-confirmed · M)
- [x] ACT-05 Re-render rebinding picks the first identical control (wrong list row) (Source-confirmed · S)
- [ ] ACT-06 Screenshots are captured on every inspection although the release gate discards them (Source-confirmed · S)
- [x] ACT-07 "Approve all this session" also skips high-risk confirmations (Recommendation · Decision · S; Phase 3 gates passed)
- [x] ACT-08 Model-typed URLs open cross-origin without confirmation (Recommendation · Decision · S)

**P2 — reliability defects**

- [x] ACT-45 Hidden-tab settlement and visibility changes during frame waits (Reproduced · S; Phase 1 automated/manual gates passed)
- [x] ACT-09 `page_find_text` / `page_wait` see only the first 16,000 characters (Source-confirmed · S)
- [x] ACT-10 Batches/waits can exceed the fixed 15 s bridge timeout and quarantine a healthy tab (Source-confirmed · S)
- [x] ACT-11 `page_scroll.containerIndex` indexes a different list than the snapshot shows (Source-confirmed · S)
- [x] ACT-12 The 5 s snapshot cache can return a stale page (Source-confirmed · S) → delete `ActActionCache.js` (RM-01)
- [ ] ACT-13 Approval cards do not show the text that will be typed (Source-confirmed · S)
- [ ] ACT-14 Approval cards auto-deny after 60 s (Source-confirmed · S)
- [x] ACT-15 Risk and navigation classification uses substring matching (Reproduced · M)

**P2 — the substantial Act upgrade**

- [ ] ACT-30 Model-driven local Act benchmark — **do this before the capability work** (Recommendation · M)
- [x] ACT-20 Keyboard actions and form submit (Enter, Escape, Tab, arrows) (Recommendation · M)
- [x] ACT-21 Broader control discovery: ARIA roles, labels for hidden inputs, own-label occlusion (Recommendation · M)
- [x] ACT-22 Custom dropdowns and comboboxes (ARIA listbox/option) (Recommendation · M)
- [x] ACT-23 Open shadow DOM traversal (Recommendation · M)
- [ ] ACT-24 Iframes: same-origin first, then cross-origin frames (Recommendation · L)
- [x] ACT-25 Stable element IDs within a document (Recommendation · M)
- [x] ACT-26 Deterministic first observation instead of a forced named tool choice (Recommendation · S)
- [x] ACT-27 Replace the regex planner with a model-maintained checklist (Reproduced in part · M; Phase 3 gates passed)
- [x] ACT-28 Declared postconditions and richer click evidence (Recommendation · M)
- [x] ACT-29 Warn when the selected model cannot call tools (Recommendation · S; Phase 3 gates passed)
- [x] ACT-41 Rewrite the Act prompt: stale screenshot text, contradictions, missing `page_record_note` (Source-confirmed · S)

**P3 — efficiency, removals, overall**

- [x] ACT-40 One compact model-facing snapshot format (drop the duplicate element list and unused fields) (Source-confirmed · S)
- [ ] ACT-42 Measure, then reduce snapshot build cost (Recommendation · M)
- [ ] ACT-43 Measure, then reduce per-action bridge round trips (Recommendation · S)
- [x] ACT-44 `page_hover` and `page_go_back` (Recommendation · S)
- [x] RM-01 `delete:` `ActActionCache.js` (S)
- [x] RM-02 `delete:` dead Act code paths and stale comments (S)
- [x] RM-03 `shrink:` collapse the always-true `multiTabEnabled` flag (S)
- [x] RM-04 `yagni:` decide the dormant screenshot/vision path — shipped by deletion (Decision · S/M)
- [x] RM-05 `delete:` the production MAIN-world no-op content script (S)
- [ ] RM-06 `shrink:` source-text guards in `scripts/test-runner.js` (M)
- [ ] RM-07 `shrink:` archive dated review/report docs (S)
- [x] GEN-01 `npm run validate` passes on this Windows checkout (S)
- [ ] GEN-02 Pin and update imprecisely versioned vendored libraries (S)
- [ ] GEN-03 Extract the page-action runtime from `RunOrchestrator.js`; split the Act content script (L)
- [ ] GEN-04 Documentation drift fixes (S)
- [ ] GEN-05 Measure, then reduce per-page content-script injection (M)
- [ ] GEN-06 Carried-over residuals from the previous punchlist (S)

---

## P1 — Fix first

### ACT-01 — Step `title` validation rejects valid actions

**Reproduced · S · Act/policy**

Evidence: [title pattern](src/utils/pageActionPolicy.js#L75), [early return](src/utils/pageActionPolicy.js#L156). The optional title exists only for the progress card. When it matches `CREDENTIAL_TITLE_PATTERN`, `normalizePageActionArgs` returns invalid and the **action** fails with `PAGE_ACTION_INVALID`. The pattern contains bare `card`, `bank`, `token`, `credit`, and `debit`. A probe rejected `page_click` with the titles "Open the product card", "Move card to Done", "Click Bank Holidays tab", and "Open token list". Trello cards, product cards, and gift cards are normal targets.

- Fix: an invalid title is dropped (treated as absent) and the card falls back to the event-type label. Keep the pattern for display filtering only; never fail the action because of it.
- Acceptance: `page_click` with title "Move card to Done" dispatches; the progress card shows the default label; the existing title tests still reject control characters for display.

### ACT-02 — Three failing tool turns stop an Act run; user denials count as failures

**Reproduced · S · Act/orchestrator**

Evidence: [cap](src/orchestrator/RunOrchestrator.js#L86), [check](src/orchestrator/RunOrchestrator.js#L5243), [failure classification](src/orchestrator/RunOrchestrator.js#L5303). Every tool result with an inner `error` counts toward `MAX_TOOL_CALL_RETRIES = 3`, including `PAGE_ACTION_DENIED`, approval timeout, `PAGE_STATE_STALE`, occlusion, and invalid arguments. On the fourth turn `_finalizeToolCall` throws and the run ends with `Maximum tool call retries exceeded (3).` A probe with three `PAGE_ACTION_INVALID` turns (from ACT-01) reproduced exactly that. A user who denies two actions and then hits one stale snapshot loses the run instead of getting a summary or a question.

- Fix: do not count user decisions (denied, timed out) or not-delivered pre-dispatch outcomes as failures. For Act runs, reaching the cap should switch to the existing toolless wrap-up (`_finishAtRunLimit` / `BUDGET_WRAP_UP_PROMPT`) instead of throwing. Consider counting only repeated identical failures.
- Acceptance: three denials in a row leave the run alive; the model can ask or summarize; the run ends in `complete` with an honest summary, never the raw retry error.
- Verified: denials and `not_delivered` receipts reset/avoid the retry counter; repeated failing tool calls trigger a forced toolless wrap-up. `npx vitest run tests/runOrchestrator.test.js` passes (153 tests), including wrap-up completion and decision/pre-dispatch counter cases.

### ACT-03 — No-progress guard blocks clicks that visibly changed the page

**Reproduced · S · Act/orchestrator + content script**

Evidence: [progress test](src/orchestrator/RunOrchestrator.js#L2511), [click receipt](content_script_unified.js#L2467). `madeProgress` is `result.pageChanged || verified receipt`. The content script never sets `pageChanged` for DOM changes, and every ordinary click returns `delivered_unverified` unless a checkbox toggles or the URL changes. A probe with four clicks, each producing a new page fingerprint, blocked the fourth with `PAGE_ACTION_NO_PROGRESS` ("Three page mutations produced no page change"). Single-page apps (menus, panels, filters, carts) hit this whenever the model does not re-inspect between clicks.

- Fix: treat a fingerprint change between the pre- and post-action snapshots as progress. Also add `changed: true` to the content-script click evidence when the fingerprint changed (see ACT-28 for stronger verification).
- Acceptance: the probe scenario passes; the existing test "blocks a mutation once three different mutations changed nothing" still blocks.

### ACT-04 — Approval/policy can evaluate a different element than the page acts on

**Source-confirmed · M · Act/targeting integrity**

Evidence: [merge across snapshots](src/orchestrator/RunOrchestrator.js#L1860), [resolve](src/orchestrator/RunOrchestrator.js#L1883), [positional indices](content_script_unified.js#L1729), [region slice vs full records](content_script_unified.js#L2027), [target lookup](content_script_unified.js#L2083).

The orchestrator keeps an element map merged by index across snapshots of the same URL, on the stated assumption that "indices are global and stable within a document". The content script does not keep that invariant: every snapshot re-collects controls in the current viewport band and numbers them by position. It also stores **all** records in the session while sending only a region slice (region reads) or a trimmed list (payload cap).

Failure scenario: a full snapshot lists `[12] Help`. The page re-renders (feed update, list insertion). The model reads `region-1` and then calls `page_click(index: 12)` with the new snapshot ID. The orchestrator resolves index 12 from the older merged map ("Help", low risk, no card). The content script clicks `records[12]` of the fresh collection, which may be "Delete". Policy, the approval card, and the receipt then describe a different control from the one that was clicked. The content script still blocks sensitive and disabled targets, but the risk gate (high → confirmation) can be skipped.

- Fix (smallest): each snapshot element carries a short opaque key (hash of fingerprint plus ordinal). The orchestrator sends the key of the element it evaluated. The content script refuses with `PAGE_STATE_STALE` when `records[index]` has a different key. Resolve only indices that the latest snapshot actually sent. ACT-25 (stable IDs) is the longer-term fix.
- Acceptance: a unit and browser test with a region read after a DOM change detects the mismatch and dispatches nothing; the existing region-index tests still pass.
- Implemented: snapshots carry a bounded per-snapshot element key; the orchestrator forwards the key for indexed actions, and the content script rejects a key mismatch before dispatch. Browser regression "refuses a stale merged index after a region snapshot reorders controls" passes in the real-browser suite.

### ACT-05 — Re-render rebinding picks the first identical control

**Source-confirmed · S · Act/targeting integrity**

Evidence: [rebind](content_script_unified.js#L2093). When the indexed node was replaced (virtual-DOM re-render), `getPageActionTarget` re-collects all controls and binds to the **first** one with the same fingerprint. Rows of identical "Delete", "Reply", "Archive", or "Add to cart" buttons share a fingerprint, so the action lands on row 1 instead of row N.

- Fix: rebind only when exactly one candidate matches. With duplicates, match by ordinal among identical fingerprints plus a nearby-text check; otherwise return `PAGE_STATE_STALE`.
- Acceptance: a fixture with five identical row buttons that re-renders before the click acts on the intended row or reports stale; it never acts on row 1 by default.
- Implemented: content-script rebinding now proceeds only when exactly one current control has the old fingerprint; ambiguous duplicates fail closed. Browser regression "returns stale instead of rebinding an identical row action to the first match" passes in the real-browser suite.

### ACT-06 — Screenshots are captured on every inspection although the release gate discards them

**Source-confirmed · S · Act/privacy + latency**

Evidence: [capture on every `page_get_state`](content_script_unified.js#L2377), [PNG capture handler](background.js#L2941), [gate discards](src/orchestrator/RunOrchestrator.js#L426). P1-01 of the previous review disabled Act screenshots at the orchestrator. The content script still requests a full-viewport PNG on every inspection, and the worker still captures it. Visible pixels (including any on-screen payment or secret data) are copied into the worker only to be dropped. Each capture adds latency and message size (up to 750 KB), and `captureVisibleTab` is rate limited, so batches can fail captures. Large PNGs above the 750,000-character limit are dropped anyway.

- Fix: remove the dormant Act screenshot/vision path, index overlay badges, and `visualBoxes`; keep the separate video/content-extraction screenshot path.
- Acceptance: no `captureScreenshot` message is sent during an Act inspection, no screenshot/visual-box fields enter the Act snapshot, and video extraction still retains its screenshot.
- Implemented: the content-script Act snapshot and batch paths no longer capture or return screenshots; the orchestrator vision wrappers and user-facing overlay metadata were removed. The independent `getUnifiedContent` screenshot flow remains unchanged. Browser regression asserts the batch result carries no `screenshot` and no `visualBoxes`. Still unverified: the video/content-extraction screenshot path has no browser coverage, so the retention claim rests on code inspection and unit tests only.

### ACT-07 — "Approve all this session" also skips high-risk confirmations

**Recommendation · Decision · S · Act/safety**

Evidence: [confirmation bypass](src/orchestrator/RunOrchestrator.js#L2293), [flag set](src/orchestrator/RunOrchestrator.js#L3397). One click on "Approve all this session" for a harmless action makes every later policy-allowed action run without a card, including high-risk Send, Delete, Publish, and Submit. Page text is untrusted: prompt-injected content read later in the same run can then trigger those actions silently. This is the documented contract today, so changing it needs an owner decision.

- Recommended fix: approve-all covers low and medium risk only; high risk always confirms. Rename the button to "Approve similar actions this run". Hard blocks stay unchanged.
- Acceptance: after approve-all, a low-risk input runs without a card and a high-risk "Send" still shows one. Update `src/orchestrator/AGENTS.md` and `src/chat/AGENTS.md`.
- Implemented in Phase 3; the risk regression failed before the fix and the browser checklist/Send regression passed. Phase 3 gates passed.

### ACT-08 — Model-typed URLs open cross-origin without confirmation

**Recommendation · Decision · S · Act/safety**

Evidence: [URL normalization keeps the path](src/utils/pageActionPolicy.js#L330), [origin admitted without approval](src/orchestrator/RunOrchestrator.js#L2933). `page_open_tab` accepts any HTTP(S) URL written by the model. Query strings are stripped, but the path is kept. On a private page (mail, CRM), injected text can tell the model to open `https://attacker.example/<private text>`, which leaks data through the request path with no card. Link clicks are lower risk because the page, not the model, chose the destination.

- Recommended fix: require confirmation for `page_open_tab` when the destination origin is not the source origin, is not an `href` seen in a snapshot this run, and does not appear in the user's instruction. Show the full destination on the card.
- Acceptance: an injection fixture that asks for an attacker URL produces a confirmation card; ordinary "open the site I named" requests do not.
- Verified: orchestrator tests confirm an unrequested cross-origin URL is gated before tab dispatch and carries the destination on the card; a hostname present in the user request bypasses the prompt. `npx vitest run tests/runOrchestrator.test.js` passes (153 tests). Browser UI verification remains unavailable because Playwright Chromium is not installed.

---

## P2 — Reliability defects

### ACT-09 — `page_find_text` and `page_wait` see only the first 16,000 characters

**Source-confirmed · S**

Evidence: [readable content cap](content_script_unified.js#L1472), used by [find](content_script_unified.js#L1519) and [wait](content_script_unified.js#L2210). Both tools search the Markdown export of the page cut to 16,000 characters. On long pages the text the user asked about is never found, and `page_wait(text)` never matches content lower on the page. `page_wait` also clones the body and runs Turndown every 250 ms for up to 10 s, which is heavy on large pages.

- Fix: search `document.body.innerText` (or a text-node walker) with a much larger bound, redacting only the returned snippets. Use a cheap text check for `page_wait`.
- Acceptance: a fixture with the target text after 50,000 characters is found; a wait for below-the-fold text succeeds.
- Implemented: `page_find_text` now searches sanitized, control-free body text bounded to 120,000 characters; `page_wait` uses a bounded direct text check instead of repeating Turndown. Browser regression "finds and waits for text beyond the old 16,000-character window" passes in the real-browser suite.

### ACT-10 — Batches and waits can exceed the fixed 15 s bridge timeout

**Source-confirmed · S**

Evidence: [fixed timeout](background.js#L1429), [batch and wait limits](content_script_unified.js#L1250), [timeout is a tab failure](src/orchestrator/RunOrchestrator.js#L100). A `page_batch` may contain up to six `page_wait` steps of 10 s each. The message times out after 15 s, the error is classified as a tab failure, and a healthy tab is quarantined.

- Fix: derive the message timeout from the request (sum of wait timeouts plus a margin, bounded), or cap total batch wait time in the content script.
- Acceptance: a batch with two 10 s waits returns results and no tab is quarantined.
- Implemented: the background bridge timeout now adds the clamped `page_wait` budgets in a batch to the normal 15-second margin, bounded at 75 seconds. Browser regression "allows a page batch with two maximum-duration waits to finish" passes in the real-browser suite.

### ACT-11 — `page_scroll.containerIndex` indexes a different list than the snapshot shows

**Source-confirmed · S**

Evidence: [advertised list](content_script_unified.js#L1912) (vertical **or** horizontal scrollers), [list used by the action](content_script_unified.js#L2401) (vertical only). When a horizontal carousel appears before the intended container, every later index shifts and the wrong element scrolls. Horizontal-only containers can never be scrolled.

- Fix: one shared `collectScrollContainers()` for both the snapshot and the action, with direction flags.
- Acceptance: a fixture with a carousel and a scrollable list scrolls each by its advertised index, in both directions.
- Implemented: snapshot advertisement and `page_scroll` dispatch now use one `collectPageActionScrollContainers()` ordering that includes horizontal and vertical scrollers. Browser regression "scrolls the advertised horizontal and vertical containers by the same indices" passes in the real-browser suite.

### ACT-12 — The 5 s snapshot cache can return a stale page

**Source-confirmed · S** (see RM-01)

Evidence: [cache hit](src/orchestrator/RunOrchestrator.js#L2097), [cache fill](src/orchestrator/RunOrchestrator.js#L2473). A second `page_get_state` within 5 s of the first returns the cached snapshot (`cacheHit: true`) when no mutation happened in between. The usual reason to inspect again is that the page is still loading (search results, async panels), so the model gets the old page exactly when it tries to see the change.

- Fix: remove the cache (RM-01). If a de-duplication is still wanted, allow it only within the same tool turn.
- Acceptance: two inspections 1 s apart on a page that updates in between return different fingerprints.

### ACT-13 — Approval cards do not show the text that will be typed

**Source-confirmed · S · UX/safety**

Evidence: [text removed from the event](src/orchestrator/RunOrchestrator.js#L3377), [card fields](src/chat/ChatPageAutomation.js#L655). For `page_input` the card says "input Message (low)". The user approves typing without seeing the text, which could be wrong or shaped by injected page content. Sensitive fields are already hard blocked, so the text is model-generated, not a page secret.

- Fix: add a bounded `inputPreview` (for example 280 characters) to the live confirmation event for non-sensitive targets and render it on the card. The journal allow-list in `_journalEvent` already excludes unknown fields; keep it excluded.
- Acceptance: the card shows the preview; the session journal does not contain it; sensitive targets never reach the card.
- Implemented: live confirmation events carry at most 280 characters of `page_input` text for non-sensitive controls, and the card renders it with `textContent`; journal allow-listing continues to exclude the field. Unit coverage passes. Still unverified: no browser test asserts the card actually renders the preview text, so the render path is covered by inspection only.

### ACT-14 — Approval cards auto-deny after 60 s

**Source-confirmed · S · UX**

Evidence: [60 s cap](src/orchestrator/RunOrchestrator.js#L3323). The run deadline pauses for up to 10 minutes while a card waits, but the card itself resolves as a denial after 60 s. A user who looks away for a minute gets a "declined" outcome and a planner "do not repeat" nudge they did not choose, and with ACT-02 the timeouts count toward stopping the run.

- Fix: align the card timeout with the 10-minute cap, show the remaining time, and record a timeout as "no answer" rather than a denial (no planner revocation, no "declined" line).
- Acceptance: a card left for 2 minutes can still be approved; a real timeout renders as "no answer".
- Implemented: default confirmation timeout now matches the 10-minute deadline-extension cap; timed-out cards/activity render as no answer, and the planner's declined marker is not set. Unit tests verify a default card can still be approved after two virtual minutes and a configured short timeout is not recorded as a user denial; browser regression "confirmation timeout denies the action without delivery and records the timeout decision" passes in the real-browser suite. Still open: the requested visible countdown is not implemented, and no browser test asserts the "no answer" label is rendered.

### ACT-15 — Risk and navigation classification uses substring matching

**Reproduced · M · UX/approval friction**

Evidence: [risk and navigation patterns](src/utils/pageActionPolicy.js#L78). The patterns have no word boundaries and look at labels only. A probe in **trusted mode** classified "Postal code" (post), "Search posts", "Allowance calculator" (allow), and "Sender filter" (send) as high risk, and "Opening hours" and "Backpacks" (open, back) as navigation. Both classes always ask for confirmation, even in trusted mode and under planner auto-approval. Extra cards train users to click "Approve all", which makes ACT-07 worse.

- Fix: word-boundary matching; use element semantics (`type=submit`, form membership, role, `aria-haspopup`) and action type before label words; typing into a field whose label contains "post" is not publishing.
- Acceptance: a table-driven test with true and false positives (including all probe labels) passes; existing hard blocks are unchanged.

---

## P2 — The substantial Act upgrade

Do ACT-30 first so each item below has a before/after number.

### ACT-30 — Model-driven local Act benchmark

**Recommendation · M · Measurement**

Evidence: the existing corpus drives the executor with scripted actions ([tests/AGENTS.md](tests/AGENTS.md)); [the WebVoyager baseline](docs/ACT_RELIABILITY_BASELINE.md) says "Baseline status: Not recorded".

- Implemented an explicit `npm run benchmark:act -- --run` harness (never in CI) with local fixtures for the listed interaction families. It builds the isolated `dist-eval` extension by default, accepts an optional prebuilt eval extension for A/B runs, and writes bounded metrics under ignored `artifacts/act-benchmark/`.
- The harness refuses to start without `--run` and `PROMPT_PAUL_BENCHMARK_API_KEY`; a local OpenAI-compatible endpoint can be configured to avoid external model traffic. Results exclude prompts, page text, responses, and credentials.
- Coverage: SPA menus, autocomplete combobox, custom radio, custom dropdown, shadow-DOM control, same-origin iframe form, modal dismissal, pagination, infinite scroll, long-page text after 50,000 characters, and duplicate row buttons.
- The baseline score is expected to be **low**: several tasks deliberately exercise capabilities that are still open, so they must fail until those land. Expected to pass today: `spa-menu`, `custom-radio`, `modal-dismissal`, `pagination`, `long-page`, `duplicate-row-buttons`, `infinite-scroll`. Expected to fail until the noted item ships: `autocomplete` and `custom-dropdown` (`role=option` is not collected — ACT-21/ACT-22), `shadow-control` (no open-shadow-root walk — ACT-23), `iframe-form` (`content_script_unified.js` runs with `all_frames: false` — ACT-24 phase 1). A rising score across those capability items is the point of the baseline, not a pass rate today.
- Record per task: success judged from the fixture's **end state** (not the model's claim), steps, tokens, wall time, confirmation/progress-card events, and failure codes. Run each task several times and report the pass rate.
- Acceptance: a deliberately broken build lowers the score; results are stored as local artifacts only. Not yet verified: no live/local model run was authorized in this work, so no task has actually been scored. The harness is otherwise runnable — `npm run benchmark:act -- --run` drives the real extension in a real browser and the executor-regression corpus (`page-action-evaluation.spec.js`) passes there. The harness records confirmation/progress card events, not visible UI rendering, so card presentation remains outside measured coverage.

### ACT-20 — Keyboard actions and form submit

**Recommendation · M**

Evidence: the content script dispatches no keyboard events and never calls `requestSubmit` (searched `content_script_unified.js`). Search boxes without a button, closing dialogs with Escape, moving through autocomplete lists, and chat inputs that send on Enter are not possible today.

- Add `page_press_key` with an allow-list (Enter, Escape, Tab, Shift+Tab, arrows, Backspace) on an indexed element or the focused element, and an optional `submit: true` on `page_input` that uses `form.requestSubmit()` when the field is in a form.
- Policy: Enter/submit is a mutation. Classify it by the form's submit control (high when that control is Send/Delete/Pay). Synthetic key events are untrusted (`isTrusted=false`); prefer `requestSubmit()` and report `delivered_unverified` when nothing observable changes.
- Acceptance: benchmark tasks "search without a button" and "dismiss a modal" pass.

### ACT-21 — Broader control discovery

**Recommendation · M**

Evidence: [selector list](content_script_unified.js#L1691). Missing: `role` = option, menuitem, menuitemcheckbox, menuitemradio, tab, switch, treeitem, searchbox, spinbutton, slider, and `<label>` (which `pageDom.js` lists as a supported tag, but the content script never collects). Inputs hidden with `opacity: 0` behind a styled label are excluded by the visibility check, and visually hidden (`sr-only`) inputs hit-test to their label, so the occlusion gate reports them as covered.

- Collect the ARIA roles above. Offer a label as the click proxy for its hidden input. In the occlusion gate, treat the target's own `<label>` (or an ancestor label) as a valid click target instead of an occluder.
- Keep the 200-element cap and the payload bound; re-check masking for the new roles.
- Acceptance: tabs, menu items, switches, and custom checkboxes in fixtures are listed and clickable.

### ACT-22 — Custom dropdowns and comboboxes

**Recommendation · M**

Evidence: [`page_select` requires a native `<select>`](content_script_unified.js#L2536). Most design systems use ARIA `combobox`/`listbox`/`option`, so `page_select` fails and options are not listed (see ACT-21).

- Extend `page_select` for `role=combobox`/`listbox`: open, find the option by exact text, click it, and verify the displayed value or `aria-selected`.
- Acceptance: benchmark "choose a country in a custom dropdown" passes.

### ACT-23 — Open shadow DOM traversal

**Recommendation · M**

Evidence: no `shadowRoot` use in `content_script_unified.js`. Controls inside open shadow roots (web-component design systems and several large sites) are invisible to Act.

- Walk open shadow roots in element collection, readable text, find, and occlusion (`elementFromPoint` returns the host; recurse into `shadowRoot.elementFromPoint`). Closed roots stay out of scope.
- Acceptance: a fixture button inside an open shadow root is listed, clickable, and correctly occlusion-checked.

### ACT-24 — Iframes

**Recommendation · L**

Evidence: the unified script runs with `all_frames: false` ([manifest](manifest.json#L59)); the baseline doc notes that BBC News served six iframes Act could not see.

- Phase 1: same-origin iframes reachable from the top document, with frame-labelled elements.
- Phase 2: cross-origin frames through per-frame injection and `frameId` routing in `chrome.tabs.sendMessage`. Apply restricted-host and masking rules per frame origin; payment frames stay blocked.
- Acceptance: a same-origin iframe form fixture can be filled; a payment-frame fixture stays blocked.

### ACT-25 — Stable element IDs within a document

**Recommendation · M**

Evidence: [positional indices](content_script_unified.js#L1729), [index cap 0–199](src/utils/pageActionPolicy.js#L264). After every scroll or re-inspection the same control gets a new number. Models often reuse an earlier number, which then points at a different control.

- Keep a per-session `WeakMap<Element, id>` with a monotonic counter so a control keeps its ID for the life of the document. Keep the 200-elements-per-snapshot cap but lift the ID range. This also removes the root cause of ACT-04.
- Acceptance: a control keeps its ID across scroll and region reads; a reused ID for a removed control reports stale.

### ACT-26 — Deterministic first observation

**Recommendation · S**

Evidence: [forced named tool choice](src/orchestrator/RunOrchestrator.js#L4804), [tool-error hint only mentions web search](src/orchestrator/RunOrchestrator.js#L4845). Every Act run spends one full model round trip to be forced into `page_get_state`. Some OpenAI-compatible servers reject a named `tool_choice`, and there is no fallback.

- Run `page_get_state` in the orchestrator before the first provider call and add it to the history as a synthetic tool call and result. Keep the "inspect first" guarantee without depending on provider support for named tool choice.
- Acceptance: the first provider request already contains the snapshot; runs on a server without named `tool_choice` still start.

### ACT-27 — Replace the regex planner with a model-maintained checklist

**Reproduced in part · M**

Evidence: [activation](src/orchestrator/ActPlanner.js#L79), [goal matching](src/orchestrator/ActPlanner.js#L324), [progress](src/orchestrator/ActPlanner.js#L362), [incomplete warning](src/orchestrator/RunOrchestrator.js#L5462), [tool list without `page_record_note`](src/orchestrator/RunOrchestrator.js#L4104).

- A probe activated the planner for "Go to the next page" and "Find the cheapest flight and book it" (regex signals `next`, `find … and`). Any instruction over 100 characters also activates it.
- A goal advances only when the model calls `page_record_note` right after a `delivered_verified` receipt and the note matches keyword lists. Most clicks are `delivered_unverified` (ACT-03), so successful tasks can end with "⚠️ Act task incomplete". The ACT MODE tool list omits `page_record_note`.
- Planner activation also changes approval behavior (one approval, then auto-approve low risk), so the same task phrased longer gets different consent semantics.
- Fix: a `page_update_plan` tool where the model writes and updates a short checklist (≤ 12 items). The orchestrator bounds it, shows it on the progress card, and requires a receipt or fresh snapshot reference to mark an item done. Remove regex decomposition and keyword matching. Decouple approval behavior from planning.
- Acceptance: a one-step task never shows the incomplete warning; multi-step benchmark tasks show accurate progress.
- Implemented in Phase 3, including false quota and twelve-step checkpoint regressions. Model-driven progress accuracy remains unmeasured; scripted delivery and Phase 3 gates passed.

### ACT-28 — Declared postconditions and richer click evidence

**Recommendation · M**

Evidence: [click receipt](content_script_unified.js#L2467); the earlier [browser-agent review](docs/BROWSER_AGENT_REPOSITORY_REVIEW.md) recommended "verify a declared safe postcondition". Clicks are verified only by a checkbox toggle or a URL change.

- Add bounded evidence: fingerprint changed, target `aria-expanded`/`aria-selected`/`aria-pressed`/`aria-checked` changed, a dialog or menu appeared, target removed, focus moved.
- Add an optional `expect` argument (`text_appears`, `text_gone`, `url_changes`) that the content script checks after settling. Report `delivered_verified` only when the declared effect is observed.
- Acceptance: "open the filter panel" clicks verify; a no-effect click stays unverified.

### ACT-29 — Warn when the selected model cannot call tools

**Recommendation · S**

Evidence: the fresh-install default is `openrouter/free`; `src/utils/modelDiscovery.js` records no tool-support metadata. Act on a model without function calling fails late with a provider 400 error.

- Record tool support from discovery metadata where the provider exposes it (for example OpenRouter `supported_parameters`). Warn when Act is turned on with an unsupported or unknown model and link to a recommended model.
- Acceptance: enabling Act with a known text-only model shows the warning before the run.
- Implemented in Phase 3; local simulated metadata verifies unsupported/unknown/supported warnings, profile saves and zero generation calls on enable. Options guidance is provided rather than an unverified model-quality recommendation. Phase 3 gates passed.

### ACT-41 — Rewrite the Act prompt

**Source-confirmed · S**

Evidence: [ACT MODE block](src/orchestrator/RunOrchestrator.js#L4129) (about 3,800 characters in one paragraph), [screenshot instruction](src/orchestrator/RunOrchestrator.js#L4139), [repeated tool preamble](src/orchestrator/RunOrchestrator.js#L3554) (352 characters, repeated in 7 tool descriptions).

- It tells the model to "use the screenshot" although screenshots are off (ACT-06).
- It says safe navigation needs no prompt, and later that links navigate "with approval".
- It omits `page_record_note` from the tool list while the planner depends on it (ACT-27).
- Fix: a short numbered checklist with conditional sections (screenshots, planner, tabs). Put the shared safety preamble once in the system prompt.
- Acceptance: measured on ACT-30 with no success-rate loss; prompt length drops.

---

## P3 — Efficiency (measure first)

### ACT-40 — One compact model-facing snapshot format

**Source-confirmed · S**

Evidence: [tool result serialization](src/orchestrator/RunOrchestrator.js#L5328), [snapshot shape](src/utils/pageDom.js). The tool result is `JSON.stringify(result)`, so the model gets every control twice (formatted `content` lines **and** the `elements` array), plus `visualBoxes` (no consumer without screenshots), `regions` (index lists derivable from `region-N`), `metrics`, and `fingerprint`. A snapshot can reach the 128 KB payload cap.

- Fix: a dedicated serializer for the model (header, readable content, one element list, notices). Keep the full object internally.
- Acceptance: measure bytes per snapshot on the fixtures before and after; expect a large reduction (an estimate until measured) with no ACT-30 regression.

### ACT-42 — Snapshot build cost

**Recommendation · M**

Evidence: [snapshot builder](content_script_unified.js#L1883). Each snapshot clones the body and runs Turndown, computes accessible names for every candidate, measures every `div` for scroll containers, and removes one record per loop while re-serializing until the payload fits. The worker then repeats the trim loop in `normalizePageSnapshot`.

- First record `metrics.buildMs` on heavy real pages. Then: cache readable content per fingerprint, trim with a binary search, and limit the scroll-container scan.

### ACT-43 — Per-action bridge round trips

**Recommendation · S**

Evidence: [executor](background.js#L1482). Every action does a readiness check (tab lookup plus ping with a 1.5 s timeout), a URL lookup before, and another after. Cache readiness per tab and document and skip pings that cannot change the outcome. Measure first.

### ACT-44 — `page_hover` and `page_go_back`

**Recommendation · S**

Menus that open on hover and "go back to the results" are common and currently need workarounds. `page_go_back` navigates history in an owned tab and counts as navigation. `page_hover` dispatches the pointer-over/enter sequence and is read-only.

---

## Removals and simplification

### RM-01 — `delete:` `ActActionCache.js`

`src/orchestrator/ActActionCache.js` (140 lines) describes an "always-on action-template cache" that reuses policy verdicts across runs. The only use is the 5 s `page_get_state` cache in ACT-12, which is a defect. Delete the module and its two call sites; keep behavior: every inspection reads the live page. Update `src/orchestrator/AGENTS.md` and `tests/actActionCache.test.js`.

### RM-02 — `delete:` dead Act code paths and stale comments

- `_isPageActionTerminalError()` always returns `false`; remove it and its branch ([L1549](src/orchestrator/RunOrchestrator.js#L1549), [L2701](src/orchestrator/RunOrchestrator.js#L2701)).
- The target is resolved twice (`actionTarget` at [L2141](src/orchestrator/RunOrchestrator.js#L2141) and `target` at [L2203](src/orchestrator/RunOrchestrator.js#L2203)).
- Unreachable check in `waitForPageActionSettled` ([L2167](content_script_unified.js#L2167)).
- The snapshot header contains a literal `\n` instead of a newline ([L1933](content_script_unified.js#L1933)).
- Misplaced JSDoc: the web-search doc block sits above `_restoreActCheckpoint` ([L341](src/orchestrator/RunOrchestrator.js#L341)); the screenshot-gate comment sits above `ACT_SNAPSHOT_CACHE_MS` ([L126](src/orchestrator/RunOrchestrator.js#L126)).
- The `documentUrl` comment says a mismatch "invalidates the run", but the code adopts the new document ([L784](src/orchestrator/RunOrchestrator.js#L784)).

Completed: removed the always-false terminal classifier and redundant target resolution; removed the unreachable settled-wait check and obsolete source-text assertion; corrected the snapshot newline, misplaced web-search JSDoc, stale screenshot-gate comment (with the cache deletion), and document-change comment. `npm run test` passed 98/98 and `npm run test:behavior` passed 55 files / 748 tests.

### RM-03 — `shrink:` collapse the always-true `multiTabEnabled` flag

`multiTabEnabled` was always equal to `enabled` ([startRun](src/orchestrator/RunOrchestrator.js)); the single-tab prompt text, tool filter, and guard branches were unreachable in production runs. Removed the redundant run-state flag and dead branches; Act-owned tab tools now consistently share the Act lease. Legacy config objects may still include `multiTabEnabled`, but runtime behavior is determined solely by `pageActions.enabled`. The focused regression asserts owned-tab tools remain available when a legacy synthetic state says `multiTabEnabled: false`; `npx vitest run tests/runOrchestrator.test.js` passed (150 tests).

### RM-04 — `yagni:` decide the dormant screenshot/vision path

**Decision.** The vision payload code (`_storeActScreenshot`, `_getActVisionImage`, `_withActVisionOpenAI`, `_withActVisionAnthropic`), the index overlay badges drawn on the user's page, and `visualBoxes` exist for screenshots that are switched off. Either:

- (a) ship an **opt-in** visual mode for vision-capable models (disclosure, sensitive-region exclusion, per-run consent). This is likely the biggest single gain for canvas- and icon-heavy apps such as Google Maps; or
- (b) delete the dormant path, overlay badges, and `visualBoxes`, keeping the video-extraction screenshot.

The user selected deletion. The dormant Act screenshot storage/provider wrappers, capture request, overlay badges, and `visualBoxes` were removed; video/content-extraction screenshots remain. The removal is browser-verified (the batch result carries no `screenshot` and no `visualBoxes`); the retained video-extraction path has no browser coverage.

### RM-05 — `delete:` the production MAIN-world no-op content script

`content_script_page_diagnostics.prod.js` was an empty file, but the manifest still injected it into the page's main world at `document_start` on every URL ([manifest](manifest.json#L53)). The production build now removes that entry and omits the script file, and the now-unused production no-op shim was deleted; development/evaluation builds retain the active bridge. Verified by `npm run build:prod` plus an output check for both manifest reference and file absence, and `npm run test` (98/98) / `npm run smoke`.

### RM-06 — `shrink:` source-text guards in `scripts/test-runner.js`

The 2,082-line runner has about 96 `includes()` checks on source text, some on comments (for example `'// Keep the action queued.'` at [L931](scripts/test-runner.js#L931)). They fail on harmless refactors and do not prove behavior. Convert the valuable ones to behavior tests and delete the comment-string guards.

### RM-07 — `shrink:` archive dated review and report docs

`docs/FEATURE_REVIEW.md` (2026-08-30 counts), `docs/ACCEPTANCE_SPRINT.md`, `docs/BROWSER_AGENT_REPOSITORY_REVIEW.md` (implemented), and `docs/ACT_RELIABILITY_BASELINE.md` (superseded by ACT-30) are point-in-time records. Move them to `docs/history/` or fold the durable parts into `docs/ARCHITECTURE.md`, and update the documentation index.

---

## Overall (outside Act)

### GEN-01 — Make `npm run validate` pass on Windows checkouts

**Reproduced · S**

- `marked.min.js` is checked out CRLF while the index is LF, so `prettier --check` fails locally. Add `eol=lf` rules to `.gitattributes` for text sources and renormalize.
- Move `marked.min.js` into `libs/` (the vendored home, already Prettier-ignored). It is the only vendored bundle at the root, and it is stored Prettier-formatted, so it is not byte-identical to upstream. Update `chat.html`, `scripts/build.js`, `scripts/test-runner.js`, `scripts/verify-vendored-licenses.js`, and the vendor manifest together.
- Fix the 7 ESLint warnings in `tests/runOrchestrator.test.js` and `tests/runResilience.test.js`.

Resolved: `npm run validate` is green (exit 0) — lint, format check, structural tests, behavior suite, smoke, and vendored-license verification all pass. The ESLint warnings were already clean. For the format gate, the vendored minified bundle is now excluded via `*.min.js` in `.prettierignore`, matching the existing `libs/` convention, so a minified vendor blob is never reformatted away from upstream; the file was deliberately **not** moved into `libs/` because that would touch the build, manifest, test-runner, and license-verifier for no behavioral gain. The `.gitattributes` renormalization was not needed here.

### GEN-02 — Pin and update imprecisely versioned vendored libraries

`libs/vendor-manifest.json` records marked as `4.x`, readability as `0.5.x`, and turndown as `7.x`. Record exact versions with hashes. marked 4.x is several major versions behind; update it and keep DOMPurify in front of rendered output.

### GEN-03 — Extract the page-action runtime; split the Act content script

**Recommendation · L**

`src/orchestrator/RunOrchestrator.js` is 6,174 lines. It mixes OpenAI and Anthropic stream handling, the Hermes flow, the journal, prompt building, and about 2,000 lines of page-action runtime whose state is more than 30 loose fields on `run.pageActions`. `content_script_unified.js` mixes page extraction (lines 1–1,220) and the Act runtime (lines 1,220–2,590).

- Extract a `PageActionRunner` (page and tab actions, receipts, budgets, guards, confirmations) with its own state object, and move OpenAI and Anthropic wire code next to `CodexTransport.js`.
- Split the Act runtime into its own content script; this also enables GEN-05.
- Do this alongside the P1 fixes, not before them, and keep the event, journal, and message contracts unchanged.

**Phase 4 progress:** 4.1 and 4.4 remain implemented as recorded above. Phase 4.2 now injects the Act runtime into supported frames on demand, merges up to 16 labelled frame snapshots (200 controls/24K characters), routes current global indices to frame-local snapshot keys, applies blocked-origin rules per frame, and omits recognized payment-like frames. Frame IDs and origins come from `chrome.scripting.executeScript({allFrames:true})`; this uses no `webNavigation` permission and replaces the plan's proposed `postMessage` mapping handshake. A real-browser fixture covers same-origin and cross-origin read/action routing, blocked origins, and payment-frame exclusion. Phase 4.3 is implemented with a default-off `pageActionsPreciseInput` setting and one isolated `CdpInputBackend.js` allowlist for `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, and `Input.insertText`. The service worker attaches only on an approved supported-page mutation, displays active/fallback state, detaches on Stop/run cleanup/errors, and never replays uncertain input through DOM events. Unit and browser tests cover allowlist bounds, trusted input, explicit setting save/default, and the background debugger path. Latest gates: `npm run validate` passed (101 structural checks, 805 behavior tests, lint, formatting, smoke and licenses); `npm run build` passed; `npm run test:browser` passed 109/109 in 10.0 minutes; `git diff --check` passed. Still pending: manual Chrome banner/cancel/off-mode and read/form/multitab journeys; the requested `PageActionRunner` extraction (Phase 5); model A/B (no benchmark key); human security review for persistent site trust and the debugger permission. The postMessage-vs-scripting frame-ID design substitution is documented and should be reviewed before production.

### GEN-04 — Documentation drift fixes

- `docs/PRODUCTION_READINESS.md` links to `AGENTS.md#user-preferences`, which does not exist, and says fresh Act snapshots carry a screenshot for multimodal providers (disabled).
- `src/orchestrator/AGENTS.md` says `page_batch` combines 2–4 observations; the code allows 2–6.
- `src/utils/AGENTS.md` lists the `validation.js` ownership bullet twice.
- `src/chat/AGENTS.md` has two "Local Contracts" and two "Work Guidance" sections, a contract line inside "Child DOX Index", and claims a 600-line module guard and a `chat.js` line guard that no test enforces (`ChatComposer.js` is 858 lines, `ChatPageAutomation.js` 798).
- `CHANGELOG.md` order is `[6.3.0]`, `[6.2.0]`, `[Unreleased]`, `[6.2.1]`. Restore chronological order and move shipped Unreleased entries under their release.
- The AGENTS files restate many constants (budgets, caps, timeouts) that drift from code. Keep durable contracts and point to the code for numbers.

### GEN-05 — Measure, then reduce per-page content-script injection

Every page load injects about 330 KB of scripts (unified 106 KB, Readability 88 KB, notch 62 KB, dom-accessibility-api 36 KB, Turndown 27 KB, diagnostics) plus the main-world script from RM-05. Measure CPU and memory on a heavy page. Then consider injecting the extraction and Act bundles on demand with `chrome.scripting` (the injection helper already exists in `background.js`), keeping only the notch static.

### GEN-06 — Carried-over residuals from the previous punchlist

Not re-verified in this review. The previous plan left delete/pin and import write-backs in `options.js` outside the error-aware storage helper (P1-06 and P2-07 follow-ups). Route them through the helper and add failure tests.

---

## Sequencing

1. **Unblock:** GEN-01 so `npm run validate` is green on every machine.
2. **Measure:** ACT-30 and record the current score.
3. **Stop the misfires (P1, mostly S):** ACT-01, ACT-02, ACT-03, ACT-06, RM-01/ACT-12, RM-02. These are small and should move the benchmark on their own.
4. **Targeting integrity and consent:** ACT-04, ACT-05, then ACT-25; ACT-13, ACT-14, ACT-15; ACT-07 and ACT-08 after the owner decides.
5. **Capability:** ACT-26, ACT-41, ACT-20, ACT-21, ACT-22, ACT-23, ACT-28, ACT-27, ACT-29; then ACT-24 and ACT-44.
6. **Efficiency and structure:** ACT-40, ACT-42, ACT-43, GEN-03, GEN-05.
7. **Hygiene:** RM-03 to RM-07, GEN-02, GEN-04, GEN-06.

Each step re-runs `npm run validate`, `npm run test:browser:prod`, and the ACT-30 benchmark, and updates the nearest AGENTS contract when behavior changes.

## Decisions needed from the owner

1. **ACT-07:** should "Approve all" stop covering high-risk actions?
2. **ACT-08:** should model-typed cross-origin URLs require a card? This changes the "no per-site prompt" lease wording.
3. **RM-04:** ship an opt-in visual mode, or delete the dormant screenshot path and page overlay badges?
4. **Per-site trust:** is a persistent "allow low-risk actions on this site" setting wanted? Today Act consent is per run and per browser session.

## Limits of this review

- Source review plus the local gates listed above. The Playwright browser suite, live providers, signed-in sites, and the Hermes/Codex paths were not exercised.
- Act was reviewed in depth (orchestrator page-action loop, policy, planner, content script, background executor, approval UI). Options, notch, Hermes, grounding, and extraction were reviewed only for the overall items listed.
- Probes used stubbed executors in Node. "Source-confirmed" items still need a failing test before the fix.
- Size reductions and speedups are expectations until measured (ACT-40, ACT-42, ACT-43, GEN-05).
