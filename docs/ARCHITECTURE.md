# Architecture

Prompt Paul is a Manifest V3 Chrome extension with three main surfaces:

- `background.js` - service worker, context menus, storage orchestration, and message routing
- `chat.js` - side panel chat interface
- `options.js` - settings, instructions, tools, and skills management

## System Layers

### Browser Layer

- Content scripts extract page content and page metadata
- The background worker coordinates context menu actions and permissions
- The side panel displays chat, page actions, and loaded content

### Chat Layer

- `src/chat/ChatUI.js` renders messages and attachments
- `src/chat/ChatAPI.js` resolves profiles and starts runs
- `src/chat/ChatSkills.js` parses `/skills` and `/skill` commands
- `src/chat/ChatMedia.js` prepares image, video, and audio requests
- `src/chat/ChatStream.js` tracks streaming state and history
- `src/chat/ChatPageActions.js` renders page-aware quick actions and preset prompts

### Shared Utilities

- `src/utils/contextBudget.js` trims loaded page content to fit the model window
- `src/utils/readStrategy.js` picks the extraction mode from page signals
- `src/utils/permissionGuards.js` blocks unsupported browser pages
- `src/utils/actionCards.js` generates site-specific quick actions
- `src/utils/suggestionStorage.js` stores custom site suggestions
- `src/utils/skillParser.js` parses and validates `SKILL.md`
- `src/utils/toolChoiceBuilder.js` normalizes tool choice payloads
- `src/utils/validation.js` provides small shared validators

## Data Flow

### Page content

1. The user loads a page into the side panel
2. The content script extracts text and metadata
3. The background worker returns the extracted payload
4. `chat.js` trims the content to the current budget
5. The user asks follow-up questions against that page context

### Skill usage

1. The user types `/skills`, `/skill <name>`, or `/<skill-name>`
2. `ChatSkills.js` parses the command
3. The orchestrator resolves the matching skill
4. The skill instructions are injected into the run context

### Profile routing

1. `ChatAPI.js` reads the selected profile
2. Shared routing helpers validate the endpoint, key, and model
3. Media requests can reroute to a vision-capable profile when needed

## Build and Test

- `scripts/build.js` copies the extension into `dist/`
- `scripts/test-runner.js` checks module structure and key regression guards
- `scripts/smoke-check.js` performs the cheapest end-to-end sanity check

## Notes

- The extension stays inside Chrome storage and the browser runtime
- Remote APIs are only called when the user sends a prompt or action
- Restricted pages are blocked early with a user-friendly message
