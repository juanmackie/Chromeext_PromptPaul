# Feature Test Review

**Run:** 2026-08-30
**Purpose:** Capture the current automated evidence before reviewing extension
behaviour and development diagnostics.

## Result summary

| Check                            | Result                                 |
| -------------------------------- | -------------------------------------- |
| Structural and integration tests | 95 passed                              |
| Vitest behaviour tests           | 523 passed across 43 files             |
| Browser tests                    | 33 passed                              |
| Browser page-action records      | 9 credential-free evaluation cases     |
| Development trace records        | 680 bounded entries across 33 traces   |
| Policy violations                | 0                                      |
| Dependency audit                 | 0 high-severity vulnerabilities        |
| Production build                 | Passed; diagnostics marked `excluded`  |
| Development build                | Passed; diagnostics marked `available` |

The browser evaluator intentionally includes negative cases. Its nine records
contained three completed cases and six expected blocked, stale, uncertain,
timeout, or abort outcomes. The browser suite itself passed all 33 tests.
The captured diagnostics contained seven expected `PAGE_ACTION_TIMEOUT` events
and one expected `PAGE_ACTION_MESSAGE_FAILED` event from those negative paths.

## Feature coverage

- Chat composer, selection actions, recovery, streaming, attachments, documents,
  skills, and grounding: structural, unit, and behaviour suites.
- Options, profiles, backup/import validation, credential masking, voice settings,
  and storage contracts: structural and integration suites.
- API-compatible, Anthropic-compatible, Codex, and Hermes routing: behaviour
  suites with credential-free transport tests.
- Brave Search: bounded client, source normalization, sequencing, and failure
  behaviour tests; no live API key was used.
- Media, PDF detection/extraction, public URL restrictions, site extraction, and
  sanitization: unit and behaviour suites.
- Top Notch, theme changes, side-panel actions, and browser-page messaging: real
  browser tests.
- Act: policy, sensitive controls, stale snapshots, receipts, scope/diff,
  approvals, planner, notes, navigation, owned tabs, bridge failures, restart
  recovery, manual intervention, and budget cases: unit, behaviour, and browser
  tests.
- Development diagnostics: redaction, URL/query removal, expiry, payload bounds,
  build variants, isolated content-script bridge, and main-world bridge checks.

## Artifacts

Raw command output is stored locally under:

- `artifacts/feature-review/validate.log`
- `artifacts/feature-review/browser.log`
- `artifacts/feature-review/browser-traced.log`
- `artifacts/feature-review/build-dev.log`
- `artifacts/feature-review/build-prod.log`
- `artifacts/feature-review/audit.log`
- `artifacts/feature-review/diagnostics-summary.json`
- `artifacts/browser-diagnostics/trace-*.json`

The `artifacts/` directory is ignored because it contains generated local test
output. Do not publish it without reviewing browser and provider data.

## Limitations

- No real provider credentials, live LLM request, live Brave request, or live
  Hermes gateway was used.
- Browser tests use local fixtures and simulated provider/tool boundaries.
- This report verifies automated contracts, not task quality on production sites.
- Manual development tracing still needs a focused real-browser reproduction;
  enable it only in `dist-dev/` as documented in [DIAGNOSTICS.md](DIAGNOSTICS.md).
