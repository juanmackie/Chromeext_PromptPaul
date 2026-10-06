# Act reliability baseline (WebVoyager)

Pinned two-task corpus and run procedure for measuring whether the Act reliability
changes raise real browser-use success.

This is a **selection manifest and run procedure**, not a test fixture. A run needs a
real provider credential and hits live third-party sites, so it cannot live under
`tests/browser/`, whose contract requires that suite to stay credential-free and
hermetic. The dataset itself is **not vendored** here; only the selected records and
the reproduction procedure are pinned.

## Provenance

- Source: `https://github.com/magnitudedev/webvoyager/blob/main/data/originalTasks.jsonl`
- Retrieved: 2026-09-18. 643 tasks across 15 live sites; each line is
  `{web_name, id, ques, web}`.

## Selection procedure (reproducible)

1. Drop sites whose WebVoyager tasks commonly need a signed-in account or that block
   automated browsers: Amazon, GitHub, Coursera, Huggingface, Booking.
2. Drop tasks whose text matches
   `sign in|log in|login|account|password|credential|checkout|buy|purchase|cart|subscribe|my orders|my library|user profile|watchlist`.
   424 of 643 tasks survive.
3. Seed a deterministic PRNG from the string `20260918` (xorshift32 over an FNV-1a
   hash of that seed), then Fisher-Yates shuffle the surviving tasks.
4. Take the first two. If a pick proves unrunnable, take the next in seeded order and
   record the reason here.

## Pinned tasks

```json
{"id":"Google Map--12","web_name":"Google Map","web":"https://www.google.com/maps/","ques":"Find 5 places that serve burgers near 44012 zip code and sort these 5 places by highest rating."}
{"id":"BBC News--8","web_name":"BBC News","web":"https://www.bbc.com/news/","ques":"Get a brief overview of the economic implications of the UK's latest trade deal posted on BBC News and the date when the article was published."}
```

Reachability checked 2026-09-18 from the implementation environment:
`google.com/maps` → HTTP 200, `bbc.com/news/` → HTTP 301 (locale redirect).

## Revision boundary

- **Baseline (before):** revision `2867618`, whose tree was clean.
- **After:** the working tree, which differs by `content_script_unified.js`,
  `src/orchestrator/RunOrchestrator.js`, `tests/browser/page-actions.spec.js`,
  `tests/runOrchestrator.test.js`, the new Act fixtures, and this document. Committing
  those changes as a distinct revision makes the A/B unambiguous.

Capture the baseline from a separate checkout so the working tree stays intact:

```sh
git worktree add --detach ../prompt-paul-baseline 2867618
```

Load `../prompt-paul-baseline` as the unpacked extension for the baseline runs and the
repository root for the after runs. Remove the checkout afterwards with
`git worktree remove ../prompt-paul-baseline`.

## Baseline status

**Not recorded.** Capturing it needs a provider credential, which the implementation
environment does not have (no `.env`, no LLM key, and no local OpenAI-compatible
endpoint on the usual ports). Recorded here so the gap stays explicit rather than
implied.

## Run procedure

Act is default-off and mutating steps are confirmation-gated, so expect to approve
actions while a run proceeds.

1. Load the extension from the revision under test in Chrome or Edge, using a profile
   that already has its own provider credential configured.
2. Open the task's `web` URL, enable Act for that site, and submit the task's `ques`
   verbatim as the instruction.
3. Wait for a terminal run state, then record the row below.
4. Repeat for both pinned tasks on both revisions with identical settings.

### Results

| Task             | Revision  | Final run state | delivered\_\* receipts | Failure codes | Actions | Answer correct? |
| ---------------- | --------- | --------------- | ---------------------- | ------------- | ------- | --------------- |
| `Google Map--12` | `2867618` |                 |                        |               |         |                 |
| `Google Map--12` | after     |                 |                        |               |         |                 |
| `BBC News--8`    | `2867618` |                 |                        |               |         |                 |
| `BBC News--8`    | after     |                 |                        |               |         |                 |

`answer correct?` is a judgement against the task text, not the model's own claim of
completion. One run per task per revision is directional evidence only, not a
reliability benchmark.

## Measured observations on the pinned pages (2026-09-18)

A credential-free probe (`page_get_state` only, no model decisions — harness-level
observation, not task success) ran against both pinned pages under revision `2867618`
and under the post-change working tree, loading each via
`PROMPT_PAUL_LOAD_EXTENSION_DIR`. That mechanism was itself verified: with the baseline
directory loaded, the Act visibility spec fails and the snapshot offers exactly the
controls the change removes.

| Page        | Controls matching the gate selector | Offered by both revisions | Offered by the old rule but not interactable |
| ----------- | ----------------------------------- | ------------------------- | -------------------------------------------- |
| Google Maps | 52                                  | 30                        | 0                                            |
| BBC News    | 188                                 | 39                        | 0                                            |

Conclusions worth acting on:

- The visibility change is a **no-op on these two pages as rendered**: every control the
  old rule offered there was genuinely interactable, so the difference between the two
  revisions is zero on them. Its value is established by the fixture cases instead
  (opacity:0, `[inert]`, `content-visibility:hidden`, `visibility:collapse`, closed
  `<details>`) and applies to pages that actually contain such controls. A raw
  "controls excluded" count is misleading here, because most excluded controls are
  `display:none` and were excluded by both rules.
- Google Maps exposes only ~30 controls through the DOM, so the pinned `Google Map--12`
  task leans on a canvas-like application shell; it may be a weak signal for DOM-level
  Act changes.
- BBC News served 6 iframes. The content script does not traverse frames, so task
  content inside one is invisible to Act.
- Neither page came near the 200-control cap, so the option cap and the
  omitted-control notice are not exercised by these tasks either.
- The per-page counts use a 200px viewport-band stand-in for the content script's own
  inspection margin, so they are directional rather than exact (BBC News: 39 offered vs
  38 predicted in band).

If the pinned tasks prove to be poor fits once run, re-pick with the same seed and
record the substitution here.

## Roadmap evaluation boundary

The local roadmap corpus and scripted Chrome journeys are delivery checks, not results for these live tasks. Model-driven A/B remains **not recorded** for these live WebVoyager tasks while `PROMPT_PAUL_BENCHMARK_API_KEY` is absent. The separate local-fixture benchmark (`npm run benchmark:act -- --run`) does now record model-driven results and bounded per-step traces under `artifacts/act-benchmark/`; those are local-fixture measurements and are not a substitute for this live-task baseline. Current traces preserve runtime `actOutcome` and ACT_* failure codes; end state is graded independently of model completion claims. Pre-outcome traces do not have comparable structured failure metadata.

## Deliberate omission

Sensitive control values remain omitted, including password, hidden and file fields. With Act enabled, non-sensitive values (including selected option text) are disclosed in the viewport outline, limited to 160 characters per field and 8,000 characters per snapshot. Only those already-disclosed values participate in change fingerprints. Values are kept in live task state and model history, never in activity journals or checkpoints.
