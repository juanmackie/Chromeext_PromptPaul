# Act Security and License Review

**Review date:** 2026-08-30
**Status:** Complete for the Act enhancement implementation
**Scope:** Browser control, semantic targeting, receipts, checkpoints, explicit Resume, scope/diff output, and vendored code changed by this plan.

## Security review

The implementation was reviewed against the Act contract and the relevant source files:

- `content_script_unified.js` and `src/utils/pageDom.js` keep semantic targeting
  indexed and bounded. They do not accept model-supplied selectors, page
  JavaScript, or DOM identity attributes. Sensitive controls remain masked.
- `src/utils/pageActionPolicy.js` remains the gate for restricted pages,
  sensitive controls, navigation, and state-changing actions.
- `src/orchestrator/RunOrchestrator.js` requires fresh inspection, checks stale
  state, records bounded receipts, blocks repeated uncertain mutations, and
  requires a verified receipt plus fresh `page_get_state` before final planner
  completion.
- `src/utils/pageActionCheckpoint.js` stores only bounded metadata. It removes
  page snapshots, page text, note text, credentials, and other sensitive task
  details. Planner `blockReason` is bounded and passed through the same
  sensitive-text filter as other checkpoint text.
- `src/chat/ChatRunRecovery.js`, `background.js`, and the Resume flow require an
  explicit user action after restart. Resume clears the old snapshot and forces
  a fresh inspection. No mutation is replayed automatically.
- `src/utils/pageActionScopeDiff.js` returns indexed, bounded metadata only.
  It does not expose selectors, raw page content, or unbounded region data.
- Retry/backoff is limited to reads, bridge recovery, readiness, and
  `not_delivered` results. `delivered_unverified` mutations are not retried.

No unresolved security finding was identified in this scope. The automated
policy, checkpoint, receipt, injection, stale-state, retry, and browser tests
are part of the closeout evidence.

## License review

The new vendored library is recorded in `libs/vendor-manifest.json` and checked
by the offline `npm run verify:licenses` gate:

| Asset                           | Version | License                      | Review result                                                  |
| ------------------------------- | ------- | ---------------------------- | -------------------------------------------------------------- |
| `libs/dom-accessibility-api.js` | 0.7.1   | MIT                          | Complete license text, source URL, and SHA-256 records present |
| WAInjectBench cases             | N/A     | No stated repository license | No source text redistributed; cases are clean-room rewrites    |
| WASP case ideas                 | N/A     | CC BY-NC 4.0 materials       | No source text redistributed; cases are clean-room rewrites    |
| ST-WebAgentBench case ideas     | N/A     | Apache-2.0                   | No source text redistributed; cases are clean-room rewrites    |

Existing vendored assets retain their upstream license notices. No code from
AGPL or custom-source repositories was copied. The implementation uses clean-
room adaptations of reviewed behavior and keeps zero runtime npm dependencies.

## Evidence

The closeout commands passed on 2026-08-30:

- `npm run validate`
- `npm audit --audit-level=high --omit=optional`
- `npm run build`
- `xvfb-run -a npm run test:browser`
- `git diff --check`

The normal organizational approval to publish a production release remains a
separate release operation. It is not an unresolved implementation finding in
this Act enhancement review.
