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
- Keep user credentials in Chrome storage. Build-only secrets must come from platform secret management; do not rely only on environment variables. Never commit secrets or place them in logs, DOM fields, events, backups, or LLM payloads. Development diagnostics must be opt-in, session-scoped, bounded, and replaced by no-op implementations in production output.
- Use the existing sanitizer for untrusted HTML and the existing validators for URLs, profiles, tools, skills, and page actions.
- Keep modules cohesive, names descriptive, and functions easy to test. Split a large file when its responsibilities diverge; do not split only to meet a line count.
- Use ASD-STE100 Simplified Technical English in new documentation and comments.

## Before closeout

- Add readable tests for new behavior, including common and failure cases.
- Run `npm run validate` and `npm run smoke` when relevant.
- Run `npm run test:browser` for browser-runtime or page-action changes. The CI browser job runs the complete unpacked-extension suite with headed Chromium under Xvfb, including the executable page-action evaluation and live snapshot scope/diff checks.
- Run `npm run audit` before release. CI runs the same dependency gate before browser and build jobs.
- Run `npm run build:prod` and verify that `dist/` reports diagnostics and the eval hook as `excluded`, contains no development tracer or eval hook implementation, and that `dist-dev/` and `dist-eval/` are never packaged or published.
- For optional answer cards, verify the explicit composer action, narrow layouts, keyboard disclosure, readable copy, malformed/empty fallback, and Stop during a partial payload. Progressive blocks must retain focus, scroll, disclosure, filter, and sort state through valid completion and clear on invalidity/interruption. Table controls and follow-up prefill must make no provider requests; explicit follow-up Send must retain originating context/source-tab provenance after tab changes. Cards use the bounded passive schema and host source IDs; readable text stays authoritative in history and journals. Local provider fixtures check delivery, not live model answer quality.
- Review authentication, user data, external API, and page-action changes for security before production deployment. For this Act change, the focused review is recorded in [ACT_SECURITY_LICENSE_REVIEW.md](ACT_SECURITY_LICENSE_REVIEW.md). Review receipt evidence, session checkpoints, explicit-resume boundaries, prompt-injection handling, sensitive-field masking, restricted-page behavior, and the rule that runtime scope/diff output stays indexed, bounded, and selector-free. Do not describe the extension as production-ready until these reviews and the required browser/provider checks are complete.
- Review changes against the repository-wide ownership and security invariants in the root [AGENTS.md](../AGENTS.md), showing the user benefit and the regression checks that protect existing behavior.
- Update the nearest DOX contract when behavior, structure, workflow, or quality requirements change.

## Page-action release gates

- Every state-changing action must return a bounded delivery disposition and action-specific postcondition evidence when verification is safe.
- `delivered_unverified` mutations must not be retried automatically.
- Settlement must complete in hidden tabs and when visibility changes during an animation-frame wait. The browser regression must assert a real hidden document and verify input receipts, scrolling, and a healthy follow-up inspection; Playwright focus emulation alone cannot exercise this case.
- Quiet actions retain the 100 ms quiet path and one-second overall deadline; only newly action-triggered busy controls or resource entries extend settlement to three seconds. Verify timing, cleanup, and exclusion of pre-existing spinners.
- Non-Hermes initial provider requests must already contain a matching synthetic inspection call/result pair. Compact results preserve receipts and snapshot identity; measure payload savings against real fixtures. Keyboard submission must use the submit control's risk, and focused targets must be revalidated before delivery.
- Manual intervention must stay local to the visible tab, require explicit Resume, invalidate the old snapshot, and never collect secrets in chat or events.
- The credential-free 15-case corpus must pass its unit/provider matrix, and browser-safe cases must pass against local fixtures with bounded result, policy, consistency, and scope metrics.
- Runtime scope/diff output must remain indexed, bounded, and selector-free. Region and byte-size measurements remain evaluation-only.
- Session checkpoints must contain only bounded metadata, expire on terminal cleanup, and offer explicit Resume without automatic action replay.
- Pending approvals, clarifications, and manual steps must survive normal worker idle shutdown. Executing runs use a scoped heartbeat; completion, error, and Stop release it. The browser lifecycle regression must run without a worker debugger and verify normal suspension after completion.
- Act limits are defined by the runtime owners, including [`ActLimits.js`](../src/act/ActLimits.js), `PageTaskMemory.js`, and `ActPlanner.js`. Planning never grants consent; completion needs new runtime evidence. Act snapshots contain no screenshots or visual-box payloads.
- High-risk actions always confirm after run, global or site trust. Sensitive password-manager, identity/account, and Prompt Paul origins must never honor site or run-wide low-risk approval. Test authenticated site-policy persistence, bounds/backups, blocked source/redirect/recovery dispatch, active-run tightening at the next action, and expiry/Stop races. Blocks and removals apply immediately; new allowances apply to new runs. Require human security review of persistent trust and message authorization before production.
- Enabling Act warns for unsupported/unknown advertised API tool support without generation. Check endpoint/model binding and supported/unknown/unsupported UI states.
- Frame support must keep the combined outline bounded, route only current snapshot indices to the originating frame, enforce each frame's site policy, mask values per frame, and omit payment-like frames. Exercise same-origin, cross-origin, blocked-origin, removed-frame, and payment-frame cases in the real browser.
- Manually verify precise input in Chrome/Edge: the debugger notice appears only for an opted-in run; cancelling or detaching falls back to DOM input for later actions; a run with the option off does not attach. Keep this gate pending until exercised in the release browser.
- Terminal progress and evaluation records carry normalized runtime task outcomes. Declines, timeouts, manual blocks, skipped work, loops, budgets and site blocks must not count as success. Grade task end state independently of answer claims.
- The Act permission is a bounded lease, not broad automation: validated HTTP(S) links may navigate, writes and risky controls remain confirmation-gated, no arbitrary selector or JavaScript is executed, and current-page actions stay DOM/semantic-control-only in the default mode. Experimental precise input is default-off and may use only `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, and `Input.insertText` after semantic targeting and policy approval. Never use CDP DOM, Runtime, Page, Network, or screenshot methods. Attach only on supported HTTP(S) tabs, detach on Stop/teardown/error, and never fall back to DOM dispatch after any CDP input command may have been delivered. Production use requires human security review of the debugger permission and user-facing warning. Scope/diff runtime output stays indexed, bounded, and selector-free.
- Development traces must never be sent through normal chat events or analytics. Review any local trace before sharing it because it may contain user-provided troubleshooting content.

## Current review risks

`background.js`, `chat.js`, `options.js`, and `src/orchestrator/RunOrchestrator.js` are large cohesive entry points. Keep changes narrow and extract only when responsibilities diverge. A future refactor should preserve the existing message, storage, and run-event contracts and include focused regression tests.
