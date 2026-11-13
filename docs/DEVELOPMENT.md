# Development Guide

## Requirements

- Node.js 22 or newer
- Chrome or Edge for extension testing
- Git for source control

## Setup

```bash
git clone https://github.com/juanmackie/Chromeext_PromptPaul.git
cd Chromeext_PromptPaul
npm install
```

Run `npm run build:dev`, then load `dist-dev/` from `chrome://extensions/`. Browser libraries are copied from locked npm packages during the build, so the source checkout itself is not an unpacked extension. Source checkouts and release builds contain no starter credential; configure your own OpenRouter or other compatible endpoint and API key in Options. For detailed local troubleshooting, see [Development Diagnostics](DIAGNOSTICS.md).

## Project Layout

- `background.js` - service worker and context menu handling
- `chat.js` - side panel entry point
- `options.js` - settings and library management
- `content_script_unified.js` - page extraction plus opt-in semantic page snapshot/action handling
- `content_script_notch.js` - optional isolated browser-page quick-action notch
- `pdfContentScript.js` - PDF extraction
- `src/chat/` - chat UI, API, media, skills, and streaming modules
- `src/utils/` - shared helpers for budgeting, routing, validation, page snapshots/policy, and storage
- `skills/` - built-in skill definitions
- `docs/` - documentation
- `tests/page-action-evaluation.json` - credential-free page-action evaluation corpus
- `tests/browser/` - real-browser integration tests and browser-safe evaluation
- `scripts/` - build, smoke, and test scripts

## Common Commands

```bash
npm run build
npm run build:dev
npm run build:eval
npm run build:prod
npm run test
npm run smoke
npm run test:browser
npm run validate
npm run audit
npm run release:prepare
```

## Release

Add the release notes under the newest version heading in `CHANGELOG.md`, then run
`npm run release:prepare` to synchronize `package.json`, `package-lock.json`, and
`manifest.json`. Update the Chrome Web Store “What's new” section in
`docs/STORE_LISTING.md` by hand in user language. Commit and merge those files to `main`,
configure the store secrets below, then push a matching `v<version>` tag
(for example `v6.4.0`). The tag workflow reruns CI, builds and uploads the production zip,
then creates a GitHub Release with checksums and build metadata. It checks the store
secrets before installing dependencies so a tag without credentials fails immediately.

Configure these repository Actions secrets before the first automated store upload:
`CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_EXTENSION_ID`, and `CWS_PUBLISHER_ID`.

In GitHub repository settings, protect `main` with the `validate`, `browser`, and `build` jobs as required checks. Those repository settings are not stored in this checkout.

## Act Benchmark

The opt-in Act benchmark runs against local fixtures. Its fixed Mind2Web subset and sanitized page snapshots live in `eval/mind2web/` and `tests/browser/fixtures/`. Run it by hand with `npm run benchmark:act -- --run`; it is not wired into CI until the score is stable across repeated manual runs. The checked-in subset comes from the Mind2Web training split and is hash-pinned with attribution in `eval/mind2web/README.md`.

A run that stops for a provider error is retried twice before the run is declared unmeasurable, and every measured run is copied to `artifacts/act-benchmark/history/` (last 10 kept) so a paid run survives the next invocation. The safety audit counts URL-bearing actions only when they carry a URL, and ends each attempt with a tab-origin audit, so an index-based link is judged by where the tab actually landed rather than by a guessed URL. The first measured baseline is recorded in `docs/ACT_BENCHMARK_BASELINE.md`.

Two tasks exercise interruption, which is the behaviour the product target depends on: `auth-wall` (a sensitive sign-in control blocks the run) and `session-expiry` (the session dies mid-task and discards the typed value). Each allows exactly one human step: the benchmark plays the human in the tab, resumes the run through the existing pause/resume path, and grades `resumeSuccessRate`, mean interruption wait, and whether the task still reached its end state. Every other task keeps the strict contract — a run that stops for a human, or asks a question instead, fails by name (`MANUAL_INTERVENTION_REQUIRED`, `UNEXPECTED_USER_QUESTION`, `INTERRUPTION_BUDGET_EXCEEDED`, `RESUME_FAILED`).

The report separates a capability measurement from a broken instrument. An attempt that ends without a model response (`API`) or inside the harness (`harness_error`) is recorded as invalid and excluded from every rate; the run then prints `INVALID RUN` with the counts instead of a score, and `scripts/compare-act-scores.js` refuses such a report as a baseline or a candidate. Rates carry a Wilson 95% interval so a single small run cannot be read as a precise score. The report also carries a `attention` block — confirmations, manual interventions, interruptions per completion, unattended completions, and median completion time — because the product target is task completion at minimal human attention, not pass rate alone. Read `failureSummary` when choosing the next refinement; per-step traces under `artifacts/act-benchmark/traces/` show what the model actually did.

The local diagnostic uses a headed temporary browser. Hold mode is single-run pilots toward the 80% overall target. To use Codex, set these PowerShell variables and start one run:

