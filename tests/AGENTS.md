# Tests DOX

## Purpose

The `tests/` subtree contains structural, unit, behavior, and real-browser verification for Prompt Paul.

## Ownership

- Root-level test files cover shared runtime and regression behavior.
- `pageDom.test.js`, `pageActionPolicy.test.js`, and `pageTabController.test.js` cover bounded page state, policy, and owned-tab behavior.
- `tests/browser/AGENTS.md` owns unpacked-extension Playwright coverage and local browser fixtures.

## Local Contracts

- Tests must preserve the root extension contracts and must not use real credentials or private services.
- Page-action tests must cover bounded fingerprints, repeated-action loop blocking, approved same-tab and owned-tab link navigation, tab-tool opt-in, and journal-safe event behavior.
- Browser fixtures represent Gmail/Outlook compose surfaces locally; they are not production pages.

## Work Guidance

- Keep assertions focused on observable behavior and actionable failure states.
- Run the narrow suite while iterating, then run the applicable full gates before closeout.

## Verification

- `npm run test` and `npm run test:behavior` cover non-browser checks.
- `npm run test:browser` covers the real-browser suite described by the child DOX.

## Child DOX Index

- `tests/browser/AGENTS.md`: unpacked-extension Playwright suite and local fixtures.
