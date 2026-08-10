# Options DOX

## Purpose

The `src/options/` subtree contains shared modules for the Options page setup and management experience.

## Ownership

- `OptionsUI.js` owns chat-led setup status rendering, dirty tracking, the unsaved-changes guard, credential masking helpers, and per-section save feedback.

## Local Contracts

- `OptionsUI.js` must stay DOM-light: helpers operate on element-like objects so they remain unit-testable in a Node environment.
- Credential masking keeps stored keys out of the DOM input value: `applyCredentialMask` clears the field, sets a masked placeholder, and disables native `required` validation while configured so saves can preserve the stored key; unconfigured fields restore `required`; `resolveCredentialValue` preserves the stored key when the field is masked and untouched.
- Codex profiles hide API credential fields and use the background `codexLoginStart`/`codexLoginPoll`/`codexLogout` bridge. A successful login creates or selects the `Codex` profile. Model choices and supported reasoning levels come from the background `getAvailableModels` bridge. The Options page may display only sanitized connection/model metadata, never access or refresh tokens.
- The unsaved-changes guard is driven by the combined dirty state of every Options section (connection, privacy, web search, and page actions), not a single form.
- `options.js` (root-owned) remains the entry point for storage I/O and section wiring; new setup/management helpers belong here rather than in the entry point.

## Work Guidance

- Keep pure helpers exported for tests.
- Never log or echo raw credential values.
- Preserve existing storage schemas: masking and section saves must not rename keys or restructure stored profiles.

## Verification

- Run `npm run test` after module changes.
- Exercise the Options page manually in Chrome or Edge: mask/restore keys, per-section saves, and the unsaved-changes banner.

## Child DOX Index

- No child AGENTS.md files are currently needed under `src/options/`.
