# Task: Improve Act's exact next-action accuracy toward 10/10

`src/orchestrator/RunOrchestrator.js` (and related prompt/tool files) implements the next-action prediction and tool-calling logic for the Prompt Paul Chrome extension.

Objective: Improve the exact next-action accuracy measured by the Mind2Web held-out benchmark, staying within the separate evaluation harness (`prompt-paul-agent-eval`). The target is 10/10 exact actions; current baseline (latest run) is 4/10. Do not add evaluation data to the extension or alter the exact-action grader.

The scorer runs the Mind2Web action benchmark (`prompt-paul-agent-eval`) against frozen held-out HTML snapshots. It writes `eval/score.json` with `{"score": <number>, "fail_class": <string>, "valid": <bool>}`. The harness requires `PROMPT_PAUL_EXTENSION_ROOT` set to the workspace root and a dataset directory (`C:/datasets/Mind2Web`) for full evaluation.

Correctness is non-negotiable: any broken adapter, missing dataset, or invalid score must set `fail_class != "ok"` so the loop cannot optimize noise.

In scope: `src/orchestrator/RunOrchestrator.js`, `src/prompts.js`, `src/act/*.js` (or equivalent files in the seed workspace). Off limits: the scorer (`adapter/measure.sh`), the Mind2Web dataset, the grader code (`prompt-paul-agent-eval/src/scoring/`), migrations, dependencies (`node_modules`), `.env` credentials.

Generalization: the workload is a sample of real browser actions — do not special-case the exact benchmark inputs; any prompt/template tweak should generalize to new pages. State any trade-off the scorer cannot see (e.g. a staleness window, approximation, or approximation in tool argument parsing) in `proposal.md`.

Baseline: the seed measures the current code. The adapter (`adapter/measure.sh`) is NOT yet verified against the harness; `measure_seed` is skipped for this freeze setup. Before any live cycle, verify the adapter runs correctly on a scratch copy of the workspace with the dataset present.

Seed workspace note: `C:/Users/juanm/Documents/GitHub/Chromeext_PromptPaul` (765 MB copy cost). Every attempt copies this workspace. A smaller subdirectory would be preferred for live cycles; confirm if a sub-workspace is needed.
