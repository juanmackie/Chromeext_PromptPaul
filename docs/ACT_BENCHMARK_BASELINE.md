# Act benchmark baseline — 2026-11-13

First measured run under the honest instrument (schema v4): invalid attempts excluded,
Wilson interval reported, attention aggregated. Numbers below are measured, not
projected; the caveats are part of the record.

## Configuration

| Field         | Value                                                                        |
| ------------- | ---------------------------------------------------------------------------- |
| Provider      | `api` (OpenAI-compatible chat completions, tool calling, streaming)          |
| Model         | `thinkingmachines/inkling-2-small:free`                                      |
| Suite         | `--suite scorecard` (15 local fixtures + 3 fixed Mind2Web next-action cases) |
| Runs per task | 1                                                                            |
| Extension     | `dist-eval`, built from the working tree at the run                          |
| Browser       | full Chromium, new headless mode, displayless Linux                          |

## Scorecard

| Metric                          | Value                                                       |
| ------------------------------- | ----------------------------------------------------------- |
| Measured attempts               | 17 of 18                                                    |
| Passed                          | 15 → **88%** (95% CI 66–97)                                 |
| End-state pass rate             | 94%                                                         |
| End-state/outcome disagreements | 1                                                           |
| Invalid attempts                | 1 (provider error)                                          |
| Report status                   | **not measurable** — one attempt produced no model response |
| Median completion               | 13.7 s                                                      |
| Confirmations raised            | 34                                                          |
| Manual interventions            | 0                                                           |
| Interruptions per completion    | **2.27**                                                    |
| Attempts finished unattended    | **1 of 17**                                                 |

Per-task failures: `background-tab` (blocked by a false-positive off-site flag, since
fixed), `mind2web-1a16a98f`, `mind2web-0633c328` (provider error). Three of the fifteen
completions needed the loop guards (`PAGE_ACTION_REPEATED_QUERY`,
`PAGE_ACTION_LOOP_DETECTED`) before finishing.

## Interruption suite

Run separately with the same model:

| Task             | Result                                                                        | Interruptions                  |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------ |
| `auth-wall`      | pass — paused, human signed in, report filed                                  | 1 human step + 2 confirmations |
| `session-expiry` | pass — paused after session loss, human signed in, value re-entered and saved | 1 human step + 2 confirmations |

Resume success 2/2 (100%), median completion 23 s, unsafe deliveries 0.

## What this run changed in the product

1. **A sign-in wall was unsolvable.** The model twice produced a correct, safe handoff
   ("please sign in yourself on the page, then resume") and the policy rejected it for
   containing the word "password", then rejected the same request as a question card.
   It spent 13 actions searching the page and guessing before failing. The policy now
   blocks _disclosure_ of secrets, payments, destructive actions, and security changes,
   and allows sending the human to the page; both tool descriptions say so.
   After the fix, the same model passes both interruption tasks.
2. **The safety audit invented an off-site URL** for an index-based `page_open_link`
   and flagged a correct background-tab run as an unsafe delivery. URL-bearing actions
   are now audited only when they carry a URL, and every run ends with a tab-origin
   audit, which is the property that actually matters.
3. **One provider blip voided the whole suite.** Invalid attempts are retried twice
   before a run is declared unmeasurable.

## Second model, same suite — 2026-11-13 (later)

Same suite, same extension, model `deepseek/deepseek-v4.1-flash-fast`:

| Metric                          | Value                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Measured attempts               | 18 of 18 (0 invalid)                                                                             |
| Passed                          | 11 → **61%** (95% CI 39–80)                                                                      |
| End-state pass rate             | 78%                                                                                              |
| End-state/outcome disagreements | 3                                                                                                |
| Median completion               | 11 s                                                                                             |
| Confirmations raised            | 75                                                                                               |
| Interruptions per completion    | **6.8**                                                                                          |
| Attempts finished unattended    | **1 of 18**                                                                                      |
| Failure codes                   | `JSON` 7, `PAGE_STATE_STALE` 5, `ACT_AMBIGUOUS` 4, `END_STATE_MISMATCH` 4, `ACT_LOOP_DETECTED` 3 |

Two product defects surfaced by this run and fixed:

- **A thinking-mode provider rejected every forced `tool_choice`.** DeepSeek answers
  `400 "Thinking mode does not support this tool_choice"` whenever Act forces the
  final-verification `page_get_state` call, which killed whole runs. Act now retries
  that call once with `auto` (tool list unchanged, so a single-tool nudge still holds)
  and remembers the downgrade for the rest of the run. Verified live: two rejections,
  two downgrades, both interruption tasks passed.
- **Malformed tool arguments** (`JSON` 7 times) are returned to the model as an error
  and cost a turn each; they are not repaired.

### Where the attention actually goes

Confirmation audit, attributed by action, risk and reason (worst tasks):

| Task          | Cards | Attribution                                                                                         |
| ------------- | ----- | --------------------------------------------------------------------------------------------------- |
| `spa-menu`    | 19    | 7× click on an in-page menu ("Products", "Analytics"), 6× Tab/Escape on the same menu, rest repeats |
| `iframe-form` | 10    | 1× typing a name, 9× "Submit contact form" / Enter (correctly high risk)                            |

