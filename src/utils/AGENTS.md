# Utils DOX

## Purpose

The `src/utils/` subtree contains shared helpers for validation, context budgeting, page permissions, action cards, profile routing, skill parsing, tool choice payloads, suggestions, read strategy, and runtime errors.

## Ownership

- `contextBudget.js` owns token estimation and DOM context trimming.
- `readStrategy.js` owns extraction strategy selection from page signals.
- `permissionGuards.js` owns restricted URL and host permission checks.
- `actionCards.js` owns inferred site-specific prompt cards.
- `suggestionStorage.js` owns custom site suggestion persistence and normalization.
- `skillParser.js` owns Agent Skills frontmatter parsing, metadata validation, Markdown generation, and legacy migration.
- `toolChoiceBuilder.js` owns tool choice normalization and provider payload formatting.
- `profileRouting.js` owns profile usability and vision-model selection helpers.
- `runtimeErrors.js` owns runtime error classification and friendly messages.
- `validation.js` owns small shared validators.
- `debounce.js` owns debounce and throttle helpers.

## Local Contracts

- Helpers should be browser-safe and avoid hidden side effects except for modules whose purpose is storage.
- `skillParser.js` must stay aligned with the skill specification in root AGENTS.md.
- `permissionGuards.js` is the central place for blocked browser page behavior.
- `suggestionStorage.js` caps stored suggestions at 60 and enforces command and prompt length limits.
- `toolChoiceBuilder.js` is shared by chat and background paths; keep payload behavior provider-compatible.

## Work Guidance

- Prefer small functions with explicit exports.
- Keep parsing and validation deterministic and testable without Chrome runtime state when possible.
- Update `scripts/test-runner.js` for new utility contracts that should not regress.
- Do not duplicate restricted-page checks, token budgeting, skill parsing, or tool choice normalization in entry points.

## Verification

- Run `npm run test` after utility changes.
- Run `npm run smoke` when manifest references, vendored dependency assumptions, or browser extraction dependencies are affected.

## Child DOX Index

- No child AGENTS.md files are currently needed under `src/utils/`.
