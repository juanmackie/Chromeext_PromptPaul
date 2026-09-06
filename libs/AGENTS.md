# Libs DOX

## Purpose

The `libs/` subtree contains vendored browser libraries used by extension pages and content scripts.

## Ownership

- `readability.js` and `turndown.js` support page extraction and Markdown conversion in `content_script_unified.js`.
- `bootstrap.bundle.min.js` plus `bootstrap.min.css` are the vendored Bootstrap 5.3.3 bundle.
- `dom-accessibility-api.js` is a vendored MIT 0.7.1 browser bundle used for accessible-name calculation in page-action snapshots. Its complete license is in `dom-accessibility-api.LICENSE.md`.
- `highlight.min.js` plus the `highlight-github.min.css` / `highlight-github-dark.min.css` theme files support syntax highlighting in chat rendering (highlight.js 11.9.0).
- `marked.min.js` (repo root) is the vendored marked v4.x Markdown parser used by chat rendering; it lives at the root because `build.js` expects it there.
- `material-symbols-outlined.woff2` is the vendored Google Material Symbols Outlined variable font (Apache-2.0).

## Local Contracts

- Treat files here as third-party vendored assets.
- Do not hand-edit minified or vendored code unless the task is specifically an upgrade or local patch.
- If replacing a vendored library, preserve the filename expected by `manifest.json`, HTML files, and scripts, or update every reference.
- Do not add duplicate npm dependencies for libraries that are intentionally vendored; `npm run smoke` checks this for Readability and Turndown. New vendored libraries must include source/version and license records.
- Every shipped third-party asset (every file in `libs/` plus the root `marked.min.js`) must have exactly one provenance record in `libs/vendor-manifest.json` with source, version, and hash. `verify-vendored-licenses.js` fails the gate on any unlisted asset, so new vendored files must be added to the manifest at the same time.

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
