# Source DOX

## Purpose

The `src/` subtree contains ES modules used by the extension entry points. Organize new implementation by business capability and use case; keep each capability's implementation cohesive and give new durable folders an owning `AGENTS.md` contract. Existing `chat/`, `options/`, and `orchestrator/` folders remain valid owners for their current modules.

## Ownership

- Owns `src/prompts.js` and durable module folders under `src/`.
- `src/chat/AGENTS.md` owns side panel chat modules, including `ChatGrounding.js`.
- `src/act/AGENTS.md` owns Act capability modules; other source areas import them through `src/act/index.js`.
- `src/background/AGENTS.md` owns background runtime-message handlers; `background.js` composes them.
- `src/utils/AGENTS.md` owns shared helper modules, including `braveSearch.js`, `keylessSearch.js`, and `mediaFetch.js`.
- `src/orchestrator/AGENTS.md` owns LLM run orchestration and web_search tool authorization.
- Root entry points such as `chat.js`, `background.js`, and `options.js` are owned by the root AGENTS.md.

## Local Contracts

- Modules are browser-compatible ES modules imported by extension pages or the service worker.
- New modules must include `@fileoverview` and `@module` JSDoc.
- Public APIs should be explicit named exports unless a local pattern requires a default export.
- Shared prompt strings belong in `src/prompts.js` when they are used by more than one surface.
- Prompt composition must use structured `{instruction, context}` request objects and `composeUserPrompt` from `src/prompts.js`; never concatenate raw selected text, page content, filenames, metadata, or media context directly into prompt strings.

## Work Guidance

- Keep implementation out of large root entry points. Put new logic in its owning capability and use-case folder; use `src/utils/` only for stable behavior genuinely shared across capabilities.
- Put observable source behavior coverage in Vitest instead of source-text guards in `scripts/test-runner.js`.
- Avoid Node-only APIs in browser modules.
- Keep module imports extension-safe with explicit relative paths and `.js` extensions.
- New prompt paths must return structured request objects; `composeUserPrompt` caps instruction/context text.

## Verification

- Run `npm run test` after source module contract changes.
- Run `npm run smoke` when manifest-referenced files or vendored dependencies are affected.
- Exercise the affected extension surface manually for browser-runtime behavior.

## Child DOX Index

- `src/chat/AGENTS.md`: side panel chat UI, API bridge, media handling, streaming, skills, voice input, and page-aware actions.
- `src/utils/AGENTS.md`: shared validation, routing, budgeting, permission, skill parsing, and storage helpers.
- `src/orchestrator/AGENTS.md`: centralized run execution, tool calls, streaming, and skill injection policy.
- `src/options/AGENTS.md`: Options page setup and management helpers (setup status, dirty tracking, credential masking, unsaved-change guard).