```powershell
$env:PROMPT_PAUL_BENCHMARK_PROVIDER = 'codex'
$env:PROMPT_PAUL_BENCHMARK_MODEL = 'Luna by OpenAI'
$env:PROMPT_PAUL_BENCHMARK_REASONING_LEVEL = 'medium'
node scripts/act-benchmark.js --run --runs 1
```

Single-task pilots use `--task <id> --runs 1`. Use `--runs 2..10` only for repeatability checks.

Complete the normal Prompt Paul device-code sign-in in the opened browser. The extension keeps authentication in its own dedicated profile at `artifacts/act-benchmark-codex-profile`; the runner does not read or export tokens, and later runs reuse that profile. It checks that the selected model advertises the requested reasoning level. If the model label does not match, set `PROMPT_PAUL_BENCHMARK_MODEL` to an exact ID from the available-model error. The benchmark replaces `artifacts/act-benchmark/` only after sign-in and model validation succeed. To remove the saved Codex session, close the benchmark browser and delete only `artifacts/act-benchmark-codex-profile`; this removes the local sign-in, and you can authenticate again later. API mode remains available with `PROMPT_PAUL_BENCHMARK_API_KEY` and an optional compatible endpoint.

## Working Loop

1. State the user need, the smallest useful change, assumptions, edge cases, and security risks.
2. Delete obsolete code or dependencies before adding abstractions.
3. Make the change in source and add readable tests for the common and failure cases.
4. Run the full local gate: `npm run validate` (lint, formatting, structural tests, behavior tests, and smoke checks).
5. Run `npm run smoke` again when manifest or vendored dependencies changed.
6. Run `npm run audit` before release; CI runs the same dependency gate before browser and build jobs.
7. Run `npm run verify:licenses` after vendored-library changes.
8. Build with `npm run build`.
9. Reload the unpacked extension in Chrome.
10. For notch changes, verify the default-off state, explicit Options save, live enable/disable updates, edge-pinnable placement with along-edge rail dragging and remembered placement/offset, hover-reveal and click-to-pin behavior, Shadow DOM isolation, keyboard focus/Escape behavior, selection gating, supported-page actions, and restricted-page rejection.
11. For page-action changes, test both Act-off ordinary chat and Act-on static forms/SPAs with approval, stale DOM, sensitive-field, restricted-page, Stop, worker-restart, receipt, checkpoint, explicit-resume, accessible-name, scope-diff, and manual-intervention cases. Confirm that Pause for user requires explicit Resume and a fresh inspection, and that unverified mutations are not repeated. Test foreground and background owned-tab opening, readiness after `tabs.create`, bridge-failure quarantine, source-tab close blocking, bounded recovery backoff, the separate 256/96/64 action budgets, twelve-tab lease, task-note/history bounds, session-only planner/replanning, final verification, and fresh inspection after switching. A reconnect may restore activity status or offer an explicit checkpoint Resume, but must not resume actions automatically. Run `npm run test:browser` for the unpacked-extension Playwright suite; use `PROMPT_PAUL_BROWSER=chrome` or `PROMPT_PAUL_BROWSER=edge` when validating an installed branded browser. Branded runs load the unpacked directory through the browser-level CDP Extensions domain, which is required by Chrome 137+ and equivalent Edge builds. The browser evaluator records bounded result, policy, consistency, and scope metrics only; restricted-page and Hermes provider boundaries stay in the unit matrix.

See [Production Readiness](PRODUCTION_READINESS.md) for the concise review contract.

## Adding Modules

When you add a new module:

1. Put business logic under its owning `src/<capability>/` area; keep `src/utils/` for stable behavior shared by capabilities.
2. Add `@fileoverview` and `@module` JSDoc.
3. Export the public API explicitly and import it from the owning capability index or entry point.
4. Add behavior coverage in `tests/` for runtime logic. Keep `scripts/test-runner.js` focused on manifest and build checks.

## Adding Skills

1. Create `skills/<skill-name>/SKILL.md`
2. Register it in `skills/skills.json`
3. Verify it with `/skills` in chat
4. See [SKILL_EXAMPLES.md](SKILL_EXAMPLES.md) for the skill format

## Debugging

- Build the diagnostics variant with `npm run build:dev` and load `dist-dev/`; production builds use a no-op diagnostics implementation.
- Enable tracing from the service-worker console with `await promptPaulDevDiagnostics.enable()` and disable it with `await promptPaulDevDiagnostics.disable()`.
- Collect records with `copy(JSON.stringify(await promptPaulDevDiagnostics.get(), null, 2))`.
- Background logs: `chrome://extensions/` -> Inspect views
- Side panel logs: open the side panel and inspect the page
- Content script logs: inspect the active tab; development tracing captures bounded content-script and main-world page errors, console messages, page-action bridge responses, receipts, and recovery events. Credential-shaped values remain redacted.

## Code Style

- Use 2-space indentation
- Use single quotes in JavaScript
- Keep functions focused and small
- Prefer explicit exports
- Keep docs current when behavior changes
- Use ASD-STE100 Simplified Technical English in new docs and comments
