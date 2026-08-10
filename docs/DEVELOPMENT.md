# Development Guide

## Requirements

- Node.js 18 or newer
- Chrome or Edge for extension testing
- Git for source control

## Setup

```bash
git clone https://github.com/juanmackie/Chromeext_PromptPaul.git
cd Chromeext_PromptPaul
npm install
```

Load the unpacked extension from `chrome://extensions/` and point Chrome at this repository or the `dist/` folder after building. Source checkouts do not contain a starter credential. A release build may inject a deliberately public, quota-limited demo credential with `PROMPT_PAUL_DEMO_API_KEY`; never use that credential for private data.

## Project Layout

- `background.js` - service worker and context menu handling
- `chat.js` - side panel entry point
- `options.js` - settings and library management
- `content_script_unified.js` - page extraction plus opt-in semantic page snapshot/action handling
- `pdfContentScript.js` - PDF extraction
- `src/chat/` - chat UI, API, media, skills, and streaming modules
- `src/utils/` - shared helpers for budgeting, routing, validation, page snapshots/policy, and storage
- `skills/` - built-in skill definitions
- `docs/` - documentation
- `scripts/` - build, smoke, and test scripts

## Common Commands

```bash
npm run build
npm run build:dev
npm run build:prod
npm run test
npm run smoke
npm run test:browser
npm run validate
npm audit --audit-level=high --omit=optional
```

## Working Loop

1. State the user need, the smallest useful change, assumptions, edge cases, and security risks.
2. Delete obsolete code or dependencies before adding abstractions.
3. Make the change in source and add readable tests for the common and failure cases.
4. Run the full local gate: `npm run validate` (lint, formatting, structural tests, behavior tests, and smoke checks).
5. Run `npm run smoke` again when manifest or vendored dependencies changed.
6. Run `npm audit --audit-level=high --omit=optional` before release.
7. Build with `npm run build`.
8. Reload the unpacked extension in Chrome.
9. For page-action changes, test both Act-off ordinary chat and Act-on static forms/SPAs with approval, stale DOM, sensitive-field, restricted-page, Stop, and worker-restart cases. When Tabs is enabled, test owned-tab limits, source-tab close blocking, site approval, and fresh inspection after switching. A reconnect may restore activity status but must not resume actions automatically. Run `npm run test:browser` for the unpacked-extension Playwright suite; use `PROMPT_PAUL_BROWSER=chrome` or `PROMPT_PAUL_BROWSER=edge` when validating an installed branded browser. Branded runs load the unpacked directory through the browser-level CDP Extensions domain, which is required by Chrome 137+ and equivalent Edge builds.

See [Production Readiness](PRODUCTION_READINESS.md) for the concise review contract.

## Adding Modules

When you add a new module:

1. Put it in `src/chat/` or `src/utils/`
2. Add `@fileoverview` and `@module` JSDoc
3. Export the public API explicitly
4. Import it from the relevant entry point
5. Add structural regression guards in `scripts/test-runner.js` when a core module gains a durable contract; add behavior coverage in `tests/` for runtime logic

## Adding Skills

1. Create `skills/<skill-name>/SKILL.md`
2. Register it in `skills/skills.json`
3. Verify it with `/skills` in chat
4. See [AGENTS.md](../AGENTS.md) for the full skill spec

## Debugging

- Background logs: `chrome://extensions/` -> Inspect views
- Side panel logs: open the side panel and inspect the page
- Content script logs: inspect the active tab; page-action snapshots and action errors are bounded and never include credential values

## Code Style

- Use 2-space indentation
- Use single quotes in JavaScript
- Keep functions focused and small
- Prefer explicit exports
- Keep docs current when behavior changes
- Use ASD-STE100 Simplified Technical English in new docs and comments
