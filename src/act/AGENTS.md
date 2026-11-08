# Act capability contract

This directory owns Act planning, run-scoped action execution, outcome derivation, working memory, scroll state, task notes, frame snapshot/index routing, tool schemas, and action limits. `index.js` is the public entry point for other source areas; internal files may import one another directly. `RunOrchestrator` remains the host for shared run state, provider turns, and lifecycle callbacks; `ActExecution` installs the capability's methods onto that host.

- Keep Act state bounded and run-local where specified. Never persist DOM snapshots, page text, credentials, task notes, or working memory in journals/checkpoints.
- Planning never changes consent. High-risk actions always require confirmation; sensitive controls stay masked or blocked. Terminal success requires fresh observed evidence, not model claims.
- Keep action budgets and shared Act action constants in `ActLimits.js`; behavior tests cover their runtime use. Keep policy classification in `src/utils/pageActionPolicy.js` and route Act behavior through `ActExecution`.
- Preserve existing public run/event/checkpoint shapes when changing Act internals.

See `src/orchestrator/AGENTS.md` for run integration and `docs/PRODUCTION_READINESS.md` for release gates.
