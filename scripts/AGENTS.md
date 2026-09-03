# Scripts DOX

## Purpose

The `scripts/` subtree contains Node.js scripts for building, testing, and smoke-checking the extension.

## Ownership

- `build.js` owns manifest validation, build directory recreation, source file copying, source directory copying, and build metadata generation.
- `test-runner.js` owns structural tests, regression guards, manifest checks, and skill checks; measured coverage belongs to the Vitest toolchain, not this structural runner.
- `smoke-check.js` owns the cheapest manifest and vendored dependency sanity checks.
- `verify-vendored-licenses.js` owns reproducible local hash and license-record checks for vendored libraries.

## Local Contracts

- Scripts are CommonJS Node scripts and assume `process.cwd()` is the repository root.
- `build.js` writes production output to `dist/`, development diagnostics output to `dist-dev/`, and evaluation output to `dist-eval/`; all are generated and are not source of truth. Builds copy the credential-free starter profile; connection credentials remain user-provided.
- `verify-vendored-licenses.js` must stay offline and verify every entry in `libs/vendor-manifest.json`.
- `build.js` copies root manifest-referenced files and the `src`, `libs`, and `skills` directories, then installs the no-op diagnostics variants for production builds, including the isolated and main-world content bridges. The evaluation build installs the bounded eval hook and trace only in `dist-eval/`; `dist/` and `dist-dev/` keep the no-op eval modules.
- `test-runner.js` is intentionally structural and should guard contracts that are easy to regress without a browser.
- `smoke-check.js` must remain cheap enough to run often.

## Work Guidance

- Keep scripts cross-platform where practical.
- Prefer clear failure messages that name the missing file, contract, or token.
- Keep `test:browser` pointed at the complete `tests/browser/` suite; CI runs it with headed Chromium under Xvfb.
- Update package scripts when adding new script entry points.
- Keep development diagnostics build-gated: `build:dev` may include the full tracer in `dist-dev/`, while `build:prod` must exclude it from `dist/`. The evaluation hook is build-gated the same way: `build:eval` enables it only in `dist-eval/`.
- Update tests when adding source modules with durable contracts.
- Regression guards for `chat.js` concurrency (`isResponseInFlight`, `beginResponseRun`), side-panel event routing (`sourceTabsMatch`, `getRunSourceTabId`), structured prompt contracts (`composeUserPrompt`, raw concatenation patterns), public-media fetch guards, and current-page action contracts (bounded snapshots, stale-state rejection, reserved tools, approval routing, and run-scoped session approval) live in `test-runner.js`.
- The storage regression guard also pins Hermes credential and session keys so future backup or migration changes cannot expose them accidentally. Backup tests also require provider/search credentials to stay out of exported payloads, and custom-tool argument limits to remain enforced.
- The current-page action guard also pins the bounded user-input and owned-tab tool entry points.
- `npm run audit` is the dependency vulnerability gate used by CI and the release-oriented `npm run ci` command.

## Verification

- Run `npm run test` after changing `test-runner.js` or source contracts it checks.
- Run `npm run smoke` after changing `smoke-check.js`, manifest references, or vendored dependency assumptions.
- Run `npm run build` after changing `build.js`.
- Run `npm run verify:licenses` after changing a vendored library or its license record.

## Child DOX Index

- No child AGENTS.md files are currently needed under `scripts/`.
