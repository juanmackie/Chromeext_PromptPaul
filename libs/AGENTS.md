# Libs DOX

## Purpose

The `libs/` subtree contains vendored browser libraries used by extension pages and content scripts.

## Ownership

- Runtime browser-library versions and assets come from `package-lock.json`; `vendor-manifest.json` maps packages to build output paths and license files.
- `dom-accessibility-api.js` remains a vendored MIT 0.7.1 browser bundle used for accessible-name calculation. Its license is in `dom-accessibility-api.LICENSE.md`.
- `material-symbols-outlined.woff2` is the vendored Google Material Symbols Outlined variable font (Apache-2.0).

## Local Contracts

- Treat files here as third-party vendored assets.
- Do not hand-edit minified or vendored code unless the task is specifically an upgrade or local patch.
- If replacing a vendored library, preserve the filename expected by `manifest.json`, HTML files, and scripts, or update every reference.
- Runtime npm assets are synced into `libs/` by `scripts/runtime-dependencies.js` (run on `npm install`/`npm ci`) and copied into `dist*/libs/` by `scripts/build.js`; generated copies are gitignored and must not be checked into source control.
- Every shipped third-party asset must have one provenance record in `vendor-manifest.json`. The verifier checks the lockfile integrity, installed package asset hashes, copied build assets, and unlisted files.

## Work Guidance

- Record source, version, and reason when upgrading vendored assets.
- Keep license requirements in mind for any new vendored file.
- Prefer changing first-party wrappers and callers outside `libs/` when behavior can be fixed there.

## Verification

- Run `npm run smoke` after changing vendored dependency assumptions.
- Run `npm run build` after changing files referenced by HTML or manifest entries.
- Manually exercise page extraction or syntax highlighting when those assets change.

## Child DOX Index

- No child AGENTS.md files are currently needed under `libs/`.
