# Dream-RSI Assessment — PromptPaul (Chromeext_PromptPaul)

Read-only assessment (skill: `dream-rsi-assess`). No loop started; no adapter/dataset verified live because both are missing.

## Context (retrieved evidence, not behavior inference)

Project: Chrome extension `prompt-paul` v6.3.0 (Manifest V3). Root `AGENTS.md` defines contracts for `RunOrchestrator.js`, `ChatComposer.js`, evaluation hooks, and the build/eval pipeline.

Evidence sources inspected (no fabricated results):

- `.dream-rsi/task.json` (seed config)
- `.dream-rsi/campaigns/*/*.json` (4 campaigns: `69b2d...`, `74b893...`, `d0a5db...`, `d15cda...`)
- `.dream-rsi/checks/2026-10-18T00-56-03-529Z-9ede01c5.json` (last check result)
- `task/problem.md` (problem description)
- `scripts/build.js`, `scripts/test-runner.js`
- Source: `src/utils/evalHook.eval.js`, `src/utils/evalTrace.eval.js`, `src/orchestrator/RunOrchestrator.js`
- Git history (`git log --oneline -10`): `01187a0` (ignore dream-RSI files), `05597ea` (journal persistence), `5a0f2c3` (eval hooks & trace capture), `067090c` (harden act loops), `ce048ec` (benchmark fingerprinting)
- File system (`ls`, `du -sh`): `adapter/` missing; `C:/datasets/Mind2Web/` unconfirmed; `artifacts/` ≈ 115 MB; `dist-dev/` = 5.1 MB; `dist-eval/` = 5.0 MB
- `dream_rsi_signals` aggregates: `npm test` failed 13 times (last `2026-10-06`); `npm test` duration up to 1,951,817 ms across 53 calls; 16 session compactions; 155 shell failures; 26 node failures.

Key observations:

- `.dream-rsi/task.json` explicitly states: adapter (`adapter/measure.sh`) NOT verified; dataset (`C:/datasets/Mind2Web`) not confirmed present; `measure_seed` false.
- `.dream-rsi/checks/*.json` records `eval_error`: `evaluator exited with code 1: Mind2Web evaluator failed: harness_run_failed`; `valid`: false; `qualified`: false; `recommendedEvaluatorTimeoutMs`: 317454.
- All campaign JSONs reference the same missing adapter (`adapter/dream-rsi-mind2web-score.mjs`) and missing dataset (`test_domain_0..9.json`).
- The adapter directory (`adapter/`) does not exist inside the repo; the referenced Dream-RSI adapter path (`C:/Users/juanm/Documents/GitHub/pi Dream-RSI/adapter/`) does not exist locally.
- `task/problem.md` calls out the same gap: "The adapter (`adapter/measure.sh`) is NOT yet verified against the harness; ... Before any live cycle, verify the adapter runs correctly..."
- Build script creates `dist-eval/` for evaluation (`--eval`) but `.gitignore` excludes it; it remains in working tree.
- `artifacts/` contains persistent benchmark profiles (`act-benchmark-codex-profile/` = 62 MB — browser profile artifacts including `Crashpad/`, `CertificateRevocation/`, `Default/Account Web Data`, cookies), trace logs (`browser-diagnostics-final/` = 776 KB, 36 files), and staged harness dependencies (`browser-tools/node_modules` = 113 MB).

---

## Lever 1 — Repair broken Mind2Web evaluation adapter/dataset references (strongest, ready)

Mechanism: The evaluation pipeline is non-functional because `.dream-rsi/task.json`, `.dream-rsi/campaigns/*/*.json`, and `task/problem.md` reference a missing adapter (`adapter/measure.sh` or `adapter/dream-rsi-mind2web-score.mjs`) and a dataset (`C:/datasets/Mind2Web/data/test_domain/test_domain_0..9.json`) that is unconfirmed present. Without these, any optimization loop against `RunOrchestrator.js` will fail with the same `harness_run_failed` error (last observed in `.dream-rsi/checks/`, 317+ s per failed run).
Files: `.dream-rsi/task.json`, `.dream-rsi/campaigns/*/*.json`, `task/problem.md`, `adapter/` (missing), dataset `C:/datasets/Mind2Web/` (unconfirmed).
Evidence (retrieved):

