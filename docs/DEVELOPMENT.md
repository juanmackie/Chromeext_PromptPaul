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

Load the unpacked extension from `chrome://extensions/` and point Chrome at this repository or the `dist/` folder after building.

## Project Layout

- `background.js` - service worker and context menu handling
- `chat.js` - side panel entry point
- `options.js` - settings and library management
- `content_script_unified.js` - page extraction
- `pdfContentScript.js` - PDF extraction
- `src/chat/` - chat UI, API, media, skills, and streaming modules
- `src/utils/` - shared helpers for budgeting, routing, validation, and storage
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
npm run validate
```

## Working Loop

1. Make the change in source
2. Run `npm run test`
3. Run `npm run smoke`
4. Build with `npm run build`
5. Reload the unpacked extension in Chrome

## Adding Modules

When you add a new module:

1. Put it in `src/chat/` or `src/utils/`
2. Add `@fileoverview` and `@module` JSDoc
3. Export the public API explicitly
4. Import it from the relevant entry point
5. Add coverage in `scripts/test-runner.js` if the file is a core module

## Adding Skills

1. Create `skills/<skill-name>/SKILL.md`
2. Register it in `skills/skills.json`
3. Verify it with `/skills` in chat
4. See [AGENTS.md](../AGENTS.md) for the full skill spec

## Debugging

- Background logs: `chrome://extensions/` -> Inspect views
- Side panel logs: open the side panel and inspect the page
- Content script logs: inspect the active tab

## Code Style

- Use 2-space indentation
- Use single quotes in JavaScript
- Keep functions focused and small
- Prefer explicit exports
- Keep docs current when behavior changes
