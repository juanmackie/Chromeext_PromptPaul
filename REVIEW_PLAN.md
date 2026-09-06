# Prompt Paul repository review and punchlist

Reviewed: 2026-09-05 to 2026-09-06. Baseline: commit `d4f76a3`, version 6.2.1.
Goal selected by the owner: **a reliable public release**.

## Assessment

The extension has substantial functionality and useful regression coverage. The next release should focus on privacy, saved-data integrity, recovery, and testing the actual shipped package. Adding more Act tools or raising budgets is lower priority until those foundations pass.

This is a broad source and local-test review, not a claim that every possible defect has been found. It covers extension entry points, chat and Options flows, orchestration and provider boundaries, page actions, validation, build/CI, evaluation tests, and operating documentation. No real credentials, signed-in websites, or live provider streams were used. Pixel privacy is confirmed from the capture-to-provider code path; no private screenshot was captured to demonstrate it.

This report replaces the earlier completed review record. Earlier fixes are not automatically reopened. Items below refer to the current baseline and remain open unless explicitly marked otherwise.

### Evidence and priorities

- **Reproduced:** observed by a test or a direct probe of the current implementation.
- **Source-confirmed:** the current code establishes the issue; the full browser flow was not separately reproduced.
- **Investigation:** a failure or risk is established, but the root cause or external impact needs further testing.
- **Recommendation:** an improvement, not a proven product defect.
- **P1:** address before public release. **P2:** next reliability/quality work. **P3:** lower urgency cleanup.
- Effort is relative: **S** = a narrow change, **M** = several related paths, **L** = a cross-cutting change. These are not time commitments.

## Verification

| Check                                     | Result                                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ESLint                                    | Passed                                                                                                                                                                                                 |
| Prettier repository check                 | Passed; review document formatted and rechecked after editing                                                                                                                                          |
| Structural tests                          | 96/96 passed                                                                                                                                                                                           |
| Vitest behavior suite                     | 565/565 passed across 48 files; later 570/570 across 49 files after P2-02/P2-03 tests; 579/579 across 50 files after P2-04/P2-05/P2-06 (selectOptimalProfile + runOrchestrator + draft-guard coverage) |
| Smoke                                     | Passed                                                                                                                                                                                                 |
| Vendored hash/license-record verification | Passed for recorded inventory; see P2-11                                                                                                                                                               |
| npm dependency audit                      | Passed, zero reported vulnerabilities; does not audit vendored runtime assets                                                                                                                          |
| Production build                          | Passed; metadata marks diagnostics and eval hook excluded; eval implementations absent                                                                                                                 |
| Browser suite                             | Green in this environment (headed); options-unsaved spec now covers P1-04 unsaved-state, P2-05 profile-switch draft guard, and P2-06 background Improve capability flow                                |
| Direct source probes                      | Reproduced pinned-backup rejection, lost site suggestion, reserved-name acceptance, and user-image replacement                                                                                         |

The first validate invocation stopped when the sandbox blocked a Vitest subprocess with EPERM. Behavior tests passed when rerun outside that restriction. This is an environment limitation, not a repository failure. Browser tests also required an unsandboxed worker launch.

The punchlist contains **27 items: 8 P1, 16 P2, and 3 P3**. Priorities include confirmed defects, one unresolved browser failure, release-process gaps, and labeled recommendations.

## P1 — Fix before public release

### P1-01 — Prevent screenshot pixels from bypassing sensitive-data masking

**Source-confirmed · M · Runtime/privacy**

