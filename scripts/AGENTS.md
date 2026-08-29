# Scripts DOX

## Purpose

The `scripts/` subtree contains Node.js scripts for building, testing, and smoke-checking the extension.

## Ownership

- `build.js` owns manifest validation, build directory recreation, source file copying, source directory copying, and build metadata generation.
- `test-runner.js` owns structural tests, regression guards, manifest checks, and skill checks; measured coverage belongs to the Vitest toolchain, not this structural runner.
- `smoke-check.js` owns the cheapest manifest and vendored dependency sanity checks.

## Local Contracts

- Scripts are CommonJS Node scripts and assume `process.cwd()` is the repository root.
- `build.js` writes generated output to `dist/`; `dist/` is not source of truth. Builds copy the credential-free starter profile; connection credentials remain user-provided.
- `build.js` copies root manifest-referenced files and the `src`, `libs`, and `skills` directories.
- `test-runner.js` is intentionally structural and should guard contracts that are easy to regress without a browser.
- `smoke-check.js` must remain cheap enough to run often.

## Work Guidance

- Keep scripts cross-platform where practical.
- Prefer clear failure messages that name the missing file, contract, or token.
- Keep `test:browser` pointed at the complete `tests/browser/` suite; CI runs it with headed Chromium under Xvfb.
- Update package scripts when adding new script entry points.
- Update tests when adding source modules with durable contracts.
- Regression guards for `chat.js` concurrency (`isResponseInFlight`, `beginResponseRun`), side-panel event routing (`sourceTabsMatch`, `getRunSourceTabId`), structured prompt contracts (`composeUserPrompt`, raw concatenation patterns), and current-page action contracts (bounded snapshots, stale-state rejection, reserved tools, approval routing, and run-scoped session approval) live in `test-runner.js`.
- The storage regression guard also pins Hermes credential and session keys so future backup or migration changes cannot expose them accidentally. Backup tests also require provider/search credentials to stay out of exported payloads, and custom-tool argument limits to remain enforced.
- The current-page action guard also pins the bounded user-input and owned-tab tool entry points.

## Verification

- Run `npm run test` after changing `test-runner.js` or source contracts it checks.
- Run `npm run smoke` after changing `smoke-check.js`, manifest references, or vendored dependency assumptions.
- Run `npm run build` after changing `build.js`.

## Child DOX Index

- No child AGENTS.md files are currently needed under `scripts/`.