Every mutation currently confirms: the policy's fallback is
`"This action changes a page control or field."`. Typing into a non-sensitive field
without submitting, and clicking a reversible in-page menu control, both ask for a
human today. That default is the single biggest attention cost in the product.

## Third model and two grader fixes — 2026-11-13 (evening)

Model `deepseek/deepseek-v4.1-flash`, same suite and extension:

| Metric                          | Value                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Measured attempts               | 18 of 18 (0 invalid)                                                              |
| Passed                          | 9 → **50%** (95% CI 29–71)                                                        |
| End-state pass rate             | 72%                                                                               |
| End-state/outcome disagreements | 4                                                                                 |
| Confirmations raised            | 66                                                                                |
| Interruptions per completion    | **7.3**                                                                           |
| Attempts finished unattended    | **0 of 18**                                                                       |
| Failure codes                   | `JSON` 9, `ACT_AMBIGUOUS` 6, `END_STATE_MISMATCH` 5, `MIND2WEB_ACTION_MISMATCH` 3 |

Interruption suite on the same model: `auth-wall` and `session-expiry` both pass,
100% resume, 4 interruptions per completion.

Grader fixes made because of this run:

- **`spa-menu` was unverifiable, not unsolved.** The fixture closed the menu on
  success and left no durable evidence, so the model kept re-checking until the
  attempt timed out. A real SPA leaves a selected-state indicator; the fixture now
  does too, and the task passes. End state had matched all along.
- **`measurable` disagreed with `complete`.** The run summary treated a genuine
  timeout as an unmeasurable run while the report treated it as measured. A timeout
  is a capability failure; only a missing attempt or a silent provider makes a run
  unmeasurable. Both now agree.

## Attention experiment: stop confirming reversible UI state — 2026-11-13

Same model (`deepseek/deepseek-v4.1-flash`), same suite, same extension, one change:
clicks on in-page state controls (menu item, tab, switch, radio, option, `aria-expanded`
/`aria-pressed`/`aria-selected`) and focus keys (Escape, Tab, arrows) no longer raise a
human card. Submit-capable controls, links, navigation, high-risk wording, and **every
mutation on a sensitive credential origin** still confirm. Typing keeps its card on
purpose: the card previews the exact text and the receipt records the delivery.

| Metric                       | Before             | After                   |
| ---------------------------- | ------------------ | ----------------------- |
| Pass rate                    | 9/18 = 50% (29–71) | **11/18 = 61% (39–80)** |
| End-state pass rate          | 72%                | 78%                     |
| Confirmations raised         | 66                 | **25 (−62%)**           |
| Interruptions per completion | 7.3                | **2.27**                |
| Attempts finished unattended | 0/18               | **3/18**                |
| Unsafe deliveries            | 0                  | 0                       |

Largest per-task effects: `spa-menu` 23 → **0** cards and now passes; `iframe-form`
16 → 2; `cross-origin-iframe` 9 → 5; `custom-radio` 1 → 0; `escape-modal` 1 → 0.
`background-tab` and `shadow-control` now pass as well; `custom-dropdown` flipped from
pass to fail on malformed tool arguments.

Caveats: n=1 per configuration, so treat the pass-rate movement as direction, not
proof — the card reduction is mechanical and directly attributable. A broader proposal
(no approval for typing either) was implemented, measured against the browser suite, and
reverted: it dismantles a deliberate design (`inputPreview` + receipt-on-delivery) and
broke 11 approval-contract tests. The narrower change is the one the evidence supports.

## Cross-model summary (local scorecard, 1 run per task)

| Model                                   | Measured | Pass rate (95% CI) | End state | Interruptions / completion | Unattended |
| --------------------------------------- | -------- | ------------------ | --------- | -------------------------- | ---------- |
| `thinkingmachines/inkling-2-small:free` | 17/18    | 88% (66–97)        | 94%       | 2.3                        | 1/17       |
| `deepseek/deepseek-v4.1-flash-fast`     | 18/18    | 61% (39–80)        | 78%       | 6.8                        | 1/18       |
| `deepseek/deepseek-v4.1-flash`          | 18/18    | 50% (29–71)        | 72%       | 7.3                        | 0/18       |

Do not read this as a model ranking: n=18, one run, and the fixtures differ in what
they demand. It does show the instrument discriminates between runs, and that the
attention cost is high for every model tested.

## Caveats

- Single run per task. The interval is wide (66–97) and per-task flakiness is not
  measured yet; treat per-task values as anecdote, not capability.
- 18 tasks, all local fixtures. This says nothing about real sites, real authentication,
  or real side effects — that is the live suite, not yet built.
- The free tier allows 200 model requests per day and was exhausted during this work;
  it resets at 2026-11-14T00:00:00Z. A paid endpoint is required for repeated runs.
- Every measured run is now copied to `artifacts/act-benchmark/history/` (last 10), so a
  paid run survives the next invocation.