- `.dream-rsi/task.json`: `score_program` points to `C:/Users/juanm/Documents/GitHub/pi Dream-RSI/adapter/measure.sh ...` (path does not exist); `problem_file` points to `task/problem.md` (exists and confirms gap); notes say adapter NOT verified and dataset not confirmed.
- `.dream-rsi/checks/*.json`: `fail_class`: `eval_error`; `error`: `Mind2Web evaluator failed: harness_run_failed`; `valid`: false.
- Campaign JSONs (`69b2d...`, `74b893...`, `d0a5db...`, `d15cda...`): `score_program` = `adapter/dream-rsi-mind2web-score.mjs`; dataset references `test_domain_0..9.json`; `eval_program` = `src/orchestrator/RunOrchestrator.js`.
- `adapter/` directory: does not exist (verified by `ls`). The referenced `C:/Users/juanm/Documents/GitHub/pi Dream-RSI/adapter/` also does not exist.
- `C:/datasets/Mind2Web/`: no files found locally; unconfirmed.
  Measurable outcome (observable, not invented): Adapter verification passes — either (a) `node adapter/measure.sh ...` (or equivalent) runs successfully and writes `eval/score.json` with `valid: true`, `fail_class: "ok"`, or (b) the gap is explicitly documented in `.dream-rsi/task.json` and `problem.md` stating adapter is unavailable and dataset is missing; `.dream-rsi/checks/` no longer shows repeated `harness_run_failed` (either a successful check or an explicit blocked status).
  Evaluator / correctness gates: `npm run smoke` passes (`manifest.json` references valid); `npm run test` (unit) passes (`scripts/test-runner.js`); `RunOrchestrator.js` unchanged until adapter works; `.gitignore` excludes `dist-eval/` and artifacts; no secrets added; `.dream-rsi/task.json` notes updated only.
  Expected effect (inference, labeled): Once adapter/dataset references are verified or explicitly documented as unavailable, the Mind2Web 10-case benchmark can actually run, making any change to `RunOrchestrator.js`, prompts, or tool definitions measurable. Without this, every loop attempt wastes ~317 s (`recommendedEvaluatorTimeoutMs` from `.dream-rsi/checks/`). Confidence: high (evidence is direct file-system absence and explicit notes in `.dream-rsi/task.json` and `problem.md`). Readiness: ready — no code changes needed, only verification or documentation.

---

## Lever 2 — Clean persistent artifact bloat (immediate, observable, safe)

Mechanism: `artifacts/` accumulates benchmark profiles, trace logs, and staged harness dependencies that inflate the workspace size. `problem.md` notes a 765 MB seed workspace and that "Every attempt copies this workspace." Reducing artifact size directly lowers loop startup overhead.
Files: `artifacts/act-benchmark-codex-profile/` (62 MB — browser profile artifacts: cookies, `Crashpad/`, `CertificateRevocation/`, `Default/Account Web Data`), `artifacts/browser-tools/node_modules` (113 MB — staged harness dependencies), `artifacts/browser-diagnostics-final/` (776 KB, 36 trace JSON files), `artifacts/answer-cards/` (689 KB — build/test logs), `dist-dev/` (5.1 MB), `dist-eval/` (5.0 MB), `dist/` (generated).
Evidence (retrieved):

- `du -sh artifacts/*`: `act-benchmark-codex-profile` = 62 MB; `browser-tools` = 113 MB; `browser-diagnostics-final` = 776 KB; total `artifacts/` ≈ 115 MB (excluding `browser-tools/node_modules` the directory is ~2 MB, but the node_modules itself is 113 MB).
- `.gitignore`: excludes `dist-dev/`, `dist-eval/`, `dist/`, `coverage/`, `test-results/`, `.env`, `.env.local` — but does not exclude `artifacts/`. Persistent profiles (`act-benchmark-codex-profile/`) are not needed for source truth.
- `scripts/build.js`: creates `dist-dev/` (`--dev`) and `dist-eval/` (`--eval`); these are generated, not source.
  Measurable outcome: `du -sh artifacts/` decreases; `du -sh .` (workspace size) decreases; `npm run build` and `npm run smoke` pass; no evaluation fixtures (`tests/browser/fixtures/`) deleted; `.dream-rsi/` preserved.
  Evaluator / correctness gates: `npm run smoke` (`scripts/smoke-check.js`) passes — it verifies manifest references; `npm run build:eval` creates a fresh `dist-eval/` if needed; `npm run test` passes; `.dream-rsi/task.json` and `.dream-rsi/checks/` preserved; `tests/browser/fixtures/act-benchmark.html` untouched (benchmark fixtures must stay); any needed trace logs moved (not deleted) only if explicitly safe.
  Expected effect (inference): Workspace copy time (noted in `problem.md`) reduces; disk usage drops; loop startup faster. Removing `browser-tools/node_modules` is lower-confidence (it may be a staged harness copy needed by `tests/browser/browserTestSupport.js`); safe removal targets are benchmark profiles (`act-benchmark-codex-profile/`), old trace logs (`browser-diagnostics-final/` if no active audit needs them), `dist-dev/`, `dist-eval/`, and redundant build outputs. Confidence: high for profile/log/build cleanup; medium for `browser-tools/node_modules` without confirming its dependency purpose. Readiness: ready for safe cleanup.

