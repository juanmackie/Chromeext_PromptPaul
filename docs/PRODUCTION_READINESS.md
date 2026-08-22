# Production Readiness

Prompt Paul follows the production-ready coding rules used for this repository.
This checklist keeps those rules practical and reviewable.

## Before a change

- State the user need and the smallest useful behavior.
- Remove obsolete code, compatibility paths, and dependencies before adding new layers.
- Record assumptions, edge cases, failure behavior, and security risks.
- Confirm that every dependency and browser API already exists in the project or platform.

## During a change

- Validate and bound user input at every external boundary.
- Keep user credentials in Chrome storage. Build-only secrets must come from platform secret management; do not rely only on environment variables. Never commit secrets or place them in logs, DOM fields, events, backups, or LLM payloads.
- The release demo credential is a deliberate public, quota-limited exception. Treat it as exposed, never use it for private data, and rotate it independently.
- Use the existing sanitizer for untrusted HTML and the existing validators for URLs, profiles, tools, skills, and page actions.
- Keep modules cohesive, names descriptive, and functions easy to test. Split a large file when its responsibilities diverge; do not split only to meet a line count.
- Use ASD-STE100 Simplified Technical English in new documentation and comments.

## Before closeout

- Add readable tests for new behavior, including common and failure cases.
- Run `npm run validate` and `npm run smoke` when relevant.
- Run `npm run test:browser` for browser-runtime or page-action changes. The CI browser job runs the complete unpacked-extension suite with headed Chromium under Xvfb, including the executable page-action evaluation and live snapshot scope/diff checks.
- Run `npm audit --audit-level=high --omit=optional` before release.
- Review authentication, user data, external API, and page-action changes for security before production deployment. For page actions, review receipt evidence, manual-intervention boundaries, prompt-injection handling, sensitive-field masking, restricted-page behavior, and the rule that scope/diff measurements remain test-only. Do not describe the extension as production-ready until these reviews and the required browser/provider checks are complete.
- Update the nearest DOX contract when behavior, structure, workflow, or quality requirements change.

## Page-action release gates

- Every state-changing action must return a bounded delivery disposition and action-specific postcondition evidence when verification is safe.
- `delivered_unverified` mutations must not be retried automatically.
- Manual intervention must stay local to the visible tab, require explicit Resume, invalidate the old snapshot, and never collect secrets in chat or events.
- The credential-free 11-case corpus must pass its unit/provider matrix, and browser-safe cases must pass against local fixtures with bounded metrics.
- Scope/diff output must remain indexed, bounded, selector-free, and test-only.

## Current review risks

`background.js`, `chat.js`, `options.js`, and `src/orchestrator/RunOrchestrator.js` are large cohesive entry points. Keep changes narrow and extract only when responsibilities diverge. A future refactor should preserve the existing message, storage, and run-event contracts and include focused regression tests.
