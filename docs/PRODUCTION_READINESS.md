# Production Readiness

This checklist links the release gates. The root [AGENTS.md](../AGENTS.md) owns the detailed behavior and security invariants.

## Before a change

- State the user benefit and smallest useful behavior. Remove obsolete paths before adding dependencies or new layers.
- Check the owning source and test contracts before editing. Keep new capability logic in its owning `src/` area.
- Validate external input at its boundary and keep credentials out of logs, events, backups, and model payloads.

## Before closeout

- Add behavior tests for changed contracts. Run `npm run validate`; run `npm run test:browser` for browser behavior.
- Run `npm run audit` before release. Run `npm run build:prod` and confirm development diagnostics and the evaluation hook are excluded.
- For UI or browser changes, reload the extension in Chrome or Edge and exercise the affected flow.
- Review security-sensitive changes against the root contract. Update the architecture or workflow note when ownership or release gates change.
- Do not claim production readiness while a required browser check or human security review is pending. The Act security and license review is recorded in [ACT_SECURITY_LICENSE_REVIEW.md](ACT_SECURITY_LICENSE_REVIEW.md).

## Act release gates

- Keep Act default-off and semantic/DOM-only. Mutations need bounded receipts, high-risk actions need confirmation, and unverified actions must not be retried blindly. The canonical rules live in [src/act/AGENTS.md](../src/act/AGENTS.md).
- Run the focused real-browser suite for frame routing, hidden-tab settlement, policy decisions, and lifecycle cleanup.
- Run the opt-in Act benchmark by hand (`npm run benchmark:act -- --run`) before changing Act behavior. Restore CI scoring only after repeated manual runs give a stable score.
- Review persistent site-trust behavior before publishing. The release workflow publishes only when a `v*` tag is pushed.

## Current file ownership

`src/orchestrator/RunOrchestrator.js` owns shared run lifecycle and provider turns. `src/act/ActExecution.js` owns page-action execution on that host. `background.js`, `options.js`, and `chat.js` remain entry points that compose capability modules; continue extracting when a responsibility has a clear interface and tests.
