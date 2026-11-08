# Prompt Paul agent contract

Apply the active global agent instructions. This file defines repository-wide ownership and invariants; read the nearest child `AGENTS.md` before changing its subtree.

## Ownership

- Root owns the manifest, package metadata, entry points, content scripts, page assets, changelog, README, and release configuration.
- `src/<capability>/<use-case>/` owns new capability logic. Keep `src/utils/` for stable behavior shared by multiple capabilities. Entry points compose modules.
- `dist/`, `dist-dev/`, and `dist-eval/` are generated. Never edit or publish them directly. Do not edit vendored code or binary assets unless requested.
- Durable docs belong under `docs/`; follow `docs/AGENTS.md`. `docs/PRODUCTION_READINESS.md` is the release checklist.

## Invariants

- Manifest V3, ES module service worker, extension-page CSP `script-src 'self'`. Use two-space indentation and single quotes. New `src/` modules require `@fileoverview`/`@module` JSDoc.
- Secrets and provider credentials stay in Chrome storage and resolve in the background. Never expose them in Options, profiles, messages, logs, backups, or run records. Privileged background messages require an extension-page sender; content requests are bound to their sender tab.
- Preserve canonical storage keys and backup rules. Keep remote calls user-initiated. Bound and validate external input, public media fetches, page context, and provider output. Block browser-internal, extension, and store pages before extraction.
- Context-bearing prompts use structured prompt requests and `composeUserPrompt`; untrusted page/user context stays bounded and marked as source material.
- Act is default-off, DOM/semantic, and confirmation-gated. Never execute page JavaScript. Sensitive controls stay masked or blocked; high-risk actions always confirm. Precise input is opt-in and limited to approved CDP Input commands. See `src/orchestrator/AGENTS.md` and `docs/PRODUCTION_READINESS.md` for current policy and limits.
- Keep release and runtime behavior aligned with `CHANGELOG.md`, `docs/STORE_LISTING.md`, and the production readiness checklist. Never package development/evaluation output.

## Verification

- `npm run validate` runs lint, formatting, regression checks, behavior tests, smoke checks, and license verification.
- `npm run test:browser` covers browser runtime; manually exercise changed UI flows in Chrome/Edge. A build does not prove visual or interaction correctness.
- `npm run build:prod` creates the production package. See `package.json` for component commands and `docs/PRODUCTION_READINESS.md` for release gates.

## Child contracts

- `src/AGENTS.md` and deeper chat, options, utility, and orchestration contracts govern source modules.
- `scripts/AGENTS.md`, `tests/AGENTS.md`, `skills/AGENTS.md`, `libs/AGENTS.md`, and `icons/AGENTS.md` govern those subtrees.
- `REVIEW_PLAN.md` is the durable review record. Keep transient plans untracked.