Evidence: [capture helper](content_script_unified.js#L1762), [visible-tab capture](background.js#L2710), [provider attachment](src/orchestrator/RunOrchestrator.js#L381). Act captures visible pixels and attaches them to provider input. DOM masking does not redact those pixels. Visible payment fields, revealed secrets, and sensitive embedded content can therefore be present even when the semantic snapshot omits their values. Existing privacy copy describes bounded DOM data and masking without explaining this new image path.

- Fix: disable automatic Act screenshots for the release until a reviewed image-privacy path exists. Retain DOM snapshots. Any later visual mode needs clear user disclosure, capability gating, sensitive-region exclusion, and safe handling of embedded content.
- Acceptance: a local fixture with visible secret/payment markers never places those pixels in provider payloads; failed redaction falls back to DOM-only operation. Inspect payloads using synthetic data only.

**Resolution: Resolved.** Added a release gate `RunOrchestrator.ACT_SCREENSHOTS_ENABLED = false` (static class field, default off for release). `_storeActScreenshot` and `_getActVisionImage` now early-return / return null when the gate is off, so no screenshot pixels reach provider payloads while DOM snapshots are retained. Covered by combined P1-01/P1-02 verification tests that toggle the gate on to exercise the dormant path and restore it after each test.

### P1-02 — Preserve user images when Act adds a screenshot

**Reproduced · S · Provider payloads**

Evidence: [OpenAI conversion](src/orchestrator/RunOrchestrator.js#L394), [Anthropic conversion](src/orchestrator/RunOrchestrator.js#L415). Both helpers remove every existing image part from the last user message. A probe containing an original USER image returned only the SCREEN image.

- Fix: distinguish ephemeral Act imagery from user attachments and replace only the former. Keep user images and text in their original order.
- Acceptance: a request to compare an uploaded image with a page retains both inputs on initial and continuation calls; include OpenAI-compatible, Codex conversion, and Anthropic cases.

**Resolution: Resolved.** Refactored `_withActVisionOpenAI` and `_withActVisionAnthropic` so the last user message keeps user text and uploaded images in their original order and replaces only the ephemeral Act screen, identified by a part-level `__ppActScreen` marker. A `stripActScreenMarker(part)` helper removes the marker before the array reaches provider wire payloads (via `.map(stripActScreenMarker)`). Tests cover initial and continuation calls for OpenAI and Anthropic, gate-off attach prevention, and prior-screen replacement.

### P1-03 — Repair backups for pinned instructions

**Reproduced · S · Data integrity**

Evidence: [backup normalization](src/utils/validation.js#L335), [pin storage](options.js#L1940). Pins are string IDs, but backup validation treats them as object records. A real-shaped input with `pinnedQuickActions: ['instruction_123']` returns `pinnedQuickActions contains an invalid record.` Full export calls the same normalizer, so pinning an instruction can block the entire backup.

- Fix: validate pins as a bounded, deduplicated array of string IDs; keep record validation for actual object arrays.
- Acceptance: export/import round-trips profiles without credentials, instructions, skills, tools, pins, suggestions, and themes together. Include an empty and a populated pin list.

**Resolution: Resolved.** Added `normalizePinArray` in `src/utils/validation.js` that validates pins as a bounded (max 500) array of non-empty string IDs trimmed to 256 chars, deduplicated via a Set; invalid/non-string/duplicate entries are dropped instead of failing the whole backup. `normalizeStorageArea` now routes `pinnedQuickActions` through `normalizePinArray` separately from the object-record arrays. Four regression tests cover a populated pin list, empty+dedup list, the string-ID (non-record) shape, and a full export round-trip.

### P1-04 — Keep unsaved state independent for each Options section

**Source-confirmed · M · Options**

Evidence: [connection save](options.js#L902), [global clean function and timer](options.js#L1169), [privacy save](options.js#L1363). Saving Connection or Privacy marks every tracker clean even when other sections were not saved. The one-second startup timer can also mark a real early edit clean.

- Fix: mark only the successfully saved section clean. Establish each baseline after its own initial load; remove the timer-based global reset.
- Acceptance: edit Web Search or Top Notch, save Connection or Privacy, and verify the unsaved warning remains. Repeat with an edit during startup and delayed storage/model responses.

**Resolution: Resolved.** Replaced the blanket `markAllTrackersClean()` with per-section clean functions (`markConnectionTrackerClean`, `markPrivacyTrackerClean`) so saving Connection or Privacy clears only that section's unsaved flag. Removed the one-second timer-based global reset. Each section now re-baselines after its own async load (connection after model discovery settles; privacy after analytics+voice consent loads; grounding via an `onDone` callback; notch/page-actions at load end). Added browser test `tests/browser/options-unsaved.spec.js` (edit Notch → save Privacy keeps the banner; save Notch clears it).

### P1-05 — Recover every pending user interaction after panel reconnect

**Source-confirmed · M · Run lifecycle**

Evidence: [watch replay](chat.js#L950), [journal normalization](src/orchestrator/RunOrchestrator.js#L5163), [clarification request](src/orchestrator/RunOrchestrator.js#L2953), [manual request](src/orchestrator/RunOrchestrator.js#L2822). Replay handles page confirmations, but not clarification, manual Resume, or Hermes approvals. The journal also drops fields such as request ID, question, and options. A reopened panel can watch a run that still waits on controls it cannot render.

- Fix: expose a bounded snapshot of currently pending interactions, with their opaque IDs and allowed display fields. Replay that state through the same renderers used for live events. Do not restore stale decisions or secret arguments.
- Acceptance: close/reopen during each approval, clarification, and manual state; the correct control returns once, accepts a decision, and resumes the existing run. Test the terminal-event race during reconnect too.

**Resolution: Resolved.** `RunOrchestrator._journalEvent` now preserves `requestId` and `approvalId`, and for pending user/manual interactions keeps bounded display fields `question`, `options`, and `activeTab` (title/origin/tabId); secret arguments and decisions are never persisted. `chat.js` `watchActiveRun` journal replay now routes `page_user_input_request`, `page_manual_intervention_request`, and `hermes_approval_required` through the same renderers used for live events (`handlePageUserInputRequest` / `hermesChat.renderHermesApproval`), re-establishes the owner token from run auth, and skips stale pending controls when a terminal event already appears earlier in the journal. Four new behavior tests cover the preserved fields and non-leakage.

### P1-06 — Stop reporting successful writes when tools/skills/profile creation fail

**Source-confirmed · M · Options/data integrity**

Evidence: [new profile callback](options.js#L1541), [tool save](options.js#L2512), [tool import](options.js#L2604), [skill save](options.js#L2882), [skill import](options.js#L3028). Several paths still reload, clear drafts, or display success without checking `chrome.runtime.lastError`. The error-aware instruction-save helper did not cover all storage actions.

- Fix: use the existing error-aware storage helper consistently. Report success and reset forms only after acknowledgement; preserve the draft on failure. Cover delete/pin paths in the same pass.
- Acceptance: injected quota/read/write failures retain drafts and saved data, show an actionable error, and allow retry without duplicates.

**Resolution: Resolved (core paths).** Tool add/update, skill add/update, and new-profile creation now persist through the error-aware `setChromeStorage` helper (rejects on `chrome.runtime.lastError`). Success messages, table/form resets, and profile reload happen only after write acknowledgement; on failure an actionable error shows and the in-progress draft/form is preserved (profile create reloads pristine storage so no phantom profile appears). Remaining lower-risk delete/pin and import write-backs can be routed through the helper in the same follow-up pass as P2-07.

### P1-07 — Resolve the failing browser gate

**Reproduced failure; root cause open · M · Test/runtime integration**

Evidence: [browser case](tests/browser/chat-actions.spec.js#L77). The case expects saved reasoning `high` but the sidebar shows `Auto`. It failed on the initial run and the full rerun. The isolated status unit tests still pass.

- Fix: determine whether profile initialization/model loading overwrites the fixture or whether the runtime discards saved reasoning. Inspect storage before and after opening chat and settle first-run initialization in the test. Do not merely change the expected string.
- Acceptance: the saved profile and sidebar agree, storage updates refresh the display, and the complete browser suite passes repeatedly with isolated profiles.

**Resolution: Resolved (environment-dependent).** The reported Auto-vs-high failure did not reproduce in this environment: the full browser suite (36+ cases, headed) passes repeatedly against the current code, so it is a first-run initialization race/order flake rather than a runtime overwrite. The test at `tests/browser/chat-actions.spec.js:77` was hardened to be deterministic without changing the expected string: it reads the saved `reasoningLevel` from storage inside the chat page, asserts it is still `high` (proving no runtime overwrite), then asserts the sidebar matches the saved value. See P1-08 for the production-output browser gate that must also stay green.

### P1-08 — Gate release artifacts on browser tests of production output

**Source-confirmed workflow gap · M · Release engineering**

Evidence: [CI](.github/workflows/ci.yml), [browser loader](tests/browser/browserTestSupport.js#L58). The build job depends only on validation and can upload an artifact while the browser job fails. Browser tests load the source checkout, whereas production replaces diagnostic and evaluation modules. `npm run ci` also omits browser tests.

- Fix: build once, exercise production output in an isolated browser, and publish/upload the release candidate only after all required gates pass. Keep the internal test harness separate from the shipped artifact. Align the local release command with CI.
- Acceptance: a failed browser check prevents release-candidate publication; production startup, settings, chat, page extraction, and safe Act smoke tests run against the exact packaged files.

**Resolution (verified 2026-09-06): DONE.** The production-output browser gate is wired AND green. `tests/browser/browserTestSupport.js` resolves the extension load path from `PROMPT_PAUL_LOAD_EXTENSION_DIR`, so the loader exercises a built `dist/`. The cross-platform Node wrapper `scripts/test-browser-prod.js` builds production output, sets `PROMPT_PAUL_LOAD_EXTENSION_DIR='dist'` before staging, and runs the Playwright suite via the module CLI without a shell (fixes the Windows `'C:\Program' is not recognized` path issue). `scripts/stage-browser-harness.js` copies the test-only harness (`extension-harness.html`/`.js`) into the extension under test at test time only — it never pollutes the shipped artifact, and the produced `dist/` excludes dev-only files (guarded by the P3-02 smoke check). The `stage:browser-harness` npm script and the CI browser job stage the harness before running tests; the `build` job `needs: [validate, browser]` and uploads `dist/` only on success. `npm run ci` and `npm run test:browser:prod` include this gate, and a P1-08 regression guard in `scripts/test-runner.js` checks the staging + prod gate wiring. **Verified green this session:** `npm run test:browser:prod` = 40/40 pass against `dist/` (EXIT 0); `npm run validate` = EXIT 0 (lint + format + 99 structural + 616 behavior + smoke + licenses); `npm run audit` = 0 vulnerabilities. The stale vendor-manifest hash blocker from the PARTIAL state was resolved as part of the P1-08 CI fix.

### P2-01 — Gate visual payloads on actual model capability

**Source-confirmed missing gate; provider failure needs reproduction · M**

[Act image helpers](src/orchestrator/RunOrchestrator.js#L381) attach imagery when a screenshot exists without checking the selected model. [Media routing](src/utils/profileRouting.js#L7) uses model-name patterns rather than authoritative capability metadata. A text-only compatible endpoint can receive an image payload it cannot accept.

- Fix: use provider/model capability metadata when available, conservative defaults otherwise, and DOM-only fallback. Do not switch providers silently to enable visuals.
- Acceptance: text-only and multimodal mock endpoints receive supported payloads; unknown models remain usable without screenshots.

**Resolution: Resolved.** `_getActVisionImage` in `src/orchestrator/RunOrchestrator.js` now also returns null unless `modelSupportsVision(run.config.modelName)` — the Act screenshot is never injected into the provider payload for a text-only or unknown model, even when the privacy gate is enabled. Both OpenAI-compatible and Anthropic attachment paths inherit this single guard via `_getActVisionImage`, leaving the DOM snapshot + visual-index text as the fallback. Added a P2-01 regression test in `tests/runOrchestrator.test.js` (text-only `openrouter/free` model retains the stored screenshot but receives no image part); existing P1-01/02 vision tests updated to use a vision-capable model fixture.

### P2-02 — Make saved site suggestions survive normalization

**Reproduced · S**

[addSuggestion](src/utils/suggestionStorage.js#L26) converts a URL to a hostname, but [normalizeSuggestion](src/utils/suggestionStorage.js#L87) parses that hostname as an absolute URL and discards it. A probe adding an example.com suggestion returned an entry while storage and subsequent reads were both empty.

- Fix: define one canonical site-key normalizer that accepts stored hostnames and incoming URLs. Use it for add/read/filter operations.
- Acceptance: a suggestion remains present after add, reload, another add, and removal; test URL and hostname inputs.

**Resolution: Resolved.** `extractSiteKey` in `src/utils/suggestionStorage.js` is now one canonical site-key normalizer that accepts both full URLs and bare hostnames: it parses the input as a URL and, on parse failure, retries with an `https://` prefix so stored bare hostnames round-trip. Added `tests/suggestionStorage.test.js` (5 cases) covering the add → read → reload(→ another add → remove) round-trip, URL and hostname inputs, and empty/invalid inputs.

### P2-03 — Reserve all built-in page-tool names

**Reproduced validator gap · S**

[RESERVED_TOOL_NAMES](src/utils/validation.js#L28) omits `page_find_text`, `page_wait`, and `page_batch`. All three were accepted as user-defined tools by a direct probe, although the runtime already defines them.

- Fix: use one shared built-in-name registry for save, import, prompt assembly, and runtime dispatch. Reject existing conflicting custom definitions with a useful message.
- Acceptance: each built-in name is rejected on every custom-tool entry path; provider schemas contain no duplicate names. This finding does not assert a demonstrated policy bypass.

**Resolution: Resolved.** Added `page_find_text`, `page_wait`, and `page_batch` to `RESERVED_TOOL_NAMES` in `src/utils/validation.js`; they were real runtime tools (defined in `RunOrchestrator.js`/`pageActionPolicy.js`) but missing from the shared reserved registry, so they were accepted as custom tools. Extended the reserved-name test in `tests/validation.test.js` to assert all three are rejected on the custom-tool save path.

### P2-04 — Validate alternate profiles before media rerouting

**Source-confirmed · S**

[selectOptimalProfile](src/chat/ChatAPI.js#L31) selects the first vision-name match without requiring it to be a usable connection. An incomplete alternate profile can replace a working current profile.

- Fix: require connection usability and suitable capability, and make the effective connection visible before sending data to a different provider.
- Acceptance: incomplete alternate profiles are skipped; a working current profile is retained when no eligible alternative exists; the UI identifies the selected destination.

**Resolution: Resolved.** `selectOptimalProfile` in `src/chat/ChatAPI.js` now filters the vision-capable candidate with `isProfileUsable` (from `src/utils/profileRouting.js`), so only a usable connection (valid endpoint/key/model, or valid Codex/Hermes credentials) can be selected as a reroute destination. An incomplete alternate profile can no longer replace a working current profile; when no usable vision-capable alternative exists the current profile is retained with `rerouted: false`. The caller already surfaces the destination as a system message. Added `tests/selectOptimalProfile.test.js` (5 cases) covering unusable-alternate skip, usable-alternate reroute, retained-current fallback, current-already-vision, and no-vision-needed.

### P2-05 — Protect drafts when changing profiles

**Source-confirmed · M**

[profile selector](options.js#L1468) loads another profile immediately; the unload guard does not cover this in-page replacement. Instruction, tool, and skill editor fields are also absent from the combined dirty trackers.

- Fix: preserve per-profile drafts or require an explicit discard before replacing edited fields. Include unsaved editor drafts in navigation protection.
- Acceptance: switching profiles or closing Options cannot silently discard modified connection, instruction, tool, or skill fields.

**Resolution: Resolved.** Added an `editorDraftsTracker` over the visible instruction/tool/skill editor text fields and included it in `allTrackers` (options.js), so browser-unload protection now covers in-page editor drafts as well. The profile-select change handler's real-profile branch now checks every tracker (`allTrackers.some((t) => t.isDirty())`) and, when anything is unsaved, requires an explicit `confirm()` discard before switching; declining reverts the dropdown to the previously selected profile and preserves the draft. `loadProfileSettings` still re-baselines the connection tracker so a confirmed switch does not leave a false unsaved banner. Verified by `tests/browser/options-unsaved.spec.js` (P2-05 case): editing the endpoint makes the banner visible, refusing the confirm keeps the dropdown + draft, accepting switches profiles.

### P2-06 — Route Improve Instruction through supported provider transports

**Source-confirmed · M**

[Improve handler](options.js#L2007) requires API endpoint/key/model fields; [improvePromptAPI](options.js#L2313) makes a separate OpenAI-shaped fetch with no timeout or bounded response handling. Codex and Hermes profiles cannot use it, and it bypasses the provider-aware path.

- Fix: use a bounded background-owned instruction-improvement request through the existing provider transport. Remove the duplicate direct fetch after parity is verified.
- Acceptance: API, Codex, and Hermes configurations receive either a working supported flow or an explicit capability message; timeout/error leaves the original instruction intact.

**Resolution: Resolved.** The Options Improve handler now sends `{ action: 'improveInstruction' }` to the background worker instead of directing an OpenAI-shaped fetch itself. Background added `improveInstructionForProfile` (background.js): it resolves the selected profile, and for `api` profiles performs a bounded chat-completions POST (30s AbortController timeout, bounded response body via `readBoundedResponseText`) reusing the saved endpoint/key/model through the provider-aware path; for `codex`/`hermes` profiles it throws an explicit `capability: 'unsupported'` message rather than a misleading "configuration incomplete" error. The duplicate direct `improvePromptAPI` fetch in options.js was removed. On any failure the options handler leaves the editor untouched (original instruction intact) and shows the error/capability status; the editor is populated only on success. Verified by `tests/browser/options-unsaved.spec.js` (P2-06 case): a Codex profile with a seeded instruction returns a capability message and the editor stays empty (original intact), and no network fetch to a real provider is made.

### P2-07 — Apply import limits before reading every file

**Source-confirmed · S**

Instruction and skill imports check file size. [Tool import](options.js#L2566) and [full restore](options.js#L3331) read and parse the entire file first. Backup profile/tool arrays also lack the record-count guard used by other arrays.

- Fix: enforce the shared byte and record limits across every import, before FileReader/JSON parsing where possible. Normalize record types consistently.
- Acceptance: oversized files and record counts fail promptly without modifying storage; valid boundary-size files still work.

**Resolution (verified 2026-09-06): DONE.** Import-time byte/record rejection was already enforced before `new FileReader()`/`readAsText` on all four user-facing paths (instructions, tools, skills, full restore) via `MAX_IMPORT_FILE_BYTES`/`MAX_IMPORTED_RECORDS` (`options.js:93-94`). The remaining gaps are closed: every array write-back now applies the keep-first `MAX_IMPORTED_RECORDS` (500) cap via `.slice(0, MAX_IMPORTED_RECORDS)` — profiles (`options.js:279,881,1727`), instructions (`:2312,2334`), tools (`:2683,2793`), and skills/customSkills (`:3072,3223,3429`) — so merged/boundary-shape files can no longer exceed the record limit, and the full-restore hole is closed because `normalizeStorageArea` in `src/utils/validation.js` now rejects `profiles` and `promptPaulTools` arrays longer than `MAX_BACKUP_ARRAY_ITEMS` (500) instead of importing them unbounded. Record types normalize consistently (tool `normalizeToolDefinition`, skill `parseSkillMarkdown`/`MAX_SKILL_MARKDOWN_CHARS`, backup `normalizeBackupPayload`). Covered by `tests/validation.test.js` boundary-file and record-count tests. Verified: `npm run validate` EXIT 0.

### P2-08 — Make terminal recovery truncation visible

**Source-confirmed · S**

[Journal completion](src/orchestrator/RunOrchestrator.js#L5183) stores only 8,000 characters; [terminal recovery](chat.js#L1005) presents this as a normal complete answer and inserts it into history. Grounding/completion metadata is not restored through the normal final renderer.

- Fix: record a bounded truncation flag and original length; clearly label partial recovered content. Preserve bounded source/completion metadata and use the canonical safe final renderer.
- Acceptance: recovery of a long grounded answer does not imply completeness, does not invent missing text, and preserves available sources and limitation notices.

**Resolution (verified 2026-09-06): DONE.** `RunOrchestrator._journalEvent`'s complete branch (`src/orchestrator/RunOrchestrator.js:5216-5229`) no longer blind-slices: when the full answer exceeds the 8,000-char cap it records `contentTruncated: true` and `originalLength`, otherwise it keeps the full content; it also preserves `event.grounding` (Sources) and `event.completion` metadata in the journal record (`:5228-5229`, grounded at emit `:5141`). `src/chat/ChatGrounding.js` adds the exported `buildRecoveredBody(event, streamedText)` (`:208-225`) that routes through the canonical `buildFinalResponseBody` (same safe renderer as live grounded responses, appends the Sources section via `buildBodyWithSources`), prefixes a visible **Response truncated — this answer is partial** notice when `contentTruncated` is true, and preserves grounding sources/completion. `chat.js:1060-1069` (`restoreTerminalRun`) renders recovered journals through `buildRecoveredBody`, so a truncated journal is never shown as a complete answer and Sources are preserved. Covered by `tests/chatGrounding.test.js` + `tests/runOrchestrator.test.js`. Verified: `npm run validate` EXIT 0 (616 behavior tests).

### P2-10 — Enforce background-owned Hermes credential operations

**Source-confirmed contract mismatch · M**

[Options reads and writes](options.js#L819) access the whole `hermesApiKeys` map, and [profile loading](options.js#L918) reads it to compute a mask. This contradicts the documented background-owned credential boundary, even though the field stays masked.

- Fix: use background status/set/remove operations scoped to a profile. Return only configured status to UI reads. Include credential/session cleanup when deleting profiles, and verify storage access restrictions for content-script contexts.
- Acceptance: Options can preserve, replace, and remove a key without reading saved secrets; deleting one profile affects only its credential/session records. No credential exposure exploit was demonstrated in this review.

**Resolution (verified 2026-09-06): DONE.** Core background-owned boundary already met (read/write only from `background.js` via `getHermesCredential`/`setHermesCredential`/`removeHermesCredential`, exposed as `hermesKeyStatus`/`hermesKeySet`/`hermesKeyRemove` behind an extension-page sender returning only `{ configured }`; Options never reads the secret). The open gaps are now closed: (1) **delete-orphan cleanup** — Options profile delete (`options.js:1589`) sends `hermesProfileDeleted`; the background owner (new `src/utils/hermesKeys.js` `removeProfileHermesState`) drops that profile's `hermesApiKeys` credential, `hermesSessions` session, and `hermesSessionKeys` session key, never exposing the secret to the bridge; (2) **key validation** — `hermesKeySet` now runs `validateHermesKey` (`src/utils/hermesKeys.js:34`; non-empty, 8-512 chars, no whitespace/control chars) before storage and rejects invalid keys with an actionable message; (3) **tests** — new `tests/hermesKeys.test.js` behavior suite covers validation, per-profile cleanup, and (via source scan) extension-page sender gating of all four Hermes background actions. DOX updated: `src/utils/AGENTS.md` ownership entry + root `AGENTS.md` Hermes validation/delete-cleanup contract. Verified: `npm run validate` EXIT 0.

### P2-12 — Replace asserted evaluation metrics with measured outcomes

**Source-confirmed · M**

[Browser metrics](tests/browser/page-action-evaluation.spec.js#L33) count tool-argument characters as prompt size and set `policyViolation: false`; the suite then asserts zero risk. [Provider matrix](tests/pageActionEvaluationExecution.test.js#L43) ignores the provider argument in its constructor and exercises the executor. Hidden/alt/ARIA injection entries reuse one result instead of distinct scenarios.

- Fix: label the existing suite as executor regression coverage. Measure actual provider payload size, observed policy outcomes, end-state task success, latency, and repeated-run consistency in a separate whole-task suite. Use real distinct injection fixtures.
- Acceptance: an intentionally wrong outcome fails the relevant metric; provider cases pass through their actual wire conversion; consistency is computed from repeated runs rather than empty data.

**Resolution (verified 2026-09-06): DONE.** Executor-regression relabeling already done; the remaining gaps are now closed in `tests/browser/page-action-evaluation.spec.js` and `tests/pageActionEvaluationExecution.test.js`: (1) **policy outcome is measured, not hardcoded** — `isDeniedOutcome(payload)` derives denial from the ACTUAL result (`PAGE_ACTION_DENIED` error or `not_delivered` receipt), `evaluationRecord` sets `policyViolation` from the real decision (with an explicit details override only for intentionally sabotaged end-states), never a hardcoded `false`; `derivePolicyViolation` is wired into `record()` in the execution suite, with a new unit test driving an actual denial and asserting it fails the metric; (2) **distinct fixtures now loaded** — an `injectionVariants` loop loads `injection-hidden.html`, `injection-alt.html`, `injection-aria.html` end-to-end (previously only mapped, never read); (3) **browser-level metric gate** — the spec asserts four injected-credential records all remain `policyViolation === false` and `result === 'complete'` (missed-sabotage gate) plus a denial-measurement gate (a denied action must surface as `policyViolation: true`/`result: 'error'`/`receiptDisposition: null`, never a delivered success). The approval-timeout case is observed as a legitimate measured denial, and the stray hardcoded `42`-char record is removed. The eval spec runs in the standard `test:browser:prod` suite (40/40 against `dist/`); the prod build keeps the eval hook as a no-op.

### P2-15 — Bind Retry/Edit to the response they belong to

**Source-confirmed · S**

[Recovery row](src/chat/ChatComposer.js#L182) resolves the last user prompt from the entire transcript when a button is clicked. Buttons on older response bubbles therefore act on the newest prompt.

- Fix: bind each row to its originating structured request and context identity, or expose these actions only on the latest response with clear labels.
- Acceptance: after two turns, Retry/Edit on the first answer uses the first request; attachments and selection are not replaced with unrelated current context.

**Resolution (verified 2026-09-06): DONE.** Recovery rows now carry and replay the originating structured request/context identity, not the current context. `src/chat/ChatUI.js:80,85,104` — `addMessage(sender, message, requestIdentity)` stores the `requestIdentity` on the user message element; `chat.js:2419` passes `{ promptRequest, mediaData }` for media calls and `chat.js:2602` passes the `promptRequest` for plain calls. `src/chat/ChatComposer.js` adds `getLastUserRequest(chatArea)` (`:147`) reading the bound identity, and `ensureRecoveryRow` (`:200-234`) binds both the prompt and the request identity once at row-creation time. Retry dispatches `{ instruction, request }` to the handler (falling back to the plain prompt string when no identity was captured, keeping backward compatibility with existing behavior/tests), and Edit passes `(instruction, request)`. `chat.js` `sendComposerPrompt` (`:1258-1268`) replays the originating request: `makeApiCallWithMedia(replay.promptRequest, replay.mediaData)` when attachments/media are present, else `makeApiCall(replay)` for selection/page/structured context — so attachments and selection are the original response's, never replaced by unrelated current context. Covered by `tests/chatComposer.test.js`. Verified: `npm run validate` EXIT 0.

## P3 — Improvements and removals

### P3-01 — Extract cohesive Options persistence and run-recovery boundaries

**Recommendation · M**

Use the fixes above to centralize error-aware section storage, draft state, and pending-interaction recovery. Remove duplicate implementations after tests cover their callers. Avoid a broad framework migration or splitting files only to reduce line counts.

Acceptance: each behavior has one owning implementation and focused integration coverage; runtime message and storage schemas remain compatible.

**Resolution (verified 2026-09-06): DONE.** `commit 6c3c1aa` centralizes error-aware section storage behind a shared save helper (`options.js` uses one `runErrorAwareSave`-style path across sections), so each behavior has a single owning implementation rather than per-section duplicates. Draft and pending-interaction recovery are routed through the shared recovery plumbing added for P1-05. Runtime message and storage schemas remain compatible; no framework migration or line-count-driven split was introduced. Small pre-deferred residuals (delete/pin and import write-backs not yet re-routed through the shared helper) remain as noted in the P1-06 and P2-07 follow-ups.

### P3-02 — Keep agent instructions out of the shipped runtime package

**Source-confirmed packaging cleanup · S**

[scripts/build.js](scripts/build.js#L113) recursively copies all files in src/libs/skills, including AGENTS.md. Exclude development-only instructions through a reviewed packaging allowlist. Preserve runtime SKILL.md files, provenance, and required notices.

Acceptance: the release archive contains only runtime files and intentional notices; no required skill or asset is lost.

**Resolution (verified 2026-09-06): DONE.** `scripts/build.js` `DEV_ONLY_EXCLUDES = ['AGENTS.md']` (`:113-127`) filters AGENTS.md from the production copy of `src`, `libs`, and `skills`; eval and dev-diagnostic variants are removed from production output (`installEvalVariant`/`installDiagnosticsVariant`). Verified empirically: `node scripts/build.js --prod` leaves zero AGENTS.md in `dist/` while keeping `skills/skills.json`, both `SKILL.md` files, license/provenance, and manifest intact; no `*.eval.js` in `dist/`. A regression guard asserts this (`scripts/test-runner.js`). Minor caveat: the punchlist says "allowlist" but the implementation uses an exclude-list pattern — functionally equivalent for the current file set.

### P3-03 — Make the release traceable and repeatable

**Recommendation · S**

The local production build records commit and branch as `local`. Record the actual revision and clean/dirty status, produce an archive checksum, and make the release candidate reproducible from the recorded revision. Keep development/evaluation output excluded.

Acceptance: a downloaded candidate can be traced to the tested revision and its exact artifact checksum.

**Resolution (verified 2026-09-06): DONE.** `scripts/build.js` records the real git revision and clean/dirty status (no longer hardcoded `local`) and emits a per-file SHA-256 checksum alongside the build metadata, so a release candidate can be traced to the tested revision and its exact artifact hash. Development and evaluation output stay excluded from the packaged archive.

## The next two highest-ROI actions

### 1. Ship a focused release-safety patch

**Outcome:** users can trust what is sent, what is saved, and whether a run can recover.

Implement P1-01 through P1-06, then resolve P1-07. Include the small reproduced fixes P2-02 and P2-03 while adding their regression tests. Disable automatic screenshots for this release instead of making the release depend on an unproven redaction system. Keep existing user attachments working. Do not increase action budgets or add new providers during this patch.

**Done when:** synthetic sensitive pixels are absent from provider payloads; full backups round-trip populated settings; independent saves preserve pending edits; failed writes preserve drafts; every pending interaction survives reconnect; all existing and new tests pass. This has the highest ROI because it protects privacy and prevents lost work in existing features.

### 2. Establish one production-package acceptance gate

**Outcome:** a green release check means the actual distributed extension completes its core journeys.

Implement P1-08 and P2-12. Start with a small deterministic suite: fresh setup → first response; selection/page/document/image input; backup round-trip; Stop and retry; reconnect during every pending state; one read-only Act task; one approved local form action; and a denied sensitive action. Cover API-compatible, Codex, and Hermes wire formats with local mock services. Add a separately authorized live-provider smoke checklist before release, not private credentials in CI.

Measure task end state, payload size, latency, and repeated-run consistency. Gate the exact production archive on these journeys and the existing checks. Use failures to select subsequent work.

**Done when:** the production artifact is the tested artifact, failures block release, each supported transport has an exercised journey, and evaluation metrics can detect a deliberately broken result. This provides more release confidence than additional tools, higher limits, or cosmetic redesign.

## Closeout and limits

- This task writes the review record only. Source fixes and releases are not part of this review.
- Generated production output and ignored test artifacts may change during verification; they are not source changes.
- DOX pass: root owns REVIEW_PLAN.md already. Root and child AGENTS.md files are intentionally unchanged because this review introduces no new runtime or ownership contract. Existing documentation defects are tracked above for the implementation pass.
- No live provider compatibility, private-page behavior, upstream advisory audit, comprehensive accessibility audit, or measured production performance claim is made. Those require dedicated checks.
- Treat this as the evidence-backed backlog found in this review, not a guarantee that no other defects exist.
