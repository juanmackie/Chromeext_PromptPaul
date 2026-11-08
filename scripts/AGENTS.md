# Scripts contract

Scripts are CommonJS Node programs run from the repository root.

- `build.js` validates the Manifest V3 package and creates `dist/`, `dist-dev/`, or `dist-eval/`. These directories are generated; production output excludes `AGENTS.md`, and development/evaluation output is never published.
- `test-runner.js` checks manifest references, package/manifest version agreement, permission duplication, and references in `dist/` when it exists. Keep source behavior and architecture assertions in Vitest, not text matching.
- `smoke-check.js` checks manifest references and conflicts between vendored and npm dependency sources.
- `verify-vendored-licenses.js` verifies the lockfile provenance records and hashes for shipped third-party assets.
- `act-benchmark.js` is opt-in and runs against local browser fixtures. It requires `--run`, writes ignored artifacts, and runs in CI only through the nightly and PR score workflows. The fixed `--suite scorecard` selects 15 local tasks plus three Mind2Web tasks for nightly history and base/head comparison.
- `test-browser.js` builds the requested development or production extension, stages the browser harness into that generated output, and runs Playwright. `stage-browser-harness.js` owns the staging operation.
- Production metadata records the Git revision, working tree state, and artifact checksums. Do not hand-edit generated build output or metadata.

Keep scripts cross-platform where practical and report failures with the affected file or contract. Run the relevant package script after changing a script; behavior belongs in Vitest, browser behavior in Playwright.
