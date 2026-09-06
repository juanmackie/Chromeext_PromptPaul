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
- Error-aware section saves (privacy, web search, notch, page actions) share one owning implementation, `runErrorAwareSave` in `OptionsUI.js`: it runs the storage write, surfaces success/error through the page status and button feedback, re-baselines the dirty tracker, and clears the dirty flag. Section-specific keys, schemas, and validation guards stay in `options.js`; the helper does not rename keys or restructure stored data.
- `options.js` (root-owned) remains the entry point for storage I/O and section wiring; new setup/management helpers belong here rather than in the entry point.
- The setup status distinguishes a verified connection from configured-but-untested settings: `renderSetupStatus` shows **Connected** only after a successful bounded connection check (Hermes via the background `testHermesConnection` bridge), otherwise **Configured** for saved untested settings or an error with a retry action. It never infers a verified connection from nonempty fields or an endpoint alone, and stale checks revert to Configured when connection settings change.

## Work Guidance

- Keep pure helpers exported for tests.
- Never log or echo raw credential values.
- Preserve existing storage schemas: masking and section saves must not rename keys or restructure stored profiles.

## Verification

- Run `npm run test` after module changes.
- Exercise the Options page manually in Chrome or Edge: mask/restore keys, per-section saves, and the unsaved-changes banner.

## Child DOX Index

- No child AGENTS.md files are currently needed under `src/options/`.
