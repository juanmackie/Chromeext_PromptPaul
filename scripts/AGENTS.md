# Scripts DOX

## Purpose

The `scripts/` subtree contains Node.js scripts for building, testing, and smoke-checking the extension.

## Ownership

- `build.js` owns manifest validation, build directory recreation, source file copying, source directory copying, and build metadata generation.
- `test-runner.js` owns structural tests, regression guards, manifest checks, and skill checks; measured coverage belongs to the Vitest toolchain, not this structural runner.
- Act guards pin all built-in tool names and require the occlusion gate before pointer dispatch, including dispatch through an associated visible label.
- `smoke-check.js` owns the cheapest manifest and vendored dependency sanity checks.
- `verify-vendored-licenses.js` owns reproducible local hash and license-record checks for vendored libraries.
- `act-benchmark.js` owns the explicit opt-in model-driven Act benchmark against local browser fixtures; it is never part of CI. API mode uses an environment key; Codex mode uses Prompt Paul's device-code sign-in in a dedicated ignored browser profile, with credentials retained only in extension-owned storage and reused across benchmark invocations; it never copies credentials from the user's normal Chrome profile. It supports `--task <id>` subsetting, stages the browser harness into the built eval extension, preserves old results until Codex sign-in/model validation succeeds, then replaces `artifacts/act-benchmark/` with `results.json` and bounded per-step traces. Traces are secret-redacted and contain prompts, responses, actions, receipts, and snapshot-byte measurements; the summary reports pass rate/completeness per run against the 80% hold target, plus the independent end-state pass rate and end-state/outcome disagreements so action failures stay separable from outcome-calibration failures. Single runs (`--runs 1`) are the default hold mode; multi-run repeats stay opt-in.
- Its roadmap corpus includes keyboard-only search/modal, hover, hidden owned tabs, viewport reading, prefilled forms, range/date, nested scroll, cross-origin frame, and trusted-key fixtures. Graders inspect end state and exclude redundant edits; importing its exported task/grade helpers must never launch a benchmark. The hidden-tab case must use real visibility, not focus emulation. Structured terminal outcomes become bounded ACT_* failure codes. End-state grading stays independent; runtime blocked/failed outcomes cannot count as success. Older A/B traces without structured outcomes are recorded as unavailable, not inferred from prose.

## Local Contracts

- Scripts are CommonJS Node scripts and assume `process.cwd()` is the repository root.
- `build.js` writes production output to `dist/`, development diagnostics output to `dist-dev/`, and evaluation output to `dist-eval/`; all are generated and are not source of truth. Builds copy the credential-free starter profile; connection credentials remain user-provided. Production directory copies exclude a review-approved development-only file set (`DEV_ONLY_EXCLUDES`, currently `AGENTS.md`) from `src`/`libs`/`skills`, while preserving runtime skill files, vendored assets, license notices, and provenance. Production `build-metadata.json` records the real git revision, clean/dirty working-tree status with the dirty paths, and a reproducible SHA-256 artifact root; a per-file `BUILD.sha256` manifest is written alongside it. Development and evaluation builds keep dev files for debugging and are never packaged or published.
- `verify-vendored-licenses.js` must stay offline and verify every entry in `libs/vendor-manifest.json`, and every shipped third-party asset in `libs/` (plus the root `marked.min.js`) must have a provenance record — any unlisted vendored asset fails the gate.
- `build.js` copies root manifest-referenced files and the `src`, `libs`, and `skills` directories, then installs the no-op diagnostics variants for production builds. Production output omits the no-op MAIN-world page-diagnostics script from its manifest and files; development/evaluation builds retain the active bridge. The evaluation build installs the bounded eval hook and trace only in `dist-eval/`; `dist/` and `dist-dev/` keep the no-op eval modules.
- `test-runner.js` is intentionally structural and should guard contracts that are easy to regress without a browser. The runner guards the P3-02 packaging allowlist (production directory copies exclude `AGENTS.md`) and P3-03 traceability (metadata records the real git revision, clean/dirty status, and artifact checksum).
- `smoke-check.js` must remain cheap enough to run often.

## Work Guidance

- Keep scripts cross-platform where practical.
- Prefer clear failure messages that name the missing file, contract, or token.
- Keep `test:browser` pointed at the complete `tests/browser/` suite; CI runs it with headed Chromium under Xvfb.
- Update package scripts when adding new script entry points.
- Keep development diagnostics build-gated: `build:dev` may include the full tracer in `dist-dev/`, while `build:prod` must exclude it from `dist/`. The evaluation hook is build-gated the same way: `build:eval` enables it only in `dist-eval/`.
- `benchmark:act` requires an explicit `--run` and exercises only ephemeral local fixtures. API mode requires an environment key; Codex mode requires visible-browser device sign-in and an advertised reasoning level; its dedicated ignored browser profile retains extension-owned credentials across runs. It writes bounded metrics and redacted per-step traces to ignored local artifacts only after setup succeeds. A prebuilt eval extension may be selected for A/B runs. The `trusted-key-only` task sets the opt-in `pageActionsPreciseInput` preference for its attempt only; every other task runs with it off. A timed-out attempt never counts as success, and its aborted run still gets a bounded grace period so the trace is captured. Per-run summaries mark missing, duplicate, timed-out, API-error, or harness-error attempts incomplete and report each run plus the overall result against the 80% hold target. Hold mode uses `--runs 1` single-run pilots, including `--task` subsetting.
- Update tests when adding source modules with durable contracts.
- Regression guards for `chat.js` concurrency (`isResponseInFlight`, `beginResponseRun`), side-panel event routing (`sourceTabsMatch`, `getRunSourceTabId`), structured prompt contracts (`composeUserPrompt`, raw concatenation patterns), public-media fetch guards, and current-page action contracts (bounded snapshots, stale-state rejection, reserved tools, approval routing, and run-scoped session approval) live in `test-runner.js`. Source scans skip `artifacts/` because it contains generated browser profiles and benchmark outputs, not project source.
- The storage regression guard pins `pageActionSitePolicies` and its owning source module. It also pins Hermes credential and session keys so future backup or migration changes cannot expose them accidentally. Backup tests also require provider/search credentials to stay out of exported payloads, and custom-tool argument limits to remain enforced.
- The current-page action guard also pins the bounded user-input and owned-tab tool entry points.
- `npm run audit` is the dependency vulnerability gate used by CI and the release-oriented `npm run ci` command.

- Pin orchestrator-only `page_update_plan` in reserved tool/schema guards; it is not a DOM action or a batch member. Register scalar-value mutations in every reserved tool list and working-memory action set; stable IDs are independent of the snapshot element cap. Snapshot byte comparisons retain region identity/counts while dropping duplicate arrays.

## Verification

- Run `npm run test` after changing `test-runner.js` or source contracts it checks.
- Run `npm run smoke` after changing `smoke-check.js`, manifest references, or vendored dependency assumptions.
- Run `npm run build` after changing `build.js`.
- Run `npm run verify:licenses` after changing a vendored library or its license record.

## Child DOX Index

- No child AGENTS.md files are currently needed under `scripts/`.
