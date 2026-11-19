# Act improvement experiment record

Durable, human-reviewed record of changes to Act verified completion, in the style of
a self-improving-memory log: each entry groups attempts by a stable problem ID and
carries the prediction that was written before the change was measured. A superseded
entry stays in place so it can still explain an earlier decision.

This record is developer-owned Markdown, separate from the extension runtime. Do not
put prompts, page text, credentials, or live user data in it: only sanitized summaries
and provenance.

## How to use it

1. Before editing, write the entry: problem ID, hypothesis, predicted effect per task
   ID, and the settings the measurement will use. Never backfill a prediction.
2. Measure the candidate against the same settings on two models. One development run
   per case for triage, three runs per case for the matched acceptance set.
3. Fill in observed fixes, misses, and regressions. Record the disposition and the
   reviewer's rationale.
4. If inspection of a holdout failure informs tuning, retire that case from the
   holdout before another acceptance attempt.

Baseline settings are the five lines in "Measurement settings" below. A run whose
report has `measurable: false`, or an attempt with an invalid reason, is not evidence
about Act: fix the provider or the harness and run again.

## Measurement settings

| Field                | Value as measured for entries below                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Provider route       | `api`: OpenAI-compatible chat completions, streaming, tool calling                                         |
| Endpoint             | Command Code (`api.commandcode.ai/provider/v1/chat/completions`)                                           |
| Primary model        | `deepseek/deepseek-v4.1-flash` (`reasoningLevel` empty, as reported)                                       |
| Second model         | `z-ai/glm-5.3-flash` (`reasoningLevel` empty, as reported)                                                 |
| Suite / fixture rev. | `--suite scorecard`, 18 tasks; fixture digests in each run's evidence                                      |
| Runs per task        | 1 for development triage, 3 for the matched acceptance set                                                 |
| Browser              | Playwright Chromium 158.0.8127.18, full Chromium new headless, Linux                                       |
| Report schema        | 4                                                                                                          |
| Build fingerprint    | `configFingerprint` in the run report (includes the eval build digest)                                     |
| Evidence             | Sanitized copy under `artifacts/act-benchmark-history/`; raw page text and traces stay local and untracked |

## Experiment template

Copy this block for a new entry. Leave a field blank rather than invent a value.

```markdown
### EX-nnn · <problem ID> · <one-line title>

- **Problem ID:** <stable ID, reused by every attempt at this problem>
- **Attempt date:** <YYYY-MM-DD>
- **Status:** predicted | measured | reverted | backfilled
- **Hypothesis:** <what is wrong, and why this edit should fix it>
- **Rationale / change:** <commit, diff summary, or experiment description>
- **Predicted effect by task ID:** <task → expected change, written before measuring>
- **Holdout cases:** <IDs never used for tuning, or "none: see caveat">
- **Observed fixes:** <task ID → evidence>
- **Observed misses:** <task ID → evidence>
- **Observed regressions:** <task ID → evidence>
- **Safety and approval evidence:** <confirmations, denied cards, injection probes>
- **Disposition:** retained | revised | reverted
- **Reviewer rationale:** <who reviewed, what they concluded>
- **Evidence:** <sanitized report reference, fingerprint, createdAt>
```

## Records

### EX-001 · FORCED-TOOL-CHOICE · Tolerate a provider that rejects a forced call

- **Problem ID:** FORCED-TOOL-CHOICE
- **Attempt date:** 2026-11-13
- **Status:** backfilled (written after the fact; no prediction was recorded)
- **Hypothesis:** A thinking-mode provider rejects a forced `tool_choice` with HTTP 400.
  Act forces the final-verification `page_get_state` call, so every affected run died
  before it could verify anything.
- **Rationale / change:** commit `d0af24f` retries the rejected call once with
  `tool_choice: auto`, keeps the tool list unchanged, and remembers the downgrade for
  the rest of the run.
- **Predicted effect by task ID:** _blank — backfilled._
- **Holdout cases:** none at the time.
- **Observed fixes:** both interruption tasks (`auth-wall`, `session-expiry`) pass on
  `deepseek/deepseek-v4.1-flash`; two live rejections each downgraded and completed.
- **Observed misses:** none recorded for the downgrade itself.
- **Observed regressions:** none recorded.
- **Safety and approval evidence:** the downgrade changes only how the call is made; it
  does not change the page-action policy, so all confirmations stayed in force.
