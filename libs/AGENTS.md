# Libs DOX

## Purpose

The `libs/` subtree contains vendored browser libraries used by extension pages and content scripts.

## Ownership

- `readability.js` and `turndown.js` support page extraction and Markdown conversion in `content_script_unified.js`.
- `highlight.min.js` and highlight CSS files support syntax highlighting in chat rendering.

## Local Contracts

- Treat files here as third-party vendored assets.
- Do not hand-edit minified or vendored code unless the task is specifically an upgrade or local patch.
- If replacing a vendored library, preserve the filename expected by `manifest.json`, HTML files, and scripts, or update every reference.
- Do not add duplicate npm dependencies for libraries that are intentionally vendored; `npm run smoke` checks this for Readability and Turndown.

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
