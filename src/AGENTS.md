# Source DOX

## Purpose

The `src/` subtree contains ES modules shared by the extension entry points, including chat-side modules, utility helpers, run orchestration, and shared prompt builders.

## Ownership

- Owns `src/prompts.js` and durable module folders under `src/`.
- `src/chat/AGENTS.md` owns side panel chat modules, including `ChatGrounding.js`.
- `src/utils/AGENTS.md` owns shared helper modules, including `braveSearch.js`.
- `src/orchestrator/AGENTS.md` owns LLM run orchestration and web_search tool authorization.
- Root entry points such as `chat.js`, `background.js`, and `options.js` are owned by the root AGENTS.md.

## Local Contracts

- Modules are browser-compatible ES modules imported by extension pages or the service worker.
- New modules must include `@fileoverview` and `@module` JSDoc.
- Public APIs should be explicit named exports unless a local pattern requires a default export.
- Shared prompt strings belong in `src/prompts.js` when they are used by more than one surface.
- Prompt composition must use structured `{instruction, context}` request objects and `composeUserPrompt` from `src/prompts.js`; never concatenate raw selected text, page content, or media context directly into prompt strings.

## Work Guidance

- Keep reusable logic out of large root entry points when it fits an existing `src/` boundary.
- Update `scripts/test-runner.js` when a core module gains a required contract or regression guard.
- Avoid Node-only APIs in browser modules.
- Keep module imports extension-safe with explicit relative paths and `.js` extensions.
- New prompt paths must return structured request objects; the static guard in `scripts/test-runner.js` blocks raw context concatenation patterns.

## Verification

- Run `npm run test` after source module contract changes.
- Run `npm run smoke` when manifest-referenced files or vendored dependencies are affected.
- Exercise the affected extension surface manually for browser-runtime behavior.

## Child DOX Index

- `src/chat/AGENTS.md`: side panel chat UI, API bridge, media handling, streaming, skills, voice input, and page-aware actions.
- `src/utils/AGENTS.md`: shared validation, routing, budgeting, permission, skill parsing, and storage helpers.
- `src/orchestrator/AGENTS.md`: centralized run execution, tool calls, streaming, and skill injection policy.