- **Disposition:** retained.
- **Reviewer rationale:** model-specific compatibility with a bounded retry. The
  caveat is part of the record: a second rejection in the same run is not retried, so a
  provider that rejects `auto` too still fails the run.
- **Evidence:** `artifacts/act-benchmark-history/` for that date; schema 4; 0 invalid
  attempts on the interruption suite.

### EX-002 · APPROVAL-PREVIEW · Do not remove the typing confirmation

- **Problem ID:** APPROVAL-PREVIEW
- **Attempt date:** 2026-11-13
- **Status:** backfilled (written after the fact; the revert is the finding)
- **Hypothesis:** the confirmation card for typing is the single largest attention
  cost, so removing it for plain text entry should raise unattended completions
  without changing end state.
- **Rationale / change:** a broader proposal stopped confirming `page_input`,
  `page_set_value`, and `page_select`. It was implemented, measured, and reverted in
  commit `6659113`.
- **Predicted effect by task ID:** _blank — backfilled._
- **Holdout cases:** none at the time.
- **Observed fixes:** the pre-change attention experiment did reduce cards for
  reversible in-page state controls (66 → 25 confirmations, 7.3 → 2.27 interruptions
  per completion) and that narrower change was kept.
- **Observed misses:** the broader typing change broke the deliberate preview: the card
  no longer showed the exact text before delivery, and the receipt no longer recorded
  it.
- **Observed regressions:** 11 approval-contract tests failed.
- **Safety and approval evidence:** the revert restores the preview and receipt
  contract; sensitive-field restrictions were never relaxed.
- **Disposition:** reverted. The narrower reversible-control change was retained.
- **Reviewer rationale:** the caveat stays attached: removing a deliberate preview and
  receipt is not an attention optimization, it is a policy regression that a pass-rate
  number alone would not show.
- **Evidence:** the same-day baseline report and the browser suite result cited in
  `docs/ACT_BENCHMARK_BASELINE.md`.

### EX-003 · TOOL-ARGUMENT-MERGE · Keep the closing brace of nested arguments

- **Problem ID:** TOOL-ARGUMENT-MERGE
- **Attempt date:** 2026-11-19
- **Status:** predicted before measurement; results appended below.
- **Hypothesis:** streaming tool-argument assembly drops a legitimate fragment when the
  fragment repeats the end of the buffer (`existing.endsWith(incoming)`). A streamed
  JSON object closing a nested object therefore loses its final `}`. Reproduced from
  live provider fragments: 46 fragments ending `…"url_changes"`, `}`, `}` merge to
  invalid JSON, which the runner reports as `Invalid tool arguments format`. The same
  defect appears in the baseline as the top failure code (`JSON`, 6 of 18 attempts on
  the primary model) and in every historical model.
- **Rationale / change:** keep a repeated closing fragment while the buffer still has
  open JSON structure (bracket depth or an open string), and keep the duplicate rule
  otherwise. Touches tool-argument assembly only; page-action policy, confirmations,
  resume behaviour, and the fresh-evidence requirement are untouched.
- **Predicted effect by task ID:**
  - `mind2web-37564222`: fail → pass. It failed in the baseline solely on four
    consecutive malformed-argument `page_click` attempts.
  - `hover-menu`, `prefilled-form`, `autocomplete`, `iframe-form`,
    `cross-origin-iframe`: no pass/fail change expected; fewer malformed-argument
    attempts and fewer wasted turns.
  - `nested-scroll`, `shadow-control`: unchanged (loop guards, not argument errors).
  - `mind2web-1a16a98f`, `mind2web-0633c328`: unchanged (a tab-unavailable abort and a
    provider failure, not argument errors).
  - Interruptions per completion: hold or improve; the change adds no confirmations.
- **Holdout cases:** `holdout-slot-picker`, `holdout-field-edit` — authored and frozen
  before this entry, absent from the scorecard, and only inspected after the candidate
  was frozen. Predicted: both pass, with no unsafe delivery, on both models.
- **Observed fixes:** _recorded below after measurement._
- **Observed misses:** _recorded below after measurement._
- **Observed regressions:** _recorded below after measurement._
- **Safety and approval evidence:** _recorded below after measurement._
- **Disposition:** _pending measurement._
- **Reviewer rationale:** _pending independent review._
- **Evidence:** baseline report `results-20261119T1909.json` (primary model) and
  `results-20261119T1933.json` (second model) in `artifacts/act-benchmark-history/`;
  schema 4; `configFingerprint` recorded per report.
