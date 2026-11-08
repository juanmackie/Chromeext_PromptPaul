# Chat modules

## Purpose and ownership

`chat.js` composes the side-panel modules. Keep cross-module DOM event wiring there and place capability behavior in its owning `src/chat/` module.

- `ChatAPI.js`: profile selection, request preparation, and background run bridge.
- `ChatComposer.js`, `ChatUI.js`, `ChatActionMenu.js`: composer state, rendering, and local controls.
- `ChatStream.js`, `ChatRunRecovery.js`: live event ownership, history, reconnect, and explicit recovery.
- `ChatPageActions.js`, `ChatPageAutomation.js`, `PageContext.js`: page context and Act controls.
- `ChatAnswerRenderer.js`, `ChatGrounding.js`: validated answer cards and search-source display.
- `ChatMedia.js`, `ChatVoice.js`, `ChatSelection.js`, `ChatSkills.js`, `ChatHermes.js`, `ChatClipboard.js`, `ChatModelStatus.js`: media, voice, selection, skills, Hermes approvals, clipboard, and model status.

## Boundaries

- The root [AGENTS.md](../../AGENTS.md) is canonical for storage, credentials, structured prompts, run ownership, Act policy, answer cards, grounding, and UI state vocabulary. Read it before changing those contracts; read [`src/act/AGENTS.md`](../act/AGENTS.md) for Act behavior.
- `ChatAPI.js` sends provider/profile/model configuration to the worker, never credentials. Opaque run-owner tokens stay in memory; the background journal supports reconnect and explicit recovery.
- Context-bearing requests use structured `{ instruction, context }` data and `composeUserPrompt`. `PageContext.js` and `ChatPageActions.js` prepare bounded, untrusted context.
- Dropped text documents use the `document` prompt context and plain request path. They stay in composer memory until Send and never enter the base64/vision flow.
- `ChatStream.js` owns run/event ordering. It expands live `stream_batch` segments before rendering; live deltas are not persisted.
- `ChatAnswerRenderer.js` renders only validated, allowlisted card projections. Readable answer text remains authoritative; local card controls never start a run or grant authority.
- `ChatGrounding.js` displays search status and sources without reading Brave or Exa keys from panel storage. The background owns those values.
- `ChatHermes.js` sends only validated approval choices. The idle Hermes action is **New chat**, which ends the gateway session through the background before clearing local state.
- Render untrusted text with text nodes or the existing sanitized Markdown path. Keep focus and reader scroll stable during progressive updates.

## Work and verification

- Keep module exports explicit and remove dead paths when consolidating behavior.
- Add behavior tests in `tests/` for changed runtime contracts. Run `npm run test:behavior` and `npm run validate` for source changes.
- For UI, media, voice, or streaming changes, reload the side panel in Chrome or Edge and exercise the affected flow.
