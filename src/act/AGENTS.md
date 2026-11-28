# Act capability contract

This directory owns Act planning, run-scoped action execution, outcome derivation, working memory, scroll state, task notes, safe frame discovery/snapshot/index routing, tool schemas, and action limits. `index.js` is the public entry point for other source areas; internal files may import one another directly. `RunOrchestrator` remains the host for shared run state, provider turns, and lifecycle callbacks; `ActExecution` installs the capability's methods onto that host.

- Keep Act state bounded and run-local where specified. Never persist DOM snapshots, page text, credentials, task notes, or working memory in journals/checkpoints.
- Planning never changes consent. High-risk actions always require confirmation; sensitive controls stay masked or blocked. Terminal success requires fresh observed evidence, not model claims.
- Keep action budgets and shared Act action constants in `ActLimits.js`; behavior tests cover their runtime use. Keep policy classification in `src/utils/pageActionPolicy.js` and route Act behavior through `ActExecution`.
- Preserve existing public run/event/checkpoint shapes when changing Act internals.

See `src/orchestrator/AGENTS.md` for run integration and `docs/PRODUCTION_READINESS.md` for release gates.

## WebMCP page tools (authorized page-JavaScript exception)

Act never executes page JavaScript, with one declared exception: an optional WebMCP tool call. Treat it as a bounded exception, not as permission to inject or evaluate script.

- Tools are page-registered functions (`document.modelContext`, Chrome 146+ flag / 149+ origin trial). The page-action content script reads them in the isolated world; Chrome's own example extension does the same, so no MAIN-world bridge is needed.
- `page_webmcp_tools` lists tools with normalized `{name, description, inputSchema, annotations}`. `src/act/WebMcpTools.js` owns normalization and annotation policy; the content script only validates, executes, and bounds.
- Gating: tools with `debugging` are hidden. **Every** tool call needs explicit per-call confirmation. `readOnlyHint` is a display hint only; page annotations are untrusted and can never skip the card. `consequentialHint` forces the high-risk wording. Annotations are re-read from the live tool before approval so a stale listing cannot change the decision.
- Bounds: 24 tools, 64-character names, 2000-character schemas, 1500-character arguments, 4000-character results, 8-second timeout with `AbortSignal`. Tool text is untrusted page data and never counts as observed page evidence; every call keeps a `delivered_unverified` receipt until a fresh snapshot verifies it.
- Never log tool arguments or output payloads in events, journals, or diagnostics. The tool name appears only in the confirmation card/summary and the bounded tool list; the background diagnostic drops `tools`, `toolResult` and `text` for WebMCP actions.
- Removing this exception means removing these two actions, `WebMcpTools.js`, and the content-script WebMCP block together.