---

## Lever 3 — Document adapter verification gap and dataset dependency (ready, lower impact but durable)

Mechanism: The `.dream-rsi/task.json`, campaigns, and `problem.md` all reference missing adapter/dataset, but no documentation explains how to obtain them. A new doc or updated `.dream-rsi/task.json` notes would prevent future failed loops and make the gap explicit for any agent.
Files: `.dream-rsi/task.json` (notes field), `.dream-rsi/campaigns/*/*.json` (could add comments or be preserved as-is with a note), `docs/EVAL_ADAPTER_SETUP.md` (new, optional), `README.md` (if evaluation instructions exist — they do not in current `README.md` as of inspection; only `docs/PRODUCTION_READINESS.md` and `docs/ACT_RELIABILITY_BASELINE.md` reference evaluation).
Evidence (retrieved): `problem.md` explicitly calls out the gap; `.dream-rsi/task.json` notes it; campaigns reference the same missing files; no adapter directory exists; `docs/` does not contain adapter instructions.
Measurable outcome: Updated `.dream-rsi/task.json` notes (or new doc) clearly state: adapter source/repo (`C:/Users/juanm/Documents/GitHub/pi Dream-RSI/adapter/measure.sh` or `prompt-paul-agent-eval` repo); dataset location (`C:/datasets/Mind2Web/`); verification command (`node adapter/measure.sh ...` with scratch workspace); whether `measure_seed` is required; current adapter status (`unverified` / `missing`).
Evaluator / correctness gates: No source code changed; `.dream-rsi/task.json` notes updated only; `README.md` or new doc added without secrets; `.gitignore` unchanged.
Expected effect (inference): Future loop attempts will know whether adapter is available rather than running a 317+ s evaluation that fails with `harness_run_failed`. Confidence: high. Readiness: ready.

---

## Lever 4 — Verify evaluation hooks and adapter integration (blocked until adapter verified)

Mechanism: Recent commit `5a0f2c3` added `src/utils/evalHook.eval.js` (`TEST_RUN_TASK`, `MAX_TASK_CHARS`, `dryRun`) and `src/utils/evalTrace.eval.js` (`MAX_TRACE_CHARS`, `MAX_STEPS`, `SECRET_KEY_PATTERN`). `scripts/build.js` installs these into `dist-eval/`. The adapter (`measure.sh` / `dream-rsi-mind2web-score.mjs`) is supposed to call these hooks. Before any optimization loop, adapter must invoke the hooks correctly.
Files: `src/utils/evalHook.eval.js`, `src/utils/evalTrace.eval.js`, `scripts/build.js`, `tests/evalHook.test.js`, `tests/evalTrace.test.js`, `dist-eval/` (generated).
Evidence (retrieved): `scripts/build.js` copies `evalHook.eval.js` → `evalHook.js` for `--eval` builds; `.gitignore` excludes `dist-eval/`; `.dream-rsi/task.json` says `eval_program` = `src/orchestrator/RunOrchestrator.js`. The adapter is unverified, so hook integration is unverified.
Measurable outcome: A manual/scripted check (`node adapter/measure.sh ...` with scratch workspace + dataset) produces `eval/score.json`; `TEST_RUN_TASK` and `TEST_GET_TRACE` handlers respond; `dist-eval/` passes `npm run smoke` (manifest references valid, service_worker exists); `tests/evalHook.test.js` and `tests/evalTrace.test.js` pass (unit tests for hook contracts); no secrets in `dist-eval/` (verified by `grep -E` secret patterns across `dist-eval/src/`).
Evaluator / correctness gates: `npm run smoke` passes; `npm run test` passes; adapter produces valid score; `.dream-rsi/task.json` updated to note adapter verified; `.gitignore` excludes `dist-eval/`.
Expected effect (inference): Once adapter works, the loop can iterate on `RunOrchestrator.js` and measure exact-action accuracy. Without this, optimization attempts are blind. Confidence: medium — adapter is missing; verification is blocked. Readiness: blocked until adapter/dataset verified (depends on Lever 1 and 3).

