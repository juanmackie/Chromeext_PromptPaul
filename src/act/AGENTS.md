# Act capability contract

This directory owns Act planning, outcome derivation, run-local working memory, scroll state, task notes, and action limits. `index.js` is the public entry point for other source areas; internal files may import one another directly.

- Keep Act state bounded and run-local where specified. Never persist DOM snapshots, page text, credentials, task notes, or working memory in journals/checkpoints.
- Planning never changes consent. High-risk actions always require confirmation; sensitive controls stay masked or blocked. Terminal success requires fresh observed evidence, not model claims.
- Keep action budgets in `ActLimits.js`; behavior tests cover their runtime use. Keep page action dispatch and authorization in the orchestrator/policy owners.
- Preserve existing public run/event/checkpoint shapes when changing Act internals.

See `src/orchestrator/AGENTS.md` for run integration and `docs/PRODUCTION_READINESS.md` for release gates.
