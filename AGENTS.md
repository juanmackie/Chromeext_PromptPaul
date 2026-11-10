# Prompt Paul agent contract

Apply the active global agent instructions. This file defines repository-wide ownership and invariants.

## Ownership

- Root owns the manifest, package metadata, entry points, content scripts, page assets, changelog, README, and release configuration.
- New capability logic lives in `src/<capability>/<use-case>/`; `src/utils/` is only for stable behavior shared by multiple capabilities. Entry points compose modules.
- `dist/`, `dist-dev/`, and `dist-eval/` are generated. Never edit or publish them directly. Do not edit vendored code or binary assets unless requested.
- Durable docs belong under `docs/`; `docs/PRODUCTION_READINESS.md` is the release checklist.
- Scripts are CommonJS Node programs run from the repository root. Tests use local fixtures and never real credentials or private services.
- `libs/` is vendored; keep `libs/vendor-manifest.json` provenance and license records aligned. Built-in skills must be registered in `skills/skills.json` with `name` and `description` frontmatter.

## Invariants

- Manifest V3, ES module service worker, extension-page CSP `script-src 'self'`. Use two-space indentation and single quotes. New `src/` modules require `@fileoverview`/`@module` JSDoc.
- Secrets and provider credentials stay in Chrome storage and resolve in the background. Never expose them in Options, profiles, messages, logs, backups, or run records. Privileged background messages require an extension-page sender; content requests are bound to their sender tab.
- Preserve canonical storage keys and backup rules. Keep remote calls user-initiated. Bound and validate external input, public media fetches, page context, and provider output. Block browser-internal, extension, and store pages before extraction.
- Context-bearing prompts use structured prompt requests and `composeUserPrompt`; untrusted page/user context stays bounded and marked as source material.
- Act is default-off, DOM/semantic, and confirmation-gated. Never execute page JavaScript. Sensitive controls stay masked or blocked; high-risk actions always confirm. See `src/act/AGENTS.md` for policy and `src/act/ActLimits.js` for numeric limits.
- Keep release and runtime behavior aligned with `CHANGELOG.md`, `docs/STORE_LISTING.md`, and the production readiness checklist. Never package development/evaluation output.
- Keep transient plans untracked.

## Verification

- `npm run validate` runs lint, formatting, manifest/build checks, behavior tests, smoke checks, and license verification.
- `npm run test:browser` covers browser runtime, including the hidden-tab settlement gate; manually exercise changed UI flows in Chrome/Edge. A build does not prove visual or interaction correctness.
- `npm run build:prod` creates the production package. See `package.json` for component commands and `docs/PRODUCTION_READINESS.md` for release gates.
