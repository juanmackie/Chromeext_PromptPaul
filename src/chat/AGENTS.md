# Chat DOX

## Purpose

The `src/chat/` subtree contains side panel chat modules imported by `chat.js`.

## Ownership

- `ChatUI.js` owns chat DOM rendering, message controls, and attachment previews.
- `ChatAPI.js` owns profile/config resolution and run bridge calls to the background worker.
- `ChatSkills.js` owns `/skills`, `/skill <name>`, per-skill shortcuts, and natural-language skill intent detection.
- `ChatMedia.js` owns media validation, media prompts, base64 conversion, attachment sizing, and vision support checks.
- `ChatStream.js` owns streaming state tracking.
- `ChatVoice.js` owns speech recognition state and voice toggle behavior.
- `ChatPageActions.js` owns page-aware quick actions and preset analysis prompts.

## Local Contracts

- Chat modules are imported from `chat.js`; tests expect every `src/chat/*.js` module to be referenced there.
- Source modules should stay under the current 600-line guard unless the test contract changes deliberately.
- Skill intent support must preserve the documented patterns in root AGENTS.md and `docs/SKILL_EXAMPLES.md`.
- Media handling must route image/video/audio requests through profile selection that supports vision when required.
- UI state changes that affect buttons, attachments, streaming, or storage sync must stay coordinated with `chat.js`.
- `ChatStream.js` run ID (`currentRunId`) is the authoritative ownership token for orchestrator events; `chat.js` checks it against `streamState.getRunId()` before processing any event.
- `ChatPageActions.js` returns structured `{instruction, context}` prompt request objects via `buildSmartPromptRequest`; callers pass these to `makeApiCall` which calls `composeUserPrompt` from `src/prompts.js`.

## Work Guidance

- Keep DOM selection and page-level event wiring in `chat.js` unless a module already owns the behavior.
- Keep pure formatting/parsing helpers exported for tests where possible.
- Preserve user-friendly error messages for runtime, permission, profile, and media failures.
- Update root docs or skill examples when chat command behavior changes.
- New prompt paths must return structured request objects; do not concatenate raw context strings.

## Verification

- Run `npm run test` after chat module changes.
- For UI, media, voice, or streaming changes, reload the side panel and exercise the affected flow in Chrome or Edge.

## Child DOX Index

- No child AGENTS.md files are currently needed under `src/chat/`.
