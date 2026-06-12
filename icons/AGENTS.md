# Icons DOX

## Purpose

The `icons/` subtree contains extension icons and copy-action image assets used by Prompt Paul.

## Ownership

- `icon16.png`, `icon48.png`, and `icon128.png` are referenced by `manifest.json`.
- Copy-markdown and copy-formatted image assets are used by the UI theme variants.

## Local Contracts

- Keep manifest icon paths and required sizes intact unless updating `manifest.json` at the same time.
- Preserve light and default copy-action variants when changing copy controls.
- Binary assets should stay optimized and browser-loadable.

## Work Guidance

- When replacing an icon, check it at the actual displayed size as well as source resolution.
- Update HTML, CSS, or manifest references together with any filename changes.
- Avoid adding unused image variants.

## Verification

- Run `npm run smoke` after changing manifest-referenced icons.
- Reload the unpacked extension and inspect affected icon or copy-action UI when assets change.

## Child DOX Index

- No child AGENTS.md files are currently needed under `icons/`.