---

## Lever 5 — Clean stale `.dream-rsi/checks/` and campaign artifacts (inference, lower priority)

Mechanism: `.dream-rsi/checks/` contains a persistent failure (`2026-10-18T00-56-03-529Z-...json`) with `valid`: false, `fail_class`: `eval_error`. Campaign directories (`69b2d...`, `74b893...`, `d0a5db...`, `d15cda...`, `e82cb...`) contain seeds referencing the broken adapter. Cleaning or archiving these prevents confusion but also preserves evidence.
Files: `.dream-rsi/checks/*.json`, `.dream-rsi/campaigns/*/*.json`, `.dream-rsi/task.json`.
Evidence (retrieved): One check file exists (failed); 5+ campaign directories exist; `.dream-rsi/task.json` is the seed.
Measurable outcome: Old check files moved to `.dream-rsi/checks/archive/` (if needed) or deleted after confirming no audit requirement; `.dream-rsi/task.json` notes updated; campaigns preserved with adapter-status note (not deleted, since they contain evaluation scope information).
Evaluator / correctness gates: No source files deleted; `.dream-rsi/task.json` and `problem.md` preserved; evaluation evidence retained if needed for audit.
Expected effect (inference): Reduces confusion for future loop starts; makes adapter gap explicit in history. Confidence: medium. Readiness: ready but lower priority than adapter verification.

---

## Recommendation

Strongest ready lever: **Lever 1 + 2 together**.

- Lever 1 (document/verify adapter/dataset): Ready, no source changes needed, directly unblocks any optimization measurement.
- Lever 2 (clean artifact bloat): Ready, safe, observable (reduced `artifacts/` and workspace size), improves loop startup time per `problem.md`.
- Lever 3 (document gap): Ready, durable documentation improvement.
- Lever 4 (verify hooks): Blocked — depends on adapter verification.
- Lever 5 (clean `.dream-rsi/` artifacts): Ready but lower priority.

No unverified command output was fabricated. The adapter is missing; no evaluation was attempted live; all claims about adapter state rest on direct file-system inspection (`ls` of `adapter/`, `.dream-rsi/task.json`, campaigns, `.dream-rsi/checks/`, `problem.md`).

---

## `/dream-rsi loop` command (recommended)

```
/dream-rsi loop "Verify adapter/measure.sh and C:/datasets/Mind2Web exist and produce a valid eval/score.json for the Mind2Web 10-case benchmark; if adapter/dataset is unavailable, document the gap in .dream-rsi/task.json and clean artifact bloat (artifacts/act-benchmark-codex-profile/, old trace logs, dist-dev/, dist-eval/) to reduce workspace copy overhead."
```

This loop goal is safe, bounded, and does not require the adapter to work before starting — it verifies adapter status first (and documents failure if still broken), then proceeds to safe cleanup. It aligns with the evidence in `.dream-rsi/task.json` and `problem.md`.

---

## Gaps / unverified claims (explicitly labeled as inference)

- Adapter verification: Not performed. Adapter directory does not exist; dataset unconfirmed. The claim that fixing adapter references enables measurement is an inference based on `.dream-rsi/task.json`, campaigns, and `problem.md`, not on a live adapter run.
- `browser-tools/node_modules` purpose: Not fully inspected. Removing it is lower-confidence; safe cleanup targets are benchmark profiles and generated build outputs.
- `npm test` failures: Historical (`dream_rsi_signals` reports 13 failures, last `2026-10-06`). Not reproduced in this session; root cause not inspected.
- `artifacts/browser-diagnostics-final/` trace files: Not inspected individually; presumed non-essential for current loop but could contain audit-relevant evidence. Safe approach: archive before deletion.

## Confidence: 85%

What it rests on: Direct file-system evidence (`ls` of `adapter/`, `.dream-rsi/task.json`, `.dream-rsi/checks/`, `problem.md`, campaigns, `scripts/build.js`, `artifacts/` sizes) and retrieved `dream_rsi_signals` aggregates. The only significant gap is live adapter verification (blocked by missing adapter/dataset), which is explicitly noted. The assessment does not claim any unverified evaluation passed.
