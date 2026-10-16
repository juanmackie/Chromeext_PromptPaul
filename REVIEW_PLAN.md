# Extension bottleneck review

Review date: 2026-10-16. Three `gpt-6-luna` subagents investigated streaming,
page interaction, and background orchestration under the parent agent's review.

## Selected issue

`RunOrchestrator._emitEvent()` previously queued a complete Chrome session-storage
read and write for every event. Streaming bursts retained obsolete journal snapshots
ahead of the terminal recovery record. The queue had no bound or coalescing.

The regression command is `npx vitest run tests/runJournal.test.js`. Before the fix,
its held-storage reproduction observed 252 reads for a burst that needs at most two
read/write passes. This is an operation-count regression, not a measured response-time
speedup. Active reconnect can use in-memory state; stored journal freshness matters
when a completed run has been removed or the worker restarts.

Persistence now keeps the latest safe journal projection per pending run, caps
pending snapshots at 24, and drains storage writes serially. Serialization happens
only for batches being written. A failed older batch allows one attempt at newer
pending work; retained snapshots can retry on a later event. Live events, event
sequences, journal fields, and consent rules retain their existing behavior.

## Follow-up: response completion delay that looked like a scroll lock

A 100-paragraph local SSE response emitted over 3.1 seconds took about 24.4
seconds after the provider stream ended to write the terminal journal event and
unlock the composer. The extension page recorded no long tasks. A scroll
interaction after terminal completion and a five-second idle period worked, so
the persistent delay was in background completion, not a trapped chat scroll
container.

The cause was `detectRepeatedOutput()` in `src/utils/runResilience.js`. It ran
after each additional 512 output characters, built a character `Set` for
hundreds of thousands of candidate fragments, and only then checked whether a
candidate repeated. The detector now skips candidates whose first character
cannot match and tracks distinct Unicode characters incrementally for each
candidate start. It compares only fragments whose first character and diversity
can match, avoiding repeated scans of large low-diversity output. When
repetition comparisons accumulate, a prefix-match table reuses those checks
across candidate sizes. The detector's result contract is unchanged. The same
browser reproduction now requires terminal delivery within five seconds and
verifies wheel scrolling immediately and after five seconds idle.

An attempted stream-render cadence and smooth-scroll change left the worker's
24-second terminal delay unchanged, so those UI changes were reverted. The
full-prefix Markdown renderer remains a separate candidate rather than the
cause of this delayed terminal event.

## Other candidates

| Candidate                      | Evidence                                                                                  | Disposition                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Full-prefix Markdown rendering | `ChatStream` reparses the accumulated answer and replaces its DOM on each rendered frame. | Deferred. A renderer change needs separate interaction and formatting coverage.         |
| Large-page Act observation     | Snapshot creation repeatedly walks the DOM and reads full body text before trimming it.   | Deferred. Traversal limits need coverage for retained controls, frames, and visibility. |

The journal operation-count regression and output-safety scan are separate
issues. The browser timing reproduction establishes the output-safety scan as
the cause of the delayed terminal event for the tested long response; it is not
a profile of every provider or output shape.

## Verification

Baseline: 102 structural checks and 908 behavior tests passed. Final checks:

- `npm run test`: 102 passed.
- `npm run test:behavior -- --reporter=dot`: 918 passed, including 10 new journal cases.
- `npm run smoke`, `npm run verify:licenses`, and `npm run build:dev`: passed.
- Targeted ESLint, Prettier, and `git diff --check`: passed for this change.
- Headed Chrome: sent a prompt to a local fixture, reloaded during execution,
  and restored the completed answer after another reload. The fixture received one
  provider request. Screenshot: `artifacts/journal-chat-recovered.png`.
- `npx playwright test tests/browser/run-journal.spec.js tests/browser/approval-recovery.spec.js tests/browser/worker-lifecycle.spec.js`:
  10 passed, including normal worker idle shutdown with no worker debugger attached.
- Follow-up: `npm run test` passed 102 checks; `npm run test:behavior` passed 922
  tests; `npx vitest run tests/runResilience.test.js` passed 17 tests, including
  low-diversity, repeated-prefix, and Unicode cases. Sixty deterministic
  old/new detector comparisons passed. A 100,000-character repeated-prefix stress
  case took 253 ms. The new `chat-scroll.spec.js` passed in headed Chrome (11.5s);
  terminal delivery stayed below its 5-second bound and scrolling worked
  immediately and after five seconds idle. Targeted ESLint, Prettier, and
  `git diff --check` passed.

`npm run validate` stops at four pre-existing lint errors in
`src/utils/evalHook.eval.js`, `src/utils/pageActionResult.js`, and
`tests/pageActionResult.test.js`. These files are unchanged. The separate repository
format check flags 29 unrelated files, including local campaign data. All files
added or modified for this fix pass the targeted format check.

Existing Options-page edits and local campaign files are outside this change.
